<template>
  <view class="page-root" :class="{ 'theme-dark': store.settings.theme === 'dark' }">
    <view class="container">
      <!-- Top Sync & Theme Bar -->
      <view class="top-status-bar">
        <view class="sync-pill" @click="goProfile">
          <text v-if="store.auth.user" class="sync-dot" :class="'dot-' + store.syncStatus"></text>
          <text class="sync-text">{{ syncBannerText }}</text>
        </view>
        <view class="top-actions">
          <view v-if="store.auth.user" class="mini-icon-btn" @click="handleManualSync">🔄</view>
          <view class="mini-icon-btn" @click="toggleTheme">
            {{ store.settings.theme === 'dark' ? '☀️' : '🌙' }}
          </view>
        </view>
      </view>

      <!-- Empty State -->
      <view v-if="!activeBank" class="card empty-card">
        <view class="pill pill-blue">全平台通用 · 离线优先 + 云端同步</view>
        <view class="empty-title">导入你的题库，开启多端同步刷题</view>
        <view class="empty-desc">
          支持 Excel (.xlsx)、CSV、Word (.docx)、TXT、JSON 及智能粘贴。登录账号后，手机小程序、App、网页与电脑客户端自动合并刷题进度。
        </view>
        <view class="empty-btns">
          <button class="btn btn-primary" @click="goImport">📤 上传 / 粘贴题库</button>
          <button class="btn btn-secondary" @click="loadDemo">✨ 加载示例题库体验</button>
        </view>
      </view>

      <!-- Active Bank Dashboard -->
      <view v-else>
        <!-- Resume Session Banner -->
        <view v-if="savedSession" class="resume-bar">
          <view class="resume-left">
            <text class="resume-tag">上次进度</text>
            <text class="resume-info">{{ savedSessionLabel }}</text>
          </view>
          <view class="row-wrap">
            <button class="btn btn-primary btn-sm" @click="resumeLastSession">继续 →</button>
            <view class="dismiss-btn" @click="dismissSavedSession">✕</view>
          </view>
        </view>

        <!-- Overview Hero Card -->
        <view class="card">
          <view class="row-between bank-header">
            <picker
              mode="selector"
              :range="bankPickerNames"
              :value="activeBankIndex"
              @change="onBankPickerChange"
            >
              <view class="bank-selector">
                <text class="bank-title">{{ activeBank.name }}</text>
                <text class="bank-arrow">▾</text>
              </view>
            </picker>
            <text class="pill pill-blue">{{ activeBank.questions.length }} 题</text>
          </view>

          <!-- Progress Track -->
          <view class="prog-meta">
            <text>总体斩杀掌握率 {{ stats.masteredPct }}%</text>
            <text>已掌握 {{ stats.mastered }} / {{ stats.total }}</text>
          </view>
          <view class="prog-track">
            <view class="prog-done" :style="{ width: stats.donePct + '%' }"></view>
            <view class="prog-master" :style="{ width: stats.masteredPct + '%' }"></view>
          </view>

          <!-- 5 Stats Grid -->
          <view class="stats-grid">
            <view class="stat-box">
              <view class="stat-val">{{ stats.attempted }}</view>
              <view class="stat-lbl">已刷</view>
            </view>
            <view class="stat-box">
              <view class="stat-val text-green">{{ stats.accuracy }}</view>
              <view class="stat-lbl">正确率</view>
            </view>
            <view class="stat-box" @click="launchMode('wrong')">
              <view class="stat-val text-red">{{ stats.wrong }}</view>
              <view class="stat-lbl">错题本</view>
            </view>
            <view class="stat-box" @click="launchMode('bookmark')">
              <view class="stat-val text-amber">{{ stats.bookmarked }}</view>
              <view class="stat-lbl">收藏</view>
            </view>
            <view class="stat-box" @click="launchMode('sprint')">
              <view class="stat-val text-purple">{{ stats.unmastered }}</view>
              <view class="stat-lbl">待斩杀</view>
            </view>
          </view>

          <!-- Filter & Switches -->
          <view class="filter-panel">
            <view class="filter-pickers">
              <picker mode="selector" :range="typeOptionsLabels" :value="typeIdx" @change="onTypeChange">
                <view class="filter-chip">题型：{{ typeOptionsLabels[typeIdx] }} ▾</view>
              </picker>
              <picker
                v-if="categoryList.length > 1"
                mode="selector"
                :range="categoryList"
                :value="catIdx"
                @change="onCatChange"
              >
                <view class="filter-chip">章节：{{ shortCategoryLabel }} ▾</view>
              </picker>
            </view>
            <view class="switches-row">
              <view class="sw-item" @click="toggleShuffle">
                <switch :checked="store.settings.shuffleOptions" color="#2563EB" style="transform:scale(0.75)" />
                <text>选项乱序</text>
              </view>
              <view class="sw-item" @click="toggleAutoNext">
                <switch :checked="store.settings.autoNextOnCorrect" color="#2563EB" style="transform:scale(0.75)" />
                <text>答对自动下一题</text>
              </view>
            </view>
          </view>
        </view>

        <!-- 6 Study Modes -->
        <view class="sec-head">
          <text class="sec-title">选择刷题模式</text>
          <text class="sec-sub">当前筛选 {{ filteredPool.length }} 题</text>
        </view>

        <view class="modes-grid">
          <view class="mode-card" @click="launchMode('practice')">
            <view class="mode-icon bg-blue">📖</view>
            <view class="mode-info">
              <view class="row-between">
                <text class="mode-name">顺序刷题</text>
                <text class="pill pill-blue">{{ filteredPool.length }}题</text>
              </view>
              <view class="mode-desc">按题库原顺序逐题作答，即时批改并展示解析</view>
            </view>
          </view>

          <view class="mode-card" @click="launchMode('random')">
            <view class="mode-icon bg-cyan">🔀</view>
            <view class="mode-info">
              <view class="row-between">
                <text class="mode-name">随机乱序刷题</text>
                <text class="pill pill-blue">防背位置</text>
              </view>
              <view class="mode-desc">随机打乱题序，配合选项乱序真正吃透知识点</view>
            </view>
          </view>

          <view class="mode-card" @click="launchMode('sprint')">
            <view class="mode-icon bg-purple">⚔️</view>
            <view class="mode-info">
              <view class="row-between">
                <text class="mode-name">斩杀冲刺模式</text>
                <text class="pill pill-purple">待斩 {{ filteredUnmasteredCount }}</text>
              </view>
              <view class="mode-desc">只刷尚未掌握的题，连对达标自动斩杀，考前清零利器</view>
            </view>
          </view>

          <view class="mode-card" @click="launchMode('recite')">
            <view class="mode-icon bg-amber">⚡</view>
            <view class="mode-info">
              <view class="row-between">
                <text class="mode-name">极速背题模式</text>
                <text class="pill pill-amber">速记闪卡</text>
              </view>
              <view class="mode-desc">直接高亮答案与解析，支持一键遮挡主动回忆</view>
            </view>
          </view>

          <view class="mode-card" @click="launchMode('wrong')">
            <view class="mode-icon bg-red">🎯</view>
            <view class="mode-info">
              <view class="row-between">
                <text class="mode-name">错题本攻坚</text>
                <text class="pill pill-red">{{ filteredWrongCount }} 错题</text>
              </view>
              <view class="mode-desc">历史高频错题自动排最前，精准消灭薄弱盲区</view>
            </view>
          </view>

          <view class="mode-card" @click="openExamModal">
            <view class="mode-icon bg-green">⏱️</view>
            <view class="mode-info">
              <view class="row-between">
                <text class="mode-name">全真模拟考试</text>
                <text class="pill pill-green">限时评分</text>
              </view>
              <view class="mode-desc">自定题量与倒计时，交卷自动算分并按题型复盘</view>
            </view>
          </view>
        </view>

        <!-- Recent Exam History -->
        <view v-if="recentExams.length > 0" class="card">
          <view class="sec-title" style="margin-bottom: 16rpx">📊 最近模拟考试成绩</view>
          <view v-for="ex in recentExams" :key="ex.date" class="exam-hist-row">
            <text class="text-muted">{{ ex.timeText }} · 共 {{ ex.total }} 题（对 {{ ex.correct }}）</text>
            <text :class="ex.score >= 60 ? 'text-green' : 'text-red'" style="font-weight: 700">{{ ex.score }} 分</text>
          </view>
        </view>
      </view>
    </view>

    <!-- Mock Exam Setup Modal -->
    <view v-if="showExamModal" class="modal-mask" @click.self="showExamModal = false">
      <view class="modal-panel">
        <view class="row-between" style="margin-bottom: 24rpx">
          <text class="modal-title">⏱️ 全真模拟考试设置</text>
          <text class="dismiss-btn" @click="showExamModal = false">✕</text>
        </view>

        <view class="form-blk">
          <view class="form-lbl">抽题数量（最多 {{ filteredPool.length }} 题）</view>
          <view class="row-wrap" style="margin-bottom: 14rpx">
            <view class="preset-chip" @click="setExamCount(20)">20题</view>
            <view class="preset-chip" @click="setExamCount(50)">50题</view>
            <view class="preset-chip" @click="setExamCount(100)">100题</view>
            <view class="preset-chip" @click="setExamCount(filteredPool.length)">全部</view>
          </view>
          <input type="number" v-model="examCount" class="input-box" />
        </view>

        <view class="form-blk">
          <view class="form-lbl">考试时长（分钟）</view>
          <view class="row-wrap" style="margin-bottom: 14rpx">
            <view class="preset-chip" @click="examMinutes = 15">15分钟</view>
            <view class="preset-chip" @click="examMinutes = 30">30分钟</view>
            <view class="preset-chip" @click="examMinutes = 60">60分钟</view>
            <view class="preset-chip" @click="examMinutes = 90">90分钟</view>
          </view>
          <input type="number" v-model="examMinutes" class="input-box" />
        </view>

        <view class="row-between" style="margin-top: 28rpx">
          <button class="btn btn-secondary" style="flex:1;margin-right:16rpx" @click="showExamModal = false">取消</button>
          <button class="btn btn-primary" style="flex:1.4" @click="confirmStartExam">🚀 开始考试</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import {
  store,
  initAppStore,
  getActiveBank,
  getBankRecords,
  setActiveBank,
  persistSettings,
  persistBankSession,
  addOrImportBank,
  createDemoBankQuestions
} from '../../utils/store.js';
import { syncNow, triggerAutoSync } from '../../utils/cloud.js';
import { OPTION_LETTERS } from '../../utils/parser.js';

