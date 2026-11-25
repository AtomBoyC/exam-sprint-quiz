/**
 * Universal Smart Question Bank Parser (ES Module for uni-app Vue 3)
 * Works identically on 微信小程序, Android, iOS, Web, and Tauri Desktop.
 */
import { decodeSmartText, parseXlsx, parseDocx } from './doc-reader.js';

export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export const TYPE_LABELS = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题'
};

export function normalizeText(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/[✓✔☑]/g, '√')
    .replace(/[✕✖✗✘☒]/g, '×')
    .trim();
}

export function detectTypeFromLabel(label) {
  const s = String(label || '').toLowerCase().trim();
  if (!s) return null;
  if (/多选|不定项|multiple|multi|checkbox/.test(s)) return 'multiple';
  if (/单选|选择|single|choice|radio/.test(s)) return 'single';
  if (/判断|是非|对错|judge|bool|true\/?false|tf/.test(s)) return 'judge';
  if (/填空|完形|fill|blank|cloze/.test(s)) return 'fill';
  if (/简答|问答|论述|名词解释|计算|案例|主观|应用|分析|材料|short|essay|qa|open/.test(s)) return 'short';
  return null;
}

export function normalizeJudgeAnswer(ans) {
  const s = String(ans || '').trim().toLowerCase();
  if (/^(对|正确|是|√|t|true|yes|y|1|ok)$/.test(s)) return '对';
  if (/^(错|错误|否|×|x|f|false|no|n|0)$/.test(s)) return '错';
  return null;
}

function stripOptionPrefix(text, expectedKey) {
  let s = String(text || '').trim();
  if (!s) return '';
  if (expectedKey) {
    const re = new RegExp('^[\\(（\\[]?' + expectedKey + '[\\)）\\]]?\\s*[.、:：\\)）]\\s*', 'i');
    s = s.replace(re, '');
  } else {
    s = s.replace(/^[\(（\[]?[A-H][\)）\]]?\s*[.、:：\)）]\s*/i, '');
  }
  return s.trim();
}

export function normalizeOptionAnswerLetters(rawAns) {
  const s = String(rawAns || '').toUpperCase();
  const cleaned = s.replace(/[\s,，、;；|/\\.\-（）()【】\[\]]+/g, '');
  if (/^[A-H]{1,8}$/.test(cleaned)) {
    return Array.from(new Set(cleaned.split(''))).sort().join('');
  }
  return null;
}

function isJudgeOptions(options) {
  if (!options || options.length !== 2) return false;
  const j0 = normalizeJudgeAnswer(options[0].text);
  const j1 = normalizeJudgeAnswer(options[1].text);
  return Boolean(j0 && j1 && j0 !== j1);
}

