/* ====================================================
 * Constants + small utilities used everywhere.
 * Loaded first; everything else relies on it.
 * ==================================================== */

const DEFAULT_CLIENT_ID = '5b670fc5c4ec45e6bf988a07d8ab35c7';
// Always route Spotify auth through the hosted universal-callback page so the same
// redirect URI works regardless of how/where Songster itself is hosted (file://, GitHub
// Pages, localhost, …). The callback postMessages the result back to this popup's opener.
const UNIVERSAL_CALLBACK_URL = 'https://thorsten-klein.github.io/universal-callback/index.html';
const REDIRECT_URI = UNIVERSAL_CALLBACK_URL;
let CLIENT_ID = DEFAULT_CLIENT_ID;
const SCOPES = [
  'user-read-private',
  'playlist-read-private',
  'playlist-read-collaborative',
  'streaming',
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
].join(' ');


const LS_KEY_AUTH = 'songster.auth';
const LS_KEY_PLAYLISTS = 'songster.playlists';
const LS_KEY_SETTINGS = 'songster.settings';
const LS_KEY_LAST_CID = 'songster.last_cid';

/* ---------------- DOM helpers ---------------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
function show(el, on=true) { el.style.display = on ? '' : 'none'; }
function setScreen(name) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  window.scrollTo(0, 0);
}

/* ---------------- Misc utilities ---------------- */
function randStr(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => ('0' + b.toString(16)).slice(-2)).join('').slice(0, n);
}
async function sha256base64url(s) {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  let b = '';
  const arr = new Uint8Array(buf);
  for (let i = 0; i < arr.length; i++) b += String.fromCharCode(arr[i]);
  return btoa(b).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function getPlaylistId(url) {
  const m = url.match(/playlist[\/:]([a-zA-Z0-9]{22})/);
  return m ? m[1] : null;
}
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function fmtTime(ms) {
  if (!ms || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/* ---------------- Toast + confirm modal ---------------- */
function toast(msg, kind='ok') {
  const box = document.createElement('div');
  box.textContent = msg;
  box.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: ${kind==='err' ? '#c44' : '#222'}; color: #fff;
    padding: 10px 18px; border-radius: 6px; z-index: 200;
    box-shadow: 0 4px 16px rgba(0,0,0,.3); max-width: 90vw;
  `;
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2800);
}

function confirmModal({ title='Are you sure?', message='', okLabel='OK', cancelLabel='Cancel' } = {}) {
  return new Promise((resolve) => {
    const root = $('#modal-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-msg').textContent = message;
    $('#confirm-ok').textContent = okLabel;
    $('#confirm-cancel').textContent = cancelLabel;
    root.classList.add('active');
    const cleanup = (val) => {
      root.classList.remove('active');
      $('#confirm-ok').removeEventListener('click', onOk);
      $('#confirm-cancel').removeEventListener('click', onCancel);
      root.removeEventListener('click', onBg);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBg = (e) => { if (e.target === root) cleanup(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      else if (e.key === 'Enter') cleanup(true);
    };
    $('#confirm-ok').addEventListener('click', onOk);
    $('#confirm-cancel').addEventListener('click', onCancel);
    root.addEventListener('click', onBg);
    document.addEventListener('keydown', onKey);
    setTimeout(() => $('#confirm-ok').focus(), 0);
  });
}

/* ---------------- Shared helpers used across modules ---------------- */
function copyToClipboard(text, successMsg = 'Copied') {
  navigator.clipboard.writeText(text)
    .then(() => toast(successMsg))
    .catch(() => toast('Copy failed', 'err'));
}

// Wire a modal's backdrop so clicking outside the modal box closes it.
// Pass an optional fn to call instead of the default classList.remove('active').
function closeOnBackdrop(modalId, fn) {
  const el = document.getElementById(modalId);
  el.addEventListener('click', e => {
    if (e.target.id !== modalId) return;
    fn ? fn() : el.classList.remove('active');
  });
}

/* ---------------- Body scroll lock while a modal is open ---------------- */
function installModalScrollLock() {
  const sync = () => {
    const open = document.querySelector('.modal-bg.active');
    document.body.classList.toggle('modal-open', !!open);
  };
  const obs = new MutationObserver(sync);
  document.querySelectorAll('.modal-bg').forEach(el => {
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
  sync();
}

/* ---------------- Features template (auth screen + About modal) ---------------- */
function renderFeatures() {
  const tpl = $('#tpl-features');
  document.querySelectorAll('[data-features-host]').forEach(host => {
    host.replaceChildren(tpl.content.cloneNode(true));
  });
}

/* ---------------- Hardware back button (phone) ---------------- */
// Pattern: keep one extra history entry as a "trap". When the user presses
// the phone's hardware back button (or Esc / browser back), popstate fires and
// we close the top-most modal or fall back to clicking the current screen's
// back button. Then we re-push another trap entry so the next back press is
// also intercepted.

function getTopOpenModal() {
  const opens = document.querySelectorAll('.modal-bg.active');
  if (!opens.length) return null;
  // The details modal stacks above others (z-index 110); use computed z-index
  // to find the visually top-most modal.
  let topZ = -Infinity, top = opens[0];
  for (const el of opens) {
    const z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
    if (z >= topZ) { topZ = z; top = el; }
  }
  return top;
}

function handleHardwareBack() {
  const modal = getTopOpenModal();
  if (modal) {
    // Route the confirm modal through its cancel button so any awaiting promise resolves.
    if (modal.id === 'modal-confirm') {
      $('#confirm-cancel')?.click();
    } else {
      modal.classList.remove('active');
    }
    return;
  }
  const cur = document.querySelector('.screen.active')?.id;
  if (cur === 'screen-quiz')       $('#btn-back-quiz')?.click();
  else if (cur === 'screen-playlists') $('#btn-back-playlists')?.click();
  // On the auth screen there's nowhere to go back to in-app.
}

function installBackTrap() {
  window.addEventListener('popstate', () => {
    handleHardwareBack();
    // Re-seed the trap so the next back press is also captured.
    history.pushState({ trap: 1 }, '');
  });
  // Initial trap entry.
  history.pushState({ trap: 1 }, '');
}
