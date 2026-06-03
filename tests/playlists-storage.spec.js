import { test, expect, gotoPlaylistsAuthed, installFakeSdk } from './fixtures.js';

test.beforeEach(async ({ page, baseURL }) => {
  await gotoPlaylistsAuthed(page, baseURL);
});

const VALID_URL = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
const VALID_URL_2 = 'https://open.spotify.com/playlist/5ABHKGoOzxkaa28ttQV9sE';

// ── Playlists screen baseline ────────────────────────────────────────────────

test('playlists screen is active after authentication', async ({ page }) => {
  await expect(page.locator('#screen-playlists')).toHaveClass(/active/);
});

test('start button is disabled when no URL is entered', async ({ page }) => {
  await expect(page.locator('#btn-start')).toBeDisabled();
});

// ── savePlaylist ─────────────────────────────────────────────────────────────

test('savePlaylist persists a new entry to localStorage', async ({ page }) => {
  await page.evaluate((u) =>
    savePlaylist({ playlistUrl: u, description: 'My Test Playlist' }), VALID_URL);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('songster.playlists')));
  expect(stored).toHaveLength(1);
  expect(stored[0].playlistUrl).toBe(VALID_URL);
  expect(stored[0].description).toBe('My Test Playlist');
});

test('savePlaylist rejects empty URL and reports an error', async ({ page }) => {
  const ok = await page.evaluate(() =>
    savePlaylist({ playlistUrl: '', description: 'No URL' }));
  expect(ok).toBe(false);
  await expect(page.locator('#playlists-msg .err')).toHaveText(/must be set/i);
});

test('savePlaylist rejects empty description and reports an error', async ({ page }) => {
  const ok = await page.evaluate((u) =>
    savePlaylist({ playlistUrl: u, description: '' }), VALID_URL);
  expect(ok).toBe(false);
  await expect(page.locator('#playlists-msg .err')).toHaveText(/must be set/i);
});

test('savePlaylist rejects an invalid URL', async ({ page }) => {
  const ok = await page.evaluate(() =>
    savePlaylist({ playlistUrl: 'not a url', description: 'Bad' }));
  expect(ok).toBe(false);
  await expect(page.locator('#playlists-msg .err')).toHaveText(/Invalid URL/i);
});

test('savePlaylist updates description when URL already exists', async ({ page }) => {
  await page.evaluate((u) =>
    savePlaylist({ playlistUrl: u, description: 'First name' }), VALID_URL);
  await page.evaluate((u) =>
    savePlaylist({ playlistUrl: u, description: 'Renamed' }), VALID_URL);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('songster.playlists')));
  expect(stored).toHaveLength(1);
  expect(stored[0].description).toBe('Renamed');
});

test('savePlaylist updates URL when description already exists', async ({ page }) => {
  await page.evaluate((u) =>
    savePlaylist({ playlistUrl: u, description: 'My Playlist' }), VALID_URL);
  await page.evaluate((u) =>
    savePlaylist({ playlistUrl: u, description: 'My Playlist' }), VALID_URL_2);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('songster.playlists')));
  expect(stored).toHaveLength(1);
  expect(stored[0].playlistUrl).toBe(VALID_URL_2);
});

// ── History rendering ────────────────────────────────────────────────────────

test('empty history shows the "No playlists added yet" message', async ({ page }) => {
  await expect(page.locator('#history-list .muted')).toContainText('No playlists added yet');
});

test('saved playlists render in the history list', async ({ page }) => {
  await page.evaluate((u) => {
    savePlaylist({ playlistUrl: u, description: 'Plist A' });
  }, VALID_URL);
  await expect(page.locator('#history-list .history-item')).toHaveCount(1);
  await expect(page.locator('#history-list .desc')).toHaveText('Plist A');
});

test('history search filters by description', async ({ page }) => {
  await page.evaluate((urls) => {
    savePlaylist({ playlistUrl: urls[0], description: 'Rock Classics' });
    savePlaylist({ playlistUrl: urls[1], description: 'Jazz Picks' });
  }, [VALID_URL, VALID_URL_2]);
  await page.locator('#history-search').fill('jazz');
  await expect(page.locator('#history-list .history-item')).toHaveCount(1);
  await expect(page.locator('#history-list .desc')).toHaveText('Jazz Picks');
});

test('history search showing no matches reports the empty state', async ({ page }) => {
  await page.evaluate((u) => savePlaylist({ playlistUrl: u, description: 'Rock' }), VALID_URL);
  await page.locator('#history-search').fill('zzzzz');
  await expect(page.locator('#history-list .muted')).toContainText('No playlists match');
});

// ── History sorting ─────────────────────────────────────────────────────────

test('clicking the name sort header toggles ascending/descending', async ({ page }) => {
  await page.evaluate((urls) => {
    savePlaylist({ playlistUrl: urls[0], description: 'Beta' });
    savePlaylist({ playlistUrl: urls[1], description: 'Alpha' });
  }, [VALID_URL, VALID_URL_2]);
  await page.locator('.history-sort-btn[data-sort="name"]').click();
  let names = await page.locator('#history-list .desc').allTextContents();
  expect(names).toEqual(['Alpha', 'Beta']);
  await page.locator('.history-sort-btn[data-sort="name"]').click();
  names = await page.locator('#history-list .desc').allTextContents();
  expect(names).toEqual(['Beta', 'Alpha']);
});