const TYPE_OPTIONS = [
  { value: 'all', label: '全部题型' },
  { value: 'single', label: '单选题' },
  { value: 'multiple', label: '多选题' },
  { value: 'judge', label: '判断题' },
  { value: 'fill', label: '填空题' },
  { value: 'short', label: '简答题' }
];
const typeOptionsLabels = TYPE_OPTIONS.map((o) => o.label);
const typeIdx = ref(0);
const catIdx = ref(0);

const showExamModal = ref(false);
const examCount = ref(20);
const examMinutes = ref(30);

onShow(() => {
  initAppStore();
  triggerAutoSync('show');
});

const activeBank = computed(() => getActiveBank());
const bankPickerNames = computed(() => store.banks.map((b) => `${b.name} (${b.questions.length}题)`));
const activeBankIndex = computed(() => {
  if (!activeBank.value) return 0;
  const i = store.banks.findIndex((b) => b.id === activeBank.value.id);
  return i >= 0 ? i : 0;
});

const syncBannerText = computed(() => {
  if (!store.auth.user) return '⚪ 本地离线模式 · 点此登录开启全平台云同步';
  const name = store.auth.user.nickname || store.auth.user.username;
  if (store.syncStatus === 'syncing') return `🔄 ${name} · 正在同步进度...`;
  if (store.syncStatus === 'error') return `⚠️ ${name} · ${store.syncMessage || '同步异常'}`;
  return `☁️ ${name} · 多端实时云同步中`;
});

