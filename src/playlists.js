/* ====================================================
 * Playlist storage + playlists screen UI + modals:
 *   - My Spotify playlists modal
 *   - Search public playlists modal
 *   - Playlist details (songs) modal
 * ==================================================== */

const DEFAULT_PLAYLISTS_USER_ID = 'ta8hnikdhdctwuvkj2nl9itix';

function loadPlaylists() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY_PLAYLISTS) || '[]');
  } catch { return []; }
}
function savePlaylists(arr) {
  localStorage.setItem(LS_KEY_PLAYLISTS, JSON.stringify(arr));
  renderHistory();
}

async function seedDefaultsIfFirstRun() {
  // Only seed if this browser has never had a playlist list initialized.
  if (localStorage.getItem(LS_KEY_PLAYLISTS) !== null) return;
  try {
    const lists = await fetchUserPublicPlaylists(DEFAULT_PLAYLISTS_USER_ID);
    // Stamp each seed with a slightly increasing addedAt so default "by date desc"
    // preserves the order returned by Spotify (first in list = newest).
    const now = Date.now();
    lists.forEach((p, i) => { p.addedAt = now - i; });
    localStorage.setItem(LS_KEY_PLAYLISTS, JSON.stringify(lists));
    renderHistory();
    if (lists.length) toast(`Loaded ${lists.length} default playlists`);
  } catch (e) {
    console.warn('Failed to seed default playlists:', e);
    // Mark as initialized (empty) so we don't retry forever if the user is offline / API failed.
    localStorage.setItem(LS_KEY_PLAYLISTS, JSON.stringify([]));
  }
}

async function goToPlaylists() {
  // Verify the token actually works before showing the playlist screen.
  // A user may be authenticated with a different Spotify app than the one
  // whose client ID is active (e.g. after a CID change without clearing auth).
  try {
    await spotifyFetch('/me');
  } catch (e) {
    saveAuth(null);
    auth = null;
    setScreen('auth');
    updateAuthUi();
    const isAuthError = e.message.includes('401') || e.message.includes('403');
    if (isAuthError) {
      const url = `https://developer.spotify.com/dashboard/${CLIENT_ID}/users`;
      showAuthError(`Spotify login seems to work, but your account is not registered for this specific app:<br> Client ID <b>${escHtml(CLIENT_ID)}</b><br><br> You have two options now:
<ul style="margin:6px 0 0;padding-left:20px;line-height:1.8">
  <li><b>Option A:</b><br> Ask the app owner to add your Spotify account in their according app settings (forward them this link):
    <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
      <code style="flex:1;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:5px 8px;font-size:11px;color:#9fdfff;word-break:break-all">${escHtml(url)}</code>
      <button onclick="navigator.clipboard.writeText('${escHtml(url)}').then(()=>toast('Link copied')).catch(()=>toast('Copy failed','err'))" style="flex-shrink:0;padding:6px 8px;font-size:12px">Copy</button>
    </div>
  </li>
  <li><b>Option B:</b><br> Create your own Spotify Developer App (without any cost) and enter your own Client ID and connect again.<br>Please refer to "<b>How to use your own Spotify Developer App</b>" (above Client ID input field on the start page)</li>
</ul>`);
    } else {
      showAuthError(escHtml('Could not reach Spotify: ' + e.message));
    }
    return;
  }
  setScreen('playlists');
  renderHistory();
  syncStartButton();
  await seedDefaultsIfFirstRun();
}

let currentPl = { url: '', desc: '' };

function selectPlaylistFromModal(p, closeModalId) {
  $('#input-url').value = p.url;
  $('#input-desc').value = p.name;
  currentPl = { url: p.url, desc: p.name };
  syncSelectedHistory();
  if (closeModalId) document.getElementById(closeModalId).classList.remove('active');
}

// In-memory sort preference for the history list.
// col: 'name' | 'date' ; dir: 1=asc, -1=desc.
// Default: by date (lastPlayedAt || addedAt), most recent first.
let historySort = { col: 'date', dir: -1 };
let historyQuery = '';

