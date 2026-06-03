import { test, expect, gotoApp, installSpotifyMocks } from './fixtures.js';

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

// ── loadAuth / saveAuth ─────────────────────────────────────────────────────

test('loadAuth returns null when no auth is stored', async ({ page }) => {
  const out = await page.evaluate(() => loadAuth());
  expect(out).toBeNull();
});

test('loadAuth returns null for corrupt JSON in localStorage', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('songster.auth', 'not json {{'));
  const out = await page.evaluate(() => loadAuth());
  expect(out).toBeNull();
});

test('loadAuth returns null when access_token is missing', async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem('songster.auth', JSON.stringify({ refresh_token: 'x' })));
  const out = await page.evaluate(() => loadAuth());
  expect(out).toBeNull();
});

test('loadAuth returns the parsed object when access_token is present', async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem('songster.auth', JSON.stringify({ access_token: 'aa' })));
  const out = await page.evaluate(() => loadAuth());
  expect(out.access_token).toBe('aa');
});

test('saveAuth(null) clears the stored auth', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('songster.auth', JSON.stringify({ access_token: 'a' }));
    saveAuth(null);
  });
  const raw = await page.evaluate(() => localStorage.getItem('songster.auth'));
  expect(raw).toBeNull();
});

// ── isAuthValid ─────────────────────────────────────────────────────────────

test('isAuthValid is false when expires_at has passed', async ({ page }) => {
  const out = await page.evaluate(() => {
    auth = { access_token: 'x', expires_at: Date.now() - 1000 };
    return isAuthValid();
  });
  expect(out).toBe(false);
});

test('isAuthValid is true when expires_at is comfortably in the future', async ({ page }) => {
  const out = await page.evaluate(() => {
    auth = { access_token: 'x', expires_at: Date.now() + 600_000 };
    return isAuthValid();
  });
  expect(out).toBe(true);
});

// ── ensureAccessToken ───────────────────────────────────────────────────────

test('ensureAccessToken returns the current token when still valid', async ({ page }) => {
  const tok = await page.evaluate(async () => {
    auth = { access_token: 'still-good', expires_at: Date.now() + 600_000 };
    return await ensureAccessToken();
  });
  expect(tok).toBe('still-good');
});

test('ensureAccessToken refreshes using the refresh_token when expired', async ({ page }) => {
  const tok = await page.evaluate(async () => {
    auth = { access_token: 'old', refresh_token: 'r', expires_at: Date.now() - 1 };
    saveAuth(auth);
    return await ensureAccessToken();
  });
  expect(tok).toBe('mock_token');
});

test('ensureAccessToken clears auth and throws when refresh fails', async ({ page }) => {
  await page.unroute('**/accounts.spotify.com/**');
  await page.route('**/accounts.spotify.com/**', route => route.fulfill({ status: 400, body: 'bad' }));
  const err = await page.evaluate(async () => {
    auth = { access_token: 'old', refresh_token: 'r', expires_at: Date.now() - 1 };
    try { await ensureAccessToken(); return null; }
    catch (e) { return e.message; }
  });
  expect(err).toMatch(/Not authenticated/);
});

test('ensureAccessToken with no refresh_token clears auth and throws', async ({ page }) => {
  const err = await page.evaluate(async () => {
    auth = { access_token: 'old', expires_at: Date.now() - 1 };
    try { await ensureAccessToken(); return null; }
    catch (e) { return e.message; }
  });
  expect(err).toMatch(/Not authenticated/);
});

// ── beginLogin ──────────────────────────────────────────────────────────────

test('beginLogin throws when the popup is blocked', async ({ page }) => {
  const err = await page.evaluate(async () => {
    window.open = () => null;
    try { await beginLogin(); return null; }
    catch (e) { return e.message; }
  });
  expect(err).toMatch(/Popup blocked/);
});

