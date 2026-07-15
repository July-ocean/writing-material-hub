'use strict';

/**
 * 作文素材坊 —— 高考作文素材收集与交流平台
 * 存储层支持两种模式（自动切换）：
 *   1) Supabase（免费 Postgres，持久化）：设置环境变量 SUPABASE_URL + SUPABASE_KEY 后启用。
 *   2) 本地文件 data/db.json（零依赖，方便本地开发/演示）。
 * 前端无需改动，所有 API 保持不变。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA, 'db.json');
const PORT = process.env.PORT || 3000;
const MAX_USERS = 100;

/* ------------------------- 密码哈希 ------------------------- */
function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return h === hash;
}

/* ------------------------- 存储层选择 ------------------------- */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const useSupabase = !!(SUPABASE_URL && SUPABASE_KEY);
let sb = null;
if (useSupabase) {
  const { createClient } = require('@supabase/supabase-js');
  sb = createClient(SUPABASE_URL, SUPABASE_KEY);
}
const store = useSupabase ? supabaseStore(sb) : fileStore();

/* ------------------------- 文件存储（本地回退） ------------------------- */
function seedDb() {
  const tId = crypto.randomUUID(), sId = crypto.randomUUID(), s2Id = crypto.randomUUID();
  const now = Date.now();
  const users = [
    { id: tId, username: 'teacher', password: hashPassword('123456'), role: 'teacher', displayName: '王老师', createdAt: now },
    { id: sId, username: 'student', password: hashPassword('123456'), role: 'student', displayName: '小明', createdAt: now },
    { id: s2Id, username: 'xiaohong', password: hashPassword('123456'), role: 'student', displayName: '小红', createdAt: now },
  ];
  const materials = [
    {
      id: crypto.randomUUID(), title: '文化自信：从故宫文创说起',
      intro: '梳理“文化自信”的论证角度与可引用的案例素材，适合宏大主题类作文。',
      content: '一、核心论点\n文化自信不是封闭自守，而是在开放中确认自身价值。\n\n二、可用案例\n1. 故宫文创：把文物“带回家”，让传统以年轻人喜欢的方式重生。\n2. 《只此青绿》：以舞蹈语汇激活《千里江山图》。',
      source: '《人民日报》文化版', authorId: s2Id, authorName: '小红', authorRole: 'student',
      status: 'approved', createdAt: now - 3600e3 * 30, approvedAt: now - 3600e3 * 29,
      likes: [tId, sId], favorites: [sId],
      comments: [{ id: crypto.randomUUID(), userId: sId, userName: '小明', content: '案例很新，谢谢分享！', createdAt: now - 3600e3 * 20 }],
    },
    {
      id: crypto.randomUUID(), title: '科技向善：人工智能的伦理边界',
      intro: '探讨科技发展中“善”的价值导向，可用于科技类、人文类作文。',
      content: '一、立意\n技术本身无善恶，关键在于人的选择。\n\n二、论证思路\n1. 科技放大人性：善用则造福，滥用则反噬。\n2. 向善是底线也是方向：以“科技向善”约束创新。',
      source: '高考满分作文选', authorId: sId, authorName: '小明', authorRole: 'student',
      status: 'approved', createdAt: now - 3600e3 * 20, approvedAt: now - 3600e3 * 19,
      likes: [tId], favorites: [], comments: [],
    },
    {
      id: crypto.randomUUID(), title: '坚守初心：论青年的责任担当',
      intro: '教师精选：关于“初心与担当”的多维素材与结构示范。',
      content: '一、结构示范\n引：以时代之问开篇。\n议：初心为何物（价值层）。\n联：青年如何担当（实践层）。\n结：回扣主题，升华。\n\n二、可用人物\n黄文秀、张桂梅等扎根一线、不负初心的典型。',
      source: '王老师教学整理', authorId: tId, authorName: '王老师', authorRole: 'teacher',
      status: 'approved', createdAt: now - 3600e3 * 10, approvedAt: now - 3600e3 * 9,
      likes: [sId, s2Id], favorites: [s2Id],
      comments: [{ id: crypto.randomUUID(), userId: s2Id, userName: '小红', content: '老师给的框架很清晰！', createdAt: now - 3600e3 * 8 }],
    },
    {
      id: crypto.randomUUID(), title: '生态文明：绿水青山就是金山银山',
      intro: '待审核示例素材：生态文明主题的论证角度。',
      content: '一、核心\n生态保护与经济发展并非对立。\n二、案例\n浙江安吉余村转型。',
      source: '网络整理', authorId: sId, authorName: '小明', authorRole: 'student',
      status: 'pending', createdAt: now - 3600e3 * 2, approvedAt: null, likes: [], favorites: [], comments: [],
    },
  ];
  return { users, materials, sessions: {} };
}

