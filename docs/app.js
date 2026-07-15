'use strict';

/* ============================ Supabase 客户端 ============================ */
const EMAIL_DOMAIN = '@caizuo.app';           // 用户名映射为伪邮箱，登录用
let sb = null;

function initClient() {
  const c = window.APP_CONFIG || {};
  const bad = !c.SUPABASE_URL || !c.SUPABASE_ANON_KEY || /填入/.test(c.SUPABASE_URL) || /填入/.test(c.SUPABASE_ANON_KEY);
  if (bad) {
    const warn = document.getElementById('config-warn');
    warn.hidden = false;
    warn.innerHTML = `<div class="box">
      <h2>还差最后一步：填写 Supabase 配置</h2>
      <p>请打开项目里的 <code>docs/config.js</code>，把你的 <code>SUPABASE_URL</code> 和
      <code>SUPABASE_ANON_KEY</code>（anon public 公钥）填进去，保存后重新部署即可。</p>
      <p>这两个值在 Supabase 控制台 → <b>Project Settings → API</b> 里。</p>
    </div>`;
    return false;
  }
  sb = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
  return true;
}

function toEmail(username) { return String(username).trim().toLowerCase() + EMAIL_DOMAIN; }

/* ============================ 状态 ============================ */
const state = { user: null, view: 'home' };
const modalRoot = document.getElementById('modal-root');

/* ============================ 工具 ============================ */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
// 转义后再把「字面 \n」和真实换行都变成真实换行（配合 CSS 的 white-space: pre-wrap 渲染）
function escNL(s) {
  return esc(s).replace(/\\r\\n|\\n|\r\n|\n/g, '\n');
}
function fmtDate(ts) {
  const d = new Date(Number(ts));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2000);
}
// 把数据库的 snake_case 字段映射为渲染函数需要的 camelCase
function mapMaterial(m) {
  return Object.assign(m, {
    authorName: m.author_name,
    authorRole: m.author_role,
    createdAt: m.created_at,
    likesCount: m.likes_count,
    favoritesCount: m.favorites_count,
    commentsCount: m.comments_count,
  });
}

/* ============================ 渲染片段 ============================ */
function cardHTML(m) {
  const teacherBadge = m.authorRole === 'teacher' ? '<span class="badge teacher">教师发布</span>' : '';
  return `<article class="card" data-id="${m.id}">
    <div class="card-top">${teacherBadge}</div>
    <h3 class="card-title">${esc(m.title)}</h3>
    <p class="card-intro">${esc(m.intro)}</p>
    <div class="card-meta">
      <span>✍️ ${esc(m.authorName)}</span>
      <span>📅 ${fmtDate(m.createdAt)}</span>
    </div>
    <div class="card-actions">
      <button class="act like ${m.liked ? 'on' : ''}" data-act="like">❤️ <span>${m.likesCount}</span></button>
      <button class="act fav ${m.favorited ? 'on' : ''}" data-act="fav">⭐ <span>${m.favoritesCount}</span></button>
      <button class="act cmt" data-act="open">💬 <span>${m.commentsCount}</span></button>
    </div>
  </article>`;
}
function myMatHTML(m) {
  const map = { pending: '待审核', approved: '已通过', rejected: '未通过' };
  const cls = { pending: 'badge pending', approved: 'badge ok', rejected: 'badge no' }[m.status];
  return `<div class="mat-row" data-id="${m.id}">
    <div class="mat-row-main">
      <div class="mat-row-title">${esc(m.title)}</div>
      <div class="mat-row-sub">${esc(m.intro)}</div>
    </div>
    <div class="mat-row-side">
      <span class="${cls}">${map[m.status]}</span>
      <span class="mini">❤️ ${m.likesCount}</span>
      <span class="mini">💬 ${m.commentsCount}</span>
    </div>
  </div>`;
}
function reviewHTML(m) {
  return `<div class="mat-row review" data-id="${m.id}">
    <div class="mat-row-main">
      <div class="mat-row-title">${esc(m.title)}
        <span class="badge ${m.authorRole === 'teacher' ? 'teacher' : ''}">${m.authorRole === 'teacher' ? '教师' : '学生'}</span>
      </div>
      <div class="mat-row-sub">${esc(m.intro)}</div>
      <div class="mat-row-content">${escNL(m.content)}</div>
      <div class="mat-row-src">来源：${esc(m.source)} · ${esc(m.authorName)} · ${fmtDate(m.createdAt)}</div>
    </div>
    <div class="mat-row-side">
      <button data-act="approve">通过</button>
      <button data-act="reject" class="ghost">驳回</button>
    </div>
  </div>`;
}