test('beginLogin opens a popup and stores PKCE artifacts', async ({ page }) => {
  await page.evaluate(async () => {
    window.open = () => ({ close: () => {} });
    await beginLogin();
  });
  const verifier = await page.evaluate(() => localStorage.getItem('songster.pkce_verifier'));
  const state = await page.evaluate(() => localStorage.getItem('songster.pkce_state'));
  expect(verifier).toBeTruthy();
  expect(state).toBeTruthy();
});

// ── exchangeCodeForToken ────────────────────────────────────────────────────

test('exchangeCodeForToken throws when the PKCE verifier is missing', async ({ page }) => {
  const err = await page.evaluate(async () => {
    localStorage.removeItem('songster.pkce_verifier');
    try { await exchangeCodeForToken('codeXYZ', 'state1'); return null; }
    catch (e) { return e.message; }
  });
  expect(err).toMatch(/Missing PKCE verifier/);
});

test('exchangeCodeForToken throws on a state mismatch', async ({ page }) => {
  const err = await page.evaluate(async () => {
    localStorage.setItem('songster.pkce_verifier', 'v');
    localStorage.setItem('songster.pkce_state', 'expected');
    try { await exchangeCodeForToken('codeXYZ', 'different'); return null; }
    catch (e) { return e.message; }
  });
  expect(err).toMatch(/State mismatch/);
});

test('exchangeCodeForToken throws when the token endpoint returns non-ok', async ({ page }) => {
  await page.unroute('**/accounts.spotify.com/**');
  await page.route('**/accounts.spotify.com/**', route =>
    route.fulfill({ status: 500, body: 'oops' }));
  const err = await page.evaluate(async () => {
    localStorage.setItem('songster.pkce_verifier', 'v');
    localStorage.setItem('songster.pkce_state', 'state1');
    try { await exchangeCodeForToken('codeXYZ', 'state1'); return null; }
    catch (e) { return e.message; }
  });
  expect(err).toMatch(/Token exchange failed/);
});

test('exchangeCodeForToken persists auth and wipes the PKCE artifacts on success', async ({ page }) => {
  await page.evaluate(async () => {
    localStorage.setItem('songster.pkce_verifier', 'v');
    localStorage.setItem('songster.pkce_state', 'state1');
    await exchangeCodeForToken('codeXYZ', 'state1');
  });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('songster.auth')));
  expect(stored.access_token).toBe('mock_token');
  expect(await page.evaluate(() => localStorage.getItem('songster.pkce_verifier'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('songster.pkce_state'))).toBeNull();
});

// ── listenForCallbackMessage ────────────────────────────────────────────────

// The callback listener checks event.origin against the universal-callback
// URL's origin; window.postMessage in the same window keeps the page's own
// origin, so we synthesize a MessageEvent with the expected origin instead.
const EXPECTED_ORIGIN = 'https://thorsten-klein.github.io';

test('callback message with a code triggers a token exchange', async ({ page }) => {
  await page.evaluate(async (origin) => {
    window.open = () => ({ close: () => {} });
    await beginLogin();
    window.dispatchEvent(new MessageEvent('message', {
      origin,
      data: {
        type: 'oauth-callback',
        params: { code: 'authcode', state: localStorage.getItem('songster.pkce_state') },
      },
    }));
    await new Promise(r => setTimeout(r, 200));
  }, EXPECTED_ORIGIN);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('songster.auth') || 'null'));
  expect(stored?.access_token).toBe('mock_token');
});

test('callback message carrying an error renders an auth error', async ({ page }) => {
  await page.evaluate(async (origin) => {
    window.open = () => ({ close: () => {} });
    await beginLogin();
    window.dispatchEvent(new MessageEvent('message', {
      origin,
      data: {
        type: 'oauth-callback',
        params: { error: 'access_denied', error_description: 'user said no' },
      },
    }));
    await new Promise(r => setTimeout(r, 100));
  }, EXPECTED_ORIGIN);
  await expect(page.locator('#modal-auth-error')).toHaveClass(/active/);
});

