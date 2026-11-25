<template>
  <view class="page-root" :class="{ 'theme-dark': store.settings.theme === 'dark' }">
    <view class="container">
      <!-- File Upload Card -->
      <view class="card">
        <view class="row-between" style="margin-bottom: 18rpx">
          <text class="sec-title">📁 方式一：上传题库文件</text>
          <text class="pill pill-blue" @click="loadDemo">✨ 载入示例题库</text>
        </view>

        <view class="upload-box" @click="pickFile">
          <view class="up-icon">📂</view>
          <!-- #ifdef MP-WEIXIN -->
          <view class="up-title">点击从「微信聊天 / 文件传输助手」选择文件</view>
          <view class="up-sub">先把题库发给“文件传输助手”，再点此选择即可离线解析</view>
          <!-- #endif -->
          <!-- #ifndef MP-WEIXIN -->
          <view class="up-title">点击选择本地题库文件</view>
          <view class="up-sub">支持 .xlsx (Excel)、.csv、.docx (Word)、.txt / .md、.json</view>
          <!-- #endif -->
        </view>

        <view class="tpl-bar">
          <text class="text-muted" style="font-size: 23rpx">模板参考：</text>
          <view class="tpl-chip" @click="fillSamplePaste">填入标准文本示例</view>
          <view class="tpl-chip" @click="copyCsvTemplate">复制 CSV 表头模板</view>
        </view>
      </view>

      <!-- Smart Text / CSV Paste Card -->
      <view class="card">
        <view class="row-between" style="margin-bottom: 16rpx">
          <text class="sec-title">📋 方式二：智能粘贴（PDF / Word / CSV 全兼容）</text>
          <text v-if="pasteText" class="text-muted" style="font-size:24rpx" @click="pasteText = ''">清空</text>
        </view>
        <textarea
          class="textarea-box paste-area"
          maxlength="-1"
          v-model="pasteText"
          placeholder="直接粘贴题目内容或 CSV 表格数据！支持：&#10;1. 我国根本大法是（A）。&#10;A.宪法 B.民法典 C.刑法 D.行政法&#10;&#10;也支持多选、判断、填空、文末「参考答案汇总」及无表头 CSV！"
        />
        <button class="btn btn-primary btn-block" style="margin-top: 20rpx" @click="parsePastedContent">
          🔍 智能识别题目
        </button>
      </view>

      <!-- Import Preview & Column Mapper -->
      <view v-if="draft" class="card preview-card">
        <view class="sec-title" style="margin-bottom: 14rpx">✅ 识别结果预览</view>

        <view class="row-wrap" style="margin-bottom: 18rpx">
          <text class="pill pill-blue">共 {{ draft.stats.total }} 题</text>
          <text v-if="draft.stats.counts.single" class="pill pill-green">单选 {{ draft.stats.counts.single }}</text>
          <text v-if="draft.stats.counts.multiple" class="pill pill-green">多选 {{ draft.stats.counts.multiple }}</text>
          <text v-if="draft.stats.counts.judge" class="pill pill-green">判断 {{ draft.stats.counts.judge }}</text>
          <text v-if="draft.stats.counts.fill" class="pill pill-green">填空 {{ draft.stats.counts.fill }}</text>
          <text v-if="draft.stats.counts.short" class="pill pill-green">简答 {{ draft.stats.counts.short }}</text>
          <text v-if="draft.stats.missingAnswer" class="pill pill-amber">缺答案 {{ draft.stats.missingAnswer }}</text>
        </view>

        <view v-if="draft.warnings && draft.warnings.length" class="warn-box">
          <view v-for="(w, wi) in draft.warnings" :key="wi">⚠️ {{ w }}</view>
        </view>

        <view style="margin-bottom: 20rpx">
          <view class="form-lbl">题库名称</view>
          <input class="input-box" v-model="draftName" placeholder="输入题库名称..." />
        </view>

        <!-- Table Mapping Adjuster -->
        <view v-if="draft.kind === 'table'" class="map-box">
          <view class="row-between" style="margin-bottom: 14rpx">
            <text style="font-size:25rpx;font-weight:700">🛠️ 表格列映射（自动识别，点击可微调）</text>
            <view class="sw-inline" @click="toggleHasHeader">
              <switch :checked="hasHeader" color="#2563EB" style="transform:scale(0.7)" />
              <text style="font-size:23rpx">含表头</text>
            </view>
          </view>

          <view v-if="draft.sheets && draft.sheets.length > 1" style="margin-bottom: 14rpx">
            <picker mode="selector" :range="sheetNames" :value="draft.activeSheetIndex" @change="onSheetChange">
              <view class="map-pill">当前工作表：{{ sheetNames[draft.activeSheetIndex] }} ▾</view>
            </picker>
          </view>

          <view class="map-grid">
            <view v-for="mf in mapFields" :key="mf.key" class="map-item">
              <text class="map-lbl">{{ mf.label }}</text>
              <picker
                mode="selector"
                :range="columnChoices"
                :value="getMapPickerIndex(mf.key)"
                @change="(e) => onMapFieldChange(mf.key, e)"
              >
                <view class="map-select">{{ columnChoices[getMapPickerIndex(mf.key)] }} ▾</view>
              </picker>
            </view>
          </view>
        </view>

        <!-- Preview First 6 Questions -->
        <view class="preview-list">
          <view v-for="(q, idx) in previewQuestions" :key="idx" class="prev-item">
            <view class="row-wrap" style="margin-bottom: 6rpx">
              <text class="pill pill-blue">#{{ idx + 1 }} {{ typeLabels[q.type] || q.type }}</text>
              <text v-if="q.category" class="pill pill-gray">{{ q.category }}</text>
            </view>
            <view class="prev-stem">{{ q.stem }}</view>
            <view v-if="q.options && q.options.length" class="prev-opts">
              <text v-for="o in q.options" :key="o.key" style="margin-right: 18rpx">{{ o.key }}. {{ o.text }}</text>
            </view>
            <view class="prev-ans" :class="{ 'text-amber': !q.answer }">
              {{ q.answer ? '✓ 答案：' + q.answer : '⚠️ 未检测到答案' }}
            </view>
          </view>
        </view>

        <view class="import-btns">
          <button
            v-if="store.banks.length > 0 && draft.questions.length > 0"
            class="btn btn-secondary btn-block"
            @click="confirmCommit(true)"
          >
            ➕ 追加到当前题库
          </button>
          <button
            class="btn btn-primary btn-block"
            :disabled="draft.questions.length === 0"
            @click="confirmCommit(false)"
          >
            🚀 确认导入为新题库（并自动云同步）
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue';
import {
  store,
  addOrImportBank,
  createDemoBankQuestions
} from '../../utils/store.js';
import { syncNow } from '../../utils/cloud.js';
import {
  TYPE_LABELS,
  parseText,
  looksLikeCsvText,
  parseCsvRows,
  autoDetectTableMapping,
  parseTableWithMapping,
  parseArrayBufferByFilename
} from '../../utils/parser.js';