/* ============================ 视图切换 ============================ */
function showView() {
  document.querySelectorAll('.view').forEach(v => v.hidden = true);
  document.getElementById('view-' + state.view).hidden = false;
  document.querySelectorAll('#nav nav a').forEach(a => a.classList.toggle('active', a.dataset.view === state.view));
}
function afterLogin() {
  document.getElementById('auth').hidden = true;
  document.getElementById('nav').hidden = false;
  document.getElementById('app-main').hidden = false;
  const u = state.user;
  document.getElementById('nav-user').textContent = `${u.displayName}（${u.role === 'teacher' ? '教师' : '学生'}）`;
  document.getElementById('nav-review').hidden = u.role !== 'teacher';
  state.view = 'home';
  showView();
  loadHome();
}

/* ============================ 我的点赞/收藏标记 ============================ */
async function markMine(mats) {
  if (!mats || !mats.length) return mats;
  const uid = state.user.id;
  const [{ data: likes }, { data: favs }] = await Promise.all([
    sb.from('likes').select('material_id').eq('user_id', uid),
    sb.from('favorites').select('material_id').eq('user_id', uid),
  ]);
  const L = new Set((likes || []).map(x => x.material_id));
  const F = new Set((favs || []).map(x => x.material_id));
  mats.forEach(m => { mapMaterial(m); m.liked = L.has(m.id); m.favorited = F.has(m.id); });
  return mats;
}

/* ============================ 数据加载 ============================ */
async function loadHome() {
  const box = document.getElementById('cards');
  const { data, error } = await sb.from('materials').select('*')
    .eq('status', 'approved')
    .order('likes_count', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) { toast(error.message); return; }
  await markMine(data);
  box.innerHTML = data.length
    ? data.map(cardHTML).join('')
    : '<p class="empty">还没有已通过的素材，快去发布并等待教师审核吧～</p>';
}
async function loadMy() {
  const uid = state.user.id;
  // 我收藏的
  const { data: favRows } = await sb.from('favorites').select('material_id').eq('user_id', uid);
  const favIds = (favRows || []).map(x => x.material_id);
  let favMats = [];
  if (favIds.length) {
    const { data } = await sb.from('materials').select('*').in('id', favIds);
    favMats = data || [];
    await markMine(favMats);
  }
  document.getElementById('my-fav').innerHTML = favMats.length
    ? favMats.map(cardHTML).join('')
    : '<p class="empty">你还没有收藏任何素材</p>';
  // 我发布的
  const { data: mine } = await sb.from('materials').select('*')
    .eq('author_id', uid).order('created_at', { ascending: false });
  (mine || []).forEach(mapMaterial);
  document.getElementById('my-mat').innerHTML = (mine && mine.length)
    ? mine.map(myMatHTML).join('')
    : '<p class="empty">你还没有发布过素材</p>';
}
async function loadReview() {
  const { data, error } = await sb.from('materials').select('*')
    .eq('status', 'pending').order('created_at', { ascending: true });
  if (error) { toast(error.message); return; }
  (data || []).forEach(mapMaterial);
  document.getElementById('review-list').innerHTML = (data && data.length)
    ? data.map(reviewHTML).join('')
    : '<p class="empty">太棒了，暂无待审核素材</p>';
}