test('callback message with no code renders an auth error', async ({ page }) => {
  await page.evaluate(async (origin) => {
    window.open = () => ({ close: () => {} });
    await beginLogin();
    window.dispatchEvent(new MessageEvent('message', {
      origin,
      data: { type: 'oauth-callback', params: {} },
    }));
    await new Promise(r => setTimeout(r, 100));
  }, EXPECTED_ORIGIN);
  await expect(page.locator('#modal-auth-error')).toHaveClass(/active/);
});

test('callback message with a code but failing exchange renders an error', async ({ page }) => {
  await page.unroute('**/accounts.spotify.com/**');
  await page.route('**/accounts.spotify.com/**', route =>
    route.fulfill({ status: 500, body: 'boom' }));
  await page.evaluate(async (origin) => {
    window.open = () => ({ close: () => {} });
    await beginLogin();
    window.dispatchEvent(new MessageEvent('message', {
      origin,
      data: {
        type: 'oauth-callback',
        params: { code: 'authcode', state: localStorage.getItem('songster.pkce_state') },
      },
    }));
    await new Promise(r => setTimeout(r, 200));
  }, EXPECTED_ORIGIN);
  await expect(page.locator('#modal-auth-error')).toHaveClass(/active/);
});

test('callback handler ignores unrelated postMessages', async ({ page }) => {
  await page.evaluate(async (origin) => {
    window.open = () => ({ close: () => {} });
    await beginLogin();
    // Wrong origin → ignored.
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://evil.example',
      data: { type: 'oauth-callback', params: { code: 'x' } },
    }));
    // Right origin but missing the type → also ignored.
    window.dispatchEvent(new MessageEvent('message', {
      origin, data: { type: 'something-else' },
    }));
    // Right origin but null data → also ignored.
    window.dispatchEvent(new MessageEvent('message', { origin, data: null }));
    await new Promise(r => setTimeout(r, 50));
  }, EXPECTED_ORIGIN);
  const stored = await page.evaluate(() => localStorage.getItem('songster.auth'));
  expect(stored).toBeNull();
});

// ── updateAuthUi ────────────────────────────────────────────────────────────

test('updateAuthUi shows step1 when not authenticated', async ({ page }) => {
  await page.evaluate(() => { auth = null; updateAuthUi(); });
  await expect(page.locator('#auth-step1')).toBeVisible();
  await expect(page.locator('#auth-connected')).toBeHidden();
});

test('updateAuthUi shows the connected block when authenticated', async ({ page }) => {
  await page.evaluate(() => {
    auth = { access_token: 'x', expires_at: Date.now() + 600_000 };
    updateAuthUi();
  });
  await expect(page.locator('#auth-connected')).toBeVisible();
  await expect(page.locator('#auth-step1')).toBeHidden();
});
test('boot with a new ?cid= param wipes localStorage', async ({ page, baseURL }) => {
  await installSpotifyMocks(page);
  // First visit: seed localStorage with a different CID and a marker key.
  await page.goto(baseURL);
  await page.evaluate(() => {
    localStorage.setItem('songster.last_cid', 'oldcid');
    localStorage.setItem('songster.marker', 'kept?');
  });
  // Re-load with a new ?cid= param.
  await page.goto(baseURL + '?cid=newcid');
  const marker = await page.evaluate(() => localStorage.getItem('songster.marker'));
  const cid = await page.evaluate(() => localStorage.getItem('songster.last_cid'));
  expect(marker).toBeNull();
  expect(cid).toBe('newcid');
  await expect(page.locator('#cfg-client-id')).toHaveValue('newcid');
});

test('boot with a valid auth lands on the playlists screen', async ({ page, baseURL }) => {
  await installSpotifyMocks(page);
  await page.goto(baseURL);
  await page.evaluate(() => {
    localStorage.setItem('songster.auth', JSON.stringify({
      access_token: 'x', refresh_token: 'r', expires_at: Date.now() + 600_000,
    }));
  });
  await page.goto(baseURL);
  await expect(page.locator('#screen-playlists')).toHaveClass(/active/, { timeout: 5000 });
});