function historyDateValue(p) {
  return p.lastPlayedAt || p.addedAt || 0;
}

function sortedHistory() {
  let list = loadPlaylists().slice();
  const q = historyQuery.trim().toLowerCase();
  if (q) {
    list = list.filter(p =>
      (p.description || '').toLowerCase().includes(q) ||
      (p.playlistUrl || '').toLowerCase().includes(q)
    );
  }
  if (historySort.col === 'name') {
    list.sort((a, b) => a.description.localeCompare(b.description) * historySort.dir);
  } else {
    list.sort((a, b) => (historyDateValue(a) - historyDateValue(b)) * historySort.dir);
  }
  return list;
}

function renderHistorySortBar() {
  const arrow = (col) => {
    if (historySort.col !== col) return '⇅';
    return historySort.dir === 1 ? '▲' : '▼';
  };
  document.querySelectorAll('.history-sort-btn').forEach(btn => {
    const col = btn.dataset.sort;
    btn.classList.toggle('active', historySort.col === col);
    const ind = btn.querySelector('.sort-ind');
    if (ind) {
      ind.textContent = arrow(col);
      ind.classList.toggle('active', historySort.col === col);
    }
  });
}

function renderHistory() {
  const list = sortedHistory();
  renderHistorySortBar();
  const root = $('#history-list');
  if (!list.length) {
    const msg = historyQuery.trim()
      ? `No playlists match "${escHtml(historyQuery.trim())}".`
      : 'No playlists added yet!';
    root.innerHTML = `<div class="muted">${msg}</div>`;
    return;
  }
  root.innerHTML = list.map((p, idx) => `
    <div class="history-item" data-i="${idx}" data-url="${escHtml(p.playlistUrl)}">
      <div class="grow">
        <div class="desc">${escHtml(p.description)}</div>
        <div class="url">${escHtml(p.playlistUrl)}</div>
      </div>
      <button class="del" data-details="${idx}" title="Show songs">
        <svg class="icon" style="color:#fff"><use href="#i-search"/></svg>
      </button>
      <button class="del" data-del="${idx}" title="Delete">
        <svg class="icon" style="color:#fff"><use href="#i-del"/></svg>
      </button>
    </div>
  `).join('');
  root.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-del], [data-details]')) return;
      const i = +el.dataset.i;
      currentPl = { url: list[i].playlistUrl, desc: list[i].description };
      $('#input-url').value = currentPl.url;
      $('#input-desc').value = currentPl.desc;
      syncSelectedHistory();
    });
  });
  syncSelectedHistory();
  root.querySelectorAll('[data-del]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = +el.dataset.del;
      const arr = list.slice();
      arr.splice(i, 1);
      savePlaylists(arr);
    });
  });
  root.querySelectorAll('[data-details]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = +el.dataset.details;
      openPlaylistDetails({
        url: list[i].playlistUrl,
        name: list[i].description,
        tracksTotal: 0,
        owner: '',
      });
    });
  });
}

function syncSelectedHistory() {
  // Compare against the URL stored on each rendered row (data-url),
  // not against a position in loadPlaylists(), because the rendered list is sorted
  // by description and the indices wouldn't line up.
  const url = ($('#input-url')?.value || '').trim();
  document.querySelectorAll('#history-list .history-item').forEach(el => {
    el.classList.toggle('selected', !!url && el.dataset.url === url);
  });
  syncStartButton();
}

function syncStartButton() {
  const url = ($('#input-url')?.value || '').trim();
  const btn = $('#btn-start');
  if (btn) btn.disabled = !url;
}

