'use strict';

/* ============================ 状态 ============================ */
const state = { token: null, user: null, view: 'home' };
const modalRoot = document.getElementById('modal-root');

/* ============================ 工具 ============================ */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function fmtDate(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 1800);
}
async function api(path, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : null });
  let data = {};
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) throw new Error(data.error || ('请求失败 ' + res.status));
  return data;
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
      <div class="mat-row-content">${esc(m.content)}</div>
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

/* ============================ 数据加载 ============================ */
async function loadHome() {
  const box = document.getElementById('cards');
  try {
    const d = await api('/api/materials');
    box.innerHTML = d.materials.length
      ? d.materials.map(cardHTML).join('')
      : '<p class="empty">还没有已通过的素材，快去发布并等待教师审核吧～</p>';
  } catch (e) { toast(e.message); }
}
async function loadMy() {
  try {
    const fav = await api('/api/me/favorites');
    const mine = await api('/api/me/materials');
    document.getElementById('my-fav').innerHTML = fav.materials.length
      ? fav.materials.map(cardHTML).join('')
      : '<p class="empty">你还没有收藏任何素材</p>';
    document.getElementById('my-mat').innerHTML = mine.materials.length
      ? mine.materials.map(myMatHTML).join('')
      : '<p class="empty">你还没有发布过素材</p>';
  } catch (e) { toast(e.message); }
}
async function loadReview() {
  try {
    const d = await api('/api/pending');
    document.getElementById('review-list').innerHTML = d.materials.length
      ? d.materials.map(reviewHTML).join('')
      : '<p class="empty">太棒了，暂无待审核素材</p>';
  } catch (e) { toast(e.message); }
}

/* ============================ 交互 ============================ */
async function toggleLike(id) {
  try {
    const d = await api('/api/materials/' + id + '/like', 'POST');
    const card = document.querySelector(`.card[data-id="${id}"]`);
    if (card) {
      const b = card.querySelector('.like');
      b.classList.toggle('on', d.liked);
      b.querySelector('span').textContent = d.likesCount;
    }
    toast(d.liked ? '已点赞' : '已取消点赞');
  } catch (e) { toast(e.message); }
}
async function toggleFav(id) {
  try {
    const d = await api('/api/materials/' + id + '/favorite', 'POST');
    const card = document.querySelector(`.card[data-id="${id}"]`);
    if (card) {
      const b = card.querySelector('.fav');
      b.classList.toggle('on', d.favorited);
      b.querySelector('span').textContent = d.favoritesCount;
    }
    toast(d.favorited ? '已收藏' : '已取消收藏');
  } catch (e) { toast(e.message); }
}
async function openDetail(id) {
  try {
    const d = await api('/api/materials/' + id);
    const m = d.material;
    const html = `<div class="modal-back" data-close="1">
      <div class="modal detail">
        <button class="modal-x" data-close="1">×</button>
        <div class="detail-head">
          <h2>${esc(m.title)}</h2>
          ${m.authorRole === 'teacher' ? '<span class="badge teacher">教师发布</span>' : ''}
        </div>
        <div class="detail-meta">✍️ ${esc(m.authorName)} · 📅 ${fmtDate(m.createdAt)} · 来源：${esc(m.source)}</div>
        <div class="detail-content">${esc(m.content)}</div>
        <div class="detail-actions">
          <button class="act like ${m.liked ? 'on' : ''}" data-dact="like">❤️ <span>${m.likesCount}</span></button>
          <button class="act fav ${m.favorited ? 'on' : ''}" data-dact="fav">⭐ <span>${m.favoritesCount}</span></button>
        </div>
        <h4>评论 (${m.commentsCount})</h4>
        <div class="comments">${m.comments.map(c => `<div class="comment"><b>${esc(c.userName)}</b><span class="ctime">${fmtDate(c.createdAt)}</span><p>${esc(c.content)}</p></div>`).join('') || '<p class="empty">暂无评论</p>'}</div>
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
      try { await api('/api/materials/' + id + '/comments', 'POST', { content: f.content.value }); openDetail(id); }
      catch (err) { toast(err.message); }
    });
    modalRoot.querySelectorAll('[data-dact]').forEach(b => b.addEventListener('click', async () => {
      const ep = b.dataset.dact === 'like' ? '/like' : '/favorite';
      try { await api('/api/materials/' + id + ep, 'POST'); openDetail(id); }
      catch (err) { toast(err.message); }
    }));
  } catch (e) { toast(e.message); }
}
function openPublish() {
  const html = `<div class="modal-back" data-close="1"><div class="modal">
    <button class="modal-x" data-close="1">×</button>
    <h2>发布作文素材</h2>
    <p class="sub">提交后由教师审核，通过后将展示在网站主页</p>
    <form id="publish-form" class="form">
      <label>标题 *<input name="title" maxlength="60" required></label>
      <label>简介 *<textarea name="intro" maxlength="120" rows="2" required></textarea></label>
      <label>内容 *<textarea name="content" rows="6" required></textarea></label>
      <label>来源 *<input name="source" maxlength="60" required></label>
      <button type="submit">提交审核</button>
    </form>
  </div></div>`;
  showModal(html);
  document.getElementById('publish-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/materials', 'POST', {
        title: f.title.value, intro: f.intro.value, content: f.content.value, source: f.source.value,
      });
      modalRoot.innerHTML = '';
      toast('已提交，等待教师审核');
      if (state.view === 'my') loadMy();
    } catch (err) { toast(err.message); }
  });
}
async function approve(id) { try { await api('/api/materials/' + id + '/approve', 'POST'); toast('已通过审核'); loadReview(); } catch (e) { toast(e.message); } }
async function reject(id) { try { await api('/api/materials/' + id + '/reject', 'POST'); toast('已驳回'); loadReview(); } catch (e) { toast(e.message); } }

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

/* 登录 / 注册 / 退出 */
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const d = await api('/api/login', 'POST', { username: f.username.value, password: f.password.value });
    state.token = d.token; localStorage.setItem('wmh_token', d.token); state.user = d.user;
    afterLogin();
  } catch (err) { toast(err.message); }
});
document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const d = await api('/api/register', 'POST', {
      username: f.username.value, password: f.password.value,
      role: f.role.value, displayName: f.displayName.value,
    });
    state.token = d.token; localStorage.setItem('wmh_token', d.token); state.user = d.user;
    toast('注册成功，已自动登录');
    afterLogin();
  } catch (err) { toast(err.message); }
});
document.getElementById('btn-publish').addEventListener('click', openPublish);
document.getElementById('btn-logout').addEventListener('click', async () => {
  try { await api('/api/logout', 'POST'); } catch (e) { /* ignore */ }
  state.token = null; state.user = null; localStorage.removeItem('wmh_token');
  location.reload();
});

/* ============================ 初始化 ============================ */
async function init() {
  state.token = localStorage.getItem('wmh_token');
  if (state.token) {
    try { const d = await api('/api/me'); state.user = d.user; } catch (e) {
      state.token = null; localStorage.removeItem('wmh_token');
    }
  }
  if (state.user) afterLogin();
  else document.getElementById('auth').hidden = false;
}
init();
