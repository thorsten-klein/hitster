import { test as base } from '@playwright/test';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const v8ToIstanbul = require('v8-to-istanbul');

const nycOutputDir = path.resolve(process.cwd(), '.nyc_output');
if (!fs.existsSync(nycOutputDir)) fs.mkdirSync(nycOutputDir, { recursive: true });

// All source files we want to capture coverage for.
const SRC_FILE_RE = /\/src\/(util|auth|spotify|playlists|quiz|game|app)\.js$/;

export const test = base.extend({
  page: async ({ page }, use) => {
    // page.coverage is Chromium-only — gracefully no-op on Firefox/WebKit.
    // The property exists as a non-function on other browsers, so try/catch.
    let hasCoverage = false;
    try {
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      hasCoverage = true;
    } catch {}
    await use(page);
    if (!hasCoverage) return;
    const coverage = await page.coverage.stopJSCoverage();
    for (const entry of coverage) {
      if (!SRC_FILE_RE.test(entry.url)) continue;
      const absPath = fileURLToPath(entry.url);
      // Use a repo-relative path so the resulting lcov.info is portable —
      // Codecov needs paths it can match against files in the repo.
      const filePath = path.relative(process.cwd(), absPath);
      const converter = v8ToIstanbul(filePath, 0, { source: entry.source });
      await converter.load();
      converter.applyCoverage(entry.functions);
      const data = JSON.stringify(converter.toIstanbul());
      const outFile = path.join(nycOutputDir, `coverage-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(outFile, data);
    }
  },
});

export const expect = base.expect;

// Songster makes real network calls to Spotify on boot when the user is
// "authenticated". Mock those out so tests can run offline and deterministically.
//
// Per-test overrides can be installed via window.__spotifyHandlers (set up by
// installSpotifyHandlers below) — each handler receives the raw URL and may
// return { status?, body? } to override the default response.
export async function installSpotifyMocks(page) {
  await page.route('**/api.spotify.com/**', async route => {
    const url = route.request().url();
    // Allow tests to inject custom responses via a page-side handler registry.
    const override = await page.evaluate(u => {
      if (!window.__spotifyHandlers) return null;
      for (const h of window.__spotifyHandlers) {
        const m = h(u);
        if (m) return m;
      }
      return null;
    }, url).catch(() => null);
    if (override) {
      await route.fulfill({
        status: override.status || 200,
        contentType: 'application/json',
        body: JSON.stringify(override.body ?? {}),
      });
      return;
    }
    let body = {};
    if (url.includes('/me/playlists')) {
      body = { items: [], total: 0, next: null };
    } else if (url.includes('/users/') && url.includes('/playlists')) {
      body = { items: [], total: 0, next: null };
    } else if (url.includes('/playlists/') && url.includes('/tracks')) {
      body = { items: [], total: 0 };
    } else if (url.includes('/playlists/')) {
      body = { name: 'Mock Playlist', tracks: { total: 10 } };
    } else if (url.includes('/search')) {
      body = { playlists: { items: [], total: 0, next: null } };
    } else if (url.includes('/me/player')) {
      body = {};
    } else if (url.includes('/me')) {
      body = { id: 'mockuser', display_name: 'Mock User' };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.route('**/accounts.spotify.com/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'mock_token',
        refresh_token: 'mock_refresh',
        expires_in: 3600,
        scope: 'user-read-private',
        token_type: 'Bearer',
      }),
    });
  });
  // Block the Web Playback SDK script — we never exercise real playback in tests.
  await page.route('**/sdk.scdn.co/**', route => route.fulfill({ status: 200, body: '' }));
}

// Install a fake Spotify Web Playback SDK so ensurePlayer() resolves without
// actually loading the remote SDK. Player methods are stubs that record calls
// on window.__playerCalls.
export async function installFakeSdk(page) {
  await page.evaluate(() => {
    window.__playerCalls = [];
    const listeners = {};
    let _state = {
      position: 0,
      duration: 180_000,
      paused: false,
      track_window: { current_track: { uri: 'spotify:track:t1' } },
    };
    window.__setPlayerState = (patch) => { Object.assign(_state, patch); };
    class FakePlayer {
      constructor(opts) {
        this.opts = opts;
        // Allow the test to inspect the token callback.
        opts.getOAuthToken(t => { window.__lastToken = t; });
      }
      addListener(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); }
      connect() {
        setTimeout(() => (listeners['ready'] || []).forEach(cb => cb({ device_id: 'fake-device' })), 0);
        return Promise.resolve(true);
      }
      disconnect() { window.__playerCalls.push(['disconnect']); }
      pause() { window.__playerCalls.push(['pause']); return Promise.resolve(); }
      resume() { window.__playerCalls.push(['resume']); return Promise.resolve(); }
      seek(ms) { window.__playerCalls.push(['seek', ms]); return Promise.resolve(); }
      getCurrentState() { return Promise.resolve(_state); }
    }
    window.__fakePlayerListeners = listeners;
    window.Spotify = { Player: FakePlayer };
    // Pretend the SDK script is already loaded so loadSdk() resolves instantly.
  });
}

// Open the app fresh, clearing localStorage so each test starts identically.
export async function gotoApp(page, baseURL) {
  await installSpotifyMocks(page);
  await page.goto(baseURL);
  await page.evaluate(() => {
    localStorage.clear();
    // Restart the auth flow so the screen reflects the cleared storage.
    auth = null;
    updateAuthUi();
    setScreen('auth');
  });
  await page.waitForSelector('#screen-auth.active');
}

// Open the app with a faked valid Spotify auth in localStorage so we land
// directly on the playlists screen. Use this for any test that needs to
// interact with the playlists UI or beyond.
export async function gotoPlaylistsAuthed(page, baseURL, opts = {}) {
  await installSpotifyMocks(page);
  await page.goto(baseURL);
  await page.evaluate((existingPls) => {
    localStorage.clear();
    const fakeAuth = {
      access_token: 'mock_token',
      refresh_token: 'mock_refresh',
      expires_at: Date.now() + 3600_000,
      scope: 'user-read-private',
      token_type: 'Bearer',
    };
    localStorage.setItem('songster.auth', JSON.stringify(fakeAuth));
    // Pre-seed playlists so seedDefaultsIfFirstRun is a no-op.
    localStorage.setItem('songster.playlists', JSON.stringify(existingPls || []));
    auth = fakeAuth;
  }, opts.playlists || []);
  await page.evaluate(async () => {
    await goToPlaylists();
  });
  await page.waitForSelector('#screen-playlists.active');
}

// Open the app and jump to the quiz screen with game mode enabled so we can
// drive team/coin/stake logic without needing a real playlist load.
export async function gotoQuizGameMode(page, baseURL, opts = {}) {
  await gotoPlaylistsAuthed(page, baseURL);
  await page.evaluate((settingsOverride) => {
    Object.assign(settings, {
      gameMode: true,
      guessTheYear: true,
      numTeams: 2,
      autoplay: false,
    }, settingsOverride || {});
    persistSettings();
    // Skip the playlist-load network round-trip; inject a fake track list directly.
    quiz.playlistUrl = 'https://open.spotify.com/playlist/' + 'A'.repeat(22);
    quiz.playlistTitle = '__test__';
    quiz.allTracks = [
      { id: 't1', name: 'Song 1', artist: 'Artist A', album: 'Album', year: 1999, releaseDate: '1999-01-01', imageUrl: '', uri: 'spotify:track:t1' },
      { id: 't2', name: 'Song 2', artist: 'Artist B', album: 'Album', year: 2005, releaseDate: '2005-06-15', imageUrl: '', uri: 'spotify:track:t2' },
      { id: 't3', name: 'Song 3', artist: 'Artist C', album: 'Album', year: 2015, releaseDate: '2015-09-09', imageUrl: '', uri: 'spotify:track:t3' },
    ];
    quiz.filteredTracks = filterByYear(quiz.allTracks);
    quiz.currentTrackIndex = 0;
    quiz.isLoading = false;
    setScreen('quiz');
    // Don't call selectCurrentTrack — it would try autoplay; set manually.
    quiz.currentTrack = quiz.filteredTracks[0];
    quiz.hidden = true;
    quiz.payoutDone = false;
    renderQuiz();
    renderTeamStrip();
  }, opts.settings || {});
  await page.waitForSelector('#screen-quiz.active');
}