function extractEmbeddedAnswerFromStem(stem, options, hintType) {
  if (!stem) return { stem, answer: '' };
  const parenRegex = /([（(])([^（）()]{1,18})([）)])/g;
  const matches = [];
  let m;
  while ((m = parenRegex.exec(stem)) !== null) {
    matches.push({
      open: m[1],
      inner: m[2].trim(),
      close: m[3],
      index: m.index,
      end: m.index + m[0].length
    });
  }
  if (matches.length === 0) return { stem, answer: '' };

  const emptyBlankIdx = Math.max(
    stem.lastIndexOf('（）'),
    stem.lastIndexOf('()'),
    stem.search(/[（(]\s+[）)][^（(]*$/)
  );
  const validKeys = new Set((options || []).map((o) => o.key));

  for (let i = matches.length - 1; i >= 0; i--) {
    const item = matches[i];
    if (emptyBlankIdx > item.index) continue;

    const jAns = normalizeJudgeAnswer(item.inner);
    if (jAns && (hintType === 'judge' || options.length === 0)) {
      const isUnambiguous = /[对错正确错误√×是否]/.test(item.inner) || item.end >= stem.length - 2;
      if (isUnambiguous) {
        const newStem = stem.slice(0, item.index) + item.open + '  ' + item.close + stem.slice(item.end);
        return { stem: newStem, answer: jAns, detectedType: 'judge' };
      }
    }

    if (options.length > 0) {
      const letters = normalizeOptionAnswerLetters(item.inner);
      if (letters && letters.split('').every((ch) => validKeys.has(ch))) {
        const newStem = stem.slice(0, item.index) + item.open + '  ' + item.close + stem.slice(item.end);
        return {
          stem: newStem,
          answer: letters,
          detectedType: letters.length > 1 ? 'multiple' : 'single'
        };
      }
    }
  }
  return { stem, answer: '' };
}

export function finalizeQuestion(q, idx) {
  let stem = normalizeText(q.stem || '');
  const analysis = normalizeText(q.analysis || '');
  const category = normalizeText(q.category || '');
  let type = q.type || null;
  let rawAnswer = normalizeText(q.answer || '');

  let options = Array.isArray(q.options)
    ? q.options
        .map((opt, i) => {
          if (typeof opt === 'string') {
            const key = OPTION_LETTERS[i] || String(i + 1);
            return { key, text: stripOptionPrefix(opt, key) };
          }
          const key = String(opt.key || OPTION_LETTERS[i] || String(i + 1)).toUpperCase();
          return { key, text: stripOptionPrefix(opt.text || '', key) };
        })
        .filter((o) => o.text !== '')
    : [];

  const seenKeys = new Set();
  options = options.filter((o) => {
    if (seenKeys.has(o.key)) return false;
    seenKeys.add(o.key);
    return true;
  });

  if (isJudgeOptions(options)) {
    const firstIsTrue = normalizeJudgeAnswer(options[0].text) === '对';
    const ansLetters = normalizeOptionAnswerLetters(rawAnswer);
    if (ansLetters === options[0].key) rawAnswer = firstIsTrue ? '对' : '错';
    else if (ansLetters === options[1].key) rawAnswer = firstIsTrue ? '错' : '对';
    type = 'judge';
    options = [
      { key: '对', text: '正确' },
      { key: '错', text: '错误' }
    ];
  }

  if (!rawAnswer) {
    const extracted = extractEmbeddedAnswerFromStem(stem, options, type);
    if (extracted.answer) {
      stem = extracted.stem;
      rawAnswer = extracted.answer;
      if (extracted.detectedType && !type) type = extracted.detectedType;
    }
  }

  let answer = rawAnswer;
  const judgeNorm = normalizeJudgeAnswer(rawAnswer);

  if (type === 'judge' || (options.length === 0 && judgeNorm && rawAnswer.length <= 5)) {
    type = 'judge';
    options = [
      { key: '对', text: '正确' },
      { key: '错', text: '错误' }
    ];
    if (judgeNorm) answer = judgeNorm;
    else if (/^A$/i.test(rawAnswer)) answer = '对';
    else if (/^B$/i.test(rawAnswer)) answer = '错';
  } else if (options.length > 0) {
    const letters = normalizeOptionAnswerLetters(rawAnswer);
    if (letters) {
      answer = letters;
      if (letters.length > 1) type = 'multiple';
      else if (type !== 'multiple') type = 'single';
    } else if (rawAnswer) {
      const matched = options.find((o) => o.text === rawAnswer);
      if (matched) answer = matched.key;
      if (!type) type = 'single';
    } else if (!type) {
      type = 'single';
    }
  } else if (!type || type === 'single' || type === 'multiple') {
    type = /_{2,}|（\s*）|\(\s*\)|【\s*】/.test(stem) && answer.length <= 80 ? 'fill' : 'short';
  }

  return {
    id: q.id || 'q_' + (idx + 1) + '_' + Math.random().toString(36).slice(2, 7),
    index: idx + 1,
    type: type || 'single',
    stem,
    options,
    answer,
    analysis,
    category
  };
}

function splitInlineOptions(line) {
  const markerRe = /(?:^|[\s\t，。；？！：）)\]])((?:[\(（]([A-H])[\)）]|([A-H])\s*[.、:：\)）]))/g;
  const hits = [];
  let m;
  while ((m = markerRe.exec(line)) !== null) {
    const letter = (m[2] || m[3] || '').toUpperCase();
    const markerStart = m.index + (m[0].length - m[1].length);
    const contentStart = m.index + m[0].length;
    hits.push({ letter, markerStart, contentStart });
  }
  if (hits.length === 0) return null;

  const filtered = [];
  for (let i = 0; i < hits.length; i++) {
    const curr = hits[i];
    if (filtered.length === 0) {
      const next = hits[i + 1];
      if (curr.markerStart === 0) filtered.push(curr);
      else if (next && next.letter.charCodeAt(0) === curr.letter.charCodeAt(0) + 1 && curr.letter === 'A') {
        filtered.push(curr);
      }
    } else if (curr.letter.charCodeAt(0) > filtered[filtered.length - 1].letter.charCodeAt(0)) {
      filtered.push(curr);
    }
  }
  if (filtered.length === 0 || (filtered.length === 1 && filtered[0].markerStart > 0)) return null;

  const prefix = line.slice(0, filtered[0].markerStart).trim();
  const options = filtered.map((h, i) => ({
    key: h.letter,
    text: line.slice(h.contentStart, i + 1 < filtered.length ? filtered[i + 1].markerStart : line.length).trim()
  }));
  return { prefix, options };
}