// ── Deleting from history ───────────────────────────────────────────────────

test('clicking the delete icon removes a playlist from history', async ({ page }) => {
  await page.evaluate((u) =>
    savePlaylist({ playlistUrl: u, description: 'To delete' }), VALID_URL);
  await expect(page.locator('#history-list .history-item')).toHaveCount(1);
  await page.locator('[data-del="0"]').click();
  await expect(page.locator('#history-list .history-item')).toHaveCount(0);
});

// ── Selection drives the URL/desc inputs ─────────────────────────────────────

test('clicking a history row fills the URL and description inputs', async ({ page }) => {
  await page.evaluate((u) =>
    savePlaylist({ playlistUrl: u, description: 'Pickme' }), VALID_URL);
  await page.locator('#history-list .history-item').first().click();
  await expect(page.locator('#input-url')).toHaveValue(VALID_URL);
  await expect(page.locator('#input-desc')).toHaveValue('Pickme');
  await expect(page.locator('#btn-start')).toBeEnabled();
});

// ── Check button (mocked Spotify) ────────────────────────────────────────────

test('Check button reports OK for a valid playlist URL', async ({ page }) => {
  await page.locator('#input-url').fill(VALID_URL);
  await page.locator('#btn-check').click();
  await expect(page.locator('#playlists-msg .ok')).toContainText('OK');
});

test('Check button rejects an invalid playlist URL', async ({ page }) => {
  await page.locator('#input-url').fill('https://example.com/nope');
  await page.locator('#btn-check').click();
  await expect(page.locator('#playlists-msg .err')).toContainText('Invalid playlist URL');
});

// ── markPlaylistPlayed ───────────────────────────────────────────────────────

test('markPlaylistPlayed stamps a lastPlayedAt on the entry', async ({ page }) => {
  await page.evaluate((u) =>
    savePlaylist({ playlistUrl: u, description: 'Played' }), VALID_URL);
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('songster.playlists'))[0].lastPlayedAt);
  expect(before).toBeUndefined();
  await page.evaluate((u) => markPlaylistPlayed(u), VALID_URL);
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('songster.playlists'))[0].lastPlayedAt);
  expect(typeof after).toBe('number');
  expect(after).toBeGreaterThan(0);
});

// ── Spotify REST helpers (spotify.js) ───────────────────────────────────────

test.describe('Spotify REST helpers', () => {
  test.beforeEach(async ({ page }) => {
    // The outer beforeEach already logged us in and seeded an empty history.
    // Make sure window.auth is set before each call so spotifyFetch can use it.
    await page.evaluate(() => {
      auth = { access_token: 't', refresh_token: 'r', expires_at: Date.now() + 600_000 };
      saveAuth(auth);
    });
  });


test('spotifyFetch returns parsed JSON for a 200 response', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":1}' }));
  const out = await page.evaluate(async () => await spotifyFetch('/me'));
  expect(out).toEqual({ ok: 1 });
});

test('spotifyFetch returns null for a 204 No Content', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 204, body: '' }));
  const out = await page.evaluate(async () => await spotifyFetch('/me'));
  expect(out).toBeNull();
});

test('spotifyFetch returns null when the response has no JSON content type', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'plain' }));
  const out = await page.evaluate(async () => await spotifyFetch('/x'));
  expect(out).toBeNull();
});

test('spotifyFetch throws with status + body on a non-ok response', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 403, body: 'Forbidden' }));
  const err = await page.evaluate(async () => {
    try { await spotifyFetch('/x'); return null; }
    catch (e) { return e.message; }
  });
  expect(err).toMatch(/403/);
  expect(err).toMatch(/Forbidden/);
});

// ── fetchPlaylistTracks ─────────────────────────────────────────────────────

test('fetchPlaylistTracks maps Spotify items to the app track shape', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [
        { track: {
          id: 'a1', name: 'Bohemian Rhapsody', uri: 'spotify:track:a1',
          artists: [{ name: 'Queen' }],
          album: { name: 'A Night at the Opera', release_date: '1975-10-31', images: [{ url: 'http://img/1' }] },
        }},
        { track: null }, // skipped
        { track: { id: null } }, // skipped
        { track: { id: 'a2', name: 'B', uri: 'spotify:track:a2', artists: [], album: {} } },
      ], total: 4
    }) }));
  const out = await page.evaluate(async () => await fetchPlaylistTracks('PLID'));
  expect(out).toHaveLength(2);
  expect(out[0]).toMatchObject({
    id: 'a1', name: 'Bohemian Rhapsody', artist: 'Queen',
    album: 'A Night at the Opera', year: 1975, releaseDate: '1975-10-31',
    imageUrl: 'http://img/1', uri: 'spotify:track:a1',
  });
  // No artists / no album → safe defaults.
  expect(out[1]).toMatchObject({ id: 'a2', artist: 'Unknown Artist', album: '', year: 0, imageUrl: '' });
});