const categoryList = computed(() => {
  const b = activeBank.value;
  if (!b) return ['全部章节'];
  const set = new Set();
  for (const q of b.questions) {
    if (q.category) set.add(q.category);
  }
  return ['全部章节', ...Array.from(set)];
});

const shortCategoryLabel = computed(() => {
  const lbl = categoryList.value[catIdx.value] || '全部章节';
  return lbl.length > 12 ? lbl.slice(0, 12) + '…' : lbl;
});

const stats = computed(() => {
  const b = activeBank.value;
  if (!b) return { total: 0, attempted: 0, accuracy: '--', wrong: 0, bookmarked: 0, mastered: 0, unmastered: 0, masteredPct: 0, donePct: 0 };
  const recs = getBankRecords(b.id);
  const total = b.questions.length;
  let attempted = 0, sumAtt = 0, sumCor = 0, wrong = 0, bookmarked = 0, mastered = 0;

  for (const q of b.questions) {
    const r = recs[q.id];
    if (r) {
      if (r.attempts > 0) attempted++;
      sumAtt += r.attempts || 0;
      sumCor += r.correct || 0;
      if (r.inWrongBook) wrong++;
      if (r.bookmarked) bookmarked++;
      if (r.mastered) mastered++;
    }
  }
  return {
    total,
    attempted,
    accuracy: sumAtt > 0 ? Math.round((sumCor / sumAtt) * 100) + '%' : '--',
    wrong,
    bookmarked,
    mastered,
    unmastered: total - mastered,
    masteredPct: total > 0 ? Math.round((mastered / total) * 100) : 0,
    donePct: total > 0 ? Math.round((attempted / total) * 100) : 0
  };
});

