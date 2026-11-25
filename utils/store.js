/**
 * Local-First Reactive Store for uni-app Vue 3 (微信小程序 / App / Web / Tauri 全端通用)
 * Splits per-bank data across separate storage keys to stay well below WeChat Mini Program's 1MB single-key limit.
 */
import { reactive } from 'vue';
import { parseJson } from './parser.js';
import { createEmptyRecord } from './merge.js';

const KEY_PREFIX = 'qs_v2_';
const KEY_INDEX = KEY_PREFIX + 'bank_ids';
const KEY_DELETED = KEY_PREFIX + 'deleted_banks';
const KEY_ACTIVE_BANK = KEY_PREFIX + 'active_bank';
const KEY_SETTINGS = KEY_PREFIX + 'settings';
const KEY_EXAMS = KEY_PREFIX + 'exam_history';
const KEY_AUTH = KEY_PREFIX + 'auth';

export const DEFAULT_SETTINGS = {
  theme: 'light', // 'light' | 'dark'
  autoNextOnCorrect: true,
  autoNextDelayMs: 600,
  shuffleOptions: false,
  autoRemoveWrongOnCorrect: false,
  masteryStreakTarget: 1,
  fontSize: 'md', // 'sm' | 'md' | 'lg'
  cloudHttpUrl: '' // Optional uniCloud HTTP URL for H5 / Tauri Desktop outside HBuilderX
};

export const store = reactive({
  initialized: false,
  banks: [],
  deletedBanks: {},
  recordsByBank: {},
  sessionsByBank: {},
  examHistory: [],
  activeBankId: null,
  settings: { ...DEFAULT_SETTINGS },

  // Auth & Cloud Sync state
  auth: {
    token: '',
    user: null, // { uid, username, nickname, hasPassword, hasWxBound }
    lastSyncAt: 0
  },
  syncStatus: 'idle', // 'idle' | 'syncing' | 'synced' | 'error'
  syncMessage: '',

  // Transient active study session & staging
  activeSession: null,
  lastExamReport: null
});

function sGet(key, fallback = null) {
  try {
    const val = uni.getStorageSync(key);
    return val !== '' && val !== undefined && val !== null ? val : fallback;
  } catch (_) {
    return fallback;
  }
}

function sSet(key, value) {
  try {
    uni.setStorageSync(key, value);
  } catch (e) {
    console.warn('Storage write warning:', key, e);
  }
}

function sRemove(key) {
  try {
    uni.removeStorageSync(key);
  } catch (_) {
    // ignore
  }
}

export function initAppStore() {
  if (store.initialized) return;

  const settings = sGet(KEY_SETTINGS, {});
  store.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  const auth = sGet(KEY_AUTH, null);
  if (auth && auth.token) {
    store.auth = {
      token: auth.token,
      user: auth.user || null,
      lastSyncAt: auth.lastSyncAt || 0
    };
  }

  store.deletedBanks = sGet(KEY_DELETED, {}) || {};
  store.examHistory = sGet(KEY_EXAMS, []) || [];

  const bankIds = sGet(KEY_INDEX, []) || [];
  const loadedBanks = [];
  const recordsMap = {};
  const sessionsMap = {};

  for (const id of bankIds) {
    const b = sGet(KEY_PREFIX + 'bank_' + id, null);
    if (b && b.id) {
      loadedBanks.push(b);
      recordsMap[id] = sGet(KEY_PREFIX + 'rec_' + id, {}) || {};
      const sess = sGet(KEY_PREFIX + 'sess_' + id, null);
      if (sess) sessionsMap[id] = sess;
    }
  }

  store.banks = loadedBanks;
  store.recordsByBank = recordsMap;
  store.sessionsByBank = sessionsMap;

  const savedActive = sGet(KEY_ACTIVE_BANK, null);
  store.activeBankId =
    loadedBanks.some((b) => b.id === savedActive)
      ? savedActive
      : loadedBanks[0]
      ? loadedBanks[0].id
      : null;

  store.initialized = true;
}

export function persistBank(bank) {
  if (!bank || !bank.id) return;
  sSet(KEY_PREFIX + 'bank_' + bank.id, bank);
  sSet(
    KEY_INDEX,
    store.banks.map((b) => b.id)
  );
}

export function persistAllBanksAndRecords() {
  const ids = store.banks.map((b) => b.id);
  sSet(KEY_INDEX, ids);
  sSet(KEY_DELETED, store.deletedBanks);
  sSet(KEY_ACTIVE_BANK, store.activeBankId);

  for (const b of store.banks) {
    sSet(KEY_PREFIX + 'bank_' + b.id, b);
    sSet(KEY_PREFIX + 'rec_' + b.id, store.recordsByBank[b.id] || {});
    if (store.sessionsByBank[b.id]) {
      sSet(KEY_PREFIX + 'sess_' + b.id, store.sessionsByBank[b.id]);
    }
  }
  sSet(KEY_EXAMS, store.examHistory);
}

export function persistBankRecords(bankId) {
  if (!bankId) return;
  sSet(KEY_PREFIX + 'rec_' + bankId, store.recordsByBank[bankId] || {});
}