test('fetchPlaylistTracks paginates across pages until the total is reached', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  let call = 0;
  await page.route('**/api.spotify.com/**', route => {
    call++;
    // First request: a "full" page of 100 items, then a smaller second page.
    const items = call === 1
      ? Array.from({ length: 100 }, (_, i) => ({ track: { id: 'p1_' + i, name: 'n', uri: 'u', artists: [], album: {} }}))
      : Array.from({ length: 5  }, (_, i) => ({ track: { id: 'p2_' + i, name: 'n', uri: 'u', artists: [], album: {} }}));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, total: 105 }) });
  });
  const out = await page.evaluate(async () => await fetchPlaylistTracks('P'));
  expect(out).toHaveLength(105);
});

// ── fetchUserPlaylists ──────────────────────────────────────────────────────

test('fetchUserPlaylists maps items and filters out entries with no URL', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [
        { id: 'p1', name: 'A', description: 'D', external_urls: { spotify: 'http://x' },
          images: [{ url: 'i' }], tracks: { total: 5 }, owner: { display_name: 'Me' } },
        { id: null },                       // dropped (no id)
        { id: 'p2', external_urls: {} },    // dropped (no url)
      ], total: 3, next: null,
    }) }));
  const out = await page.evaluate(async () => await fetchUserPlaylists());
  expect(out.items).toHaveLength(1);
  expect(out.items[0]).toMatchObject({ id: 'p1', name: 'A', imageUrl: 'i', tracksTotal: 5, owner: 'Me' });
  expect(out.total).toBe(3);
});

// ── fetchUserPublicPlaylists ────────────────────────────────────────────────

test('fetchUserPublicPlaylists follows the next link and stops when null', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  let call = 0;
  await page.route('**/api.spotify.com/**', route => {
    call++;
    if (call === 1) {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        items: [
          { name: 'A', external_urls: { spotify: 'http://a' } },
          null,                                             // skipped
          { name: null, external_urls: { spotify: 'http://untitled' } },
        ],
        next: 'https://api.spotify.com/v1/users/u/playlists?offset=50&limit=50',
      }) });
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        items: [{ name: 'B', external_urls: { spotify: 'http://b' } }],
        next: null,
      }) });
    }
  });
  const out = await page.evaluate(async () => await fetchUserPublicPlaylists('u'));
  expect(out).toHaveLength(3);
  expect(out.map(p => p.description)).toEqual(['A', 'Untitled', 'B']);
});

// ── searchPublicPlaylists ───────────────────────────────────────────────────

test('searchPublicPlaylists maps the playlists section', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      playlists: {
        items: [
          null,                                  // skipped
          { id: null },                          // skipped
          { id: 's1', name: 'Search Hit', external_urls: { spotify: 'http://s1' },
            images: [{ url: 'i' }], tracks: { total: 7 }, owner: { display_name: 'O' } },
        ],
        total: 3, next: 'http://next',
      },
    }) }));
  const out = await page.evaluate(async () => await searchPublicPlaylists('rock'));
  expect(out.items).toHaveLength(1);
  expect(out.items[0]).toMatchObject({ id: 's1', name: 'Search Hit', tracksTotal: 7, owner: 'O' });
  expect(out.next).toBe('http://next');
});

test('searchPublicPlaylists falls back to defaults when sections are missing', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  const out = await page.evaluate(async () => await searchPublicPlaylists('x'));
  expect(out.items).toEqual([]);
  expect(out.total).toBe(0);
  expect(out.next).toBeNull();
});
});

// ── seedDefaultsIfFirstRun ──────────────────────────────────────────────────

test('seedDefaultsIfFirstRun loads defaults when storage is empty', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [
        { name: 'Default A', external_urls: { spotify: 'http://a' } },
        { name: 'Default B', external_urls: { spotify: 'http://b' } },
      ],
      next: null,
    }) }));
  await page.evaluate(async () => {
    localStorage.removeItem('songster.playlists');
    await seedDefaultsIfFirstRun();
  });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('songster.playlists')));
  expect(stored).toHaveLength(2);
});

test('seedDefaultsIfFirstRun is a no-op when storage already has the key', async ({ page }) => {
  await page.evaluate(async () => {
    localStorage.setItem('songster.playlists', JSON.stringify([{ playlistUrl: 'u', description: 'd' }]));
    await seedDefaultsIfFirstRun();
  });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('songster.playlists')));
  expect(stored).toHaveLength(1);
});

test('seedDefaultsIfFirstRun handles a Spotify failure by marking storage as initialized', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route => route.fulfill({ status: 500, body: 'x' }));
  await page.evaluate(async () => {
    localStorage.removeItem('songster.playlists');
    await seedDefaultsIfFirstRun();
  });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('songster.playlists')));
  expect(stored).toEqual([]);
});

// ── goToPlaylists with auth failures ────────────────────────────────────────

test('goToPlaylists routes to auth screen with a 401', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route => route.fulfill({ status: 401, body: 'unauth' }));
  await page.evaluate(async () => { await goToPlaylists(); });
  await expect(page.locator('#screen-auth')).toHaveClass(/active/);
  await expect(page.locator('#modal-auth-error')).toHaveClass(/active/);
});

test('goToPlaylists shows a generic error on non-auth failures', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route => route.fulfill({ status: 500, body: 'server' }));
  await page.evaluate(async () => { await goToPlaylists(); });
  await expect(page.locator('#modal-auth-error')).toHaveClass(/active/);
  await expect(page.locator('#modal-auth-error')).toContainText('Could not reach Spotify');
});

// ── My Spotify Playlists modal ──────────────────────────────────────────────