const filteredPool = computed(() => {
  const b = activeBank.value;
  if (!b) return [];
  const tVal = TYPE_OPTIONS[typeIdx.value]?.value || 'all';
  const cVal = categoryList.value[catIdx.value] || '全部章节';
  return b.questions.filter((q) => {
    if (tVal !== 'all' && q.type !== tVal) return false;
    if (catIdx.value > 0 && q.category !== cVal) return false;
    return true;
  });
});

const filteredUnmasteredCount = computed(() => {
  const b = activeBank.value;
  if (!b) return 0;
  const recs = getBankRecords(b.id);
  return filteredPool.value.filter((q) => !(recs[q.id] && recs[q.id].mastered)).length;
});

const filteredWrongCount = computed(() => {
  const b = activeBank.value;
  if (!b) return 0;
  const recs = getBankRecords(b.id);
  return filteredPool.value.filter((q) => recs[q.id] && recs[q.id].inWrongBook).length;
});

const savedSession = computed(() => {
  const b = activeBank.value;
  if (!b) return null;
  const s = store.sessionsByBank[b.id];
  return s && s.items && s.items.length > 0 ? s : null;
});

const MODE_NAMES = {
  practice: '顺序刷题',
  random: '随机乱序',
  sprint: '斩杀冲刺',
  recite: '极速背题',
  wrong: '错题攻坚',
  bookmark: '重点收藏'
};

const savedSessionLabel = computed(() => {
  const s = savedSession.value;
  if (!s) return '';
  return `${MODE_NAMES[s.mode] || '刷题'} · 第 ${(s.currentIndex || 0) + 1} / ${s.items.length} 题`;
});

