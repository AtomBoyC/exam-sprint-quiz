<template>
  <view class="page-root" :class="{ 'theme-dark': store.settings.theme === 'dark' }">
    <view class="container">
      <view v-if="!activeBank" class="card" style="text-align: center; padding: 60rpx 30rpx">
        <view class="text-muted" style="margin-bottom: 24rpx">当前还没有题库</view>
        <button class="btn btn-primary" @click="goImport">前往导入题库</button>
      </view>

      <view v-else>
        <!-- Bank Selector & Batch Actions -->
        <view class="card">
          <view class="row-wrap" style="margin-bottom: 20rpx">
            <view
              v-for="b in store.banks"
              :key="b.id"
              class="bank-tab"
              :class="{ active: b.id === activeBank.id }"
              @click="selectBank(b.id)"
            >
              {{ b.name }} ({{ b.questions.length }})
            </view>
          </view>

          <view class="row-wrap">
            <view class="op-chip" @click="openEditModal(null)">➕ 新增题目</view>
            <view class="op-chip" @click="renameCurrentBank">✏️ 重命名</view>
            <view class="op-chip" @click="exportWrongSheet">📋 导出错题速记</view>
            <view class="op-chip" @click="exportBankBackup">💾 导出 JSON</view>
            <view class="op-chip text-amber" @click="resetBankRecords">🔄 清空进度</view>
            <view class="op-chip text-red" @click="deleteCurrentBank">🗑️ 删除题库</view>
          </view>
        </view>

        <!-- Search & Filter -->
        <view class="card">
          <input
            class="input-box"
            placeholder="🔍 搜索题干、选项、解析或助记笔记..."
            v-model="keyword"
            style="margin-bottom: 16rpx"
          />
          <view class="row-between">
            <view class="row-wrap">
              <picker mode="selector" :range="statusLabels" :value="statusIdx" @change="onStatusChange">
                <view class="op-chip">状态：{{ statusLabels[statusIdx] }} ▾</view>
              </picker>
            </view>
            <text class="text-muted" style="font-size: 24rpx">共 {{ filteredList.length }} 题</text>
          </view>
        </view>

        <!-- Question Cards -->
        <view v-for="q in visibleList" :key="q.id" class="card q-item">
          <view class="row-between" style="margin-bottom: 10rpx">
            <view class="row-wrap">
              <text class="pill pill-blue">#{{ q.index }} {{ typeLabels[q.type] || q.type }}</text>
              <text v-if="q.rec.inWrongBook" class="pill pill-red">错 {{ q.rec.wrong }}</text>
              <text v-if="q.rec.mastered" class="pill pill-purple">已斩</text>
              <text v-if="q.rec.bookmarked" class="pill pill-amber">★</text>
            </view>
            <view class="row-wrap">
              <text class="act-link" @click="openEditModal(q)">编辑</text>
              <text class="act-link text-red" @click="deleteOneQuestion(q.id)">删除</text>
            </view>
          </view>
          <view class="q-stem-txt">{{ q.stem }}</view>
          <view v-if="q.options && q.options.length" class="q-opts-txt">
            <text v-for="o in q.options" :key="o.key" style="margin-right: 18rpx">{{ o.key }}. {{ o.text }}</text>
          </view>
          <view class="q-ans-txt">
            答案：<text class="text-green">{{ q.answer || '未填' }}</text>
          </view>
        </view>

        <button
          v-if="filteredList.length > renderLimit"
          class="btn btn-secondary btn-block"
          @click="renderLimit += 50"
        >
          加载更多（剩余 {{ filteredList.length - renderLimit }} 题）
        </button>
      </view>
    </view>

    <!-- Edit / Add Question Modal -->
    <view v-if="showEditModal" class="modal-mask" @click.self="showEditModal = false">
      <view class="modal-panel">
        <view class="row-between" style="margin-bottom: 20rpx">
          <text style="font-size: 32rpx; font-weight: 700">{{ editForm.id ? '✏️ 编辑题目' : '➕ 新增题目' }}</text>
          <text @click="showEditModal = false">✕</text>
        </view>
        <scroll-view scroll-y style="max-height: 68vh">
          <view class="f-grp">
            <view class="f-lbl">题型</view>
            <picker mode="selector" :range="editTypeLabels" :value="editForm.typeIdx" @change="onEditTypeChange">
              <view class="op-chip">{{ editTypeLabels[editForm.typeIdx] }} ▾</view>
            </picker>
          </view>
          <view class="f-grp">
            <view class="f-lbl">题干</view>
            <textarea class="textarea-box" v-model="editForm.stem" />
          </view>
          <view v-if="editForm.typeIdx <= 1" class="f-grp">
            <view class="f-lbl">选项（每行一个，如 A. 内容）</view>
            <textarea class="textarea-box" v-model="editForm.optionsText" placeholder="A. 选项一&#10;B. 选项二&#10;C. 选项三&#10;D. 选项四" />
          </view>
          <view class="f-grp">
            <view class="f-lbl">标准答案（单选A / 多选ABC / 判断填 对或错）</view>
            <input class="input-box" v-model="editForm.answer" />
          </view>
          <view class="f-grp">
            <view class="f-lbl">解析（可选）</view>
            <textarea class="textarea-box" style="min-height:140rpx" v-model="editForm.analysis" />
          </view>
          <view class="f-grp">
            <view class="f-lbl">章节（可选）</view>
            <input class="input-box" v-model="editForm.category" />
          </view>
        </scroll-view>
        <view class="row-between" style="margin-top: 22rpx">
          <button class="btn btn-secondary" style="flex:1;margin-right:14rpx" @click="showEditModal = false">取消</button>
          <button class="btn btn-primary" style="flex:1.3" @click="saveQuestionEdit">💾 保存</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import {
  store,
  getActiveBank,
  getBankRecords,
  setActiveBank,
  persistBank,
  persistBankRecords,
  persistBankSession,
  removeBank
} from '../../utils/store.js';
import { triggerAutoSync } from '../../utils/cloud.js';
import { TYPE_LABELS, OPTION_LETTERS, finalizeQuestion } from '../../utils/parser.js';