test('My Playlists modal opens and renders the fetched list', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [
        { id: 'p1', name: 'MyPL', description: 'desc', external_urls: { spotify: 'http://u' },
          tracks: { total: 12 }, owner: { display_name: 'Me' } },
      ], total: 1, next: null,
    }) }));
  await page.locator('#btn-show-spotify-pls').click();
  await expect(page.locator('#modal-spotify-pls')).toHaveClass(/active/);
  await expect(page.locator('#modal-pls-content')).toContainText('MyPL');
});

test('My Playlists search filter narrows the rendered list', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [
        { id: 'p1', name: 'Rock', description: '', external_urls: { spotify: 'http://r' }, tracks: { total: 1 }, owner: { display_name: 'a' } },
        { id: 'p2', name: 'Jazz', description: '', external_urls: { spotify: 'http://j' }, tracks: { total: 1 }, owner: { display_name: 'b' } },
      ], total: 2, next: null,
    }) }));
  await page.locator('#btn-show-spotify-pls').click();
  await page.locator('#modal-pls-search').fill('jazz');
  await expect(page.locator('#modal-pls-content')).toContainText('Jazz');
  await expect(page.locator('#modal-pls-content')).not.toContainText('Rock');
});

test('My Playlists search with no matches shows the empty state', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [{ id: 'p1', name: 'Rock', description: '', external_urls: { spotify: 'http://r' }, tracks: { total: 1 }, owner: { display_name: '' } }],
      total: 1, next: null,
    }) }));
  await page.locator('#btn-show-spotify-pls').click();
  await page.locator('#modal-pls-search').fill('zzzzz');
  await expect(page.locator('#modal-pls-content')).toContainText('No playlists match');
});

test('My Playlists "Load more" pulls in another page', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  let call = 0;
  await page.route('**/api.spotify.com/**', route => {
    call++;
    const items = call === 1
      ? [{ id: 'p1', name: 'First', description: '', external_urls: { spotify: 'http://x' }, tracks: { total: 1 }, owner: { display_name: '' } }]
      : [{ id: 'p2', name: 'Second', description: '', external_urls: { spotify: 'http://y' }, tracks: { total: 1 }, owner: { display_name: '' } }];
    const next = call === 1 ? 'http://next' : null;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, total: 2, next }) });
  });
  await page.locator('#btn-show-spotify-pls').click();
  await expect(page.locator('#modal-pls-content')).toContainText('First');
  await page.locator('#btn-load-more-pls').click();
  await expect(page.locator('#modal-pls-content')).toContainText('Second');
});

test('My Playlists open surfaces a toast when fetch fails', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route => route.fulfill({ status: 500, body: 'oops' }));
  await page.locator('#btn-show-spotify-pls').click();
  await expect(page.locator('body > div').filter({ hasText: /Spotify API 500/ })).toBeVisible();
});

test('selectPlaylistFromModal copies into the URL/desc inputs', async ({ page }) => {
  await page.evaluate(() => {
    selectPlaylistFromModal({ url: 'http://chosen', name: 'Chosen' }, 'modal-spotify-pls');
  });
  await expect(page.locator('#input-url')).toHaveValue('http://chosen');
  await expect(page.locator('#input-desc')).toHaveValue('Chosen');
});

// ── Search public playlists modal ───────────────────────────────────────────

test('Search-public modal opens with the initial prompt', async ({ page }) => {
  await page.locator('#btn-search-public-pls').click();
  await expect(page.locator('#modal-search-public')).toHaveClass(/active/);
  await expect(page.locator('#search-public-meta')).toContainText('Type a query');
});

test('runPublicSearch with an empty query resets state to the prompt', async ({ page }) => {
  await page.locator('#btn-search-public-pls').click();
  await page.evaluate(async () => { await runPublicSearch('   '); });
  await expect(page.locator('#search-public-meta')).toContainText('Type a query');
});

test('runPublicSearch with results renders rows and a load-more button', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      playlists: {
        items: [{ id: 's1', name: 'Search Hit', description: '', external_urls: { spotify: 'http://s' },
          tracks: { total: 3 }, owner: { display_name: '' } }],
        total: 10, next: 'http://next',
      },
    }) }));
  await page.locator('#btn-search-public-pls').click();
  await page.evaluate(async () => { await runPublicSearch('hit'); });
  await expect(page.locator('#search-public-content')).toContainText('Search Hit');
  await expect(page.locator('#btn-load-more-public')).toBeVisible();
});

test('loadMorePublicSearch appends to the existing list', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  let call = 0;
  await page.route('**/api.spotify.com/**', route => {
    call++;
    const items = [{ id: 'r' + call, name: 'R' + call, description: '',
      external_urls: { spotify: 'http://r' + call }, tracks: { total: 1 }, owner: { display_name: '' } }];
    const next = call === 1 ? 'http://n' : null;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      playlists: { items, total: 2, next },
    }) });
  });
  await page.locator('#btn-search-public-pls').click();
  await page.evaluate(async () => { await runPublicSearch('q'); });
  await page.evaluate(async () => { await loadMorePublicSearch(); });
  await expect(page.locator('#search-public-content')).toContainText('R1');
  await expect(page.locator('#search-public-content')).toContainText('R2');
});