/* ============================ 交互 ============================ */
async function toggleLike(id) {
  const uid = state.user.id;
  const { data: ex } = await sb.from('likes').select('material_id').eq('user_id', uid).eq('material_id', id).maybeSingle();
  let liked;
  if (ex) { await sb.from('likes').delete().eq('user_id', uid).eq('material_id', id); liked = false; }
  else { await sb.from('likes').insert({ user_id: uid, material_id: id }); liked = true; }
  const { data: m } = await sb.from('materials').select('likes_count').eq('id', id).single();
  document.querySelectorAll(`.card[data-id="${id}"] .like`).forEach(b => {
    b.classList.toggle('on', liked);
    b.querySelector('span').textContent = m ? m.likes_count : 0;
  });
  toast(liked ? '已点赞' : '已取消点赞');
}
async function toggleFav(id) {
  const uid = state.user.id;
  const { data: ex } = await sb.from('favorites').select('material_id').eq('user_id', uid).eq('material_id', id).maybeSingle();
  let fav;
  if (ex) { await sb.from('favorites').delete().eq('user_id', uid).eq('material_id', id); fav = false; }
  else { await sb.from('favorites').insert({ user_id: uid, material_id: id }); fav = true; }
  const { data: m } = await sb.from('materials').select('favorites_count').eq('id', id).single();
  document.querySelectorAll(`.card[data-id="${id}"] .fav`).forEach(b => {
    b.classList.toggle('on', fav);
    b.querySelector('span').textContent = m ? m.favorites_count : 0;
  });
  toast(fav ? '已收藏' : '已取消收藏');
}
async function openDetail(id) {
  const uid = state.user.id;
  const [{ data: m }, { data: comments }, { data: lk }, { data: fv }] = await Promise.all([
    sb.from('materials').select('*').eq('id', id).single(),
    sb.from('comments').select('*').eq('material_id', id).order('created_at', { ascending: true }),
    sb.from('likes').select('material_id').eq('user_id', uid).eq('material_id', id).maybeSingle(),
    sb.from('favorites').select('material_id').eq('user_id', uid).eq('material_id', id).maybeSingle(),
  ]);
  if (!m) { toast('素材不存在'); return; }
  mapMaterial(m);
  m.liked = !!lk; m.favorited = !!fv;
  const cs = comments || [];
  const html = `<div class="modal-back" data-close="1">
    <div class="modal detail">
      <button class="modal-x" data-close="1">×</button>
      <div class="detail-head">
        <h2>${esc(m.title)}</h2>
        ${m.authorRole === 'teacher' ? '<span class="badge teacher">教师发布</span>' : ''}
      </div>
      <div class="detail-meta">✍️ ${esc(m.authorName)} · 📅 ${fmtDate(m.createdAt)} · 来源：${esc(m.source)}</div>
      <div class="detail-content">${escNL(m.content)}</div>
      <div class="detail-actions">
        <button class="act like ${m.liked ? 'on' : ''}" data-dact="like">❤️ <span>${m.likesCount}</span></button>
        <button class="act fav ${m.favorited ? 'on' : ''}" data-dact="fav">⭐ <span>${m.favoritesCount}</span></button>
      </div>
      <h4>评论 (${m.commentsCount})</h4>
      <div class="comments">${cs.map(c => `<div class="comment"><b>${esc(c.user_name)}</b><span class="ctime">${fmtDate(c.created_at)}</span><p>${esc(c.content)}</p></div>`).join('') || '<p class="empty">暂无评论</p>'}</div>
      <form id="comment-form">
        <input name="content" placeholder="写下你的评论…" maxlength="500" autocomplete="off">
        <button type="submit">发送</button>
      </form>
    </div>
  </div>`;
  showModal(html);
  document.getElementById('comment-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const content = f.content.value.trim();
    if (!content) return;
    const { error } = await sb.from('comments').insert({
      material_id: id, user_id: uid, user_name: state.user.displayName, content, created_at: Date.now(),
    });
    if (error) { toast(error.message); return; }
    openDetail(id);
  });
  modalRoot.querySelectorAll('[data-dact]').forEach(b => b.addEventListener('click', async () => {
    if (b.dataset.dact === 'like') await toggleLike(id); else await toggleFav(id);
    openDetail(id);
    if (state.view === 'home') loadHome();
  }));
}
function openPublish() {
  const html = `<div class="modal-back" data-close="1"><div class="modal">
    <button class="modal-x" data-close="1">×</button>
    <h2>发布作文素材</h2>
    <p class="sub">${state.user.role === 'teacher' ? '教师发布将直接展示在主页' : '提交后由教师审核，通过后将展示在网站主页'}</p>
    <form id="publish-form" class="form">
      <label>标题 *<input name="title" maxlength="60" required></label>
      <label>简介 *<textarea name="intro" maxlength="120" rows="2" required></textarea></label>
      <label>内容 *<textarea name="content" rows="6" required></textarea></label>
      <label>来源 *<input name="source" maxlength="60" required></label>
      <button type="submit">${state.user.role === 'teacher' ? '发布' : '提交审核'}</button>
    </form>
  </div></div>`;
  showModal(html);
  document.getElementById('publish-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const isTeacher = state.user.role === 'teacher';
    const now = Date.now();
    const { error } = await sb.from('materials').insert({
      title: f.title.value.trim(),
      intro: f.intro.value.trim(),
      content: f.content.value.trim(),
      source: f.source.value.trim(),
      author_id: state.user.id,
      author_name: state.user.displayName,
      author_role: state.user.role,
      status: isTeacher ? 'approved' : 'pending',
      created_at: now,
      approved_at: isTeacher ? now : null,
    });
    if (error) { toast(error.message); return; }
    modalRoot.innerHTML = '';
    toast(isTeacher ? '已发布' : '已提交，等待教师审核');
    if (state.view === 'my') loadMy();
    else if (state.view === 'home' && isTeacher) loadHome();
  });
}
async function approve(id) {
  const { error } = await sb.from('materials').update({ status: 'approved', approved_at: Date.now() }).eq('id', id);
  if (error) { toast(error.message); return; }
  toast('已通过审核'); loadReview();
}
async function reject(id) {
  const { error } = await sb.from('materials').update({ status: 'rejected' }).eq('id', id);
  if (error) { toast(error.message); return; }
  toast('已驳回'); loadReview();
}