const typeLabels = TYPE_LABELS;
const keyword = ref('');
const statusIdx = ref(0);
const renderLimit = ref(40);

const STATUS_OPTS = [
  { key: 'all', label: '全部' },
  { key: 'wrong', label: '错题本' },
  { key: 'unmastered', label: '待斩杀' },
  { key: 'mastered', label: '已斩杀' },
  { key: 'bookmarked', label: '已收藏' },
  { key: 'noanswer', label: '缺答案' }
];
const statusLabels = STATUS_OPTS.map((s) => s.label);

const EDIT_TYPES = ['single', 'multiple', 'judge', 'fill', 'short'];
const editTypeLabels = EDIT_TYPES.map((k) => TYPE_LABELS[k]);

const showEditModal = ref(false);
const editForm = reactive({
  id: '',
  typeIdx: 0,
  stem: '',
  optionsText: '',
  answer: '',
  analysis: '',
  category: ''
});

const activeBank = computed(() => getActiveBank());

const filteredList = computed(() => {
  const b = activeBank.value;
  if (!b) return [];
  const recs = getBankRecords(b.id);
  const stKey = STATUS_OPTS[statusIdx.value].key;
  const kw = keyword.value.trim().toLowerCase();

  return b.questions
    .map((q) => ({ ...q, rec: recs[q.id] || {} }))
    .filter((q) => {
      if (stKey === 'wrong' && !q.rec.inWrongBook) return false;
      if (stKey === 'mastered' && !q.rec.mastered) return false;
      if (stKey === 'unmastered' && q.rec.mastered) return false;
      if (stKey === 'bookmarked' && !q.rec.bookmarked) return false;
      if (stKey === 'noanswer' && q.answer) return false;
      if (kw) {
        const text = [q.stem, q.answer, q.analysis, q.category, ...(q.options || []).map((o) => o.text), q.rec.note || '']
          .join(' ')
          .toLowerCase();
        if (!text.includes(kw)) return false;
      }
      return true;
    });
});

