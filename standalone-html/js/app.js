/**
 * 极速刷题宝 · ExamSprint Application Logic
 * Pure vanilla JS, zero dependencies, 100% offline-ready.
 */
(function () {
  'use strict';

  const { QuestionParser, QuizStorage } = window;
  const TYPE_LABELS = QuestionParser.TYPE_LABELS;
  const OPTION_LETTERS = QuestionParser.OPTION_LETTERS;

  const MODE_META = {
    practice: { label: '顺序刷题', badgeClass: 'pill-blue' },
    random: { label: '随机乱序刷题', badgeClass: 'pill-blue' },
    sprint: { label: '⚔️ 斩杀冲刺', badgeClass: 'pill-purple' },
    recite: { label: '⚡ 极速背题', badgeClass: 'pill-amber' },
    wrong: { label: '🎯 错题本攻坚', badgeClass: 'pill-red' },
    bookmark: { label: '⭐ 重点收藏', badgeClass: 'pill-amber' },
    exam: { label: '⏱️ 全真模拟考', badgeClass: 'pill-green' },
    'exam-review': { label: '📖 模考复盘', badgeClass: 'pill-blue' }
  };

  // ==================== APPLICATION STATE ====================
  const state = {
    banks: [],
    recordsByBank: {},
    settings: { ...QuizStorage.DEFAULT_SETTINGS },
    examHistory: [],
    activeBankId: null,
    currentView: 'home',

    // Saved resumable session for active bank
    savedSession: null,

    // Active study session
    session: null,
    autoNextTimer: null,
    examTimerInterval: null,
    lastExamResult: null,

    // Import preview staging
    importDraft: null,

    // Manage view pagination
    manageRenderLimit: 50,

    // Edit question modal target
    editingQuestionId: null
  };

  // ==================== DOM HELPERS ====================
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
      el.style.transform = 'translateX(16px)';
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
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return String(m).padStart(2, '0') + ':' + String(rem).padStart(2, '0');
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

  // ==================== DATA ACCESSORS ====================
  function getActiveBank() {
    if (!state.activeBankId) return state.banks[0] || null;
    return state.banks.find((b) => b.id === state.activeBankId) || state.banks[0] || null;
  }

  function getBankRecords(bankId) {
    if (!bankId) return {};
    if (!state.recordsByBank[bankId]) {
      state.recordsByBank[bankId] = {};
    }
    return state.recordsByBank[bankId];
  }

  function getQuestionRecord(bankId, qId) {
    const map = getBankRecords(bankId);
    if (!map[qId]) {
      map[qId] = QuizStorage.createEmptyRecord();
    }
    return map[qId];
  }

  // ==================== BUILT-IN DEMO BANK & TEMPLATES ====================
  function createDemoQuestions() {
    return QuestionParser.parseJson(
      JSON.stringify([
        {
          type: 'single',
          category: '第一章 计算机网络基础',
          stem: 'HTTP 协议默认使用的传输层端口号是？',
          options: ['21', '22', '80', '443'],
          answer: 'C',
          analysis: 'HTTP 默认端口为 80，HTTPS 默认端口为 443，FTP 为 21，SSH 为 22。'
        },
        {
          type: 'single',
          category: '第一章 计算机网络基础',
          stem: '在 OSI 七层参考模型中，负责端到端可靠传输与流量控制的是哪一层？',
          options: ['网络层', '传输层', '会话层', '数据链路层'],
          answer: 'B',
          analysis: '传输层（第4层，如 TCP/UDP）提供端到端（进程到进程）通信，TCP 负责可靠传输与流量/拥塞控制。'
        },
        {
          type: 'single',
          category: '第一章 计算机网络基础',
          stem: '下列 IPv4 地址中，属于私有（内网）IP 地址范围的是？',
          options: ['114.114.114.114', '192.168.10.25', '8.8.8.8', '172.32.0.1'],
          answer: 'B',
          analysis: '私有 IPv4 网段为：10.0.0.0/8、172.16.0.0/12（172.16~172.31）、192.168.0.0/16。172.32.0.1 不在内网段中。'
        },
        {
          type: 'multiple',
          category: '第一章 计算机网络基础',
          stem: '以下关于 TCP 与 UDP 的区别，说法正确的有哪些？',
          options: [
            'TCP 是面向连接的，UDP 是无连接的',
            'TCP 提供可靠交付，UDP 尽最大努力交付',
            'UDP 首部开销比 TCP 更小，实时性更好',
            'TCP 支持一对多广播通信'
          ],
          answer: 'ABC',
          analysis: 'TCP 只能一对一（单播），不支持广播或多播；UDP 支持一对一、一对多、多对多通信。'
        },
        {
          type: 'multiple',
          category: '第二章 操作系统与数据结构',
          stem: '产生操作系统“死锁”的四个必要条件包括？',
          options: ['互斥条件', '请求和保持条件', '不剥夺条件', '循环等待条件'],
          answer: 'ABCD',
          analysis: '死锁四大必要条件缺一不可：互斥、请求与保持、不可剥夺、循环等待。破坏其一即可预防死锁。'
        },
        {
          type: 'judge',
          category: '第一章 计算机网络基础',
          stem: 'HTTPS 协议是在 HTTP 与 TCP 之间加入了 SSL/TLS 安全加密层。',
          answer: '对',
          analysis: 'HTTPS = HTTP + TLS/SSL，提供数据加密、身份认证和完整性校验。'
        },
        {
          type: 'judge',
          category: '第二章 操作系统与数据结构',
          stem: '队列（Queue）是一种“后进先出（LIFO）”的线性数据结构。',
          answer: '错',
          analysis: '队列是先进先出（FIFO），栈（Stack）才是后进先出（LIFO）。'
        },
        {
          type: 'single',
          category: '第二章 操作系统与数据结构',
          stem: '在有序数组中使用二分查找（Binary Search）的时间复杂度为？',
          options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
          answer: 'B',
          analysis: '每次比较将搜索区间缩小一半，因此最坏与平均时间复杂度均为 O(log n)。'
        },
        {
          type: 'fill',
          category: '第一章 计算机网络基础',
          stem: '将域名（如 www.example.com）解析为 IP 地址的协议称为 ______（填英文缩写）。',
          answer: 'DNS',
          analysis: 'DNS（Domain Name System，域名系统）负责域名与 IP 地址之间的映射解析。'
        },
        {
          type: 'short',
          category: '第一章 计算机网络基础',
          stem: '简述 TCP 建立连接的“三次握手”过程，以及为什么不能只用两次握手？',
          answer:
            '1）客户端发送 SYN=1, seq=x 请求建立连接；\n2）服务端回复 SYN=1, ACK=1, ack=x+1, seq=y；\n3）客户端发送 ACK=1, ack=y+1 确认。\n原因：防止已失效的旧连接请求报文突然传到服务端，导致服务端误建立连接并浪费资源。',
          analysis: '背诵要点：记住“SYN → SYN+ACK → ACK”以及“防止失效旧请求导致资源浪费”两个采分点。'
        }
      ])
    ).questions;
  }

  const SAMPLE_PASTE_TEXT = `一、单选题
1. 我国的根本大法是（ A ）。
A. 宪法  B. 民法典  C. 刑法  D. 行政法
解析：宪法具有最高的法律效力，是国家的根本大法。

2. HTTP 状态码 404 表示什么含义？
A. 服务器内部错误
B. 请求成功
C. 请求的资源未找到
D. 未授权访问
答案：C
解析：200 成功，401 未授权，404 未找到，500 服务器内部错误。

二、多选题
3. 以下属于常见前端核心技术的有（）
A. HTML
B. CSS
C. JavaScript
D. MySQL
答案：ABC
解析：MySQL 属于后端关系型数据库管理系统。

三、判断题
4. 二进制数 1010 转换为十进制数是 10。（对）
解析：1×8 + 0×4 + 1×2 + 0×1 = 10。

四、填空题
5. 操作系统中，资源分配的基本单位是进程，CPU 调度的基本单位是 ______。
答案：线程`;

  // ==================== VIEW ROUTING & THEME ====================
  function applySettingsToDOM() {
    document.documentElement.setAttribute('data-theme', state.settings.theme || 'light');
    document.documentElement.setAttribute('data-font', state.settings.fontSize || 'md');
    $('themeToggleBtn').textContent = state.settings.theme === 'dark' ? '☀️' : '🌙';
    $('quickShuffleOpts').checked = Boolean(state.settings.shuffleOptions);
    $('quickAutoNext').checked = Boolean(state.settings.autoNextOnCorrect);
  }

  function switchView(viewName) {
    if (state.currentView === 'study' && viewName !== 'study') {
      stopAutoNextTimer();
      stopExamTimer();
    }
    state.currentView = viewName;

    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const target = $('view-' + viewName);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    if (viewName === 'home') renderHome();
    if (viewName === 'manage') renderManage();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderBankSwitcher() {
    const select = $('activeBankSelect');
    const wrap = $('bankSwitcherWrap');
    if (state.banks.length === 0) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    select.innerHTML = state.banks
      .map(
        (b) =>
          `<option value="${escapeHtml(b.id)}" ${b.id === state.activeBankId ? 'selected' : ''}>${escapeHtml(
            b.name
          )} (${b.questions.length}题)</option>`
      )
      .join('');
  }

  // ==================== HOME / DASHBOARD ====================
  function getFilteredQuestions(bank) {
    if (!bank) return [];
    const typeFilter = $('filterTypeSelect').value;
    const catFilter = $('filterCategorySelect').value;
    return bank.questions.filter((q) => {
      if (typeFilter !== 'all' && q.type !== typeFilter) return false;
      if (catFilter !== 'all' && (q.category || '未分类') !== catFilter) return false;
      return true;
    });
  }

  async function renderHome() {
    renderBankSwitcher();
    const bank = getActiveBank();
    if (!bank) {
      $('homeEmptyState').classList.remove('hidden');
      $('homeDashboard').classList.add('hidden');
      return;
    }
    $('homeEmptyState').classList.add('hidden');
    $('homeDashboard').classList.remove('hidden');

    const records = getBankRecords(bank.id);
    const total = bank.questions.length;

    let attempted = 0;
    let totalAttempts = 0;
    let totalCorrect = 0;
    let wrongCount = 0;
    let bookmarkCount = 0;
    let masteredCount = 0;

    const categories = new Set();

    for (const q of bank.questions) {
      if (q.category) categories.add(q.category);
      const rec = records[q.id];
      if (rec) {
        if (rec.attempts > 0) attempted++;
        totalAttempts += rec.attempts || 0;
        totalCorrect += rec.correct || 0;
        if (rec.inWrongBook) wrongCount++;
        if (rec.bookmarked) bookmarkCount++;
        if (rec.mastered) masteredCount++;
      }
    }

    const unmastered = total - masteredCount;
    const masteredPct = total > 0 ? Math.round((masteredCount / total) * 100) : 0;
    const donePct = total > 0 ? Math.round((attempted / total) * 100) : 0;
    const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) + '%' : '--';

    $('dashBankTitle').textContent = bank.name;
    $('dashBankTotalBadge').textContent = total + ' 题';
    $('dashProgressLabel').textContent = `总体掌握进度 ${masteredPct}%`;
    $('dashMasteredText').textContent = `已斩杀掌握 ${masteredCount} / ${total}`;
    $('dashMasteredBar').style.width = masteredPct + '%';
    $('dashDoneBar').style.width = donePct + '%';

    $('statAttempted').textContent = attempted;
    $('statAccuracy').textContent = accuracy;
    $('statWrong').textContent = wrongCount;
    $('statBookmark').textContent = bookmarkCount;
    $('statUnmastered').textContent = unmastered;
    $('bookmarkBtnCount').textContent = bookmarkCount;

    // Populate categories dropdown
    const catRow = $('filterCategoryRow');
    const catSelect = $('filterCategorySelect');
    const prevCat = catSelect.value;
    if (categories.size > 0) {
      catRow.classList.remove('hidden');
      const opts = ['<option value="all">全部章节</option>'];
      Array.from(categories).forEach((c) => {
        opts.push(`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`);
      });
      catSelect.innerHTML = opts.join('');
      if (Array.from(categories).includes(prevCat)) {
        catSelect.value = prevCat;
      }
    } else {
      catRow.classList.add('hidden');
      catSelect.innerHTML = '<option value="all">全部章节</option>';
    }

    updateFilteredModeCounts();

    // Check saved session banner
    state.savedSession = await QuizStorage.loadSession(bank.id);
    const banner = $('resumeBanner');
    if (state.savedSession && state.savedSession.items && state.savedSession.items.length > 0) {
      const mLabel = (MODE_META[state.savedSession.mode] || {}).label || '刷题';
      $('resumeText').textContent = `${mLabel} · 进行到第 ${state.savedSession.currentIndex + 1} / ${state.savedSession.items.length} 题`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }

    // Render exam history for active bank
    const histEl = $('examHistoryList');
    const bankHist = state.examHistory.filter((h) => h.bankId === bank.id).slice(0, 5);
    if (bankHist.length === 0) {
      histEl.innerHTML = '<div class="muted-empty">暂无模拟考试记录，考前建议至少做一套全真模拟！</div>';
    } else {
      histEl.innerHTML = bankHist
        .map((h) => {
          const scoreCls = h.score >= 60 ? 'text-green' : 'text-red';
          const dt = new Date(h.date);
          const timeStr = `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(
            dt.getMinutes()
          ).padStart(2, '0')}`;
          return `<div class="history-item">
            <span>${timeStr} · 共 ${h.total} 题（对 ${h.correct}）</span>
            <strong class="${scoreCls}">${h.score} 分</strong>
          </div>`;
        })
        .join('');
    }
  }

  function updateFilteredModeCounts() {
    const bank = getActiveBank();
    if (!bank) return;
    const records = getBankRecords(bank.id);
    const filtered = getFilteredQuestions(bank);
    const unmasteredInFilter = filtered.filter((q) => !(records[q.id] && records[q.id].mastered)).length;
    const wrongInFilter = filtered.filter((q) => records[q.id] && records[q.id].inWrongBook).length;

    $('filteredCountHint').textContent = `当前筛选：共 ${filtered.length} 题`;
    $('modeTagPractice').textContent = `${filtered.length} 题`;
    $('modeTagSprint').textContent = `待斩 ${unmasteredInFilter}`;
    $('modeTagWrong').textContent = `${wrongInFilter} 错题`;
  }

  // ==================== STUDY SESSION ENGINE ====================
  function buildSessionItem(question, shouldShuffleOptions) {
    let displayOptions = [];
    if (question.options && question.options.length > 0) {
      if (shouldShuffleOptions && (question.type === 'single' || question.type === 'multiple')) {
        const shuffled = shuffleArray(question.options);
        displayOptions = shuffled.map((opt, idx) => ({
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
      selectedKeys: [], // displayKeys for options, or string for fill/short
      userText: '',
      submitted: false,
      isCorrect: null,
      revealed: false // used for short answer & recite mask
    };
  }

  function startStudyMode(mode, customList = null, examOpts = null) {
    const bank = getActiveBank();
    if (!bank || bank.questions.length === 0) {
      showToast('请先导入题库', 'error');
      return;
    }

    const records = getBankRecords(bank.id);
    let pool = customList ? customList.slice() : getFilteredQuestions(bank);

    if (mode === 'sprint') {
      pool = pool.filter((q) => !(records[q.id] && records[q.id].mastered));
      if (pool.length === 0) {
        showToast('🎉 当前筛选范围内的题目已经全部斩杀完毕！', 'success');
        return;
      }
      pool = shuffleArray(pool);
    } else if (mode === 'wrong') {
      pool = pool
        .filter((q) => records[q.id] && records[q.id].inWrongBook)
        .sort((a, b) => ((records[b.id] && records[b.id].wrong) || 0) - ((records[a.id] && records[a.id].wrong) || 0));
      if (pool.length === 0) {
        showToast('👏 当前范围内没有错题！继续保持！', 'success');
        return;
      }
    } else if (mode === 'bookmark') {
      pool = bank.questions.filter((q) => records[q.id] && records[q.id].bookmarked);
      if (pool.length === 0) {
        showToast('暂无收藏题目，刷题时按 S 键即可快速收藏重点题', 'info');
        return;
      }
    } else if (mode === 'random') {
      pool = shuffleArray(pool);
    } else if (mode === 'exam') {
      pool = shuffleArray(pool).slice(0, examOpts.count);
    }

    if (pool.length === 0) {
      showToast('当前筛选条件下没有符合的题目，请调整题型或章节筛选', 'error');
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
      startedAt: Date.now(),
      examDurationSec: examOpts ? examOpts.minutes * 60 : 0,
      examRemainingSec: examOpts ? examOpts.minutes * 60 : 0,
      shuffleOptions: shouldShuffleOpts
    };

    if (mode === 'exam') {
      startExamTimer();
    } else {
      stopExamTimer();
      persistCurrentSession();
    }

    switchView('study');
    renderStudyView();
  }

  function resumeSavedSession() {
    if (!state.savedSession) return;
    const bank = getActiveBank();
    if (!bank) return;
    // Validate that questions still exist
    const qMap = new Map(bank.questions.map((q) => [q.id, q]));
    const validItems = state.savedSession.items.filter((it) => qMap.has(it.questionId));
    if (validItems.length === 0) {
      showToast('上次进度已失效', 'error');
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
    const badge = $('studyTimerBadge');
    badge.classList.remove('hidden');
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
        showToast('⏰ 考试时间到，已自动交卷！', 'info');
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

  function getCurrentSessionContext() {
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

  /**
   * Map a question's original answer keys (e.g. "AC") into current shuffled displayKeys.
   */
  function getDisplayAnswerText(question, item) {
    if (!question.answer) return '（本题暂未提供参考答案）';
    if ((question.type === 'single' || question.type === 'multiple') && item.displayOptions.length > 0) {
      const origSet = new Set(question.answer.toUpperCase().split(''));
      const displayKeys = item.displayOptions
        .filter((o) => origSet.has(o.origKey.toUpperCase()))
        .map((o) => o.displayKey);
      const dispStr = displayKeys.join('');
      if (dispStr && dispStr !== question.answer.toUpperCase()) {
        return `${dispStr}（原题库答案：${question.answer}）`;
      }
      return dispStr || question.answer;
    }
    return question.answer;
  }

  function mapDisplayKeysToOrig(item, displayKeys) {
    const map = new Map(item.displayOptions.map((o) => [o.displayKey, o.origKey]));
    return displayKeys
      .map((dk) => map.get(dk) || dk)
      .sort()
      .join('');
  }

  // ==================== RENDER STUDY VIEW ====================
  function renderStudyView() {
    stopAutoNextTimer();
    const ctx = getCurrentSessionContext();
    if (!ctx) return;

    const { session, item, question, record } = ctx;
    const total = session.items.length;
    const idx = session.currentIndex;
    const modeInfo = MODE_META[session.mode] || MODE_META.practice;

    // Top bar
    const modeBadge = $('studyModeBadge');
    modeBadge.textContent = modeInfo.label;
    modeBadge.className = 'pill ' + modeInfo.badgeClass;
    $('studyProgressCounter').textContent = `${idx + 1} / ${total}`;
    $('studyProgressFill').style.width = `${Math.round(((idx + 1) / total) * 100)}%`;

    // Mode-specific controls
    const isExam = session.mode === 'exam';
    const isRecite = session.mode === 'recite';
    const isReview = session.mode === 'exam-review';

    $('studyTimerBadge').classList.toggle('hidden', !isExam);
    $('reciteMaskToggleBtn').classList.toggle('hidden', !isRecite);
    $('reciteMaskToggleBtn').textContent = session.reciteMasked ? '👁️ 显示答案 (R)' : '🙈 遮挡答案 (R)';
    $('submitExamBtn').classList.toggle('hidden', !isExam);
    $('sheetSubmitExamBtn').classList.toggle('hidden', !isExam);
    $('sheetRestartBtn').classList.toggle('hidden', isExam || isReview);

    // Live session stats
    if (isExam) {
      const done = session.items.filter((it) => it.selectedKeys.length > 0 || it.userText.trim() !== '').length;
      $('studyLiveStats').textContent = `已答 ${done} / ${total}`;
    } else if (session.mode === 'sprint') {
      const bankRecs = getBankRecords(session.bankId);
      const remain = session.items.filter((it) => !(bankRecs[it.questionId] && bankRecs[it.questionId].mastered)).length;
      $('studyLiveStats').textContent = `剩余待斩 ${remain} 题`;
    } else if (!isRecite) {
      const graded = session.items.filter((it) => it.submitted && it.isCorrect !== null);
      const right = graded.filter((it) => it.isCorrect).length;
      $('studyLiveStats').textContent = graded.length > 0 ? `本轮正确率 ${Math.round((right / graded.length) * 100)}% (${right}/${graded.length})` : '';
    } else {
      $('studyLiveStats').textContent = '背题模式 · 高效速览';
    }

    // Question card header
    $('qNumberBadge').textContent = `第 ${idx + 1} 题`;
    $('qTypeBadge').textContent = TYPE_LABELS[question.type] || '题目';

    const catBadge = $('qCategoryBadge');
    if (question.category) {
      catBadge.textContent = question.category;
      catBadge.classList.remove('hidden');
    } else {
      catBadge.classList.add('hidden');
    }

    const wrongBadge = $('qWrongCountBadge');
    if (record.wrong > 0 && !isExam) {
      wrongBadge.textContent = `历史错 ${record.wrong} 次`;
      wrongBadge.classList.remove('hidden');
    } else {
      wrongBadge.classList.add('hidden');
    }

    // Bookmark & Master buttons
    const bmBtn = $('qBookmarkBtn');
    bmBtn.textContent = record.bookmarked ? '★ 已收藏' : '☆ 收藏';
    bmBtn.classList.toggle('active-star', Boolean(record.bookmarked));

    const masterBtn = $('qMasterBtn');
    const streakInfo =
      !record.mastered && record.streak > 0 && state.settings.masteryStreakTarget > 1
        ? ` (${record.streak}/${state.settings.masteryStreakTarget})`
        : '';
    masterBtn.textContent = record.mastered ? '⚔️ 已斩杀' : '⚔️ 斩杀' + streakInfo;
    masterBtn.classList.toggle('active-master', Boolean(record.mastered));
    masterBtn.classList.toggle('hidden', isExam);
    $('qEditBtn').classList.toggle('hidden', isExam);

    // Stem
    $('qStem').textContent = question.stem;

    // Interactive area
    renderQuestionInteractiveArea(ctx);

    // Feedback / Explanation box
    renderFeedbackBox(ctx);

    // Nav buttons
    $('prevQuestionBtn').disabled = idx === 0;
    const isLast = idx === total - 1;
    $('nextQuestionBtn').textContent = isLast ? (isExam ? '已是最后一题' : '完成本轮 ✓') : '下一题 →';
    $('nextQuestionBtn').disabled = isExam && isLast;

    // Render Answer Sheet
    renderAnswerSheet(ctx);
  }

  function renderQuestionInteractiveArea(ctx) {
    const { session, item, question } = ctx;
    const container = $('qInteractiveArea');
    const isExam = session.mode === 'exam';
    const isRecite = session.mode === 'recite';
    const isReview = session.mode === 'exam-review';
    const showSolution = isReview || (isRecite && (!session.reciteMasked || item.revealed)) || (!isExam && item.submitted);

    // 1. Choice & Judge Questions
    if (question.type === 'single' || question.type === 'multiple' || question.type === 'judge') {
      const correctOrigSet = new Set(
        question.type === 'judge'
          ? [question.answer]
          : String(question.answer || '')
              .toUpperCase()
              .split('')
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
            else if (!isSelected && isRightOpt) cls += isReview || item.submitted ? ' missed' : ' correct';
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

      // Multi-choice submit button (not in recite or review, and not yet submitted)
      if (question.type === 'multiple' && !isRecite && !isReview && !isExam && !item.submitted) {
        html += `
          <div class="multi-submit-row">
            <button type="button" class="btn btn-primary" id="submitMultiBtn" ${
              item.selectedKeys.length === 0 ? 'disabled' : ''
            }>确认提交多选 (Enter)</button>
          </div>`;
      }

      // Recite mask reveal prompt
      if (isRecite && session.reciteMasked && !item.revealed) {
        html += `<div class="masked-reveal-box" id="reciteRevealBox">🙈 答案已遮挡 — 点击此处或按 <code>R</code> / <code>Space</code> 揭晓答案与解析</div>`;
      }

      container.innerHTML = html;

      // Bind option click events
      if (!showSolution && !isRecite) {
        container.querySelectorAll('.option-item').forEach((btn) => {
          btn.addEventListener('click', () => handleOptionClick(btn.dataset.optKey));
        });
      }
      const multiBtn = $('submitMultiBtn');
      if (multiBtn) {
        multiBtn.addEventListener('click', () => gradeCurrentObjectiveQuestion());
      }
      const revealBox = $('reciteRevealBox');
      if (revealBox) {
        revealBox.addEventListener('click', () => {
          item.revealed = true;
          renderStudyView();
        });
      }
      return;
    }

    // 2. Fill-in-the-blank Question
    if (question.type === 'fill') {
      if (isRecite) {
        if (session.reciteMasked && !item.revealed) {
          container.innerHTML = `<div class="masked-reveal-box" id="reciteRevealBox">🙈 答案已遮挡 — 点击此处或按 <code>R</code> / <code>Space</code> 查看填空答案</div>`;
          $('reciteRevealBox').addEventListener('click', () => {
            item.revealed = true;
            renderStudyView();
          });
        } else {
          container.innerHTML = '';
        }
        return;
      }

      const disabledAttr = !isExam && item.submitted ? 'disabled' : isReview ? 'disabled' : '';
      container.innerHTML = `
        <div class="fill-area">
          <div class="fill-input-row">
            <input type="text" id="fillAnswerInput" class="form-input" placeholder="请输入你的填空答案..." value="${escapeHtml(
              item.userText
            )}" ${disabledAttr} autocomplete="off" />
            ${
              !isExam && !isReview && !item.submitted
                ? '<button type="button" class="btn btn-primary" id="submitFillBtn">核对答案</button>'
                : ''
            }
          </div>
        </div>`;

      const input = $('fillAnswerInput');
      if (input && !disabledAttr) {
        input.addEventListener('input', (e) => {
          item.userText = e.target.value;
          if (isExam) renderAnswerSheet(ctx);
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !isExam && !item.submitted) {
            e.preventDefault();
            e.stopPropagation();
            gradeCurrentFillQuestion();
          }
        });
      }
      const submitFillBtn = $('submitFillBtn');
      if (submitFillBtn) {
        submitFillBtn.addEventListener('click', () => gradeCurrentFillQuestion());
      }
      return;
    }

    // 3. Short Answer / Subjective Question
    if (isRecite) {
      if (session.reciteMasked && !item.revealed) {
        container.innerHTML = `<div class="masked-reveal-box" id="reciteRevealBox">🙈 先在脑中回想要点，再点击此处或按 <code>R</code> / <code>Space</code> 对照参考答案</div>`;
        $('reciteRevealBox').addEventListener('click', () => {
          item.revealed = true;
          renderStudyView();
        });
      } else {
        container.innerHTML = '';
      }
      return;
    }

    const readonlyAttr = isReview ? 'disabled' : '';
    let shortHtml = `
      <div class="short-area">
        <textarea id="shortAnswerInput" class="form-textarea" rows="3" placeholder="可在此列出解题要点或关键词（留空也可直接看参考答案自评）..." ${readonlyAttr}>${escapeHtml(
          item.userText
        )}</textarea>`;

    if (!isExam && !isReview) {
      if (!item.revealed && !item.submitted) {
        shortHtml += `
          <div class="short-self-grade">
            <button type="button" class="btn btn-primary" id="revealShortBtn">👁️ 显示参考答案并自评 (Space)</button>
          </div>`;
      } else if (!item.submitted) {
        shortHtml += `
          <div class="short-self-grade">
            <button type="button" class="btn btn-success" id="selfGradeRightBtn">✅ 我记住了（算答对）</button>
            <button type="button" class="btn btn-danger" id="selfGradeWrongBtn">❌ 没记住（加入错题本）</button>
          </div>`;
      }
    }
    shortHtml += '</div>';
    container.innerHTML = shortHtml;

    const ta = $('shortAnswerInput');
    if (ta && !readonlyAttr) {
      ta.addEventListener('input', (e) => {
        item.userText = e.target.value;
        if (isExam) renderAnswerSheet(ctx);
      });
    }
    const revealBtn = $('revealShortBtn');
    if (revealBtn) {
      revealBtn.addEventListener('click', () => {
        item.revealed = true;
        renderStudyView();
      });
    }
    const rightBtn = $('selfGradeRightBtn');
    if (rightBtn) rightBtn.addEventListener('click', () => recordSelfGrade(true));
    const wrongBtn = $('selfGradeWrongBtn');
    if (wrongBtn) wrongBtn.addEventListener('click', () => recordSelfGrade(false));
  }

  function renderFeedbackBox(ctx) {
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
      banner.className = 'feedback-banner is-recite';
      banner.innerHTML = '<span>⚡ 极速背题 · 参考答案与解析</span>';
    } else if (question.type === 'short' && !item.submitted && item.revealed) {
      banner.className = 'feedback-banner is-recite';
      banner.innerHTML = '<span>👀 请对照下方参考答案，在上方点击“我记住了”或“没记住”</span>';
    } else if (item.isCorrect === true) {
      banner.className = 'feedback-banner is-correct';
      const killedTag = record.mastered ? ' · ⚔️ 已斩杀' : '';
      banner.innerHTML = `<span>✅ 回答正确！${killedTag}</span>`;
    } else if (item.isCorrect === false) {
      banner.className = 'feedback-banner is-wrong';
      // For fill questions, allow "override as correct" in case wording was synonymous
      const overrideHtml =
        question.type === 'fill' && !isReview
          ? '<button type="button" class="btn btn-xs btn-secondary" id="overrideCorrectBtn">意思一样，算我答对</button>'
          : '';
      banner.innerHTML = `<span>❌ 回答错误，已自动记入错题本</span>${overrideHtml}`;
      const ovBtn = $('overrideCorrectBtn');
      if (ovBtn) {
        ovBtn.addEventListener('click', () => overrideLastWrongAsCorrect());
      }
    } else {
      banner.className = 'feedback-banner is-recite';
      banner.innerHTML = `<span>${isReview && !item.submitted ? '⚪ 本题未作答' : 'ℹ️ 已提交作答'}</span>`;
    }

    // Correct answer line
    const ansText = getDisplayAnswerText(question, item);
    let userAnsSummary = '';
    if (isReview) {
      const uStr =
        item.selectedKeys.length > 0 ? item.selectedKeys.join('') : item.userText.trim() || '未作答';
      userAnsSummary = `<div style="margin-bottom:4px;color:var(--text-secondary)">你的作答：<strong>${escapeHtml(
        uStr
      )}</strong></div>`;
    }
    $('qCorrectAnswerRow').innerHTML = `${userAnsSummary}<div><strong>参考答案：</strong><span class="text-green" style="font-weight:700">${escapeHtml(
      ansText
    )}</span></div>`;

    // Analysis
    const anaBox = $('qAnalysisBox');
    if (question.analysis) {
      anaBox.classList.remove('hidden');
      $('qAnalysisText').textContent = question.analysis;
    } else {
      anaBox.classList.add('hidden');
    }

    // Personal note
    const noteInput = $('qNoteInput');
    noteInput.value = record.note || '';
  }

  function renderAnswerSheet(ctx) {
    const { session } = ctx;
    const records = getBankRecords(session.bankId);
    const isExam = session.mode === 'exam';
    const isRecite = session.mode === 'recite';

    const grid = $('sheetGrid');
    grid.innerHTML = session.items
      .map((it, idx) => {
        const rec = records[it.questionId];
        const cls = ['sheet-num'];
        if (idx === session.currentIndex) cls.push('current');
        if (rec && rec.bookmarked) cls.push('has-star');

        if (isExam) {
          if (it.selectedKeys.length > 0 || it.userText.trim() !== '') cls.push('st-answered');
        } else if (isRecite) {
          if (rec && rec.mastered) cls.push('st-correct');
        } else {
          if (it.submitted) {
            if (it.isCorrect === true) cls.push('st-correct');
            else if (it.isCorrect === false) cls.push('st-wrong');
            else cls.push('st-answered');
          }
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

  // ==================== ANSWERING & GRADING LOGIC ====================
  function handleOptionClick(displayKey) {
    const ctx = getCurrentSessionContext();
    if (!ctx) return;
    const { session, item, question } = ctx;
    if (session.mode === 'recite' || session.mode === 'exam-review') return;
    if (session.mode !== 'exam' && item.submitted) return;

    if (question.type === 'multiple') {
      const idx = item.selectedKeys.indexOf(displayKey);
      if (idx >= 0) item.selectedKeys.splice(idx, 1);
      else item.selectedKeys.push(displayKey);
      item.selectedKeys.sort();
      renderStudyView();
      return;
    }

    // Single choice or Judge
    item.selectedKeys = [displayKey];
    if (session.mode === 'exam') {
      renderStudyView();
    } else {
      gradeCurrentObjectiveQuestion();
    }
  }

  function applyGradingOutcome(ctx, isCorrect, givenAnswerStr) {
    const { bank, session, item, question, record } = ctx;
    item.submitted = true;
    item.isCorrect = isCorrect;

    if (isCorrect !== null) {
      record.attempts = (record.attempts || 0) + 1;
      record.lastAnswer = givenAnswerStr;
      record.lastCorrect = isCorrect;
      record.updatedAt = Date.now();

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
    }

    persistCurrentSession();
    renderStudyView();

    // Auto-next on correct for single/judge
    if (
      isCorrect === true &&
      state.settings.autoNextOnCorrect &&
      (question.type === 'single' || question.type === 'judge') &&
      session.currentIndex < session.items.length - 1
    ) {
      stopAutoNextTimer();
      state.autoNextTimer = setTimeout(() => {
        if (state.currentView === 'study' && state.session === session) {
          goNextQuestion();
        }
      }, Number(state.settings.autoNextDelayMs) || 650);
    }
  }

  function gradeCurrentObjectiveQuestion() {
    const ctx = getCurrentSessionContext();
    if (!ctx) return;
    const { item, question } = ctx;
    if (item.selectedKeys.length === 0) {
      showToast('请先选择答案', 'info');
      return;
    }

    const origGiven =
      question.type === 'judge'
        ? item.selectedKeys[0]
        : mapDisplayKeysToOrig(item, item.selectedKeys);

    const res = QuestionParser.checkAnswer(question, origGiven);
    applyGradingOutcome(ctx, res.isCorrect, origGiven);
  }

  function gradeCurrentFillQuestion() {
    const ctx = getCurrentSessionContext();
    if (!ctx) return;
    const { item, question } = ctx;
    const res = QuestionParser.checkAnswer(question, item.userText);
    applyGradingOutcome(ctx, res.isCorrect, item.userText);
  }

  function recordSelfGrade(isRight) {
    const ctx = getCurrentSessionContext();
    if (!ctx) return;
    applyGradingOutcome(ctx, isRight, ctx.item.userText || (isRight ? '自评掌握' : '自评未掌握'));
  }

  function overrideLastWrongAsCorrect() {
    const ctx = getCurrentSessionContext();
    if (!ctx) return;
    const { item, record } = ctx;
    if (item.isCorrect !== false) return;
    item.isCorrect = true;
    record.wrong = Math.max(0, (record.wrong || 1) - 1);
    record.correct = (record.correct || 0) + 1;
    record.streak = (record.streak || 0) + 1;
    if (record.streak >= (state.settings.masteryStreakTarget || 1)) {
      record.mastered = true;
    }
    if (record.wrong === 0) record.inWrongBook = false;
    QuizStorage.saveRecords(state.recordsByBank);
    persistCurrentSession();
    showToast('已更正为答对 ✓', 'success');
    renderStudyView();
  }

  function jumpToQuestion(newIdx) {
    if (!state.session) return;
    if (newIdx < 0 || newIdx >= state.session.items.length) return;
    stopAutoNextTimer();
    state.session.currentIndex = newIdx;
    persistCurrentSession();
    renderStudyView();
  }

  function goPrevQuestion() {
    if (!state.session) return;
    if (state.session.currentIndex > 0) {
      jumpToQuestion(state.session.currentIndex - 1);
    }
  }

  function goNextQuestion() {
    if (!state.session) return;
    stopAutoNextTimer();
    const s = state.session;
    if (s.currentIndex < s.items.length - 1) {
      jumpToQuestion(s.currentIndex + 1);
    } else if (s.mode !== 'exam') {
      // Finished the round!
      QuizStorage.clearSession(s.bankId);
      showToast('🎉 本轮刷题已全部完成！干得漂亮！', 'success');
      switchView('home');
    }
  }

  // ==================== MOCK EXAM SUBMISSION & REPORT ====================
  function openExamConfigModal() {
    const bank = getActiveBank();
    if (!bank) return;
    const pool = getFilteredQuestions(bank);
    if (pool.length === 0) {
      showToast('当前筛选范围内没有题目', 'error');
      return;
    }
    $('examMaxCount').textContent = pool.length;
    const defaultCount = Math.min(pool.length, 20);
    $('examCountInput').max = pool.length;
    $('examCountInput').value = defaultCount;
    $('examMinutesInput').value = Math.max(10, Math.min(120, Math.ceil(defaultCount * 1.2)));
    $('examShuffleOpts').checked = Boolean(state.settings.shuffleOptions);
    openModal('examConfigModal');
  }

  function submitMockExam(force = false) {
    if (!state.session || state.session.mode !== 'exam') return;
    const session = state.session;
    const unanswered = session.items.filter(
      (it) => it.selectedKeys.length === 0 && it.userText.trim() === ''
    ).length;

    if (!force && unanswered > 0) {
      if (!confirm(`还有 ${unanswered} 道题未作答，确认现在交卷吗？`)) return;
    }

    stopExamTimer();
    const bank = state.banks.find((b) => b.id === session.bankId);
    const qMap = new Map(bank.questions.map((q) => [q.id, q]));

    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;
    let gradableTotal = 0;
    const byType = {};

    for (const item of session.items) {
      const q = qMap.get(item.questionId);
      if (!q) continue;
      if (!byType[q.type]) byType[q.type] = { total: 0, correct: 0 };
      byType[q.type].total++;

      const hasAnswer = item.selectedKeys.length > 0 || item.userText.trim() !== '';
      if (!hasAnswer) {
        unansweredCount++;
        item.submitted = false;
        item.isCorrect = false;
        if (q.type !== 'short' && q.answer) gradableTotal++;
        continue;
      }

      item.submitted = true;
      let given = item.userText;
      if (q.type === 'single' || q.type === 'multiple') {
        given = mapDisplayKeysToOrig(item, item.selectedKeys);
      } else if (q.type === 'judge') {
        given = item.selectedKeys[0];
      }

      const res = QuestionParser.checkAnswer(q, given);
      const rec = getQuestionRecord(bank.id, q.id);

      if (res.isCorrect === true) {
        item.isCorrect = true;
        correctCount++;
        gradableTotal++;
        byType[q.type].correct++;
        rec.attempts++;
        rec.correct++;
        rec.streak++;
        if (rec.streak >= (state.settings.masteryStreakTarget || 1)) rec.mastered = true;
      } else if (res.isCorrect === false) {
        item.isCorrect = false;
        wrongCount++;
        gradableTotal++;
        rec.attempts++;
        rec.wrong++;
        rec.streak = 0;
        rec.mastered = false;
        rec.inWrongBook = true;
      } else {
        // Short answer / no key
        item.isCorrect = null;
      }
      rec.updatedAt = Date.now();
    }

    QuizStorage.saveRecords(state.recordsByBank);

    const score = gradableTotal > 0 ? Math.round((correctCount / gradableTotal) * 100) : 100;
    const elapsedSec = Math.max(1, session.examDurationSec - session.examRemainingSec);

    state.lastExamResult = {
      bankId: bank.id,
      score,
      total: session.items.length,
      gradableTotal,
      correct: correctCount,
      wrong: wrongCount,
      unanswered: unansweredCount,
      elapsedSec,
      byType,
      items: session.items
    };

    state.examHistory.unshift({
      bankId: bank.id,
      date: Date.now(),
      score,
      total: session.items.length,
      correct: correctCount,
      elapsedSec
    });
    state.examHistory = state.examHistory.slice(0, 30);
    QuizStorage.saveExamHistory(state.examHistory);

    renderExamResultView();
    switchView('exam-result');
  }

  function renderExamResultView() {
    const r = state.lastExamResult;
    if (!r) return;

    const circle = $('resultScoreCircle');
    circle.className = 'score-circle ' + (r.score >= 60 ? 'pass' : 'fail');
    $('resultScoreNum').textContent = r.score;

    let verdict = '继续加油，把错题再刷一遍就能稳过！';
    if (r.score >= 90) verdict = '🔥 太强了！高分稳稳拿捏，明天考试必过！';
    else if (r.score >= 75) verdict = '👏 表现优秀！巩固下错题就能冲刺高分！';
    else if (r.score >= 60) verdict = '✅ 已及格！考前把下面错题过一遍更稳妥！';

    $('resultVerdict').textContent = verdict;
    $('resCorrectCount').textContent = r.correct;
    $('resWrongCount').textContent = r.wrong;
    $('resUnansweredCount').textContent = r.unanswered;
    $('resTimeUsed').textContent = formatDuration(r.elapsedSec);

    const listEl = $('resultTypeTable');
    listEl.innerHTML = Object.entries(r.byType)
      .map(([type, stat]) => {
        const pct = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
        return `
          <div class="type-stat-row">
            <strong>${TYPE_LABELS[type] || type}</strong>
            <div class="type-bar"><div class="type-bar-fill" style="width:${pct}%"></div></div>
            <span style="text-align:right">${stat.correct} / ${stat.total} (${pct}%)</span>
          </div>`;
      })
      .join('');

    const wrongItems = r.items.filter((it) => it.isCorrect === false);
    $('resReviewWrongBtn').disabled = wrongItems.length === 0;
    $('resReviewWrongBtn').textContent = `🎯 只复盘错题 (${wrongItems.length})`;
  }

  function startExamReview(onlyWrong) {
    const r = state.lastExamResult;
    if (!r) return;
    const reviewItems = onlyWrong ? r.items.filter((it) => it.isCorrect === false) : r.items;
    if (reviewItems.length === 0) {
      showToast('没有错题需要复盘！', 'success');
      return;
    }
    state.session = {
      bankId: r.bankId,
      mode: 'exam-review',
      items: reviewItems,
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
      showToast('正在本地解析文件：' + file.name, 'info');
      const parsed = await QuestionParser.parseUploadedFile(file);
      state.importDraft = parsed;
      renderImportPreview();
    } catch (err) {
      showToast(err.message || '文件解析失败', 'error');
    }
  }

  function handlePasteParse() {
    const text = $('pasteInput').value.trim();
    if (!text) {
      showToast('请先粘贴题库文本内容', 'error');
      return;
    }
    const defaultName = '粘贴导入题库 ' + new Date().toLocaleDateString('zh-CN');
    if (QuestionParser.looksLikeCsvText(text)) {
      const rows = QuestionParser.parseCsvRows(text);
      const detected = QuestionParser.autoDetectTableMapping(rows);
      const res = QuestionParser.parseTableWithMapping(rows, detected.mapping, detected.headerRowIndex);
      state.importDraft = {
        kind: 'table',
        bankName: defaultName,
        sheets: [{ name: '粘贴的表格数据', rows }],
        activeSheetIndex: 0,
        detectedHeaderRowIndex: detected.headerRowIndex,
        ...detected,
        ...res
      };
      showToast(`已自动识别为表格(CSV)格式，共解析 ${res.questions.length} 题！`, 'success');
    } else {
      const res = QuestionParser.parseText(text);
      state.importDraft = {
        kind: 'direct',
        bankName: defaultName,
        ...res
      };
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

    // Stats badges
    const s = draft.stats;
    const badges = [`<span class="pill pill-blue">共识别 ${s.total} 题</span>`];
    for (const [type, label] of Object.entries(TYPE_LABELS)) {
      if (s.counts[type] > 0) {
        badges.push(`<span class="pill pill-green">${label} ${s.counts[type]}</span>`);
      }
    }
    if (s.missingAnswer > 0) {
      badges.push(`<span class="pill pill-amber">缺答案 ${s.missingAnswer}</span>`);
    }
    $('previewStatsBadges').innerHTML = badges.join('');

    // Warnings
    const warnBox = $('previewWarnings');
    if (draft.warnings && draft.warnings.length > 0) {
      warnBox.classList.remove('hidden');
      warnBox.innerHTML = draft.warnings.map((w) => `<div>⚠️ ${escapeHtml(w)}</div>`).join('');
    } else {
      warnBox.classList.add('hidden');
    }

    // Table Mapping Panel
    const mapPanel = $('tableMappingPanel');
    if (draft.kind === 'table' && draft.sheets && draft.sheets.length > 0) {
      mapPanel.classList.remove('hidden');
      const sheetWrap = $('sheetSelectWrap');
      const sheetSel = $('sheetSelect');
      if (draft.sheets.length > 1) {
        sheetWrap.classList.remove('hidden');
        sheetSel.innerHTML = draft.sheets
          .map(
            (sh, i) =>
              `<option value="${i}" ${i === draft.activeSheetIndex ? 'selected' : ''}>${escapeHtml(sh.name)} (${
                sh.rows.length
              }行)</option>`
          )
          .join('');
      } else {
        sheetWrap.classList.add('hidden');
      }

      $('hasHeaderCheck').checked = draft.headerRowIndex >= 0;
      renderColumnMappingControls(draft);
    } else {
      mapPanel.classList.add('hidden');
    }

    // Question Preview List (first 8)
    const previewList = $('previewQuestionList');
    if (draft.questions.length === 0) {
      previewList.innerHTML =
        '<div class="muted-empty">暂无解析结果，请检查上方表格列映射或核对文本格式。</div>';
    } else {
      previewList.innerHTML = draft.questions
        .slice(0, 8)
        .map((q, i) => {
          const optsHtml =
            q.options && q.options.length > 0
              ? `<div class="preview-q-opts">${q.options
                  .map((o) => `<span><strong>${escapeHtml(o.key)}.</strong> ${escapeHtml(o.text)}</span>`)
                  .join('')}</div>`
              : '';
          const ansHtml = q.answer
            ? `<div class="preview-q-ans">✓ 答案：${escapeHtml(q.answer)}</div>`
            : `<div class="preview-q-ans missing">⚠️ 未检测到答案</div>`;
          return `
            <div class="preview-q-item">
              <div class="preview-q-head">
                <span class="pill pill-blue">#${i + 1} ${TYPE_LABELS[q.type] || q.type}</span>
                ${q.category ? `<span class="q-cat-badge">${escapeHtml(q.category)}</span>` : ''}
              </div>
              <div class="preview-q-stem">${escapeHtml(q.stem)}</div>
              ${optsHtml}
              ${ansHtml}
            </div>`;
        })
        .join('');
    }

    $('confirmImportBtn').disabled = draft.questions.length === 0;
    const appendBtn = $('appendImportBtn');
    const hasActiveBank = state.banks.length > 0 && draft.questions.length > 0;
    appendBtn.classList.toggle('hidden', !hasActiveBank);

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
      { key: 'opt_F', label: '选项 F' },
      { key: 'optionsCombined', label: '合并选项列(可选)' },
      { key: 'analysis', label: '解析列' },
      { key: 'category', label: '章节/分类列' }
    ];

    const colOptions = (selectedIdx) => {
      let html = `<option value="-1" ${selectedIdx === -1 || selectedIdx === undefined ? 'selected' : ''}>— 不映射 —</option>`;
      headers.forEach((h, i) => {
        const label = `第${i + 1}列: ${String(h).slice(0, 16)}`;
        html += `<option value="${i}" ${selectedIdx === i ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      });
      return html;
    };

    const grid = $('mappingGrid');
    grid.innerHTML = fields
      .map((f) => {
        const curVal = f.key.startsWith('opt_')
          ? mapping.options
            ? mapping.options[f.key.slice(4)]
            : -1
          : mapping[f.key];
        return `
          <div class="map-field">
            <label>${f.label}</label>
            <select class="form-select form-select-xs map-select" data-map-key="${f.key}">
              ${colOptions(curVal)}
            </select>
          </div>`;
      })
      .join('');

    grid.querySelectorAll('.map-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const key = sel.dataset.mapKey;
        const val = parseInt(sel.value, 10);
        if (key.startsWith('opt_')) {
          if (!draft.mapping.options) draft.mapping.options = {};
          const letter = key.slice(4);
          if (val >= 0) draft.mapping.options[letter] = val;
          else delete draft.mapping.options[letter];
        } else {
          draft.mapping[key] = val;
        }
        reparseTableDraft();
      });
    });
  }

  function reparseTableDraft() {
    const draft = state.importDraft;
    if (!draft || draft.kind !== 'table') return;
    const sheet = draft.sheets[draft.activeSheetIndex];
    const headerRowIndex = $('hasHeaderCheck').checked
      ? Math.max(0, draft.detectedHeaderRowIndex ?? Math.max(0, draft.headerRowIndex))
      : -1;
    draft.headerRowIndex = headerRowIndex;
    const res = QuestionParser.parseTableWithMapping(sheet.rows, draft.mapping, headerRowIndex);
    draft.questions = res.questions;
    draft.stats = res.stats;
    draft.warnings = res.warnings;
    renderImportPreview();
  }

  async function commitImport(appendToCurrent = false) {
    const draft = state.importDraft;
    if (!draft || !draft.questions || draft.questions.length === 0) return;

    if (appendToCurrent && getActiveBank()) {
      const bank = getActiveBank();
      const baseLen = bank.questions.length;
      const newQs = draft.questions.map((q, i) => ({
        ...q,
        id: 'q_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 6),
        index: baseLen + i + 1
      }));
      bank.questions.push(...newQs);
      await QuizStorage.saveBanks(state.banks);
      showToast(`已成功追加 ${newQs.length} 道题到「${bank.name}」！`, 'success');
    } else {
      const bankName = $('importBankNameInput').value.trim() || draft.bankName || '我的题库';
      const newBank = {
        id: 'bank_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: bankName,
        createdAt: Date.now(),
        questions: draft.questions.map((q, i) => ({
          ...q,
          id: 'q_' + (i + 1) + '_' + Math.random().toString(36).slice(2, 7),
          index: i + 1
        }))
      };
      state.banks.unshift(newBank);
      state.activeBankId = newBank.id;
      await QuizStorage.saveBanks(state.banks);
      await QuizStorage.saveActiveBankId(state.activeBankId);
      showToast(`🎉 成功导入题库「${bankName}」（共 ${newBank.questions.length} 题）！`, 'success');
    }

    state.importDraft = null;
    $('importPreviewCard').classList.add('hidden');
    $('pasteInput').value = '';
    $('fileInput').value = '';
    switchView('home');
  }

  async function loadDemoBank() {
    const existing = state.banks.find((b) => b.name === '示例题库 · 计算机基础突击');
    if (existing) {
      state.activeBankId = existing.id;
      await QuizStorage.saveActiveBankId(existing.id);
      showToast('已切换到示例题库', 'success');
      switchView('home');
      return;
    }

    const demoBank = {
      id: 'bank_demo_' + Date.now(),
      name: '示例题库 · 计算机基础突击',
      createdAt: Date.now(),
      questions: createDemoQuestions()
    };
    state.banks.unshift(demoBank);
    state.activeBankId = demoBank.id;
    await QuizStorage.saveBanks(state.banks);
    await QuizStorage.saveActiveBankId(state.activeBankId);
    showToast('✨ 示例题库已加载（含单选/多选/判断/填空/简答 10 题）！', 'success');
    switchView('home');
  }

  // ==================== BANK MANAGEMENT & EXPORT ====================
  function renderManage() {
    renderBankSwitcher();
    const bank = getActiveBank();
    const chipsEl = $('manageBankChips');
    const opsEl = $('manageBankOps');

    if (state.banks.length === 0) {
      chipsEl.innerHTML = '<span class="muted-empty">暂无题库，请先前往「导入题库」上传。</span>';
      opsEl.classList.add('hidden');
      $('manageQuestionList').innerHTML = '';
      $('manageCountLabel').textContent = '0 题';
      $('manageLoadMoreWrap').classList.add('hidden');
      return;
    }

    opsEl.classList.remove('hidden');
    chipsEl.innerHTML = state.banks
      .map(
        (b) =>
          `<button type="button" class="bank-chip ${b.id === bank.id ? 'active' : ''}" data-bank-id="${escapeHtml(
            b.id
          )}">${escapeHtml(b.name)} (${b.questions.length})</button>`
      )
      .join('');

    chipsEl.querySelectorAll('.bank-chip').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.activeBankId = btn.dataset.bankId;
        state.manageRenderLimit = 50;
        await QuizStorage.saveActiveBankId(state.activeBankId);
        renderManage();
      });
    });

    renderManageQuestionList();
  }

  function renderManageQuestionList() {
    const bank = getActiveBank();
    if (!bank) return;
    const records = getBankRecords(bank.id);
    const keyword = $('manageSearchInput').value.trim().toLowerCase();
    const typeFilter = $('manageTypeFilter').value;
    const statusFilter = $('manageStatusFilter').value;

    const filtered = bank.questions.filter((q) => {
      if (typeFilter !== 'all' && q.type !== typeFilter) return false;
      const rec = records[q.id];
      if (statusFilter === 'wrong' && !(rec && rec.inWrongBook)) return false;
      if (statusFilter === 'mastered' && !(rec && rec.mastered)) return false;
      if (statusFilter === 'unmastered' && rec && rec.mastered) return false;
      if (statusFilter === 'bookmarked' && !(rec && rec.bookmarked)) return false;
      if (statusFilter === 'unanswered' && rec && rec.attempts > 0) return false;
      if (statusFilter === 'noanswer' && q.answer) return false;

      if (keyword) {
        const hay = [
          q.stem,
          q.answer,
          q.analysis,
          q.category,
          ...(q.options || []).map((o) => o.text),
          (rec && rec.note) || ''
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(keyword)) return false;
      }
      return true;
    });

    $('manageCountLabel').textContent = `共 ${filtered.length} / ${bank.questions.length} 题`;

    const slice = filtered.slice(0, state.manageRenderLimit);
    const listEl = $('manageQuestionList');

    if (slice.length === 0) {
      listEl.innerHTML = '<div class="card muted-empty" style="text-align:center">没有找到符合条件的题目</div>';
    } else {
      listEl.innerHTML = slice
        .map((q) => {
          const rec = records[q.id] || {};
          const optsHtml =
            q.options && q.options.length > 0
              ? `<div class="manage-q-opts">${q.options
                  .map((o) => `<span><strong>${escapeHtml(o.key)}.</strong> ${escapeHtml(o.text)}</span>`)
                  .join('')}</div>`
              : '';
          return `
            <div class="manage-q-card">
              <div class="manage-q-top">
                <div class="manage-q-badges">
                  <span class="q-num">#${q.index}</span>
                  <span class="q-type-badge">${TYPE_LABELS[q.type] || q.type}</span>
                  ${q.category ? `<span class="q-cat-badge">${escapeHtml(q.category)}</span>` : ''}
                  ${rec.inWrongBook ? `<span class="pill pill-red">错 ${rec.wrong || 1} 次</span>` : ''}
                  ${rec.mastered ? '<span class="pill pill-purple">已斩杀</span>' : ''}
                  ${rec.bookmarked ? '<span class="pill pill-amber">★ 收藏</span>' : ''}
                </div>
                <div>
                  <button type="button" class="btn btn-ghost btn-xs" data-edit-qid="${escapeHtml(q.id)}">✏️ 编辑</button>
                  <button type="button" class="btn btn-ghost btn-xs text-red" data-del-qid="${escapeHtml(q.id)}">删除</button>
                </div>
              </div>
              <div class="manage-q-stem">${escapeHtml(q.stem)}</div>
              ${optsHtml}
              <div class="manage-q-bottom">
                <span><strong>答案：</strong><span class="${q.answer ? 'text-green' : 'text-amber'}">${escapeHtml(
                  q.answer || '未填写'
                )}</span></span>
                ${q.analysis ? `<span><strong>解析：</strong>${escapeHtml(q.analysis.slice(0, 90))}${q.analysis.length > 90 ? '…' : ''}</span>` : ''}
              </div>
            </div>`;
        })
        .join('');

      listEl.querySelectorAll('[data-edit-qid]').forEach((btn) => {
        btn.addEventListener('click', () => openEditQuestionModal(btn.dataset.editQid));
      });
      listEl.querySelectorAll('[data-del-qid]').forEach((btn) => {
        btn.addEventListener('click', () => deleteQuestion(btn.dataset.delQid));
      });
    }

    const loadMoreWrap = $('manageLoadMoreWrap');
    loadMoreWrap.classList.toggle('hidden', filtered.length <= state.manageRenderLimit);
  }

  /**
   * Export Wrong Questions (or Bookmarked if no wrong) as a gorgeous printable HTML Cheat Sheet!
   */
  function exportWrongPrintableSheet() {
    const bank = getActiveBank();
    if (!bank) return;
    const records = getBankRecords(bank.id);
    const wrongQs = bank.questions
      .filter((q) => records[q.id] && records[q.id].inWrongBook)
      .sort((a, b) => (records[b.id].wrong || 0) - (records[a.id].wrong || 0));

    if (wrongQs.length === 0) {
      showToast('当前题库还没有错题，刷错的题会自动收录到这里！', 'info');
      return;
    }

    const itemsHtml = wrongQs
      .map((q, idx) => {
        const rec = records[q.id] || {};
        const opts =
          q.options && q.options.length > 0
            ? `<ul class="opts">${q.options
                .map((o) => `<li><strong>${escapeHtml(o.key)}.</strong> ${escapeHtml(o.text)}</li>`)
                .join('')}</ul>`
            : '';
        return `
        <div class="item">
          <div class="meta">#${idx + 1} · ${TYPE_LABELS[q.type] || q.type} · <span class="err">历史错 ${rec.wrong || 1} 次</span>${
          q.category ? ' · ' + escapeHtml(q.category) : ''
        }</div>
          <div class="stem">${escapeHtml(q.stem)}</div>
          ${opts}
          <div class="ans"><strong>正确答案：</strong>${escapeHtml(q.answer || '未填写')}</div>
          ${q.analysis ? `<div class="ana"><strong>解析：</strong>${escapeHtml(q.analysis)}</div>` : ''}
          ${rec.note ? `<div class="note"><strong>我的笔记：</strong>${escapeHtml(rec.note)}</div>` : ''}
        </div>`;
      })
      .join('');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(bank.name)} - 考前错题速记打印单</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 820px; margin: 24px auto; padding: 0 20px; color: #111827; line-height: 1.65; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px; }
  h1 { margin: 0; font-size: 20px; }
  .print-btn { padding: 8px 16px; background: #2563eb; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
  .item { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; page-break-inside: avoid; }
  .meta { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
  .err { color: #dc2626; font-weight: 700; }
  .stem { font-weight: 700; font-size: 15px; margin-bottom: 8px; white-space: pre-wrap; }
  .opts { list-style: none; padding: 0; margin: 0 0 8px; font-size: 14px; color: #374151; }
  .opts li { margin-bottom: 3px; }
  .ans { color: #15803d; font-size: 14px; background: #f0fdf4; padding: 6px 10px; border-radius: 6px; }
  .ana { margin-top: 6px; font-size: 13px; color: #374151; white-space: pre-wrap; }
  .note { margin-top: 6px; font-size: 13px; color: #92400e; background: #fffbeb; padding: 6px 10px; border-radius: 6px; }
  @media print { .print-btn { display: none; } body { margin: 0; } }
</style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(bank.name)} · 考前错题速记单（共 ${wrongQs.length} 题）</h1>
      <div style="font-size:12px;color:#6b7280">按错误频次从高到低排序 · 生成时间：${new Date().toLocaleString('zh-CN')}</div>
    </div>
    <button class="print-btn" onclick="window.print()">🖨️ 打印 / 存为 PDF</button>
  </header>
  ${itemsHtml}
</body>
</html>`;

    downloadFile(`${bank.name}_错题速记打印单.html`, html, 'text/html;charset=utf-8');
    showToast('已导出错题打印单（双击打开即可打印或存 PDF）', 'success');
  }

  // ==================== EDIT / ADD QUESTION MODAL ====================
  function openEditQuestionModal(qId = null) {
    const bank = getActiveBank();
    if (!bank) return;
    state.editingQuestionId = qId;

    const q = qId ? bank.questions.find((item) => item.id === qId) : null;
    $('editQModalTitle').textContent = q ? `✏️ 编辑第 ${q.index} 题` : '➕ 手动新增题目';
    $('editQType').value = q ? q.type : 'single';
    $('editQCategory').value = q ? q.category || '' : '';
    $('editQStem').value = q ? q.stem : '';
    $('editQAnswer').value = q ? q.answer || '' : '';
    $('editQAnalysis').value = q ? q.analysis || '' : '';

    const defaultOpts =
      q && q.options && q.options.length > 0
        ? q.options
        : [
            { key: 'A', text: '' },
            { key: 'B', text: '' },
            { key: 'C', text: '' },
            { key: 'D', text: '' }
          ];
    renderEditOptionRows(defaultOpts);
    toggleEditOptionsVisibility();
    openModal('editQuestionModal');
  }

  function toggleEditOptionsVisibility() {
    const t = $('editQType').value;
    $('editQOptionsGroup').classList.toggle('hidden', t !== 'single' && t !== 'multiple');
  }

  function renderEditOptionRows(options) {
    const container = $('editQOptionsList');
    container.innerHTML = options
      .map(
        (o, idx) => `
      <div class="edit-opt-row">
        <input type="text" class="form-input edit-opt-key" value="${escapeHtml(o.key || OPTION_LETTERS[idx] || '')}" maxlength="2" />
        <input type="text" class="form-input edit-opt-text" value="${escapeHtml(o.text || '')}" placeholder="输入选项内容..." />
        <button type="button" class="icon-btn del-opt-row" title="删除选项">✕</button>
      </div>`
      )
      .join('');
    container.querySelectorAll('.del-opt-row').forEach((btn) => {
      btn.addEventListener('click', () => btn.closest('.edit-opt-row').remove());
    });
  }

  async function saveEditedQuestion() {
    const bank = getActiveBank();
    if (!bank) return;
    const type = $('editQType').value;
    const stem = $('editQStem').value.trim();
    if (!stem) {
      showToast('题干内容不能为空', 'error');
      return;
    }

    let options = [];
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
        const updated = QuestionParser.finalizeQuestion(rawObj, idx);
        updated.id = state.editingQuestionId;
        bank.questions[idx] = updated;
        // Also sync current session item options if currently studying this question
        if (state.session) {
          const sItem = state.session.items.find((it) => it.questionId === updated.id);
          if (sItem) {
            sItem.displayOptions = updated.options.map((o) => ({
              displayKey: o.key,
              origKey: o.key,
              text: o.text
            }));
          }
        }
      }
      showToast('题目修改已保存', 'success');
    } else {
      const created = QuestionParser.finalizeQuestion(rawObj, bank.questions.length);
      bank.questions.push(created);
      showToast('已新增题目到当前题库', 'success');
    }

    await QuizStorage.saveBanks(state.banks);
    closeModal('editQuestionModal');
    if (state.currentView === 'study') renderStudyView();
    else if (state.currentView === 'manage') renderManage();
    else renderHome();
  }

  async function deleteQuestion(qId) {
    const bank = getActiveBank();
    if (!bank) return;
    if (!confirm('确定要删除这道题吗？')) return;
    bank.questions = bank.questions.filter((q) => q.id !== qId).map((q, i) => ({ ...q, index: i + 1 }));
    await QuizStorage.saveBanks(state.banks);
    showToast('题目已删除', 'info');
    renderManage();
  }

  // ==================== MODALS & MOBILE SHEET ====================
  function openModal(id) {
    $(id).classList.remove('hidden');
  }
  function closeModal(id) {
    $(id).classList.add('hidden');
  }
  function openMobileSheet() {
    $('answerSheet').classList.add('open');
    $('sheetBackdrop').classList.remove('hidden');
  }
  function closeMobileSheet() {
    $('answerSheet').classList.remove('open');
    $('sheetBackdrop').classList.add('hidden');
  }

  // ==================== KEYBOARD SHORTCUTS & TOUCH SWIPE ====================
  function handleGlobalKeydown(e) {
    // Ignore when typing in input/textarea/select or when a modal is open
    const tag = (e.target.tagName || '').toLowerCase();
    const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';
    const hasOpenModal = document.querySelector('.modal:not(.hidden)');

    if (e.key === 'Escape') {
      if (hasOpenModal) closeModal(hasOpenModal.id);
      closeMobileSheet();
      return;
    }

    if (isTyping || hasOpenModal) return;

    // Global Dark Mode toggle
    if (e.key.toLowerCase() === 'd' && !e.metaKey && !e.ctrlKey) {
      toggleTheme();
      return;
    }

    if (state.currentView !== 'study' || !state.session) return;

    const ctx = getCurrentSessionContext();
    if (!ctx) return;
    const { session, item, question } = ctx;
    const key = e.key;
    const lower = key.toLowerCase();

    if (key === 'ArrowLeft') {
      e.preventDefault();
      goPrevQuestion();
      return;
    }
    if (key === 'ArrowRight') {
      e.preventDefault();
      goNextQuestion();
      return;
    }
    if (lower === 's') {
      e.preventDefault();
      toggleCurrentBookmark();
      return;
    }
    if (lower === 'k' && session.mode !== 'exam') {
      e.preventDefault();
      toggleCurrentMastered();
      return;
    }
    if (lower === 'r' && session.mode === 'recite') {
      e.preventDefault();
      if (session.reciteMasked && !item.revealed) {
        item.revealed = true;
      } else {
        session.reciteMasked = !session.reciteMasked;
      }
      renderStudyView();
      return;
    }

    // Option selection via 1-8 or A-H
    if (
      session.mode !== 'recite' &&
      session.mode !== 'exam-review' &&
      (question.type === 'single' || question.type === 'multiple' || question.type === 'judge')
    ) {
      let targetIdx = -1;
      if (/^[1-8]$/.test(key)) {
        targetIdx = parseInt(key, 10) - 1;
      } else if (/^[a-h]$/.test(lower) && question.type !== 'judge') {
        targetIdx = lower.charCodeAt(0) - 97;
      }
      if (targetIdx >= 0 && item.displayOptions[targetIdx]) {
        e.preventDefault();
        handleOptionClick(item.displayOptions[targetIdx].displayKey);
        return;
      }
    }

    // Enter / Space: Submit multi-choice, reveal short/recite, or go next
    if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      if (session.mode === 'recite' && session.reciteMasked && !item.revealed) {
        item.revealed = true;
        renderStudyView();
        return;
      }
      if (question.type === 'short' && session.mode !== 'exam' && !item.revealed && !item.submitted) {
        item.revealed = true;
        renderStudyView();
        return;
      }
      if (question.type === 'multiple' && session.mode !== 'exam' && session.mode !== 'recite' && !item.submitted) {
        if (item.selectedKeys.length > 0) gradeCurrentObjectiveQuestion();
        return;
      }
      goNextQuestion();
    }
  }

  function bindTouchSwipe() {
    const card = $('questionCard');
    let startX = 0;
    let startY = 0;

    card.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      },
      { passive: true }
    );

    card.addEventListener(
      'touchend',
      (e) => {
        if (!e.changedTouches || e.changedTouches.length !== 1) return;
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.6) {
          if (dx < 0) goNextQuestion();
          else goPrevQuestion();
        }
      },
      { passive: true }
    );
  }

  // ==================== QUICK ACTIONS ====================
  function toggleTheme() {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    applySettingsToDOM();
    QuizStorage.saveSettings(state.settings);
  }

  function cycleFontSize() {
    const order = ['sm', 'md', 'lg'];
    const cur = order.indexOf(state.settings.fontSize || 'md');
    state.settings.fontSize = order[(cur + 1) % order.length];
    applySettingsToDOM();
    QuizStorage.saveSettings(state.settings);
    const names = { sm: '紧凑字号', md: '标准字号', lg: '大号护眼字号' };
    showToast('已切换：' + names[state.settings.fontSize], 'info');
  }

  function toggleCurrentBookmark() {
    const ctx = getCurrentSessionContext();
    if (!ctx) return;
    ctx.record.bookmarked = !ctx.record.bookmarked;
    QuizStorage.saveRecords(state.recordsByBank);
    showToast(ctx.record.bookmarked ? '★ 已加入重点收藏' : '已取消收藏', 'info');
    renderStudyView();
  }

  function toggleCurrentMastered() {
    const ctx = getCurrentSessionContext();
    if (!ctx) return;
    ctx.record.mastered = !ctx.record.mastered;
    if (ctx.record.mastered) {
      ctx.record.streak = Math.max(ctx.record.streak || 0, state.settings.masteryStreakTarget || 1);
      showToast('⚔️ 已标记为掌握（斩杀）！', 'success');
    } else {
      ctx.record.streak = 0;
      showToast('已取消斩杀标记', 'info');
    }
    QuizStorage.saveRecords(state.recordsByBank);
    renderStudyView();
  }

  // ==================== EVENT BINDINGS ====================
  function bindEvents() {
    // Topbar nav
    $('brandBtn').addEventListener('click', () => switchView('home'));
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    $('activeBankSelect').addEventListener('change', async (e) => {
      state.activeBankId = e.target.value;
      await QuizStorage.saveActiveBankId(state.activeBankId);
      if (state.currentView === 'home') renderHome();
      else if (state.currentView === 'manage') renderManage();
      else switchView('home');
    });

    $('themeToggleBtn').addEventListener('click', toggleTheme);
    $('fontSizeBtn').addEventListener('click', cycleFontSize);
    $('settingsBtn').addEventListener('click', () => {
      $('setAutoNext').checked = Boolean(state.settings.autoNextOnCorrect);
      $('setAutoNextDelay').value = String(state.settings.autoNextDelayMs || 650);
      $('setShuffleOpts').checked = Boolean(state.settings.shuffleOptions);
      $('setAutoRemoveWrong').checked = Boolean(state.settings.autoRemoveWrongOnCorrect);
      $('setMasteryTarget').value = String(state.settings.masteryStreakTarget || 1);
      openModal('settingsModal');
    });

    // Settings inputs
    const saveSettingsFromModal = () => {
      state.settings.autoNextOnCorrect = $('setAutoNext').checked;
      state.settings.autoNextDelayMs = parseInt($('setAutoNextDelay').value, 10) || 650;
      state.settings.shuffleOptions = $('setShuffleOpts').checked;
      state.settings.autoRemoveWrongOnCorrect = $('setAutoRemoveWrong').checked;
      state.settings.masteryStreakTarget = parseInt($('setMasteryTarget').value, 10) || 1;
      applySettingsToDOM();
      QuizStorage.saveSettings(state.settings);
    };
    ['setAutoNext', 'setAutoNextDelay', 'setShuffleOpts', 'setAutoRemoveWrong', 'setMasteryTarget'].forEach((id) => {
      $(id).addEventListener('change', saveSettingsFromModal);
    });

    // Empty Hero
    $('heroImportBtn').addEventListener('click', () => switchView('import'));
    $('heroDemoBtn').addEventListener('click', loadDemoBank);
    $('loadDemoBankBtn').addEventListener('click', loadDemoBank);

    // Home Dashboard
    $('filterTypeSelect').addEventListener('change', updateFilteredModeCounts);
    $('filterCategorySelect').addEventListener('change', updateFilteredModeCounts);
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
        const mode = card.dataset.mode;
        if (mode === 'exam') openExamConfigModal();
        else startStudyMode(mode);
      });
    });

    $('statWrongTile').addEventListener('click', () => startStudyMode('wrong'));
    $('statBookmarkTile').addEventListener('click', () => startStudyMode('bookmark'));
    $('startBookmarkModeBtn').addEventListener('click', () => startStudyMode('bookmark'));
    $('exportWrongSheetBtn').addEventListener('click', exportWrongPrintableSheet);
    $('goImportMoreBtn').addEventListener('click', () => switchView('import'));

    $('resumeContinueBtn').addEventListener('click', resumeSavedSession);
    $('resumeDismissBtn').addEventListener('click', async () => {
      const bank = getActiveBank();
      if (bank) await QuizStorage.clearSession(bank.id);
      $('resumeBanner').classList.add('hidden');
    });

    // Import Hub
    const dropzone = $('dropzone');
    const fileInput = $('fileInput');
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) handleFileUpload(e.target.files[0]);
    });
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileUpload(e.dataTransfer.files[0]);
      }
    });

    $('fillPasteSampleBtn').addEventListener('click', () => {
      $('pasteInput').value = SAMPLE_PASTE_TEXT;
    });
    $('clearPasteBtn').addEventListener('click', () => {
      $('pasteInput').value = '';
    });
    $('parsePasteBtn').addEventListener('click', handlePasteParse);

    $('sheetSelect').addEventListener('change', (e) => {
      if (!state.importDraft || state.importDraft.kind !== 'table') return;
      state.importDraft.activeSheetIndex = parseInt(e.target.value, 10);
      const rows = state.importDraft.sheets[state.importDraft.activeSheetIndex].rows;
      const detected = QuestionParser.autoDetectTableMapping(rows);
      state.importDraft.headers = detected.headers;
      state.importDraft.mapping = detected.mapping;
      state.importDraft.headerRowIndex = detected.headerRowIndex;
      state.importDraft.detectedHeaderRowIndex = detected.headerRowIndex;
      reparseTableDraft();
    });
    $('hasHeaderCheck').addEventListener('change', reparseTableDraft);

    $('cancelImportBtn').addEventListener('click', () => {
      state.importDraft = null;
      $('importPreviewCard').classList.add('hidden');
    });
    $('confirmImportBtn').addEventListener('click', () => commitImport(false));
    $('appendImportBtn').addEventListener('click', () => commitImport(true));

    // Template Downloads
    $('dlCsvTplBtn').addEventListener('click', () => {
      const csv =
        '\uFEFF题型,题目,选项A,选项B,选项C,选项D,答案,解析,章节\n' +
        '单选题,HTTP默认端口号是？,21,22,80,443,C,HTTP默认80端口，HTTPS默认443端口,计算机网络\n' +
        '多选题,以下属于前端核心技术的有？,HTML,CSS,JavaScript,MySQL,ABC,MySQL是数据库,Web基础\n' +
        '判断题,队列是一种先进先出(FIFO)的数据结构。,,,,,对,栈是后进先出，队列是先进先出,数据结构\n' +
        '填空题,将域名解析为IP地址的协议简称是____。,,,,,DNS,Domain Name System,计算机网络\n';
      downloadFile('标准题库模板.csv', csv, 'text/csv;charset=utf-8');
    });

    $('dlTxtTplBtn').addEventListener('click', () => {
      downloadFile('标准题库模板.txt', SAMPLE_PASTE_TEXT, 'text/plain;charset=utf-8');
    });

    $('dlJsonTplBtn').addEventListener('click', () => {
      const sampleJson = JSON.stringify(
        {
          questions: createDemoQuestions().slice(0, 4)
        },
        null,
        2
      );
      downloadFile('标准题库模板.json', sampleJson, 'application/json;charset=utf-8');
    });

    // Study View controls
    $('exitStudyBtn').addEventListener('click', () => {
      if (state.session && state.session.mode === 'exam') {
        if (!confirm('正在进行模拟考试，退出将放弃本次考试进度，确认返回首页吗？')) return;
      }
      switchView('home');
    });
    $('reciteMaskToggleBtn').addEventListener('click', () => {
      if (!state.session) return;
      state.session.reciteMasked = !state.session.reciteMasked;
      state.session.items.forEach((it) => (it.revealed = false));
      renderStudyView();
    });
    $('toggleSheetBtn').addEventListener('click', openMobileSheet);
    $('closeSheetBtn').addEventListener('click', closeMobileSheet);
    $('sheetBackdrop').addEventListener('click', closeMobileSheet);

    $('qBookmarkBtn').addEventListener('click', toggleCurrentBookmark);
    $('qMasterBtn').addEventListener('click', toggleCurrentMastered);
    $('qEditBtn').addEventListener('click', () => {
      const ctx = getCurrentSessionContext();
      if (ctx) openEditQuestionModal(ctx.question.id);
    });

    $('qNoteInput').addEventListener('input', (e) => {
      const ctx = getCurrentSessionContext();
      if (!ctx) return;
      ctx.record.note = e.target.value;
      QuizStorage.saveRecords(state.recordsByBank);
    });

    $('prevQuestionBtn').addEventListener('click', goPrevQuestion);
    $('nextQuestionBtn').addEventListener('click', goNextQuestion);
    $('submitExamBtn').addEventListener('click', () => submitMockExam(false));
    $('sheetSubmitExamBtn').addEventListener('click', () => {
      closeMobileSheet();
      submitMockExam(false);
    });
    $('sheetRestartBtn').addEventListener('click', () => {
      if (!state.session) return;
      if (!confirm('确认重置本轮答题状态并从第 1 题重新开始吗？')) return;
      closeMobileSheet();
      startStudyMode(state.session.mode);
    });

    // Exam Config Modal
    document.querySelectorAll('.exam-count-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const max = parseInt($('examCountInput').max, 10) || 20;
        const val = btn.dataset.count === 'all' ? max : Math.min(max, parseInt(btn.dataset.count, 10));
        $('examCountInput').value = val;
      });
    });
    document.querySelectorAll('.exam-time-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('examMinutesInput').value = btn.dataset.min;
      });
    });
    $('startExamConfirmBtn').addEventListener('click', () => {
      const max = parseInt($('examCountInput').max, 10) || 1;
      const count = Math.max(1, Math.min(max, parseInt($('examCountInput').value, 10) || 20));
      const minutes = Math.max(1, Math.min(300, parseInt($('examMinutesInput').value, 10) || 30));
      const shuffleOptions = $('examShuffleOpts').checked;
      closeModal('examConfigModal');
      startStudyMode('exam', null, { count, minutes, shuffleOptions });
    });

    // Exam Result View
    $('resReviewWrongBtn').addEventListener('click', () => startExamReview(true));
    $('resReviewAllBtn').addEventListener('click', () => startExamReview(false));
    $('resRetakeBtn').addEventListener('click', openExamConfigModal);
    $('resBackHomeBtn').addEventListener('click', () => switchView('home'));

    // Manage View
    $('addQuestionBtn').addEventListener('click', () => {
      if (!getActiveBank()) {
        showToast('请先导入或创建一个题库', 'error');
        return;
      }
      openEditQuestionModal(null);
    });

    $('renameBankBtn').addEventListener('click', async () => {
      const bank = getActiveBank();
      if (!bank) return;
      const newName = prompt('请输入新的题库名称：', bank.name);
      if (newName && newName.trim()) {
        bank.name = newName.trim();
        await QuizStorage.saveBanks(state.banks);
        showToast('题库名称已更新', 'success');
        renderManage();
      }
    });

    $('exportBankJsonBtn').addEventListener('click', () => {
      const bank = getActiveBank();
      if (!bank) return;
      downloadFile(`${bank.name}_备份.json`, JSON.stringify(bank, null, 2), 'application/json;charset=utf-8');
      showToast('已导出题库 JSON 备份', 'success');
    });

    $('exportWrongMdBtn').addEventListener('click', exportWrongPrintableSheet);

    $('resetProgressBtn').addEventListener('click', async () => {
      const bank = getActiveBank();
      if (!bank) return;
      if (!confirm(`确定清空「${bank.name}」的全部刷题记录、错题本和斩杀进度吗？（题目本身不会删除）`)) return;
      state.recordsByBank[bank.id] = {};
      await QuizStorage.saveRecords(state.recordsByBank);
      await QuizStorage.clearSession(bank.id);
      showToast('刷题记录已清空，重新出发！', 'info');
      renderManage();
    });

    $('deleteBankBtn').addEventListener('click', async () => {
      const bank = getActiveBank();
      if (!bank) return;
      if (!confirm(`确定永久删除题库「${bank.name}」吗？此操作不可恢复。`)) return;
      state.banks = state.banks.filter((b) => b.id !== bank.id);
      delete state.recordsByBank[bank.id];
      await QuizStorage.clearSession(bank.id);
      state.activeBankId = state.banks[0] ? state.banks[0].id : null;
      await QuizStorage.saveBanks(state.banks);
      await QuizStorage.saveRecords(state.recordsByBank);
      await QuizStorage.saveActiveBankId(state.activeBankId);
      showToast('题库已删除', 'info');
      renderManage();
    });

    $('manageSearchInput').addEventListener('input', () => {
      state.manageRenderLimit = 50;
      renderManageQuestionList();
    });
    $('manageTypeFilter').addEventListener('change', () => {
      state.manageRenderLimit = 50;
      renderManageQuestionList();
    });
    $('manageStatusFilter').addEventListener('change', () => {
      state.manageRenderLimit = 50;
      renderManageQuestionList();
    });
    $('manageLoadMoreBtn').addEventListener('click', () => {
      state.manageRenderLimit += 80;
      renderManageQuestionList();
    });

    // Edit Question Modal
    $('editQType').addEventListener('change', toggleEditOptionsVisibility);
    $('addOptionRowBtn').addEventListener('click', () => {
      const rows = document.querySelectorAll('#editQOptionsList .edit-opt-row');
      const nextKey = OPTION_LETTERS[rows.length] || String(rows.length + 1);
      const div = document.createElement('div');
      div.className = 'edit-opt-row';
      div.innerHTML = `
        <input type="text" class="form-input edit-opt-key" value="${nextKey}" maxlength="2" />
        <input type="text" class="form-input edit-opt-text" placeholder="输入选项内容..." />
        <button type="button" class="icon-btn del-opt-row" title="删除选项">✕</button>`;
      div.querySelector('.del-opt-row').addEventListener('click', () => div.remove());
      $('editQOptionsList').appendChild(div);
    });
    $('saveEditQuestionBtn').addEventListener('click', saveEditedQuestion);

    // Generic modal close triggers
    document.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', () => closeModal(el.dataset.closeModal));
    });

    // Global keyboard shortcuts & swipe
    document.addEventListener('keydown', handleGlobalKeydown);
    bindTouchSwipe();
  }

  // ==================== BOOTSTRAP ====================
  async function init() {
    const saved = await QuizStorage.loadAll();
    state.banks = saved.banks;
    state.recordsByBank = saved.recordsByBank;
    state.settings = saved.settings;
    state.examHistory = saved.examHistory;
    state.activeBankId = saved.activeBankId || (state.banks[0] ? state.banks[0].id : null);

    // Auto-load optional local pre-bundled bank (js/builtin-bank.js, gitignored)
    if (window.BUILTIN_EXAM_BANK) {
      const builtin = window.BUILTIN_EXAM_BANK;
      const loadedIds = Array.isArray(state.settings.loadedBuiltinIds) ? state.settings.loadedBuiltinIds : [];
      const alreadyExists = state.banks.some((b) => b.id === builtin.id);
      if (!alreadyExists && !loadedIds.includes(builtin.id)) {
        state.banks.unshift(builtin);
        state.activeBankId = builtin.id;
        state.settings.loadedBuiltinIds = [...loadedIds, builtin.id];
        await QuizStorage.saveBanks(state.banks);
        await QuizStorage.saveActiveBankId(state.activeBankId);
        await QuizStorage.saveSettings(state.settings);
      }
    }

    applySettingsToDOM();
    bindEvents();
    renderHome();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