test('loadMorePublicSearch handles a Spotify fetch error with a toast', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  let call = 0;
  await page.route('**/api.spotify.com/**', route => {
    call++;
    if (call === 1) {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        playlists: { items: [{ id: 'a', name: 'A', description: '', external_urls: { spotify: 'http://a' },
          tracks: { total: 1 }, owner: { display_name: '' } }], total: 2, next: 'http://n' },
      }) });
    } else {
      route.fulfill({ status: 500, body: 'boom' });
    }
  });
  await page.locator('#btn-search-public-pls').click();
  await page.evaluate(async () => { await runPublicSearch('q'); });
  await page.evaluate(async () => { await loadMorePublicSearch(); });
  await expect(page.locator('body > div').filter({ hasText: /Spotify API 500/ })).toBeVisible();
});

test('runPublicSearch handles a Spotify error', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route => route.fulfill({ status: 500, body: 'bad' }));
  await page.locator('#btn-search-public-pls').click();
  await page.evaluate(async () => { await runPublicSearch('q'); });
  await expect(page.locator('#search-public-content')).toContainText(/Spotify API 500/);
});

test('runPublicSearch with no hits shows a "no matches" message', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      playlists: { items: [], total: 0, next: null },
    }) }));
  await page.locator('#btn-search-public-pls').click();
  await page.evaluate(async () => { await runPublicSearch('nothing'); });
  await expect(page.locator('#search-public-content')).toContainText('No matches');
});

// ── Playlist details modal ──────────────────────────────────────────────────

test('openPlaylistDetails loads tracks and renders the songs table', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [
        { track: { id: 't1', name: 'A', uri: 'u', artists: [{ name: 'Alpha' }], album: { release_date: '1999-01-01' } }},
        { track: { id: 't2', name: 'B', uri: 'u', artists: [{ name: 'Beta'  }], album: { release_date: '2010-01-01' } }},
      ], total: 2,
    }) }));
  await page.evaluate(async () => {
    await openPlaylistDetails({ url: 'https://open.spotify.com/playlist/' + 'A'.repeat(22), name: 'My PL', tracksTotal: 2, owner: 'O' });
  });
  await expect(page.locator('#details-pl-content')).toContainText('Alpha');
  await expect(page.locator('#details-pl-content')).toContainText('Beta');
});

test('openPlaylistDetails normalizes a string URL argument', async ({ page }) => {
  await page.evaluate(async () => {
    await openPlaylistDetails('https://open.spotify.com/playlist/' + 'A'.repeat(22));
  });
  await expect(page.locator('#modal-pl-details')).toHaveClass(/active/);
});

test('openPlaylistDetails with a missing URL toasts an error', async ({ page }) => {
  await page.evaluate(async () => { await openPlaylistDetails({ url: '' }); });
  await expect(page.locator('body > div').filter({ hasText: 'Invalid playlist' })).toBeVisible();
});

test('openPlaylistDetails with an invalid URL renders an error inside the modal', async ({ page }) => {
  await page.evaluate(async () => {
    await openPlaylistDetails({ url: 'https://not.spotify/whatever', name: 'X' });
  });
  await expect(page.locator('#details-pl-content')).toContainText('Invalid playlist URL');
});

test('openPlaylistDetails handles a Spotify fetch failure', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route => route.fulfill({ status: 500, body: 'bad' }));
  await page.evaluate(async () => {
    await openPlaylistDetails({ url: 'https://open.spotify.com/playlist/' + 'A'.repeat(22), name: 'X' });
  });
  await expect(page.locator('#details-pl-content')).toContainText('Failed to load');
});

test('songs table sort header toggles ascending/descending and switches columns', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [
        { track: { id: '1', name: 'Cdef', uri: 'u', artists: [{ name: 'Alpha' }], album: { release_date: '2010-01-01' } }},
        { track: { id: '2', name: 'Abcd', uri: 'u', artists: [{ name: 'Beta'  }], album: { release_date: '2000-01-01' } }},
        { track: { id: '3', name: 'Bcde', uri: 'u', artists: [{ name: 'Gamma' }], album: { release_date: '2020-01-01' } }},
      ], total: 3,
    }) }));
  await page.evaluate(async () => {
    await openPlaylistDetails({ url: 'https://open.spotify.com/playlist/' + 'A'.repeat(22), name: 'P' });
  });
  // Sort by name ascending.
  await page.locator('th[data-sort="name"]').click();
  let names = await page.locator('#details-pl-content tbody tr td:nth-child(2)').allTextContents();
  expect(names).toEqual(['Abcd', 'Bcde', 'Cdef']);
  // Click again → descending.
  await page.locator('th[data-sort="name"]').click();
  names = await page.locator('#details-pl-content tbody tr td:nth-child(2)').allTextContents();
  expect(names).toEqual(['Cdef', 'Bcde', 'Abcd']);
  // Click year → ascending by year.
  await page.locator('th[data-sort="year"]').click();
  const years = await page.locator('#details-pl-content tbody tr td:nth-child(3)').allTextContents();
  expect(years).toEqual(['2000', '2010', '2020']);
});

test('songs table empty playlist shows the "No tracks" message', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) }));
  await page.evaluate(async () => {
    await openPlaylistDetails({ url: 'https://open.spotify.com/playlist/' + 'A'.repeat(22), name: 'Empty' });
  });
  await expect(page.locator('#details-pl-content')).toContainText('No tracks in this playlist');
});

