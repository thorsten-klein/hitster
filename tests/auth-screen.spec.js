import { test, expect, gotoApp } from './fixtures.js';

test.beforeEach(async ({ page, baseURL }) => {
  await gotoApp(page, baseURL);
});

// ── Initial state ────────────────────────────────────────────────────────────

test('auth screen is the active screen on first load', async ({ page }) => {
  await expect(page.locator('#screen-auth')).toHaveClass(/active/);
  await expect(page.locator('#screen-playlists')).not.toHaveClass(/active/);
});

test('login button is visible on first load', async ({ page }) => {
  await expect(page.locator('#btn-login')).toBeVisible();
});

test('connected block is hidden when not authenticated', async ({ page }) => {
  await expect(page.locator('#auth-connected')).toBeHidden();
});

// ── Client ID input ──────────────────────────────────────────────────────────

test('client ID input accepts a custom value', async ({ page }) => {
  await page.locator('#cfg-client-id').fill('abc123customclientid');
  await expect(page.locator('#cfg-client-id')).toHaveValue('abc123customclientid');
});

test('client ID placeholder shows the default ID', async ({ page }) => {
  const placeholder = await page.locator('#cfg-client-id').getAttribute('placeholder');
  expect(placeholder).toBe('5b670fc5c4ec45e6bf988a07d8ab35c7');
});

// ── Copy buttons ─────────────────────────────────────────────────────────────
// `navigator.clipboard` is not writable in most browsers; instead we monkey-patch
// the in-app `copyToClipboard` helper to capture the value the button passes in.

test('copy-redirect button copies the universal-callback URL', async ({ page }) => {
  await page.evaluate(() => {
    window.__copied = null;
    window.copyToClipboard = (text) => { window.__copied = text; };
    // The copy-redirect button lives inside the collapsed <details> block.
    document.getElementById('spotify-config-details').open = true;
  });
  await page.locator('#btn-copy-redirect').click();
  const copied = await page.evaluate(() => window.__copied);
  expect(copied).toBe('https://thorsten-klein.github.io/universal-callback/index.html');
});

test('copy-link button uses the entered client ID when one is set', async ({ page }) => {
  await page.locator('#cfg-client-id').fill('my-custom-cid');
  await page.evaluate(() => {
    window.__copied = null;
    window.copyToClipboard = (text) => { window.__copied = text; };
  });
  await page.locator('#btn-copy-link').click();
  const copied = await page.evaluate(() => window.__copied);
  expect(copied).toMatch(/cid=my-custom-cid/);
});

test('copy-link button falls back to the default CID when input is empty', async ({ page }) => {
  await page.evaluate(() => {
    window.__copied = null;
    window.copyToClipboard = (text) => { window.__copied = text; };
  });
  await page.locator('#btn-copy-link').click();
  const copied = await page.evaluate(() => window.__copied);
  expect(copied).toMatch(/cid=5b670fc5c4ec45e6bf988a07d8ab35c7/);
});

// ── Clear storage ────────────────────────────────────────────────────────────

test('Clear-storage button confirms before wiping', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('songster.test_key', 'present'));
  await page.locator('#btn-clear-storage').click();
  await expect(page.locator('#modal-confirm')).toHaveClass(/active/);
  await expect(page.locator('#confirm-title')).toHaveText(/Clear all saved data/);
});

test('Cancelling the clear-storage confirm keeps localStorage intact', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('songster.test_key', 'present'));
  await page.locator('#btn-clear-storage').click();
  await page.locator('#confirm-cancel').click();
  await expect(page.locator('#modal-confirm')).not.toHaveClass(/active/);
  expect(await page.evaluate(() => localStorage.getItem('songster.test_key'))).toBe('present');
});

test('Confirming clear-storage wipes localStorage', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('songster.test_key', 'present'));
  await page.locator('#btn-clear-storage').click();
  await page.locator('#confirm-ok').click();
  expect(await page.evaluate(() => localStorage.getItem('songster.test_key'))).toBeNull();
});

// ── Auth error modal ─────────────────────────────────────────────────────────

test('auth error modal can be shown and dismissed', async ({ page }) => {
  await page.evaluate(() => showAuthError('something went wrong'));
  await expect(page.locator('#modal-auth-error')).toHaveClass(/active/);
  await page.locator('#modal-auth-error-close').click();
  await expect(page.locator('#modal-auth-error')).not.toHaveClass(/active/);
});
