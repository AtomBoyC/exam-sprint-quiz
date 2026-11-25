/**
 * ExamSprint Studio · Desktop & Web Core Application
 * Zero external dependencies · Offline-First · SM-2 Spaced Repetition · GitHub Gist Sync
 */
(function () {
  'use strict';

  const { QuestionParser, SrsAndMerge, QuizStorage } = window;
  const TYPE_LABELS = QuestionParser.TYPE_LABELS;
  const OPTION_LETTERS = QuestionParser.OPTION_LETTERS;

  const MODE_META = {
    practice: { label: '📖 顺序精刷', badge: 'pill-blue' },
    sprint: { label: '⚔️ 斩杀冲刺', badge: 'pill-purple' },
    due: { label: '🧠 艾宾浩斯复习', badge: 'pill-indigo' },
    random: { label: '🔀 随机乱序', badge: 'pill-blue' },
    recite: { label: '⚡ 极速背题', badge: 'pill-amber' },
    wrong: { label: '🎯 错题攻坚', badge: 'pill-red' },
    bookmark: { label: '⭐ 重点收藏', badge: 'pill-amber' },
    exam: { label: '⏱️ 全真模拟考', badge: 'pill-green' },
    'exam-review': { label: '📊 模考复盘', badge: 'pill-indigo' }
  };

  const STAGE_META = {
    new: { label: '新题', badge: 'pill-gray', color: '#94a3b8' },
    learning: { label: '学习中', badge: 'pill-blue', color: '#3b82f6' },
    due: { label: '待复习', badge: 'pill-amber', color: '#f59e0b' },
    consolidated: { label: '记忆稳固', badge: 'pill-green', color: '#10b981' },
    mastered: { label: '已斩杀', badge: 'pill-purple', color: '#7c3aed' }
  };

  const state = {
    banks: [],
    deletedBanks: {},
    recordsByBank: {},
    dailyStats: {},
    examHistory: [],
    settings: { ...QuizStorage.DEFAULT_SETTINGS },
    activeBankId: null,
    currentView: 'home',

    zenMode: false,
    savedSession: null,
    session: null,
    autoNextTimer: null,
    examTimerInterval: null,
    gistDebounceTimer: null,
    syncBusy: false,

    lastExamResult: null,
    importDraft: null,
    manageRenderLimit: 50,
    editingQuestionId: null
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(msg, type = 'info') {
    const container = $('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'success' ? ' toast-success' : type === 'error' ? ' toast-error' : '');
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      el.style.transition = 'all 0.2s';
      setTimeout(() => el.remove(), 220);
    }, 2600);
  }

  function shuffleArray(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ==================== SUBTLE WEB AUDIO FEEDBACK ====================
  let audioCtx = null;
  function playFeedbackChime(isCorrect) {
    if (!state.settings.soundEnabled) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (isCorrect) {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.07); // A5
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      } else {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.setValueAtTime(190, now + 0.09);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.start(now);
        osc.stop(now + 0.24);
      }
    } catch (_) {}
  }

  // ==================== DATA ACCESSORS ====================
  function getActiveBank() {
    if (!state.activeBankId) return state.banks[0] || null;
    return state.banks.find((b) => b.id === state.activeBankId) || state.banks[0] || null;
  }

  function getBankRecords(bankId) {
    if (!bankId) return {};
    if (!state.recordsByBank[bankId]) state.recordsByBank[bankId] = {};
    return state.recordsByBank[bankId];
  }

  function getQuestionRecord(bankId, qId) {
    const map = getBankRecords(bankId);
    if (!map[qId]) map[qId] = SrsAndMerge.createEmptyRecord();
    return map[qId];
  }

  function recordDailyActivity(isCorrect) {
    const key = SrsAndMerge.getLocalDateKey();
    if (!state.dailyStats[key]) state.dailyStats[key] = { answered: 0, correct: 0 };
    state.dailyStats[key].answered += 1;
    if (isCorrect) state.dailyStats[key].correct += 1;
    QuizStorage.saveDailyStats(state.dailyStats);
  }

  // ==================== BUILT-IN DEMO BANK ====================
  function createDemoQuestions() {
    return QuestionParser.parseJson(
      JSON.stringify([
        {
          type: 'single',
          category: '第一章 计算机网络体系',
          stem: '浏览器访问 HTTPS 加密网站时，默认使用的传输层 TCP 端口号是？',
          options: ['21', '22', '80', '443'],
          answer: 'D',
          analysis: 'HTTP 默认端口为 80，HTTPS 默认端口为 443，FTP 控制端口为 21，SSH 为 22。'
        },
        {
          type: 'single',
          category: '第一章 计算机网络体系',
          stem: '在 OSI 七层参考模型中，负责路由选择与分组转发的是哪一层？',
          options: ['物理层', '数据链路层', '网络层', '传输层'],
          answer: 'C',
          analysis: '网络层（IP 协议、路由器）负责逻辑寻址、路由选择与跨网段分组转发。'
        },
        {
          type: 'multiple',
          category: '第二章 操作系统核心',
          stem: '产生操作系统“死锁（Deadlock）”的四个必要条件包括？',
          options: ['互斥条件', '请求和保持条件', '不剥夺条件', '循环等待条件'],
          answer: 'ABCD',
          analysis: '死锁四大必要条件缺一不可：互斥、请求与保持、不可剥夺、循环等待。破坏任一条件即可预防死锁。'
        },
        {
          type: 'judge',
          category: '第二章 操作系统核心',
          stem: '队列（Queue）是一种“后进先出（LIFO）”的线性数据结构。',
          answer: '错',
          analysis: '队列是先进先出（FIFO），栈（Stack）才是后进先出（LIFO）。'
        },
        {
          type: 'single',
          category: '第三章 算法与数据结构',
          stem: '在长度为 n 的有序顺序表上进行二分查找，最坏情况下的时间复杂度为？',
          options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
          answer: 'B',
          analysis: '每次比较将查找区间减半，最多比较 ⌊log2(n)⌋ + 1 次，时间复杂度为 O(log n)。'
        },
        {
          type: 'fill',
          category: '第一章 计算机网络体系',
          stem: '将域名（如 github.com）解析为 IP 地址的应用层协议英文缩写是 ______。',
          answer: 'DNS|域名系统',
          analysis: 'DNS（Domain Name System）负责域名与 IP 地址之间的映射解析。'
        },
        {
          type: 'short',
          category: '第三章 算法与数据结构',
          stem: '简述数据备份“3-2-1”黄金原则的具体含义。',
          answer: '至少保存 3 份数据副本，使用 2 种不同存储介质，其中至少 1 份异地离线保存。',
          analysis: '核心采分点：3份副本、2种不同介质、1份异地/离线隔离（有效抵御勒索软件与机房灾害）。'
        }
      ])
    ).questions;
  }

  const SAMPLE_PASTE_TEXT = `一、单选题
1. 我国的根本大法是（ A ）。
A. 宪法  B. 民法典  C. 刑法  D. 行政法
解析：宪法具有最高的法律效力。

二、多选题
2. 以下属于常见前端核心技术的有（）
A. HTML
B. CSS
C. JavaScript
D. MySQL
答案：ABC
解析：MySQL 属于后端关系型数据库管理系统。

三、判断题
3. 二进制数 1010 转换为十进制数是 10。（对）

四、填空题
4. 操作系统中，资源分配的基本单位是进程，CPU 调度的基本单位是 ______。
答案：线程`;

  // ==================== THEME & NAVIGATION ====================
  function applySettingsToDOM() {
    const theme = state.settings.theme || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-font', state.settings.fontSize || 'md');

    document.querySelectorAll('.tseg-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.setTheme === theme);
    });

    $('quickShuffleOpts').checked = Boolean(state.settings.shuffleOptions);
    $('quickAutoNext').checked = Boolean(state.settings.autoNextOnCorrect);

    // Sync status indicators
    const hasToken = Boolean((state.settings.gistToken || '').trim());
    $('navSyncDot').classList.toggle('hidden', !hasToken);
    $('quickSyncLabel').textContent = state.syncBusy
      ? '同步中...'
      : hasToken
      ? 'Gist 已连'
      : '配置云同步';
  }

  function setZenMode(enabled) {
    state.zenMode = Boolean(enabled);
    $('appShell').classList.toggle('zen-active', state.zenMode);
    $('zenModeBtn').classList.toggle('active-zen', state.zenMode);
    $('zenModeBtn').textContent = state.zenMode ? '🧘 退出专注' : '🧘 专注模式';
  }

  function switchView(viewName) {
    if (state.currentView === 'study' && viewName !== 'study') {
      stopAutoNextTimer();
      stopExamTimer();
      if (state.zenMode) setZenMode(false);
    }
    state.currentView = viewName;

    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const target = $('view-' + viewName);
    if (target) target.classList.add('active');

    document.querySelectorAll('.snav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    closeMobileSidebar();
    if (viewName === 'home') renderHome();
    if (viewName === 'manage') renderManage();
    if (viewName === 'analytics') renderAnalytics();
    if (viewName === 'sync') renderSyncSettings();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderSidebarBankBox() {
    const wrap = $('sidebarBankWrap');
    const select = $('activeBankSelect');
    const bank = getActiveBank();
    if (!bank) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    select.innerHTML = state.banks
      .map(
        (b) =>
          `<option value="${escapeHtml(b.id)}" ${b.id === bank.id ? 'selected' : ''}>${escapeHtml(
            b.name
          )} (${b.questions.length})</option>`
      )
      .join('');

    const recs = getBankRecords(bank.id);
    const mastered = bank.questions.filter((q) => recs[q.id] && recs[q.id].mastered).length;
    const pct = bank.questions.length > 0 ? Math.round((mastered / bank.questions.length) * 100) : 0;
    $('sbMiniProgFill').style.width = pct + '%';
  }

  // ==================== FILTERING WITH RANGE SUPPORT ====================
  function getFilteredPool(bank) {
    if (!bank) return [];
    const typeVal = $('filterTypeSelect').value;
    const catVal = $('filterCategorySelect').value;
    const startNum = parseInt($('rangeStartInput').value, 10);
    const endNum = parseInt($('rangeEndInput').value, 10);

    return bank.questions.filter((q, idx) => {
      const qNo = q.index || idx + 1;
      if (Number.isFinite(startNum) && startNum > 0 && qNo < startNum) return false;
      if (Number.isFinite(endNum) && endNum > 0 && qNo > endNum) return false;
      if (typeVal !== 'all' && q.type !== typeVal) return false;
      if (catVal !== 'all' && (q.category || '未分类') !== catVal) return false;
      return true;
    });
  }

  // ==================== VIEW 1: DASHBOARD ====================
  async function renderHome() {
    renderSidebarBankBox();
    const bank = getActiveBank();
    if (!bank) {
      $('homeEmptyState').classList.remove('hidden');
      $('homeDashboard').classList.add('hidden');
      return;
    }
    $('homeEmptyState').classList.add('hidden');
    $('homeDashboard').classList.remove('hidden');

    const recs = getBankRecords(bank.id);
    const total = bank.questions.length;
    const now = Date.now();

    let attempted = 0, sumAtt = 0, sumCor = 0, wrong = 0, bookmarked = 0, mastered = 0, due = 0;
    const categories = new Set();

    for (const q of bank.questions) {
      if (q.category) categories.add(q.category);
      const r = recs[q.id];
      if (r) {
        if (r.attempts > 0) attempted++;
        sumAtt += r.attempts || 0;
        sumCor += r.correct || 0;
        if (r.inWrongBook) wrong++;
        if (r.bookmarked) bookmarked++;
        if (r.mastered) mastered++;
        if (SrsAndMerge.isQuestionDue(r, now)) due++;
      }
    }

    const masteredPct = total > 0 ? Math.round((mastered / total) * 100) : 0;
    const donePct = total > 0 ? Math.round((attempted / total) * 100) : 0;
    const circumference = 314.16;

    $('dashBankTitle').textContent = bank.name;
    const todayKey = SrsAndMerge.getLocalDateKey();
    const todayCount = (state.dailyStats[todayKey] && state.dailyStats[todayKey].answered) || 0;
    $('dashSubtitle').textContent = `今日已专注刷题 ${todayCount} 次 · 待复习 ${due} 题 · 待斩杀 ${total - mastered} 题`;

    // Exam Countdown Pill
    const cdBtn = $('examCountdownBtn');
    if (state.settings.examDate) {
      const targetTs = new Date(state.settings.examDate + 'T09:00:00').getTime();
      const diffDays = Math.ceil((targetTs - now) / SrsAndMerge.DAY_MS);
      const eTitle = state.settings.examTitle || '考试';
      if (diffDays > 0) {
        const dailyPlan = Math.max(1, Math.ceil((total - mastered) / diffDays));
        cdBtn.textContent = `🎯 距「${eTitle}」${diffDays} 天 · 建议日斩 ${dailyPlan} 题`;
      } else if (diffDays === 0) {
        cdBtn.textContent = `🔥 今天「${eTitle}」开考！旗开得胜！`;
      } else {
        cdBtn.textContent = `🎯 更新考试倒计时`;
      }
    } else {
      cdBtn.textContent = '🎯 设置考试倒计时';
    }

    // SVG Ring Animation
    $('ringDoneCircle').style.strokeDashoffset = String(circumference * (1 - donePct / 100));
    $('ringMasterCircle').style.strokeDashoffset = String(circumference * (1 - masteredPct / 100));
    $('ringPctText').textContent = masteredPct + '%';

    $('statTotal').textContent = total;
    $('statAttempted').textContent = attempted;
    $('statAccuracy').textContent = sumAtt > 0 ? Math.round((sumCor / sumAtt) * 100) + '%' : '--';
    $('statDue').textContent = due;
    $('statWrong').textContent = wrong;
    $('statBookmark').textContent = bookmarked;
    $('bookmarkBtnCount').textContent = bookmarked;

    // Populate Category Select
    const catSelect = $('filterCategorySelect');
    const prevCat = catSelect.value;
    const catWrap = $('filterCategoryWrap');
    if (categories.size > 0) {
      catWrap.classList.remove('hidden');
      const opts = ['<option value="all">全部章节</option>'];
      Array.from(categories).forEach((c) => {
        opts.push(`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`);
      });
      catSelect.innerHTML = opts.join('');
      if (Array.from(categories).includes(prevCat)) catSelect.value = prevCat;
    } else {
      catWrap.classList.add('hidden');
      catSelect.innerHTML = '<option value="all">全部章节</option>';
    }

    updateFilteredModeBadges();
    renderHeatmapStrip();

    // Resume Session Banner
    state.savedSession = await QuizStorage.loadSession(bank.id);
    const banner = $('resumeBanner');
    if (state.savedSession && state.savedSession.items && state.savedSession.items.length > 0) {
      const mLabel = (MODE_META[state.savedSession.mode] || {}).label || '刷题';
      $('resumeText').textContent = `${mLabel} · 进行到第 ${(state.savedSession.currentIndex || 0) + 1} / ${state.savedSession.items.length} 题`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  function updateFilteredModeBadges() {
    const bank = getActiveBank();
    if (!bank) return;
    const recs = getBankRecords(bank.id);
    const now = Date.now();
    const pool = getFilteredPool(bank);

    const unmastered = pool.filter((q) => !(recs[q.id] && recs[q.id].mastered)).length;
    const due = pool.filter((q) => SrsAndMerge.isQuestionDue(recs[q.id], now)).length;
    const wrong = pool.filter((q) => recs[q.id] && recs[q.id].inWrongBook).length;

    $('filteredCountHint').textContent = `当前范围 ${pool.length} / ${bank.questions.length} 题`;
    $('modeTagPractice').textContent = `${pool.length} 题`;
    $('modeTagSprint').textContent = `待斩 ${unmastered}`;
    $('modeTagDue').textContent = `待复习 ${due}`;
    $('modeTagWrong').textContent = `${wrong} 错题`;
  }

  function renderHeatmapStrip() {
    const container = $('heatmapCells');
    const cells = [];
    const now = Date.now();
    for (let d = 13; d >= 0; d--) {
      const key = SrsAndMerge.getLocalDateKey(now - d * SrsAndMerge.DAY_MS);
      const st = state.dailyStats[key] || { answered: 0, correct: 0 };
      let lv = '';
      if (st.answered >= 80) lv = 'lv-4';
      else if (st.answered >= 40) lv = 'lv-3';
      else if (st.answered >= 15) lv = 'lv-2';
      else if (st.answered >= 1) lv = 'lv-1';
      const acc = st.answered > 0 ? Math.round((st.correct / st.answered) * 100) + '%' : '--';
      cells.push(
        `<span class="hm-cell ${lv}" title="${key}：作答 ${st.answered} 次（正确率 ${acc}）"></span>`
      );
    }
    container.innerHTML = cells.join('');
  }

  // ==================== STUDY ENGINE ====================
  function buildSessionItem(question, shouldShuffleOpts) {
    let displayOptions = [];
    if (question.options && question.options.length > 0) {
      if (shouldShuffleOpts && (question.type === 'single' || question.type === 'multiple')) {
        displayOptions = shuffleArray(question.options).map((opt, idx) => ({
          displayKey: OPTION_LETTERS[idx] || String(idx + 1),
          origKey: opt.key,
          text: opt.text
        }));
      } else {
        displayOptions = question.options.map((opt) => ({
          displayKey: opt.key,
          origKey: opt.key,
          text: opt.text
        }));
      }
    }
    return {
      questionId: question.id,
      displayOptions,
      selectedKeys: [],
      userText: '',
      submitted: false,
      isCorrect: null,
      revealed: false
    };
  }

  function startStudyMode(mode, customPool = null, examOpts = null) {
    const bank = getActiveBank();
    if (!bank || bank.questions.length === 0) {
      showToast('请先导入题库', 'error');
      return;
    }

    const recs = getBankRecords(bank.id);
    const now = Date.now();
    let pool = customPool ? customPool.slice() : getFilteredPool(bank);

    if (mode === 'sprint') {
      pool = pool.filter((q) => !(recs[q.id] && recs[q.id].mastered));
      if (pool.length === 0) {
        showToast('🎉 太强了！当前范围内的题目已全部斩杀清零！', 'success');
        return;
      }
      pool = shuffleArray(pool);
    } else if (mode === 'due') {
      pool = pool
        .filter((q) => SrsAndMerge.isQuestionDue(recs[q.id], now))
        .sort((a, b) => ((recs[a.id] && recs[a.id].nextReviewAt) || 0) - ((recs[b.id] && recs[b.id].nextReviewAt) || 0));
      if (pool.length === 0) {
        showToast('✨ 当前没有到期的艾宾浩斯待复习题目，先去刷一些新题吧！', 'info');
        return;
      }
    } else if (mode === 'wrong') {
      pool = pool
        .filter((q) => recs[q.id] && recs[q.id].inWrongBook)
        .sort((a, b) => ((recs[b.id] && recs[b.id].wrong) || 0) - ((recs[a.id] && recs[a.id].wrong) || 0));
      if (pool.length === 0) {
        showToast('👏 当前范围内没有错题！', 'success');
        return;
      }
    } else if (mode === 'bookmark') {
      pool = bank.questions.filter((q) => recs[q.id] && recs[q.id].bookmarked);
      if (pool.length === 0) {
        showToast('暂无收藏题目，刷题时按 S 键可快速收藏重点题', 'info');
        return;
      }
    } else if (mode === 'random') {
      pool = shuffleArray(pool);
    } else if (mode === 'exam' && examOpts) {
      pool = shuffleArray(pool).slice(0, examOpts.count);
    }

    if (pool.length === 0) {
      showToast('当前筛选区间内没有匹配的题目，请调整筛选条件', 'error');
      return;
    }

    const shouldShuffleOpts =
      mode === 'exam' && examOpts ? Boolean(examOpts.shuffleOptions) : Boolean(state.settings.shuffleOptions);

    state.session = {
      bankId: bank.id,
      mode,
      items: pool.map((q) => buildSessionItem(q, shouldShuffleOpts)),
      currentIndex: 0,
      reciteMasked: false,
      examDurationSec: examOpts ? examOpts.minutes * 60 : 0,
      examRemainingSec: examOpts ? examOpts.minutes * 60 : 0,
      shuffleOptions: shouldShuffleOpts
    };

    if (mode === 'exam') startExamTimer();
    else {
      stopExamTimer();
      persistCurrentSession();
    }

    switchView('study');
    renderStudyView();
  }

  function jumpStudySingleQuestion(questionId) {
    const bank = getActiveBank();
    if (!bank) return;
    const idx = bank.questions.findIndex((q) => q.id === questionId);
    if (idx === -1) return;
    state.session = {
      bankId: bank.id,
      mode: 'practice',
      items: bank.questions.map((q) => buildSessionItem(q, false)),
      currentIndex: idx,
      reciteMasked: false,
      examDurationSec: 0,
      examRemainingSec: 0,
      shuffleOptions: false
    };
    switchView('study');
    renderStudyView();
  }

  function resumeSavedSession() {
    const bank = getActiveBank();
    if (!bank || !state.savedSession) return;
    const qSet = new Set(bank.questions.map((q) => q.id));
    const validItems = state.savedSession.items.filter((it) => qSet.has(it.questionId));
    if (validItems.length === 0) {
      QuizStorage.clearSession(bank.id);
      renderHome();
      return;
    }
    state.session = {
      ...state.savedSession,
      items: validItems,
      currentIndex: Math.min(state.savedSession.currentIndex || 0, validItems.length - 1)
    };
    switchView('study');
    renderStudyView();
  }

  function persistCurrentSession() {
    if (!state.session) return;
    if (state.session.mode === 'exam' || state.session.mode === 'exam-review') return;
    QuizStorage.saveSession(state.session.bankId, state.session);
  }

  function stopAutoNextTimer() {
    if (state.autoNextTimer) {
      clearTimeout(state.autoNextTimer);
      state.autoNextTimer = null;
    }
  }

  function startExamTimer() {
    stopExamTimer();
    $('studyTimerBadge').classList.remove('hidden');
    updateExamTimerDisplay();
    state.examTimerInterval = setInterval(() => {
      if (!state.session || state.session.mode !== 'exam') {
        stopExamTimer();
        return;
      }
      state.session.examRemainingSec = Math.max(0, state.session.examRemainingSec - 1);
      updateExamTimerDisplay();
      if (state.session.examRemainingSec <= 0) {
        stopExamTimer();
        showToast('⏰ 考试时间到，已自动交卷评分！', 'info');
        submitMockExam(true);
      }
    }, 1000);
  }

  function stopExamTimer() {
    if (state.examTimerInterval) {
      clearInterval(state.examTimerInterval);
      state.examTimerInterval = null;
    }
  }

  function updateExamTimerDisplay() {
    if (!state.session) return;
    const badge = $('studyTimerBadge');
    badge.textContent = '⏱️ ' + formatDuration(state.session.examRemainingSec);
    badge.classList.toggle('urgent', state.session.examRemainingSec <= 300);
  }

  function getCurrentContext() {
    if (!state.session) return null;
    const bank = state.banks.find((b) => b.id === state.session.bankId);
    if (!bank) return null;
    const item = state.session.items[state.session.currentIndex];
    if (!item) return null;
    const question = bank.questions.find((q) => q.id === item.questionId);
    if (!question) return null;
    const record = getQuestionRecord(bank.id, question.id);
    return { bank, session: state.session, item, question, record };
  }

  function getDisplayAnswerText(question, item) {
    if (!question.answer) return '（本题暂未录入参考答案）';
    if ((question.type === 'single' || question.type === 'multiple') && item.displayOptions.length > 0) {
      const origSet = new Set(question.answer.toUpperCase().split(''));
      const mapped = item.displayOptions
        .filter((o) => origSet.has(o.origKey.toUpperCase()))
        .map((o) => o.displayKey)
        .join('');
      if (mapped && mapped !== question.answer.toUpperCase()) {
        return `${mapped}（原题库 ${question.answer}）`;
      }
      return mapped || question.answer;
    }
    return question.answer;
  }

  function mapDisplayKeysToOrig(item, displayKeys) {
    const map = new Map(item.displayOptions.map((o) => [o.displayKey, o.origKey]));
    return displayKeys.map((dk) => map.get(dk) || dk).sort().join('');
  }

  // ==================== RENDER STUDY STUDIO ====================
  function renderStudyView() {
    stopAutoNextTimer();
    const ctx = getCurrentContext();
    if (!ctx) return;

    const { session, item, question, record } = ctx;
    const total = session.items.length;
    const idx = session.currentIndex;
    const isExam = session.mode === 'exam';
    const isRecite = session.mode === 'recite';
    const isReview = session.mode === 'exam-review';

    const mInfo = MODE_META[session.mode] || MODE_META.practice;
    const mBadge = $('studyModeBadge');
    mBadge.textContent = mInfo.label;
    mBadge.className = 'pill ' + mInfo.badge;

    $('studyProgressCounter').textContent = `${idx + 1} / ${total}`;
    $('studyProgressFill').style.width = `${Math.round(((idx + 1) / total) * 100)}%`;

    $('studyTimerBadge').classList.toggle('hidden', !isExam);
    $('reciteMaskToggleBtn').classList.toggle('hidden', !isRecite);
    $('reciteMaskToggleBtn').textContent = session.reciteMasked ? '👁️ 显示答案 (R)' : '🙈 遮挡答案 (R)';
    $('submitExamBtn').classList.toggle('hidden', !isExam);
    $('sheetSubmitExamBtn').classList.toggle('hidden', !isExam);
    $('sheetRestartBtn').classList.toggle('hidden', isExam || isReview);

    if (isExam) {
      const done = session.items.filter((it) => it.selectedKeys.length > 0 || it.userText.trim() !== '').length;
      $('studyLiveStats').textContent = `已答 ${done} / ${total}`;
    } else if (session.mode === 'sprint') {
      const bankRecs = getBankRecords(session.bankId);
      const remain = session.items.filter((it) => !(bankRecs[it.questionId] && bankRecs[it.questionId].mastered)).length;
      $('studyLiveStats').textContent = `待斩余量 ${remain}`;
    } else if (!isRecite) {
      const graded = session.items.filter((it) => it.submitted && it.isCorrect !== null);
      const right = graded.filter((it) => it.isCorrect).length;
      $('studyLiveStats').textContent =
        graded.length > 0 ? `本轮正确率 ${Math.round((right / graded.length) * 100)}% (${right}/${graded.length})` : '';
    } else {
      $('studyLiveStats').textContent = '';
    }

    // Question card badges
    $('qOrigIndexBadge').textContent = `题号 #${question.index || idx + 1}`;
    $('qTypeBadge').textContent = TYPE_LABELS[question.type] || '题目';

    const catBadge = $('qCategoryBadge');
    if (question.category) {
      catBadge.textContent = question.category;
      catBadge.classList.remove('hidden');
    } else {
      catBadge.classList.add('hidden');
    }

    const srsBadge = $('qSrsBadge');
    if (!isExam) {
      const stage = SrsAndMerge.getRetentionStage(record);
      const stMeta = STAGE_META[stage] || STAGE_META.new;
      srsBadge.textContent = stMeta.label;
      srsBadge.className = 'pill ' + stMeta.badge;
    } else {
      srsBadge.classList.add('hidden');
    }

    const wrongBadge = $('qWrongCountBadge');
    if (record.wrong > 0 && !isExam) {
      wrongBadge.textContent = `曾错 ${record.wrong} 次`;
      wrongBadge.classList.remove('hidden');
    } else {
      wrongBadge.classList.add('hidden');
    }

    const bmBtn = $('qBookmarkBtn');
    bmBtn.textContent = record.bookmarked ? '★ 已收藏' : '☆ 收藏';
    bmBtn.classList.toggle('active-star', Boolean(record.bookmarked));

    const masterBtn = $('qMasterBtn');
    const streakHint =
      !record.mastered && record.streak > 0 && state.settings.masteryStreakTarget > 1
        ? ` (${record.streak}/${state.settings.masteryStreakTarget})`
        : '';
    masterBtn.textContent = record.mastered ? '⚔️ 已斩杀' : '⚔️ 斩杀' + streakHint;
    masterBtn.classList.toggle('active-master', Boolean(record.mastered));
    masterBtn.classList.toggle('hidden', isExam);
    $('qEditBtn').classList.toggle('hidden', isExam);

    $('qStem').textContent = question.stem;

    renderInteractiveArea(ctx);
    renderFeedbackPanel(ctx);

    $('prevQuestionBtn').disabled = idx === 0;
    const isLast = idx === total - 1;
    $('nextQuestionBtn').textContent = isLast ? (isExam ? '末题' : '完成本轮 ✓') : '下一题 →';
    $('nextQuestionBtn').disabled = isExam && isLast;

    renderAnswerSheet(ctx);
  }

  function renderInteractiveArea(ctx) {
    const { session, item, question } = ctx;
    const container = $('qInteractiveArea');
    const isExam = session.mode === 'exam';
    const isRecite = session.mode === 'recite';
    const isReview = session.mode === 'exam-review';
    const showSolution = isReview || (isRecite && (!session.reciteMasked || item.revealed)) || (!isExam && item.submitted);

    if (question.type === 'single' || question.type === 'multiple' || question.type === 'judge') {
      const correctOrigSet = new Set(
        question.type === 'judge' ? [question.answer] : String(question.answer || '').toUpperCase().split('')
      );

      let html = '<div class="options-list">';
      item.displayOptions.forEach((opt, i) => {
        const isSelected = item.selectedKeys.includes(opt.displayKey);
        const isRightOpt = correctOrigSet.has(
          question.type === 'judge' ? opt.origKey : opt.origKey.toUpperCase()
        );
        let cls = 'option-item';
        if (showSolution) {
          cls += ' locked';
          if (isRecite) {
            if (isRightOpt) cls += ' correct';
          } else {
            if (isSelected && isRightOpt) cls += ' correct';
            else if (isSelected && !isRightOpt) cls += ' wrong';
            else if (!isSelected && isRightOpt) cls += ' missed';
          }
        } else if (isSelected) {
          cls += ' selected';
        }

        html += `
          <button type="button" class="${cls}" data-opt-key="${escapeHtml(opt.displayKey)}" data-opt-idx="${i}">
            <span class="option-key">${escapeHtml(opt.displayKey)}</span>
            <span class="option-text">${escapeHtml(opt.text)}</span>
          </button>`;
      });
      html += '</div>';

      if (question.type === 'multiple' && !isRecite && !isReview && !isExam && !item.submitted) {
        html += `
          <div class="multi-submit-row">
            <button type="button" class="btn btn-primary" id="submitMultiBtn" ${
              item.selectedKeys.length === 0 ? 'disabled' : ''
            }>确认提交多选 (Enter)</button>
          </div>`;
      }

      if (isRecite && session.reciteMasked && !item.revealed) {
        html += `<div class="masked-reveal-box" id="reciteRevealBox">🙈 答案已遮挡 — 点击此处或按 <kbd>R</kbd> / <kbd>Space</kbd> 主动回忆后揭晓</div>`;
      }

      container.innerHTML = html;

      if (!showSolution && !isRecite) {
        container.querySelectorAll('.option-item').forEach((btn) => {
          btn.addEventListener('click', () => handleOptionClick(btn.dataset.optKey));
        });
      }
      const multiBtn = $('submitMultiBtn');
      if (multiBtn) multiBtn.addEventListener('click', gradeCurrentObjective);
      const revBox = $('reciteRevealBox');
      if (revBox) revBox.addEventListener('click', () => { item.revealed = true; renderStudyView(); });
      return;
    }

    if (question.type === 'fill') {
      if (isRecite) {
        container.innerHTML =
          session.reciteMasked && !item.revealed
            ? `<div class="masked-reveal-box" id="reciteRevealBox">🙈 点击或按 <kbd>R</kbd> 查看填空答案</div>`
            : '';
        const rb = $('reciteRevealBox');
        if (rb) rb.addEventListener('click', () => { item.revealed = true; renderStudyView(); });
        return;
      }

      const disabledAttr = (!isExam && item.submitted) || isReview ? 'disabled' : '';
      container.innerHTML = `
        <div class="fill-area">
          <div class="fill-input-row">
            <input type="text" id="fillAnswerInput" class="form-input" placeholder="输入填空答案后按 Enter 核对..." value="${escapeHtml(
              item.userText
            )}" ${disabledAttr} autocomplete="off" />
            ${!isExam && !isReview && !item.submitted ? '<button type="button" class="btn btn-primary" id="submitFillBtn">核对答案</button>' : ''}
          </div>
        </div>`;

      const inp = $('fillAnswerInput');
      if (inp && !disabledAttr) {
        inp.addEventListener('input', (e) => {
          item.userText = e.target.value;
          if (isExam) renderAnswerSheet(ctx);
        });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !isExam && !item.submitted) {
            e.preventDefault();
            e.stopPropagation();
            gradeCurrentFill();
          }
        });
      }
      const sBtn = $('submitFillBtn');
      if (sBtn) sBtn.addEventListener('click', gradeCurrentFill);
      return;
    }

    // Short answer
    if (isRecite) {
      container.innerHTML =
        session.reciteMasked && !item.revealed
          ? `<div class="masked-reveal-box" id="reciteRevealBox">🙈 先思考答题采分点，再点击或按 <kbd>R</kbd> 对照答案</div>`
          : '';
      const rb = $('reciteRevealBox');
      if (rb) rb.addEventListener('click', () => { item.revealed = true; renderStudyView(); });
      return;
    }

    const ro = isReview ? 'disabled' : '';
    let sHtml = `
      <div class="short-area">
        <textarea id="shortAnswerInput" class="form-textarea" rows="3" placeholder="可在此默写关键词或思路（也可留空直接点下方查看答案自评）..." ${ro}>${escapeHtml(
          item.userText
        )}</textarea>`;
    if (!isExam && !isReview) {
      if (!item.revealed && !item.submitted) {
        sHtml += `<div class="short-self-grade"><button type="button" class="btn btn-primary" id="revealShortBtn">👁️ 显示参考答案并自评 (Space)</button></div>`;
      } else if (!item.submitted) {
        sHtml += `
          <div class="short-self-grade">
            <button type="button" class="btn btn-success" id="selfRightBtn">✅ 记住了（算答对）</button>
            <button type="button" class="btn btn-danger" id="selfWrongBtn">❌ 没记住（加入错题本）</button>
          </div>`;
      }
    }
    sHtml += '</div>';
    container.innerHTML = sHtml;

    const ta = $('shortAnswerInput');
    if (ta && !ro) {
      ta.addEventListener('input', (e) => {
        item.userText = e.target.value;
        if (isExam) renderAnswerSheet(ctx);
      });
    }
    const revBtn = $('revealShortBtn');
    if (revBtn) revBtn.addEventListener('click', () => { item.revealed = true; renderStudyView(); });
    const rBtn = $('selfRightBtn');
    if (rBtn) rBtn.addEventListener('click', () => recordSelfGrade(true));
    const wBtn = $('selfWrongBtn');
    if (wBtn) wBtn.addEventListener('click', () => recordSelfGrade(false));
  }

  function renderFeedbackPanel(ctx) {
    const { session, item, question, record } = ctx;
    const box = $('qFeedbackBox');
    const isExam = session.mode === 'exam';
    const isRecite = session.mode === 'recite';
    const isReview = session.mode === 'exam-review';

    const shouldShow =
      !isExam &&
      (isReview ||
        (isRecite && (!session.reciteMasked || item.revealed)) ||
        item.submitted ||
        (question.type === 'short' && item.revealed));

    if (!shouldShow) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');

    const banner = $('qFeedbackBanner');
    if (isRecite) {
      banner.className = 'fb-banner is-recite';
      banner.innerHTML = '<span>⚡ 极速背题 · 标准答案与解析</span>';
    } else if (question.type === 'short' && !item.submitted && item.revealed) {
      banner.className = 'fb-banner is-recite';
      banner.innerHTML = '<span>👀 请对照参考答案，在上方点击“记住了”或“没记住”</span>';
    } else if (item.isCorrect === true) {
      banner.className = 'fb-banner is-correct';
      const nextDays = record.srsIntervalMin ? Math.max(1, Math.round(record.srsIntervalMin / 1440)) : 1;
      const rightNote = record.mastered ? '⚔️ 已斩杀掌握' : `🧠 下次记忆复习：${nextDays} 天后`;
      banner.innerHTML = `<span>✅ 回答正确！</span><span style="font-size:0.8rem;opacity:0.9">${rightNote}</span>`;
    } else if (item.isCorrect === false) {
      banner.className = 'fb-banner is-wrong';
      const overrideBtn =
        question.type === 'fill' && !isReview
          ? '<button type="button" class="btn btn-secondary btn-xs" id="overrideFillBtn">同义表述，算我答对</button>'
          : '<span style="font-size:0.8rem">🧠 已安排 10 分钟后强化复习</span>';
      banner.innerHTML = `<span>❌ 回答错误，已自动收入错题本</span>${overrideBtn}`;
      const ov = $('overrideFillBtn');
      if (ov) ov.addEventListener('click', overrideLastWrongAsCorrect);
    } else {
      banner.className = 'fb-banner is-recite';
      banner.innerHTML = `<span>${isReview && !item.submitted ? '⚪ 本题未作答' : 'ℹ️ 作答详情'}</span>`;
    }

    const ansText = getDisplayAnswerText(question, item);
    let userRow = '';
    if (isReview) {
      const uAns = item.selectedKeys.length > 0 ? item.selectedKeys.join('') : item.userText.trim() || '未作答';
      userRow = `<div style="margin-bottom:4px;color:var(--text-muted)">你的作答：<strong>${escapeHtml(uAns)}</strong></div>`;
    }
    $('qCorrectAnswerRow').innerHTML = `${userRow}<div><strong>参考答案：</strong><span class="text-green" style="font-weight:800">${escapeHtml(
      ansText
    )}</span></div>`;

    const anaBox = $('qAnalysisBox');
    if (question.analysis) {
      anaBox.classList.remove('hidden');
      $('qAnalysisText').textContent = question.analysis;
    } else {
      anaBox.classList.add('hidden');
    }

    $('qNoteInput').value = record.note || '';
  }

  function renderAnswerSheet(ctx) {
    const { session } = ctx;
    const recs = getBankRecords(session.bankId);
    const isExam = session.mode === 'exam';
    const isRecite = session.mode === 'recite';

    const grid = $('sheetGrid');
    grid.innerHTML = session.items
      .map((it, idx) => {
        const rec = recs[it.questionId];
        const cls = ['sheet-num'];
        if (idx === session.currentIndex) cls.push('current');
        if (rec && rec.bookmarked) cls.push('has-star');

        if (isExam) {
          if (it.selectedKeys.length > 0 || it.userText.trim() !== '') cls.push('st-answered');
        } else if (isRecite) {
          if (rec && rec.mastered) cls.push('st-correct');
        } else if (it.submitted) {
          if (it.isCorrect === true) cls.push('st-correct');
          else if (it.isCorrect === false) cls.push('st-wrong');
          else cls.push('st-answered');
        }
        return `<button type="button" class="${cls.join(' ')}" data-jump-idx="${idx}">${idx + 1}</button>`;
      })
      .join('');

    grid.querySelectorAll('.sheet-num').forEach((btn) => {
      btn.addEventListener('click', () => {
        jumpToQuestion(parseInt(btn.dataset.jumpIdx, 10));
        closeMobileSheet();
      });
    });
  }

  // ==================== GRADING & PROGRESSION ====================
  function handleOptionClick(displayKey) {
    const ctx = getCurrentContext();
    if (!ctx) return;
    const { session, item, question } = ctx;
    if (session.mode === 'recite' || session.mode === 'exam-review') return;
    if (session.mode !== 'exam' && item.submitted) return;

    if (question.type === 'multiple') {
      const i = item.selectedKeys.indexOf(displayKey);
      if (i >= 0) item.selectedKeys.splice(i, 1);
      else item.selectedKeys.push(displayKey);
      item.selectedKeys.sort();
      renderStudyView();
      return;
    }

    item.selectedKeys = [displayKey];
    if (session.mode === 'exam') renderStudyView();
    else gradeCurrentObjective();
  }

  function applyOutcome(ctx, isCorrect, givenStr) {
    const { session, item, question, record } = ctx;
    item.submitted = true;
    item.isCorrect = isCorrect;

    if (isCorrect !== null) {
      playFeedbackChime(isCorrect);
      recordDailyActivity(isCorrect);

      const now = Date.now();
      record.attempts = (record.attempts || 0) + 1;
      record.lastAnswer = givenStr;
      record.lastCorrect = isCorrect;
      record.updatedAt = now;
      SrsAndMerge.updateSrsSchedule(record, isCorrect, now);

      if (isCorrect) {
        record.correct = (record.correct || 0) + 1;
        record.streak = (record.streak || 0) + 1;
        if (record.streak >= (state.settings.masteryStreakTarget || 1)) {
          record.mastered = true;
        }
        if (session.mode === 'wrong' && state.settings.autoRemoveWrongOnCorrect && record.inWrongBook) {
          record.inWrongBook = false;
          showToast('🎉 答对！已自动移出错题本', 'success');
        }
      } else {
        record.wrong = (record.wrong || 0) + 1;
        record.streak = 0;
        record.mastered = false;
        record.inWrongBook = true;
      }

      QuizStorage.saveRecords(state.recordsByBank);
      scheduleAutoGistSync();
    }

    persistCurrentSession();
    renderStudyView();

    if (
      isCorrect === true &&
      state.settings.autoNextOnCorrect &&
      (question.type === 'single' || question.type === 'judge') &&
      session.currentIndex < session.items.length - 1
    ) {
      stopAutoNextTimer();
      state.autoNextTimer = setTimeout(() => {
        if (state.currentView === 'study' && state.session === session) goNextQuestion();
      }, Number(state.settings.autoNextDelayMs) || 550);
    }
  }

  function gradeCurrentObjective() {
    const ctx = getCurrentContext();
    if (!ctx || ctx.item.selectedKeys.length === 0) return;
    const orig =
      ctx.question.type === 'judge'
        ? ctx.item.selectedKeys[0]
        : mapDisplayKeysToOrig(ctx.item, ctx.item.selectedKeys);
    const res = QuestionParser.checkAnswer(ctx.question, orig);
    applyOutcome(ctx, res.isCorrect, orig);
  }

  function gradeCurrentFill() {
    const ctx = getCurrentContext();
    if (!ctx) return;
    const res = QuestionParser.checkAnswer(ctx.question, ctx.item.userText);
    applyOutcome(ctx, res.isCorrect, ctx.item.userText);
  }

  function recordSelfGrade(isRight) {
    const ctx = getCurrentContext();
    if (!ctx) return;
    applyOutcome(ctx, isRight, ctx.item.userText || (isRight ? '自评掌握' : '自评未掌握'));
  }

  function overrideLastWrongAsCorrect() {
    const ctx = getCurrentContext();
    if (!ctx || ctx.item.isCorrect !== false) return;
    const { item, record } = ctx;
    item.isCorrect = true;
    record.wrong = Math.max(0, (record.wrong || 1) - 1);
    record.correct = (record.correct || 0) + 1;
    record.streak = (record.streak || 0) + 1;
    if (record.streak >= (state.settings.masteryStreakTarget || 1)) record.mastered = true;
    if (record.wrong === 0) record.inWrongBook = false;
    SrsAndMerge.updateSrsSchedule(record, true);
    record.updatedAt = Date.now();
    QuizStorage.saveRecords(state.recordsByBank);
    scheduleAutoGistSync();
    showToast('已更正为答对 ✓', 'success');
    renderStudyView();
  }

  function jumpToQuestion(idx) {
    if (!state.session || idx < 0 || idx >= state.session.items.length) return;
    stopAutoNextTimer();
    state.session.currentIndex = idx;
    persistCurrentSession();
    renderStudyView();
  }

  function goPrevQuestion() {
    if (state.session && state.session.currentIndex > 0) jumpToQuestion(state.session.currentIndex - 1);
  }

  function goNextQuestion() {
    if (!state.session) return;
    stopAutoNextTimer();
    const s = state.session;
    if (s.currentIndex < s.items.length - 1) {
      jumpToQuestion(s.currentIndex + 1);
    } else if (s.mode !== 'exam') {
      QuizStorage.clearSession(s.bankId);
      const wrongInRound = s.items.filter((it) => it.isCorrect === false);
      if (wrongInRound.length > 0 && s.mode !== 'exam-review') {
        if (confirm(`🎉 本轮已完成！其中有 ${wrongInRound.length} 道题答错，是否立即开启下一轮专门强化这 ${wrongInRound.length} 道错题？`)) {
          const bank = getActiveBank();
          const qMap = new Map(bank.questions.map((q) => [q.id, q]));
          const retryQs = wrongInRound.map((it) => qMap.get(it.questionId)).filter(Boolean);
          startStudyMode('wrong', retryQs);
          return;
        }
      } else {
        showToast('🎉 本轮题目已全部刷完！干得漂亮！', 'success');
      }
      switchView('home');
    }
  }

  // ==================== AI EXPLANATION HELPER ====================
  async function copyAiExplainPrompt() {
    const ctx = getCurrentContext();
    if (!ctx) return;
    const { question, item } = ctx;
    const optsStr = (question.options || []).map((o) => `${o.key}. ${o.text}`).join('\n');
    const myAns = item.selectedKeys.length > 0 ? item.selectedKeys.join('') : item.userText || '未作答';
    const promptText = [
      `请作为资深专业讲师，帮我透彻解析下面这道${TYPE_LABELS[question.type] || '考试'}题：`,
      `【题目】${question.stem}`,
      optsStr ? `【选项】\n${optsStr}` : '',
      `【标准答案】${question.answer || '未知'}`,
      `【我的作答】${myAns}`,
      `请用简明易记的语言说明：1）正确答案的核心原理与记忆口诀；2）其余干扰项错在哪里。`
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(promptText);
      showToast('✨ AI 讲题提问词已复制！直接去粘贴给 AI 即可', 'success');
    } catch (_) {
      prompt('请复制以下 AI 提问词：', promptText);
    }
  }

  async function pasteAndSaveAnalysis() {
    const ctx = getCurrentContext();
    if (!ctx) return;
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (_) {
      text = prompt('请粘贴要保存为本题解析的文本：', ctx.question.analysis || '') || '';
    }
    if (!text.trim()) {
      showToast('剪贴板内容为空', 'info');
      return;
    }
    ctx.question.analysis = text.trim();
    ctx.bank.updatedAt = Date.now();
    await QuizStorage.saveBanks(state.banks);
    scheduleAutoGistSync();
    showToast('💡 已将解析永久保存到本题！', 'success');
    renderStudyView();
  }

  // ==================== MOCK EXAM ====================
  function openExamConfigModal() {
    const bank = getActiveBank();
    if (!bank) return;
    const pool = getFilteredPool(bank);
    if (pool.length === 0) {
      showToast('当前筛选范围内没有题目', 'error');
      return;
    }
    $('examMaxCount').textContent = pool.length;
    const def = Math.min(pool.length, 30);
    $('examCountInput').max = pool.length;
    $('examCountInput').value = def;
    $('examMinutesInput').value = Math.max(15, Math.min(120, def));
    $('examShuffleOpts').checked = Boolean(state.settings.shuffleOptions);
    openModal('examConfigModal');
  }

  function submitMockExam(force = false) {
    if (!state.session || state.session.mode !== 'exam') return;
    const session = state.session;
    const unanswered = session.items.filter((it) => it.selectedKeys.length === 0 && it.userText.trim() === '').length;
    if (!force && unanswered > 0) {
      if (!confirm(`还有 ${unanswered} 道题未作答，确认现在交卷评分吗？`)) return;
    }

    stopExamTimer();
    const bank = state.banks.find((b) => b.id === session.bankId);
    const qMap = new Map(bank.questions.map((q) => [q.id, q]));

    let correct = 0, wrong = 0, unans = 0, gradable = 0;
    const byType = {};
    const now = Date.now();

    for (const item of session.items) {
      const q = qMap.get(item.questionId);
      if (!q) continue;
      if (!byType[q.type]) byType[q.type] = { total: 0, correct: 0 };
      byType[q.type].total++;

      const hasAns = item.selectedKeys.length > 0 || item.userText.trim() !== '';
      if (!hasAns) {
        unans++;
        item.submitted = false;
        item.isCorrect = false;
        if (q.type !== 'short' && q.answer) gradable++;
        continue;
      }

      item.submitted = true;
      let given = item.userText;
      if (q.type === 'single' || q.type === 'multiple') given = mapDisplayKeysToOrig(item, item.selectedKeys);
      else if (q.type === 'judge') given = item.selectedKeys[0];

      const res = QuestionParser.checkAnswer(q, given);
      const rec = getQuestionRecord(bank.id, q.id);

      if (res.isCorrect === true) {
        item.isCorrect = true;
        correct++; gradable++; byType[q.type].correct++;
        rec.attempts++; rec.correct++; rec.streak++;
        if (rec.streak >= (state.settings.masteryStreakTarget || 1)) rec.mastered = true;
        SrsAndMerge.updateSrsSchedule(rec, true, now);
        rec.updatedAt = now;
        recordDailyActivity(true);
      } else if (res.isCorrect === false) {
        item.isCorrect = false;
        wrong++; gradable++;
        rec.attempts++; rec.wrong++; rec.streak = 0;
        rec.mastered = false; rec.inWrongBook = true;
        SrsAndMerge.updateSrsSchedule(rec, false, now);
        rec.updatedAt = now;
        recordDailyActivity(false);
      }
    }

    QuizStorage.saveRecords(state.recordsByBank);
    const score = gradable > 0 ? Math.round((correct / gradable) * 100) : 100;
    const elapsedSec = Math.max(1, session.examDurationSec - session.examRemainingSec);

    state.lastExamResult = {
      bankId: bank.id,
      score,
      total: session.items.length,
      correct,
      wrong,
      unanswered: unans,
      elapsedSec,
      byType,
      items: session.items
    };

    state.examHistory.unshift({
      id: 'ex_' + now,
      bankId: bank.id,
      date: now,
      score,
      total: session.items.length,
      correct,
      elapsedSec
    });
    state.examHistory = state.examHistory.slice(0, 60);
    QuizStorage.saveExamHistory(state.examHistory);
    scheduleAutoGistSync();

    renderExamResultView();
    switchView('exam-result');
  }

  function renderExamResultView() {
    const r = state.lastExamResult;
    if (!r) return;
    $('resultScoreCircle').className = 'res-score-ring ' + (r.score >= 60 ? 'pass' : 'fail');
    $('resultScoreNum').textContent = r.score;

    let verdict = '继续稳扎稳打，把错题复盘一遍提升最快！';
    if (r.score >= 90) verdict = '🔥 高分通关水准！状态极佳！';
    else if (r.score >= 75) verdict = '👏 发挥优秀！扫清少量盲点即可冲满分！';
    else if (r.score >= 60) verdict = '✅ 顺利达标！建议立刻复盘下方错题巩固！';

    $('resultVerdict').textContent = verdict;
    $('resCorrectCount').textContent = r.correct;
    $('resWrongCount').textContent = r.wrong;
    $('resUnansweredCount').textContent = r.unanswered;
    $('resTimeUsed').textContent = formatDuration(r.elapsedSec);

    $('resultTypeTable').innerHTML = Object.entries(r.byType)
      .map(([type, st]) => {
        const pct = st.total > 0 ? Math.round((st.correct / st.total) * 100) : 0;
        return `
          <div class="type-stat-row">
            <strong>${TYPE_LABELS[type] || type}</strong>
            <div class="type-bar"><div class="type-bar-fill" style="width:${pct}%"></div></div>
            <span style="text-align:right">${st.correct} / ${st.total} (${pct}%)</span>
          </div>`;
      })
      .join('');

    const wrongItems = r.items.filter((it) => it.isCorrect === false);
    $('resReviewWrongBtn').disabled = wrongItems.length === 0;
    $('resReviewWrongBtn').textContent = `🎯 只复盘本次错题 (${wrongItems.length})`;
  }

  function startExamReview(onlyWrong) {
    const r = state.lastExamResult;
    if (!r) return;
    const list = onlyWrong ? r.items.filter((it) => it.isCorrect === false) : r.items;
    if (list.length === 0) return;
    state.session = {
      bankId: r.bankId,
      mode: 'exam-review',
      items: list,
      currentIndex: 0,
      reciteMasked: false
    };
    switchView('study');
    renderStudyView();
  }

  // ==================== IMPORT HUB ====================
  async function handleFileUpload(file) {
    if (!file) return;
    try {
      showToast('正在离线解析：' + file.name, 'info');
      const parsed = await QuestionParser.parseUploadedFile(file);
      parsed.detectedHeaderRowIndex = parsed.headerRowIndex;
      state.importDraft = parsed;
      renderImportPreview();
    } catch (err) {
      showToast(err.message || '文件解析失败', 'error');
    }
  }

  function handlePasteParse() {
    const text = $('pasteInput').value.trim();
    if (!text) {
      showToast('请先粘贴题目文本或 CSV 内容', 'error');
      return;
    }
    const defaultName = '导入题库 ' + new Date().toLocaleDateString('zh-CN');
    if (QuestionParser.looksLikeCsvText(text)) {
      const rows = QuestionParser.parseCsvRows(text);
      const det = QuestionParser.autoDetectTableMapping(rows);
      const res = QuestionParser.parseTableWithMapping(rows, det.mapping, det.headerRowIndex);
      state.importDraft = {
        kind: 'table',
        bankName: defaultName,
        sheets: [{ name: '粘贴表格', rows }],
        activeSheetIndex: 0,
        detectedHeaderRowIndex: det.headerRowIndex,
        ...det,
        ...res
      };
      showToast(`已自动按表格识别出 ${res.questions.length} 题`, 'success');
    } else {
      const res = QuestionParser.parseText(text);
      state.importDraft = { kind: 'direct', bankName: defaultName, ...res };
    }
    renderImportPreview();
  }

  function renderImportPreview() {
    const draft = state.importDraft;
    const card = $('importPreviewCard');
    if (!draft) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    $('importBankNameInput').value = draft.bankName || '我的题库';

    const s = draft.stats;
    const badges = [`<span class="pill pill-indigo">共识别 ${s.total} 题</span>`];
    for (const [t, lbl] of Object.entries(TYPE_LABELS)) {
      if (s.counts[t] > 0) badges.push(`<span class="pill pill-green">${lbl} ${s.counts[t]}</span>`);
    }
    if (s.duplicates > 0) badges.push(`<span class="pill pill-amber">重复 ${s.duplicates}</span>`);
    if (s.missingAnswer > 0) badges.push(`<span class="pill pill-red">缺答案 ${s.missingAnswer}</span>`);
    $('previewStatsBadges').innerHTML = badges.join('');

    const warnBox = $('previewWarnings');
    if (draft.warnings && draft.warnings.length > 0) {
      warnBox.classList.remove('hidden');
      warnBox.innerHTML = draft.warnings.map((w) => `<div>⚠️ ${escapeHtml(w)}</div>`).join('');
    } else {
      warnBox.classList.add('hidden');
    }

    const mapPanel = $('tableMappingPanel');
    if (draft.kind === 'table' && draft.sheets && draft.sheets.length > 0) {
      mapPanel.classList.remove('hidden');
      const sw = $('sheetSelectWrap');
      const ss = $('sheetSelect');
      if (draft.sheets.length > 1) {
        sw.classList.remove('hidden');
        ss.innerHTML = draft.sheets
          .map((sh, i) => `<option value="${i}" ${i === draft.activeSheetIndex ? 'selected' : ''}>${escapeHtml(sh.name)} (${sh.rows.length}行)</option>`)
          .join('');
      } else {
        sw.classList.add('hidden');
      }
      $('hasHeaderCheck').checked = draft.headerRowIndex >= 0;
      renderColumnMappingControls(draft);
    } else {
      mapPanel.classList.add('hidden');
    }

    const listEl = $('previewQuestionList');
    listEl.innerHTML =
      draft.questions.length === 0
        ? '<div class="ws-subtitle" style="padding:12px">暂无解析题目，请检查上方表格列映射。</div>'
        : draft.questions
            .slice(0, 8)
            .map((q, i) => {
              const opts =
                q.options && q.options.length > 0
                  ? `<div class="manage-q-opts" style="margin-top:6px">${q.options
                      .map((o) => `<span><strong>${escapeHtml(o.key)}.</strong> ${escapeHtml(o.text)}</span>`)
                      .join('')}</div>`
                  : '';
              return `
                <div class="preview-q-item">
                  <div style="display:flex;gap:8px;margin-bottom:4px">
                    <span class="pill pill-blue">#${i + 1} ${TYPE_LABELS[q.type] || q.type}</span>
                    ${q.category ? `<span class="pill pill-gray">${escapeHtml(q.category)}</span>` : ''}
                  </div>
                  <div style="font-weight:600">${escapeHtml(q.stem)}</div>
                  ${opts}
                  <div style="margin-top:5px;font-size:0.82rem;font-weight:700" class="${q.answer ? 'text-green' : 'text-amber'}">
                    ${q.answer ? '✓ 答案：' + escapeHtml(q.answer) : '⚠️ 缺少答案'}
                  </div>
                </div>`;
            })
            .join('');

    $('confirmImportBtn').disabled = draft.questions.length === 0;
    $('appendImportBtn').classList.toggle('hidden', !(state.banks.length > 0 && draft.questions.length > 0));
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderColumnMappingControls(draft) {
    const headers = draft.headers || [];
    const mapping = draft.mapping || {};
    const fields = [
      { key: 'stem', label: '题干列 (必选)' },
      { key: 'answer', label: '答案列' },
      { key: 'type', label: '题型列' },
      { key: 'opt_A', label: '选项 A' },
      { key: 'opt_B', label: '选项 B' },
      { key: 'opt_C', label: '选项 C' },
      { key: 'opt_D', label: '选项 D' },
      { key: 'opt_E', label: '选项 E' },
      { key: 'optionsCombined', label: '合并选项列' },
      { key: 'analysis', label: '解析列' },
      { key: 'category', label: '章节列' }
    ];

    const buildOpts = (selIdx) => {
      let html = `<option value="-1" ${selIdx === -1 || selIdx === undefined ? 'selected' : ''}>— 不映射 —</option>`;
      headers.forEach((h, i) => {
        html += `<option value="${i}" ${selIdx === i ? 'selected' : ''}>第${i + 1}列: ${escapeHtml(String(h).slice(0, 14))}</option>`;
      });
      return html;
    };

    const grid = $('mappingGrid');
    grid.innerHTML = fields
      .map((f) => {
        const cur = f.key.startsWith('opt_') ? (mapping.options ? mapping.options[f.key.slice(4)] : -1) : mapping[f.key];
        return `<div class="map-field"><label>${f.label}</label><select class="form-select form-select-xs map-sel" data-mk="${f.key}">${buildOpts(cur)}</select></div>`;
      })
      .join('');

    grid.querySelectorAll('.map-sel').forEach((sel) => {
      sel.addEventListener('change', () => {
        const k = sel.dataset.mk;
        const v = parseInt(sel.value, 10);
        if (k.startsWith('opt_')) {
          if (!draft.mapping.options) draft.mapping.options = {};
          if (v >= 0) draft.mapping.options[k.slice(4)] = v;
          else delete draft.mapping.options[k.slice(4)];
        } else {
          draft.mapping[k] = v;
        }
        reparseTableDraft();
      });
    });
  }

  function reparseTableDraft() {
    const draft = state.importDraft;
    if (!draft || draft.kind !== 'table') return;
    const sheet = draft.sheets[draft.activeSheetIndex];
    const hIdx = $('hasHeaderCheck').checked ? Math.max(0, draft.detectedHeaderRowIndex ?? 0) : -1;
    draft.headerRowIndex = hIdx;
    const res = QuestionParser.parseTableWithMapping(sheet.rows, draft.mapping, hIdx);
    Object.assign(draft, res);
    renderImportPreview();
  }

  async function commitImport(appendToCurrent = false) {
    const draft = state.importDraft;
    if (!draft || !draft.questions || draft.questions.length === 0) return;

    let finalQs = draft.questions;
    let dedupeMsg = '';
    if ($('importAutoDedupeCheck').checked) {
      const dd = QuestionParser.deduplicateQuestions(finalQs);
      finalQs = dd.questions;
      if (dd.removedCount > 0) dedupeMsg = `（已自动合并清理 ${dd.removedCount} 道重复题）`;
    }

    const now = Date.now();
    if (appendToCurrent && getActiveBank()) {
      const bank = getActiveBank();
      const combined = bank.questions.concat(
        finalQs.map((q, i) => ({
          ...q,
          id: 'q_' + now + '_' + i + '_' + Math.random().toString(36).slice(2, 6)
        }))
      );
      const cleaned = $('importAutoDedupeCheck').checked
        ? QuestionParser.deduplicateQuestions(combined).questions
        : combined.map((q, idx) => ({ ...q, index: idx + 1 }));
      bank.questions = cleaned;
      bank.updatedAt = now;
      await QuizStorage.saveBanks(state.banks);
      showToast(`已成功追加到「${bank.name}」${dedupeMsg}`, 'success');
    } else {
      const bankName = $('importBankNameInput').value.trim() || draft.bankName || '我的题库';
      const newBank = {
        id: 'bank_' + now + '_' + Math.random().toString(36).slice(2, 6),
        name: bankName,
        createdAt: now,
        updatedAt: now,
        questions: finalQs.map((q, i) => ({
          ...q,
          id: 'q_' + (i + 1) + '_' + Math.random().toString(36).slice(2, 7),
          index: i + 1
        }))
      };
      state.banks.unshift(newBank);
      state.activeBankId = newBank.id;
      await QuizStorage.saveBanks(state.banks);
      await QuizStorage.saveActiveBankId(state.activeBankId);
      showToast(`🎉 成功导入「${bankName}」共 ${newBank.questions.length} 题${dedupeMsg}`, 'success');
    }

    scheduleAutoGistSync();
    state.importDraft = null;
    $('importPreviewCard').classList.add('hidden');
    $('pasteInput').value = '';
    $('fileInput').value = '';
    switchView('home');
  }

  async function loadDemoBank() {
    const existing = state.banks.find((b) => b.name === '示例题库 · 计算机核心考点');
    if (existing) {
      state.activeBankId = existing.id;
      await QuizStorage.saveActiveBankId(existing.id);
      switchView('home');
      return;
    }
    const now = Date.now();
    const demoBank = {
      id: 'bank_demo_' + now,
      name: '示例题库 · 计算机核心考点',
      createdAt: now,
      updatedAt: now,
      questions: createDemoQuestions()
    };
    state.banks.unshift(demoBank);
    state.activeBankId = demoBank.id;
    await QuizStorage.saveBanks(state.banks);
    await QuizStorage.saveActiveBankId(state.activeBankId);
    showToast('✨ 示例题库已载入！', 'success');
    switchView('home');
  }

  // ==================== VIEW 5: LIBRARY & HEALTH CHECK ====================
  function renderManage() {
    renderSidebarBankBox();
    $('healthReportCard').classList.add('hidden');
    const bank = getActiveBank();
    const chipsEl = $('manageBankChips');
    const opsEl = $('manageBankOps');

    if (!bank) {
      chipsEl.innerHTML = '<span class="ws-subtitle">暂无题库，请先前往「智能导入题库」。</span>';
      opsEl.classList.add('hidden');
      $('manageQuestionList').innerHTML = '';
      $('manageCountLabel').textContent = '0 题';
      return;
    }

    opsEl.classList.remove('hidden');
    chipsEl.innerHTML = state.banks
      .map(
        (b) =>
          `<button type="button" class="bank-chip ${b.id === bank.id ? 'active' : ''}" data-bid="${escapeHtml(
            b.id
          )}">${escapeHtml(b.name)} (${b.questions.length})</button>`
      )
      .join('');

    chipsEl.querySelectorAll('.bank-chip').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.activeBankId = btn.dataset.bid;
        state.manageRenderLimit = 50;
        await QuizStorage.saveActiveBankId(state.activeBankId);
        renderManage();
      });
    });

    renderManageList();
  }

  function runBankHealthInspector() {
    const bank = getActiveBank();
    if (!bank) return;
    const h = QuestionParser.analyzeBankHealth(bank.questions);
    const card = $('healthReportCard');
    card.classList.remove('hidden');

    if (h.isHealthy) {
      card.innerHTML = `
        <div class="card-h-between" style="margin:0">
          <span class="text-green" style="font-weight:700">✅ 题库体检健康：共 ${h.total} 题，0 重复、0 缺失答案、0 选项异常！</span>
          <button class="btn btn-ghost btn-xs" id="closeHealthBtn">收起</button>
        </div>`;
    } else {
      const items = [];
      if (h.duplicateExtraCount > 0) {
        const previewGroups = h.duplicateGroups
          .slice(0, 5)
          .map((g) => `[#${g.join(', #')}]`)
          .join('、');
        items.push(`• 检测到 <strong>${h.duplicateExtraCount}</strong> 道重复题目（如题号 ${previewGroups}）`);
      }
      if (h.missingAnswerIndices.length > 0) {
        items.push(`• 有 <strong>${h.missingAnswerIndices.length}</strong> 道题缺少答案（题号 #${h.missingAnswerIndices.slice(0, 8).join(', #')}）`);
      }
      if (h.invalidOptionIndices.length > 0) {
        items.push(`• 有 <strong>${h.invalidOptionIndices.length}</strong> 道选择题选项或答案字母不匹配（题号 #${h.invalidOptionIndices.slice(0, 8).join(', #')}）`);
      }

      card.innerHTML = `
        <div class="card-h-between">
          <span style="font-weight:700">🩺 题库体检报告（${escapeHtml(bank.name)}）</span>
          <div style="display:flex;gap:8px">
            ${h.duplicateExtraCount > 0 ? '<button class="btn btn-primary btn-xs" id="dedupeNowBtn">⚡ 一键合并清理重复题</button>' : ''}
            <button class="btn btn-ghost btn-xs" id="closeHealthBtn">收起</button>
          </div>
        </div>
        <div style="font-size:0.86rem;color:var(--text-sec);line-height:1.7">${items.join('<br/>')}</div>`;

      const ddBtn = $('dedupeNowBtn');
      if (ddBtn) {
        ddBtn.addEventListener('click', async () => {
          const res = QuestionParser.deduplicateQuestions(bank.questions);
          bank.questions = res.questions;
          bank.updatedAt = Date.now();
          await QuizStorage.saveBanks(state.banks);
          scheduleAutoGistSync();
          showToast(`✨ 已清理 ${res.removedCount} 道重复题，当前共 ${bank.questions.length} 题！`, 'success');
          renderManage();
        });
      }
    }

    $('closeHealthBtn').addEventListener('click', () => card.classList.add('hidden'));
  }

  function renderManageList() {
    const bank = getActiveBank();
    if (!bank) return;
    const recs = getBankRecords(bank.id);
    const kw = $('manageSearchInput').value.trim().toLowerCase();
    const tFilter = $('manageTypeFilter').value;
    const sFilter = $('manageStatusFilter').value;
    const now = Date.now();

    const filtered = bank.questions.filter((q) => {
      if (tFilter !== 'all' && q.type !== tFilter) return false;
      const r = recs[q.id];
      if (sFilter === 'wrong' && !(r && r.inWrongBook)) return false;
      if (sFilter === 'due' && !SrsAndMerge.isQuestionDue(r, now)) return false;
      if (sFilter === 'mastered' && !(r && r.mastered)) return false;
      if (sFilter === 'unmastered' && r && r.mastered) return false;
      if (sFilter === 'bookmarked' && !(r && r.bookmarked)) return false;
      if (sFilter === 'unanswered' && r && r.attempts > 0) return false;
      if (sFilter === 'noanswer' && q.answer) return false;

      if (kw) {
        const hay = [q.stem, q.answer, q.analysis, q.category, ...(q.options || []).map((o) => o.text), (r && r.note) || '']
          .join(' ')
          .toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    $('manageCountLabel').textContent = `共 ${filtered.length} / ${bank.questions.length} 题`;
    const slice = filtered.slice(0, state.manageRenderLimit);
    const listEl = $('manageQuestionList');

    if (slice.length === 0) {
      listEl.innerHTML = '<div class="card ws-subtitle" style="text-align:center">没有匹配的题目</div>';
    } else {
      listEl.innerHTML = slice
        .map((q) => {
          const r = recs[q.id] || {};
          const opts =
            q.options && q.options.length > 0
              ? `<div class="manage-q-opts">${q.options
                  .map((o) => `<span><strong>${escapeHtml(o.key)}.</strong> ${escapeHtml(o.text)}</span>`)
                  .join('')}</div>`
              : '';
          return `
            <div class="manage-q-card">
              <div class="manage-q-top">
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                  <span class="q-idx-pill">#${q.index}</span>
                  <span class="pill pill-blue">${TYPE_LABELS[q.type] || q.type}</span>
                  ${q.category ? `<span class="pill pill-gray">${escapeHtml(q.category)}</span>` : ''}
                  ${r.inWrongBook ? `<span class="pill pill-red">错 ${r.wrong || 1} 次</span>` : ''}
                  ${r.mastered ? '<span class="pill pill-purple">已斩杀</span>' : ''}
                  ${r.bookmarked ? '<span class="pill pill-amber">★ 收藏</span>' : ''}
                </div>
                <div style="display:flex;gap:4px">
                  <button class="btn btn-ghost btn-xs" data-practice-qid="${escapeHtml(q.id)}">▶ 练此题</button>
                  <button class="btn btn-ghost btn-xs" data-edit-qid="${escapeHtml(q.id)}">✏️ 编辑</button>
                  <button class="btn btn-ghost btn-xs text-red" data-del-qid="${escapeHtml(q.id)}">删除</button>
                </div>
              </div>
              <div class="manage-q-stem">${escapeHtml(q.stem)}</div>
              ${opts}
              <div class="manage-q-bottom">
                <span><strong>答案：</strong><span class="${q.answer ? 'text-green' : 'text-amber'}">${escapeHtml(q.answer || '未填写')}</span></span>
                ${q.analysis ? `<span><strong>解析：</strong>${escapeHtml(q.analysis.slice(0, 85))}${q.analysis.length > 85 ? '…' : ''}</span>` : ''}
              </div>
            </div>`;
        })
        .join('');

      listEl.querySelectorAll('[data-practice-qid]').forEach((b) =>
        b.addEventListener('click', () => jumpStudySingleQuestion(b.dataset.practiceQid))
      );
      listEl.querySelectorAll('[data-edit-qid]').forEach((b) =>
        b.addEventListener('click', () => openEditQuestionModal(b.dataset.editQid))
      );
      listEl.querySelectorAll('[data-del-qid]').forEach((b) =>
        b.addEventListener('click', () => deleteQuestion(b.dataset.delQid))
      );
    }

    $('manageLoadMoreWrap').classList.toggle('hidden', filtered.length <= state.manageRenderLimit);
  }

  // ==================== VIEW 6: ANALYTICS & WEAK CHAPTERS ====================
  function renderAnalytics() {
    renderSidebarBankBox();
    const bank = getActiveBank();
    if (!bank || bank.questions.length === 0) {
      $('retentionStackedBar').innerHTML = '';
      $('retentionLegend').innerHTML = '<span class="ws-subtitle">请先导入题库查看分析图表</span>';
      $('chapterAnalyticsList').innerHTML = '';
      $('examTrendContainer').innerHTML = '';
      return;
    }

    const recs = getBankRecords(bank.id);
    const now = Date.now();
    const total = bank.questions.length;

    // 1. Retention distribution
    const stageCounts = { new: 0, learning: 0, due: 0, consolidated: 0, mastered: 0 };
    const chMap = new Map();

    for (const q of bank.questions) {
      const r = recs[q.id];
      const st = SrsAndMerge.getRetentionStage(r, now);
      stageCounts[st] = (stageCounts[st] || 0) + 1;

      const ch = q.category || '默认章节';
      if (!chMap.has(ch)) {
        chMap.set(ch, { name: ch, total: 0, mastered: 0, attempts: 0, correct: 0, wrongBook: 0 });
      }
      const cStat = chMap.get(ch);
      cStat.total++;
      if (r) {
        if (r.mastered) cStat.mastered++;
        if (r.inWrongBook) cStat.wrongBook++;
        cStat.attempts += r.attempts || 0;
        cStat.correct += r.correct || 0;
      }
    }

    $('retentionStackedBar').innerHTML = Object.entries(STAGE_META)
      .map(([k, meta]) => {
        const pct = ((stageCounts[k] / total) * 100).toFixed(1);
        return `<div class="sb-seg" style="width:${pct}%;background:${meta.color}" title="${meta.label}: ${stageCounts[k]}题 (${pct}%)"></div>`;
      })
      .join('');

    $('retentionLegend').innerHTML = Object.entries(STAGE_META)
      .map(
        ([k, meta]) =>
          `<span><i class="dot" style="background:${meta.color}"></i>${meta.label} <strong>${stageCounts[k]}</strong> (${Math.round(
            (stageCounts[k] / total) * 100
          )}%)</span>`
      )
      .join('');

    // 2. Chapter Diagnostics
    const chapters = Array.from(chMap.values()).map((c) => ({
      ...c,
      masteryPct: Math.round((c.mastered / c.total) * 100),
      accPct: c.attempts > 0 ? Math.round((c.correct / c.attempts) * 100) : null
    }));

    if ($('chapterSortSelect').value === 'weakest') {
      chapters.sort((a, b) => a.masteryPct - b.masteryPct || (a.accPct ?? 50) - (b.accPct ?? 50));
    }

    $('chapterAnalyticsList').innerHTML = chapters
      .map((c) => {
        const accStr = c.accPct !== null ? `正确率 ${c.accPct}%` : '尚未作答';
        return `
          <div class="ch-row">
            <div class="ch-name">${escapeHtml(c.name)} <span class="ws-subtitle">(${c.total}题)</span></div>
            <div class="ch-bar-track"><div class="ch-bar-fill" style="width:${c.masteryPct}%"></div></div>
            <div class="ch-stats">斩杀 ${c.masteryPct}% · ${accStr}</div>
            <button class="btn btn-secondary btn-xs" data-sprint-ch="${escapeHtml(c.name)}">⚡ 突击此章</button>
          </div>`;
      })
      .join('');

    $('chapterAnalyticsList').querySelectorAll('[data-sprint-ch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ch = btn.dataset.sprintCh;
        const pool = bank.questions.filter((q) => (q.category || '默认章节') === ch);
        const unmastered = pool.filter((q) => !(recs[q.id] && recs[q.id].mastered));
        startStudyMode(unmastered.length > 0 ? 'sprint' : 'practice', pool);
      });
    });

    // 3. Exam Score SVG Trend
    const exams = state.examHistory.filter((h) => h.bankId === bank.id).slice(0, 12).reverse();
    const trendEl = $('examTrendContainer');
    if (exams.length === 0) {
      trendEl.innerHTML = '<div class="ws-subtitle">暂无模拟考试记录，前往工作台完成一次「全真限时模拟考」即可生成得分曲线！</div>';
    } else {
      const w = 680, h = 160, pad = 28;
      const pts = exams.map((ex, i) => {
        const x = exams.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (exams.length - 1);
        const y = h - pad - ((ex.score / 100) * (h - pad * 2));
        return { x, y, ex };
      });
      const poly = pts.map((p) => `${p.x},${p.y}`).join(' ');
      const circles = pts
        .map(
          (p) =>
            `<circle cx="${p.x}" cy="${p.y}" r="4.5" fill="var(--primary)"><title>${new Date(p.ex.date).toLocaleDateString()}：${p.ex.score}分</title></circle>
             <text x="${p.x}" y="${p.y - 9}" text-anchor="middle" font-size="11" fill="var(--text-sec)" font-weight="700">${p.ex.score}</text>`
        )
        .join('');
      trendEl.innerHTML = `
        <svg viewBox="0 0 ${w} ${h}" style="width:100%;max-height:190px;overflow:visible">
          <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--border-strong)" stroke-dasharray="4 4"/>
          <polyline fill="none" stroke="var(--primary)" stroke-width="2.5" points="${poly}" />
          ${circles}
        </svg>`;
    }
  }

  // ==================== VIEW 7: GITHUB GIST SYNC & SNAPSHOT ====================
  function renderSyncSettings() {
    $('gistTokenInput').value = state.settings.gistToken || '';
    $('gistIdInput').value = state.settings.gistId || '';
    $('autoGistSyncCheck').checked = Boolean(state.settings.autoGistSync);

    const hasToken = Boolean((state.settings.gistToken || '').trim());
    const badge = $('gistStatusBadge');
    badge.textContent = hasToken ? '已绑定私有 Gist' : '未配置';
    badge.className = 'pill ' + (hasToken ? 'pill-green' : 'pill-gray');

    $('lastSyncTimeLabel').textContent = state.settings.lastSyncAt
      ? '上次双向同步时间：' + new Date(state.settings.lastSyncAt).toLocaleString('zh-CN')
      : '尚未执行过云端同步';

    $('setExamTitle').value = state.settings.examTitle || '';
    $('setExamDate').value = state.settings.examDate || '';
    $('setAutoNext').checked = Boolean(state.settings.autoNextOnCorrect);
    $('setAutoNextDelay').value = String(state.settings.autoNextDelayMs || 550);
    $('setShuffleOpts').checked = Boolean(state.settings.shuffleOptions);
    $('setAutoRemoveWrong').checked = Boolean(state.settings.autoRemoveWrongOnCorrect);
    $('setMasteryTarget').value = String(state.settings.masteryStreakTarget || 1);
    $('setSoundEnabled').checked = Boolean(state.settings.soundEnabled);
    $('setFontSize').value = state.settings.fontSize || 'md';
  }

  async function performGistSync(silent = false) {
    if (state.syncBusy) return;
    const token = (silent ? state.settings.gistToken : $('gistTokenInput').value || state.settings.gistToken || '').trim();
    const gistId = (silent ? state.settings.gistId : $('gistIdInput').value || state.settings.gistId || '').trim();
    if (!token) {
      if (!silent) showToast('请先输入 GitHub Personal Access Token', 'error');
      return;
    }

    state.syncBusy = true;
    applySettingsToDOM();
    if (!silent) showToast('☁️ 正在与 GitHub 私有 Gist 双向增量合并...', 'info');

    try {
      const res = await QuizStorage.syncWithGitHubGist(
        {
          banks: state.banks,
          deletedBanks: state.deletedBanks,
          recordsByBank: state.recordsByBank,
          dailyStats: state.dailyStats,
          examHistory: state.examHistory
        },
        token,
        gistId
      );

      state.banks = res.merged.banks;
      state.deletedBanks = res.merged.deletedBanks;
      state.recordsByBank = res.merged.recordsByBank;
      state.dailyStats = res.merged.dailyStats;
      state.examHistory = res.merged.examHistory;

      if (!state.activeBankId || !state.banks.some((b) => b.id === state.activeBankId)) {
        state.activeBankId = state.banks[0] ? state.banks[0].id : null;
      }

      state.settings.gistToken = token;
      state.settings.gistId = res.gistId;
      state.settings.lastSyncAt = res.merged.syncedAt;

      await Promise.all([
        QuizStorage.saveBanks(state.banks),
        QuizStorage.saveDeletedBanks(state.deletedBanks),
        QuizStorage.saveRecords(state.recordsByBank),
        QuizStorage.saveDailyStats(state.dailyStats),
        QuizStorage.saveExamHistory(state.examHistory),
        QuizStorage.saveActiveBankId(state.activeBankId),
        QuizStorage.saveSettings(state.settings)
      ]);

      if (!silent) {
        showToast('🎉 多端云同步完成！所有题库与刷题进度已无损合并', 'success');
        if (state.currentView === 'sync') renderSyncSettings();
        if (state.currentView === 'home') renderHome();
      }
    } catch (err) {
      if (!silent) showToast(err.message || '云同步失败', 'error');
    } finally {
      state.syncBusy = false;
      applySettingsToDOM();
    }
  }

  function scheduleAutoGistSync() {
    if (!state.settings.autoGistSync || !(state.settings.gistToken || '').trim()) return;
    if (state.gistDebounceTimer) clearTimeout(state.gistDebounceTimer);
    state.gistDebounceTimer = setTimeout(() => {
      performGistSync(true);
    }, 12000);
  }

  function exportFullSnapshot() {
    const payload = {
      version: 3,
      exportedAt: Date.now(),
      banks: state.banks,
      deletedBanks: state.deletedBanks,
      recordsByBank: state.recordsByBank,
      dailyStats: state.dailyStats,
      examHistory: state.examHistory
    };
    const dateStr = SrsAndMerge.getLocalDateKey();
    downloadFile(`ExamSprint_全量备份_${dateStr}.examsprint.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    showToast('已导出全量备份文件', 'success');
  }

  async function importFullSnapshot(file) {
    if (!file) return;
    try {
      const text = window.OfflineDocReader.decodeSmartText(await file.arrayBuffer());
      const incoming = JSON.parse(text);
      if (!incoming || !Array.isArray(incoming.banks)) {
        throw new Error('备份文件格式不正确');
      }
      const merged = SrsAndMerge.mergeFullPayload(
        {
          banks: state.banks,
          deletedBanks: state.deletedBanks,
          recordsByBank: state.recordsByBank,
          dailyStats: state.dailyStats,
          examHistory: state.examHistory
        },
        incoming
      );
      state.banks = merged.banks;
      state.deletedBanks = merged.deletedBanks;
      state.recordsByBank = merged.recordsByBank;
      state.dailyStats = merged.dailyStats;
      state.examHistory = merged.examHistory;
      if (!state.activeBankId || !state.banks.some((b) => b.id === state.activeBankId)) {
        state.activeBankId = state.banks[0] ? state.banks[0].id : null;
      }
      await Promise.all([
        QuizStorage.saveBanks(state.banks),
        QuizStorage.saveDeletedBanks(state.deletedBanks),
        QuizStorage.saveRecords(state.recordsByBank),
        QuizStorage.saveDailyStats(state.dailyStats),
        QuizStorage.saveExamHistory(state.examHistory),
        QuizStorage.saveActiveBankId(state.activeBankId)
      ]);
      showToast(`🎉 成功无损合并备份（当前共 ${state.banks.length} 个题库）！`, 'success');
      switchView('home');
    } catch (err) {
      showToast('导入备份失败：' + err.message, 'error');
    }
  }

  // ==================== EXPORT PRINTABLE WRONG SHEET ====================
  function exportWrongPrintableSheet() {
    const bank = getActiveBank();
    if (!bank) return;
    const recs = getBankRecords(bank.id);
    const wrongQs = bank.questions
      .filter((q) => recs[q.id] && recs[q.id].inWrongBook)
      .sort((a, b) => (recs[b.id].wrong || 0) - (recs[a.id].wrong || 0));

    if (wrongQs.length === 0) {
      showToast('当前题库还没有错题记录！', 'info');
      return;
    }

    const itemsHtml = wrongQs
      .map((q, idx) => {
        const r = recs[q.id] || {};
        const opts =
          q.options && q.options.length > 0
            ? `<ul class="opts">${q.options.map((o) => `<li><strong>${escapeHtml(o.key)}.</strong> ${escapeHtml(o.text)}</li>`).join('')}</ul>`
            : '';
        return `
        <div class="item">
          <div class="meta">#${idx + 1}（原题号 #${q.index}）· ${TYPE_LABELS[q.type] || q.type} · <span class="err">错 ${r.wrong || 1} 次</span>${
          q.category ? ' · ' + escapeHtml(q.category) : ''
        }</div>
          <div class="stem">${escapeHtml(q.stem)}</div>
          ${opts}
          <div class="ans"><strong>正确答案：</strong>${escapeHtml(q.answer || '未填写')}</div>
          ${q.analysis ? `<div class="ana"><strong>解析：</strong>${escapeHtml(q.analysis)}</div>` : ''}
          ${r.note ? `<div class="note"><strong>助记笔记：</strong>${escapeHtml(r.note)}</div>` : ''}
        </div>`;
      })
      .join('');

    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><title>${escapeHtml(bank.name)} - 错题速记打印单</title>
<style>
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:820px;margin:24px auto;padding:0 20px;color:#111827;line-height:1.65}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #4f46e5;padding-bottom:12px;margin-bottom:20px}
h1{margin:0;font-size:20px}.pbtn{padding:8px 16px;background:#4f46e5;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600}
.item{border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:14px;page-break-inside:avoid}
.meta{font-size:12px;color:#6b7280;margin-bottom:6px}.err{color:#dc2626;font-weight:700}
.stem{font-weight:700;font-size:15px;margin-bottom:8px;white-space:pre-wrap}
.opts{list-style:none;padding:0;margin:0 0 8px;font-size:14px;color:#374151}.opts li{margin-bottom:3px}
.ans{color:#15803d;font-size:14px;background:#f0fdf4;padding:6px 10px;border-radius:6px}
.ana{margin-top:6px;font-size:13px;color:#374151;white-space:pre-wrap}
.note{margin-top:6px;font-size:13px;color:#92400e;background:#fffbeb;padding:6px 10px;border-radius:6px}
@media print{.pbtn{display:none}body{margin:0}}
</style></head><body>
<header><div><h1>${escapeHtml(bank.name)} · 错题高频速记单（共 ${wrongQs.length} 题）</h1><div style="font-size:12px;color:#6b7280">按错误频次排序 · 导出时间：${new Date().toLocaleString('zh-CN')}</div></div><button class="pbtn" onclick="window.print()">🖨️ 打印 / 另存为 PDF</button></header>
${itemsHtml}</body></html>`;

    downloadFile(`${bank.name}_错题速记打印单.html`, html, 'text/html;charset=utf-8');
    showToast('已导出错题打印单（打开即可打印或存为 PDF）', 'success');
  }

  // ==================== CMD+K GLOBAL COMMAND PALETTE ====================
  function openCmdPalette() {
    openModal('cmdPaletteModal');
    const inp = $('cmdSearchInput');
    inp.value = '';
    renderCmdResults('');
    setTimeout(() => inp.focus(), 40);
  }

  function renderCmdResults(query) {
    const q = query.trim().toLowerCase();
    const listEl = $('cmdResultsList');
    const bank = getActiveBank();

    if (!q) {
      const quickCmds = [
        { act: 'mode:sprint', title: '⚔️ 启动「斩杀冲刺模式」', sub: '只刷尚未掌握的题目' },
        { act: 'mode:due', title: '🧠 启动「艾宾浩斯记忆复习」', sub: '科学复习到期题目' },
        { act: 'mode:recite', title: '⚡ 启动「极速背题模式」', sub: '高亮答案与主动回忆闪卡' },
        { act: 'mode:wrong', title: '🎯 启动「错题本高频攻坚」', sub: '优先消灭高频易错题' },
        { act: 'view:analytics', title: '📊 查看「薄弱章节统计诊断」', sub: '定位得分率最低的章节' },
        { act: 'view:import', title: '📤 前往「导入新题库」', sub: '上传 Excel / CSV / Word / TXT / JSON' }
      ];
      listEl.innerHTML = quickCmds
        .map(
          (c) =>
            `<div class="cmd-item" data-cmd-act="${c.act}"><div class="cmd-item-title">${c.title}</div><div class="cmd-item-sub">${c.sub}</div></div>`
        )
        .join('');
    } else if (bank) {
      const hits = bank.questions
        .filter((item) => {
          const hay = [item.stem, item.answer, item.analysis, ...(item.options || []).map((o) => o.text)]
            .join(' ')
            .toLowerCase();
          return hay.includes(q);
        })
        .slice(0, 20);

      if (hits.length === 0) {
        listEl.innerHTML = '<div class="ws-subtitle" style="padding:16px;text-align:center">未找到匹配的题目</div>';
        return;
      }

      listEl.innerHTML = hits
        .map((item) => {
          const opts = (item.options || []).map((o) => `${o.key}.${o.text}`).join('  ');
          return `
            <div class="cmd-item" data-cmd-qid="${escapeHtml(item.id)}">
              <div class="cmd-item-title">#${item.index} [${TYPE_LABELS[item.type] || item.type}] ${escapeHtml(item.stem.slice(0, 75))}</div>
              <div class="cmd-item-sub">${opts ? escapeHtml(opts.slice(0, 80)) + ' · ' : ''}<strong class="text-green">答案：${escapeHtml(item.answer || '无')}</strong></div>
            </div>`;
        })
        .join('');
    }

    listEl.querySelectorAll('[data-cmd-act]').forEach((el) => {
      el.addEventListener('click', () => {
        closeModal('cmdPaletteModal');
        const [kind, val] = el.dataset.cmdAct.split(':');
        if (kind === 'mode') startStudyMode(val);
        else if (kind === 'view') switchView(val);
      });
    });
    listEl.querySelectorAll('[data-cmd-qid]').forEach((el) => {
      el.addEventListener('click', () => {
        closeModal('cmdPaletteModal');
        jumpStudySingleQuestion(el.dataset.cmdQid);
      });
    });
  }

  // ==================== QUESTION EDIT / ADD MODAL ====================
  function openEditQuestionModal(qId = null) {
    const bank = getActiveBank();
    if (!bank) return;
    state.editingQuestionId = qId;
    const q = qId ? bank.questions.find((x) => x.id === qId) : null;

    $('editQModalTitle').textContent = q ? `✏️ 编辑第 #${q.index} 题` : '➕ 手动新增题目';
    $('editQType').value = q ? q.type : 'single';
    $('editQCategory').value = q ? q.category || '' : '';
    $('editQStem').value = q ? q.stem : '';
    $('editQAnswer').value = q ? q.answer || '' : '';
    $('editQAnalysis').value = q ? q.analysis || '' : '';

    const opts =
      q && q.options && q.options.length > 0
        ? q.options
        : [
            { key: 'A', text: '' },
            { key: 'B', text: '' },
            { key: 'C', text: '' },
            { key: 'D', text: '' }
          ];
    renderEditOptionRows(opts);
    $('editQOptionsGroup').classList.toggle('hidden', $('editQType').value !== 'single' && $('editQType').value !== 'multiple');
    openModal('editQuestionModal');
  }

  function renderEditOptionRows(options) {
    const container = $('editQOptionsList');
    container.innerHTML = options
      .map(
        (o, idx) => `
      <div class="edit-opt-row">
        <input type="text" class="form-input edit-opt-key" value="${escapeHtml(o.key || OPTION_LETTERS[idx] || '')}" maxlength="2" />
        <input type="text" class="form-input edit-opt-text" value="${escapeHtml(o.text || '')}" placeholder="输入选项内容..." />
        <button type="button" class="icon-btn del-opt-btn">✕</button>
      </div>`
      )
      .join('');
    container.querySelectorAll('.del-opt-btn').forEach((b) => b.addEventListener('click', () => b.closest('.edit-opt-row').remove()));
  }

  async function saveEditedQuestion() {
    const bank = getActiveBank();
    if (!bank) return;
    const type = $('editQType').value;
    const stem = $('editQStem').value.trim();
    if (!stem) {
      showToast('题干不能为空', 'error');
      return;
    }

    const options = [];
    if (type === 'single' || type === 'multiple') {
      document.querySelectorAll('#editQOptionsList .edit-opt-row').forEach((row, i) => {
        const key = row.querySelector('.edit-opt-key').value.trim().toUpperCase() || OPTION_LETTERS[i];
        const text = row.querySelector('.edit-opt-text').value.trim();
        if (text) options.push({ key, text });
      });
    }

    const rawObj = {
      id: state.editingQuestionId || undefined,
      type,
      category: $('editQCategory').value.trim(),
      stem,
      options,
      answer: $('editQAnswer').value.trim(),
      analysis: $('editQAnalysis').value.trim()
    };

    if (state.editingQuestionId) {
      const idx = bank.questions.findIndex((q) => q.id === state.editingQuestionId);
      if (idx >= 0) {
        const fin = QuestionParser.finalizeQuestion(rawObj, idx);
        fin.id = state.editingQuestionId;
        bank.questions[idx] = fin;
        if (state.session) {
          const sItem = state.session.items.find((it) => it.questionId === fin.id);
          if (sItem) sItem.displayOptions = fin.options.map((o) => ({ displayKey: o.key, origKey: o.key, text: o.text }));
        }
      }
    } else {
      bank.questions.push(QuestionParser.finalizeQuestion(rawObj, bank.questions.length));
    }

    bank.updatedAt = Date.now();
    await QuizStorage.saveBanks(state.banks);
    scheduleAutoGistSync();
    closeModal('editQuestionModal');
    showToast('保存成功', 'success');

    if (state.currentView === 'study') renderStudyView();
    else if (state.currentView === 'manage') renderManage();
    else renderHome();
  }

  async function deleteQuestion(qId) {
    const bank = getActiveBank();
    if (!bank || !confirm('确定删除这道题吗？')) return;
    bank.questions = bank.questions.filter((q) => q.id !== qId).map((q, i) => ({ ...q, index: i + 1 }));
    bank.updatedAt = Date.now();
    await QuizStorage.saveBanks(state.banks);
    scheduleAutoGistSync();
    renderManage();
  }

  // ==================== OVERLAYS & KEYBOARD ====================
  function openModal(id) { $(id).classList.remove('hidden'); }
  function closeModal(id) { $(id).classList.add('hidden'); }
  function openMobileSidebar() {
    $('appSidebar').classList.add('mobile-open');
    $('sidebarOverlay').classList.remove('hidden');
  }
  function closeMobileSidebar() {
    $('appSidebar').classList.remove('mobile-open');
    $('sidebarOverlay').classList.add('hidden');
  }
  function openMobileSheet() {
    $('answerSheet').classList.add('open');
    $('sheetBackdrop').classList.remove('hidden');
  }
  function closeMobileSheet() {
    $('answerSheet').classList.remove('open');
    $('sheetBackdrop').classList.add('hidden');
  }

  function handleGlobalKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCmdPalette();
      return;
    }

    const openModalEl = document.querySelector('.modal:not(.hidden)');
    if (e.key === 'Escape') {
      if (openModalEl) closeModal(openModalEl.id);
      closeMobileSheet();
      closeMobileSidebar();
      return;
    }
    if (openModalEl) return;

    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if (state.currentView !== 'study' || !state.session) return;
    const ctx = getCurrentContext();
    if (!ctx) return;
    const { session, item, question } = ctx;
    const key = e.key;
    const lower = key.toLowerCase();

    if (key === 'ArrowLeft') { e.preventDefault(); goPrevQuestion(); return; }
    if (key === 'ArrowRight') { e.preventDefault(); goNextQuestion(); return; }
    if (lower === 'f') { e.preventDefault(); setZenMode(!state.zenMode); return; }
    if (lower === 's') { e.preventDefault(); toggleBookmark(); return; }
    if (lower === 'k' && session.mode !== 'exam') { e.preventDefault(); toggleMastered(); return; }
    if (lower === 'r' && session.mode === 'recite') {
      e.preventDefault();
      if (session.reciteMasked && !item.revealed) item.revealed = true;
      else session.reciteMasked = !session.reciteMasked;
      renderStudyView();
      return;
    }

    if (
      session.mode !== 'recite' &&
      session.mode !== 'exam-review' &&
      (question.type === 'single' || question.type === 'multiple' || question.type === 'judge')
    ) {
      let idx = -1;
      if (/^[1-8]$/.test(key)) idx = parseInt(key, 10) - 1;
      else if (/^[a-h]$/.test(lower) && question.type !== 'judge') idx = lower.charCodeAt(0) - 97;
      if (idx >= 0 && item.displayOptions[idx]) {
        e.preventDefault();
        handleOptionClick(item.displayOptions[idx].displayKey);
        return;
      }
    }

    if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      if (session.mode === 'recite' && session.reciteMasked && !item.revealed) {
        item.revealed = true; renderStudyView(); return;
      }
      if (question.type === 'short' && session.mode !== 'exam' && !item.revealed && !item.submitted) {
        item.revealed = true; renderStudyView(); return;
      }
      if (question.type === 'multiple' && session.mode !== 'exam' && session.mode !== 'recite' && !item.submitted) {
        if (item.selectedKeys.length > 0) gradeCurrentObjective();
        return;
      }
      goNextQuestion();
    }
  }

  function toggleBookmark() {
    const ctx = getCurrentContext();
    if (!ctx) return;
    ctx.record.bookmarked = !ctx.record.bookmarked;
    ctx.record.updatedAt = Date.now();
    QuizStorage.saveRecords(state.recordsByBank);
    scheduleAutoGistSync();
    showToast(ctx.record.bookmarked ? '★ 已收藏重点题' : '已取消收藏', 'info');
    renderStudyView();
  }

  function toggleMastered() {
    const ctx = getCurrentContext();
    if (!ctx) return;
    ctx.record.mastered = !ctx.record.mastered;
    ctx.record.streak = ctx.record.mastered ? Math.max(1, state.settings.masteryStreakTarget || 1) : 0;
    ctx.record.updatedAt = Date.now();
    QuizStorage.saveRecords(state.recordsByBank);
    scheduleAutoGistSync();
    showToast(ctx.record.mastered ? '⚔️ 已斩杀！' : '已取消斩杀标记', 'success');
    renderStudyView();
  }

  // ==================== BIND ALL UI EVENTS ====================
  function bindEvents() {
    $('brandHomeBtn').addEventListener('click', () => switchView('home'));
    document.querySelectorAll('.snav-item').forEach((btn) =>
      btn.addEventListener('click', () => switchView(btn.dataset.view))
    );

    $('mobileMenuBtn').addEventListener('click', openMobileSidebar);
    $('sidebarOverlay').addEventListener('click', closeMobileSidebar);
    $('mobileSearchBtn').addEventListener('click', openCmdPalette);
    $('openCmdPaletteBtn').addEventListener('click', openCmdPalette);
    $('cmdSearchInput').addEventListener('input', (e) => renderCmdResults(e.target.value));

    document.querySelectorAll('.tseg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.settings.theme = btn.dataset.setTheme;
        applySettingsToDOM();
        QuizStorage.saveSettings(state.settings);
      });
    });

    $('activeBankSelect').addEventListener('change', async (e) => {
      state.activeBankId = e.target.value;
      await QuizStorage.saveActiveBankId(state.activeBankId);
      if (state.currentView === 'study') switchView('home');
      else switchView(state.currentView);
    });

    // Dashboard events
    $('heroImportBtn').addEventListener('click', () => switchView('import'));
    $('heroDemoBtn').addEventListener('click', loadDemoBank);
    $('loadDemoBankBtn').addEventListener('click', loadDemoBank);

    $('examCountdownBtn').addEventListener('click', () => switchView('sync'));
    $('quickGistSyncBtn').addEventListener('click', () => {
      if ((state.settings.gistToken || '').trim()) performGistSync(false);
      else switchView('sync');
    });

    ['filterTypeSelect', 'filterCategorySelect', 'rangeStartInput', 'rangeEndInput'].forEach((id) => {
      $(id).addEventListener('input', updateFilteredModeBadges);
      $(id).addEventListener('change', updateFilteredModeBadges);
    });
    $('clearRangeBtn').addEventListener('click', () => {
      $('rangeStartInput').value = '';
      $('rangeEndInput').value = '';
      $('filterTypeSelect').value = 'all';
      $('filterCategorySelect').value = 'all';
      updateFilteredModeBadges();
    });

    $('quickShuffleOpts').addEventListener('change', (e) => {
      state.settings.shuffleOptions = e.target.checked;
      QuizStorage.saveSettings(state.settings);
    });
    $('quickAutoNext').addEventListener('change', (e) => {
      state.settings.autoNextOnCorrect = e.target.checked;
      QuizStorage.saveSettings(state.settings);
    });

    document.querySelectorAll('.mode-card').forEach((card) => {
      card.addEventListener('click', () => {
        const m = card.dataset.mode;
        if (m === 'exam') openExamConfigModal();
        else startStudyMode(m);
      });
    });

    $('statDueTile').addEventListener('click', () => startStudyMode('due'));
    $('statWrongTile').addEventListener('click', () => startStudyMode('wrong'));
    $('statBookmarkTile').addEventListener('click', () => startStudyMode('bookmark'));
    $('startBookmarkModeBtn').addEventListener('click', () => startStudyMode('bookmark'));
    $('exportWrongSheetBtn').addEventListener('click', exportWrongPrintableSheet);

    $('resumeContinueBtn').addEventListener('click', resumeSavedSession);
    $('resumeDismissBtn').addEventListener('click', async () => {
      const b = getActiveBank();
      if (b) await QuizStorage.clearSession(b.id);
      $('resumeBanner').classList.add('hidden');
    });

    // Study view events
    $('exitStudyBtn').addEventListener('click', () => {
      if (state.session && state.session.mode === 'exam' && !confirm('正在模拟考试中，确定放弃当前进度返回工作台吗？')) return;
      switchView('home');
    });
    $('zenModeBtn').addEventListener('click', () => setZenMode(!state.zenMode));
    $('reciteMaskToggleBtn').addEventListener('click', () => {
      if (!state.session) return;
      state.session.reciteMasked = !state.session.reciteMasked;
      state.session.items.forEach((it) => (it.revealed = false));
      renderStudyView();
    });
    $('toggleSheetBtn').addEventListener('click', openMobileSheet);
    $('closeSheetBtn').addEventListener('click', closeMobileSheet);
    $('sheetBackdrop').addEventListener('click', closeMobileSheet);

    $('qBookmarkBtn').addEventListener('click', toggleBookmark);
    $('qMasterBtn').addEventListener('click', toggleMastered);
    $('qEditBtn').addEventListener('click', () => {
      const ctx = getCurrentContext();
      if (ctx) openEditQuestionModal(ctx.question.id);
    });
    $('copyAiPromptBtn').addEventListener('click', copyAiExplainPrompt);
    $('pasteSaveAnalysisBtn').addEventListener('click', pasteAndSaveAnalysis);

    $('qNoteInput').addEventListener('input', (e) => {
      const ctx = getCurrentContext();
      if (!ctx) return;
      ctx.record.note = e.target.value;
      ctx.record.updatedAt = Date.now();
      QuizStorage.saveRecords(state.recordsByBank);
      scheduleAutoGistSync();
    });

    $('prevQuestionBtn').addEventListener('click', goPrevQuestion);
    $('nextQuestionBtn').addEventListener('click', goNextQuestion);
    $('submitExamBtn').addEventListener('click', () => submitMockExam(false));
    $('sheetSubmitExamBtn').addEventListener('click', () => {
      closeMobileSheet();
      submitMockExam(false);
    });
    $('sheetRestartBtn').addEventListener('click', () => {
      if (state.session && confirm('确定从第 1 题重新开始本轮吗？')) {
        closeMobileSheet();
        startStudyMode(state.session.mode);
      }
    });

    // Exam modal & result
    document.querySelectorAll('.exam-count-preset').forEach((b) =>
      b.addEventListener('click', () => {
        const max = parseInt($('examCountInput').max, 10) || 20;
        $('examCountInput').value = b.dataset.count === 'all' ? max : Math.min(max, parseInt(b.dataset.count, 10));
      })
    );
    document.querySelectorAll('.exam-time-preset').forEach((b) =>
      b.addEventListener('click', () => ($('examMinutesInput').value = b.dataset.min))
    );
    $('startExamConfirmBtn').addEventListener('click', () => {
      const max = parseInt($('examCountInput').max, 10) || 1;
      const count = Math.max(1, Math.min(max, parseInt($('examCountInput').value, 10) || 20));
      const minutes = Math.max(1, Math.min(300, parseInt($('examMinutesInput').value, 10) || 30));
      closeModal('examConfigModal');
      startStudyMode('exam', null, { count, minutes, shuffleOptions: $('examShuffleOpts').checked });
    });

    $('resReviewWrongBtn').addEventListener('click', () => startExamReview(true));
    $('resReviewAllBtn').addEventListener('click', () => startExamReview(false));
    $('resRetakeBtn').addEventListener('click', openExamConfigModal);
    $('resBackHomeBtn').addEventListener('click', () => switchView('home'));

    // Import events
    const dz = $('dropzone');
    const fi = $('fileInput');
    dz.addEventListener('click', () => fi.click());
    fi.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) handleFileUpload(e.target.files[0]);
    });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0]);
    });

    $('fillPasteSampleBtn').addEventListener('click', () => ($('pasteInput').value = SAMPLE_PASTE_TEXT));
    $('clearPasteBtn').addEventListener('click', () => ($('pasteInput').value = ''));
    $('parsePasteBtn').addEventListener('click', handlePasteParse);

    $('sheetSelect').addEventListener('change', (e) => {
      const draft = state.importDraft;
      if (!draft || draft.kind !== 'table') return;
      draft.activeSheetIndex = parseInt(e.target.value, 10);
      const rows = draft.sheets[draft.activeSheetIndex].rows;
      const det = QuestionParser.autoDetectTableMapping(rows);
      Object.assign(draft, det, { detectedHeaderRowIndex: det.headerRowIndex });
      reparseTableDraft();
    });
    $('hasHeaderCheck').addEventListener('change', reparseTableDraft);

    $('cancelImportBtn').addEventListener('click', () => {
      state.importDraft = null;
      $('importPreviewCard').classList.add('hidden');
    });
    $('confirmImportBtn').addEventListener('click', () => commitImport(false));
    $('appendImportBtn').addEventListener('click', () => commitImport(true));

    $('dlCsvTplBtn').addEventListener('click', () => {
      const csv = '\uFEFF题型,题目,选项A,选项B,选项C,选项D,答案,解析,章节\n单选题,HTTPS默认端口号是？,21,22,80,443,D,HTTPS默认443端口,网络基础\n';
      downloadFile('标准题库模板.csv', csv, 'text/csv;charset=utf-8');
    });
    $('dlTxtTplBtn').addEventListener('click', () => downloadFile('标准题库模板.txt', SAMPLE_PASTE_TEXT, 'text/plain;charset=utf-8'));
    $('dlJsonTplBtn').addEventListener('click', () =>
      downloadFile('标准题库模板.json', JSON.stringify({ questions: createDemoQuestions().slice(0, 3) }, null, 2), 'application/json;charset=utf-8')
    );

    // Manage events
    $('runHealthCheckBtn').addEventListener('click', runBankHealthInspector);
    $('addQuestionBtn').addEventListener('click', () => {
      if (!getActiveBank()) { showToast('请先导入题库', 'error'); return; }
      openEditQuestionModal(null);
    });
    $('renameBankBtn').addEventListener('click', async () => {
      const b = getActiveBank();
      if (!b) return;
      const name = prompt('输入新的题库名称：', b.name);
      if (name && name.trim()) {
        b.name = name.trim();
        b.updatedAt = Date.now();
        await QuizStorage.saveBanks(state.banks);
        scheduleAutoGistSync();
        renderManage();
      }
    });
    $('exportBankJsonBtn').addEventListener('click', () => {
      const b = getActiveBank();
      if (b) downloadFile(`${b.name}.json`, JSON.stringify(b, null, 2), 'application/json;charset=utf-8');
    });
    $('exportWrongMdBtn').addEventListener('click', exportWrongPrintableSheet);
    $('resetProgressBtn').addEventListener('click', async () => {
      const b = getActiveBank();
      if (!b || !confirm(`确定清空「${b.name}」的所有学习记录吗？（题目保留）`)) return;
      state.recordsByBank[b.id] = {};
      await QuizStorage.saveRecords(state.recordsByBank);
      await QuizStorage.clearSession(b.id);
      showToast('学习记录已清空', 'info');
      renderManage();
    });
    $('deleteBankBtn').addEventListener('click', async () => {
      const b = getActiveBank();
      if (!b || !confirm(`确定永久删除题库「${b.name}」吗？`)) return;
      state.banks = state.banks.filter((x) => x.id !== b.id);
      state.deletedBanks[b.id] = Date.now();
      delete state.recordsByBank[b.id];
      await QuizStorage.clearSession(b.id);
      state.activeBankId = state.banks[0] ? state.banks[0].id : null;
      await Promise.all([
        QuizStorage.saveBanks(state.banks),
        QuizStorage.saveDeletedBanks(state.deletedBanks),
        QuizStorage.saveRecords(state.recordsByBank),
        QuizStorage.saveActiveBankId(state.activeBankId)
      ]);
      scheduleAutoGistSync();
      renderManage();
    });

    ['manageSearchInput', 'manageTypeFilter', 'manageStatusFilter'].forEach((id) => {
      $(id).addEventListener('input', () => { state.manageRenderLimit = 50; renderManageList(); });
      $(id).addEventListener('change', () => { state.manageRenderLimit = 50; renderManageList(); });
    });
    $('manageLoadMoreBtn').addEventListener('click', () => { state.manageRenderLimit += 80; renderManageList(); });

    // Analytics events
    $('chapterSortSelect').addEventListener('change', renderAnalytics);

    // Sync & Settings events
    $('syncGistNowBtn').addEventListener('click', () => performGistSync(false));
    $('clearGistBtn').addEventListener('click', async () => {
      state.settings.gistToken = '';
      state.settings.gistId = '';
      await QuizStorage.saveSettings(state.settings);
      applySettingsToDOM();
      renderSyncSettings();
      showToast('已断开 GitHub Gist 绑定', 'info');
    });
    $('autoGistSyncCheck').addEventListener('change', (e) => {
      state.settings.autoGistSync = e.target.checked;
      QuizStorage.saveSettings(state.settings);
    });
    $('exportSnapshotBtn').addEventListener('click', exportFullSnapshot);
    $('importSnapshotBtn').addEventListener('click', () => $('snapshotFileInput').click());
    $('snapshotFileInput').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) importFullSnapshot(e.target.files[0]);
      e.target.value = '';
    });

    const savePrefs = () => {
      state.settings.examTitle = $('setExamTitle').value.trim();
      state.settings.examDate = $('setExamDate').value;
      state.settings.autoNextOnCorrect = $('setAutoNext').checked;
      state.settings.autoNextDelayMs = parseInt($('setAutoNextDelay').value, 10) || 550;
      state.settings.shuffleOptions = $('setShuffleOpts').checked;
      state.settings.autoRemoveWrongOnCorrect = $('setAutoRemoveWrong').checked;
      state.settings.masteryStreakTarget = parseInt($('setMasteryTarget').value, 10) || 1;
      state.settings.soundEnabled = $('setSoundEnabled').checked;
      state.settings.fontSize = $('setFontSize').value || 'md';
      applySettingsToDOM();
      QuizStorage.saveSettings(state.settings);
    };
    [
      'setExamTitle',
      'setExamDate',
      'setAutoNext',
      'setAutoNextDelay',
      'setShuffleOpts',
      'setAutoRemoveWrong',
      'setMasteryTarget',
      'setSoundEnabled',
      'setFontSize'
    ].forEach((id) => {
      $(id).addEventListener('change', savePrefs);
      $(id).addEventListener('input', savePrefs);
    });

    // Edit modal events
    $('editQType').addEventListener('change', () => {
      const t = $('editQType').value;
      $('editQOptionsGroup').classList.toggle('hidden', t !== 'single' && t !== 'multiple');
    });
    $('addOptionRowBtn').addEventListener('click', () => {
      const rows = document.querySelectorAll('#editQOptionsList .edit-opt-row');
      const nextKey = OPTION_LETTERS[rows.length] || String(rows.length + 1);
      const div = document.createElement('div');
      div.className = 'edit-opt-row';
      div.innerHTML = `
        <input type="text" class="form-input edit-opt-key" value="${nextKey}" maxlength="2" />
        <input type="text" class="form-input edit-opt-text" placeholder="输入选项内容..." />
        <button type="button" class="icon-btn del-opt-btn">✕</button>`;
      div.querySelector('.del-opt-btn').addEventListener('click', () => div.remove());
      $('editQOptionsList').appendChild(div);
    });
    $('saveEditQuestionBtn').addEventListener('click', saveEditedQuestion);

    document.querySelectorAll('[data-close-modal]').forEach((el) =>
      el.addEventListener('click', () => closeModal(el.dataset.closeModal))
    );
    document.addEventListener('keydown', handleGlobalKeydown);
  }

  // ==================== BOOTSTRAP ====================
  async function init() {
    const saved = await QuizStorage.loadAll();
    state.banks = saved.banks;
    state.deletedBanks = saved.deletedBanks;
    state.recordsByBank = saved.recordsByBank;
    state.dailyStats = saved.dailyStats;
    state.settings = saved.settings;
    state.examHistory = saved.examHistory;
    state.activeBankId = saved.activeBankId || (state.banks[0] ? state.banks[0].id : null);

    // Auto-load optional local pre-bundled bank (js/builtin-bank.js, gitignored)
    if (window.BUILTIN_EXAM_BANK) {
      const builtin = window.BUILTIN_EXAM_BANK;
      const loadedIds = Array.isArray(state.settings.loadedBuiltinIds) ? state.settings.loadedBuiltinIds : [];
      if (!state.banks.some((b) => b.id === builtin.id) && !loadedIds.includes(builtin.id)) {
        state.banks.unshift(builtin);
        state.activeBankId = builtin.id;
        state.settings.loadedBuiltinIds = [...loadedIds, builtin.id];
        await Promise.all([
          QuizStorage.saveBanks(state.banks),
          QuizStorage.saveActiveBankId(state.activeBankId),
          QuizStorage.saveSettings(state.settings)
        ]);
      }
    }

    applySettingsToDOM();
    bindEvents();
    await renderHome();

    // Auto background Gist sync on launch if configured
    if (state.settings.autoGistSync && (state.settings.gistToken || '').trim()) {
      performGistSync(true).then(() => {
        if (state.currentView === 'home') renderHome();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