const recentExams = computed(() => {
  const b = activeBank.value;
  if (!b) return [];
  return store.examHistory
    .filter((h) => h.bankId === b.id)
    .slice(0, 5)
    .map((h) => {
      const dt = new Date(h.date);
      const timeText = `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      return { ...h, timeText };
    });
});

function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildSessionItem(q, shouldShuffleOpts) {
  let displayOptions = [];
  if (q.options && q.options.length > 0) {
    if (shouldShuffleOpts && (q.type === 'single' || q.type === 'multiple')) {
      displayOptions = shuffleArray(q.options).map((opt, idx) => ({
        displayKey: OPTION_LETTERS[idx] || String(idx + 1),
        origKey: opt.key,
        text: opt.text
      }));
    } else {
      displayOptions = q.options.map((opt) => ({
        displayKey: opt.key,
        origKey: opt.key,
        text: opt.text
      }));
    }
  }
  return {
    questionId: q.id,
    displayOptions,
    selectedKeys: [],
    userText: '',
    submitted: false,
    isCorrect: null,
    revealed: false
  };
}

function launchMode(mode, examOpts = null) {
  const b = activeBank.value;
  if (!b) return;
  const recs = getBankRecords(b.id);
  let pool = filteredPool.value.slice();

  if (mode === 'sprint') {
    pool = pool.filter((q) => !(recs[q.id] && recs[q.id].mastered));
    if (pool.length === 0) {
      uni.showToast({ title: '🎉 当前范围已全部斩杀完毕！', icon: 'none' });
      return;
    }
    pool = shuffleArray(pool);
  } else if (mode === 'wrong') {
    pool = pool
      .filter((q) => recs[q.id] && recs[q.id].inWrongBook)
      .sort((x, y) => ((recs[y.id] && recs[y.id].wrong) || 0) - ((recs[x.id] && recs[x.id].wrong) || 0));
    if (pool.length === 0) {
      uni.showToast({ title: '👏 当前范围暂无错题！', icon: 'none' });
      return;
    }
  } else if (mode === 'bookmark') {
    pool = b.questions.filter((q) => recs[q.id] && recs[q.id].bookmarked);
    if (pool.length === 0) {
      uni.showToast({ title: '暂无收藏重点题', icon: 'none' });
      return;
    }
  } else if (mode === 'random') {
    pool = shuffleArray(pool);
  } else if (mode === 'exam' && examOpts) {
    pool = shuffleArray(pool).slice(0, examOpts.count);
  }

  if (pool.length === 0) {
    uni.showToast({ title: '当前筛选下没有题目', icon: 'none' });
    return;
  }

  const shouldShuffle = Boolean(store.settings.shuffleOptions);
  store.activeSession = {
    bankId: b.id,
    mode,
    items: pool.map((q) => buildSessionItem(q, shouldShuffle)),
    currentIndex: 0,
    reciteMasked: false,
    shuffleOptions: shouldShuffle,
    examDurationSec: examOpts ? examOpts.minutes * 60 : 0,
    examRemainingSec: examOpts ? examOpts.minutes * 60 : 0
  };

  if (mode !== 'exam') {
    persistBankSession(b.id, store.activeSession);
  }
  uni.navigateTo({ url: '/pages/study/study' });
}

function resumeLastSession() {
  const b = activeBank.value;
  const s = savedSession.value;
  if (!b || !s) return;
  const qSet = new Set(b.questions.map((q) => q.id));
  const validItems = s.items.filter((it) => qSet.has(it.questionId));
  if (validItems.length === 0) {
    persistBankSession(b.id, null);
    return;
  }
  store.activeSession = {
    bankId: b.id,
    mode: s.mode,
    items: validItems,
    currentIndex: Math.min(s.currentIndex || 0, validItems.length - 1),
    reciteMasked: false,
    shuffleOptions: Boolean(s.shuffleOptions),
    examDurationSec: 0,
    examRemainingSec: 0
  };
  uni.navigateTo({ url: '/pages/study/study' });
}

function dismissSavedSession() {
  if (activeBank.value) persistBankSession(activeBank.value.id, null);
}

function openExamModal() {
  if (filteredPool.value.length === 0) {
    uni.showToast({ title: '当前筛选下无题目', icon: 'none' });
    return;
  }
  examCount.value = Math.min(20, filteredPool.value.length);
  examMinutes.value = 30;
  showExamModal.value = true;
}

function setExamCount(n) {
  examCount.value = Math.max(1, Math.min(filteredPool.value.length, n));
}

function confirmStartExam() {
  const count = Math.max(1, Math.min(filteredPool.value.length, Number(examCount.value) || 20));
  const minutes = Math.max(1, Math.min(300, Number(examMinutes.value) || 30));
  showExamModal.value = false;
  launchMode('exam', { count, minutes });
}

function onBankPickerChange(e) {
  const idx = Number(e.detail.value) || 0;
  if (store.banks[idx]) {
    setActiveBank(store.banks[idx].id);
    catIdx.value = 0;
  }
}

function onTypeChange(e) {
  typeIdx.value = Number(e.detail.value) || 0;
}

function onCatChange(e) {
  catIdx.value = Number(e.detail.value) || 0;
}

function toggleShuffle() {
  store.settings.shuffleOptions = !store.settings.shuffleOptions;
  persistSettings();
}

function toggleAutoNext() {
  store.settings.autoNextOnCorrect = !store.settings.autoNextOnCorrect;
  persistSettings();
}

function toggleTheme() {
  store.settings.theme = store.settings.theme === 'dark' ? 'light' : 'dark';
  persistSettings();
}

function handleManualSync() {
  syncNow(false);
}

function loadDemo() {
  addOrImportBank('示例题库 · 计算机基础突击', createDemoBankQuestions(), false);
  triggerAutoSync('demo');
  uni.showToast({ title: '示例题库已加载', icon: 'success' });
}

function goImport() {
  uni.switchTab({ url: '/pages/import/import' });
}

function goProfile() {
  uni.switchTab({ url: '/pages/profile/profile' });
}
</script>

<style scoped>
.top-status-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22rpx;
  gap: 16rpx;
}
.sync-pill {
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 22rpx;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
}
.sync-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background-color: #22c55e;
}
.dot-syncing { background-color: #3b82f6; }
.dot-error { background-color: #ef4444; }
.sync-text {
  font-size: 24rpx;
  color: var(--text-sec);
}
.top-actions {
  display: flex;
  flex-direction: row;
  gap: 12rpx;
}
.mini-icon-btn {
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  background-color: var(--surface);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
}

.empty-card {
  text-align: center;
  padding: 64rpx 36rpx;
}
.empty-title {
  font-size: 38rpx;
  font-weight: 800;
  margin: 24rpx 0 16rpx;
}
.empty-desc {
  font-size: 26rpx;
  color: var(--text-muted);
  line-height: 1.7;
  margin-bottom: 36rpx;
}
.empty-btns {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  max-width: 480rpx;
  margin: 0 auto;
}

.resume-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 26rpx;
  border-radius: 20rpx;
  background-color: var(--primary-soft);
  border: 1px solid var(--primary-border);
  margin-bottom: 22rpx;
}
.resume-left {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
  flex: 1;
}
.resume-tag {
  background-color: var(--primary);
  color: #ffffff;
  font-size: 20rpx;
  font-weight: 700;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}
.resume-info {
  font-size: 26rpx;
  font-weight: 600;
}
.dismiss-btn {
  padding: 8rpx 14rpx;
  color: var(--text-muted);
  font-size: 28rpx;
}

.bank-header {
  margin-bottom: 22rpx;
}
.bank-selector {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10rpx;
}
.bank-title {
  font-size: 34rpx;
  font-weight: 800;
}
.bank-arrow {
  font-size: 28rpx;
  color: var(--primary);
}

.prog-meta {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  font-size: 24rpx;
  color: var(--text-muted);
  margin-bottom: 10rpx;
}
.prog-track {
  position: relative;
  height: 16rpx;
  border-radius: 999px;
  background-color: var(--surface-hover);
  overflow: hidden;
  margin-bottom: 28rpx;
}
.prog-done {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background-color: var(--primary-border);
}
.prog-master {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(90deg, #2563eb, #7c3aed);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12rpx;
  margin-bottom: 26rpx;
}
.stat-box {
  background-color: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 16rpx;
  padding: 18rpx 8rpx;
  text-align: center;
}
.stat-val {
  font-size: 32rpx;
  font-weight: 800;
}
.stat-lbl {
  font-size: 22rpx;
  color: var(--text-muted);
  margin-top: 4rpx;
}

.filter-panel {
  border-top: 1px dashed var(--border);
  padding-top: 22rpx;
}
.filter-pickers {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-bottom: 16rpx;
}
.filter-chip {
  padding: 10rpx 22rpx;
  border-radius: 12rpx;
  background-color: var(--surface-alt);
  border: 1px solid var(--border-strong);
  font-size: 24rpx;
  font-weight: 500;
}
.switches-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 24rpx;
}
.sw-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  font-size: 24rpx;
  color: var(--text-sec);
}

.sec-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  margin: 8rpx 4rpx 18rpx;
}
.sec-title {
  font-size: 30rpx;
  font-weight: 700;
}
.sec-sub {
  font-size: 24rpx;
  color: var(--text-muted);
}

.modes-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18rpx;
  margin-bottom: 26rpx;
}
@media (min-width: 720px) {
  .modes-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.mode-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 22rpx;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 22rpx;
  padding: 28rpx;
}
.mode-icon {
  width: 84rpx;
  height: 84rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  flex-shrink: 0;
}
.bg-blue { background-color: var(--primary-soft); }
.bg-cyan { background-color: rgba(6, 182, 212, 0.14); }
.bg-purple { background-color: var(--purple-soft); }
.bg-amber { background-color: var(--amber-soft); }
.bg-red { background-color: var(--red-soft); }
.bg-green { background-color: var(--green-soft); }

.mode-info {
  flex: 1;
}
.mode-name {
  font-size: 30rpx;
  font-weight: 700;
}
.mode-desc {
  font-size: 24rpx;
  color: var(--text-muted);
  margin-top: 6rpx;
}

.exam-hist-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 14rpx 0;
  border-bottom: 1px solid var(--border);
  font-size: 25rpx;
}

.modal-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: rgba(15, 23, 42, 0.55);
  z-index: 99;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32rpx;
}
.modal-panel {
  width: 100%;
  max-width: 640rpx;
  background-color: var(--surface);
  border-radius: 24rpx;
  padding: 34rpx;
}
.modal-title {
  font-size: 32rpx;
  font-weight: 700;
}
.form-blk {
  margin-bottom: 24rpx;
}
.form-lbl {
  font-size: 25rpx;
  color: var(--text-sec);
  margin-bottom: 12rpx;
}
.preset-chip {
  padding: 8rpx 20rpx;
  border-radius: 999px;
  background-color: var(--surface-alt);
  border: 1px solid var(--border-strong);
  font-size: 24rpx;
}
</style>
