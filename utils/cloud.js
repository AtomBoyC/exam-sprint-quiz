/**
 * Cross-Platform Cloud Auth & Incremental Sync Client
 * Supports:
 * 1. Native uniCloud SDK (`uniCloud.callFunction`) in HBuilderX Mini Program / App / H5
 * 2. HTTP URL Trigger (`uni.request` to uniCloud URLized endpoint) for GitHub Pages H5 & Tauri Desktop
 */
import {
  store,
  persistAuth,
  persistAllBanksAndRecords
} from './store.js';
import {
  mergeBanksAndTombstones,
  mergeRecordMaps,
  mergeSessions,
  mergeExamHistory
} from './merge.js';

// Default cloud endpoint (can be set here or in Profile -> 云端服务配置)
export const DEFAULT_CLOUD_HTTP_URL = '';

let syncDebounceTimer = null;
let syncInFlight = false;

export function isCloudConfigured() {
  const hasNativeUniCloud =
    typeof uniCloud !== 'undefined' && typeof uniCloud.callFunction === 'function';
  const httpUrl = (store.settings.cloudHttpUrl || DEFAULT_CLOUD_HTTP_URL || '').trim();
  return Boolean(hasNativeUniCloud || httpUrl);
}

/**
 * Invoke `quiz-sync` cloud function either via native uniCloud SDK or HTTP URL.
 */
export async function callCloudApi(action, payload = {}) {
  const httpUrl = (store.settings.cloudHttpUrl || DEFAULT_CLOUD_HTTP_URL || '').trim();
  const reqBody = {
    action,
    token: store.auth.token || '',
    ...payload
  };

  // Prefer explicit HTTP URL if configured (works universally across Tauri, H5, App, Mini Program)
  if (httpUrl) {
    return new Promise((resolve, reject) => {
      uni.request({
        url: httpUrl,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: reqBody,
        timeout: 15000,
        success: (res) => {
          const data = res.data || {};
          if (res.statusCode >= 200 && res.statusCode < 300 && data.code === 0) {
            resolve(data.data);
          } else {
            reject(new Error(data.message || `云端请求失败 (${res.statusCode})`));
          }
        },
        fail: (err) => {
          reject(new Error(err.errMsg || '网络连接失败，请检查云函数 URL 是否正确'));
        }
      });
    });
  }

  // Native uniCloud SDK (bound in HBuilderX)
  if (typeof uniCloud !== 'undefined' && typeof uniCloud.callFunction === 'function') {
    const res = await uniCloud.callFunction({
      name: 'quiz-sync',
      data: reqBody
    });
    const result = (res && res.result) || {};
    if (result.code === 0) {
      return result.data;
    }
    throw new Error(result.message || '云函数调用失败');
  }

  throw new Error('尚未关联 uniCloud 服务空间或填写云函数 URL（可在「云同步」页查看 3 步配置说明，离线刷题不受影响）');
}

export async function registerWithPassword(username, password, nickname = '') {
  const data = await callCloudApi('register', { username, password, nickname });
  store.auth.token = data.token;
  store.auth.user = data.user;
  persistAuth();
  await syncNow();
  return data.user;
}

export async function loginWithPassword(username, password) {
  const data = await callCloudApi('login', { username, password });
  store.auth.token = data.token;
  store.auth.user = data.user;
  persistAuth();
  await syncNow();
  return data.user;
}

/**
 * WeChat One-Click Login (微信小程序 / App 微信授权)
 */
export async function loginWithWeixin(nickname = '') {
  const loginRes = await new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: resolve,
      fail: (err) => reject(new Error(err.errMsg || '获取微信登录凭证失败'))
    });
  });

  if (!loginRes.code) {
    throw new Error('未能获取到微信 code');
  }

  const data = await callCloudApi('wxLogin', {
    code: loginRes.code,
    nickname
  });
  store.auth.token = data.token;
  store.auth.user = data.user;
  persistAuth();
  await syncNow();
  return data.user;
}