const visibleList = computed(() => filteredList.value.slice(0, renderLimit.value));

function selectBank(id) {
  setActiveBank(id);
  renderLimit.value = 40;
}

function onStatusChange(e) {
  statusIdx.value = Number(e.detail.value) || 0;
  renderLimit.value = 40;
}

function renameCurrentBank() {
  const b = activeBank.value;
  if (!b) return;
  uni.showModal({
    title: '重命名题库',
    editable: true,
    placeholderText: b.name,
    success: (res) => {
      if (res.confirm && res.content && res.content.trim()) {
        b.name = res.content.trim();
        b.updatedAt = Date.now();
        persistBank(b);
        triggerAutoSync('rename_bank');
      }
    }
  });
}

function resetBankRecords() {
  const b = activeBank.value;
  if (!b) return;
  uni.showModal({
    title: '清空进度',
    content: `确定清空「${b.name}」的刷题记录与错题本吗？（题目本身保留）`,
    success: (res) => {
      if (res.confirm) {
        store.recordsByBank[b.id] = {};
        persistBankRecords(b.id);
        persistBankSession(b.id, null);
        uni.showToast({ title: '进度已重置', icon: 'success' });
      }
    }
  });
}

function deleteCurrentBank() {
  const b = activeBank.value;
  if (!b) return;
  uni.showModal({
    title: '删除题库',
    content: `确定删除题库「${b.name}」吗？登录状态下云端也会同步删除。`,
    confirmColor: '#DC2626',
    success: (res) => {
      if (res.confirm) {
        removeBank(b.id);
        triggerAutoSync('delete_bank');
        uni.showToast({ title: '已删除', icon: 'none' });
      }
    }
  });
}

function openEditModal(q) {
  if (q) {
    editForm.id = q.id;
    editForm.typeIdx = Math.max(0, EDIT_TYPES.indexOf(q.type));
    editForm.stem = q.stem;
    editForm.optionsText = (q.options || []).map((o) => `${o.key}. ${o.text}`).join('\n');
    editForm.answer = q.answer || '';
    editForm.analysis = q.analysis || '';
    editForm.category = q.category || '';
  } else {
    editForm.id = '';
    editForm.typeIdx = 0;
    editForm.stem = '';
    editForm.optionsText = 'A. \nB. \nC. \nD. ';
    editForm.answer = '';
    editForm.analysis = '';
    editForm.category = '';
  }
  showEditModal.value = true;
}

function onEditTypeChange(e) {
  editForm.typeIdx = Number(e.detail.value) || 0;
}

function saveQuestionEdit() {
  const b = activeBank.value;
  if (!b || !editForm.stem.trim()) {
    uni.showToast({ title: '题干不能为空', icon: 'none' });
    return;
  }
  const type = EDIT_TYPES[editForm.typeIdx];
  let options = [];
  if (type === 'single' || type === 'multiple') {
    options = editForm.optionsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line, i) => ({
        key: OPTION_LETTERS[i] || String(i + 1),
        text: line
      }));
  }

  if (editForm.id) {
    const idx = b.questions.findIndex((item) => item.id === editForm.id);
    if (idx >= 0) {
      const fin = finalizeQuestion(
        { id: editForm.id, type, stem: editForm.stem, options, answer: editForm.answer, analysis: editForm.analysis, category: editForm.category },
        idx
      );
      fin.id = editForm.id;
      b.questions[idx] = fin;
    }
  } else {
    const fin = finalizeQuestion(
      { type, stem: editForm.stem, options, answer: editForm.answer, analysis: editForm.analysis, category: editForm.category },
      b.questions.length
    );
    b.questions.push(fin);
  }
  b.updatedAt = Date.now();
  persistBank(b);
  triggerAutoSync('edit_q');
  showEditModal.value = false;
  uni.showToast({ title: '已保存', icon: 'success' });
}