function setPlaylistsMsg(msg, kind='err') {
  const el = $('#playlists-msg');
  if (!msg) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="${kind}">${escHtml(msg)}</div>`;
}

function markPlaylistPlayed(playlistUrl) {
  const arr = loadPlaylists();
  const entry = arr.find(p => p.playlistUrl === playlistUrl);
  if (!entry) return;
  entry.lastPlayedAt = Date.now();
  savePlaylists(arr);
}

function savePlaylist({ playlistUrl, description }) {
  if (!playlistUrl.trim() || !description.trim()) {
    setPlaylistsMsg('Playlist URL and description must be set');
    return false;
  }
  try { new URL(playlistUrl); } catch {
    setPlaylistsMsg('Invalid URL: ' + playlistUrl);
    return false;
  }
  const arr = loadPlaylists();
  const existingByUrl = arr.find(p => p.playlistUrl === playlistUrl);
  const existingByDesc = arr.find(p => p.description === description);
  if (existingByUrl) {
    existingByUrl.description = description;
  } else if (existingByDesc) {
    existingByDesc.playlistUrl = playlistUrl;
  } else {
    arr.push({ playlistUrl, description, addedAt: Date.now() });
  }
  savePlaylists(arr);
  setPlaylistsMsg(null);
  return true;
}

/* ---------------- Spotify Playlists Modal ---------------- */
let modalPlsCache = [];
let modalPlsTotal = 0;
let modalPlsNext = null;     // Spotify-provided "next" URL (or null when no more pages)
let modalPlsLoadingMore = false;

async function openSpotifyPlsModal() {
  const btnLbl = $('#btn-show-spotify-pls-lbl');
  btnLbl.textContent = 'Loading…';
  try {
    const { items, total, next } = await fetchUserPlaylists(0, 50);
    modalPlsCache = items;
    modalPlsTotal = total;
    modalPlsNext = next;
    $('#modal-pls-search').value = '';
    updatePlsTotalLabel();
    renderSpotifyPlsList('');
    $('#modal-spotify-pls').classList.add('active');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btnLbl.textContent = 'My playlists';
  }
}

function updatePlsTotalLabel() {
  $('#modal-pls-total').textContent = `Showing ${modalPlsCache.length} of ${modalPlsTotal} playlists`;
}

async function loadMoreSpotifyPls() {
  if (modalPlsLoadingMore || !modalPlsNext) return;
  modalPlsLoadingMore = true;
  renderSpotifyPlsList($('#modal-pls-search').value);
  try {
    const { items, next } = await fetchUserPlaylists(modalPlsCache.length, 50);
    // Dedupe in case of overlap.
    const seen = new Set(modalPlsCache.map(p => p.id));
    for (const it of items) if (!seen.has(it.id)) modalPlsCache.push(it);
    modalPlsNext = next;
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    modalPlsLoadingMore = false;
    updatePlsTotalLabel();
    renderSpotifyPlsList($('#modal-pls-search').value);
  }
}

function renderSpotifyPlsList(q) {
  const ql = q.toLowerCase();
  const filtered = !q ? modalPlsCache : modalPlsCache.filter(p =>
    p.name.toLowerCase().includes(ql) ||
    p.owner.toLowerCase().includes(ql) ||
    p.description.toLowerCase().includes(ql)
  );
  const root = $('#modal-pls-content');
  const hasMore = !!modalPlsNext;

  if (!filtered.length) {
    root.innerHTML = `<div style="padding:16px;color:#666;text-align:center">No playlists match your search.</div>`;
  } else {
    root.innerHTML = filtered.map((p, idx) => renderPlaylistRow(p, idx)).join('');
    wirePlaylistRows(root, filtered, (p) => selectPlaylistFromModal(p, 'modal-spotify-pls'));
  }

  // "Load more" footer — only shown when there are more pages on the server.
  if (hasMore) {
    const btn = document.createElement('button');
    btn.id = 'btn-load-more-pls';
    btn.className = 'primary';
    btn.style.cssText = 'display:block;margin:14px auto 6px;min-width:160px';
    btn.disabled = modalPlsLoadingMore;
    btn.textContent = modalPlsLoadingMore ? 'Loading…' : `Load more (${modalPlsTotal - modalPlsCache.length} remaining)`;
    btn.addEventListener('click', loadMoreSpotifyPls);
    root.appendChild(btn);
  }
}

/* ---------------- Shared playlist row rendering ---------------- */
function renderPlaylistRow(p, idx) {
  return `
    <div class="pl-item" data-idx="${idx}">
      <div class="pl-info">
        <div class="name">${escHtml(p.name)}</div>
        ${p.owner ? `<div class="meta">by ${escHtml(p.owner)}</div>` : ''}
        <div class="meta">${p.tracksTotal} tracks</div>
        ${p.description ? `<div class="meta">${escHtml(p.description)}</div>` : ''}
      </div>
      <button class="pl-details-btn" data-details="${idx}" title="Show songs">
        <svg class="icon"><use href="#i-search"/></svg>
      </button>
    </div>`;
}

function wirePlaylistRows(root, list, onSelect) {
  root.querySelectorAll('.pl-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-details]')) return; // magnifier handles itself
      const i = +el.dataset.idx;
      onSelect(list[i]);
    });
  });
  root.querySelectorAll('[data-details]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = +el.dataset.details;
      openPlaylistDetails(list[i]);
    });
  });
}

/* ---------------- Search public playlists modal ---------------- */
let searchPubCache = [];
let searchPubTotal = 0;
let searchPubNext = null;
let searchPubQuery = '';
let searchPubLoading = false;
let searchPubDebounce = null;

function openSearchPublicModal() {
  searchPubCache = [];
  searchPubTotal = 0;
  searchPubNext = null;
  searchPubQuery = '';
  $('#search-public-q').value = '';
  $('#search-public-meta').textContent = 'Type a query to search Spotify for public playlists.';
  $('#search-public-content').innerHTML = '';
  $('#modal-search-public').classList.add('active');
  setTimeout(() => $('#search-public-q').focus(), 50);
}

async function runPublicSearch(q) {
  searchPubQuery = q;
  if (!q.trim()) {
    searchPubCache = []; searchPubTotal = 0; searchPubNext = null;
    $('#search-public-meta').textContent = 'Type a query to search Spotify for public playlists.';
    $('#search-public-content').innerHTML = '';
    return;
  }
  searchPubLoading = true;
  $('#search-public-meta').textContent = 'Searching…';
  $('#search-public-content').innerHTML = '';
  try {
    const { items, total, next } = await searchPublicPlaylists(q, 0, 20);
    searchPubCache = items;
    searchPubTotal = total;
    searchPubNext = next;
    renderPublicSearchList();
  } catch (e) {
    $('#search-public-meta').textContent = '';
    $('#search-public-content').innerHTML = `<div style="padding:16px;text-align:center;color:#c44">${escHtml(e.message)}</div>`;
  } finally {
    searchPubLoading = false;
  }
}

async function loadMorePublicSearch() {
  if (searchPubLoading || !searchPubNext) return;
  searchPubLoading = true;
  renderPublicSearchList();
  try {
    const { items, next } = await searchPublicPlaylists(searchPubQuery, searchPubCache.length, 20);
    const seen = new Set(searchPubCache.map(p => p.id));
    for (const it of items) if (!seen.has(it.id)) searchPubCache.push(it);
    searchPubNext = next;
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    searchPubLoading = false;
    renderPublicSearchList();
  }
}

function renderPublicSearchList() {
  const root = $('#search-public-content');
  if (!searchPubCache.length) {
    root.innerHTML = `<div style="padding:16px;text-align:center;color:#666">No matches.</div>`;
  } else {
    root.innerHTML = searchPubCache.map((p, idx) => renderPlaylistRow(p, idx)).join('');
    wirePlaylistRows(root, searchPubCache, (p) => selectPlaylistFromModal(p, 'modal-search-public'));
  }
  $('#search-public-meta').textContent = searchPubCache.length
    ? `Showing ${searchPubCache.length} of ${searchPubTotal} results`
    : '';
  if (searchPubNext) {
    const btn = document.createElement('button');
    btn.id = 'btn-load-more-public';
    btn.className = 'primary';
    btn.style.cssText = 'display:block;margin:14px auto 6px;min-width:160px';
    btn.disabled = searchPubLoading;
    btn.textContent = searchPubLoading ? 'Loading…' : `Load more`;
    btn.addEventListener('click', loadMorePublicSearch);
    root.appendChild(btn);
  }
}

/* ---------------- Playlist details (songs) modal ---------------- */
let detailsCurrentPl = null;
let detailsTracks = [];
let detailsSort = { col: null, dir: 1 }; // col: 'artist' | 'name' | 'year' ; dir: 1=asc, -1=desc

function renderSongsTable() {
  const root = $('#details-pl-content');
  if (!detailsTracks.length) {
    root.innerHTML = `<div style="padding:16px;text-align:center;color:#666">No tracks in this playlist.</div>`;
    return;
  }
  let rows = detailsTracks;
  if (detailsSort.col) {
    const cmp = (a, b) => {
      let av = a[detailsSort.col], bv = b[detailsSort.col];
      if (detailsSort.col === 'year') {
        av = av || 0; bv = bv || 0;
        return (av - bv) * detailsSort.dir;
      }
      av = (av || '').toLowerCase();
      bv = (bv || '').toLowerCase();
      if (av < bv) return -1 * detailsSort.dir;
      if (av > bv) return  1 * detailsSort.dir;
      return 0;
    };
    rows = detailsTracks.slice().sort(cmp);
  }
  const arrow = (col) => {
    if (detailsSort.col !== col) return '<span class="sort-ind">⇅</span>';
    return detailsSort.dir === 1 ? '<span class="sort-ind active">▲</span>' : '<span class="sort-ind active">▼</span>';
  };
  root.innerHTML = `
    <table class="songs-tbl">
      <thead>
        <tr>
          <th data-sort="artist">Artist ${arrow('artist')}</th>
          <th data-sort="name">Title ${arrow('name')}</th>
          <th data-sort="year">Year ${arrow('year')}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(t => `
          <tr>
            <td>${escHtml(t.artist)}</td>
            <td>${escHtml(t.name)}</td>
            <td>${t.year || ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  root.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (detailsSort.col === col) {
        detailsSort.dir = -detailsSort.dir;
      } else {
        detailsSort.col = col;
        detailsSort.dir = 1;
      }
      renderSongsTable();
    });
  });
}

async function openPlaylistDetails(p) {
  // Normalize: if called with just a URL string, fabricate a placeholder.
  if (typeof p === 'string') p = { url: p, name: p, tracksTotal: 0, owner: '' };
  if (!p || !p.url) { toast('Invalid playlist', 'err'); return; }
  detailsCurrentPl = p;
  detailsTracks = [];
  detailsSort = { col: null, dir: 1 };
  $('#details-pl-name').textContent = p.name || 'Playlist';
  $('#details-pl-meta').textContent = [
    p.tracksTotal ? `${p.tracksTotal} tracks` : '',
    p.owner ? `by ${p.owner}` : '',
  ].filter(Boolean).join(' • ');
  $('#details-pl-content').innerHTML = `<div style="padding:24px;text-align:center;color:#666">Loading songs…</div>`;
  $('#modal-pl-details').classList.add('active');

  const pid = getPlaylistId(p.url);
  if (!pid) {
    $('#details-pl-content').innerHTML = `<div style="padding:16px;text-align:center;color:#c44">Invalid playlist URL.</div>`;
    return;
  }
  try {
    detailsTracks = await fetchPlaylistTracks(pid);
    renderSongsTable();
    $('#details-pl-meta').textContent = [
      `${detailsTracks.length} tracks`,
      p.owner ? `by ${p.owner}` : '',
    ].filter(Boolean).join(' • ');
  } catch (e) {
    $('#details-pl-content').innerHTML = `<div style="padding:16px;text-align:center;color:#c44">Failed to load: ${escHtml(e.message)}</div>`;
  }
}
