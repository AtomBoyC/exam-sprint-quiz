<template>
  <view
    class="page-root"
    :class="[store.settings.theme === 'dark' ? 'theme-dark' : '', 'font-' + store.settings.fontSize]"
    @touchstart="onTouchStart"
    @touchend="onTouchEnd"
  >
    <view class="container" v-if="session && currentQuestion">
      <!-- Exam Finished Report View -->
      <view v-if="examReport" class="card report-card">
        <view class="score-badge" :class="examReport.score >= 60 ? 'pass' : 'fail'">
          <text class="score-big">{{ examReport.score }}</text>
          <text class="score-sub">分</text>
        </view>
        <view class="report-title">{{ examReport.verdict }}</view>

        <view class="report-stats">
          <view class="r-stat"><text class="text-green r-num">{{ examReport.correct }}</text><text class="r-lbl">答对</text></view>
          <view class="r-stat"><text class="text-red r-num">{{ examReport.wrong }}</text><text class="r-lbl">答错</text></view>
          <view class="r-stat"><text class="r-num">{{ examReport.unanswered }}</text><text class="r-lbl">未答</text></view>
          <view class="r-stat"><text class="r-num">{{ examReport.timeText }}</text><text class="r-lbl">用时</text></view>
        </view>

        <view class="type-breakdown">
          <view v-for="tb in examReport.typeBreakdown" :key="tb.type" class="tb-row">
            <text class="tb-name">{{ tb.label }}</text>
            <view class="tb-bar"><view class="tb-fill" :style="{ width: tb.pct + '%' }"></view></view>
            <text class="tb-val">{{ tb.correct }}/{{ tb.total }} ({{ tb.pct }}%)</text>
          </view>
        </view>

        <view class="report-btns">
          <button v-if="examReport.wrong > 0" class="btn btn-danger btn-block" @click="startExamReview(true)">
            🎯 只复盘错题 ({{ examReport.wrong }})
          </button>
          <button class="btn btn-secondary btn-block" @click="startExamReview(false)">📖 查看全卷解析</button>
          <button class="btn btn-primary btn-block" @click="exitStudy">返回刷题首页</button>
        </view>
      </view>

      <!-- Active Study / Exam Layout -->
      <view v-else>
        <!-- Top Strip -->
        <view class="study-topbar">
          <view class="row-wrap">
            <text class="pill pill-blue">{{ modeLabel }}</text>
            <text class="q-counter">{{ session.currentIndex + 1 }} / {{ session.items.length }}</text>
            <text v-if="isExam" class="timer-pill" :class="{ urgent: session.examRemainingSec <= 300 }">
              ⏱️ {{ examTimerText }}
            </text>
          </view>
          <view class="row-wrap">
            <view v-if="isRecite" class="chip-action" @click="toggleReciteMask">
              {{ session.reciteMasked ? '👁️ 显答案' : '🙈 遮答案' }}
            </view>
            <view class="chip-action" @click="showSheetDrawer = true">📋 答题卡</view>
          </view>
        </view>

        <!-- Progress Line -->
        <view class="thin-prog">
          <view class="thin-fill" :style="{ width: progressPct + '%' }"></view>
        </view>

        <view class="study-grid">
          <!-- Left / Main Question Card -->
          <view class="study-main">
            <view class="card q-card">
              <view class="row-between q-meta-row">
                <view class="row-wrap">
                  <text class="q-type-tag">{{ currentTypeLabel }}</text>
                  <text v-if="currentQuestion.category" class="pill pill-gray">{{ shortCategory }}</text>
                  <text v-if="currentRecord.wrong > 0 && !isExam" class="pill pill-red">错 {{ currentRecord.wrong }} 次</text>
                </view>
                <view class="row-wrap">
                  <view
                    class="chip-action"
                    :class="{ 'active-amber': currentRecord.bookmarked }"
                    @click="toggleBookmark"
                  >
                    {{ currentRecord.bookmarked ? '★ 已藏' : '☆ 收藏' }}
                  </view>
                  <view
                    v-if="!isExam"
                    class="chip-action"
                    :class="{ 'active-purple': currentRecord.mastered }"
                    @click="toggleMastered"
                  >
                    {{ currentRecord.mastered ? '⚔️ 已斩' : '⚔️ 斩杀' }}
                  </view>
                </view>
              </view>

              <!-- Stem -->
              <view class="q-stem">{{ currentQuestion.stem }}</view>

              <!-- Choice & Judge Options -->
              <view v-if="isChoiceOrJudge" class="opts-wrap">
                <view
                  v-for="opt in renderedOptions"
                  :key="opt.displayKey"
                  class="opt-row"
                  :class="opt.stateClass"
                  @click="onSelectOption(opt.displayKey)"
                >
                  <view class="opt-key">{{ opt.displayKey }}</view>
                  <view class="opt-txt">{{ opt.text }}</view>
                </view>

                <button
                  v-if="currentQuestion.type === 'multiple' && !showSolution && !isExam"
                  class="btn btn-primary btn-block"
                  style="margin-top: 24rpx"
                  :disabled="currentItem.selectedKeys.length === 0"
                  @click="submitMultipleChoice"
                >
                  确认提交多选 ({{ currentItem.selectedKeys.join('') || '未选' }})
                </button>
              </view>

              <!-- Fill-in-the-blank -->
              <view v-else-if="currentQuestion.type === 'fill' && !isRecite" class="fill-wrap">
                <input
                  class="input-box"
                  placeholder="请输入填空答案..."
                  :disabled="showSolution"
                  v-model="currentItem.userText"
                  @confirm="submitFillAnswer"
                />
                <button
                  v-if="!showSolution && !isExam"
                  class="btn btn-primary btn-block"
                  style="margin-top: 18rpx"
                  @click="submitFillAnswer"
                >
                  核对答案
                </button>
              </view>

              <!-- Short Answer -->
              <view v-else-if="currentQuestion.type === 'short' && !isRecite" class="short-wrap">
                <textarea
                  class="textarea-box"
                  placeholder="可输入答题关键词（也可直接查看参考答案自评）..."
                  :disabled="isReview"
                  v-model="currentItem.userText"
                />
                <button
                  v-if="!isExam && !isReview && !currentItem.revealed && !currentItem.submitted"
                  class="btn btn-primary btn-block"
                  style="margin-top: 18rpx"
                  @click="revealShortAnswer"
                >
                  👁️ 显示参考答案并自评
                </button>
                <view
                  v-if="!isExam && !isReview && currentItem.revealed && !currentItem.submitted"
                  class="row-between"
                  style="margin-top: 18rpx"
                >
                  <button class="btn btn-success" style="flex:1" @click="selfGradeShort(true)">✅ 我记住了</button>
                  <button class="btn btn-danger" style="flex:1" @click="selfGradeShort(false)">❌ 没记住</button>
                </view>
              </view>

              <!-- Recite Masked Box -->
              <view
                v-if="isRecite && session.reciteMasked && !currentItem.revealed"
                class="mask-reveal-card"
                @click="revealReciteCurrent"
              >
                🙈 答案已遮挡 · 点击此处揭晓答案与解析
              </view>

              <!-- Feedback & Analysis Box -->
              <view v-if="shouldShowFeedback" class="feedback-wrap">
                <view class="fb-banner" :class="feedbackBannerClass">
                  <text>{{ feedbackBannerText }}</text>
                  <text
                    v-if="currentQuestion.type === 'fill' && currentItem.isCorrect === false && !isReview"
                    class="override-link"
                    @click="overrideFillCorrect"
                  >
                    算我答对
                  </text>
                </view>

                <view class="ans-line">
                  <text class="ans-lbl">参考答案：</text>
                  <text class="ans-val">{{ displayCorrectAnswer }}</text>
                </view>

                <view v-if="currentQuestion.analysis" class="ana-card">
                  <view class="ana-head">💡 答案解析</view>
                  <view class="ana-body">{{ currentQuestion.analysis }}</view>
                </view>

                <!-- Mnemonic Note -->
                <view class="note-wrap">
                  <view class="note-lbl">📝 个人助记笔记（自动云同步）</view>
                  <textarea
                    class="note-input"
                    placeholder="记下口诀或易错点，下次自动展示..."
                    :value="currentRecord.note"
                    @input="onNoteInput"
                  />
                </view>
              </view>
            </view>

            <!-- Bottom Navigation -->
            <view class="nav-footer">
              <button class="btn btn-secondary" :disabled="session.currentIndex === 0" @click="prevQuestion">
                ← 上一题
              </button>
              <button v-if="isExam" class="btn btn-success" @click="confirmSubmitExam">✅ 交卷评分</button>
              <button class="btn btn-primary" :disabled="isExam && isLastQuestion" @click="nextQuestion">
                {{ isLastQuestion ? (isExam ? '末题' : '完成本轮 ✓') : '下一题 →' }}
              </button>
            </view>
          </view>

          <!-- Desktop Wide-Screen Inline Answer Sheet -->
          <view class="desktop-sheet card">
            <view class="sec-title" style="margin-bottom: 18rpx">📋 答题卡 ({{ session.items.length }})</view>
            <view class="sheet-grid">
              <view
                v-for="(st, idx) in sheetCells"
                :key="idx"
                class="sheet-cell"
                :class="st.cls"
                @click="jumpTo(idx)"
              >
                {{ idx + 1 }}
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- Mobile Answer Sheet Drawer -->
    <view v-if="showSheetDrawer" class="modal-mask" @click.self="showSheetDrawer = false">
      <view class="sheet-drawer">
        <view class="row-between" style="margin-bottom: 20rpx">
          <text class="modal-title">📋 答题卡 ({{ session ? session.items.length : 0 }} 题)</text>
          <text class="dismiss-btn" @click="showSheetDrawer = false">✕</text>
        </view>
        <scroll-view scroll-y style="max-height: 60vh">
          <view class="sheet-grid">
            <view
              v-for="(st, idx) in sheetCells"
              :key="idx"
              class="sheet-cell"
              :class="st.cls"
              @click="jumpFromDrawer(idx)"
            >
              {{ idx + 1 }}
            </view>
          </view>
        </scroll-view>
        <button v-if="isExam" class="btn btn-success btn-block" style="margin-top: 24rpx" @click="submitFromDrawer">
          ✅ 立即交卷并查看成绩
        </button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  store,
  getBankRecords,
  getQuestionRecord,
  persistBankRecords,
  persistBankSession,
  persistExamHistory
} from '../../utils/store.js';
import { triggerAutoSync } from '../../utils/cloud.js';
import { TYPE_LABELS, checkAnswer } from '../../utils/parser.js';

