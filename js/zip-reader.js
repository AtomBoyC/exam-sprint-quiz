/**
 * Zero-Dependency Offline Document Reader (Web & Tauri Desktop)
 * Includes pure-JS RFC-1951 DEFLATE (inflateRawPure), pure-JS XML scanner, and UTF-8/GB18030/GBK smart decoder.
 * Works 100% offline over both file:// and https:// without any external CDN.
 */
(function (global) {
  'use strict';

  function decodeUtf8Pure(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      try {
        return new TextDecoder('utf-8').decode(bytes);
      } catch (_) {}
    }
    let out = '';
    let i = 0;
    const len = bytes.length;
    while (i < len) {
      const b0 = bytes[i++];
      if (b0 < 0x80) {
        out += String.fromCharCode(b0);
      } else if ((b0 & 0xe0) === 0xc0 && i < len) {
        out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
      } else if ((b0 & 0xf0) === 0xe0 && i + 1 < len) {
        const b1 = bytes[i++] & 0x3f;
        const b2 = bytes[i++] & 0x3f;
        out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2);
      } else if ((b0 & 0xf8) === 0xf0 && i + 2 < len) {
        const b1 = bytes[i++] & 0x3f;
        const b2 = bytes[i++] & 0x3f;
        const b3 = bytes[i++] & 0x3f;
        const cp = (((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3) - 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return out;
  }

  function decodeSmartText(arrayBuffer) {
    const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return decodeUtf8Pure(bytes.subarray(3));
    }
    if (typeof TextDecoder !== 'undefined') {
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
      }
      if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(bytes.subarray(2));
      }
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (_) {
        for (const enc of ['gb18030', 'gbk']) {
          try {
            return new TextDecoder(enc).decode(bytes);
          } catch (__) {}
        }
      }
    }
    return decodeUtf8Pure(bytes);
  }

  // ==================== PURE-JS RFC-1951 INFLATE ====================
  const LEN_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258
  ];
  const LEN_EXTRA = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
    3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
  ];
  const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577
  ];
  const DIST_EXTRA = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13
  ];
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function buildHuffmanTable(lengths) {
    let maxBits = 0;
    for (let i = 0; i < lengths.length; i++) {
      if (lengths[i] > maxBits) maxBits = lengths[i];
    }
    if (maxBits === 0) return { counts: [0], symbols: [], maxBits: 0 };
    const counts = new Uint16Array(maxBits + 1);
    for (let i = 0; i < lengths.length; i++) {
      if (lengths[i] > 0) counts[lengths[i]]++;
    }
    const offsets = new Uint16Array(maxBits + 1);
    for (let b = 1; b < maxBits; b++) offsets[b + 1] = offsets[b] + counts[b];
    const symbols = new Uint16Array(offsets[maxBits] + counts[maxBits]);
    for (let sym = 0; sym < lengths.length; sym++) {
      const len = lengths[sym];
      if (len > 0) symbols[offsets[len]++] = sym;
    }
    return { counts, symbols, maxBits };
  }

  const FIXED_LIT_LENS = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) FIXED_LIT_LENS[i] = 8;
  for (let i = 144; i <= 255; i++) FIXED_LIT_LENS[i] = 9;
  for (let i = 256; i <= 279; i++) FIXED_LIT_LENS[i] = 7;
  for (let i = 280; i <= 287; i++) FIXED_LIT_LENS[i] = 8;
  const FIXED_LIT_TABLE = buildHuffmanTable(FIXED_LIT_LENS);
  const FIXED_DIST_TABLE = buildHuffmanTable(new Uint8Array(32).fill(5));

  function inflateRawPure(src, expectedSize = 0) {
    let bytePos = 0;
    let bitBuf = 0;
    let bitCnt = 0;
    let out = new Uint8Array(expectedSize > 0 ? expectedSize : Math.max(256, src.length * 3));
    let outPos = 0;

    const ensureCap = (extra) => {
      if (outPos + extra <= out.length) return;
      let newLen = out.length * 2;
      while (newLen < outPos + extra) newLen *= 2;
      const next = new Uint8Array(newLen);
      next.set(out.subarray(0, outPos));
      out = next;
    };

    const readBits = (n) => {
      while (bitCnt < n) {
        if (bytePos >= src.length) throw new Error('压缩数据不完整');
        bitBuf |= src[bytePos++] << bitCnt;
        bitCnt += 8;
      }
      const val = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return val;
    };

    const decodeSymbol = (table) => {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len <= table.maxBits; len++) {
        code |= readBits(1);
        const count = table.counts[len];
        if (code - count < first) return table.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error('无效的 Huffman 编码');
    };

    let bfinal = 0;
    while (!bfinal) {
      bfinal = readBits(1);
      const btype = readBits(2);
      if (btype === 0) {
        bitBuf = 0; bitCnt = 0;
        const len = src[bytePos] | (src[bytePos + 1] << 8);
        bytePos += 4;
        ensureCap(len);
        out.set(src.subarray(bytePos, bytePos + len), outPos);
        outPos += len;
        bytePos += len;
      } else if (btype === 1 || btype === 2) {
        let litTable = FIXED_LIT_TABLE;
        let distTable = FIXED_DIST_TABLE;
        if (btype === 2) {
          const hlit = readBits(5) + 257;
          const hdist = readBits(5) + 1;
          const hclen = readBits(4) + 4;
          const clLens = new Uint8Array(19);
          for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]] = readBits(3);
          const clTable = buildHuffmanTable(clLens);
          const allLens = new Uint8Array(hlit + hdist);
          let idx = 0;
          while (idx < hlit + hdist) {
            const sym = decodeSymbol(clTable);
            if (sym < 16) allLens[idx++] = sym;
            else if (sym === 16) {
              const rep = readBits(2) + 3, prev = idx > 0 ? allLens[idx - 1] : 0;
              for (let r = 0; r < rep; r++) allLens[idx++] = prev;
            } else if (sym === 17) {
              const rep = readBits(3) + 3;
              for (let r = 0; r < rep; r++) allLens[idx++] = 0;
            } else {
              const rep = readBits(7) + 11;
              for (let r = 0; r < rep; r++) allLens[idx++] = 0;
            }
          }
          litTable = buildHuffmanTable(allLens.subarray(0, hlit));
          distTable = buildHuffmanTable(allLens.subarray(hlit));
        }
        while (true) {
          const sym = decodeSymbol(litTable);
          if (sym < 256) {
            ensureCap(1);
            out[outPos++] = sym;
          } else if (sym === 256) {
            break;
          } else {
            const lIdx = sym - 257;
            const length = LEN_BASE[lIdx] + (LEN_EXTRA[lIdx] ? readBits(LEN_EXTRA[lIdx]) : 0);
            const dSym = decodeSymbol(distTable);
            const dist = DIST_BASE[dSym] + (DIST_EXTRA[dSym] ? readBits(DIST_EXTRA[dSym]) : 0);
            ensureCap(length);
            let copySrc = outPos - dist;
            for (let k = 0; k < length; k++) out[outPos++] = out[copySrc++];
          }
        }
      } else {
        throw new Error('不支持的 DEFLATE 块类型');
      }
    }
    return out.subarray(0, outPos);
  }

  async function readZipEntries(arrayBuffer) {
    const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const len = bytes.length;
    if (len < 22) throw new Error('不是有效的压缩文档（.xlsx / .docx）');

    const minOffset = Math.max(0, len - 65557);
    let eocdOffset = -1;
    for (let i = len - 22; i >= minOffset; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        if (i + 22 + view.getUint16(i + 20, true) <= len) {
          eocdOffset = i;
          break;
        }
      }
    }
    if (eocdOffset === -1) {
      throw new Error('无法解析文档结构，请确认为标准 .xlsx 或 .docx 格式（旧版 .xls/.doc 请先另存为新版格式）');
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const entries = new Map();
    let pos = cdOffset;
    const cdEnd = Math.min(len, cdOffset + cdSize);

    for (let idx = 0; idx < totalEntries && pos + 46 <= cdEnd; idx++) {
      if (view.getUint32(pos, true) !== 0x02014b50) break;
      const method = view.getUint16(pos + 10, true);
      const compSize = view.getUint32(pos + 20, true);
      const uncompSize = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localHeaderOffset = view.getUint32(pos + 42, true);
      const name = decodeUtf8Pure(bytes.subarray(pos + 46, pos + 46 + nameLen));
      entries.set(name, { name, method, compSize, uncompSize, localHeaderOffset });
      pos += 46 + nameLen + extraLen + commentLen;
    }

    async function getBytes(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      const lh = entry.localHeaderOffset;
      if (lh + 30 > len || view.getUint32(lh, true) !== 0x04034b50) {
        throw new Error('ZIP 文件头损坏: ' + name);
      }
      const dataStart = lh + 30 + view.getUint16(lh + 26, true) + view.getUint16(lh + 28, true);
      const compressed = bytes.subarray(dataStart, dataStart + entry.compSize);
      if (entry.method === 0) return compressed;
      if (entry.method === 8) return inflateRawPure(compressed, entry.uncompSize);
      throw new Error('不支持的压缩方式: ' + entry.method);
    }

    async function getText(name) {
      const raw = await getBytes(name);
      return raw ? decodeUtf8Pure(raw) : null;
    }

    return { entries, getBytes, getText };
  }

  function unescapeXml(str) {
    if (!str) return '';
    return str
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function getAttr(attrStr, attrName) {
    if (!attrStr) return null;
    const re = new RegExp('(?:^|\\s)(?:[\\w-]+:)?' + attrName + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')');
    const m = re.exec(attrStr);
    return m ? unescapeXml(m[2] ?? m[3] ?? '') : null;
  }

  function extractBlocks(xml, localTagName) {
    const blocks = [];
    const re = new RegExp(
      '<(?:[\\w-]+:)?' +
        localTagName +
        '(\\s[^>]*?)?(?:\\/>|>([\\s\\S]*?)<\\/(?:[\\w-]+:)?' +
        localTagName +
        '\\s*>)',
      'g'
    );
    let m;
    while ((m = re.exec(xml)) !== null) {
      blocks.push({ attrs: m[1] || '', inner: m[2] || '' });
    }
    return blocks;
  }

  function extractAllTagTexts(xml, localTagName) {
    const re = new RegExp(
      '<(?:[\\w-]+:)?' + localTagName + '(?:\\s[^>]*?)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?' + localTagName + '\\s*>',
      'g'
    );
    let text = '', m;
    while ((m = re.exec(xml)) !== null) text += unescapeXml(m[1]);
    return text;
  }

  function colLettersToIndex(letters) {
    let idx = 0;
    for (let i = 0; i < letters.length; i++) idx = idx * 26 + (letters.charCodeAt(i) - 64);
    return idx - 1;
  }

  function normalizeZipPath(baseDir, target) {
    if (!target) return '';
    const p = target.replace(/\\/g, '/');
    if (p.startsWith('/')) return p.slice(1);
    const parts = (baseDir ? baseDir.split('/') : []).concat(p.split('/'));
    const out = [];
    for (const seg of parts) {
      if (!seg || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    return out.join('/');
  }

  async function parseXlsx(arrayBuffer) {
    const zip = await readZipEntries(arrayBuffer);
    const sharedStrings = [];
    const ssXml = await zip.getText('xl/sharedStrings.xml');
    if (ssXml) {
      for (const si of extractBlocks(ssXml, 'si')) {
        sharedStrings.push(extractAllTagTexts(si.inner, 't'));
      }
    }

    const relsMap = new Map();
    const relsXml = await zip.getText('xl/_rels/workbook.xml.rels');
    if (relsXml) {
      for (const r of extractBlocks(relsXml, 'Relationship')) {
        const id = getAttr(r.attrs, 'Id');
        const target = getAttr(r.attrs, 'Target');
        if (id && target) relsMap.set(id, normalizeZipPath('xl', target));
      }
    }

    const sheetSpecs = [];
    const wbXml = await zip.getText('xl/workbook.xml');
    if (wbXml) {
      extractBlocks(wbXml, 'sheet').forEach((s, i) => {
        const name = getAttr(s.attrs, 'name') || 'Sheet' + (i + 1);
        const rid = getAttr(s.attrs, 'id');
        let path = rid ? relsMap.get(rid) : null;
        if (!path || !zip.entries.has(path)) path = 'xl/worksheets/sheet' + (i + 1) + '.xml';
        if (zip.entries.has(path)) sheetSpecs.push({ name, path });
      });
    }
    if (sheetSpecs.length === 0) {
      for (const name of zip.entries.keys()) {
        if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) {
          sheetSpecs.push({ name: name.replace(/^.*\//, '').replace(/\.xml$/i, ''), path: name });
        }
      }
      sheetSpecs.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    }
    if (sheetSpecs.length === 0) throw new Error('Excel 文件中未找到工作表');

    const sheets = [];
    for (const spec of sheetSpecs) {
      const xml = await zip.getText(spec.path);
      if (!xml) continue;
      const rows = [];
      for (const rb of extractBlocks(xml, 'row')) {
        const rowArr = [];
        let fallbackCol = 0;
        for (const cb of extractBlocks(rb.inner, 'c')) {
          const ref = getAttr(cb.attrs, 'r') || '';
          const rm = /^([A-Z]+)\d+$/i.exec(ref);
          const colIdx = rm ? colLettersToIndex(rm[1].toUpperCase()) : fallbackCol;
          fallbackCol = colIdx + 1;
          const type = getAttr(cb.attrs, 't') || '';
          let value = '';
          if (type === 's') {
            const sIdx = parseInt(extractAllTagTexts(cb.inner, 'v'), 10);
            value = Number.isFinite(sIdx) && sharedStrings[sIdx] !== undefined ? sharedStrings[sIdx] : '';
          } else if (type === 'inlineStr') {
            value = extractAllTagTexts(cb.inner, 't');
          } else if (type === 'b') {
            value = extractAllTagTexts(cb.inner, 'v') === '1' ? 'TRUE' : 'FALSE';
          } else {
            value = extractAllTagTexts(cb.inner, 'v') || extractAllTagTexts(cb.inner, 't');
          }
          while (rowArr.length < colIdx) rowArr.push('');
          rowArr[colIdx] = String(value).replace(/\r\n/g, '\n').trim();
        }
        if (rowArr.some((v) => v !== '')) rows.push(rowArr);
      }
      const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
      for (const r of rows) while (r.length < maxCols) r.push('');
      sheets.push({ name: spec.name, rows });
    }
    return { sheets };
  }

  function extractWordParagraphText(pInner) {
    const cleaned = pInner
      .replace(/<(?:\w+:)?del\b[\s\S]*?<\/(?:\w+:)?del>/g, '')
      .replace(/<(?:\w+:)?(?:br|cr)\b[^>]*\/?>/g, '<w:t>\n</w:t>')
      .replace(/<(?:\w+:)?tab\b[^>]*\/?>/g, '<w:t>\t</w:t>');
    return extractAllTagTexts(cleaned, 't');
  }

  async function parseDocx(arrayBuffer) {
    const zip = await readZipEntries(arrayBuffer);
    const docXml = await zip.getText('word/document.xml');
    if (!docXml) throw new Error('Word 文档未找到 word/document.xml，请确认为 .docx 格式');

    const tables = [];
    for (const tb of extractBlocks(docXml, 'tbl')) {
      const tblRows = [];
      for (const tr of extractBlocks(tb.inner, 'tr')) {
        const cells = extractBlocks(tr.inner, 'tc').map((tc) =>
          extractBlocks(tc.inner, 'p')
            .map((p) => extractWordParagraphText(p.inner).trim())
            .filter(Boolean)
            .join('\n')
        );
        if (cells.some((c) => c !== '')) tblRows.push(cells);
      }
      if (tblRows.length > 0) tables.push(tblRows);
    }

    const withoutTables = docXml.replace(/<(?:\w+:)?tbl\b[\s\S]*?<\/(?:\w+:)?tbl>/g, '');
    const paragraphs = extractBlocks(withoutTables, 'p')
      .map((p) => extractWordParagraphText(p.inner).trim())
      .filter(Boolean);

    return { text: paragraphs.join('\n'), paragraphs, tables };
  }

  global.OfflineDocReader = {
    decodeUtf8Pure,
    decodeSmartText,
    inflateRawPure,
    readZipEntries,
    parseXlsx,
    parseDocx
  };
})(typeof window !== 'undefined' ? window : globalThis);
