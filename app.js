'use strict';
/*
 * Private todo app for a static GitHub Pages site.
 *
 * Everything is encrypted in the browser with a key derived from your password
 * (PBKDF2-SHA256 -> AES-GCM-256). The encrypted file is stored in a GitHub repo
 * (ideally a separate *private* repo) through the GitHub API, using a
 * fine-grained token that is itself kept encrypted in this browser.
 * Nothing readable ever leaves the device.
 */

const ITER = 600000;
const COLORS = ['#ff6b8b', '#ff9f43', '#f7c948', '#2ecc8f', '#36c2e0', '#4d8dff', '#8c6cff', '#b4b4bb'];
const LS_CFG = 'tm.cfg';
const LS_CACHE = 'tm.cache';
const DEFAULTS = { owner: 'JiyunJang-24', repo: 'todo-data', path: 'todos.enc.json' };

/* ---------------- tiny helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}
function svg(markup, cls) {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24"${cls ? ` class="${cls}"` : ''}>${markup}</svg>`;
  return t.content.firstChild;
}
const ICON = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  dots: '<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  today: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
};

function pad(n) { return String(n).padStart(2, '0'); }
function dkey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return dkey(d); }
const todayKey = () => dkey(new Date());
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// IndexedDB keeps the (non-extractable) key when "remember on this device" is on.
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('todo-private', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('kv', mode);
      const q = fn(tx.objectStore('kv'));
      tx.oncomplete = () => { db.close(); resolve(q && q.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
const kv = {
  get: k => idb('readonly', s => s.get(k)).catch(() => null),
  set: (k, v) => idb('readwrite', s => s.put(v, k)).catch(() => {}),
  del: k => idb('readwrite', s => s.delete(k)).catch(() => {}),
};

/* ---------------- crypto ---------------- */
const te = new TextEncoder(), td = new TextDecoder();
function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
async function deriveKey(password, saltB64, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(value)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function unseal(key, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
  return JSON.parse(td.decode(pt));
}

/* ---------------- state ---------------- */
const S = {
  cfg: ls.get(LS_CFG),   // { owner, repo, path, salt, iter, tok: {iv, ct} }
  key: null,
  token: null,
  data: null,            // { v, cats: {id: cat}, todos: {id: todo} }
  sha: null,
  rev: 0,
  selected: todayKey(),
  month: null,           // 'YYYY-MM-01'
  weekMode: ls.get('tm.week') === true,
  adding: null,          // category id with open input
  editing: null,         // todo id being edited
  sync: { state: 'idle', msg: '' },
};
S.month = S.selected.slice(0, 8) + '01';

/* ---------------- data model ---------------- */
function emptyData() {
  const id = uid();
  return { v: 1, cats: { [id]: { id, name: '할 일', color: COLORS[0], order: 0, updatedAt: Date.now() } }, todos: {} };
}
// Last-writer-wins per item, so edits from several devices combine cleanly.
function merge(a, b) {
  const out = { v: 1, cats: {}, todos: {} };
  for (const k of ['cats', 'todos']) {
    const A = (a && a[k]) || {}, B = (b && b[k]) || {};
    for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) {
      const x = A[id], y = B[id];
      out[k][id] = !x ? y : !y ? x : ((y.updatedAt || 0) > (x.updatedAt || 0) ? y : x);
    }
  }
  return out;
}
function canon(d) {
  if (!d) return '';
  return JSON.stringify(['cats', 'todos'].map(k => Object.keys(d[k]).sort().map(id => [id, d[k][id].updatedAt])));
}
function touch(o) { o.updatedAt = Math.max(Date.now(), (o.updatedAt || 0) + 1); return o; }
const cats = () => Object.values(S.data.cats).filter(c => !c.deleted).sort((a, b) => a.order - b.order || a.updatedAt - b.updatedAt);
const todosOn = (date, catId) => Object.values(S.data.todos)
  .filter(t => !t.deleted && t.date === date && (!catId || t.cat === catId))
  .sort((a, b) => (a.order || 0) - (b.order || 0));
function liveCat(id) { const c = S.data.cats[id]; return c && !c.deleted ? c : null; }

function commit() {
  S.rev++;
  renderSoon();
  persistLocal();
  scheduleSync();
}

