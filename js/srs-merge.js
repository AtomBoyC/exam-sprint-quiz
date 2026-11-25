/**
 * Spaced Repetition Scheduler (SM-2 / Ebbinghaus Memory Curve)
 * + Conflict-Free Multi-Device Incremental Sync Merge Engine
 */
(function (global) {
  'use strict';

  const MIN_MS = 60 * 1000;
  const DAY_MS = 24 * 60 * MIN_MS;

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
      // SM-2 Spaced Repetition fields
      srsReps: 0,
      srsEase: 2.5,
      srsIntervalMin: 0,
      nextReviewAt: 0,
      updatedAt: 0
    };
  }

  function isRecordEmpty(r) {
    if (!r) return true;
    return !r.attempts && !r.bookmarked && !r.mastered && !r.inWrongBook && !r.note && !r.updatedAt;
  }

  /**
   * Update a record's SM-2 spaced repetition schedule upon answering right or wrong.
   */
  function updateSrsSchedule(rec, isCorrect, now = Date.now()) {
    let reps = Number(rec.srsReps) || 0;
    let ease = Number(rec.srsEase) || 2.5;
    let intervalMin = Number(rec.srsIntervalMin) || 0;

    if (!isCorrect) {
      reps = 0;
      ease = Math.max(1.3, Number((ease - 0.2).toFixed(2)));
      intervalMin = 10; // Re-review in 10 minutes
      rec.nextReviewAt = now + intervalMin * MIN_MS;
    } else {
      if (reps === 0) {
        intervalMin = 24 * 60; // 1 day
      } else if (reps === 1) {
        intervalMin = 3 * 24 * 60; // 3 days
      } else {
        const prevDays = Math.max(1, intervalMin / (24 * 60));
        const nextDays = Math.min(60, Math.round(prevDays * ease));
        intervalMin = nextDays * 24 * 60;
      }
      reps += 1;
      ease = Math.min(3.0, Number((ease + 0.08).toFixed(2)));
      rec.nextReviewAt = now + intervalMin * MIN_MS;
    }

    rec.srsReps = reps;
    rec.srsEase = ease;
    rec.srsIntervalMin = intervalMin;
    return rec;
  }

  /**
   * Check whether a question is currently due for spaced-repetition review.
   */
  function isQuestionDue(rec, now = Date.now()) {
    if (!rec || !rec.attempts || rec.mastered) return false;
    if (!rec.nextReviewAt) return rec.inWrongBook;
    return rec.nextReviewAt <= now;
  }

  /**
   * Classify question memory retention stage for visual analytics.
   */
  function getRetentionStage(rec, now = Date.now()) {
    if (!rec || !rec.attempts) return 'new';
    if (rec.mastered) return 'mastered';
    if (isQuestionDue(rec, now)) return 'due';
    if ((rec.srsReps || 0) >= 2) return 'consolidated';
    return 'learning';
  }

  /**
   * Today's YYYY-MM-DD local date key for activity heatmap.
   */
  function getLocalDateKey(ts = Date.now()) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ==================== CONFLICT-FREE MULTI-DEVICE MERGE ====================
  function mergeQuestionRecord(localRec, remoteRec) {
    if (isRecordEmpty(localRec) && isRecordEmpty(remoteRec)) return createEmptyRecord();
    if (isRecordEmpty(localRec)) return { ...createEmptyRecord(), ...remoteRec };
    if (isRecordEmpty(remoteRec)) return { ...createEmptyRecord(), ...localRec };

    const lTime = Number(localRec.updatedAt) || 0;
    const rTime = Number(remoteRec.updatedAt) || 0;
    const winner = lTime >= rTime ? localRec : remoteRec;
    const older = lTime >= rTime ? remoteRec : localRec;

    return {
      attempts: Math.max(Number(localRec.attempts) || 0, Number(remoteRec.attempts) || 0),
      correct: Math.max(Number(localRec.correct) || 0, Number(remoteRec.correct) || 0),
      wrong: Math.max(Number(localRec.wrong) || 0, Number(remoteRec.wrong) || 0),
      streak: Number(winner.streak) || 0,
      inWrongBook: Boolean(winner.inWrongBook),
      mastered: Boolean(winner.mastered),
      bookmarked: Boolean(winner.bookmarked),
      note: winner.note !== undefined && winner.note !== '' ? winner.note : older.note || '',
      lastAnswer: winner.lastAnswer || older.lastAnswer || '',
      lastCorrect: winner.lastCorrect !== undefined ? winner.lastCorrect : older.lastCorrect,
      srsReps: Number(winner.srsReps) || 0,
      srsEase: Number(winner.srsEase) || 2.5,
      srsIntervalMin: Number(winner.srsIntervalMin) || 0,
      nextReviewAt: Number(winner.nextReviewAt) || 0,
      updatedAt: Math.max(lTime, rTime)
    };
  }

  function mergeRecordMaps(localMap = {}, remoteMap = {}) {
    const out = {};
    const keys = new Set([...Object.keys(localMap || {}), ...Object.keys(remoteMap || {})]);
    for (const qId of keys) {
      const merged = mergeQuestionRecord(localMap[qId], remoteMap[qId]);
      if (!isRecordEmpty(merged)) out[qId] = merged;
    }
    return out;
  }

  function mergeBanksAndTombstones(localBanks = [], localDeleted = {}, remoteBanks = [], remoteDeleted = {}) {
    const deletedMap = { ...(remoteDeleted || {}) };
    for (const [id, ts] of Object.entries(localDeleted || {})) {
      deletedMap[id] = Math.max(Number(deletedMap[id]) || 0, Number(ts) || 0);
    }

    const bankById = new Map();
    for (const b of remoteBanks || []) {
      if (!b || !b.id) continue;
      const delTs = Number(deletedMap[b.id]) || 0;
      const bTs = Number(b.updatedAt || b.createdAt) || 0;
      if (delTs >= bTs && delTs > 0) continue;
      bankById.set(b.id, b);
    }

    for (const b of localBanks || []) {
      if (!b || !b.id) continue;
      const bTs = Number(b.updatedAt || b.createdAt) || 0;
      const delTs = Number(deletedMap[b.id]) || 0;
      if (delTs >= bTs && delTs > 0) continue;
      if (delTs > 0 && bTs > delTs) delete deletedMap[b.id];

      const existing = bankById.get(b.id);
      if (!existing || bTs >= (Number(existing.updatedAt || existing.createdAt) || 0)) {
        bankById.set(b.id, b);
      }
    }

    const banks = Array.from(bankById.values()).sort(
      (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
    );
    return { banks, deletedBanks: deletedMap };
  }

  function mergeDailyStats(localDaily = {}, remoteDaily = {}) {
    const out = {};
    const dates = new Set([...Object.keys(localDaily || {}), ...Object.keys(remoteDaily || {})]);
    for (const dt of dates) {
      const l = localDaily[dt] || {};
      const r = remoteDaily[dt] || {};
      out[dt] = {
        answered: Math.max(Number(l.answered) || 0, Number(r.answered) || 0),
        correct: Math.max(Number(l.correct) || 0, Number(r.correct) || 0)
      };
    }
    return out;
  }

  function mergeExamHistory(localHist = [], remoteHist = []) {
    const map = new Map();
    for (const item of [...(remoteHist || []), ...(localHist || [])]) {
      if (!item) continue;
      map.set(item.id || `${item.bankId}_${item.date}`, item);
    }
    return Array.from(map.values())
      .sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0))
      .slice(0, 60);
  }

  function mergeFullPayload(local, remote) {
    const { banks, deletedBanks } = mergeBanksAndTombstones(
      local.banks,
      local.deletedBanks,
      remote.banks,
      remote.deletedBanks
    );

    const recordsByBank = {};
    for (const b of banks) {
      recordsByBank[b.id] = mergeRecordMaps(
        (local.recordsByBank && local.recordsByBank[b.id]) || {},
        (remote.recordsByBank && remote.recordsByBank[b.id]) || {}
      );
    }

    return {
      banks,
      deletedBanks,
      recordsByBank,
      dailyStats: mergeDailyStats(local.dailyStats, remote.dailyStats),
      examHistory: mergeExamHistory(local.examHistory, remote.examHistory),
      syncedAt: Date.now()
    };
  }

  global.SrsAndMerge = {
    DAY_MS,
    createEmptyRecord,
    updateSrsSchedule,
    isQuestionDue,
    getRetentionStage,
    getLocalDateKey,
    mergeQuestionRecord,
    mergeRecordMaps,
    mergeBanksAndTombstones,
    mergeDailyStats,
    mergeExamHistory,
    mergeFullPayload
  };
})(typeof window !== 'undefined' ? window : globalThis);