function fileStore() {
  function ensureDb() {
    if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
    if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(seedDb(), null, 2));
  }
  function readDb() { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  function writeDb(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
  let lock = Promise.resolve();
  function withLock(fn) {
    const run = lock.then(() => { const db = readDb(); const r = fn(db); writeDb(db); return r; });
    lock = run.catch(() => {});
    return run;
  }
  function norm(m, userId, detail) {
    const comments = (m.comments || []).map(c => ({ id: c.id, userName: c.userName, content: c.content, createdAt: c.createdAt }));
    return {
      id: m.id, title: m.title, intro: m.intro, content: m.content, source: m.source,
      authorId: m.authorId, authorName: m.authorName, authorRole: m.authorRole,
      createdAt: m.createdAt, approvedAt: m.approvedAt, status: m.status,
      likesCount: m.likes.length, favoritesCount: m.favorites.length,
      liked: userId ? m.likes.includes(userId) : false,
      favorited: userId ? m.favorites.includes(userId) : false,
      commentsCount: comments.length, comments: detail ? comments : undefined,
    };
  }
  ensureDb();
  return {
    async findUserByUsername(u) { const db = readDb(); return db.users.find(x => x.username === u) || null; },
    async createUser(o) { return withLock(db => { const u = { id: crypto.randomUUID(), ...o }; db.users.push(u); return u; }); },
    async getUserById(id) { const db = readDb(); return db.users.find(u => u.id === id) || null; },
    async countUsers() { return readDb().users.length; },
    async createSession(token, userId) { return withLock(db => { db.sessions[token] = userId; }); },
    async getUserIdByToken(token) { const db = readDb(); return db.sessions[token] || null; },
    async deleteSession(token) { return withLock(db => { delete db.sessions[token]; }); },
    async createMaterial(o) { return withLock(db => { const m = { id: crypto.randomUUID(), ...o, status: 'pending', createdAt: Date.now(), approvedAt: null, likes: [], favorites: [], comments: [] }; db.materials.push(m); return norm(m, null, true); }); },
    async getMaterial(id, userId) { const db = readDb(); const m = db.materials.find(x => x.id === id); if (!m) return null; return norm(m, userId, true); },
    async listApproved(userId) { const db = readDb(); const list = db.materials.filter(m => m.status === 'approved').map(m => norm(m, userId, false)); list.sort((a, b) => (b.likesCount - a.likesCount) || (b.createdAt - a.createdAt)); return list; },
    async listPending(userId) { const db = readDb(); return db.materials.filter(m => m.status === 'pending').map(m => norm(m, userId, true)).sort((a, b) => b.createdAt - a.createdAt); },
    async approve(id) { return withLock(db => { const m = db.materials.find(x => x.id === id); if (m) { m.status = 'approved'; m.approvedAt = Date.now(); } }); },
    async reject(id) { return withLock(db => { const m = db.materials.find(x => x.id === id); if (m) m.status = 'rejected'; }); },
    async toggleLike(id, userId) { return withLock(db => { const m = db.materials.find(x => x.id === id); if (!m) return null; const i = m.likes.indexOf(userId); let liked; if (i >= 0) { m.likes.splice(i, 1); liked = false; } else { m.likes.push(userId); liked = true; } return { likesCount: m.likes.length, liked }; }); },
    async toggleFavorite(id, userId) { return withLock(db => { const m = db.materials.find(x => x.id === id); if (!m) return null; const i = m.favorites.indexOf(userId); let fav; if (i >= 0) { m.favorites.splice(i, 1); fav = false; } else { m.favorites.push(userId); fav = true; } return { favoritesCount: m.favorites.length, favorited: fav }; }); },
    async addComment(id, c) { return withLock(db => { const m = db.materials.find(x => x.id === id); if (!m) return null; const comment = { id: crypto.randomUUID(), userId: c.userId, userName: c.userName, content: c.content, createdAt: Date.now() }; m.comments = m.comments || []; m.comments.push(comment); return comment; }); },
    async listFavorites(userId) { const db = readDb(); const list = db.materials.filter(m => m.favorites.includes(userId) && m.status === 'approved').map(m => norm(m, userId, false)); list.sort((a, b) => (b.likesCount - a.likesCount) || (b.createdAt - a.createdAt)); return list; },
    async listMyMaterials(userId) { const db = readDb(); return db.materials.filter(m => m.authorId === userId).map(m => ({ id: m.id, title: m.title, intro: m.intro, status: m.status, createdAt: m.createdAt, likesCount: m.likes.length, commentsCount: (m.comments || []).length })).sort((a, b) => b.createdAt - a.createdAt); },
  };
}

/* ------------------------- Supabase 存储（云持久化） ------------------------- */
function supabaseStore(sb) {
  function normRow(m, opts) {
    return {
      id: m.id, title: m.title, intro: m.intro, content: m.content, source: m.source,
      authorId: m.author_id, authorName: m.author_name, authorRole: m.author_role,
      createdAt: m.created_at, approvedAt: m.approved_at, status: m.status,
      likesCount: m.likes_count || 0, favoritesCount: m.favorites_count || 0,
      liked: !!opts.liked, favorited: !!opts.favorited,
      commentsCount: m.comments_count || 0, comments: opts.comments,
    };
  }
  return {
    async findUserByUsername(u) { const { data } = await sb.from('users').select('*').eq('username', u).maybeSingle(); return data; },
    async createUser(o) { const { data, error } = await sb.from('users').insert({ username: o.username, password: o.password, role: o.role, display_name: o.displayName, created_at: Date.now() }).select().single(); if (error) throw error; return data; },
    async getUserById(id) { const { data } = await sb.from('users').select('*').eq('id', id).maybeSingle(); return data; },
    async countUsers() { const { count } = await sb.from('users').select('*', { count: 'exact', head: true }); return count || 0; },
    async createSession(token, userId) { const { error } = await sb.from('sessions').insert({ token, user_id: userId }); if (error) throw error; },
    async getUserIdByToken(token) { const { data } = await sb.from('sessions').select('user_id').eq('token', token).maybeSingle(); return data ? data.user_id : null; },
    async deleteSession(token) { await sb.from('sessions').delete().eq('token', token); },
    async createMaterial(o) { const { data, error } = await sb.from('materials').insert({ title: o.title, intro: o.intro, content: o.content, source: o.source, author_id: o.authorId, author_name: o.authorName, author_role: o.authorRole, status: 'pending', created_at: Date.now(), approved_at: null, likes_count: 0, favorites_count: 0, comments_count: 0 }).select().single(); if (error) throw error; return normRow(data, { comments: [] }); },
    async getMaterial(id, userId) {
      const { data: m } = await sb.from('materials').select('*').eq('id', id).maybeSingle();
      if (!m) return null;
      const { data: comments } = await sb.from('comments').select('*').eq('material_id', id).order('created_at', { ascending: true });
      let liked = false, favorited = false;
      if (userId) {
        const l = await sb.from('likes').select('user_id').eq('user_id', userId).eq('material_id', id).maybeSingle(); liked = !!l;
        const f = await sb.from('favorites').select('user_id').eq('user_id', userId).eq('material_id', id).maybeSingle(); favorited = !!f;
      }
      return normRow(m, { liked, favorited, comments: (comments || []).map(c => ({ id: c.id, userName: c.user_name, content: c.content, createdAt: c.created_at })) });
    },
    async listApproved(userId) {
      const { data: mats } = await sb.from('materials').select('*').eq('status', 'approved').order('likes_count', { ascending: false }).order('created_at', { ascending: false });
      const list = mats || [];
      let likedSet = new Set(), favSet = new Set();
      if (userId && list.length) {
        const ids = list.map(m => m.id);
        const { data: lk } = await sb.from('likes').select('material_id').eq('user_id', userId).in('material_id', ids);
        const { data: fv } = await sb.from('favorites').select('material_id').eq('user_id', userId).in('material_id', ids);
        likedSet = new Set((lk || []).map(r => r.material_id));
        favSet = new Set((fv || []).map(r => r.material_id));
      }
      return list.map(m => normRow(m, { liked: likedSet.has(m.id), favorited: favSet.has(m.id) }));
    },
    async listPending(userId) { const { data: mats } = await sb.from('materials').select('*').eq('status', 'pending').order('created_at', { ascending: false }); return (mats || []).map(m => normRow(m, { comments: [] })); },
    async approve(id) { const { error } = await sb.from('materials').update({ status: 'approved', approved_at: Date.now() }).eq('id', id); if (error) throw error; },
    async reject(id) { const { error } = await sb.from('materials').update({ status: 'rejected' }).eq('id', id); if (error) throw error; },
    async toggleLike(id, userId) {
      const mat = (await sb.from('materials').select('likes_count').eq('id', id).single()).data;
      const ex = (await sb.from('likes').select('user_id').eq('user_id', userId).eq('material_id', id).maybeSingle()).data;
      let liked, count = mat ? mat.likes_count : 0;
      if (ex) { await sb.from('likes').delete().eq('user_id', userId).eq('material_id', id); count -= 1; liked = false; }
      else { await sb.from('likes').insert({ user_id: userId, material_id: id }); count += 1; liked = true; }
      await sb.from('materials').update({ likes_count: count }).eq('id', id);
      return { likesCount: count, liked };
    },
    async toggleFavorite(id, userId) {
      const mat = (await sb.from('materials').select('favorites_count').eq('id', id).single()).data;
      const ex = (await sb.from('favorites').select('user_id').eq('user_id', userId).eq('material_id', id).maybeSingle()).data;
      let fav, count = mat ? mat.favorites_count : 0;
      if (ex) { await sb.from('favorites').delete().eq('user_id', userId).eq('material_id', id); count -= 1; fav = false; }
      else { await sb.from('favorites').insert({ user_id: userId, material_id: id }); count += 1; fav = true; }
      await sb.from('materials').update({ favorites_count: count }).eq('id', id);
      return { favoritesCount: count, favorited: fav };
    },
    async addComment(id, c) {
      const { data, error } = await sb.from('comments').insert({ material_id: id, user_id: c.userId, user_name: c.userName, content: c.content, created_at: Date.now() }).select().single();
      if (error) throw error;
      const mat = (await sb.from('materials').select('comments_count').eq('id', id).single()).data;
      await sb.from('materials').update({ comments_count: (mat ? mat.comments_count : 0) + 1 }).eq('id', id);
      return { id: data.id, userName: c.userName, content: c.content, createdAt: data.created_at };
    },
    async listFavorites(userId) {
      const { data: favs } = await sb.from('favorites').select('material_id').eq('user_id', userId);
      const ids = (favs || []).map(f => f.material_id);
      if (!ids.length) return [];
      const { data: mats } = await sb.from('materials').select('*').in('id', ids).eq('status', 'approved').order('likes_count', { ascending: false }).order('created_at', { ascending: false });
      return (mats || []).map(m => normRow(m, { favorited: true }));
    },
    async listMyMaterials(userId) {
      const { data: mats } = await sb.from('materials').select('*').eq('author_id', userId).order('created_at', { ascending: false });
      return (mats || []).map(m => ({ id: m.id, title: m.title, intro: m.intro, status: m.status, createdAt: m.created_at, likesCount: m.likes_count || 0, commentsCount: m.comments_count || 0 }));
    },
  };
}

/* ------------------------- 工具 ------------------------- */
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
  return undefined;
}
function publicUser(u) {
  return { id: u.id, username: u.username, displayName: u.display_name || u.displayName, role: u.role };
}
function getToken(req, parsed) {
  let t = req.headers['authorization'];
  if (t && t.startsWith('Bearer ')) return t.slice(7);
  if (parsed) return parsed.searchParams.get('token');
  return null;
}
async function getUserFromReq(req, parsed) {
  const t = getToken(req, parsed);
  if (!t) return null;
  const uid = await store.getUserIdByToken(t);
  if (!uid) return null;
  return await store.getUserById(uid);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

/* ------------------------- 路由 ------------------------- */
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }

route('POST', /^\/api\/register$/, async (req, res, body) => {
  const { username, password, role, displayName } = body;
  if (!username || !password) return send(res, 400, { error: '请输入用户名和密码' });
  if (!['teacher', 'student'].includes(role)) return send(res, 400, { error: '请选择身份（学生/教师）' });
  if (String(password).length < 6) return send(res, 400, { error: '密码至少 6 位' });
  if (await store.countUsers() >= MAX_USERS) return send(res, 400, { error: '用户数量已达上限（' + MAX_USERS + '）' });
  if (await store.findUserByUsername(username)) return send(res, 400, { error: '用户名已被占用' });
  const u = await store.createUser({ username, password: hashPassword(String(password)), role, displayName: displayName || username });
  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(token, u.id);
  send(res, 200, { token, user: publicUser(u) });
});

route('POST', /^\/api\/login$/, async (req, res, body) => {
  const { username, password } = body;
  const u = await store.findUserByUsername(username);
  if (!u || !verifyPassword(String(password || ''), u.password)) return send(res, 401, { error: '用户名或密码错误' });
  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(token, u.id);
  send(res, 200, { token, user: publicUser(u) });
});

route('POST', /^\/api\/logout$/, async (req, res, body, user, params, parsed) => {
  const token = getToken(req, parsed);
  if (token) await store.deleteSession(token);
  send(res, 200, { ok: true });
});