// ── Click handlers wired by renderPublicSearchList / wirePlaylistRows ───────

test('selecting a row from My Playlists fills inputs and closes the modal', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [{ id: 'p1', name: 'Pick', description: '', external_urls: { spotify: 'http://u' },
        tracks: { total: 1 }, owner: { display_name: '' } }],
      total: 1, next: null,
    }) }));
  await page.locator('#btn-show-spotify-pls').click();
  await page.locator('#modal-pls-content .pl-item').first().click();
  await expect(page.locator('#modal-spotify-pls')).not.toHaveClass(/active/);
  await expect(page.locator('#input-url')).toHaveValue('http://u');
});

test('clicking the details icon on a row opens the song-details modal', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  let call = 0;
  await page.route('**/api.spotify.com/**', route => {
    call++;
    if (call === 1) {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        items: [{ id: 'p1', name: 'Show', description: '', external_urls: { spotify: 'http://x' },
          tracks: { total: 0 }, owner: { display_name: '' } }],
        total: 1, next: null,
      }) });
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) });
    }
  });
  await page.locator('#btn-show-spotify-pls').click();
  await page.locator('#modal-pls-content [data-details]').first().click();
  await expect(page.locator('#modal-pl-details')).toHaveClass(/active/);
});

// ── markPlaylistPlayed for a non-existent URL is a no-op ──────────────────

test('markPlaylistPlayed for an unknown URL does nothing', async ({ page }) => {
  await page.evaluate(() => markPlaylistPlayed('http://not-saved'));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('songster.playlists')));
  expect(stored).toEqual([]);
});

