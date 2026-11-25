'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = uniCloud.database();
const usersCol = db.collection('qs_users');
const tokensCol = db.collection('qs_tokens');
const banksCol = db.collection('qs_banks');
const recordsCol = db.collection('qs_records');
const examsCol = db.collection('qs_exams');

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function loadConfig() {
  const localPath = path.join(__dirname, 'config.local.json');
  const basePath = path.join(__dirname, 'config.json');
  let cfg = {};
  try {
    if (fs.existsSync(basePath)) cfg = { ...cfg, ...JSON.parse(fs.readFileSync(basePath, 'utf8')) };
  } catch (_) {}
  try {
    if (fs.existsSync(localPath)) cfg = { ...cfg, ...JSON.parse(fs.readFileSync(localPath, 'utf8')) };
  } catch (_) {}
  return {
    wxAppId: process.env.WX_APPID || cfg.wxAppId || '',
    wxAppSecret: process.env.WX_SECRET || cfg.wxAppSecret || ''
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  const derived = crypto.scryptSync(String(password), salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

async function issueSessionToken(uid) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(rawToken);
  const now = Date.now();
  const expiresAt = now + 90 * 24 * 3600 * 1000; // 90 days

  await tokensCol.doc(tokenHash).set({
    uid,
    createdAt: now,
    expiresAt
  });
  return rawToken;
}

async function authenticateToken(rawToken) {
  if (!rawToken) throw new Error('登录状态无效，请先登录');
  const tokenHash = sha256Hex(rawToken);
  const tokDoc = await tokensCol.doc(tokenHash).get();
  const tok = tokDoc.data && tokDoc.data[0];
  if (!tok || (tok.expiresAt && tok.expiresAt < Date.now())) {
    throw new Error('登录已过期，请重新登录');
  }
  const userDoc = await usersCol.doc(tok.uid).get();
  const user = userDoc.data && userDoc.data[0];
  if (!user) throw new Error('账号不存在');
  return user;
}

function sanitizeUser(doc) {
  return {
    uid: doc._id,
    username: doc.username || '',
    nickname: doc.nickname || doc.username || '微信用户',
    hasPassword: Boolean(doc.passwordHash),
    hasWxBound: Boolean(doc.wxOpenId)
  };
}

// ==================== SERVER-SIDE INCREMENTAL MERGE ====================
function mergeQuestionRecord(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aTime = Number(a.updatedAt) || 0;
  const bTime = Number(b.updatedAt) || 0;
  const winner = aTime >= bTime ? a : b;
  const older = aTime >= bTime ? b : a;
  return {
    attempts: Math.max(Number(a.attempts) || 0, Number(b.attempts) || 0),
    correct: Math.max(Number(a.correct) || 0, Number(b.correct) || 0),
    wrong: Math.max(Number(a.wrong) || 0, Number(b.wrong) || 0),
    streak: Number(winner.streak) || 0,
    inWrongBook: Boolean(winner.inWrongBook),
    mastered: Boolean(winner.mastered),
    bookmarked: Boolean(winner.bookmarked),
    note: winner.note ? winner.note : older.note || '',
    lastAnswer: winner.lastAnswer || older.lastAnswer || '',
    lastCorrect: winner.lastCorrect !== undefined ? winner.lastCorrect : older.lastCorrect,
    updatedAt: Math.max(aTime, bTime)
  };
}

function mergeRecordMaps(mapA = {}, mapB = {}) {
  const out = {};
  const keys = new Set([...Object.keys(mapA || {}), ...Object.keys(mapB || {})]);
  for (const k of keys) {
    out[k] = mergeQuestionRecord(mapA[k], mapB[k]);
  }
  return out;
}

async function fetchWeixinOpenId(code) {
  const cfg = loadConfig();
  if (!cfg.wxAppId || !cfg.wxAppSecret) {
    throw new Error('云函数尚未配置微信小程序 AppID/AppSecret，请先使用账号密码登录，或在 quiz-sync/config.local.json 中填入配置');
  }
  const res = await uniCloud.httpclient.request('https://api.weixin.qq.com/sns/jscode2session', {
    method: 'GET',
    data: {
      appid: cfg.wxAppId,
      secret: cfg.wxAppSecret,
      js_code: code,
      grant_type: 'authorization_code'
    },
    dataType: 'json',
    timeout: 10000
  });
  const body = res.data || {};
  if (body.errcode || !body.openid) {
    throw new Error('微信登录校验失败：' + (body.errmsg || '无效 code'));
  }
  return body.openid;
}

// ==================== ACTION HANDLERS ====================
async function handleRegister(body) {
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const nickname = String(body.nickname || '').trim() || username;

  if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
    throw new Error('账号名需为 3~32 位字母、数字、下划线或短横线');
  }
  if (password.length < 6) {
    throw new Error('密码长度至少 6 位');
  }

  const existing = await usersCol.where({ username }).limit(1).get();
  if (existing.data && existing.data.length > 0) {
    throw new Error('该账号已被注册，请直接登录或换一个账号名');
  }

  const now = Date.now();
  const userDoc = {
    username,
    nickname,
    passwordHash: hashPassword(password),
    wxOpenId: '',
    createdAt: now,
    lastLoginAt: now
  };
  const addRes = await usersCol.add(userDoc);
  const uid = addRes.id;
  const token = await issueSessionToken(uid);
  return {
    token,
    user: sanitizeUser({ _id: uid, ...userDoc })
  };
}

async function handleLogin(body) {
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!username || !password) throw new Error('请输入账号和密码');

  const found = await usersCol.where({ username }).limit(1).get();
  const user = found.data && found.data[0];
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error('账号或密码错误');
  }

  await usersCol.doc(user._id).update({ lastLoginAt: Date.now() });
  const token = await issueSessionToken(user._id);
  return {
    token,
    user: sanitizeUser(user)
  };
}