const showSheetDrawer = ref(false);
const examReport = ref(null);

let autoNextTimer = null;
let examInterval = null;
let touchStartX = 0;
let touchStartY = 0;

const session = computed(() => store.activeSession);
const bank = computed(() => {
  if (!session.value) return null;
  return store.banks.find((b) => b.id === session.value.bankId) || null;
});

const currentItem = computed(() => {
  if (!session.value) return null;
  return session.value.items[session.value.currentIndex] || null;
});

const currentQuestion = computed(() => {
  if (!bank.value || !currentItem.value) return null;
  return bank.value.questions.find((q) => q.id === currentItem.value.questionId) || null;
});

const currentRecord = computed(() => {
  if (!bank.value || !currentQuestion.value) return {};
  return getQuestionRecord(bank.value.id, currentQuestion.value.id);
});

const isExam = computed(() => session.value && session.value.mode === 'exam');
const isRecite = computed(() => session.value && session.value.mode === 'recite');
const isReview = computed(() => session.value && session.value.mode === 'exam-review');
const isLastQuestion = computed(
  () => session.value && session.value.currentIndex >= session.value.items.length - 1
);

const MODE_LABELS = {
  practice: '顺序刷题',
  random: '随机乱序',
  sprint: '⚔️ 斩杀冲刺',
  recite: '⚡ 极速背题',
  wrong: '🎯 错题攻坚',
  bookmark: '⭐ 重点收藏',
  exam: '⏱️ 全真模拟考',
  'exam-review': '📖 模考复盘'
};
const modeLabel = computed(() => (session.value ? MODE_LABELS[session.value.mode] || '刷题' : ''));
const currentTypeLabel = computed(() =>
  currentQuestion.value ? TYPE_LABELS[currentQuestion.value.type] || '题目' : ''
);
const shortCategory = computed(() => {
  const c = (currentQuestion.value && currentQuestion.value.category) || '';
  return c.length > 14 ? c.slice(0, 14) + '…' : c;
});