function parseCombinedOptions(raw) {
  const text = normalizeText(raw);
  if (!text) return [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const sp = splitInlineOptions(line);
    if (sp && sp.options.length > 0) out.push(...sp.options);
    else if (out.length > 0) out[out.length - 1].text += ' ' + line;
  }
  if (out.length >= 2) return out;
  const parts = text.split(/\s*[|｜;；]\s*/).filter(Boolean);
  if (parts.length >= 2) {
    return parts.map((p, i) => ({ key: OPTION_LETTERS[i] || String(i + 1), text: stripOptionPrefix(p) }));
  }
  return [];
}

function extractTrailingAnswerKey(text) {
  const lines = text.split('\n');
  let keyHeaderIdx = -1;
  for (let i = lines.length - 1; i >= 3; i--) {
    if (/^(?:【?\s*(?:参考答案|标准答案|答案汇总|答案与解析|参考答案及解析|附[：:]?\s*参考?答案|Answers?)\s*】?[：:\s]*)$/i.test(lines[i].trim())) {
      keyHeaderIdx = i;
      break;
    }
  }
  if (keyHeaderIdx === -1) return { bodyText: text, answerMap: new Map(), analysisMap: new Map() };

  const tailLines = lines.slice(keyHeaderIdx + 1);
  const tailText = tailLines.join('\n').trim();
  if (!tailText) return { bodyText: text, answerMap: new Map(), analysisMap: new Map() };

  const answerMap = new Map();
  const analysisMap = new Map();
  const rangeRe = /(\d+)\s*[-~—–至到]\s*(\d+)\s*[.、:：\s]\s*([A-H\s√×对错TF]+)/gi;
  let rm;
  let rangeFound = false;
  while ((rm = rangeRe.exec(tailText)) !== null) {
    const start = parseInt(rm[1], 10);
    const end = parseInt(rm[2], 10);
    const tokens = rm[3].replace(/\s+/g, '').split('');
    if (end >= start && tokens.length === end - start + 1) {
      rangeFound = true;
      tokens.forEach((tok, k) => answerMap.set(start + k, tok));
    }
  }

  if (!rangeFound || answerMap.size < 2) {
    const compactRe = /(?:^|[\s,，;；])(\d{1,4})\s*[.、:：\)）]\s*([A-H]{1,6}|对|错|正确|错误|√|×|T|F)(?=$|[\s,，;；\n])/gi;
    let cm;
    while ((cm = compactRe.exec(tailText)) !== null) {
      const num = parseInt(cm[1], 10);
      if (!answerMap.has(num)) answerMap.set(num, cm[2].trim());
    }
    for (const line of tailLines) {
      const lm = /^(\d{1,4})\s*[.、:：\)）]\s*(.+)$/.exec(line.trim());
      if (lm) {
        const num = parseInt(lm[1], 10);
        const rest = lm[2].trim();
        const anaMatch = /^(.*?)\s*(?:【?解析】?|分析|解释)[：:]\s*(.+)$/.exec(rest);
        if (anaMatch) {
          if (!answerMap.has(num)) answerMap.set(num, anaMatch[1].trim());
          analysisMap.set(num, anaMatch[2].trim());
        } else if (!answerMap.has(num)) {
          answerMap.set(num, rest);
        }
      }
    }
  }

  if (answerMap.size >= 1) {
    return { bodyText: lines.slice(0, keyHeaderIdx).join('\n'), answerMap, analysisMap };
  }
  return { bodyText: text, answerMap: new Map(), analysisMap: new Map() };
}

export function buildParseResult(questions) {
  const counts = { single: 0, multiple: 0, judge: 0, fill: 0, short: 0 };
  let missingAnswer = 0;
  for (const q of questions) {
    counts[q.type] = (counts[q.type] || 0) + 1;
    if (!q.answer) missingAnswer++;
  }
  const warnings = [];
  if (questions.length === 0) {
    warnings.push('未能解析出题目，请检查格式或调整表格列映射');
  } else if (missingAnswer > 0) {
    warnings.push(`有 ${missingAnswer} 道题未识别到答案，导入后可在题库管理补充`);
  }
  return { questions, stats: { total: questions.length, counts, missingAnswer }, warnings };
}