function showModal(html) {
  modalRoot.innerHTML = html;
  modalRoot.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', ev => {
    if (ev.target === el) modalRoot.innerHTML = '';
  }));
}

/* ============================ 全局事件 ============================ */
document.addEventListener('click', e => {
  if (e.target.closest('#modal-root')) return;

  const tab = e.target.closest('.tab');
  if (tab) {
    const t = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
    document.getElementById('login-form').hidden = t !== 'login';
    document.getElementById('register-form').hidden = t !== 'register';
    return;
  }

  const pub = e.target.closest('[data-action="publish"]');
  if (pub) { openPublish(); return; }

  const navlink = e.target.closest('[data-view]');
  if (navlink) {
    state.view = navlink.dataset.view;
    showView();
    if (state.view === 'home') loadHome();
    else if (state.view === 'my') loadMy();
    else if (state.view === 'review') loadReview();
    return;
  }

  const card = e.target.closest('.card');
  if (card) {
    const id = card.dataset.id;
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      const act = actBtn.dataset.act;
      if (act === 'like') toggleLike(id);
      else if (act === 'fav') toggleFav(id);
      else if (act === 'open') openDetail(id);
      return;
    }
    openDetail(id);
    return;
  }

  const row = e.target.closest('.mat-row');
  if (row) {
    const id = row.dataset.id;
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      const act = actBtn.dataset.act;
      if (act === 'approve') approve(id);
      else if (act === 'reject') reject(id);
      return;
    }
    if (row.classList.contains('review')) return;
    openDetail(id);
    return;
  }
});

/* ============================ 登录 / 注册 / 退出 ============================ */
async function loadProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;
  const { data: prof, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (error || !prof) return false;
  state.user = { id: user.id, username: prof.username, displayName: prof.name, role: prof.role };
  return true;
}

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const { error } = await sb.auth.signInWithPassword({ email: toEmail(f.username.value), password: f.password.value });
  if (error) { toast('用户名或密码错误'); return; }
  if (await loadProfile()) afterLogin();
  else toast('登录成功但读取资料失败，请刷新重试');
});

document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const username = f.username.value.trim().toLowerCase();
  const password = f.password.value;
  const displayName = (f.displayName.value || username).trim();
  if (password.length < 6) { toast('密码至少 6 位'); return; }
  // 1) 注册 Auth 账号
  const { data: su, error: e1 } = await sb.auth.signUp({ email: toEmail(username), password });
  if (e1) {
    toast(/registered|exists/i.test(e1.message) ? '该用户名已被注册' : ('注册失败：' + e1.message));
    return;
  }
  // 2) 确保有会话（若关闭了邮箱验证，signUp 通常直接返回会话）
  if (!su.session) {
    const { error: e2 } = await sb.auth.signInWithPassword({ email: toEmail(username), password });
    if (e2) { toast('注册成功，请用刚才的账号手动登录'); return; }
  }
  // 3) 写入个人资料（role 由 RLS 强制为 student）
  const { data: { user } } = await sb.auth.getUser();
  const { error: e3 } = await sb.from('profiles').insert({ id: user.id, username, name: displayName, role: 'student' });
  if (e3 && !/duplicate|已达上限/.test(e3.message)) {
    if (/上限/.test(e3.message)) { toast('注册人数已达上限（100 人）'); return; }
    toast('资料创建失败：' + e3.message); return;
  }
  toast('注册成功，已自动登录');
  if (await loadProfile()) afterLogin();
});

document.getElementById('btn-publish').addEventListener('click', openPublish);
document.getElementById('btn-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

/* ============================ 初始化 ============================ */
async function init() {
  if (!initClient()) return;
  const { data: { session } } = await sb.auth.getSession();
  if (session && await loadProfile()) afterLogin();
  else document.getElementById('auth').hidden = false;
}
init();
