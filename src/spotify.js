/* ====================================================
 * Spotify REST helpers + Web Playback SDK wrapper.
 * Depends on auth.js (ensureAccessToken).
 * ==================================================== */

async function spotifyFetch(path, opts={}) {
  const token = await ensureAccessToken();
  const r = await fetch('https://api.spotify.com/v1' + path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
  });
  if (r.status === 204) return null;
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('Spotify API ' + r.status + ': ' + txt);
  }
  if (r.headers.get('content-type')?.includes('application/json')) return r.json();
  return null;
}

async function fetchPlaylistTracks(playlistId) {
  const all = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const j = await spotifyFetch(`/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`);
    for (const item of (j.items || [])) {
      const t = item.track;
      if (!t || !t.id) continue;
      const artist = (t.artists && t.artists[0]) ? t.artists[0].name : 'Unknown Artist';
      const album = t.album || {};
      const releaseDate = album.release_date || '';
      const year = parseInt((releaseDate.split('-')[0] || '0'), 10) || 0;
      const image = (album.images && album.images[0]) ? album.images[0].url : '';
      all.push({
        id: t.id,
        name: t.name,
        artist,
        album: album.name || '',
        year,
        releaseDate,
        imageUrl: image,
        uri: t.uri,
        durationMs: t.duration_ms || 0,
      });
    }
    const total = j.total || 0;
    offset += limit;
    if (all.length >= total || !j.items || j.items.length < limit) break;
  }
  return all;
}

async function fetchUserPlaylists(offset=0, limit=50) {
  const j = await spotifyFetch(`/me/playlists?limit=${limit}&offset=${offset}`);
  const items = (j.items || []).map(it => ({
    id: it.id,
    name: it.name || 'Unknown Playlist',
    description: it.description || '',
    url: (it.external_urls && it.external_urls.spotify) || '',
    imageUrl: (it.images && it.images[0]) ? it.images[0].url : '',
    tracksTotal: (it.tracks && it.tracks.total) || 0,
    owner: (it.owner && it.owner.display_name) || '',
  })).filter(p => p.id && p.url);
  return { items, total: j.total || 0, next: j.next || null };
}

async function fetchUserPublicPlaylists(userId) {
  const all = [];
  // Follow Spotify's `next` link instead of using `items.length < limit` as the stop signal.
  // Spotify sometimes returns short pages (or pages with null entries) while there are still
  // more results, so length-based pagination can cut off early.
  let path = `/users/${encodeURIComponent(userId)}/playlists?limit=50&offset=0`;
  let safety = 50; // hard cap on pages just in case
  while (path && safety-- > 0) {
    const j = await spotifyFetch(path);
    const items = j.items || [];
    for (const it of items) {
      if (!it) continue;
      const url = it.external_urls && it.external_urls.spotify;
      if (url) all.push({ playlistUrl: url, description: it.name || 'Untitled' });
    }
    if (j.next) {
      // j.next is a fully-qualified URL like "https://api.spotify.com/v1/users/.../playlists?offset=50&limit=50".
      // spotifyFetch prepends "https://api.spotify.com/v1", so strip that prefix.
      const u = new URL(j.next);
      path = u.pathname.replace(/^\/v1/, '') + u.search;
    } else {
      path = null;
    }
  }
  return all;
}

async function searchPublicPlaylists(q, offset=0, limit=20) {
  const j = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=playlist&limit=${limit}&offset=${offset}`);
  const sec = j.playlists || {};
  const items = (sec.items || [])
    .filter(it => it && it.id)
    .map(it => ({
      id: it.id,
      name: it.name || 'Unknown Playlist',
      description: it.description || '',
      url: (it.external_urls && it.external_urls.spotify) || '',
      imageUrl: (it.images && it.images[0]) ? it.images[0].url : '',
      tracksTotal: (it.tracks && it.tracks.total) || 0,
      owner: (it.owner && it.owner.display_name) || '',
    }))
    .filter(p => p.url);
  return { items, total: sec.total || 0, next: sec.next || null };
}

/* ---------------- Spotify Web Playback SDK wrapper ---------------- */
let spPlayer = null;
let spDeviceId = null;
let spReadyPromise = null;
let sdkLoadedPromise = null;

function loadSdk() {
  if (sdkLoadedPromise) return sdkLoadedPromise;
  sdkLoadedPromise = new Promise((resolve) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    document.head.appendChild(s);
  });
  return sdkLoadedPromise;
}

async function ensurePlayer() {
  if (spPlayer && spDeviceId) return spPlayer;
  if (spReadyPromise) return spReadyPromise;
  spReadyPromise = (async () => {
    await loadSdk();
    const player = new window.Spotify.Player({
      name: 'Songster Web',
      getOAuthToken: cb => { ensureAccessToken().then(cb).catch(()=>cb('')); },
      volume: 0.8,
    });
    player.addListener('initialization_error', e => console.warn('init err', e));
    player.addListener('authentication_error', e => console.warn('auth err', e));
    player.addListener('account_error', e => {
      quiz.errorMessage = 'Account error: ' + e.message + ' (Premium required)';
      renderQuiz();
    });
    player.addListener('playback_error', e => console.warn('playback err', e));
    player.addListener('player_state_changed', state => {
      if (!state || !quiz.isPlaying) return;
      const stateUri = state.track_window?.current_track?.uri;
      if (quiz.currentTrack && stateUri && stateUri !== quiz.currentTrack.uri) return;
      // Ignore Spotify's end-of-track position reset to 0.
      if (state.position === 0 && quiz.currentPlaybackPositionMs > 5000) return;
      quiz.currentPlaybackPositionMs = state.position;
      quiz.trackDurationMs = state.duration;
      updateProgressUi();
    });
    const readyDevice = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Player init timeout')), 15000);
      player.addListener('ready', ({ device_id }) => { clearTimeout(timer); resolve(device_id); });
      player.addListener('not_ready', ({ device_id }) => { console.log('device gone', device_id); });
      player.connect().then(ok => {
        if (!ok) { clearTimeout(timer); reject(new Error('player.connect() returned false')); }
      });
    });
    spPlayer = player;
    spDeviceId = readyDevice;
    // Transfer playback to this device
    await spotifyFetch('/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [spDeviceId], play: false }),
    }).catch(()=>{});
    return spPlayer;
  })();
  try { await spReadyPromise; } catch (e) { spReadyPromise = null; throw e; }
  return spPlayer;
}

async function playerPlayTrack(uri, positionMs=0) {
  await ensurePlayer();
  await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(spDeviceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
  });
}
async function playerPause() {
  if (!spPlayer) return;
  try { await spPlayer.pause(); } catch {}
}
async function playerResume() {
  if (!spPlayer) return;
  try { await spPlayer.resume(); } catch {}
}
async function playerSeek(ms) {
  if (!spPlayer) return;
  try { await spPlayer.seek(Math.max(0, ms|0)); } catch {}
}
async function playerGetState() {
  if (!spPlayer) return null;
  try {
    const s = await spPlayer.getCurrentState();
    if (!s) return null;
    return {
      position: s.position,
      duration: s.duration,
      uri: s.track_window?.current_track?.uri,
      paused: s.paused,
    };
  } catch { return null; }
}