export function persistBankSession(bankId, sessionObj) {
  if (!bankId) return;
  if (sessionObj) {
    const clean = {
      mode: sessionObj.mode,
      currentIndex: sessionObj.currentIndex,
      items: sessionObj.items,
      shuffleOptions: sessionObj.shuffleOptions,
      updatedAt: Date.now()
    };
    store.sessionsByBank[bankId] = clean;
    sSet(KEY_PREFIX + 'sess_' + bankId, clean);
  } else {
    delete store.sessionsByBank[bankId];
    sRemove(KEY_PREFIX + 'sess_' + bankId);
  }
}

export function persistSettings() {
  sSet(KEY_SETTINGS, store.settings);
}

export function persistAuth() {
  sSet(KEY_AUTH, store.auth);
}

export function persistExamHistory() {
  sSet(KEY_EXAMS, store.examHistory);
}

export function setActiveBank(bankId) {
  store.activeBankId = bankId;
  sSet(KEY_ACTIVE_BANK, bankId);
}

export function getActiveBank() {
  if (!store.activeBankId) return store.banks[0] || null;
  return store.banks.find((b) => b.id === store.activeBankId) || store.banks[0] || null;
}

export function getBankRecords(bankId) {
  if (!bankId) return {};
  if (!store.recordsByBank[bankId]) store.recordsByBank[bankId] = {};
  return store.recordsByBank[bankId];
}

export function getQuestionRecord(bankId, qId) {
  const map = getBankRecords(bankId);
  if (!map[qId]) map[qId] = createEmptyRecord();
  return map[qId];
}

export function addOrImportBank(name, questions, appendToCurrent = false) {
  const now = Date.now();
  if (appendToCurrent && getActiveBank()) {
    const bank = getActiveBank();
    const base = bank.questions.length;
    const appended = questions.map((q, i) => ({
      ...q,
      id: 'q_' + now + '_' + i + '_' + Math.random().toString(36).slice(2, 6),
      index: base + i + 1
    }));
    bank.questions.push(...appended);
    bank.updatedAt = now;
    persistBank(bank);
    return bank;
  }

  const newBank = {
    id: 'bank_' + now + '_' + Math.random().toString(36).slice(2, 6),
    name: name || '我的题库',
    createdAt: now,
    updatedAt: now,
    questions: questions.map((q, i) => ({
      ...q,
      id: q.id || 'q_' + (i + 1) + '_' + Math.random().toString(36).slice(2, 7),
      index: i + 1
    }))
  };

  store.banks.unshift(newBank);
  store.recordsByBank[newBank.id] = {};
  store.activeBankId = newBank.id;
  persistBank(newBank);
  persistBankRecords(newBank.id);
  sSet(KEY_ACTIVE_BANK, newBank.id);
  return newBank;
}

export function removeBank(bankId) {
  const now = Date.now();
  store.banks = store.banks.filter((b) => b.id !== bankId);
  store.deletedBanks[bankId] = now;
  delete store.recordsByBank[bankId];
  delete store.sessionsByBank[bankId];

  sRemove(KEY_PREFIX + 'bank_' + bankId);
  sRemove(KEY_PREFIX + 'rec_' + bankId);
  sRemove(KEY_PREFIX + 'sess_' + bankId);
  sSet(KEY_DELETED, store.deletedBanks);
  sSet(
    KEY_INDEX,
    store.banks.map((b) => b.id)
  );

  if (store.activeBankId === bankId) {
    store.activeBankId = store.banks[0] ? store.banks[0].id : null;
    sSet(KEY_ACTIVE_BANK, store.activeBankId);
  }
}

export function createDemoBankQuestions() {
  return parseJson(
    JSON.stringify([
      {
        type: 'single',
        category: '第一章 网络基础',
        stem: 'HTTPS 协议默认使用的传输层端口号是？',
        options: ['21', '22', '80', '443'],
        answer: 'D',
        analysis: 'HTTP 默认端口 80，HTTPS 默认端口 443，FTP 为 21，SSH 为 22。'
      },
      {
        type: 'single',
        category: '第一章 网络基础',
        stem: '在 OSI 七层模型中，负责路由选择与分组转发的是哪一层？',
        options: ['物理层', '数据链路层', '网络层', '传输层'],
        answer: 'C',
        analysis: '网络层（IP、路由器）负责路由选择与跨网段分组转发。'
      },
      {
        type: 'multiple',
        category: '第二章 操作系统',
        stem: '产生死锁的四个必要条件包括哪些？',
        options: ['互斥条件', '请求和保持条件', '不可剥夺条件', '循环等待条件'],
        answer: 'ABCD',
        analysis: '死锁四大必要条件缺一不可，破坏任意一条即可预防死锁。'
      },
      {
        type: 'judge',
        category: '第二章 操作系统',
        stem: '队列（Queue）是一种“后进先出（LIFO）”的线性结构。',
        answer: '错',
        analysis: '队列是先进先出（FIFO），栈（Stack）才是后进先出（LIFO）。'
      },
      {
        type: 'fill',
        category: '第一章 网络基础',
        stem: '将域名解析为 IP 地址的协议英文缩写是 ______。',
        answer: 'DNS',
        analysis: 'DNS（Domain Name System）负责域名与 IP 映射解析。'
      },
      {
        type: 'short',
        category: '第一章 网络基础',
        stem: '简述数据备份“3-2-1”原则的具体含义。',
        answer: '至少保存 3 份数据副本，使用 2 种不同存储介质，其中至少 1 份异地离线保存。',
        analysis: '记住三个数字关键词：3份副本、2种介质、1份异地。'
      }
    ])
  ).questions;
}
