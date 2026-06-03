import { test, expect, gotoApp } from './fixtures.js';

test.beforeEach(async ({ page, baseURL }) => {
  await gotoApp(page, baseURL);
});

// ── escHtml ──────────────────────────────────────────────────────────────────

test('escHtml escapes the five HTML special characters', async ({ page }) => {
  const out = await page.evaluate(() => escHtml(`<a href="x">&'</a>`));
  expect(out).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('escHtml handles null and undefined as empty string', async ({ page }) => {
  expect(await page.evaluate(() => escHtml(null))).toBe('');
  expect(await page.evaluate(() => escHtml(undefined))).toBe('');
});

test('escHtml passes through plain text unchanged', async ({ page }) => {
  expect(await page.evaluate(() => escHtml('hello world'))).toBe('hello world');
});

// ── fmtTime ──────────────────────────────────────────────────────────────────

test('fmtTime formats ms into M:SS', async ({ page }) => {
  expect(await page.evaluate(() => fmtTime(0))).toBe('0:00');
  expect(await page.evaluate(() => fmtTime(1500))).toBe('0:01');
  expect(await page.evaluate(() => fmtTime(65_000))).toBe('1:05');
  expect(await page.evaluate(() => fmtTime(125_000))).toBe('2:05');
});

test('fmtTime returns "0:00" for negative or missing input', async ({ page }) => {
  expect(await page.evaluate(() => fmtTime(-1000))).toBe('0:00');
  expect(await page.evaluate(() => fmtTime(null))).toBe('0:00');
  expect(await page.evaluate(() => fmtTime(undefined))).toBe('0:00');
});

test('fmtTime zero-pads single-digit seconds', async ({ page }) => {
  expect(await page.evaluate(() => fmtTime(63_000))).toBe('1:03');
});

// ── getPlaylistId ────────────────────────────────────────────────────────────

test('getPlaylistId extracts ID from an open.spotify.com URL', async ({ page }) => {
  const id = await page.evaluate(() =>
    getPlaylistId('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')
  );
  expect(id).toBe('37i9dQZF1DXcBWIGoYBM5M');
});

test('getPlaylistId extracts ID from a Spotify URI', async ({ page }) => {
  const id = await page.evaluate(() =>
    getPlaylistId('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')
  );
  expect(id).toBe('37i9dQZF1DXcBWIGoYBM5M');
});

test('getPlaylistId returns null for non-playlist URLs', async ({ page }) => {
  expect(await page.evaluate(() => getPlaylistId('https://example.com'))).toBeNull();
  expect(await page.evaluate(() => getPlaylistId('not a url'))).toBeNull();
  expect(await page.evaluate(() => getPlaylistId(''))).toBeNull();
});

// ── randStr ──────────────────────────────────────────────────────────────────

test('randStr returns a hex string of the requested length', async ({ page }) => {
  const s = await page.evaluate(() => randStr(32));
  expect(s).toHaveLength(32);
  expect(s).toMatch(/^[0-9a-f]+$/);
});

test('randStr returns different values on subsequent calls', async ({ page }) => {
  const [a, b] = await page.evaluate(() => [randStr(16), randStr(16)]);
  expect(a).not.toBe(b);
});

// ── sha256base64url ─────────────────────────────────────────────────────────

test('sha256base64url produces a URL-safe base64 digest', async ({ page }) => {
  const out = await page.evaluate(async () => sha256base64url('hello'));
  expect(out).toBe('LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ');
  expect(out).not.toMatch(/[+/=]/);
});
