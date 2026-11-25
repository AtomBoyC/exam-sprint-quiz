/**
 * Conflict-Free Multi-Device Incremental Merge Algorithms
 * Shared logic used to merge local offline progress with cloud progress without data loss.
 */

export function createEmptyRecord() {
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

export function isRecordEmpty(r) {
  if (!r) return true;
  return (
    !r.attempts &&
    !r.bookmarked &&
    !r.mastered &&
    !r.inWrongBook &&
    !r.note &&
    !r.updatedAt
  );
}

/**
 * Merge a single question's study record across two devices idempotently.
 */
export function mergeQuestionRecord(localRec, remoteRec) {
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
    // Preserve non-empty note if newer device hasn't written a note yet
    note: winner.note !== undefined && winner.note !== '' ? winner.note : older.note || '',
    lastAnswer: winner.lastAnswer || older.lastAnswer || '',
    lastCorrect: winner.lastCorrect !== undefined ? winner.lastCorrect : older.lastCorrect,
    updatedAt: Math.max(lTime, rTime)
  };
}

export function mergeRecordMaps(localMap = {}, remoteMap = {}) {
  const out = {};
  const keys = new Set([...Object.keys(localMap || {}), ...Object.keys(remoteMap || {})]);
  for (const qId of keys) {
    const merged = mergeQuestionRecord(localMap[qId], remoteMap[qId]);
    if (!isRecordEmpty(merged)) {
      out[qId] = merged;
    }
  }
  return out;
}

/**
 * Merge active banks and deleted tombstones across devices.
 * Returns { banks: Bank[], deletedBanks: { [bankId]: updatedAt } }
 */
export function mergeBanksAndTombstones(
  localBanks = [],
  localDeleted = {},
  remoteBanks = [],
  remoteDeleted = {}
) {
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

    // If bank was resurrected/re-imported newer than tombstone, clear tombstone
    if (delTs > 0 && bTs > delTs) {
      delete deletedMap[b.id];
    }

    const existing = bankById.get(b.id);
    if (!existing) {
      bankById.set(b.id, b);
    } else {
      const exTs = Number(existing.updatedAt || existing.createdAt) || 0;
      if (bTs >= exTs) {
        bankById.set(b.id, b);
      }
    }
  }

  const mergedBanks = Array.from(bankById.values()).sort(
    (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
  );

  return {
    banks: mergedBanks,
    deletedBanks: deletedMap
  };
}

export function mergeSessions(localSession, remoteSession) {
  if (!localSession) return remoteSession || null;
  if (!remoteSession) return localSession || null;
  const lTs = Number(localSession.updatedAt) || 0;
  const rTs = Number(remoteSession.updatedAt) || 0;
  return lTs >= rTs ? localSession : remoteSession;
}

export function mergeExamHistory(localHist = [], remoteHist = []) {
  const byKey = new Map();
  for (const item of [...(remoteHist || []), ...(localHist || [])]) {
    if (!item) continue;
    const key = item.id || `${item.bankId}_${item.date}`;
    byKey.set(key, item);
  }
  return Array.from(byKey.values())
    .sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0))
    .slice(0, 50);
}