async function handleWxLogin(body) {
  const openid = await fetchWeixinOpenId(body.code);
  const found = await usersCol.where({ wxOpenId: openid }).limit(1).get();
  let user = found.data && found.data[0];
  const now = Date.now();

  if (!user) {
    const newDoc = {
      username: '',
      nickname: String(body.nickname || '').trim() || '微信同学_' + openid.slice(-4),
      passwordHash: '',
      wxOpenId: openid,
      createdAt: now,
      lastLoginAt: now
    };
    const addRes = await usersCol.add(newDoc);
    user = { _id: addRes.id, ...newDoc };
  } else {
    await usersCol.doc(user._id).update({ lastLoginAt: now });
  }

  const token = await issueSessionToken(user._id);
  return {
    token,
    user: sanitizeUser(user)
  };
}

async function handleBindAccount(user, body) {
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
    throw new Error('账号名需为 3~32 位字母、数字、下划线或短横线');
  }
  if (password.length < 6) {
    throw new Error('密码至少 6 位');
  }

  const clash = await usersCol.where({ username }).limit(1).get();
  if (clash.data && clash.data.length > 0 && clash.data[0]._id !== user._id) {
    throw new Error('该账号名已被其他账号占用');
  }

  const passwordHash = hashPassword(password);
  await usersCol.doc(user._id).update({
    username,
    passwordHash,
    nickname: user.nickname || username
  });

  return {
    user: sanitizeUser({ ...user, username, passwordHash })
  };
}

async function handleBindWeixin(user, body) {
  const openid = await fetchWeixinOpenId(body.code);
  const clash = await usersCol.where({ wxOpenId: openid }).limit(1).get();
  if (clash.data && clash.data.length > 0 && clash.data[0]._id !== user._id) {
    throw new Error('该微信号已绑定其他账号，请先用微信登录');
  }
  await usersCol.doc(user._id).update({ wxOpenId: openid });
  return {
    user: sanitizeUser({ ...user, wxOpenId: openid })
  };
}