const typeLabels = TYPE_LABELS;
const pasteText = ref('');
const draft = ref(null);
const draftName = ref('');
const hasHeader = ref(true);

const mapFields = [
  { key: 'stem', label: '题干列' },
  { key: 'answer', label: '答案列' },
  { key: 'type', label: '题型列' },
  { key: 'opt_A', label: '选项 A' },
  { key: 'opt_B', label: '选项 B' },
  { key: 'opt_C', label: '选项 C' },
  { key: 'opt_D', label: '选项 D' },
  { key: 'analysis', label: '解析列' },
  { key: 'category', label: '章节列' }
];

const SAMPLE_TEXT = `一、单选题
1. 我国的根本大法是（ A ）。
A. 宪法  B. 民法典  C. 刑法  D. 行政法
解析：宪法具有最高的法律效力。

二、多选题
2. 以下属于前端核心技术的有（）
A. HTML
B. CSS
C. JavaScript
D. MySQL
答案：ABC
解析：MySQL 是关系型数据库。

三、判断题
3. 队列是一种先进先出（FIFO）结构。（对）`;

const sheetNames = computed(() =>
  draft.value && draft.value.sheets ? draft.value.sheets.map((s) => `${s.name} (${s.rows.length}行)`) : []
);

const columnChoices = computed(() => {
  if (!draft.value || !draft.value.headers) return ['— 不映射 —'];
  return ['— 不映射 —', ...draft.value.headers.map((h, i) => `第${i + 1}列: ${String(h).slice(0, 10)}`)];
});

const previewQuestions = computed(() => (draft.value ? draft.value.questions.slice(0, 6) : []));

function setDraftResult(parsed) {
  draft.value = parsed;
  draftName.value = parsed.bankName || '我的题库';
  hasHeader.value = parsed.headerRowIndex >= 0;
}