route('GET', /^\/api\/me$/, async (req, res, body, user) => {
  if (!user) return send(res, 401, { error: '未登录' });
  send(res, 200, { user: publicUser(user) });
});

route('POST', /^\/api\/materials$/, async (req, res, body, user) => {
  if (!user) return send(res, 401, { error: '请先登录' });
  const { title, intro, content, source } = body;
  if (!title || !intro || !content || !source) return send(res, 400, { error: '标题、简介、内容、来源均为必填' });
  const m = await store.createMaterial({
    title: String(title).trim(), intro: String(intro).trim(), content: String(content).trim(), source: String(source).trim(),
    authorId: user.id, authorName: user.displayName, authorRole: user.role,
  });
  send(res, 200, { ok: true, material: m });
});

route('GET', /^\/api\/materials$/, async (req, res, body, user) => {
  const list = await store.listApproved(user ? user.id : null);
  send(res, 200, { materials: list });
});

route('GET', /^\/api\/materials\/([\w-]+)$/, async (req, res, body, user, params) => {
  const m = await store.getMaterial(params[0], user ? user.id : null);
  if (!m) return send(res, 404, { error: '素材不存在' });
  if (m.status !== 'approved' && !(user && (user.id === m.authorId || user.role === 'teacher'))) return send(res, 403, { error: '该素材尚未通过审核' });
  send(res, 200, { material: m });
});