const progressPct = computed(() => {
  if (!session.value || session.value.items.length === 0) return 0;
  return Math.round(((session.value.currentIndex + 1) / session.value.items.length) * 100);
});

const examTimerText = computed(() => {
  const s = Math.max(0, Math.floor((session.value && session.value.examRemainingSec) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
});

const isChoiceOrJudge = computed(() => {
  const t = currentQuestion.value && currentQuestion.value.type;
  return t === 'single' || t === 'multiple' || t === 'judge';
});

const showSolution = computed(() => {
  if (!session.value || !currentItem.value) return false;
  if (isExam.value) return false;
  if (isReview.value) return true;
  if (isRecite.value) return !session.value.reciteMasked || currentItem.value.revealed;
  return Boolean(currentItem.value.submitted);
});

const renderedOptions = computed(() => {
  if (!currentQuestion.value || !currentItem.value) return [];
  const q = currentQuestion.value;
  const it = currentItem.value;
  const rightOrigSet = new Set(
    q.type === 'judge' ? [q.answer] : String(q.answer || '').toUpperCase().split('')
  );

  return (it.displayOptions || []).map((opt) => {
    const selected = it.selectedKeys.includes(opt.displayKey);
    const isRight = rightOrigSet.has(q.type === 'judge' ? opt.origKey : opt.origKey.toUpperCase());
    let stateClass = '';
    if (showSolution.value) {
      if (isRecite.value) {
        if (isRight) stateClass = 'opt-correct';
      } else {
        if (selected && isRight) stateClass = 'opt-correct';
        else if (selected && !isRight) stateClass = 'opt-wrong';
        else if (!selected && isRight) stateClass = 'opt-missed';
      }
    } else if (selected) {
      stateClass = 'opt-selected';
    }
    return { ...opt, stateClass };
  });
});

const shouldShowFeedback = computed(() => {
  if (!session.value || !currentItem.value || isExam.value) return false;
  if (isReview.value) return true;
  if (isRecite.value) return !session.value.reciteMasked || currentItem.value.revealed;
  if (currentQuestion.value && currentQuestion.value.type === 'short' && currentItem.value.revealed) return true;
  return Boolean(currentItem.value.submitted);
});

const feedbackBannerClass = computed(() => {
  if (isRecite.value) return 'fb-info';
  if (currentItem.value && currentItem.value.isCorrect === true) return 'fb-right';
  if (currentItem.value && currentItem.value.isCorrect === false) return 'fb-wrong';
  return 'fb-info';
});

const feedbackBannerText = computed(() => {
  if (isRecite.value) return '⚡ 背题模式 · 标准答案与解析';
  if (currentQuestion.value && currentQuestion.value.type === 'short' && !currentItem.value.submitted) {
    return '👀 请对照参考答案在上方点击自评按钮';
  }
  if (currentItem.value && currentItem.value.isCorrect === true) {
    return currentRecord.value.mastered ? '✅ 回答正确 · ⚔️ 已斩杀！' : '✅ 回答正确！';
  }
  if (currentItem.value && currentItem.value.isCorrect === false) {
    return '❌ 回答错误，已记入错题本';
  }
  return 'ℹ️ 作答详情';
});

const displayCorrectAnswer = computed(() => {
  const q = currentQuestion.value;
  const it = currentItem.value;
  if (!q || !q.answer) return '暂无标准答案';
  if ((q.type === 'single' || q.type === 'multiple') && it && it.displayOptions.length > 0) {
    const origSet = new Set(q.answer.toUpperCase().split(''));
    const mapped = it.displayOptions.filter((o) => origSet.has(o.origKey.toUpperCase())).map((o) => o.displayKey).join('');
    if (mapped && mapped !== q.answer.toUpperCase()) {
      return `${mapped}（原题库 ${q.answer}）`;
    }
    return mapped || q.answer;
  }
  return q.answer;
});

const sheetCells = computed(() => {
  if (!session.value || !bank.value) return [];
  const recs = getBankRecords(bank.value.id);
  return session.value.items.map((it, idx) => {
    const cls = [];
    if (idx === session.value.currentIndex) cls.push('sc-current');
    if (recs[it.questionId] && recs[it.questionId].bookmarked) cls.push('sc-star');
    if (isExam.value) {
      if (it.selectedKeys.length > 0 || (it.userText && it.userText.trim())) cls.push('sc-answered');
    } else if (it.submitted) {
      if (it.isCorrect === true) cls.push('sc-right');
      else if (it.isCorrect === false) cls.push('sc-wrong');
    }
    return { cls: cls.join(' ') };
  });
});

function mapSelectedToOrig(item, question) {
  if (question.type === 'judge') return item.selectedKeys[0] || '';
  const m = new Map(item.displayOptions.map((o) => [o.displayKey, o.origKey]));
  return item.selectedKeys.map((dk) => m.get(dk) || dk).sort().join('');
}

function recordOutcome(isCorrect, givenStr) {
  const b = bank.value;
  const q = currentQuestion.value;
  const it = currentItem.value;
  const rec = currentRecord.value;
  if (!b || !q || !it) return;

  it.submitted = true;
  it.isCorrect = isCorrect;

  if (isCorrect !== null) {
    rec.attempts = (rec.attempts || 0) + 1;
    rec.lastAnswer = givenStr;
    rec.lastCorrect = isCorrect;
    rec.updatedAt = Date.now();

    if (isCorrect) {
      rec.correct = (rec.correct || 0) + 1;
      rec.streak = (rec.streak || 0) + 1;
      if (rec.streak >= (store.settings.masteryStreakTarget || 1)) {
        rec.mastered = true;
      }
      if (session.value.mode === 'wrong' && store.settings.autoRemoveWrongOnCorrect && rec.inWrongBook) {
        rec.inWrongBook = false;
        uni.showToast({ title: '🎉 已移出错题本', icon: 'none' });
      }
    } else {
      rec.wrong = (rec.wrong || 0) + 1;
      rec.streak = 0;
      rec.mastered = false;
      rec.inWrongBook = true;
    }
    persistBankRecords(b.id);
    triggerAutoSync('answer');
  }

  persistBankSession(b.id, session.value);

  if (
    isCorrect === true &&
    store.settings.autoNextOnCorrect &&
    (q.type === 'single' || q.type === 'judge') &&
    !isLastQuestion.value
  ) {
    clearAutoNext();
    autoNextTimer = setTimeout(() => {
      nextQuestion();
    }, Number(store.settings.autoNextDelayMs) || 600);
  }
}

function onSelectOption(displayKey) {
  if (!session.value || !currentItem.value || !currentQuestion.value) return;
  if (showSolution.value || isRecite.value || isReview.value) return;

  const q = currentQuestion.value;
  const it = currentItem.value;

  if (q.type === 'multiple') {
    const idx = it.selectedKeys.indexOf(displayKey);
    if (idx >= 0) it.selectedKeys.splice(idx, 1);
    else it.selectedKeys.push(displayKey);
    it.selectedKeys.sort();
    return;
  }

  it.selectedKeys = [displayKey];
  if (!isExam.value) {
    const orig = mapSelectedToOrig(it, q);
    const res = checkAnswer(q, orig);
    recordOutcome(res.isCorrect, orig);
  }
}

function submitMultipleChoice() {
  if (!currentItem.value || currentItem.value.selectedKeys.length === 0) return;
  const orig = mapSelectedToOrig(currentItem.value, currentQuestion.value);
  const res = checkAnswer(currentQuestion.value, orig);
  recordOutcome(res.isCorrect, orig);
}

function submitFillAnswer() {
  if (!currentItem.value || isExam.value) return;
  const res = checkAnswer(currentQuestion.value, currentItem.value.userText);
  recordOutcome(res.isCorrect, currentItem.value.userText);
}

function revealShortAnswer() {
  if (currentItem.value) currentItem.value.revealed = true;
}

function selfGradeShort(isRight) {
  recordOutcome(isRight, currentItem.value.userText || (isRight ? '自评掌握' : '自评未掌握'));
}

function overrideFillCorrect() {
  const rec = currentRecord.value;
  const it = currentItem.value;
  if (!it || it.isCorrect !== false) return;
  it.isCorrect = true;
  rec.wrong = Math.max(0, (rec.wrong || 1) - 1);
  rec.correct = (rec.correct || 0) + 1;
  rec.streak = (rec.streak || 0) + 1;
  if (rec.streak >= (store.settings.masteryStreakTarget || 1)) rec.mastered = true;
  if (rec.wrong === 0) rec.inWrongBook = false;
  rec.updatedAt = Date.now();
  persistBankRecords(bank.value.id);
  triggerAutoSync('override');
}

function toggleReciteMask() {
  if (!session.value) return;
  session.value.reciteMasked = !session.value.reciteMasked;
  session.value.items.forEach((it) => (it.revealed = false));
}

function revealReciteCurrent() {
  if (currentItem.value) currentItem.value.revealed = true;
}

function toggleBookmark() {
  const rec = currentRecord.value;
  rec.bookmarked = !rec.bookmarked;
  rec.updatedAt = Date.now();
  persistBankRecords(bank.value.id);
  triggerAutoSync('bookmark');
  uni.showToast({ title: rec.bookmarked ? '★ 已收藏' : '已取消收藏', icon: 'none' });
}

function toggleMastered() {
  const rec = currentRecord.value;
  rec.mastered = !rec.mastered;
  rec.streak = rec.mastered ? Math.max(1, store.settings.masteryStreakTarget || 1) : 0;
  rec.updatedAt = Date.now();
  persistBankRecords(bank.value.id);
  triggerAutoSync('master');
  uni.showToast({ title: rec.mastered ? '⚔️ 已斩杀' : '已取消斩杀', icon: 'none' });
}

function onNoteInput(e) {
  const rec = currentRecord.value;
  rec.note = e.detail.value;
  rec.updatedAt = Date.now();
  persistBankRecords(bank.value.id);
  triggerAutoSync('note');
}

function clearAutoNext() {
  if (autoNextTimer) {
    clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
}

function jumpTo(idx) {
  clearAutoNext();
  if (!session.value || idx < 0 || idx >= session.value.items.length) return;
  session.value.currentIndex = idx;
  if (!isExam.value && !isReview.value) persistBankSession(bank.value.id, session.value);
}

function jumpFromDrawer(idx) {
  showSheetDrawer.value = false;
  jumpTo(idx);
}

function prevQuestion() {
  if (session.value && session.value.currentIndex > 0) jumpTo(session.value.currentIndex - 1);
}

function nextQuestion() {
  clearAutoNext();
  if (!session.value) return;
  if (session.value.currentIndex < session.value.items.length - 1) {
    jumpTo(session.value.currentIndex + 1);
  } else if (!isExam.value) {
    if (!isReview.value && bank.value) persistBankSession(bank.value.id, null);
    triggerAutoSync('finish_round');
    uni.showToast({ title: '🎉 本轮刷题完成！', icon: 'success' });
    setTimeout(() => exitStudy(), 600);
  }
}

function confirmSubmitExam() {
  if (!session.value) return;
  const unanswered = session.value.items.filter(
    (it) => it.selectedKeys.length === 0 && (!it.userText || !it.userText.trim())
  ).length;

  if (unanswered > 0) {
    uni.showModal({
      title: '确认交卷',
      content: `还有 ${unanswered} 道题未作答，确认现在交卷评分吗？`,
      success: (res) => {
        if (res.confirm) gradeExamNow();
      }
    });
  } else {
    gradeExamNow();
  }
}

function submitFromDrawer() {
  showSheetDrawer.value = false;
  confirmSubmitExam();
}

function gradeExamNow() {
  stopExamClock();
  const s = session.value;
  const b = bank.value;
  if (!s || !b) return;
  const qMap = new Map(b.questions.map((q) => [q.id, q]));

  let correct = 0, wrong = 0, unanswered = 0, gradable = 0;
  const byType = {};

  for (const it of s.items) {
    const q = qMap.get(it.questionId);
    if (!q) continue;
    if (!byType[q.type]) byType[q.type] = { total: 0, correct: 0 };
    byType[q.type].total++;

    const hasAns = it.selectedKeys.length > 0 || (it.userText && it.userText.trim() !== '');
    if (!hasAns) {
      unanswered++;
      it.submitted = false;
      it.isCorrect = false;
      if (q.type !== 'short' && q.answer) gradable++;
      continue;
    }

    it.submitted = true;
    const given = isChoiceType(q.type) ? mapSelectedToOrig(it, q) : it.userText;
    const res = checkAnswer(q, given);
    const rec = getQuestionRecord(b.id, q.id);

    if (res.isCorrect === true) {
      it.isCorrect = true;
      correct++;
      gradable++;
      byType[q.type].correct++;
      rec.attempts++;
      rec.correct++;
      rec.streak++;
      if (rec.streak >= (store.settings.masteryStreakTarget || 1)) rec.mastered = true;
      rec.updatedAt = Date.now();
    } else if (res.isCorrect === false) {
      it.isCorrect = false;
      wrong++;
      gradable++;
      rec.attempts++;
      rec.wrong++;
      rec.streak = 0;
      rec.mastered = false;
      rec.inWrongBook = true;
      rec.updatedAt = Date.now();
    }
  }

  persistBankRecords(b.id);
  const score = gradable > 0 ? Math.round((correct / gradable) * 100) : 100;
  const usedSec = Math.max(1, s.examDurationSec - s.examRemainingSec);

  const typeBreakdown = Object.entries(byType).map(([type, st]) => ({
    type,
    label: TYPE_LABELS[type] || type,
    total: st.total,
    correct: st.correct,
    pct: st.total > 0 ? Math.round((st.correct / st.total) * 100) : 0
  }));

  store.examHistory.unshift({
    id: 'ex_' + Date.now(),
    bankId: b.id,
    date: Date.now(),
    score,
    total: s.items.length,
    correct,
    elapsedSec: usedSec
  });
  store.examHistory = store.examHistory.slice(0, 50);
  persistExamHistory();
  triggerAutoSync('exam_submit');

  examReport.value = {
    score,
    correct,
    wrong,
    unanswered,
    timeText: `${String(Math.floor(usedSec / 60)).padStart(2, '0')}:${String(usedSec % 60).padStart(2, '0')}`,
    verdict: score >= 90 ? '🔥 实力超群，高分稳过！' : score >= 60 ? '✅ 顺利及格，复盘错题更稳！' : '💪 继续加油，重点刷一遍错题！',
    typeBreakdown,
    allItems: s.items
  };
}

function isChoiceType(t) {
  return t === 'single' || t === 'multiple' || t === 'judge';
}

function startExamReview(onlyWrong) {
  if (!examReport.value || !session.value) return;
  const list = onlyWrong
    ? examReport.value.allItems.filter((it) => it.isCorrect === false)
    : examReport.value.allItems;
  if (list.length === 0) return;
  session.value.mode = 'exam-review';
  session.value.items = list;
  session.value.currentIndex = 0;
  examReport.value = null;
}

function exitStudy() {
  const pages = getCurrentPages();
  if (pages.length > 1) uni.navigateBack();
  else uni.switchTab({ url: '/pages/index/index' });
}

function onTouchStart(e) {
  if (!e.touches || e.touches.length !== 1) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}

function onTouchEnd(e) {
  if (!e.changedTouches || e.changedTouches.length !== 1 || examReport.value) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.6) {
    if (dx < 0) nextQuestion();
    else prevQuestion();
  }
}

function stopExamClock() {
  if (examInterval) {
    clearInterval(examInterval);
    examInterval = null;
  }
}

// #ifdef H5
function handleKeydown(e) {
  const tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || examReport.value || !session.value) return;
  const key = e.key;
  const lower = key.toLowerCase();

  if (key === 'ArrowLeft') { e.preventDefault(); prevQuestion(); return; }
  if (key === 'ArrowRight') { e.preventDefault(); nextQuestion(); return; }
  if (lower === 's') { e.preventDefault(); toggleBookmark(); return; }
  if (lower === 'k' && !isExam.value) { e.preventDefault(); toggleMastered(); return; }
  if (lower === 'r' && isRecite.value) { e.preventDefault(); toggleReciteMask(); return; }

  if (isChoiceOrJudge.value && !showSolution.value && !isRecite.value) {
    let idx = -1;
    if (/^[1-8]$/.test(key)) idx = parseInt(key, 10) - 1;
    else if (/^[a-h]$/.test(lower) && currentQuestion.value.type !== 'judge') idx = lower.charCodeAt(0) - 97;
    if (idx >= 0 && currentItem.value.displayOptions[idx]) {
      e.preventDefault();
      onSelectOption(currentItem.value.displayOptions[idx].displayKey);
      return;
    }
  }
  if (key === 'Enter' || key === ' ') {
    e.preventDefault();
    if (isRecite.value && session.value.reciteMasked && !currentItem.value.revealed) {
      revealReciteCurrent();
    } else if (currentQuestion.value.type === 'multiple' && !showSolution.value && !isExam.value) {
      submitMultipleChoice();
    } else {
      nextQuestion();
    }
  }
}
// #endif

onMounted(() => {
  if (!session.value) {
    exitStudy();
    return;
  }
  if (isExam.value) {
    examInterval = setInterval(() => {
      if (!session.value || session.value.mode !== 'exam') return;
      session.value.examRemainingSec = Math.max(0, session.value.examRemainingSec - 1);
      if (session.value.examRemainingSec <= 0) {
        uni.showToast({ title: '时间到，自动交卷', icon: 'none' });
        gradeExamNow();
      }
    }, 1000);
  }
  // #ifdef H5
  window.addEventListener('keydown', handleKeydown);
  // #endif
});

onUnmounted(() => {
  clearAutoNext();
  stopExamClock();
  // #ifdef H5
  window.removeEventListener('keydown', handleKeydown);
  // #endif
});
</script>

<style scoped>
.font-sm .q-stem { font-size: 28rpx; }
.font-md .q-stem { font-size: 32rpx; }
.font-lg .q-stem { font-size: 38rpx; }

.study-topbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14rpx;
}
.q-counter {
  font-size: 28rpx;
  font-weight: 800;
}
.timer-pill {
  padding: 4rpx 16rpx;
  border-radius: 999px;
  background-color: var(--amber-soft);
  color: var(--amber);
  font-size: 24rpx;
  font-weight: 700;
}
.timer-pill.urgent {
  background-color: var(--red-soft);
  color: var(--red);
}