function pickFile() {
  // #ifdef MP-WEIXIN
  wx.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: ['xlsx', 'csv', 'tsv', 'docx', 'txt', 'md', 'json'],
    success: (res) => {
      const file = res.tempFiles && res.tempFiles[0];
      if (!file) return;
      const fs = wx.getFileSystemManager();
      fs.readFile({
        filePath: file.path,
        success: async (readRes) => {
          try {
            uni.showLoading({ title: '解析中...' });
            const parsed = await parseArrayBufferByFilename(file.name, readRes.data);
            setDraftResult(parsed);
          } catch (err) {
            uni.showToast({ title: err.message || '解析失败', icon: 'none', duration: 2800 });
          } finally {
            uni.hideLoading();
          }
        },
        fail: () => uni.showToast({ title: '读取文件失败', icon: 'none' })
      });
    }
  });
  // #endif

  // #ifdef H5
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.csv,.tsv,.docx,.txt,.md,.json';
  input.onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      uni.showLoading({ title: '解析中...' });
      const buf = await file.arrayBuffer();
      const parsed = await parseArrayBufferByFilename(file.name, buf);
      setDraftResult(parsed);
    } catch (err) {
      uni.showToast({ title: err.message || '解析失败', icon: 'none', duration: 2800 });
    } finally {
      uni.hideLoading();
    }
  };
  input.click();
  // #endif

  // #ifdef APP-PLUS
  uni.showModal({
    title: 'App 导入提示',
    content: '在手机 App 端可直接复制题目/CSV 粘贴到下方文本框秒速识别，或在电脑/网页/小程序导入后登录账号一键云同步到手机 App！',
    showCancel: false
  });
  // #endif
}

function parsePastedContent() {
  const raw = pasteText.value.trim();
  if (!raw) {
    uni.showToast({ title: '请先粘贴题库内容', icon: 'none' });
    return;
  }
  const defaultTitle = '粘贴题库 ' + new Date().toLocaleDateString('zh-CN');
  if (looksLikeCsvText(raw)) {
    const rows = parseCsvRows(raw);
    const detected = autoDetectTableMapping(rows);
    const res = parseTableWithMapping(rows, detected.mapping, detected.headerRowIndex);
    setDraftResult({
      kind: 'table',
      bankName: defaultTitle,
      sheets: [{ name: '粘贴表格', rows }],
      activeSheetIndex: 0,
      ...detected,
      ...res
    });
    uni.showToast({ title: `识别表格 ${res.questions.length} 题`, icon: 'success' });
  } else {
    const res = parseText(raw);
    setDraftResult({ kind: 'direct', bankName: defaultTitle, ...res });
    uni.showToast({ title: `识别 ${res.questions.length} 题`, icon: 'success' });
  }
}

function getMapPickerIndex(fieldKey) {
  if (!draft.value || !draft.value.mapping) return 0;
  const m = draft.value.mapping;
  const col = fieldKey.startsWith('opt_')
    ? m.options
      ? m.options[fieldKey.slice(4)]
      : -1
    : m[fieldKey];
  return col !== undefined && col >= 0 ? col + 1 : 0;
}

function reparseDraftTable() {
  if (!draft.value || draft.value.kind !== 'table') return;
  const sheet = draft.value.sheets[draft.value.activeSheetIndex];
  const hIdx = hasHeader.value ? Math.max(0, draft.value.headerRowIndex) : -1;
  const res = parseTableWithMapping(sheet.rows, draft.value.mapping, hIdx);
  draft.value.questions = res.questions;
  draft.value.stats = res.stats;
  draft.value.warnings = res.warnings;
}

function onMapFieldChange(fieldKey, e) {
  const val = (Number(e.detail.value) || 0) - 1;
  if (fieldKey.startsWith('opt_')) {
    if (!draft.value.mapping.options) draft.value.mapping.options = {};
    const letter = fieldKey.slice(4);
    if (val >= 0) draft.value.mapping.options[letter] = val;
    else delete draft.value.mapping.options[letter];
  } else {
    draft.value.mapping[fieldKey] = val;
  }
  reparseDraftTable();
}

function toggleHasHeader() {
  hasHeader.value = !hasHeader.value;
  reparseDraftTable();
}