export function parseText(rawInput) {
  const cleaned = normalizeText(rawInput);
  if (!cleaned) return buildParseResult([]);

  const { bodyText, answerMap, analysisMap } = extractTrailingAnswerKey(cleaned);
  const lines = bodyText.split('\n');
  const rawQuestions = [];
  let current = null;
  let state = 'idle';
  let sectionType = null;
  let sectionCategory = '';

  const pushCurrent = () => {
    if (current && current.stem.trim()) rawQuestions.push(current);
    current = null;
    state = 'idle';
  };

  const sectionRe = /^(?:#{1,4}\s*)?(?:[一二三四五六七八九十]+[、.．\s]|第[一二三四五六七八九十\d]+[部分章节篇]\s*|Part\s*\d+[:.\s]+|【)(.{1,40})$/i;
  const qStartRe = /^(?:(?:第\s*(\d{1,4})\s*题\s*[.、:：]?)|(?:[\(（【\[](\d{1,4})[\)）】\]]\s*[.、:：]?)|(?:[Qq](\d{1,4})\s*[.、:：\)）])|(?:(\d{1,4})\s*[.、\)）])|(?:(\d{1,4})\s+(?=\S))|(?:(?:【?题目】?|题干|问题|问)[：:]))\s*(.*)$/;
  const answerLineRe = /^(?:【?\s*(?:正确|参考|标准)?答案\s*】?|答|Answer|Ans)\s*[：:=]?\s*(.*)$/i;
  const analysisLineRe = /^(?:【?\s*(?:答案|题目|试题)?(?:解析|分析|解释|详解|点评)\s*】?|Explanation|Analysis)\s*[：:=]?\s*(.*)$/i;
  const categoryLineRe = /^(?:【?\s*(?:章节|分类|知识点|考点|标签)\s*】?|Category|Tag)\s*[：:]\s*(.+)$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^[-*_]{3,}$/.test(line)) continue;

    if (sectionRe.test(line) && !/^【\s*(?:答案|解析|单选|多选|判断|填空|简答)/.test(line)) {
      const detected = detectTypeFromLabel(line);
      if ((detected || /^#{1,4}\s/.test(line) || /^[一二三四五六七八九十]+[、.]/.test(line)) && line.length <= 45 && !/[？?]$/.test(line)) {
        pushCurrent();
        if (detected) sectionType = detected;
        sectionCategory = line.replace(/^#{1,4}\s*/, '').replace(/[（(][^）)]*[）)]$/, '').trim();
        continue;
      }
    }

    const anaMatch = analysisLineRe.exec(line);
    if (anaMatch && current) {
      const content = anaMatch[1].trim();
      current.analysis = current.analysis ? current.analysis + '\n' + content : content;
      state = 'analysis';
      continue;
    }

    const ansMatch = answerLineRe.exec(line);
    if (ansMatch && current) {
      let rest = ansMatch[1].trim();
      const inlineAna = /^(.*?)\s*(?:【?\s*(?:答案)?(?:解析|分析|解释)\s*】?)\s*[：:]\s*(.+)$/.exec(rest);
      if (inlineAna) {
        rest = inlineAna[1].trim();
        current.analysis = current.analysis ? current.analysis + '\n' + inlineAna[2].trim() : inlineAna[2].trim();
        state = 'analysis';
      } else {
        state = 'answer';
      }
      if (rest) current.answer = current.answer ? current.answer + '\n' + rest : rest;
      continue;
    }

    const catMatch = categoryLineRe.exec(line);
    if (catMatch && current) {
      current.category = catMatch[1].trim();
      continue;
    }

    const qMatch = qStartRe.exec(line);
    if (qMatch) {
      const numStr = qMatch[1] || qMatch[2] || qMatch[3] || qMatch[4] || qMatch[5] || null;
      let rest = (qMatch[6] || '').trim();
      const numVal = numStr ? parseInt(numStr, 10) : null;
      const looksLikeYearOrUnit = qMatch[5] && (numVal > 1900 || /^[年个月日天元%％米克秒小时分钟万亿]/.test(rest));
      if (!looksLikeYearOrUnit) {
        pushCurrent();
        let qType = sectionType;
        const tpMatch = /^[【\[\(（]\s*(单选题?|多选题?|不定项选择题?|判断题?|填空题?|简答题?|问答题?|论述题?|名词解释)\s*[】\]\)）]\s*/.exec(rest);
        if (tpMatch) {
          qType = detectTypeFromLabel(tpMatch[1]) || qType;
          rest = rest.slice(tpMatch[0].length).trim();
        }
        current = { origNum: numVal, type: qType, stem: '', options: [], answer: '', analysis: '', category: sectionCategory };
        const inlineOpt = splitInlineOptions(rest);
        if (inlineOpt && inlineOpt.prefix && inlineOpt.options.length >= 2) {
          current.stem = inlineOpt.prefix;
          current.options.push(...inlineOpt.options);
          state = 'options';
        } else {
          current.stem = rest;
          state = 'stem';
        }
        continue;
      }
    }

    if (current && state !== 'analysis') {
      const optSplit = splitInlineOptions(line);
      if (optSplit && optSplit.options.length > 0 && !optSplit.prefix) {
        current.options.push(...optSplit.options);
        state = 'options';
        continue;
      }
    }

    if (!current) {
      current = { origNum: null, type: sectionType, stem: line, options: [], answer: '', analysis: '', category: sectionCategory };
      state = 'stem';
    } else if (state === 'analysis') {
      current.analysis += '\n' + line;
    } else if (state === 'answer') {
      current.answer += '\n' + line;
    } else if (state === 'options' && current.options.length > 0) {
      const prevBlank = i > 0 && !lines[i - 1].trim();
      if (prevBlank && current.options.length >= 2 && (current.answer || /[？?（）()]$/.test(line))) {
        pushCurrent();
        current = { origNum: null, type: sectionType, stem: line, options: [], answer: '', analysis: '', category: sectionCategory };
        state = 'stem';
      } else {
        current.options[current.options.length - 1].text += '\n' + line;
      }
    } else {
      const optSplit = splitInlineOptions(line);
      if (optSplit && optSplit.options.length >= 2) {
        if (optSplit.prefix) current.stem += (current.stem ? '\n' : '') + optSplit.prefix;
        current.options.push(...optSplit.options);
        state = 'options';
      } else {
        current.stem += (current.stem ? '\n' : '') + line;
      }
    }
  }
  pushCurrent();

  if (answerMap.size > 0) {
    rawQuestions.forEach((q, idx) => {
      const k = q.origNum != null && answerMap.has(q.origNum) ? q.origNum : idx + 1;
      if (!q.answer && answerMap.has(k)) q.answer = answerMap.get(k);
      if (!q.analysis && analysisMap.has(k)) q.analysis = analysisMap.get(k);
    });
  }

  return buildParseResult(rawQuestions.map((q, idx) => finalizeQuestion(q, idx)));
}