.chip-action {
  padding: 8rpx 18rpx;
  border-radius: 999px;
  background-color: var(--surface);
  border: 1px solid var(--border-strong);
  font-size: 23rpx;
  font-weight: 600;
  color: var(--text-sec);
}
.active-amber {
  background-color: var(--amber-soft);
  border-color: var(--amber-border);
  color: var(--amber);
}
.active-purple {
  background-color: var(--purple-soft);
  border-color: var(--purple-border);
  color: var(--purple);
}

.thin-prog {
  height: 8rpx;
  border-radius: 999px;
  background-color: var(--border);
  overflow: hidden;
  margin-bottom: 22rpx;
}
.thin-fill {
  height: 100%;
  background-color: var(--primary);
}

.study-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 28rpx;
}
.desktop-sheet {
  display: none;
}
@media (min-width: 880px) {
  .study-grid {
    grid-template-columns: minmax(0, 1fr) 280px;
    align-items: start;
  }
  .desktop-sheet {
    display: block;
    position: sticky;
    top: 24px;
  }
}

.q-meta-row {
  padding-bottom: 20rpx;
  margin-bottom: 24rpx;
  border-bottom: 1px solid var(--border);
}
.q-type-tag {
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
  background-color: var(--primary-soft);
  color: var(--primary);
  font-size: 22rpx;
  font-weight: 700;
}
.q-stem {
  font-size: 32rpx;
  font-weight: 600;
  line-height: 1.75;
  margin-bottom: 28rpx;
  white-space: pre-wrap;
}