function onSheetChange(e) {
  const idx = Number(e.detail.value) || 0;
  draft.value.activeSheetIndex = idx;
  const rows = draft.value.sheets[idx].rows;
  const detected = autoDetectTableMapping(rows);
  draft.value.headers = detected.headers;
  draft.value.mapping = detected.mapping;
  draft.value.headerRowIndex = detected.headerRowIndex;
  hasHeader.value = detected.headerRowIndex >= 0;
  reparseDraftTable();
}

async function confirmCommit(append) {
  if (!draft.value || draft.value.questions.length === 0) return;
  const bank = addOrImportBank(draftName.value.trim() || '我的题库', draft.value.questions, append);
  draft.value = null;
  pasteText.value = '';
  uni.showToast({ title: `成功导入 ${bank.questions.length} 题`, icon: 'success' });
  if (store.auth.token) {
    syncNow(true);
  }
  setTimeout(() => {
    uni.switchTab({ url: '/pages/index/index' });
  }, 400);
}

function fillSamplePaste() {
  pasteText.value = SAMPLE_TEXT;
}

function copyCsvTemplate() {
  const tpl = '题型,题目,选项A,选项B,选项C,选项D,答案,解析,章节\n单选题,HTTP默认端口是？,21,22,80,443,C,HTTP默认80端口,计算机网络';
  uni.setClipboardData({
    data: tpl,
    success: () => uni.showToast({ title: '已复制 CSV 模板', icon: 'success' })
  });
}

function loadDemo() {
  addOrImportBank('示例题库 · 计算机基础突击', createDemoBankQuestions(), false);
  if (store.auth.token) syncNow(true);
  uni.switchTab({ url: '/pages/index/index' });
}
</script>

<style scoped>
.sec-title { font-size: 30rpx; font-weight: 700; }

.upload-box {
  border: 2px dashed var(--border-strong);
  border-radius: 20rpx;
  background-color: var(--surface-alt);
  padding: 52rpx 28rpx;
  text-align: center;
}
.up-icon { font-size: 64rpx; margin-bottom: 12rpx; }
.up-title { font-size: 29rpx; font-weight: 700; margin-bottom: 8rpx; }
.up-sub { font-size: 24rpx; color: var(--text-muted); }

.tpl-bar {
  display: flex; flex-direction: row; align-items: center; flex-wrap: wrap;
  gap: 14rpx; margin-top: 22rpx; padding-top: 18rpx; border-top: 1px solid var(--border);
}
.tpl-chip {
  padding: 6rpx 18rpx; border-radius: 999px;
  background-color: var(--surface-alt); border: 1px solid var(--border-strong);
  font-size: 23rpx; color: var(--text-sec);
}

.paste-area { min-height: 280rpx; }
.preview-card { border-color: var(--primary-border); }
.warn-box {
  background-color: var(--amber-soft); color: var(--amber);
  padding: 14rpx 20rpx; border-radius: 12rpx; font-size: 24rpx; margin-bottom: 18rpx;
}
.form-lbl { font-size: 24rpx; color: var(--text-muted); margin-bottom: 8rpx; }

.map-box {
  background-color: var(--surface-alt); border: 1px solid var(--border);
  border-radius: 16rpx; padding: 20rpx; margin-bottom: 22rpx;
}
.sw-inline { display: flex; flex-direction: row; align-items: center; }
.map-pill {
  padding: 10rpx 18rpx; border-radius: 10rpx; background-color: var(--surface);
  border: 1px solid var(--border-strong); font-size: 24rpx;
}
.map-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 14rpx;
}
.map-lbl { display: block; font-size: 22rpx; color: var(--text-muted); margin-bottom: 4rpx; }
.map-select {
  padding: 10rpx 14rpx; border-radius: 10rpx; background-color: var(--surface);
  border: 1px solid var(--border-strong); font-size: 23rpx; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}

.preview-list { display: flex; flex-direction: column; gap: 14rpx; margin-bottom: 24rpx; }
.prev-item {
  padding: 18rpx 20rpx; border-radius: 14rpx;
  background-color: var(--surface-alt); border: 1px solid var(--border);
}
.prev-stem { font-weight: 600; font-size: 27rpx; margin-bottom: 8rpx; }
.prev-opts { font-size: 24rpx; color: var(--text-sec); margin-bottom: 6rpx; }
.prev-ans { font-size: 24rpx; color: var(--green); font-weight: 700; }
.import-btns { display: flex; flex-direction: column; gap: 16rpx; }
</style>
