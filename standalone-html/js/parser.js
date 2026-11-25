/**
 * Universal Smart Question Bank Parser
 * Supports: .xlsx, .csv/.tsv, .docx (tables & paragraphs), .json, .txt/.md, and pasted raw text.
 * Handles: Single Choice, Multiple Choice, True/False (Judge), Fill-in-the-blank, Short Answer.
 */
(function (global) {
  'use strict';

  const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  const TYPE_LABELS = {
    single: '单选题',
    multiple: '多选题',
    judge: '判断题',
    fill: '填空题',
    short: '简答题'
  };

  function normalizeText(raw) {
    return String(raw || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\u3000/g, ' ')
      .replace(/[✓✔☑]/g, '√')
      .replace(/[✕✖✗✘☒]/g, '×')
      .trim();
  }

  function detectTypeFromLabel(label) {
    const s = String(label || '').toLowerCase().trim();
    if (!s) return null;
    if (/多选|不定项|multiple|multi|checkbox/.test(s)) return 'multiple';
    if (/单选|选择|single|choice|radio/.test(s)) return 'single';
    if (/判断|是非|对错|judge|bool|true\/?false|tf/.test(s)) return 'judge';
    if (/填空|完形|fill|blank|cloze/.test(s)) return 'fill';
    if (/简答|问答|论述|名词解释|计算|案例|主观|应用|分析|材料|short|essay|qa|open/.test(s)) return 'short';
    return null;
  }

  function normalizeJudgeAnswer(ans) {
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

  function normalizeOptionAnswerLetters(rawAns) {
    const s = String(rawAns || '').toUpperCase();
    // Keep only A-H letters if the string consists mostly of letters/separators
    const cleaned = s.replace(/[\s,，、;；|/\\.\-（）()【】\[\]]+/g, '');
    if (/^[A-H]{1,8}$/.test(cleaned)) {
      const unique = Array.from(new Set(cleaned.split(''))).sort();
      return unique.join('');
    }
    return null;
  }

  function isJudgeOptions(options) {
    if (!options || options.length !== 2) return false;
    const t0 = String(options[0].text || '').trim();
    const t1 = String(options[1].text || '').trim();
    const j0 = normalizeJudgeAnswer(t0);
    const j1 = normalizeJudgeAnswer(t1);
    return Boolean(j0 && j1 && j0 !== j1);
  }

  /**
   * Finalize & normalize a single raw question object.
   */
  function finalizeQuestion(q, idx) {
    let stem = normalizeText(q.stem || '');
    let analysis = normalizeText(q.analysis || '');
    let category = normalizeText(q.category || '');
    let type = q.type || null;
    let rawAnswer = normalizeText(q.answer || '');

    // Clean options
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

    // Deduplicate option keys cleanly
    const seenKeys = new Set();
    options = options.filter((o) => {
      if (seenKeys.has(o.key)) return false;
      seenKeys.add(o.key);
      return true;
    });

    // If options are ["正确", "错误"], normalize to judge
    if (isJudgeOptions(options)) {
      const firstIsTrue = normalizeJudgeAnswer(options[0].text) === '对';
      const ansLetters = normalizeOptionAnswerLetters(rawAnswer);
      if (ansLetters === options[0].key) {
        rawAnswer = firstIsTrue ? '对' : '错';
      } else if (ansLetters === options[1].key) {
        rawAnswer = firstIsTrue ? '错' : '对';
      }
      type = 'judge';
      options = [
        { key: '对', text: '正确' },
        { key: '错', text: '错误' }
      ];
    }

    // Try extracting embedded answer from stem parentheses if rawAnswer is empty
    if (!rawAnswer) {
      const extracted = extractEmbeddedAnswerFromStem(stem, options, type);
      if (extracted.answer) {
        stem = extracted.stem;
        rawAnswer = extracted.answer;
        if (extracted.detectedType && !type) {
          type = extracted.detectedType;
        }
      }
    }

    // Determine normalized answer & final type
    let answer = rawAnswer;
    const judgeNorm = normalizeJudgeAnswer(rawAnswer);

    if (type === 'judge' || (options.length === 0 && judgeNorm && rawAnswer.length <= 5)) {
      type = 'judge';
      options = [
        { key: '对', text: '正确' },
        { key: '错', text: '错误' }
      ];
      if (judgeNorm) {
        answer = judgeNorm;
      } else if (/^A$/i.test(rawAnswer)) {
        answer = '对';
      } else if (/^B$/i.test(rawAnswer)) {
        answer = '错';
      }
    } else if (options.length > 0) {
      const letters = normalizeOptionAnswerLetters(rawAnswer);
      if (letters) {
        answer = letters;
        if (letters.length > 1) {
          type = 'multiple';
        } else if (type !== 'multiple') {
          type = 'single';
        }
      } else if (rawAnswer) {
        // Maybe answer is the full text of one of the options!
        const matched = options.find((o) => o.text === rawAnswer);
        if (matched) {
          answer = matched.key;
          if (!type) type = 'single';
        } else if (!type) {
          type = 'single';
        }
      } else {
        if (!type) type = 'single';
      }
    } else {
      // No options -> fill or short
      if (!type || type === 'single' || type === 'multiple') {
        if (/_{2,}|（\s*）|\(\s*\)|【\s*】/.test(stem) && answer.length <= 80) {
          type = 'fill';
        } else {
          type = 'short';
        }
      }
    }

    return {
      id: q.id || 'q_' + (idx + 1) + '_' + Math.random().toString(36).slice(2, 7),
      index: idx + 1,
      origNum: q.origNum || null,
      type: type || 'single',
      stem,
      options,
      answer,
      analysis,
      category
    };
  }

  /**
   * Carefully extract an answer embedded inside parentheses in a question stem.
   * E.g. "我国的首都是（ A ）。" -> stem: "我国的首都是（  ）。", answer: "A"
   * Avoids false positives like "关系数据库(RDBMS)的特点是（）".
   */
  function extractEmbeddedAnswerFromStem(stem, options, hintType) {
    if (!stem) return { stem, answer: '' };

    // Find all parenthesized groups
    const parenRegex = /([（(])([^（）()]{1,18})([）)])/g;
    const matches = [];
    let m;
    while ((m = parenRegex.exec(stem)) !== null) {
      matches.push({
        full: m[0],
        open: m[1],
        inner: m[2].trim(),
        close: m[3],
        index: m.index,
        end: m.index + m[0].length
      });
    }
    if (matches.length === 0) return { stem, answer: '' };

    // If there is an empty blank () or （ ） near the end, don't steal an earlier acronym
    const emptyBlankIdx = Math.max(
      stem.lastIndexOf('（）'),
      stem.lastIndexOf('()'),
      stem.search(/[（(]\s+[）)][^（(]*$/)
    );

    const validKeys = new Set((options || []).map((o) => o.key));

    // Scan from the LAST parenthesis backwards
    for (let i = matches.length - 1; i >= 0; i--) {
      const item = matches[i];
      if (emptyBlankIdx > item.index) continue;

      // Case 1: Judge marker inside parens
      const jAns = normalizeJudgeAnswer(item.inner);
      if (jAns && (hintType === 'judge' || options.length === 0)) {
        // Avoid replacing single letter T/F unless at the very end or Chinese judge char
        const isUnambiguous = /[对错正确错误√×是否]/.test(item.inner) || item.end >= stem.length - 2;
        if (isUnambiguous) {
          const newStem = stem.slice(0, item.index) + item.open + '  ' + item.close + stem.slice(item.end);
          return { stem: newStem, answer: jAns, detectedType: 'judge' };
        }
      }

      // Case 2: Option letter(s) inside parens
      if (options.length > 0) {
        const letters = normalizeOptionAnswerLetters(item.inner);
        if (letters) {
          // Verify all letters exist in options
          const allValid = letters.split('').every((ch) => validKeys.has(ch));
          if (allValid) {
            const newStem = stem.slice(0, item.index) + item.open + '  ' + item.close + stem.slice(item.end);
            return {
              stem: newStem,
              answer: letters,
              detectedType: letters.length > 1 ? 'multiple' : 'single'
            };
          }
        }
      }
    }

    return { stem, answer: '' };
  }

  /**
   * Split a line that contains multiple inline options like:
   * "A. 北京  B. 上海  C. 广州  D. 深圳"
   * or "题干内容（  ） A.选项1 B.选项2"
   */
  function splitInlineOptions(line) {
    // Match option markers like A. / A、 / A) / A） / (A) / （A） / A: / A：
    // Must be at start of string OR preceded by whitespace/punctuation
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

    // Validate hit sequence: first hit can be anywhere if there are >= 2 sequential letters (e.g. A..B)
    // OR single hit starting at index 0
    const filtered = [];
    for (let i = 0; i < hits.length; i++) {
      const curr = hits[i];
      if (filtered.length === 0) {
        // Accept first hit if at line start OR followed by next sequential letter
        const next = hits[i + 1];
        if (curr.markerStart === 0) {
          filtered.push(curr);
        } else if (next && next.letter.charCodeAt(0) === curr.letter.charCodeAt(0) + 1 && curr.letter === 'A') {
          filtered.push(curr);
        }
      } else {
        const prev = filtered[filtered.length - 1];
        if (curr.letter.charCodeAt(0) > prev.letter.charCodeAt(0)) {
          filtered.push(curr);
        }
      }
    }

    if (filtered.length === 0) return null;
    if (filtered.length === 1 && filtered[0].markerStart > 0) return null;

    const prefix = line.slice(0, filtered[0].markerStart).trim();
    const options = [];
    for (let i = 0; i < filtered.length; i++) {
      const start = filtered[i].contentStart;
      const end = i + 1 < filtered.length ? filtered[i + 1].markerStart : line.length;
      const text = line.slice(start, end).trim();
      options.push({ key: filtered[i].letter, text });
    }

    return { prefix, options };
  }

  /**
   * Parse a combined options string (e.g. from a single Excel/CSV cell).
   */
  function parseCombinedOptions(raw) {
    const text = normalizeText(raw);
    if (!text) return [];

    // Try line-by-line first
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      const split = splitInlineOptions(line);
      if (split && split.options.length > 0) {
        out.push(...split.options);
      } else if (out.length > 0) {
        out[out.length - 1].text += ' ' + line;
      }
    }
    if (out.length >= 2) return out;

    // Try splitting by | or ; if no A./B. prefixes
    const parts = text.split(/\s*[|｜;；]\s*/).filter(Boolean);
    if (parts.length >= 2) {
      return parts.map((p, i) => ({
        key: OPTION_LETTERS[i] || String(i + 1),
        text: stripOptionPrefix(p)
      }));
    }
    return [];
  }

  /**
   * Extract a trailing answer-key section from raw text, e.g.:
   * 参考答案：
   * 1.A 2.B 3.CD 4.√ 5.×
   * or: 1-5 ABCDA 6-10 BCDAA
   */
  function extractTrailingAnswerKey(text) {
    const lines = text.split('\n');
    let keyHeaderIdx = -1;

    // Look in the second half (or anywhere after at least 3 lines) for an answer-key header
    for (let i = lines.length - 1; i >= 3; i--) {
      const line = lines[i].trim();
      if (/^(?:【?\s*(?:参考答案|标准答案|答案汇总|答案与解析|参考答案及解析|附[：:]?\s*参考?答案|Answers?)\s*】?[：:\s]*)$/i.test(line)) {
        keyHeaderIdx = i;
        break;
      }
    }

    if (keyHeaderIdx === -1) {
      return { bodyText: text, answerMap: new Map(), analysisMap: new Map() };
    }

    const bodyLines = lines.slice(0, keyHeaderIdx);
    const tailLines = lines.slice(keyHeaderIdx + 1);
    const tailText = tailLines.join('\n').trim();

    if (!tailText) {
      return { bodyText: text, answerMap: new Map(), analysisMap: new Map() };
    }

    const answerMap = new Map();
    const analysisMap = new Map();

    // Pattern 1: Range syntax "1-5: ABCDA" or "1~5 A B C D A"
    const rangeRe = /(\d+)\s*[-~—–至到]\s*(\d+)\s*[.、:：\s]\s*([A-H\s√×对错TF]+)/gi;
    let rm;
    let rangeFound = false;
    while ((rm = rangeRe.exec(tailText)) !== null) {
      const start = parseInt(rm[1], 10);
      const end = parseInt(rm[2], 10);
      const tokens = rm[3].replace(/\s+/g, '').split('');
      if (end >= start && tokens.length === end - start + 1) {
        rangeFound = true;
        for (let k = 0; k < tokens.length; k++) {
          answerMap.set(start + k, tokens[k]);
        }
      }
    }

    // Pattern 2: Numbered answers "1.A 2.BC 3.对" or line-by-line "1. A 解析：..."
    if (!rangeFound || answerMap.size < 2) {
      // Try compact inline numbered pairs: 1.A  2.B  3.CD  4.√
      const compactRe = /(?:^|[\s,，;；])(\d{1,4})\s*[.、:：\)）]\s*([A-H]{1,6}|对|错|正确|错误|√|×|T|F)(?=$|[\s,，;；\n])/gi;
      let cm;
      while ((cm = compactRe.exec(tailText)) !== null) {
        const num = parseInt(cm[1], 10);
        if (!answerMap.has(num)) {
          answerMap.set(num, cm[2].trim());
        }
      }

      // Also parse line-by-line numbered answers (supports fill/short answers & analysis)
      for (const line of tailLines) {
        const t = line.trim();
        const lm = /^(\d{1,4})\s*[.、:：\)）]\s*(.+)$/.exec(t);
        if (lm) {
          const num = parseInt(lm[1], 10);
          let rest = lm[2].trim();
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

    // Only strip the tail if we actually parsed answers from it
    if (answerMap.size >= 1) {
      return { bodyText: bodyLines.join('\n'), answerMap, analysisMap };
    }
    return { bodyText: text, answerMap: new Map(), analysisMap: new Map() };
  }

  /**
   * Smart parser for plain text / Markdown / Word paragraphs / Pasted text.
   */
  function parseText(rawInput) {
    const cleaned = normalizeText(rawInput);
    if (!cleaned) {
      return { questions: [], warnings: ['输入内容为空'] };
    }

    const { bodyText, answerMap, analysisMap } = extractTrailingAnswerKey(cleaned);
    const lines = bodyText.split('\n');

    const rawQuestions = [];
    let current = null;
    let state = 'idle'; // 'stem' | 'options' | 'answer' | 'analysis'
    let sectionType = null;
    let sectionCategory = '';

    const pushCurrent = () => {
      if (current && current.stem.trim()) {
        rawQuestions.push(current);
      }
      current = null;
      state = 'idle';
    };

    // Detect section header lines like "一、单选题", "## 多选题", "三、判断题（每题1分）"
    const sectionRe = /^(?:#{1,4}\s*)?(?:[一二三四五六七八九十]+[、.．\s]|第[一二三四五六七八九十\d]+[部分章节篇]\s*|Part\s*\d+[:.\s]+|【)(.{1,40})$/i;

    // Detect question start lines: "1. ...", "1、...", "(1) ...", "第1题 ...", "Q1: ...", "题目：..."
    const qStartRe = /^(?:(?:第\s*(\d{1,4})\s*题\s*[.、:：]?)|(?:[\(（【\[](\d{1,4})[\)）】\]]\s*[.、:：]?)|(?:[Qq](\d{1,4})\s*[.、:：\)）])|(?:(\d{1,4})\s*[.、\)）])|(?:(\d{1,4})\s+(?=\S))|(?:(?:【?题目】?|题干|问题|问)[：:]))\s*(.*)$/;

    // Explicit answer / analysis / type / category tags
    const answerLineRe = /^(?:【?\s*(?:正确|参考|标准)?答案\s*】?|答|Answer|Ans)\s*[：:=]?\s*(.*)$/i;
    const analysisLineRe = /^(?:【?\s*(?:答案|题目|试题)?(?:解析|分析|解释|详解|点评)\s*】?|Explanation|Analysis)\s*[：:=]?\s*(.*)$/i;
    const categoryLineRe = /^(?:【?\s*(?:章节|分类|知识点|考点|标签)\s*】?|Category|Tag)\s*[：:]\s*(.+)$/i;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();

      if (!line) {
        // Blank line: if in analysis or answer, don't immediately close unless next line starts a new question
        continue;
      }

      // Skip markdown horizontal rules
      if (/^[-*_]{3,}$/.test(line)) continue;

      // 1. Check Section Header
      const secMatch = sectionRe.exec(line);
      if (secMatch && !/^【\s*(?:答案|解析|单选|多选|判断|填空|简答)/.test(line)) {
        const detected = detectTypeFromLabel(line);
        if (detected || /^#{1,4}\s/.test(line) || /^[一二三四五六七八九十]+[、.]/.test(line)) {
          if (line.length <= 45 && !/[？?]$/.test(line)) {
            pushCurrent();
            if (detected) sectionType = detected;
            sectionCategory = line.replace(/^#{1,4}\s*/, '').replace(/[（(][^）)]*[）)]$/, '').trim();
            continue;
          }
        }
      }

      // 2. Check explicit Analysis line
      const anaMatch = analysisLineRe.exec(line);
      if (anaMatch && current) {
        const content = anaMatch[1].trim();
        current.analysis = current.analysis ? current.analysis + '\n' + content : content;
        state = 'analysis';
        continue;
      }

      // 3. Check explicit Answer line (may also contain inline 解析：)
      const ansMatch = answerLineRe.exec(line);
      if (ansMatch && current) {
        let rest = ansMatch[1].trim();
        // Check if "解析：" is on the same line
        const inlineAna = /^(.*?)\s*(?:【?\s*(?:答案)?(?:解析|分析|解释)\s*】?)\s*[：:]\s*(.+)$/.exec(rest);
        if (inlineAna) {
          rest = inlineAna[1].trim();
          current.analysis = current.analysis ? current.analysis + '\n' + inlineAna[2].trim() : inlineAna[2].trim();
          state = 'analysis';
        } else {
          state = 'answer';
        }
        if (rest) {
          current.answer = current.answer ? current.answer + '\n' + rest : rest;
        }
        continue;
      }

      // 4. Check explicit Category line
      const catMatch = categoryLineRe.exec(line);
      if (catMatch && current) {
        current.category = catMatch[1].trim();
        continue;
      }

      // 5. Check Question Start
      const qMatch = qStartRe.exec(line);
      if (qMatch) {
        const numStr = qMatch[1] || qMatch[2] || qMatch[3] || qMatch[4] || qMatch[5] || null;
        let rest = (qMatch[6] || '').trim();

        // Guard against false positive like "2025 年..." or "100 元" inside an existing stem/analysis
        const numVal = numStr ? parseInt(numStr, 10) : null;
        const looksLikeYearOrUnit =
          qMatch[5] && (numVal > 1900 || /^[年个月日天元%％米克秒小时分钟万亿]/.test(rest));

        if (!looksLikeYearOrUnit) {
          pushCurrent();

          // Detect inline type prefix like "[多选题]" or "（判断题）" at start of stem
          let qType = sectionType;
          const typePrefixRe = /^[【\[\(（]\s*(单选题?|多选题?|不定项选择题?|判断题?|填空题?|简答题?|问答题?|论述题?|名词解释)\s*[】\]\)）]\s*/;
          const tpMatch = typePrefixRe.exec(rest);
          if (tpMatch) {
            qType = detectTypeFromLabel(tpMatch[1]) || qType;
            rest = rest.slice(tpMatch[0].length).trim();
          }

          current = {
            origNum: numVal,
            type: qType,
            stem: '',
            options: [],
            answer: '',
            analysis: '',
            category: sectionCategory
          };

          // Check if options are inline on the exact same line as the stem!
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

      // 6. Check Options (if we have an active question and not already in analysis)
      if (current && state !== 'analysis') {
        const optSplit = splitInlineOptions(line);
        if (optSplit && optSplit.options.length > 0 && !optSplit.prefix) {
          current.options.push(...optSplit.options);
          state = 'options';
          continue;
        }
      }

      // 7. Continuation lines
      if (!current) {
        // Start an unnumbered question if user pasted raw text without question numbers
        let rest = line;
        let qType = sectionType;
        const typePrefixRe = /^[【\[\(（]\s*(单选题?|多选题?|判断题?|填空题?|简答题?)\s*[】\]\)）]\s*/;
        const tpMatch = typePrefixRe.exec(rest);
        if (tpMatch) {
          qType = detectTypeFromLabel(tpMatch[1]) || qType;
          rest = rest.slice(tpMatch[0].length).trim();
        }
        current = {
          origNum: null,
          type: qType,
          stem: rest,
          options: [],
          answer: '',
          analysis: '',
          category: sectionCategory
        };
        state = 'stem';
      } else if (state === 'analysis') {
        current.analysis += '\n' + line;
      } else if (state === 'answer') {
        current.answer += '\n' + line;
      } else if (state === 'options' && current.options.length > 0) {
        // Check if this looks like a new unnumbered question (previous line was blank and this doesn't look like option continuation)
        const prevBlank = i > 0 && !lines[i - 1].trim();
        if (prevBlank && current.options.length >= 2 && (current.answer || /[？?（）()]$/.test(line))) {
          pushCurrent();
          current = {
            origNum: null,
            type: sectionType,
            stem: line,
            options: [],
            answer: '',
            analysis: '',
            category: sectionCategory
          };
          state = 'stem';
        } else {
          current.options[current.options.length - 1].text += '\n' + line;
        }
      } else {
        // Stem continuation — check if inline options appeared on continuation line
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

    // Attach trailing answer key if available
    if (answerMap.size > 0) {
      rawQuestions.forEach((q, idx) => {
        const lookupKey = q.origNum != null && answerMap.has(q.origNum) ? q.origNum : idx + 1;
        if (!q.answer && answerMap.has(lookupKey)) {
          q.answer = answerMap.get(lookupKey);
        }
        if (!q.analysis && analysisMap.has(lookupKey)) {
          q.analysis = analysisMap.get(lookupKey);
        }
      });
    }

    const questions = rawQuestions.map((q, idx) => finalizeQuestion(q, idx));
    return buildParseResult(questions);
  }

  /**
   * RFC-4180 compliant CSV / TSV parser.
   */
  function parseCsvRows(text) {
    const normalized = text.replace(/\r\n?/g, '\n');
    // Auto-detect delimiter from first non-empty line
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
      } else {
        if (ch === '"' && field === '') {
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
    }
    row.push(field.trim());
    if (row.some((c) => c !== '')) rows.push(row);

    const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    for (const r of rows) {
      while (r.length < maxCols) r.push('');
    }
    return rows;
  }

  /**
   * Auto-detect header row and column mapping for tabular data (Excel / CSV / Word Table).
   */
  function autoDetectTableMapping(rows) {
    if (!rows || rows.length === 0) {
      return { headerRowIndex: -1, headers: [], mapping: {} };
    }

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

    function scoreRow(row) {
      let score = 0;
      const map = {
        type: -1,
        stem: -1,
        optionsCombined: -1,
        options: {},
        answer: -1,
        analysis: -1,
        category: -1
      };

      row.forEach((rawCell, idx) => {
        const cell = String(rawCell || '').replace(/\s+/g, ' ').trim();
        if (!cell) return;

        for (const om of optMatchers) {
          if (om.re.test(cell)) {
            if (map.options[om.letter] === undefined) {
              map.options[om.letter] = idx;
              score += 2;
            }
            return;
          }
        }
        for (const key of Object.keys(matchers)) {
          if (matchers[key].test(cell)) {
            if (map[key] === -1) {
              map[key] = idx;
              score += key === 'stem' || key === 'answer' ? 4 : 2;
            }
            return;
          }
        }
        // Fuzzy fallback for headers like "题干(必填)" or "选项A（必填）"
        const cleaned = cell.replace(/[（(【\[][^）)\]】]*[）)\]】]/g, '').trim();
        for (const om of optMatchers) {
          if (om.re.test(cleaned) && map.options[om.letter] === undefined) {
            map.options[om.letter] = idx;
            score += 1.5;
            return;
          }
        }
        for (const key of Object.keys(matchers)) {
          if (matchers[key].test(cleaned) && map[key] === -1) {
            map[key] = idx;
            score += 1.5;
            return;
          }
        }
      });

      return { score, map };
    }

    let bestRowIdx = -1;
    let bestScore = 0;
    let bestMap = null;

    const scanLimit = Math.min(rows.length, 6);
    for (let r = 0; r < scanLimit; r++) {
      const { score, map } = scoreRow(rows[r]);
      if (score > bestScore) {
        bestScore = score;
        bestRowIdx = r;
        bestMap = map;
      }
    }

    // If no clear header found, guess by column content (headerless sheet)
    if (bestScore < 4 || !bestMap || bestMap.stem === -1) {
      const colCount = rows[0].length;
      const headers = Array.from({ length: colCount }, (_, i) => '第 ' + (i + 1) + ' 列');
      const guessed = {
        type: -1,
        stem: 0,
        optionsCombined: -1,
        options: {},
        answer: -1,
        analysis: -1,
        category: -1
      };

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
      const fillRatios = nonEmpty.map((n) => n / sampleRows.length);
      const isMostlyEmpty = (c) => fillRatios[c] < 0.08;
      const isIndexCol = (c) => nonEmpty[c] > 0 && indexHits[c] >= nonEmpty[c] * 0.8;

      // 1. Identify answer column first
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

      // 2. Identify type column
      for (let c = 0; c < colCount; c++) {
        if (c === guessed.answer || isMostlyEmpty(c) || isIndexCol(c)) continue;
        if (typeHits[c] >= Math.max(2, nonEmpty[c] * 0.5)) {
          guessed.type = c;
          break;
        }
      }

      // 3. Identify stem column: prefers high distinctness + long average length + early position
      let bestStemCol = -1;
      let bestStemScore = -1;
      for (let c = 0; c < colCount; c++) {
        if (c === guessed.answer || c === guessed.type || isMostlyEmpty(c) || isIndexCol(c)) continue;
        // Skip columns after answer unless nothing before answer exists
        if (guessed.answer !== -1 && c > guessed.answer && bestStemCol !== -1) continue;
        const distinctRatio = nonEmpty[c] > 0 ? distinctSets[c].size / nonEmpty[c] : 0;
        const stemScore = avgLens[c] * (0.4 + 0.6 * distinctRatio) * (c <= 2 ? 1.25 : 1);
        if (stemScore > bestStemScore) {
          bestStemScore = stemScore;
          bestStemCol = c;
        }
      }
      guessed.stem = bestStemCol !== -1 ? bestStemCol : 0;

      // 4. Columns between stem and answer (that are not mostly empty) -> options A, B, C, D...
      let optIdx = 0;
      const optEnd = guessed.answer !== -1 ? guessed.answer : colCount;
      for (let c = guessed.stem + 1; c < optEnd; c++) {
        if (c === guessed.type || isMostlyEmpty(c)) continue;
        if (optIdx < OPTION_LETTERS.length) {
          guessed.options[OPTION_LETTERS[optIdx++]] = c;
        }
      }

      // 5. Non-empty columns after answer -> category (repeated/chapter-like) vs analysis
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

  /**
   * Convert 2D rows to questions using a detected or user-adjusted column mapping.
   */
  function parseTableWithMapping(rows, mapping, headerRowIndex) {
    const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
    const rawQuestions = [];

    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r];
      const stem = mapping.stem >= 0 ? (row[mapping.stem] || '').trim() : '';
      if (!stem) continue;

      const typeLabel = mapping.type >= 0 ? row[mapping.type] : '';
      let type = detectTypeFromLabel(typeLabel);

      let options = [];
      // Separate option columns A..H
      for (const letter of OPTION_LETTERS) {
        const col = mapping.options && mapping.options[letter];
        if (col !== undefined && col >= 0) {
          const val = (row[col] || '').trim();
          if (val) {
            options.push({ key: letter, text: val });
          }
        }
      }

      // Combined options column fallback
      if (options.length === 0 && mapping.optionsCombined >= 0) {
        options = parseCombinedOptions(row[mapping.optionsCombined] || '');
      }

      let stemText = stem;

      // Inline options inside stem cell fallback
      if (options.length === 0) {
        const lines = stemText.split('\n');
        if (lines.length > 1) {
          const extractedOpts = [];
          const stemLines = [];
          for (const ln of lines) {
            const sp = splitInlineOptions(ln.trim());
            if (sp && sp.options.length > 0 && !sp.prefix) {
              extractedOpts.push(...sp.options);
            } else {
              stemLines.push(ln);
            }
          }
          if (extractedOpts.length >= 2) {
            options = extractedOpts;
            stemText = stemLines.join('\n').trim();
          }
        }
      }

      const answer = mapping.answer >= 0 ? (row[mapping.answer] || '').trim() : '';
      const analysis = mapping.analysis >= 0 ? (row[mapping.analysis] || '').trim() : '';
      const category = mapping.category >= 0 ? (row[mapping.category] || '').trim() : '';

      rawQuestions.push({
        type,
        stem: stemText,
        options,
        answer,
        analysis,
        category
      });
    }

    const questions = rawQuestions.map((q, idx) => finalizeQuestion(q, idx));
    return buildParseResult(questions);
  }

  /**
   * Parse JSON question banks (supports multiple popular GitHub formats).
   */
  function parseJson(rawText) {
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      throw new Error('JSON 格式错误：' + e.message);
    }

    let list = null;
    if (Array.isArray(data)) {
      list = data;
    } else if (data && typeof data === 'object') {
      list = data.questions || data.list || data.data || data.items || data.problems || data.bank || null;
      if (!Array.isArray(list)) {
        // Some formats wrap banks by category key
        const vals = Object.values(data).filter((v) => Array.isArray(v));
        if (vals.length > 0) list = vals.flat();
      }
    }

    if (!Array.isArray(list)) {
      throw new Error('JSON 中未找到题目数组（支持直接数组，或包含 questions / data / list 字段的对象）');
    }

    const rawQuestions = list
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const stem =
          item.stem ||
          item.question ||
          item.title ||
          item.content ||
          item.problem ||
          item['题目'] ||
          item['题干'] ||
          item['问题'] ||
          '';
        if (!String(stem).trim()) return null;

        let options = [];
        const rawOpts = item.options || item.choices || item.select || item['选项'];
        if (Array.isArray(rawOpts)) {
          options = rawOpts.map((o, i) => {
            if (typeof o === 'string') {
              return { key: OPTION_LETTERS[i] || String(i + 1), text: o };
            }
            return {
              key: o.key || o.label || o.id || OPTION_LETTERS[i] || String(i + 1),
              text: o.text || o.content || o.value || o.label || ''
            };
          });
        } else if (rawOpts && typeof rawOpts === 'object') {
          for (const [k, v] of Object.entries(rawOpts)) {
            if (v !== undefined && v !== null && String(v).trim() !== '') {
              options.push({ key: k.toUpperCase(), text: String(v) });
            }
          }
        } else if (typeof rawOpts === 'string') {
          options = parseCombinedOptions(rawOpts);
        } else {
          // Flat option keys: A/B/C/D or optionA/optionB or 选项A/选项B
          for (const letter of OPTION_LETTERS) {
            const val =
              item[letter] ??
              item[letter.toLowerCase()] ??
              item['option' + letter] ??
              item['Option' + letter] ??
              item['选项' + letter];
            if (val !== undefined && val !== null && String(val).trim() !== '') {
              options.push({ key: letter, text: String(val) });
            }
          }
        }

        let answer =
          item.answer ??
          item.ans ??
          item.correct ??
          item.correctAnswer ??
          item.rightAnswer ??
          item.key ??
          item['答案'] ??
          item['正确答案'] ??
          item['参考答案'] ??
          '';
        if (Array.isArray(answer)) {
          answer = answer.join('');
        } else if (typeof answer === 'boolean') {
          answer = answer ? '对' : '错';
        }

        const analysis =
          item.analysis ||
          item.explanation ||
          item.explain ||
          item.note ||
          item['解析'] ||
          item['答案解析'] ||
          item['分析'] ||
          '';

        const category =
          item.category ||
          item.chapter ||
          item.tag ||
          item.subject ||
          item['章节'] ||
          item['分类'] ||
          '';

        const type = detectTypeFromLabel(item.type || item.qtype || item['题型'] || item['类型']);

        return {
          id: item.id,
          type,
          stem: String(stem),
          options,
          answer: String(answer),
          analysis: String(analysis),
          category: String(category)
        };
      })
      .filter(Boolean);

    const questions = rawQuestions.map((q, idx) => finalizeQuestion(q, idx));
    return buildParseResult(questions);
  }

  /**
   * Build stats & helpful warnings for the import preview screen.
   */
  function buildParseResult(questions) {
    const counts = { single: 0, multiple: 0, judge: 0, fill: 0, short: 0 };
    let missingAnswer = 0;

    for (const q of questions) {
      counts[q.type] = (counts[q.type] || 0) + 1;
      if (!q.answer) missingAnswer++;
    }

    const warnings = [];
    if (questions.length === 0) {
      warnings.push('未能解析出任何题目，请检查文件格式或尝试手动调整列映射 / 复制文本粘贴解析');
    } else if (missingAnswer > 0) {
      warnings.push(`有 ${missingAnswer} 道题未识别到标准答案（导入后可在题库管理中补充，或在背题模式直接查看）`);
    }

    return {
      questions,
      stats: {
        total: questions.length,
        counts,
        missingAnswer
      },
      warnings
    };
  }

  /**
   * High-level file parser returning either direct parsed result OR tabular data with auto-mapping.
   */
  async function parseUploadedFile(file) {
    const name = file.name || '未命名题库';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const baseName = name.replace(/\.[^.]+$/, '');

    if (ext === 'json') {
      const text = global.OfflineDocReader.decodeSmartText(await file.arrayBuffer());
      const res = parseJson(text);
      return { kind: 'direct', bankName: baseName, ...res };
    }

    if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
      const text = global.OfflineDocReader.decodeSmartText(await file.arrayBuffer());
      const res = parseText(text);
      return { kind: 'direct', bankName: baseName, ...res };
    }

    if (ext === 'csv' || ext === 'tsv') {
      const text = global.OfflineDocReader.decodeSmartText(await file.arrayBuffer());
      const rows = parseCsvRows(text);
      const detected = autoDetectTableMapping(rows);
      const res = parseTableWithMapping(rows, detected.mapping, detected.headerRowIndex);
      return {
        kind: 'table',
        bankName: baseName,
        sheets: [{ name: 'CSV 表格', rows }],
        activeSheetIndex: 0,
        ...detected,
        ...res
      };
    }

    if (ext === 'xlsx') {
      const { sheets } = await global.OfflineDocReader.parseXlsx(await file.arrayBuffer());
      // Pick first non-empty sheet
      let activeIdx = sheets.findIndex((s) => s.rows.length > 0);
      if (activeIdx === -1) activeIdx = 0;
      const rows = sheets[activeIdx].rows;
      const detected = autoDetectTableMapping(rows);
      const res = parseTableWithMapping(rows, detected.mapping, detected.headerRowIndex);
      return {
        kind: 'table',
        bankName: baseName,
        sheets,
        activeSheetIndex: activeIdx,
        ...detected,
        ...res
      };
    }

    if (ext === 'docx') {
      const doc = await global.OfflineDocReader.parseDocx(await file.arrayBuffer());
      // Check if DOCX is mainly a structured table
      const allTableRows = [];
      for (const tbl of doc.tables) {
        if (tbl.length >= 2 && tbl[0].length >= 2) {
          allTableRows.push(...tbl);
        }
      }

      const textRes = doc.text.trim() ? parseText(doc.text) : buildParseResult([]);
      let tableRes = null;
      let tableDetected = null;

      if (allTableRows.length >= 2) {
        tableDetected = autoDetectTableMapping(allTableRows);
        tableRes = parseTableWithMapping(allTableRows, tableDetected.mapping, tableDetected.headerRowIndex);
      }

      // Choose whichever parsed more valid questions (or merge if both have questions)
      if (tableRes && tableRes.questions.length > textRes.questions.length) {
        return {
          kind: 'table',
          bankName: baseName,
          sheets: [{ name: 'Word 表格', rows: allTableRows }],
          activeSheetIndex: 0,
          ...tableDetected,
          ...tableRes
        };
      }
      if (tableRes && tableRes.questions.length > 0 && textRes.questions.length > 0) {
        const merged = textRes.questions.concat(tableRes.questions).map((q, idx) => ({
          ...q,
          index: idx + 1
        }));
        return { kind: 'direct', bankName: baseName, ...buildParseResult(merged) };
      }
      return { kind: 'direct', bankName: baseName, ...textRes };
    }

    if (ext === 'xls' || ext === 'doc') {
      throw new Error(
        `暂不支持旧版二进制 .${ext} 格式。请用 WPS / Office / Numbers 打开该文件，选择「另存为」新版 .${ext}x（或 .csv），然后重新上传！`
      );
    }

    if (ext === 'pdf') {
      throw new Error(
        'PDF 排版差异较大，离线精准解析建议：打开 PDF → 全选复制文字 (Cmd+A, Cmd+C) → 粘贴到右侧「智能文本粘贴」框中，3 秒即可智能识别所有题型！'
      );
    }

    // Unknown extension -> try reading as plain text
    const fallbackText = global.OfflineDocReader.decodeSmartText(await file.arrayBuffer());
    const res = parseText(fallbackText);
    return { kind: 'direct', bankName: baseName, ...res };
  }

  /**
   * Grade a user's submitted answer against a question.
   */
  function checkAnswer(question, userAnswer) {
    if (!question.answer) {
      return { isCorrect: null, noKey: true };
    }
    const type = question.type;
    if (type === 'single' || type === 'multiple') {
      const expected = normalizeOptionAnswerLetters(question.answer) || question.answer.trim().toUpperCase();
      const given = normalizeOptionAnswerLetters(userAnswer) || String(userAnswer || '').trim().toUpperCase();
      return { isCorrect: expected === given, expected, given };
    }
    if (type === 'judge') {
      const expected = normalizeJudgeAnswer(question.answer) || question.answer.trim();
      const given = normalizeJudgeAnswer(userAnswer) || String(userAnswer || '').trim();
      return { isCorrect: expected === given, expected, given };
    }
    if (type === 'fill') {
      const norm = (s) =>
        String(s || '')
          .trim()
          .toLowerCase()
          .replace(/[\s，,、；;。．.]+/g, ' ');
      const given = norm(userAnswer);
      // Support multiple acceptable answers separated by | or /
      const candidates = String(question.answer)
        .split(/[|｜]/)
        .map(norm)
        .filter(Boolean);
      const isCorrect = candidates.some((c) => c === given);
      return { isCorrect, expected: question.answer, given: userAnswer };
    }
    // short answer is self-graded by the user
    return { isCorrect: null, selfGrade: true, expected: question.answer, given: userAnswer };
  }

  /**
   * Detect whether pasted text is structured CSV / TSV (e.g. copied from Excel or CSV file).
   */
  function looksLikeCsvText(rawText) {
    const lines = String(rawText || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return false;

    const sample = lines.slice(0, Math.min(lines.length, 15));
    // If lines clearly look like A./B./C./D. options, it's plain text, not CSV
    const optLineCount = sample.filter((l) => /^[A-H]\s*[.、)）:：]/.test(l)).length;
    if (optLineCount >= 2) return false;

    const tabLines = sample.filter((l) => (l.match(/\t/g) || []).length >= 3).length;
    if (tabLines >= Math.ceil(sample.length * 0.7)) return true;

    const commaLines = sample.filter((l) => (l.match(/,/g) || []).length >= 4).length;
    if (commaLines >= Math.ceil(sample.length * 0.7)) return true;

    return false;
  }

  global.QuestionParser = {
    TYPE_LABELS,
    OPTION_LETTERS,
    parseText,
    parseJson,
    parseCsvRows,
    looksLikeCsvText,
    autoDetectTableMapping,
    parseTableWithMapping,
    parseUploadedFile,
    finalizeQuestion,
    checkAnswer,
    normalizeJudgeAnswer,
    normalizeOptionAnswerLetters
  };
})(typeof window !== 'undefined' ? window : globalThis);