.opts-wrap {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.opt-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 18rpx;
  padding: 22rpx 24rpx;
  border-radius: 18rpx;
  border: 1.5px solid var(--border);
  background-color: var(--surface);
}
.opt-key {
  width: 48rpx;
  height: 48rpx;
  border-radius: 12rpx;
  border: 1px solid var(--border-strong);
  background-color: var(--surface-alt);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 26rpx;
  flex-shrink: 0;
}
.opt-txt {
  flex: 1;
  font-size: 29rpx;
  line-height: 1.55;
}
.opt-selected {
  border-color: var(--primary);
  background-color: var(--primary-soft);
}
.opt-selected .opt-key {
  background-color: var(--primary);
  border-color: var(--primary);
  color: #ffffff;
}
.opt-correct {
  border-color: var(--green);
  background-color: var(--green-soft);
}
.opt-correct .opt-key {
  background-color: var(--green);
  border-color: var(--green);
  color: #ffffff;
}
.opt-wrong {
  border-color: var(--red);
  background-color: var(--red-soft);
}
.opt-wrong .opt-key {
  background-color: var(--red);
  border-color: var(--red);
  color: #ffffff;
}
.opt-missed {
  border-color: var(--green);
  border-style: dashed;
  background-color: var(--green-soft);
}

.mask-reveal-card {
  margin-top: 24rpx;
  padding: 30rpx;
  border-radius: 18rpx;
  border: 1.5px dashed var(--amber-border);
  background-color: var(--amber-soft);
  color: var(--amber);
  text-align: center;
  font-weight: 600;
}