export function looksLikeCsvText(rawText) {
  const lines = String(rawText || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const sample = lines.slice(0, Math.min(lines.length, 15));
  if (sample.filter((l) => /^[A-H]\s*[.、)）:：]/.test(l)).length >= 2) return false;
  if (sample.filter((l) => (l.match(/\t/g) || []).length >= 3).length >= Math.ceil(sample.length * 0.7)) return true;
  if (sample.filter((l) => (l.match(/,/g) || []).length >= 4).length >= Math.ceil(sample.length * 0.7)) return true;
  return false;
}

export function parseCsvRows(text) {
  const normalized = text.replace(/\r\n?/g, '\n');
  const firstLine = normalized.split('\n').find((l) => l.trim().length > 0) || '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  let delimiter = ',';
  if (tabCount > commaCount && tabCount >= 2) delimiter = '\t';
  else if (semiCount > commaCount && semiCount >= 2 && commaCount === 0) delimiter = ';';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some((c) => c !== '')) rows.push(row);

  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (const r of rows) {
    while (r.length < maxCols) r.push('');
  }
  return rows;
}

export function autoDetectTableMapping(rows) {
  if (!rows || rows.length === 0) return { headerRowIndex: -1, headers: [], mapping: {} };

  const matchers = {
    type: /^(题型|题目类型|类型|试题类型|type|qtype|question\s*type)$/i,
    stem: /^(题目|题干|试题|题面|问题|题目内容|试题内容|内容|question|stem|title|content|problem)$/i,
    optionsCombined: /^(选项|所有选项|备选项|候选答案|options|choices)$/i,
    answer: /^(答案|正确答案|参考答案|标准答案|answer|ans|correct|correct\s*answer|key|right\s*answer)$/i,
    analysis: /^(解析|答案解析|题目解析|试题解析|分析|解释|详解|说明|备注|analysis|explanation|explain|note|rationale)$/i,
    category: /^(章节|分类|科目|模块|知识点|考点|标签|难度|来源|category|chapter|tag|topic|subject)$/i
  };

  const optMatchers = OPTION_LETTERS.map((letter) => ({
    letter,
    re: new RegExp('^(?:选项\\s*' + letter + '|备选\\s*' + letter + '|option\\s*' + letter + '|choice\\s*' + letter + '|' + letter + '选项|' + letter + ')$', 'i')
  }));

  let bestRowIdx = -1;
  let bestScore = 0;
  let bestMap = null;

  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    let score = 0;
    const map = { type: -1, stem: -1, optionsCombined: -1, options: {}, answer: -1, analysis: -1, category: -1 };
    rows[r].forEach((rawCell, idx) => {
      const cell = String(rawCell || '').replace(/[（(【\[][^）)\]】]*[）)\]】]/g, '').replace(/\s+/g, ' ').trim();
      if (!cell) return;
      for (const om of optMatchers) {
        if (om.re.test(cell) && map.options[om.letter] === undefined) {
          map.options[om.letter] = idx;
          score += 2;
          return;
        }
      }
      for (const key of Object.keys(matchers)) {
        if (matchers[key].test(cell) && map[key] === -1) {
          map[key] = idx;
          score += key === 'stem' || key === 'answer' ? 4 : 2;
          return;
        }
      }
    });
    if (score > bestScore) {
      bestScore = score;
      bestRowIdx = r;
      bestMap = map;
    }
  }

  if (bestScore < 4 || !bestMap || bestMap.stem === -1) {
    const colCount = rows[0].length;
    const headers = Array.from({ length: colCount }, (_, i) => '第 ' + (i + 1) + ' 列');
    const guessed = { type: -1, stem: 0, optionsCombined: -1, options: {}, answer: -1, analysis: -1, category: -1 };

    const sampleRows = rows.slice(0, Math.min(rows.length, 60));
    const nonEmpty = Array(colCount).fill(0);
    const sumLens = Array(colCount).fill(0);
    const ansHits = Array(colCount).fill(0);
    const typeHits = Array(colCount).fill(0);
    const indexHits = Array(colCount).fill(0);
    const distinctSets = Array.from({ length: colCount }, () => new Set());

    for (const r of sampleRows) {
      for (let c = 0; c < colCount; c++) {
        const val = (r[c] || '').trim();
        if (!val) continue;
        nonEmpty[c]++;
        sumLens[c] += val.length;
        distinctSets[c].add(val);
        if (/^(?:[A-H]{1,6}|对|错|正确|错误|√|×|T|F)$/i.test(val)) ansHits[c]++;
        if (detectTypeFromLabel(val) && val.length <= 8) typeHits[c]++;
        if (/^\d{1,5}$/.test(val)) indexHits[c]++;
      }
    }

    const avgLens = nonEmpty.map((n, c) => (n > 0 ? sumLens[c] / n : 0));
    const isMostlyEmpty = (c) => nonEmpty[c] / sampleRows.length < 0.08;
    const isIndexCol = (c) => nonEmpty[c] > 0 && indexHits[c] >= nonEmpty[c] * 0.8;

    let bestAnsCol = -1;
    let bestAnsCount = 0;
    for (let c = 0; c < colCount; c++) {
      if (isMostlyEmpty(c) || isIndexCol(c)) continue;
      if (ansHits[c] > bestAnsCount && ansHits[c] >= nonEmpty[c] * 0.5) {
        bestAnsCount = ansHits[c];
        bestAnsCol = c;
      }
    }
    if (bestAnsCol !== -1) guessed.answer = bestAnsCol;

    for (let c = 0; c < colCount; c++) {
      if (c === guessed.answer || isMostlyEmpty(c) || isIndexCol(c)) continue;
      if (typeHits[c] >= Math.max(2, nonEmpty[c] * 0.5)) {
        guessed.type = c;
        break;
      }
    }

    let bestStemCol = -1;
    let bestStemScore = -1;
    for (let c = 0; c < colCount; c++) {
      if (c === guessed.answer || c === guessed.type || isMostlyEmpty(c) || isIndexCol(c)) continue;
      if (guessed.answer !== -1 && c > guessed.answer && bestStemCol !== -1) continue;
      const distinctRatio = nonEmpty[c] > 0 ? distinctSets[c].size / nonEmpty[c] : 0;
      const stemScore = avgLens[c] * (0.4 + 0.6 * distinctRatio) * (c <= 2 ? 1.25 : 1);
      if (stemScore > bestStemScore) {
        bestStemScore = stemScore;
        bestStemCol = c;
      }
    }
    guessed.stem = bestStemCol !== -1 ? bestStemCol : 0;

    let optIdx = 0;
    const optEnd = guessed.answer !== -1 ? guessed.answer : colCount;
    for (let c = guessed.stem + 1; c < optEnd; c++) {
      if (c === guessed.type || isMostlyEmpty(c)) continue;
      if (optIdx < OPTION_LETTERS.length) guessed.options[OPTION_LETTERS[optIdx++]] = c;
    }

    if (guessed.answer !== -1) {
      for (let c = guessed.answer + 1; c < colCount; c++) {
        if (c === guessed.type || isMostlyEmpty(c) || isIndexCol(c)) continue;
        const distinctRatio = nonEmpty[c] > 0 ? distinctSets[c].size / nonEmpty[c] : 1;
        const looksChapter = Array.from(distinctSets[c]).some((v) =>
          /^(?:[一二三四五六七八九十]+[、.]|第[一二三四五六七八九十\d]+[章节部分])/.test(v)
        );
        if (guessed.category === -1 && (looksChapter || (sampleRows.length >= 4 && distinctRatio <= 0.45))) {
          guessed.category = c;
        } else if (guessed.analysis === -1) {
          guessed.analysis = c;
        }
      }
    }
    return { headerRowIndex: -1, headers, mapping: guessed };
  }

  const headers = rows[bestRowIdx].map((h, i) => h || '第 ' + (i + 1) + ' 列');
  return { headerRowIndex: bestRowIdx, headers, mapping: bestMap };
}