async function handleSync(user, body) {
  const uid = user._id;
  const client = body.clientPayload || {};
  const clientBanks = Array.isArray(client.banks) ? client.banks : [];
  const clientDeleted = client.deletedBanks && typeof client.deletedBanks === 'object' ? client.deletedBanks : {};
  const clientRecords = client.recordsByBank && typeof client.recordsByBank === 'object' ? client.recordsByBank : {};
  const clientSessions = client.sessionsByBank && typeof client.sessionsByBank === 'object' ? client.sessionsByBank : {};
  const clientExams = Array.isArray(client.examHistory) ? client.examHistory : [];

  // 1. Fetch existing cloud state for this user
  const [cloudBanksRes, cloudRecsRes, cloudExamsRes] = await Promise.all([
    banksCol.where({ uid }).limit(100).get(),
    recordsCol.where({ uid }).limit(100).get(),
    examsCol.doc(uid).get()
  ]);

  const cloudBankDocs = cloudBanksRes.data || [];
  const cloudRecDocs = cloudRecsRes.data || [];
  const cloudExamDoc = (cloudExamsRes.data && cloudExamsRes.data[0]) || { history: [] };

  const deletedMap = {};
  const activeBankMap = new Map();

  for (const doc of cloudBankDocs) {
    if (doc.deleted) {
      deletedMap[doc.clientBankId] = Math.max(deletedMap[doc.clientBankId] || 0, doc.updatedAt || 0);
    } else {
      activeBankMap.set(doc.clientBankId, doc.bankData);
    }
  }

  for (const [bId, delTs] of Object.entries(clientDeleted)) {
    const ts = Number(delTs) || Date.now();
    deletedMap[bId] = Math.max(deletedMap[bId] || 0, ts);
    const cur = activeBankMap.get(bId);
    if (cur && (Number(cur.updatedAt || cur.createdAt) || 0) <= ts) {
      activeBankMap.delete(bId);
    }
  }

  // Merge active banks
  const banksToSave = [];
  for (const cb of clientBanks) {
    if (!cb || !cb.id) continue;
    const cbTs = Number(cb.updatedAt || cb.createdAt) || Date.now();
    const delTs = deletedMap[cb.id] || 0;
    if (delTs >= cbTs) continue;
    if (delTs > 0 && cbTs > delTs) delete deletedMap[cb.id];

    const existing = activeBankMap.get(cb.id);
    if (!existing || cbTs > (Number(existing.updatedAt || existing.createdAt) || 0)) {
      activeBankMap.set(cb.id, cb);
      banksToSave.push(cb);
    }
  }

  // Persist bank changes & tombstones
  const writeOps = [];
  for (const b of banksToSave) {
    const docId = `${uid}:${b.id}`;
    writeOps.push(
      banksCol.doc(docId).set({
        uid,
        clientBankId: b.id,
        deleted: false,
        updatedAt: Number(b.updatedAt || b.createdAt) || Date.now(),
        bankData: b
      })
    );
  }
  for (const [bId, delTs] of Object.entries(deletedMap)) {
    const docId = `${uid}:${bId}`;
    const prevDoc = cloudBankDocs.find((d) => d.clientBankId === bId);
    if (!prevDoc || !prevDoc.deleted || (prevDoc.updatedAt || 0) < delTs) {
      writeOps.push(
        banksCol.doc(docId).set({
          uid,
          clientBankId: bId,
          deleted: true,
          updatedAt: delTs,
          bankData: null
        })
      );
    }
  }

  // 2. Merge per-bank question records & sessions
  const cloudRecByBank = new Map();
  for (const rDoc of cloudRecDocs) {
    cloudRecByBank.set(rDoc.clientBankId, rDoc);
  }

  const outRecordsByBank = {};
  const outSessionsByBank = {};

  for (const bId of activeBankMap.keys()) {
    const cloudR = cloudRecByBank.get(bId) || { records: {}, session: null };
    const localR = clientRecords[bId] || {};
    const mergedRec = mergeRecordMaps(localR, cloudR.records || {});
    outRecordsByBank[bId] = mergedRec;

    const lSess = clientSessions[bId] || null;
    const rSess = cloudR.session || null;
    const mergedSess =
      !lSess ? rSess : !rSess ? lSess : (lSess.updatedAt || 0) >= (rSess.updatedAt || 0) ? lSess : rSess;
    if (mergedSess) outSessionsByBank[bId] = mergedSess;

    if (Object.keys(localR).length > 0 || lSess) {
      const recDocId = `${uid}:${bId}`;
      writeOps.push(
        recordsCol.doc(recDocId).set({
          uid,
          clientBankId: bId,
          records: mergedRec,
          session: mergedSess || null,
          updatedAt: Date.now()
        })
      );
    }
  }

  // 3. Merge exam history
  const examMap = new Map();
  for (const item of [...(cloudExamDoc.history || []), ...clientExams]) {
    if (!item) continue;
    examMap.set(item.id || `${item.bankId}_${item.date}`, item);
  }
  const mergedExams = Array.from(examMap.values())
    .sort((a, b) => (b.date || 0) - (a.date || 0))
    .slice(0, 50);

  if (clientExams.length > 0 && mergedExams.length !== (cloudExamDoc.history || []).length) {
    writeOps.push(
      examsCol.doc(uid).set({
        uid,
        history: mergedExams,
        updatedAt: Date.now()
      })
    );
  }

  if (writeOps.length > 0) {
    await Promise.all(writeOps);
  }

  const finalBanks = Array.from(activeBankMap.values()).sort(
    (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
  );

  return {
    serverTime: Date.now(),
    banks: finalBanks,
    deletedBanks: deletedMap,
    recordsByBank: outRecordsByBank,
    sessionsByBank: outSessionsByBank,
    examHistory: mergedExams
  };
}

// ==================== ENTRYPOINT (SDK + HTTP URL DUAL MODE) ====================
exports.main = async (event, context) => {
  const isHttp = Boolean(event && event.httpMethod);

  if (isHttp && event.httpMethod === 'OPTIONS') {
    return {
      mpserverlessComposedResponse: true,
      statusCode: 204,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  let body = event || {};
  if (isHttp) {
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf8')
        : event.body || '{}';
      body = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
    } catch (_) {
      body = {};
    }
  }

  const respond = (payload) => {
    if (isHttp) {
      return {
        mpserverlessComposedResponse: true,
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(payload)
      };
    }
    return payload;
  };

  try {
    const action = body.action;
    let data = null;

    if (action === 'register') {
      data = await handleRegister(body);
    } else if (action === 'login') {
      data = await handleLogin(body);
    } else if (action === 'wxLogin') {
      data = await handleWxLogin(body);
    } else if (action === 'me') {
      const user = await authenticateToken(body.token);
      data = { user: sanitizeUser(user) };
    } else if (action === 'bindAccount') {
      const user = await authenticateToken(body.token);
      data = await handleBindAccount(user, body);
    } else if (action === 'bindWeixin') {
      const user = await authenticateToken(body.token);
      data = await handleBindWeixin(user, body);
    } else if (action === 'sync') {
      const user = await authenticateToken(body.token);
      data = await handleSync(user, body);
    } else {
      throw new Error('未知的操作类型: ' + action);
    }

    return respond({ code: 0, message: 'ok', data });
  } catch (err) {
    return respond({
      code: 400,
      message: err.message || '服务器处理异常'
    });
  }
};