.feedback-wrap {
  margin-top: 32rpx;
  padding-top: 26rpx;
  border-top: 1px solid var(--border);
}
.fb-banner {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 16rpx 22rpx;
  border-radius: 14rpx;
  font-weight: 700;
  font-size: 27rpx;
  margin-bottom: 18rpx;
}
.fb-right { background-color: var(--green-soft); color: var(--green); }
.fb-wrong { background-color: var(--red-soft); color: var(--red); }
.fb-info { background-color: var(--primary-soft); color: var(--primary); }
.override-link {
  text-decoration: underline;
  font-size: 24rpx;
}

.ans-line {
  padding: 16rpx 22rpx;
  border-radius: 14rpx;
  background-color: var(--surface-alt);
  margin-bottom: 18rpx;
}
.ans-lbl { font-weight: 600; }
.ans-val { color: var(--green); font-weight: 800; }

.ana-card {
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background-color: var(--surface-alt);
  border-left: 6rpx solid var(--primary);
  margin-bottom: 20rpx;
}
.ana-head {
  font-size: 25rpx;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 8rpx;
}
.ana-body {
  font-size: 27rpx;
  color: var(--text-sec);
  white-space: pre-wrap;
}

.note-lbl {
  font-size: 24rpx;
  color: var(--text-muted);
  margin-bottom: 8rpx;
}
.note-input {
  width: 100%;
  min-height: 110rpx;
  padding: 14rpx 18rpx;
  border-radius: 12rpx;
  border: 1px solid var(--border);
  background-color: var(--surface-alt);
  color: var(--text);
  font-size: 26rpx;
}

