import { test, expect, gotoPlaylistsAuthed } from './fixtures.js';

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