function deleteOneQuestion(qId) {
  const b = activeBank.value;
  if (!b) return;
  uni.showModal({
    title: '删除题目',
    content: '确定删除这道题吗？',
    success: (res) => {
      if (res.confirm) {
        b.questions = b.questions.filter((q) => q.id !== qId).map((q, i) => ({ ...q, index: i + 1 }));
        b.updatedAt = Date.now();
        persistBank(b);
        triggerAutoSync('del_q');
      }
    }
  });
}

function exportOrCopyFile(filename, content, mime) {
  // #ifdef H5
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
  uni.showToast({ title: '文件已导出下载', icon: 'success' });
  // #endif
  // #ifndef H5
  uni.setClipboardData({
    data: content,
    success: () => uni.showToast({ title: '已复制到剪贴板，可粘贴保存', icon: 'success' })
  });
  // #endif
}

function exportBankBackup() {
  const b = activeBank.value;
  if (!b) return;
  exportOrCopyFile(`${b.name}_备份.json`, JSON.stringify(b, null, 2), 'application/json;charset=utf-8');
}

function exportWrongSheet() {
  const b = activeBank.value;
  if (!b) return;
  const recs = getBankRecords(b.id);
  const wrongs = b.questions
    .filter((q) => recs[q.id] && recs[q.id].inWrongBook)
    .sort((x, y) => (recs[y.id].wrong || 0) - (recs[x.id].wrong || 0));

  if (wrongs.length === 0) {
    uni.showToast({ title: '当前题库暂无错题', icon: 'none' });
    return;
  }

  const lines = [`# ${b.name} · 考前错题速记单（共 ${wrongs.length} 题）\n`];
  wrongs.forEach((q, i) => {
    const r = recs[q.id] || {};
    lines.push(`${i + 1}. 【${TYPE_LABELS[q.type] || q.type}｜错${r.wrong || 1}次】${q.stem}`);
    if (q.options && q.options.length) {
      lines.push('   ' + q.options.map((o) => `${o.key}.${o.text}`).join('  '));
    }
    lines.push(`   ✅ 答案：${q.answer}`);
    if (q.analysis) lines.push(`   💡 解析：${q.analysis}`);
    if (r.note) lines.push(`   📝 笔记：${r.note}`);
    lines.push('');
  });

  exportOrCopyFile(`${b.name}_错题速记单.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
}

function goImport() {
  uni.switchTab({ url: '/pages/import/import' });
}
</script>

<style scoped>
.bank-tab {
  padding: 10rpx 24rpx; border-radius: 999px;
  background-color: var(--surface-alt); border: 1px solid var(--border-strong);
  font-size: 25rpx; font-weight: 600; color: var(--text-sec);
}
.bank-tab.active {
  background-color: var(--primary); border-color: var(--primary); color: #ffffff;
}
.op-chip {
  padding: 10rpx 20rpx; border-radius: 12rpx;
  background-color: var(--surface-alt); border: 1px solid var(--border-strong);
  font-size: 24rpx; font-weight: 500;
}
.q-item { padding: 26rpx; }
.act-link { font-size: 24rpx; color: var(--primary); margin-left: 16rpx; }
.q-stem-txt { font-weight: 600; font-size: 28rpx; margin-bottom: 10rpx; white-space: pre-wrap; }
.q-opts-txt { font-size: 24rpx; color: var(--text-sec); margin-bottom: 8rpx; }
.q-ans-txt { font-size: 24rpx; color: var(--text-muted); }

.modal-mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0;
  background-color: rgba(15, 23, 42, 0.55); z-index: 99;
  display: flex; align-items: center; justify-content: center; padding: 28rpx;
}
.modal-panel {
  width: 100%; max-width: 680rpx; background-color: var(--surface);
  border-radius: 24rpx; padding: 32rpx;
}
.f-grp { margin-bottom: 18rpx; }
.f-lbl { font-size: 24rpx; color: var(--text-muted); margin-bottom: 8rpx; }
</style>