route('POST', /^\/api\/materials\/([\w-]+)\/approve$/, async (req, res, body, user, params) => {
  if (!user || user.role !== 'teacher') return send(res, 403, { error: '仅教师可审核' });
  await store.approve(params[0]);
  send(res, 200, { ok: true });
});

route('POST', /^\/api\/materials\/([\w-]+)\/reject$/, async (req, res, body, user, params) => {
  if (!user || user.role !== 'teacher') return send(res, 403, { error: '仅教师可审核' });
  await store.reject(params[0]);
  send(res, 200, { ok: true });
});

route('POST', /^\/api\/materials\/([\w-]+)\/like$/, async (req, res, body, user, params) => {
  if (!user) return send(res, 401, { error: '请先登录' });
  const r = await store.toggleLike(params[0], user.id);
  if (!r) return send(res, 404, { error: '素材不存在' });
  send(res, 200, r);
});

route('POST', /^\/api\/materials\/([\w-]+)\/favorite$/, async (req, res, body, user, params) => {
  if (!user) return send(res, 401, { error: '请先登录' });
  const r = await store.toggleFavorite(params[0], user.id);
  if (!r) return send(res, 404, { error: '素材不存在' });
  send(res, 200, r);
});

route('POST', /^\/api\/materials\/([\w-]+)\/comments$/, async (req, res, body, user, params) => {
  if (!user) return send(res, 401, { error: '请先登录' });
  const content = body && body.content ? String(body.content).trim() : '';
  if (!content) return send(res, 400, { error: '评论内容不能为空' });
  const c = await store.addComment(params[0], { userId: user.id, userName: user.displayName, content });
  if (!c) return send(res, 404, { error: '素材不存在' });
  send(res, 200, { comment: c });
});