export function parseTableWithMapping(rows, mapping, headerRowIndex) {
  const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
  const rawQuestions = [];

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    let stemText = mapping.stem >= 0 ? (row[mapping.stem] || '').trim() : '';
    if (!stemText) continue;

    const type = detectTypeFromLabel(mapping.type >= 0 ? row[mapping.type] : '');
    let options = [];

    for (const letter of OPTION_LETTERS) {
      const col = mapping.options && mapping.options[letter];
      if (col !== undefined && col >= 0) {
        const val = (row[col] || '').trim();
        if (val) options.push({ key: letter, text: val });
      }
    }

    if (options.length === 0 && mapping.optionsCombined >= 0) {
      options = parseCombinedOptions(row[mapping.optionsCombined] || '');
    }

    if (options.length === 0 && stemText.includes('\n')) {
      const extractedOpts = [];
      const stemLines = [];
      for (const ln of stemText.split('\n')) {
        const sp = splitInlineOptions(ln.trim());
        if (sp && sp.options.length > 0 && !sp.prefix) extractedOpts.push(...sp.options);
        else stemLines.push(ln);
      }
      if (extractedOpts.length >= 2) {
        options = extractedOpts;
        stemText = stemLines.join('\n').trim();
      }
    }

    rawQuestions.push({
      type,
      stem: stemText,
      options,
      answer: mapping.answer >= 0 ? (row[mapping.answer] || '').trim() : '',
      analysis: mapping.analysis >= 0 ? (row[mapping.analysis] || '').trim() : '',
      category: mapping.category >= 0 ? (row[mapping.category] || '').trim() : ''
    });
  }

  return buildParseResult(rawQuestions.map((q, idx) => finalizeQuestion(q, idx)));
}

