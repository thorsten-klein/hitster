import { test, expect, gotoApp, gotoQuizGameMode, gotoPlaylistsAuthed } from './fixtures.js';

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

// ── confirmModal key handlers ───────────────────────────────────────────────

test('confirmModal resolves true when Enter is pressed', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = confirmModal({ title: 'k', message: '' });
    await new Promise(r => setTimeout(r, 5));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    return await p;
  });
  expect(result).toBe(true);
});

test('confirmModal resolves false when Escape is pressed', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = confirmModal({ title: 'k', message: '' });
    await new Promise(r => setTimeout(r, 5));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return await p;
  });
  expect(result).toBe(false);
});

test('confirmModal ignores keys other than Enter and Escape', async ({ page }) => {
  // Press an unrelated key, then cancel via the button to resolve.
  const result = await page.evaluate(async () => {
    const p = confirmModal({ title: 'k', message: '' });
    await new Promise(r => setTimeout(r, 5));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    $('#confirm-cancel').click();
    return await p;
  });
  expect(result).toBe(false);
});

test('confirmModal resolves false when the backdrop is clicked', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = confirmModal({ title: 'k', message: '' });
    await new Promise(r => setTimeout(r, 5));
    const root = document.getElementById('modal-confirm');
    root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return await p;
  });
  expect(result).toBe(false);
});

// ── copyToClipboard ─────────────────────────────────────────────────────────

test('copyToClipboard surfaces a success toast', async ({ page }) => {
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() },
      configurable: true,
    });
    copyToClipboard('hello', 'It worked');
    await new Promise(r => setTimeout(r, 30));
  });
  await expect(page.locator('body > div').filter({ hasText: 'It worked' })).toBeVisible();
});

test('copyToClipboard surfaces an error toast when the clipboard write fails', async ({ page }) => {
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
    copyToClipboard('hello');
    await new Promise(r => setTimeout(r, 100));
  });
  await expect(page.locator('body > div').filter({ hasText: 'Copy failed' })).toBeVisible();
});

// ── getTopOpenModal + handleHardwareBack ────────────────────────────────────

test('handleHardwareBack closes the top modal when one is open', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('modal-about').classList.add('active');
    handleHardwareBack();
  });
  await expect(page.locator('#modal-about')).not.toHaveClass(/active/);
});

test('handleHardwareBack routes confirm modal through its cancel button', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = confirmModal({ title: 'k', message: '' });
    await new Promise(r => setTimeout(r, 5));
    handleHardwareBack();
    return await p;
  });
  expect(result).toBe(false);
});

test('handleHardwareBack picks the highest-z modal when multiple are open', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('modal-about').classList.add('active');
    document.getElementById('modal-history-edit').classList.add('active'); // z-index 110
    handleHardwareBack();
  });
  await expect(page.locator('#modal-history-edit')).not.toHaveClass(/active/);
  await expect(page.locator('#modal-about')).toHaveClass(/active/);
});

test('handleHardwareBack on the auth screen is a no-op', async ({ page }) => {
  await page.evaluate(() => handleHardwareBack());
});

// ── installBackTrap (popstate handler) ──────────────────────────────────────

test('popstate event triggers handleHardwareBack', async ({ page }) => {
  await page.evaluate(async () => {
    document.getElementById('modal-about').classList.add('active');
    history.back();
    await new Promise(r => setTimeout(r, 20));
  });
  await expect(page.locator('#modal-about')).not.toHaveClass(/active/);
});

test('popstate handler on the playlists screen clicks back-playlists', async ({ page, baseURL }) => {
  await gotoPlaylistsAuthed(page, baseURL);
  await page.evaluate(async () => {
    history.back();
    await new Promise(r => setTimeout(r, 20));
  });
  await expect(page.locator('#screen-auth')).toHaveClass(/active/);
});

test('popstate handler on the quiz screen clicks back-quiz', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(async () => {
    history.back();
    await new Promise(r => setTimeout(r, 50));
  });
  await expect(page.locator('#screen-playlists')).toHaveClass(/active/);
});
