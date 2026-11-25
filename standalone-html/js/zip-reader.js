/**
 * Zero-dependency offline ZIP / XLSX / DOCX reader for modern browsers.
 * Uses Central Directory parsing + native DecompressionStream('deflate-raw') + DOMParser.
 * Works directly over file:// without any server or external CDN.
 */
(function (global) {
  'use strict';

  const utf8Decoder = new TextDecoder('utf-8');

  function decodeXmlText(bytes) {
    return utf8Decoder.decode(bytes);
  }

  /**
   * Parse a ZIP archive ArrayBuffer and return a map of filename -> entry metadata + lazy reader.
   */
  async function readZipEntries(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const len = bytes.length;

    if (len < 22) {
      throw new Error('文件过小，不是有效的压缩文档格式（.xlsx / .docx）');
    }

    // Search backwards for End of Central Directory (EOCD) signature 0x06054b50
    const minOffset = Math.max(0, len - 65557);
    let eocdOffset = -1;
    for (let i = len - 22; i >= minOffset; i--) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x05 &&
        bytes[i + 3] === 0x06
      ) {
        const commentLen = view.getUint16(i + 20, true);
        if (i + 22 + commentLen <= len) {
          eocdOffset = i;
          break;
        }
      }
    }

    if (eocdOffset === -1) {
      throw new Error('无法识别的压缩文档结构，请确认文件是标准 .xlsx 或 .docx 格式（旧版 .xls / .doc 请先另存为新版格式）');
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);

    const entries = new Map();
    let pos = cdOffset;
    const cdEnd = Math.min(len, cdOffset + cdSize);

    for (let idx = 0; idx < totalEntries && pos + 46 <= cdEnd; idx++) {
      const sig = view.getUint32(pos, true);
      if (sig !== 0x02014b50) break;

      const method = view.getUint16(pos + 10, true);
      const compSize = view.getUint32(pos + 20, true);
      const uncompSize = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localHeaderOffset = view.getUint32(pos + 42, true);

      const name = utf8Decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
      entries.set(name, {
        name,
        method,
        compSize,
        uncompSize,
        localHeaderOffset
      });

      pos += 46 + nameLen + extraLen + commentLen;
    }

    async function getBytes(name) {
      const entry = entries.get(name);
      if (!entry) return null;

      const lh = entry.localHeaderOffset;
      if (lh + 30 > len || view.getUint32(lh, true) !== 0x04034b50) {
        throw new Error('ZIP 文件头损坏: ' + name);
      }

      const localNameLen = view.getUint16(lh + 26, true);
      const localExtraLen = view.getUint16(lh + 28, true);
      const dataStart = lh + 30 + localNameLen + localExtraLen;
      const compressed = bytes.subarray(dataStart, dataStart + entry.compSize);

      if (entry.method === 0) {
        return compressed;
      }
      if (entry.method === 8) {
        if (typeof DecompressionStream === 'undefined') {
          throw new Error('当前浏览器版本较旧，不支持离线解压 .xlsx/.docx，请升级 Safari/Chrome 或将文件另存为 .csv / .txt 上传');
        }
        const stream = new Blob([compressed])
          .stream()
          .pipeThrough(new DecompressionStream('deflate-raw'));
        const outBuf = await new Response(stream).arrayBuffer();
        return new Uint8Array(outBuf);
      }
      throw new Error('不支持的 ZIP 压缩方式: ' + entry.method);
    }

    async function getText(name) {
      const raw = await getBytes(name);
      return raw ? decodeXmlText(raw) : null;
    }

    return { entries, getBytes, getText };
  }

  /**
   * Convert Excel column letters (A, B, ..., Z, AA, AB...) to 0-based index.
   */
  function colLettersToIndex(letters) {
    let idx = 0;
    for (let i = 0; i < letters.length; i++) {
      idx = idx * 26 + (letters.charCodeAt(i) - 64);
    }
    return idx - 1;
  }

  function parseXml(xmlStr) {
    const parser = new DOMParser();
    return parser.parseFromString(xmlStr, 'application/xml');
  }

  function getByLocalName(root, localName) {
    return root.getElementsByTagNameNS('*', localName);
  }

  function getDirectChildrenByLocalName(parent, localName) {
    const out = [];
    for (let i = 0; i < parent.childNodes.length; i++) {
      const n = parent.childNodes[i];
      if (n.nodeType === 1 && n.localName === localName) {
        out.push(n);
      }
    }
    return out;
  }

  function normalizeZipPath(baseDir, target) {
    if (!target) return '';
    let path = target.replace(/\\/g, '/');
    if (path.startsWith('/')) {
      return path.slice(1);
    }
    const parts = (baseDir ? baseDir.split('/') : []).concat(path.split('/'));
    const resolved = [];
    for (const p of parts) {
      if (!p || p === '.') continue;
      if (p === '..') resolved.pop();
      else resolved.push(p);
    }
    return resolved.join('/');
  }

  /**
   * Parse an .xlsx ArrayBuffer into { sheets: [{ name, rows: string[][] }] }.
   */
  async function parseXlsx(arrayBuffer) {
    const zip = await readZipEntries(arrayBuffer);

    // 1. Shared strings table
    const sharedStrings = [];
    const ssXml = await zip.getText('xl/sharedStrings.xml');
    if (ssXml) {
      const doc = parseXml(ssXml);
      const sis = getByLocalName(doc, 'si');
      for (let i = 0; i < sis.length; i++) {
        const ts = getByLocalName(sis[i], 't');
        let text = '';
        for (let j = 0; j < ts.length; j++) {
          text += ts[j].textContent || '';
        }
        sharedStrings.push(text);
      }
    }

    // 2. Discover worksheet paths & names via workbook.xml + rels
    const sheetSpecs = [];
    const relsMap = new Map();
    const relsXml = await zip.getText('xl/_rels/workbook.xml.rels');
    if (relsXml) {
      const relDoc = parseXml(relsXml);
      const rels = getByLocalName(relDoc, 'Relationship');
      for (let i = 0; i < rels.length; i++) {
        const id = rels[i].getAttribute('Id');
        const target = rels[i].getAttribute('Target');
        if (id && target) {
          relsMap.set(id, normalizeZipPath('xl', target));
        }
      }
    }

    const wbXml = await zip.getText('xl/workbook.xml');
    if (wbXml) {
      const wbDoc = parseXml(wbXml);
      const sheetNodes = getByLocalName(wbDoc, 'sheet');
      for (let i = 0; i < sheetNodes.length; i++) {
        const s = sheetNodes[i];
        const name = s.getAttribute('name') || 'Sheet' + (i + 1);
        const rid =
          s.getAttribute('r:id') ||
          s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        let path = rid ? relsMap.get(rid) : null;
        if (!path || !zip.entries.has(path)) {
          path = 'xl/worksheets/sheet' + (i + 1) + '.xml';
        }
        if (zip.entries.has(path)) {
          sheetSpecs.push({ name, path });
        }
      }
    }

    // Fallback: scan zip entries for worksheets
    if (sheetSpecs.length === 0) {
      for (const name of zip.entries.keys()) {
        if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) {
          sheetSpecs.push({ name: name.replace(/^.*\//, '').replace(/\.xml$/i, ''), path: name });
        }
      }
      sheetSpecs.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    }

    if (sheetSpecs.length === 0) {
      throw new Error('Excel 文件中未找到任何工作表');
    }

    // 3. Parse each sheet into 2D string rows
    const sheets = [];
    for (const spec of sheetSpecs) {
      const xml = await zip.getText(spec.path);
      if (!xml) continue;
      const doc = parseXml(xml);
      const rowNodes = getByLocalName(doc, 'row');
      const rows = [];

      for (let r = 0; r < rowNodes.length; r++) {
        const cellNodes = getDirectChildrenByLocalName(rowNodes[r], 'c');
        const rowArr = [];
        let fallbackCol = 0;

        for (let c = 0; c < cellNodes.length; c++) {
          const cell = cellNodes[c];
          const ref = cell.getAttribute('r') || '';
          const match = /^([A-Z]+)\d+$/i.exec(ref);
          const colIdx = match ? colLettersToIndex(match[1].toUpperCase()) : fallbackCol;
          fallbackCol = colIdx + 1;

          const type = cell.getAttribute('t') || '';
          let value = '';

          if (type === 's') {
            const vNode = getDirectChildrenByLocalName(cell, 'v')[0];
            if (vNode) {
              const sIdx = parseInt(vNode.textContent, 10);
              value = Number.isFinite(sIdx) && sharedStrings[sIdx] !== undefined ? sharedStrings[sIdx] : '';
            }
          } else if (type === 'inlineStr') {
            const ts = getByLocalName(cell, 't');
            for (let k = 0; k < ts.length; k++) {
              value += ts[k].textContent || '';
            }
          } else if (type === 'b') {
            const vNode = getDirectChildrenByLocalName(cell, 'v')[0];
            value = vNode && vNode.textContent === '1' ? 'TRUE' : 'FALSE';
          } else {
            const vNode = getDirectChildrenByLocalName(cell, 'v')[0];
            if (vNode) {
              value = vNode.textContent || '';
            } else {
              const ts = getByLocalName(cell, 't');
              for (let k = 0; k < ts.length; k++) {
                value += ts[k].textContent || '';
              }
            }
          }

          while (rowArr.length < colIdx) rowArr.push('');
          rowArr[colIdx] = String(value).replace(/\r\n/g, '\n').trim();
        }

        // Skip completely empty rows
        if (rowArr.some((cellVal) => cellVal !== '')) {
          rows.push(rowArr);
        }
      }

      // Normalize column count
      const maxCols = rows.reduce((m, row) => Math.max(m, row.length), 0);
      for (const row of rows) {
        while (row.length < maxCols) row.push('');
      }

      sheets.push({ name: spec.name, rows });
    }

    return { sheets };
  }

  /**
   * Extract plain text of a Word paragraph <w:p>, preserving breaks and tabs.
   */
  function extractParagraphText(pNode) {
    let text = '';
    const walk = (node) => {
      for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i];
        if (child.nodeType !== 1) continue;
        const ln = child.localName;
        if (ln === 't' || ln === 'delText') {
          if (ln === 't') text += child.textContent || '';
        } else if (ln === 'br' || ln === 'cr') {
          text += '\n';
        } else if (ln === 'tab') {
          text += '\t';
        } else if (ln !== 'pPr' && ln !== 'rPr' && ln !== 'del') {
          walk(child);
        }
      }
    };
    walk(pNode);
    return text;
  }

  /**
   * Parse optional numbering.xml to recover automatic list prefixes (1., A.) in Word docs.
   */
  function parseDocxNumbering(numXml) {
    const result = { numToAbstract: new Map(), abstractFormats: new Map() };
    if (!numXml) return result;
    const doc = parseXml(numXml);

    const abstracts = getByLocalName(doc, 'abstractNum');
    for (let i = 0; i < abstracts.length; i++) {
      const abs = abstracts[i];
      const absId = abs.getAttribute('w:abstractNumId') || abs.getAttribute('abstractNumId');
      if (!absId) continue;
      const lvlMap = new Map();
      const lvls = getByLocalName(abs, 'lvl');
      for (let j = 0; j < lvls.length; j++) {
        const lvl = lvls[j];
        const ilvl = lvl.getAttribute('w:ilvl') || lvl.getAttribute('ilvl') || '0';
        const fmtNode = getByLocalName(lvl, 'numFmt')[0];
        const startNode = getByLocalName(lvl, 'start')[0];
        const fmt = fmtNode ? (fmtNode.getAttribute('w:val') || fmtNode.getAttribute('val') || 'decimal') : 'decimal';
        const start = startNode ? parseInt(startNode.getAttribute('w:val') || startNode.getAttribute('val') || '1', 10) : 1;
        lvlMap.set(ilvl, { fmt, start: Number.isFinite(start) ? start : 1 });
      }
      result.abstractFormats.set(absId, lvlMap);
    }

    const nums = getByLocalName(doc, 'num');
    for (let i = 0; i < nums.length; i++) {
      const n = nums[i];
      const numId = n.getAttribute('w:numId') || n.getAttribute('numId');
      const absRef = getByLocalName(n, 'abstractNumId')[0];
      const absId = absRef ? (absRef.getAttribute('w:val') || absRef.getAttribute('val')) : null;
      if (numId && absId) {
        result.numToAbstract.set(numId, absId);
      }
    }
    return result;
  }

  function formatListIndex(fmt, num) {
    if (fmt === 'upperLetter') {
      return String.fromCharCode(64 + ((num - 1) % 26) + 1) + '. ';
    }
    if (fmt === 'lowerLetter') {
      return String.fromCharCode(96 + ((num - 1) % 26) + 1) + '. ';
    }
    if (fmt === 'decimal') {
      return num + '. ';
    }
    return '';
  }

  /**
   * Parse a .docx ArrayBuffer into { text, paragraphs, tables }.
   */
  async function parseDocx(arrayBuffer) {
    const zip = await readZipEntries(arrayBuffer);
    const docXml = await zip.getText('word/document.xml');
    if (!docXml) {
      throw new Error('Word 文件中未找到 word/document.xml，请确认为标准 .docx 格式');
    }

    const numXml = await zip.getText('word/numbering.xml');
    const numbering = parseDocxNumbering(numXml);
    const counters = new Map(); // key: numId:ilvl -> current count

    const doc = parseXml(docXml);
    const body = getByLocalName(doc, 'body')[0] || doc.documentElement;

    const paragraphs = [];
    const tables = [];

    for (let i = 0; i < body.childNodes.length; i++) {
      const node = body.childNodes[i];
      if (node.nodeType !== 1) continue;

      if (node.localName === 'p') {
        let text = extractParagraphText(node).trim();
        if (!text) continue;

        // Recover Word automatic numbering if the text doesn't already start with a number or option letter
        const numPr = getByLocalName(node, 'numPr')[0];
        if (numPr && !/^(?:\d+[.、)）]|[A-H][.、)）]|[一二三四五六七八九十]+[、.])/i.test(text)) {
          const ilvlNode = getByLocalName(numPr, 'ilvl')[0];
          const numIdNode = getByLocalName(numPr, 'numId')[0];
          const ilvl = ilvlNode ? (ilvlNode.getAttribute('w:val') || ilvlNode.getAttribute('val') || '0') : '0';
          const numId = numIdNode ? (numIdNode.getAttribute('w:val') || numIdNode.getAttribute('val')) : null;
          if (numId) {
            const absId = numbering.numToAbstract.get(numId);
            const lvlMap = absId ? numbering.abstractFormats.get(absId) : null;
            const spec = lvlMap ? lvlMap.get(ilvl) : null;
            if (spec && (spec.fmt === 'decimal' || spec.fmt === 'upperLetter' || spec.fmt === 'lowerLetter')) {
              const key = numId + ':' + ilvl;
              // Reset sub-levels when level 0 advances
              if (ilvl === '0') {
                for (const k of counters.keys()) {
                  if (k.startsWith(numId + ':') && k !== key) {
                    counters.delete(k);
                  }
                }
              }
              const nextVal = counters.has(key) ? counters.get(key) + 1 : spec.start;
              counters.set(key, nextVal);
              const prefix = formatListIndex(spec.fmt, nextVal);
              if (prefix) text = prefix + text;
            }
          }
        }

        paragraphs.push(text);
      } else if (node.localName === 'tbl') {
        const tblRows = [];
        const trs = getDirectChildrenByLocalName(node, 'tr');
        for (let r = 0; r < trs.length; r++) {
          const tcs = getDirectChildrenByLocalName(trs[r], 'tc');
          const rowCells = [];
          for (let c = 0; c < tcs.length; c++) {
            const ps = getByLocalName(tcs[c], 'p');
            const cellLines = [];
            for (let p = 0; p < ps.length; p++) {
              const t = extractParagraphText(ps[p]).trim();
              if (t) cellLines.push(t);
            }
            rowCells.push(cellLines.join('\n'));
          }
          if (rowCells.some((v) => v !== '')) {
            tblRows.push(rowCells);
          }
        }
        if (tblRows.length > 0) {
          tables.push(tblRows);
        }
      }
    }

    return {
      text: paragraphs.join('\n'),
      paragraphs,
      tables
    };
  }

  /**
   * Smart text decoding for CSV/TXT files: auto-detect UTF-8 (with or without BOM) vs GB18030/GBK.
   */
  function decodeSmartText(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    // Check UTF-8 BOM
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    // Check UTF-16 LE / BE BOM
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    // Try strict UTF-8 first
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_) {
      // Fallback to GB18030 / GBK (common for Chinese Excel CSV & Windows TXT)
      for (const enc of ['gb18030', 'gbk']) {
        try {
          return new TextDecoder(enc).decode(bytes);
        } catch (__) {
          // ignore
        }
      }
      return new TextDecoder('utf-8').decode(bytes);
    }
  }

  global.OfflineDocReader = {
    readZipEntries,
    parseXlsx,
    parseDocx,
    decodeSmartText
  };
})(typeof window !== 'undefined' ? window : globalThis);