export function parseJson(rawText) {
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    throw new Error('JSON 格式错误：' + e.message);
  }

  let list = Array.isArray(data)
    ? data
    : data && (data.questions || data.list || data.data || data.items || data.problems || data.bank);
  if (!Array.isArray(list) && data && typeof data === 'object') {
    const vals = Object.values(data).filter((v) => Array.isArray(v));
    if (vals.length > 0) list = vals.flat();
  }
  if (!Array.isArray(list)) {
    throw new Error('JSON 中未找到题目数组');
  }

  const rawQuestions = list
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const stem = item.stem || item.question || item.title || item.content || item['题目'] || item['题干'] || '';
      if (!String(stem).trim()) return null;

      let options = [];
      const rawOpts = item.options || item.choices || item['选项'];
      if (Array.isArray(rawOpts)) {
        options = rawOpts.map((o, i) =>
          typeof o === 'string'
            ? { key: OPTION_LETTERS[i] || String(i + 1), text: o }
            : { key: o.key || o.label || OPTION_LETTERS[i] || String(i + 1), text: o.text || o.content || o.value || '' }
        );
      } else if (rawOpts && typeof rawOpts === 'object') {
        for (const [k, v] of Object.entries(rawOpts)) {
          if (v != null && String(v).trim() !== '') options.push({ key: k.toUpperCase(), text: String(v) });
        }
      } else if (typeof rawOpts === 'string') {
        options = parseCombinedOptions(rawOpts);
      } else {
        for (const letter of OPTION_LETTERS) {
          const val = item[letter] ?? item[letter.toLowerCase()] ?? item['option' + letter] ?? item['选项' + letter];
          if (val != null && String(val).trim() !== '') options.push({ key: letter, text: String(val) });
        }
      }

      let answer = item.answer ?? item.ans ?? item.correctAnswer ?? item['答案'] ?? item['正确答案'] ?? '';
      if (Array.isArray(answer)) answer = answer.join('');
      else if (typeof answer === 'boolean') answer = answer ? '对' : '错';

      return {
        id: item.id,
        type: detectTypeFromLabel(item.type || item.qtype || item['题型']),
        stem: String(stem),
        options,
        answer: String(answer),
        analysis: String(item.analysis || item.explanation || item['解析'] || ''),
        category: String(item.category || item.chapter || item['章节'] || item['分类'] || '')
      };
    })
    .filter(Boolean);

  return buildParseResult(rawQuestions.map((q, idx) => finalizeQuestion(q, idx)));
}