test.describe('playlists wiring', () => {
  test.beforeEach(async ({ page, baseURL }) => { await gotoPlaylistsAuthed(page, baseURL); });

  test('Back from playlists returns to the auth screen', async ({ page }) => {
    await page.locator('#btn-back-playlists').click();
    await expect(page.locator('#screen-auth')).toHaveClass(/active/);
  });

  test('About modal opens and shows the user display name', async ({ page }) => {
    await page.locator('#btn-about').click();
    await expect(page.locator('#modal-about')).toHaveClass(/active/);
    await expect(page.locator('#about-user-name')).toHaveText('Mock User');
  });

  test('About modal hides user block when /me fetch fails', async ({ page }) => {
    await page.unroute('**/api.spotify.com/**');
    await page.route('**/api.spotify.com/**', route => route.fulfill({ status: 500, body: 'x' }));
    await page.locator('#btn-about').click();
    await expect(page.locator('#about-user')).toBeHidden();
  });

  test('Save button persists the typed URL + description', async ({ page }) => {
    await page.locator('#input-url').fill(VALID_URL);
    await page.locator('#input-desc').fill('Typed');
    await page.locator('#btn-save').click();
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('songster.playlists') || '[]'));
    expect(stored).toHaveLength(1);
    expect(stored[0].description).toBe('Typed');
  });

  test('Save button shows a toast on success', async ({ page }) => {
    await page.locator('#input-url').fill(VALID_URL);
    await page.locator('#input-desc').fill('Toasted');
    await page.locator('#btn-save').click();
    await expect(page.locator('body > div').filter({ hasText: /Saved playlist/ })).toBeVisible();
  });

  test('Start button rejects an empty URL', async ({ page }) => {
    await page.evaluate(() => { $('#btn-start').disabled = false; });
    await page.locator('#btn-start').click();
    await expect(page.locator('#playlists-msg .err')).toContainText('Playlist URL must be set');
  });

  test('Start button rejects an invalid URL', async ({ page }) => {
    await page.locator('#input-url').fill('https://example.com/nope');
    await page.locator('#btn-start').click();
    await expect(page.locator('#playlists-msg .err')).toContainText('Invalid Spotify playlist URL');
  });

  test('Start button reports zero-tracks playlists', async ({ page }) => {
    await page.unroute('**/api.spotify.com/**');
    await page.route('**/api.spotify.com/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        name: 'Empty PL', tracks: { total: 0 },
      }) }));
    await page.locator('#input-url').fill(VALID_URL);
    await page.locator('#btn-start').click();
    await expect(page.locator('#playlists-msg .err')).toContainText('has no songs');
  });

  test('Start button surfaces a Spotify check error', async ({ page }) => {
    await page.unroute('**/api.spotify.com/**');
    await page.route('**/api.spotify.com/**', route => route.fulfill({ status: 500, body: 'boom' }));
    await page.locator('#input-url').fill(VALID_URL);
    await page.locator('#btn-start').click();
    await expect(page.locator('#playlists-msg .err')).toContainText('Could not load playlist');
  });

  test('Start button navigates to the quiz screen for a valid playlist', async ({ page }) => {
    await installFakeSdk(page);
    await page.locator('#input-url').fill(VALID_URL);
    await page.locator('#input-desc').fill('Quiz Pl');
    await page.locator('#btn-start').click();
    await expect(page.locator('#screen-quiz')).toHaveClass(/active/);
  });

  test('Details button rejects with empty input', async ({ page }) => {
    await page.locator('#btn-details').click();
    await expect(page.locator('#playlists-msg .err')).toContainText('Enter a playlist URL first');
  });

  test('Details button rejects an invalid URL', async ({ page }) => {
    await page.locator('#input-url').fill('https://nope.invalid/no');
    await page.locator('#btn-details').click();
    await expect(page.locator('#playlists-msg .err')).toContainText('Invalid playlist URL');
  });

  test('Details button opens the details modal for a valid URL', async ({ page }) => {
    await page.locator('#input-url').fill(VALID_URL);
    await page.locator('#input-desc').fill('Some PL');
    await page.locator('#btn-details').click();
    await expect(page.locator('#modal-pl-details')).toHaveClass(/active/);
  });

  test('Use-this button on the details modal copies it into the inputs', async ({ page }) => {
    await page.evaluate(() => {
      detailsCurrentPl = { url: 'http://chosen-url', name: 'Chosen Name' };
      document.getElementById('modal-pl-details').classList.add('active');
    });
    await page.locator('#details-pl-use').click();
    await expect(page.locator('#input-url')).toHaveValue('http://chosen-url');
    await expect(page.locator('#input-desc')).toHaveValue('Chosen Name');
  });

  test('Export button triggers a JSON download', async ({ page }) => {
    await page.evaluate(() =>
      savePlaylist({ playlistUrl: 'https://open.spotify.com/playlist/' + 'A'.repeat(22), description: 'Export Me' }));
    // Capture the click flow without actually downloading — assert that anchor was clicked.
    const triggered = await page.evaluate(() => {
      let clicked = '';
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() { clicked = this.download; };
      $('#btn-export').click();
      HTMLAnchorElement.prototype.click = orig;
      return clicked;
    });
    expect(triggered).toBe('songster-playlists.json');
  });

  test('Import accepts a JSON file with a playlists array', async ({ page }) => {
    const json = JSON.stringify({
      playlists: [
        { playlistUrl: 'https://open.spotify.com/playlist/' + 'A'.repeat(22), description: 'Imported' },
      ],
    });
    await page.setInputFiles('#file-import', {
      name: 'pl.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    await expect(page.locator('body > div').filter({ hasText: 'Imported 1 playlists' })).toBeVisible();
  });

  test('Import accepts a plain JSON array of playlists', async ({ page }) => {
    const json = JSON.stringify([
      { playlistUrl: 'https://open.spotify.com/playlist/' + 'B'.repeat(22), description: 'ArrImp' },
    ]);
    await page.setInputFiles('#file-import', {
      name: 'pl.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    await expect(page.locator('body > div').filter({ hasText: 'Imported 1 playlists' })).toBeVisible();
  });

  test('Import rejects an invalid JSON format with a toast', async ({ page }) => {
    await page.setInputFiles('#file-import', {
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('not valid JSON {{{'),
    });
    await expect(page.locator('body > div').filter({ hasText: /Import failed/ })).toBeVisible();
  });

  test('Reset-history confirm clears + reseeds defaults', async ({ page }) => {
    await page.evaluate(() =>
      savePlaylist({ playlistUrl: 'https://open.spotify.com/playlist/' + 'A'.repeat(22), description: 'Pre' }));
    await page.locator('#btn-reset-history').click();
    await page.locator('#confirm-ok').click();
    await page.waitForTimeout(50);
    // Defaults seeding hit our /users/<id>/playlists mock which returns empty.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('songster.playlists')));
    expect(stored).toEqual([]);
  });

  test('Reset-history cancel keeps existing playlists', async ({ page }) => {
    await page.evaluate(() =>
      savePlaylist({ playlistUrl: 'https://open.spotify.com/playlist/' + 'A'.repeat(22), description: 'Pre' }));
    await page.locator('#btn-reset-history').click();
    await page.locator('#confirm-cancel').click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('songster.playlists')));
    expect(stored).toHaveLength(1);
  });

  test('history search-public Enter key triggers a search', async ({ page }) => {
    await page.locator('#btn-search-public-pls').click();
    await page.locator('#search-public-q').fill('rock');
    await page.locator('#search-public-q').press('Enter');
    // Mock returns empty — meta should update.
    await expect(page.locator('#search-public-content')).toBeAttached();
  });

  test('history sort toggles direction when clicking the same column twice', async ({ page }) => {
    await page.evaluate(() => {
      savePlaylist({ playlistUrl: 'https://open.spotify.com/playlist/' + 'A'.repeat(22), description: 'Z' });
      savePlaylist({ playlistUrl: 'https://open.spotify.com/playlist/' + 'B'.repeat(22), description: 'A' });
    });
    // date is the default; click name twice.
    await page.locator('.history-sort-btn[data-sort="name"]').click();
    await page.locator('.history-sort-btn[data-sort="name"]').click();
    let names = await page.locator('#history-list .desc').allTextContents();
    expect(names[0]).toBe('Z');
  });
});

// ── app.js: btn-check catches Spotify errors ───────────────────────────────

test('Check button surfaces a Spotify error message', async ({ page, baseURL }) => {
  await gotoPlaylistsAuthed(page, baseURL);
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route => route.fulfill({ status: 404, body: 'no such' }));
  await page.locator('#input-url').fill('https://open.spotify.com/playlist/' + 'A'.repeat(22));
  await page.locator('#btn-check').click();
  await expect(page.locator('#playlists-msg .err')).toContainText(/Spotify API 404/);
});
// ── app.js: btn-start ensurePlayer rejection ───────────────────────────────