route('GET', /^\/api\/me\/favorites$/, async (req, res, body, user) => {
  if (!user) return send(res, 401, { error: '请先登录' });
  const list = await store.listFavorites(user.id);
  send(res, 200, { materials: list });
});

route('GET', /^\/api\/me\/materials$/, async (req, res, body, user) => {
  if (!user) return send(res, 401, { error: '请先登录' });
  const list = await store.listMyMaterials(user.id);
  send(res, 200, { materials: list });
});

route('GET', /^\/api\/pending$/, async (req, res, body, user) => {
  if (!user || user.role !== 'teacher') return send(res, 403, { error: '仅教师可查看' });
  const list = await store.listPending(user.id);
  send(res, 200, { materials: list });
});

/* ------------------------- 请求分发 ------------------------- */
async function handleApi(req, res, parsed) {
  let body = {};
  try { if (req.method === 'POST' || req.method === 'PUT') body = await readBody(req); }
  catch (e) { return send(res, 400, { error: '请求体解析失败' }); }
  const user = await getUserFromReq(req, parsed);
  const pathname = parsed.pathname;
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.pattern);
    if (m) {
      try { await r.handler(req, res, body, user, m.slice(1), parsed); }
      catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: '服务器错误' }); }
      return;
    }
  }
  send(res, 404, { error: '接口不存在' });
}

/* ------------------------- 静态文件 ------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC, file));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (!path.extname(filePath)) {
        fs.readFile(path.join(PUBLIC, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(404); return res.end('Not Found'); }
          res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(d2);
        });
        return;
      }
      res.writeHead(404); return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ------------------------- 启动 ------------------------- */
const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (parsed.pathname.startsWith('/api/')) handleApi(req, res, parsed);
  else serveStatic(req, res, parsed.pathname);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`作文素材坊已启动： http://localhost:${PORT}（存储模式：${useSupabase ? 'Supabase 云数据库' : '本地文件'}）`);
});