/**
 * Parse a file given its filename and ArrayBuffer across any platform (微信小程序 / App / Web / Desktop).
 */
export async function parseArrayBufferByFilename(filename, arrayBuffer) {
  const name = filename || '未命名题库';
  const ext = (name.split('.').pop() || '').toLowerCase();
  const baseName = name.replace(/\.[^.]+$/, '');

  if (ext === 'json') {
    return { kind: 'direct', bankName: baseName, ...parseJson(decodeSmartText(arrayBuffer)) };
  }
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    const text = decodeSmartText(arrayBuffer);
    if (looksLikeCsvText(text)) {
      const rows = parseCsvRows(text);
      const detected = autoDetectTableMapping(rows);
      const res = parseTableWithMapping(rows, detected.mapping, detected.headerRowIndex);
      return { kind: 'table', bankName: baseName, sheets: [{ name: '文本表格', rows }], activeSheetIndex: 0, ...detected, ...res };
    }
    return { kind: 'direct', bankName: baseName, ...parseText(text) };
  }
  if (ext === 'csv' || ext === 'tsv') {
    const rows = parseCsvRows(decodeSmartText(arrayBuffer));
    const detected = autoDetectTableMapping(rows);
    const res = parseTableWithMapping(rows, detected.mapping, detected.headerRowIndex);
    return { kind: 'table', bankName: baseName, sheets: [{ name: 'CSV表格', rows }], activeSheetIndex: 0, ...detected, ...res };
  }
  if (ext === 'xlsx') {
    const { sheets } = await parseXlsx(arrayBuffer);
    let activeIdx = sheets.findIndex((s) => s.rows.length > 0);
    if (activeIdx === -1) activeIdx = 0;
    const rows = sheets[activeIdx].rows;
    const detected = autoDetectTableMapping(rows);
    const res = parseTableWithMapping(rows, detected.mapping, detected.headerRowIndex);
    return { kind: 'table', bankName: baseName, sheets, activeSheetIndex: activeIdx, ...detected, ...res };
  }
  if (ext === 'docx') {
    const doc = await parseDocx(arrayBuffer);
    const allTableRows = [];
    for (const tbl of doc.tables) {
      if (tbl.length >= 2 && tbl[0].length >= 2) allTableRows.push(...tbl);
    }
    const textRes = doc.text.trim() ? parseText(doc.text) : buildParseResult([]);
    if (allTableRows.length >= 2) {
      const detected = autoDetectTableMapping(allTableRows);
      const tblRes = parseTableWithMapping(allTableRows, detected.mapping, detected.headerRowIndex);
      if (tblRes.questions.length > textRes.questions.length) {
        return { kind: 'table', bankName: baseName, sheets: [{ name: 'Word表格', rows: allTableRows }], activeSheetIndex: 0, ...detected, ...tblRes };
      }
    }
    return { kind: 'direct', bankName: baseName, ...textRes };
  }
  if (ext === 'xls' || ext === 'doc') {
    throw new Error(`暂不支持旧版 .${ext} 二进制格式，请用 Excel/WPS 另存为 .${ext}x 或 .csv 后上传`);
  }
  if (ext === 'pdf') {
    throw new Error('PDF 文件建议打开后全选复制文字，使用下方「智能文本粘贴」框 3 秒精准识别！');
  }
  return { kind: 'direct', bankName: baseName, ...parseText(decodeSmartText(arrayBuffer)) };
}

export function checkAnswer(question, userAnswer) {
  if (!question.answer) return { isCorrect: null, noKey: true };
  if (question.type === 'single' || question.type === 'multiple') {
    const expected = normalizeOptionAnswerLetters(question.answer) || question.answer.trim().toUpperCase();
    const given = normalizeOptionAnswerLetters(userAnswer) || String(userAnswer || '').trim().toUpperCase();
    return { isCorrect: expected === given, expected, given };
  }
  if (question.type === 'judge') {
    const expected = normalizeJudgeAnswer(question.answer) || question.answer.trim();
    const given = normalizeJudgeAnswer(userAnswer) || String(userAnswer || '').trim();
    return { isCorrect: expected === given, expected, given };
  }
  if (question.type === 'fill') {
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s，,、；;。．.]+/g, ' ');
    const given = norm(userAnswer);
    const candidates = String(question.answer).split(/[|｜]/).map(norm).filter(Boolean);
    return { isCorrect: candidates.some((c) => c === given), expected: question.answer, given: userAnswer };
  }
  return { isCorrect: null, selfGrade: true, expected: question.answer, given: userAnswer };
}
