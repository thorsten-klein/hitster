/* ====================================================
 * Spotify auth — PKCE flow via popup + universal-callback.
 * ==================================================== */

let auth = null; // { access_token, refresh_token, expires_at, ... }

function loadAuth() {
  try {
    const raw = localStorage.getItem(LS_KEY_AUTH);
    if (!raw) return null;
    const a = JSON.parse(raw);
    if (!a.access_token) return null;
    return a;
  } catch { return null; }
}
function saveAuth(a) {
  if (a) localStorage.setItem(LS_KEY_AUTH, JSON.stringify(a));
  else   localStorage.removeItem(LS_KEY_AUTH);
  auth = a;
}
function isAuthValid() {
  return auth && auth.access_token && Date.now() < (auth.expires_at - 30_000);
}

async function ensureAccessToken() {
  if (isAuthValid()) return auth.access_token;
  if (auth && auth.refresh_token) {
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: auth.refresh_token,
        client_id: CLIENT_ID,
      });
      const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!r.ok) throw new Error('refresh failed: ' + r.status);
      const j = await r.json();
      auth = {
        ...auth,
        access_token: j.access_token,
        refresh_token: j.refresh_token || auth.refresh_token,
        expires_at: Date.now() + (j.expires_in * 1000),
      };
      saveAuth(auth);
      return auth.access_token;
    } catch (e) {
      console.warn('refresh failed', e);
    }
  }
  // Token gone / refresh failed
  saveAuth(null);
  setScreen('auth');
  updateAuthUi();
  toast('Spotify session expired. Please log in again.', 'err');
  throw new Error('Not authenticated');
}

/* ---------------- PKCE login flow ---------------- */
async function beginLogin() {
  const verifier = randStr(64);
  const challenge = await sha256base64url(verifier);
  const state = randStr(16);
  localStorage.setItem('songster.pkce_verifier', verifier);
  localStorage.setItem('songster.pkce_state', state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
    state,
  });
  const authUrl = 'https://accounts.spotify.com/authorize?' + params.toString();
  $('#auth-error').style.display = 'none';
  show($('#auth-step1'), false);
  show($('#auth-step2'), true);

  const popup = window.open(authUrl, 'spotify_auth', 'width=520,height=720,menubar=no,toolbar=no');
  if (!popup) {
    show($('#auth-step1'), true);
    show($('#auth-step2'), false);
    throw new Error('Popup blocked. Please allow popups for this page and try again.');
  }
  listenForCallbackMessage(popup);
}

function listenForCallbackMessage(popup) {
  const expectedOrigin = (() => {
    try { return new URL(UNIVERSAL_CALLBACK_URL).origin; } catch { return null; }
  })();

  const handler = async (event) => {
    if (expectedOrigin && event.origin !== expectedOrigin) return;
    const d = event.data;
    if (!d || d.type !== 'oauth-callback' || !d.params) return;
    window.removeEventListener('message', handler);
    try { popup && popup.close(); } catch {}

    const { code, state, error, error_description } = d.params;
    show($('#auth-step2'), false);
    show($('#auth-exchanging'), true);

    if (error) {
      showAuthError(escHtml('Spotify error: ' + (error_description || error)));
      show($('#auth-exchanging'), false);
      show($('#auth-step1'), true);
      return;
    }
    if (!code) {
      showAuthError(escHtml('No code returned from Spotify.'));
      show($('#auth-exchanging'), false);
      show($('#auth-step1'), true);
      return;
    }
    try {
      await exchangeCodeForToken(code, state);
      updateAuthUi();
      toast('Connected to Spotify');
      if (isAuthValid()) await goToPlaylists();
    } catch (e) {
      showAuthError(escHtml(e.message));
      show($('#auth-exchanging'), false);
      show($('#auth-step1'), true);
    }
  };
  window.addEventListener('message', handler);
}

async function exchangeCodeForToken(code, stateBack) {
  const verifier = localStorage.getItem('songster.pkce_verifier');
  const stateOrig = localStorage.getItem('songster.pkce_state');
  if (!verifier) throw new Error('Missing PKCE verifier; please log in again.');
  if (stateOrig && stateBack && stateOrig !== stateBack) {
    throw new Error('State mismatch — possible CSRF.');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('Token exchange failed (' + r.status + '): ' + txt);
  }
  const j = await r.json();
  auth = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in * 1000),
    scope: j.scope,
    token_type: j.token_type,
  };
  saveAuth(auth);
  localStorage.removeItem('songster.pkce_verifier');
  localStorage.removeItem('songster.pkce_state');
}

function updateAuthUi() {
  const connected = isAuthValid();
  show($('#auth-step1'), !connected);
  show($('#auth-step2'), false);
  show($('#auth-exchanging'), false);
  show($('#auth-connected'), connected);
}
