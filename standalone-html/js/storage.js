/**
 * Persistent Local Storage Manager (IndexedDB primary + localStorage fallback).
 * Stores multiple question banks, per-question learning records, exam history, and preferences.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'ExamSprintQuizDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'kv';
  const LS_PREFIX = 'examsprint_v1_';

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
      } catch (_) {
        // storage full
      }
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
          } catch (_) {
            // ignore
          }
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
      } catch (_) {
        // ignore
      }
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
    theme: 'light', // 'light' | 'dark'
    autoNextOnCorrect: true,
    autoNextDelayMs: 650,
    shuffleOptions: false,
    autoRemoveWrongOnCorrect: false,
    masteryStreakTarget: 1, // consecutive correct answers needed to auto-kill in sprint mode
    fontSize: 'md' // 'sm' | 'md' | 'lg'
  };

  function createEmptyRecord() {
    return {
      attempts: 0,
      correct: 0,
      wrong: 0,
      streak: 0,
      inWrongBook: false,
      mastered: false,
      bookmarked: false,
      note: '',
      lastAnswer: '',
      lastCorrect: null,
      updatedAt: 0
    };
  }

  /**
   * High-level repository API
   */
  const QuizStorage = {
    DEFAULT_SETTINGS,
    createEmptyRecord,

    async loadAll() {
      const [banks, recordsByBank, settings, examHistory, activeBankId] = await Promise.all([
        idbGet('banks'),
        idbGet('recordsByBank'),
        idbGet('settings'),
        idbGet('examHistory'),
        idbGet('activeBankId')
      ]);

      return {
        banks: Array.isArray(banks) ? banks : [],
        recordsByBank: recordsByBank && typeof recordsByBank === 'object' ? recordsByBank : {},
        settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
        examHistory: Array.isArray(examHistory) ? examHistory : [],
        activeBankId: activeBankId || null
      };
    },

    async saveBanks(banks) {
      await idbSet('banks', banks);
    },

    async saveRecords(recordsByBank) {
      await idbSet('recordsByBank', recordsByBank);
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
      if (!bankId) return;
      await idbSet('session_' + bankId, session);
    },

    async loadSession(bankId) {
      if (!bankId) return null;
      return idbGet('session_' + bankId);
    },

    async clearSession(bankId) {
      if (!bankId) return;
      await idbDelete('session_' + bankId);
    }
  };

  global.QuizStorage = QuizStorage;
})(typeof window !== 'undefined' ? window : globalThis);
