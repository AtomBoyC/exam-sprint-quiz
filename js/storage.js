/**
 * Local-First IndexedDB Storage + Zero-Server GitHub Gist Private Cloud Sync
 * Works across macOS / Windows / Linux Tauri Desktop Apps and Modern Web Browsers.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'ExamSprintQuizDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'kv';
  const LS_PREFIX = 'examsprint_v1_';
  const GIST_FILENAME = 'examsprint_cloud_sync.json';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') {
      dbPromise = Promise.resolve(null);
      return dbPromise;
    }
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
    return dbPromise;
  }

  async function idbGet(key) {
    const db = await openDB();
    if (!db) {
      try {
        const raw = localStorage.getItem(LS_PREFIX + key);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function idbSet(key, value) {
    const db = await openDB();
    if (!db) {
      try {
        localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
      } catch (_) {}
      return;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          try {
            localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
          } catch (_) {}
          resolve();
        };
      } catch (_) {
        resolve();
      }
    });
  }

  async function idbDelete(key) {
    const db = await openDB();
    if (!db) {
      try {
        localStorage.removeItem(LS_PREFIX + key);
      } catch (_) {}
      return;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (_) {
        resolve();
      }
    });
  }

  const DEFAULT_SETTINGS = {
    theme: 'light', // 'light' | 'sepia' | 'dark'
    autoNextOnCorrect: true,
    autoNextDelayMs: 550,
    shuffleOptions: false,
    autoRemoveWrongOnCorrect: false,
    masteryStreakTarget: 1,
    fontSize: 'md', // 'sm' | 'md' | 'lg'
    soundEnabled: false,
    examTitle: '',
    examDate: '',
    // GitHub Private Gist Sync
    gistToken: '',
    gistId: '',
    autoGistSync: true,
    lastSyncAt: 0,
    loadedBuiltinIds: []
  };

  /**
   * Synchronize local state with a private GitHub Gist using Personal Access Token (gist scope).
   * Auto-discovers existing `examsprint_cloud_sync.json` gist if gistId is blank!
   */
  async function syncWithGitHubGist(localData, token, existingGistId = '') {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) {
      throw new Error('请先填写 GitHub Personal Access Token（需勾选 gist 权限）');
    }

    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + cleanToken,
      'Content-Type': 'application/json'
    };

    let gistId = String(existingGistId || '').trim();
    let remotePayload = null;

    // 1. Auto-discover existing sync gist if gistId not set
    if (!gistId) {
      const listRes = await fetch('https://api.github.com/gists?per_page=60', { headers });
      if (!listRes.ok) {
        throw new Error(
          listRes.status === 401
            ? 'GitHub Token 无效或已过期，请检查权限（需包含 gist）'
            : `连接 GitHub 失败 (${listRes.status})`
        );
      }
      const gists = await listRes.json();
      const matched = Array.isArray(gists)
        ? gists.find((g) => g && g.files && g.files[GIST_FILENAME])
        : null;
      if (matched) {
        gistId = matched.id;
      }
    }

    // 2. Fetch existing remote Gist content if present
    if (gistId) {
      const getRes = await fetch('https://api.github.com/gists/' + encodeURIComponent(gistId), {
        headers
      });
      if (getRes.ok) {
        const gistObj = await getRes.json();
        const fileEntry = gistObj.files && gistObj.files[GIST_FILENAME];
        if (fileEntry) {
          let rawJson = fileEntry.content || '';
          if (fileEntry.truncated && fileEntry.raw_url) {
            const rawRes = await fetch(fileEntry.raw_url);
            rawJson = await rawRes.text();
          }
          if (rawJson) {
            try {
              remotePayload = JSON.parse(rawJson);
            } catch (_) {}
          }
        }
      } else if (getRes.status === 404) {
        gistId = '';
      } else {
        throw new Error(`读取云端 Gist 失败 (${getRes.status})`);
      }
    }

    // 3. Conflict-free bidirectional merge
    const merged = remotePayload
      ? global.SrsAndMerge.mergeFullPayload(localData, remotePayload)
      : {
          banks: localData.banks || [],
          deletedBanks: localData.deletedBanks || {},
          recordsByBank: localData.recordsByBank || {},
          dailyStats: localData.dailyStats || {},
          examHistory: localData.examHistory || [],
          syncedAt: Date.now()
        };

    const serialized = JSON.stringify(
      {
        version: 3,
        updatedAt: merged.syncedAt,
        ...merged
      },
      null,
      2
    );

    // 4. Push merged snapshot back to secret Gist
    if (gistId) {
      const patchRes = await fetch('https://api.github.com/gists/' + encodeURIComponent(gistId), {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          description: 'ExamSprint 极速刷题宝 · 多设备私有云同步数据',
          files: {
            [GIST_FILENAME]: { content: serialized }
          }
        })
      });
      if (!patchRes.ok) {
        throw new Error(`上传同步数据失败 (${patchRes.status})`);
      }
    } else {
      const createRes = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          description: 'ExamSprint 极速刷题宝 · 多设备私有云同步数据',
          public: false,
          files: {
            [GIST_FILENAME]: { content: serialized }
          }
        })
      });
      if (!createRes.ok) {
        throw new Error(`创建私有同步 Gist 失败 (${createRes.status})，请确认 Token 勾选了 gist 权限`);
      }
      const created = await createRes.json();
      gistId = created.id;
    }

    return {
      gistId,
      merged
    };
  }

  const QuizStorage = {
    DEFAULT_SETTINGS,
    createEmptyRecord: global.SrsAndMerge.createEmptyRecord,
    syncWithGitHubGist,

    async loadAll() {
      const [banks, deletedBanks, recordsByBank, dailyStats, settings, examHistory, activeBankId] =
        await Promise.all([
          idbGet('banks'),
          idbGet('deletedBanks'),
          idbGet('recordsByBank'),
          idbGet('dailyStats'),
          idbGet('settings'),
          idbGet('examHistory'),
          idbGet('activeBankId')
        ]);

      return {
        banks: Array.isArray(banks) ? banks : [],
        deletedBanks: deletedBanks && typeof deletedBanks === 'object' ? deletedBanks : {},
        recordsByBank: recordsByBank && typeof recordsByBank === 'object' ? recordsByBank : {},
        dailyStats: dailyStats && typeof dailyStats === 'object' ? dailyStats : {},
        settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
        examHistory: Array.isArray(examHistory) ? examHistory : [],
        activeBankId: activeBankId || null
      };
    },

    async saveBanks(banks) {
      await idbSet('banks', banks);
    },
    async saveDeletedBanks(deletedBanks) {
      await idbSet('deletedBanks', deletedBanks);
    },
    async saveRecords(recordsByBank) {
      await idbSet('recordsByBank', recordsByBank);
    },
    async saveDailyStats(dailyStats) {
      await idbSet('dailyStats', dailyStats);
    },
    async saveSettings(settings) {
      await idbSet('settings', settings);
    },
    async saveExamHistory(history) {
      await idbSet('examHistory', history);
    },
    async saveActiveBankId(bankId) {
      await idbSet('activeBankId', bankId);
    },
    async saveSession(bankId, session) {
      if (bankId) await idbSet('session_' + bankId, session);
    },
    async loadSession(bankId) {
      return bankId ? idbGet('session_' + bankId) : null;
    },
    async clearSession(bankId) {
      if (bankId) await idbDelete('session_' + bankId);
    }
  };

  global.QuizStorage = QuizStorage;
})(typeof window !== 'undefined' ? window : globalThis);