test.describe('auth wiring', () => {
  test.beforeEach(async ({ page, baseURL }) => { await gotoApp(page, baseURL); });

  test('clicking login with a custom CID stores it and triggers PKCE login', async ({ page }) => {
    await page.evaluate(() => { window.open = () => ({ close: () => {} }); });
    await page.locator('#cfg-client-id').fill('custom-cid');
    await page.locator('#btn-login').click();
    await page.waitForTimeout(50);
    const lastCid = await page.evaluate(() => localStorage.getItem('songster.last_cid'));
    expect(lastCid).toBe('custom-cid');
  });

  test('clicking login with a blocked popup surfaces an auth error', async ({ page }) => {
    await page.evaluate(() => { window.open = () => null; });
    await page.locator('#btn-login').click();
    await expect(page.locator('#modal-auth-error')).toHaveClass(/active/);
  });

  test('clicking login with empty CID falls back to the default', async ({ page }) => {
    await page.evaluate(() => { window.open = () => ({ close: () => {} }); });
    await page.locator('#btn-login').click();
    await page.waitForTimeout(50);
    const lastCid = await page.evaluate(() => localStorage.getItem('songster.last_cid'));
    expect(lastCid).toBe('5b670fc5c4ec45e6bf988a07d8ab35c7');
  });

  test('Disconnect button wipes auth and returns the UI to the login state', async ({ page }) => {
    await page.evaluate(() => {
      auth = { access_token: 'a', expires_at: Date.now() + 600_000 };
      updateAuthUi();
    });
    await page.locator('#btn-disconnect').click();
    await expect(page.locator('#auth-step1')).toBeVisible();
  });

  test('typing in the CID input disconnects an existing auth', async ({ page }) => {
    await page.evaluate(() => {
      auth = { access_token: 'a', expires_at: Date.now() + 600_000 };
      saveAuth(auth);
      updateAuthUi();
    });
    await page.locator('#cfg-client-id').focus();
    await page.locator('#cfg-client-id').fill('different');
    expect(await page.evaluate(() => localStorage.getItem('songster.auth'))).toBeNull();
  });

  test('typing the same CID does not disconnect', async ({ page }) => {
    await page.evaluate(() => {
      auth = { access_token: 'a', expires_at: Date.now() + 600_000 };
      saveAuth(auth);
      $('#cfg-client-id').value = 'same';
    });
    await page.locator('#cfg-client-id').focus();
    // Type same value back (no change) — handler should early-out.
    await page.evaluate(() => {
      $('#cfg-client-id').dispatchEvent(new Event('input'));
    });
    expect(await page.evaluate(() => localStorage.getItem('songster.auth'))).not.toBeNull();
  });

  test('Continue button after auth navigates to playlists', async ({ page }) => {
    await page.evaluate(() => {
      auth = { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 600_000 };
      saveAuth(auth);
      updateAuthUi();
    });
    await page.locator('#btn-continue-auth').click();
    await expect(page.locator('#screen-playlists')).toHaveClass(/active/);
  });

  test('Cancelled clear-storage confirm leaves data untouched', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('songster.marker', 'kept'));
    await page.locator('#btn-clear-storage').click();
    await page.locator('#confirm-cancel').click();
    expect(await page.evaluate(() => localStorage.getItem('songster.marker'))).toBe('kept');
  });
});

// ── ensureAccessToken: refreshed expires_at is preserved ───────────────────

test('ensureAccessToken stores the refreshed expires_at correctly', async ({ page, baseURL }) => {
  await gotoApp(page, baseURL);
  await page.evaluate(async () => {
    auth = { access_token: 'old', refresh_token: 'r', expires_at: Date.now() - 1 };
    saveAuth(auth);
    await ensureAccessToken();
  });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('songster.auth')));
  expect(stored.expires_at).toBeGreaterThan(Date.now());
});