test('Start button reports a player init failure', async ({ page, baseURL }) => {
  // Ensure /playlists/.../tracks returns at least one track so loadQuizPlaylist
  // doesn't set its own "No tracks available" error and steal the assertion.
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route => {
    const url = route.request().url();
    let body = {};
    if (url.includes('/playlists/') && url.includes('/tracks')) {
      body = { items: [
        { track: { id: 't', name: 'N', uri: 'u', artists: [], album: { release_date: '2000-01-01' } } },
      ], total: 1 };
    } else if (url.includes('/playlists/')) {
      body = { name: 'P', tracks: { total: 1 } };
    } else if (url.includes('/me')) {
      body = { id: 'me' };
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.evaluate(() => {
    settings.autoplay = false; persistSettings();
    window.Spotify = { Player: class {
      constructor(o) { o.getOAuthToken(() => {}); }
      addListener() {}
      connect() { return Promise.resolve(false); }
    }};
  });
  await page.locator('#input-url').fill('https://open.spotify.com/playlist/' + 'A'.repeat(22));
  await page.locator('#input-desc').fill('X');
  await page.locator('#btn-start').click();
  await expect(page.locator('#quiz-msg .err')).toContainText(/Player init failed/);
});
// ── playlists.js: details icon on a saved history row ──────────────────────

test('history row details icon opens the playlist details modal', async ({ page, baseURL }) => {
  await gotoPlaylistsAuthed(page, baseURL);
  await page.evaluate(() =>
    savePlaylist({ playlistUrl: 'https://open.spotify.com/playlist/' + 'A'.repeat(22), description: 'X' }));
  await page.locator('#history-list [data-details="0"]').click();
  await expect(page.locator('#modal-pl-details')).toHaveClass(/active/);
});

// ── playlists.js: load-more for my playlists catches errors ────────────────

test('My Playlists load-more shows a toast on error', async ({ page, baseURL }) => {
  await gotoPlaylistsAuthed(page, baseURL);
  await page.unroute('**/api.spotify.com/**');
  let call = 0;
  // Single combined handler — when route() is stacked, the most recently added
  // handler wins, so a "catch-all" added after a specific one masks the specific
  // one. Branch inside one handler instead.
  await page.route('**/api.spotify.com/**', route => {
    const url = route.request().url();
    if (url.includes('/me/playlists')) {
      call++;
      if (call === 1) {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          items: [{ id: 'p1', name: 'A', description: '', external_urls: { spotify: 'http://x' },
            tracks: { total: 1 }, owner: { display_name: '' } }],
          total: 2, next: 'http://n',
        }) });
      } else {
        route.fulfill({ status: 500, body: 'boom' });
      }
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });
  await page.evaluate(async () => { await openSpotifyPlsModal(); });
  // Capture toast() now so we don't pick up open-modal toast noise.
  await page.evaluate(() => {
    window.__toasts = [];
    const orig = window.toast;
    window.toast = (msg, kind) => { window.__toasts.push({ msg, kind }); return orig(msg, kind); };
  });
  await page.evaluate(async () => { await loadMoreSpotifyPls(); });
  const out = await page.evaluate(() => ({
    toasts: window.__toasts,
    next: modalPlsNext,
    cache: modalPlsCache.length,
  }));
  expect(out.toasts.some(t => /Spotify API 500/.test(t.msg))).toBe(true);
});

// ── playlists.js: songs table tied-sort case (cmp returns 0) ───────────────

test('songs table cmp returns 0 for two equal-name rows', async ({ page, baseURL }) => {
  await gotoPlaylistsAuthed(page, baseURL);
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [
        { track: { id: '1', name: 'Same', uri: 'u', artists: [{ name: 'A' }], album: { release_date: '2000-01-01' } }},
        { track: { id: '2', name: 'Same', uri: 'u', artists: [{ name: 'B' }], album: { release_date: '2010-01-01' } }},
      ], total: 2,
    }) }));
  await page.evaluate(async () => {
    await openPlaylistDetails({ url: 'https://open.spotify.com/playlist/' + 'A'.repeat(22), name: 'P' });
  });
  await page.locator('th[data-sort="name"]').click();
  await expect(page.locator('#details-pl-content tbody tr')).toHaveCount(2);
});
// ── playlists.js: loadPlaylists handles corrupt JSON ───────────────────────

test('loadPlaylists returns [] on corrupt JSON', async ({ page, baseURL }) => {
  await gotoPlaylistsAuthed(page, baseURL);
  await page.evaluate(() => localStorage.setItem('songster.playlists', 'not json {{{'));
  const out = await page.evaluate(() => loadPlaylists());
  expect(out).toEqual([]);
});

// ── playlists.js: sortedHistory tolerates missing description / playlistUrl ──

test('sortedHistory filter tolerates entries with null description/playlistUrl', async ({ page, baseURL }) => {
  await gotoPlaylistsAuthed(page, baseURL);
  await page.evaluate(() => {
    localStorage.setItem('songster.playlists', JSON.stringify([
      { description: null, playlistUrl: null },
    ]));
    historyQuery = 'anything';
  });
  // Should not throw despite null fields.
  const out = await page.evaluate(() => sortedHistory());
  expect(Array.isArray(out)).toBe(true);
});