.nav-footer {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  gap: 16rpx;
  margin-top: 8rpx;
}

.sheet-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12rpx;
}
.sheet-cell {
  height: 68rpx;
  border-radius: 12rpx;
  border: 1px solid var(--border-strong);
  background-color: var(--surface-alt);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 25rpx;
  font-weight: 600;
  position: relative;
}
.sc-current { border: 2px solid var(--primary); color: var(--primary); font-weight: 800; }
.sc-right { background-color: var(--green-soft); border-color: var(--green-border); color: var(--green); }
.sc-wrong { background-color: var(--red-soft); border-color: var(--red-border); color: var(--red); }
.sc-answered { background-color: var(--primary-soft); border-color: var(--primary-border); color: var(--primary); }
.sc-star::after {
  content: '';
  position: absolute;
  right: 6rpx;
  top: 6rpx;
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background-color: var(--amber);
}

.modal-mask {
  position: fixed;
  left: 0; right: 0; top: 0; bottom: 0;
  background-color: rgba(15, 23, 42, 0.55);
  z-index: 99;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.sheet-drawer {
  background-color: var(--surface);
  border-radius: 28rpx 28rpx 0 0;
  padding: 32rpx;
}
.modal-title { font-size: 32rpx; font-weight: 700; }
.dismiss-btn { font-size: 32rpx; color: var(--text-muted); padding: 8rpx; }

.report-card { text-align: center; padding: 48rpx 32rpx; }
.score-badge {
  width: 200rpx; height: 200rpx; border-radius: 50%;
  margin: 0 auto 24rpx;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: #ffffff;
}
.score-badge.pass { background: linear-gradient(135deg, #16a34a, #059669); }
.score-badge.fail { background: linear-gradient(135deg, #dc2626, #ea580c); }
.score-big { font-size: 64rpx; font-weight: 800; line-height: 1; }
.score-sub { font-size: 24rpx; }
.report-title { font-size: 32rpx; font-weight: 700; margin-bottom: 28rpx; }
.report-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 14rpx; margin-bottom: 32rpx;
}
.r-stat { background-color: var(--surface-alt); border-radius: 14rpx; padding: 16rpx 8rpx; }
.r-num { display: block; font-size: 32rpx; font-weight: 800; }
.r-lbl { font-size: 22rpx; color: var(--text-muted); }
.type-breakdown { text-align: left; margin-bottom: 32rpx; }
.tb-row { display: flex; flex-direction: row; align-items: center; gap: 16rpx; margin-bottom: 14rpx; font-size: 25rpx; }
.tb-name { width: 110rpx; font-weight: 600; }
.tb-bar { flex: 1; height: 14rpx; border-radius: 999px; background-color: var(--surface-hover); overflow: hidden; }
.tb-fill { height: 100%; background-color: var(--primary); }
.tb-val { width: 160rpx; text-align: right; }
.report-btns { display: flex; flex-direction: column; gap: 18rpx; }
</style>