/* ---------------- local cache ---------------- */
let persistChain = Promise.resolve();
function persistLocal(dirty = true) {
  const snapshot = S.data, sha = S.sha, key = S.key;
  persistChain = persistChain.then(async () => {
    if (!key) return;
    ls.set(LS_CACHE, { sha, dirty, box: await seal(key, snapshot) });
  }).catch(console.error);
  return persistChain;
}

/* ---------------- GitHub ---------------- */
const gh = {
  async req(method, url, body, token = S.token) {
    let r;
    try {
      r = await fetch('https://api.github.com' + url, {
        method, cache: 'no-store',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const err = new Error('네트워크에 연결할 수 없어요'); err.status = 0; throw err;
    }
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.json()).message || ''; } catch {}
      const err = new Error(`GitHub ${r.status}${detail ? ': ' + detail : ''}`);
      err.status = r.status; throw err;
    }
    return r.status === 204 ? null : r.json();
  },
  contents(cfg) {
    return `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;
  },
  async getFile(cfg = S.cfg, token = S.token) {
    try {
      const j = await this.req('GET', this.contents(cfg), null, token);
      let content = j.content;
      if (!content) { // files over 1 MB come back without inline content
        const b = await this.req('GET', `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/git/blobs/${j.sha}`, null, token);
        content = b.content;
      }
      return { sha: j.sha, text: td.decode(unb64(content.replace(/\s/g, ''))) };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  },
  async putFile(text, sha, cfg = S.cfg, token = S.token) {
    const j = await this.req('PUT', this.contents(cfg), {
      message: 'update todos', content: b64(te.encode(text)), ...(sha ? { sha } : {}),
    }, token);
    return j.content.sha;
  },
};

function parseFile(text) {
  const f = JSON.parse(text);
  if (!f || f.v !== 1 || !f.kdf || !f.iv || !f.ct) throw new Error('알 수 없는 파일 형식이에요');
  return f;
}
async function encryptFile(data) {
  return JSON.stringify({ v: 1, kdf: { alg: 'PBKDF2-SHA256', salt: S.cfg.salt, iter: S.cfg.iter }, ...(await seal(S.key, data)) });
}

/* ---------------- sync ---------------- */
let syncTimer = null, syncing = false, syncAgain = false;
function scheduleSync(delay = 1200) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}
function setSync(state, msg = '') { S.sync = { state, msg }; const el = $('#sync'); if (el) el.replaceWith(syncBadge()); }

async function syncNow() {
  if (!S.token || !S.data) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  setSync('saving');
  const startRev = S.rev;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await gh.getFile();
      let remoteData = null;
      if (remote) {
        const f = parseFile(remote.text);
        if (f.kdf.salt !== S.cfg.salt) throw new Error('다른 기기에서 비밀번호가 바뀐 것 같아요. 설정에서 이 기기를 초기화한 뒤 새 비밀번호로 다시 연결해주세요.');
        remoteData = await unseal(S.key, f);
      }
      const merged = merge(S.data, remoteData);
      let sha = remote && remote.sha;
      if (!remote || canon(merged) !== canon(remoteData)) {
        try {
          sha = await gh.putFile(await encryptFile(merged), remote && remote.sha);
        } catch (e) {
          if (e.status === 409 || e.status === 422) continue; // someone else saved first: re-merge
          throw e;
        }
      }
      const before = canon(S.data);
      S.data = merge(S.data, merged); // keep edits made while we were waiting
      S.sha = sha;
      if (canon(S.data) !== before) render();
      await persistLocal(S.rev !== startRev);
      if (S.rev !== startRev) syncAgain = true;
      setSync('ok');
      return;
    }
    throw new Error('저장이 계속 충돌해요. 잠시 후 다시 시도할게요.');
  } catch (e) {
    console.error(e);
    if (e.status === 401 || e.status === 403) setSync('error', '토큰이 만료됐거나 권한이 없어요. 설정에서 토큰을 바꿔주세요.');
    else if (e.status === 0 || !navigator.onLine) setSync('offline', '오프라인이에요. 이 기기에 저장해두고 연결되면 올릴게요.');
    else setSync('error', e.message);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}
window.addEventListener('online', () => scheduleSync(200));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.token) scheduleSync(200); });

/* ---------------- unlock / setup ---------------- */
async function unlockWithKey(key) {
  const token = await unseal(key, S.cfg.tok); // throws on wrong password
  S.key = key; S.token = token;
  const cache = ls.get(LS_CACHE);
  S.data = null;
  if (cache && cache.box) {
    try { S.data = await unseal(key, cache.box); S.sha = cache.sha; } catch {}
  }
  if (!S.data) S.data = emptyData();
  render();
  syncNow();
}

async function tryAutoUnlock() {
  if (!S.cfg) return false;
  const key = await kv.get('key');
  if (!key) return false;
  try { await unlockWithKey(key); return true; } catch { await kv.del('key'); return false; }
}

function lock() {
  S.key = null; S.token = null; S.data = null; S.adding = S.editing = null;
  kv.del('key');
  closeSheet();
  render();
}

function resetDevice() {
  if (!confirm('이 기기에 저장된 연결 정보와 캐시를 지울까요?\nGitHub에 저장된 todo는 그대로 남아요.')) return;
  ls.del(LS_CFG); ls.del(LS_CACHE); kv.del('key');
  S.cfg = null; S.key = null; S.token = null; S.data = null;
  closeSheet();
  render();
}

/* ---------------- views: gate ---------------- */
function gateShell(title, lead, ...body) {
  return h('div', { class: 'gate' },
    h('div', { class: 'logo' }, svg(ICON.check)),
    h('h1', {}, title),
    h('p', { class: 'lead' }, lead),
    ...body);
}

function lockView() {
  const err = h('div', { class: 'err' });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: '비밀번호', autofocus: true });
  const remember = h('input', { type: 'checkbox' });
  const btn = h('button', { class: 'primary', type: 'submit' }, '열기');
  const form = h('form', {
    onsubmit: async e => {
      e.preventDefault();
      if (!pw.value) return;
      btn.disabled = true; btn.textContent = '여는 중…'; err.textContent = '';
      try {
        const key = await deriveKey(pw.value, S.cfg.salt, S.cfg.iter);
        await unlockWithKey(key);
        if (remember.checked) kv.set('key', key);
      } catch {
        err.textContent = '비밀번호가 맞지 않아요.';
        btn.disabled = false; btn.textContent = '열기';
        pw.select();
      }
    },
  },
    h('input', { type: 'text', autocomplete: 'username', value: 'todo', hidden: true, readonly: true }),
    h('label', { class: 'field' }, pw),
    h('label', { class: 'check-line' }, remember, '이 기기에서 잠금 해제 상태 유지'),
    err, btn);
  return gateShell('todo', '비밀번호를 입력하면 할 일이 보여요.', form,
    h('button', { class: 'ghost', onclick: resetDevice }, '이 기기 연결 초기화'));
}

function setupView() {
  const err = h('div', { class: 'err' });
  const owner = h('input', { class: 'input', value: DEFAULTS.owner, autocapitalize: 'off', spellcheck: false });
  const repo = h('input', { class: 'input', value: DEFAULTS.repo, autocapitalize: 'off', spellcheck: false });
  const token = h('input', { class: 'input', type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: false });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: '비밀번호' });
  const pw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: '비밀번호 확인' });
  const btn = h('button', { class: 'primary', type: 'submit' }, '시작하기');

  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    const cfg = { owner: owner.value.trim(), repo: repo.value.trim(), path: DEFAULTS.path, iter: ITER };
    const tok = token.value.trim();
    if (!cfg.owner || !cfg.repo || !tok) { err.textContent = '저장소와 토큰을 입력해주세요.'; return; }
    if (pw.value.length < 6) { err.textContent = '비밀번호는 6자 이상으로 해주세요.'; return; }
    btn.disabled = true; btn.textContent = '연결하는 중…';
    try {
      let info;
      try { info = await gh.req('GET', `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`, null, tok); }
      catch (e2) {
        if (e2.status === 404) throw new Error(`${cfg.owner}/${cfg.repo} 저장소를 찾을 수 없어요.\n저장소가 있는지, 토큰에 이 저장소 권한이 있는지 확인해주세요.`);
        if (e2.status === 401) throw new Error('토큰이 올바르지 않아요.');
        throw e2;
      }
      if (info.permissions && info.permissions.push === false) throw new Error('토큰에 쓰기 권한이 없어요. Contents: Read and write 로 만들어주세요.');
      const remote = await gh.getFile(cfg, tok);
      let key, data = null;
      if (remote) {
        const f = parseFile(remote.text);
        cfg.salt = f.kdf.salt; cfg.iter = f.kdf.iter || ITER;
        key = await deriveKey(pw.value, cfg.salt, cfg.iter);
        try { data = await unseal(key, f); }
        catch { throw new Error('이미 저장된 todo가 있는데, 비밀번호가 맞지 않아요.'); }
      } else {
        if (pw.value !== pw2.value) throw new Error('비밀번호 확인이 일치하지 않아요.');
        cfg.salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        key = await deriveKey(pw.value, cfg.salt, cfg.iter);
        data = emptyData();
      }
      cfg.tok = await seal(key, tok);
      ls.set(LS_CFG, cfg);
      S.cfg = cfg; S.key = key; S.token = tok; S.data = data; S.sha = remote ? remote.sha : null;
      await persistLocal(!remote);
      render();
      if (!remote) syncNow();
      if (info.private === false) toast('참고: 데이터 저장소가 공개 상태예요. 암호화돼 있지만 비공개 저장소를 추천해요.');
    } catch (e3) {
      err.textContent = e3.message;
      btn.disabled = false; btn.textContent = '시작하기';
    }
  }

  return gateShell('todo 시작하기', '처음 한 번만 이 기기를 연결하면 돼요.',
    h('form', { onsubmit: submit },
      h('div', { class: 'row2' },
        h('label', { class: 'field' }, h('span', {}, 'GitHub 계정'), owner),
        h('label', { class: 'field' }, h('span', {}, '데이터 저장소'), repo)),
      h('label', { class: 'field' }, h('span', {}, 'GitHub 토큰'), token,
        h('small', {}, '데이터 저장소 하나에만 Contents 읽기/쓰기 권한을 준 fine-grained 토큰을 넣어주세요. ',
          h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, '토큰 만들기'),
          ' · 토큰은 비밀번호로 암호화돼서 이 기기에만 저장돼요.')),
      h('label', { class: 'field' }, h('span', {}, '비밀번호'), pw),
      h('label', { class: 'field' }, pw2,
        h('small', {}, '처음 만들 때만 확인이 필요해요. 비밀번호를 잊으면 todo를 복구할 수 없어요.')),
      err, btn));
}

/* ---------------- views: main ---------------- */
function syncBadge() {
  const { state, msg } = S.sync;
  const label = { idle: '', saving: '저장 중', ok: '저장됨', offline: '오프라인', error: '오류' }[state] || '';
  return h('button', {
    id: 'sync', class: 'sync ' + state, title: msg || label,
    onclick: () => { if (msg) toast(msg); scheduleSync(0); },
  }, h('i'), label);
}

function topBar() {
  return h('div', { class: 'top' },
    h('div', { class: 'brand' }, 'todo', h('span', {}, 'mate')),
    h('div', { class: 'top-actions' },
      syncBadge(),
      h('button', { class: 'icon-btn', title: '설정', onclick: openSettings }, svg(ICON.gear)),
      h('button', { class: 'icon-btn', title: '잠그기', onclick: lock }, svg(ICON.lock))));
}

function dayStats(date) {
  const list = todosOn(date);
  const left = list.filter(t => !t.done).length;
  const color = list.length ? (liveCat(list[0].cat) || {}).color : null;
  return { total: list.length, left, color };
}

function calendar() {
  const m = parseKey(S.month);
  const sel = parseKey(S.selected);
  let cells = [];
  if (S.weekMode) {
    const start = new Date(sel); start.setDate(sel.getDate() - sel.getDay());
    for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(d); }
  } else {
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    const n = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
    for (let i = 0; i < n; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(d); }
  }
  const today = todayKey();
  const shown = S.weekMode ? sel : m;
  const shift = dir => {
    if (S.weekMode) { S.selected = addDays(S.selected, dir * 7); S.month = S.selected.slice(0, 8) + '01'; }
    else { const d = new Date(m.getFullYear(), m.getMonth() + dir, 1); S.month = dkey(d); }
    render();
  };
  return h('div', { class: 'cal' },
    h('div', { class: 'cal-head' },
      h('button', {
        class: 'cal-title', title: '주/월 보기 전환',
        onclick: () => { S.weekMode = !S.weekMode; ls.set('tm.week', S.weekMode); if (!S.weekMode) S.month = S.selected.slice(0, 8) + '01'; render(); },
      }, `${shown.getFullYear()}년 ${shown.getMonth() + 1}월`, h('small', {}, S.weekMode ? '주' : '월')),
      h('div', { class: 'cal-nav' },
        h('button', { class: 'icon-btn', title: '이전', onclick: () => shift(-1) }, svg(ICON.left)),
        h('button', { class: 'icon-btn', title: '다음', onclick: () => shift(1) }, svg(ICON.right)))),
    h('div', { class: 'week-row' }, WD.map(w => h('div', {}, w))),
    h('div', { class: 'days' }, cells.map(d => {
      const k = dkey(d);
      const st = dayStats(k);
      const allDone = st.total > 0 && st.left === 0;
      const stamp = h('div', { class: 'stamp', style: allDone ? `background:${st.color || COLORS[0]}` : '' },
        allDone ? svg(ICON.check) : st.left ? st.left : '');
      const cls = ['day', k === today && 'today', k === S.selected && 'sel',
        !S.weekMode && d.getMonth() !== m.getMonth() && 'out'].filter(Boolean).join(' ');
      return h('button', {
        class: cls,
        onclick: () => { S.selected = k; S.adding = S.editing = null; if (!S.weekMode && d.getMonth() !== m.getMonth()) S.month = k.slice(0, 8) + '01'; render(); },
      }, stamp, h('div', { class: 'dnum' }, d.getDate()));
    })));
}

function addTodo(catId, text) {
  text = text.trim();
  if (!text) return;
  const list = todosOn(S.selected, catId);
  const id = uid();
  S.data.todos[id] = touch({ id, cat: catId, date: S.selected, text, done: false, order: list.length ? Math.max(...list.map(t => t.order || 0)) + 1 : 0, createdAt: Date.now() });
  commit();
}
function updateTodo(id, patch) {
  const t = S.data.todos[id];
  if (!t) return;
  S.data.todos[id] = touch({ ...t, ...patch });
  commit();
}
function moveTodo(id, date) {
  const t = S.data.todos[id];
  const list = todosOn(date, t.cat);
  updateTodo(id, { date, order: list.length ? Math.max(...list.map(x => x.order || 0)) + 1 : 0 });
}

function todoItem(t, cat) {
  if (S.editing === t.id) {
    const input = h('input', { class: 'todo-input', value: t.text, enterkeyhint: 'done' });
    let finished = false;
    const finish = save => {
      if (finished) return; finished = true;
      S.editing = null;
      const v = input.value.trim();
      if (save && v && v !== t.text) updateTodo(t.id, { text: v }); else renderSoon();
    };
    input.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    return h('li', { class: 'todo' }, h('span', { class: 'check' }), input);
  }
  return h('li', { class: 'todo' + (t.done ? ' done' : '') },
    h('button', {
      class: 'check', title: t.done ? '완료 취소' : '완료',
      style: t.done ? `background:${cat.color}` : '',
      onclick: () => updateTodo(t.id, { done: !t.done }),
    }, svg(ICON.check)),
    h('div', { class: 'todo-text', onclick: () => { S.adding = null; S.editing = t.id; render(); } }, t.text),
    h('button', { class: 'more', title: '더보기', onclick: () => openTodoSheet(t) }, svg(ICON.dots)));
}

function addRow(cat) {
  const input = h('input', { class: 'todo-input', placeholder: '할 일 입력', enterkeyhint: 'enter' });
  let closed = false;
  input.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      const v = input.value;
      closed = true;
      if (v.trim()) addTodo(cat.id, v); // re-render keeps the input open for the next one
      else { S.adding = null; render(); }
    }
    if (e.key === 'Escape') { closed = true; S.adding = null; render(); }
  });
  input.addEventListener('blur', () => {
    if (closed) return;
    closed = true;
    S.adding = null;
    if (input.value.trim()) addTodo(cat.id, input.value); else renderSoon();
  });
  return h('li', { class: 'todo' }, h('span', { class: 'check' }), input);
}

function catSection(cat) {
  const list = todosOn(S.selected, cat.id);
  return h('section', { class: 'cat' },
    h('button', {
      class: 'cat-pill', style: `color:${cat.color}`,
      onclick: () => { S.adding = cat.id; S.editing = null; render(); },
    }, h('span', { style: 'color:var(--text)' }, cat.name), h('span', { class: 'plus' }, svg(ICON.plus))),
    h('ul', { class: 'todos' },
      list.map(t => todoItem(t, cat)),
      S.adding === cat.id ? addRow(cat) : null));
}

function mainView() {
  const d = parseKey(S.selected);
  const cs = cats();
  const isToday = S.selected === todayKey();
  return h('div', { class: 'app' },
    topBar(),
    calendar(),
    h('div', { class: 'date-title' },
      h('span', {}, `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일`),
      isToday ? null : h('button', {
        onclick: () => { S.selected = todayKey(); S.month = S.selected.slice(0, 8) + '01'; render(); },
      }, '오늘로')),
    cs.length ? cs.map(catSection)
      : h('div', { class: 'empty-cats' }, '설정에서 카테고리를 만들어주세요.'));
}

/* ---------------- sheets ---------------- */
function closeSheet() { $('#sheet-root').replaceChildren(); }
function openSheet(...content) {
  const overlay = h('div', { class: 'overlay', onclick: e => { if (e.target === overlay) closeSheet(); } },
    h('div', { class: 'sheet' }, h('div', { class: 'grip' }), ...content));
  $('#sheet-root').replaceChildren(overlay);
}
function sheetBtn(icon, label, onclick, cls = '') {
  return h('button', { class: 'sheet-btn ' + cls, onclick }, svg(icon), label);
}

function openTodoSheet(t) {
  const dateInput = h('input', { type: 'date', class: 'input', value: t.date });
  const cs = cats();
  openSheet(
    h('h3', {}, '할 일'),
    h('p', { class: 'sheet-sub' }, t.text),
    h('div', { class: 'sheet-btns' },
      sheetBtn(ICON.edit, '수정', () => { closeSheet(); S.editing = t.id; render(); }),
      t.date === todayKey()
        ? sheetBtn(ICON.arrow, '내일 하기', () => { closeSheet(); moveTodo(t.id, addDays(t.date, 1)); toast('내일로 옮겼어요'); })
        : sheetBtn(ICON.today, '오늘 하기', () => { closeSheet(); moveTodo(t.id, todayKey()); toast('오늘로 옮겼어요'); }),
      sheetBtn(ICON.trash, '삭제', () => { closeSheet(); updateTodo(t.id, { deleted: true }); toast('삭제했어요'); }, 'danger')),
    h('div', { class: 'sheet-section' },
      h('h4', {}, '날짜 바꾸기'),
      h('div', { class: 'cat-row' }, dateInput,
        h('button', {
          class: 'small-btn', onclick: () => {
            if (!dateInput.value || dateInput.value === t.date) return closeSheet();
            closeSheet(); moveTodo(t.id, dateInput.value); toast(`${dateInput.value}로 옮겼어요`);
          },
        }, '옮기기'))),
    cs.length > 1 ? h('div', { class: 'sheet-section' },
      h('h4', {}, '카테고리'),
      h('div', { class: 'swatches' }, cs.map(c => h('button', {
        class: 'small-btn', style: c.id === t.cat ? `border-color:${c.color};color:${c.color};font-weight:700` : '',
        onclick: () => { closeSheet(); if (c.id !== t.cat) updateTodo(t.id, { cat: c.id }); },
      }, c.name)))) : null);
}

function openSettings() {
  const list = h('div');
  const drawCats = () => {
    list.replaceChildren(...cats().map(c => {
      const name = h('input', { class: 'input', type: 'text', value: c.name });
      name.addEventListener('change', () => {
        const v = name.value.trim();
        if (v && v !== c.name) { S.data.cats[c.id] = touch({ ...S.data.cats[c.id], name: v }); commit(); }
      });
      return h('div', {},
        h('div', { class: 'cat-row' },
          h('span', { class: 'dot', style: `background:${c.color}` }), name,
          h('button', {
            class: 'small-btn danger', onclick: () => {
              const n = Object.values(S.data.todos).filter(t => !t.deleted && t.cat === c.id).length;
              if (!confirm(`'${c.name}' 카테고리를 삭제할까요?${n ? `\n이 카테고리의 할 일 ${n}개도 함께 삭제돼요.` : ''}`)) return;
              for (const t of Object.values(S.data.todos)) if (t.cat === c.id && !t.deleted) S.data.todos[t.id] = touch({ ...t, deleted: true });
              S.data.cats[c.id] = touch({ ...S.data.cats[c.id], deleted: true });
              commit(); drawCats();
            },
          }, '삭제')),
        h('div', { class: 'swatches' }, COLORS.map(col => h('button', {
          class: 'swatch' + (col === c.color ? ' on' : ''), style: `background:${col}`, title: col,
          onclick: () => { S.data.cats[c.id] = touch({ ...S.data.cats[c.id], color: col }); commit(); drawCats(); },
        }))));
    }));
  };
  drawCats();
  const newName = h('input', { class: 'input', type: 'text', placeholder: '새 카테고리 이름' });
  const addCat = () => {
    const v = newName.value.trim();
    if (!v) return;
    const id = uid();
    const all = Object.values(S.data.cats);
    S.data.cats[id] = touch({ id, name: v, color: COLORS[all.length % COLORS.length], order: all.length ? Math.max(...all.map(c => c.order || 0)) + 1 : 0 });
    newName.value = '';
    commit(); drawCats();
  };
  newName.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) addCat(); });

  openSheet(
    h('h3', {}, '설정'),
    h('div', { class: 'sheet-section', style: 'margin-top:0' }, h('h4', {}, '카테고리'), list,
      h('div', { class: 'cat-row' }, newName, h('button', { class: 'small-btn', onclick: addCat }, '추가'))),
    h('div', { class: 'sheet-section' }, h('h4', {}, '동기화'),
      h('div', { class: 'kv' },
        h('div', {}, '저장 위치 ', h('b', {}, `${S.cfg.owner}/${S.cfg.repo}/${S.cfg.path}`)),
        h('div', {}, '상태 ', h('b', {}, S.sync.msg || ({ ok: '저장됨', saving: '저장 중', idle: '대기', offline: '오프라인', error: '오류' }[S.sync.state])))),
      h('div', { class: 'cat-row', style: 'margin-top:8px' },
        h('button', { class: 'small-btn', onclick: () => { scheduleSync(0); closeSheet(); } }, '지금 동기화'),
        h('button', { class: 'small-btn', onclick: changeToken }, '토큰 바꾸기'))),
    h('div', { class: 'sheet-section' }, h('h4', {}, '이 기기'),
      h('div', { class: 'cat-row' },
        h('button', { class: 'small-btn', onclick: lock }, '잠그기'),
        h('button', { class: 'small-btn danger', onclick: resetDevice }, '이 기기 연결 초기화'))));
}

async function changeToken() {
  const tok = prompt('새 GitHub 토큰을 붙여넣어주세요');
  if (!tok || !tok.trim()) return;
  S.cfg.tok = await seal(S.key, tok.trim());
  ls.set(LS_CFG, S.cfg);
  S.token = tok.trim();
  closeSheet();
  toast('토큰을 바꿨어요');
  scheduleSync(0);
}

let toastTimer = null;
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}

/* ---------------- render ---------------- */
function render() {
  pendingRender = false;
  const root = $('#app');
  const scroll = window.scrollY;
  root.replaceChildren(!S.cfg ? setupView() : !S.data ? lockView() : mainView());
  window.scrollTo(0, scroll);
  // Focus synchronously so mobile keyboards stay open between entries.
  const f = S.data ? $('.todo-input', root) : $('input:not([hidden])', root);
  if (f) { f.focus(); if (S.editing) f.setSelectionRange(f.value.length, f.value.length); }
}

// Re-rendering while a finger/mouse is down would swallow the tap (e.g. tapping a
// checkbox while an input is open blurs it first), so wait until the tap lands.
let pointerDown = false, pendingRender = false;
function renderSoon() {
  if (pointerDown) pendingRender = true;
  else render();
}
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
for (const ev of ['pointerup', 'pointercancel']) {
  document.addEventListener(ev, () => {
    pointerDown = false;
    if (pendingRender) setTimeout(() => { if (pendingRender) render(); }, 0);
  }, true);
}

(async function boot() {
  if (!window.crypto || !crypto.subtle) {
    $('#app').replaceChildren(h('div', { class: 'gate' }, h('h1', {}, '이 브라우저는 지원하지 않아요'), h('p', { class: 'lead' }, 'HTTPS 주소로 접속해주세요.')));
    return;
  }
  if (!(await tryAutoUnlock())) render();
})();