/**
 * Bind username + password to a WeChat-created account so the user can also log in on PC / Web / App!
 */
export async function bindUsernamePassword(username, password) {
  const data = await callCloudApi('bindAccount', { username, password });
  store.auth.user = data.user;
  persistAuth();
  return data.user;
}

/**
 * Bind current WeChat Mini Program openid to an existing password account.
 */
export async function bindCurrentWeixin() {
  const loginRes = await new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: resolve,
      fail: (err) => reject(new Error(err.errMsg || '获取微信凭证失败'))
    });
  });
  const data = await callCloudApi('bindWeixin', { code: loginRes.code });
  store.auth.user = data.user;
  persistAuth();
  return data.user;
}

export function logoutAccount() {
  store.auth.token = '';
  store.auth.user = null;
  store.auth.lastSyncAt = 0;
  store.syncStatus = 'idle';
  store.syncMessage = '';
  persistAuth();
}

/**
 * Bidirectional Conflict-Free Cloud Sync
 */
export async function syncNow(silent = false) {
  if (!store.auth.token || !isCloudConfigured()) return false;
  if (syncInFlight) return false;

  syncInFlight = true;
  store.syncStatus = 'syncing';
  store.syncMessage = '正在同步...';

  try {
    const clientPayload = {
      banks: store.banks,
      deletedBanks: store.deletedBanks,
      recordsByBank: store.recordsByBank,
      sessionsByBank: store.sessionsByBank,
      examHistory: store.examHistory,
      lastSyncAt: store.auth.lastSyncAt || 0
    };

    const remote = await callCloudApi('sync', { clientPayload });

    // Merge remote unified state back into local reactive store (handles any concurrent changes made during request)
    const { banks, deletedBanks } = mergeBanksAndTombstones(
      store.banks,
      store.deletedBanks,
      remote.banks || [],
      remote.deletedBanks || {}
    );
    store.banks = banks;
    store.deletedBanks = deletedBanks;

    const mergedRecordsByBank = {};
    const mergedSessionsByBank = {};
    for (const b of store.banks) {
      mergedRecordsByBank[b.id] = mergeRecordMaps(
        store.recordsByBank[b.id] || {},
        (remote.recordsByBank && remote.recordsByBank[b.id]) || {}
      );
      const sess = mergeSessions(
        store.sessionsByBank[b.id] || null,
        (remote.sessionsByBank && remote.sessionsByBank[b.id]) || null
      );
      if (sess) mergedSessionsByBank[b.id] = sess;
    }

    store.recordsByBank = mergedRecordsByBank;
    store.sessionsByBank = mergedSessionsByBank;
    store.examHistory = mergeExamHistory(store.examHistory, remote.examHistory || []);

    if (!store.activeBankId || !store.banks.some((b) => b.id === store.activeBankId)) {
      store.activeBankId = store.banks[0] ? store.banks[0].id : null;
    }

    store.auth.lastSyncAt = remote.serverTime || Date.now();
    store.syncStatus = 'synced';
    store.syncMessage = '多端已同步';

    persistAuth();
    persistAllBanksAndRecords();

    if (!silent) {
      uni.showToast({ title: '云端同步完成', icon: 'success' });
    }
    return true;
  } catch (err) {
    store.syncStatus = 'error';
    store.syncMessage = err.message || '同步失败';
    if (!silent) {
      uni.showToast({ title: store.syncMessage, icon: 'none', duration: 2800 });
    }
    return false;
  } finally {
    syncInFlight = false;
  }
}

/**
 * Debounced background sync triggered automatically during study / app lifecycle.
 */
export function triggerAutoSync(reason = 'change') {
  if (!store.auth.token || !isCloudConfigured()) return;
  if (reason === 'launch' || reason === 'show') {
    // Throttle lifecycle syncs to at most once every 20 seconds
    if (Date.now() - (store.auth.lastSyncAt || 0) < 20000) return;
    syncNow(true);
    return;
  }
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    syncNow(true);
  }, 8000);
}
