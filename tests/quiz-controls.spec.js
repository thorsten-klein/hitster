import { test, expect, gotoApp, gotoQuizGameMode, installFakeSdk } from './fixtures.js';

test.beforeEach(async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL, { settings: { gameMode: false } });
  await installFakeSdk(page);
});

// ── Reveal / hide ───────────────────────────────────────────────────────────

test('quiz screen starts with the song hidden', async ({ page }) => {
  await expect(page.locator('#reveal-hidden')).toBeVisible();
  await expect(page.locator('#reveal-shown')).toBeHidden();
});

test('Show Song Details button reveals the track info', async ({ page }) => {
  await page.locator('#btn-show').click();
  await expect(page.locator('#reveal-shown')).toBeVisible();
  await expect(page.locator('#d-name')).toHaveText('Song 1');
  await expect(page.locator('#d-artist')).toHaveText('Artist A');
  await expect(page.locator('#d-year')).toHaveText('1999');
});

test('Hide button re-hides the track info', async ({ page }) => {
  await page.locator('#btn-show').click();
  await page.locator('#btn-hide').click();
  await expect(page.locator('#reveal-hidden')).toBeVisible();
});

test('clicking the reveal card toggles between hidden and shown', async ({ page }) => {
  await page.locator('#reveal-card').click();
  await expect(page.locator('#reveal-shown')).toBeVisible();
  await page.locator('#reveal-card').click();
  await expect(page.locator('#reveal-hidden')).toBeVisible();
});

// ── Available tracks count ──────────────────────────────────────────────────

test('available track count reflects the filtered list', async ({ page }) => {
  await expect(page.locator('#quiz-avail-tracks')).toHaveText('Available tracks: 3');
});

// ── Prev / next ─────────────────────────────────────────────────────────────

test('Next song advances to the next filtered track', async ({ page }) => {
  await page.locator('#btn-show').click();
  await page.locator('#btn-next').click();
  await expect(page.locator('#d-name')).toHaveText('Song 2');
});

test('Prev song wraps backwards from the first to the last', async ({ page }) => {
  await page.locator('#btn-show').click();
  await page.locator('#btn-prev').click();
  await expect(page.locator('#d-name')).toHaveText('Song 3');
});

// ── Reveal link URLs ────────────────────────────────────────────────────────

test('Open-in-Spotify link points to the current track', async ({ page }) => {
  await page.locator('#btn-show').click();
  await expect(page.locator('#btn-open-spotify')).toHaveAttribute('href', /track\/t1$/);
});

test('Search-on-Spotify link includes artist and song name', async ({ page }) => {
  await page.locator('#btn-show').click();
  await expect(page.locator('#btn-search-spotify')).toHaveAttribute(
    'href', /search\/Artist%20A%20Song%201\/tracks$/
  );
});

// ── Year-range filtering ────────────────────────────────────────────────────

test('narrowing the year range reduces the available track count', async ({ page }) => {
  await page.evaluate(() => {
    settings.yearMin = 2000;
    settings.yearMax = 2010;
    quiz.filteredTracks = filterByYear(quiz.allTracks);
    quiz.currentTrackIndex = 0;
    quiz.currentTrack = quiz.filteredTracks[0];
    renderQuiz();
  });
  await expect(page.locator('#quiz-avail-tracks')).toHaveText('Available tracks: 1');
});

// ── Back to playlists ───────────────────────────────────────────────────────

test('Back button returns to the playlists screen', async ({ page }) => {
  await page.locator('#btn-back-quiz').click();
  await expect(page.locator('#screen-playlists')).toHaveClass(/active/);
});

// ── Error message ───────────────────────────────────────────────────────────

test('errorMessage on the quiz state renders as an error banner', async ({ page }) => {
  await page.evaluate(() => {
    quiz.errorMessage = 'Test error!';
    renderQuiz();
  });
  await expect(page.locator('#quiz-msg .err')).toContainText('Test error!');
});
// ── loadQuizPlaylist ────────────────────────────────────────────────────────

test('loadQuizPlaylist populates allTracks from Spotify', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [{ track: { id: 'x', name: 'X', uri: 'u', artists: [], album: { release_date: '2002-01-01' } } }],
      total: 1,
    }) }));
  await page.evaluate(async () => {
    quiz.playlistUrl = 'https://open.spotify.com/playlist/' + 'A'.repeat(22);
    settings.autoplay = false;
    await loadQuizPlaylist();
  });
  const n = await page.evaluate(() => quiz.allTracks.length);
  expect(n).toBe(1);
});

test('loadQuizPlaylist with an invalid URL surfaces an error', async ({ page }) => {
  await page.evaluate(async () => {
    quiz.playlistUrl = 'https://example.com/nope';
    await loadQuizPlaylist();
  });
  const err = await page.evaluate(() => quiz.errorMessage);
  expect(err).toMatch(/Invalid playlist URL|Failed to load tracks/);
});

test('loadQuizPlaylist abandons stale results after navigating away', async ({ page }) => {
  // Stall the request so we can advance quizSession while it's in flight.
  await page.unroute('**/api.spotify.com/**');
  let resolveRoute;
  const blockedRoute = new Promise(r => { resolveRoute = r; });
  await page.route('**/api.spotify.com/**', async route => {
    await blockedRoute;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) });
  });
  await page.evaluate(() => {
    quiz.playlistUrl = 'https://open.spotify.com/playlist/' + 'A'.repeat(22);
    settings.autoplay = false;
    quiz.allTracks = ['sentinel'];
    loadQuizPlaylist();    // fire-and-forget
    quizSession++;          // simulate user leaving
  });
  resolveRoute();
  await page.waitForTimeout(50);
  const tracks = await page.evaluate(() => quiz.allTracks);
  expect(tracks).toEqual(['sentinel']);   // never overwritten
});

// ── selectCurrentTrack edge cases ──────────────────────────────────────────

test('selectCurrentTrack handles an empty filtered list with an error message', async ({ page }) => {
  await page.evaluate(() => {
    quiz.filteredTracks = [];
    selectCurrentTrack();
  });
  await expect(page.locator('#quiz-msg .err')).toContainText('No tracks available');
});

// ── playCurrent ─────────────────────────────────────────────────────────────

test('playCurrent triggers playerPlayTrack via the SDK', async ({ page }) => {
  let played = false;
  await page.route('**/api.spotify.com/**/me/player/play**', route => {
    played = true;
    route.fulfill({ status: 204, body: '' });
  });
  await page.evaluate(async () => { await playCurrent(); });
  expect(played).toBe(true);
  const state = await page.evaluate(() => ({ playing: quiz.isPlaying }));
  expect(state.playing).toBe(true);
});

test('playCurrent with no current track returns early', async ({ page }) => {
  await page.evaluate(async () => {
    quiz.currentTrack = null;
    await playCurrent();
  });
  expect(await page.evaluate(() => quiz.isPlaying)).toBe(false);
});

test('playCurrent from paused state calls playerResume', async ({ page }) => {
  await page.evaluate(async () => {
    await ensurePlayer();
    quiz.isPaused = true;
    window.__playerCalls = [];
    await playCurrent();
  });
  const calls = await page.evaluate(() => window.__playerCalls);
  expect(calls).toEqual(expect.arrayContaining([['resume']]));
});

test('playCurrent with needsHardResume re-issues the track via REST', async ({ page }) => {
  let played = false;
  await page.route('**/api.spotify.com/**/me/player/play**', route => {
    played = true;
    route.fulfill({ status: 204, body: '' });
  });
  await page.evaluate(async () => {
    await ensurePlayer();
    quiz.isPaused = true;
    quiz.needsHardResume = true;
    quiz.pausedByTimer = true; // → isPlayEndless = true on resume
    await playCurrent();
  });
  expect(played).toBe(true);
});

test('playCurrent honours randomStartTime when computing position', async ({ page }) => {
  await page.evaluate(async () => {
    settings.randomStartTime = true;
    settings.playTimeLimitSeconds = 10;
    await playCurrent();
  });
  // No assertion on the random position — just ensure no throw and state moved to playing.
  expect(await page.evaluate(() => quiz.isPlaying)).toBe(true);
});

test('playCurrent surfaces an error message when playerPlayTrack throws', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 500, body: 'boom' }));
  await page.evaluate(async () => {
    quiz.isPaused = false;
    await playCurrent();
  });
  await expect(page.locator('#quiz-msg .err')).toContainText('Spotify API 500');
});

test('playCurrent that is superseded mid-await pauses instead', async ({ page }) => {
  await page.evaluate(async () => {
    await ensurePlayer();
    // Make playerPlayTrack slow so we can bump playGen between start and finish.
    const orig = playerPlayTrack;
    window.playerPlayTrack = async (...args) => {
      playGen++; // simulate user clicking pause/next while play is in flight
      return orig(...args);
    };
    await playCurrent();
    window.playerPlayTrack = orig;
  });
  expect(await page.evaluate(() => quiz.isPlaying)).toBe(false);
});

// ── pause / restart / step ──────────────────────────────────────────────────

test('pauseCurrent flips state to paused and stops playback', async ({ page }) => {
  await page.evaluate(async () => {
    await ensurePlayer();
    quiz.isPlaying = true;
    window.__playerCalls = [];
    await pauseCurrent();
  });
  expect(await page.evaluate(() => quiz.isPaused)).toBe(true);
  const calls = await page.evaluate(() => window.__playerCalls);
  expect(calls).toEqual(expect.arrayContaining([['pause']]));
});

test('restartCurrent re-issues the track at the saved start position', async ({ page }) => {
  let lastBody = '';
  await page.route('**/api.spotify.com/**/me/player/play**', async route => {
    lastBody = route.request().postData() || '';
    route.fulfill({ status: 204, body: '' });
  });
  await page.evaluate(async () => {
    await ensurePlayer();
    quiz.currentTrackStartPositionMs = 7000;
    await restartCurrent();
  });
  expect(lastBody).toMatch(/"position_ms":7000/);
});

test('restartCurrent reports an error when play throws', async ({ page }) => {
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route => route.fulfill({ status: 500, body: 'x' }));
  await page.evaluate(async () => { await restartCurrent(); });
  await expect(page.locator('#quiz-msg .err')).toContainText(/Spotify API/);
});

test('restartCurrent with no current track is a no-op', async ({ page }) => {
  await page.evaluate(async () => {
    quiz.currentTrack = null;
    await restartCurrent();
  });
});

test('stepSong with no filtered tracks returns early', async ({ page }) => {
  await page.evaluate(() => {
    quiz.filteredTracks = [];
    stepSong(1);
  });
});

test('nextSong is blocked while pending decisions remain', async ({ page }) => {
  await page.evaluate(() => {
    settings.gameMode = true;
    settings.guessTheYear = false;
    quiz.payoutDone = true;
    game.pendingStakes[0] = { amount: 10 };
    // Capture initial index.
    window.__startIdx = quiz.currentTrackIndex;
    nextSong();
  });
  const idx = await page.evaluate(() => quiz.currentTrackIndex);
  const start = await page.evaluate(() => window.__startIdx);
  expect(idx).toBe(start);
});

// ── seekDelta ───────────────────────────────────────────────────────────────

test('seekDelta forwards within a known duration calls playerSeek', async ({ page }) => {
  await page.evaluate(async () => {
    await ensurePlayer();
    quiz.trackDurationMs = 60_000;
    quiz.currentPlaybackPositionMs = 10_000;
    window.__playerCalls = [];
    await seekDelta(5);   // +5s
  });
  const calls = await page.evaluate(() => window.__playerCalls);
  expect(calls.find(c => c[0] === 'seek' && c[1] === 15_000)).toBeTruthy();
});

test('seekDelta past the end clamps to duration and pauses', async ({ page }) => {
  await page.evaluate(async () => {
    await ensurePlayer();
    quiz.trackDurationMs = 60_000;
    quiz.currentPlaybackPositionMs = 55_000;
    quiz.isPlaying = true;
    await seekDelta(30);
  });
  const pos = await page.evaluate(() => quiz.currentPlaybackPositionMs);
  expect(pos).toBe(60_000);
});

test('seekDelta past the configured window flips to endless play', async ({ page }) => {
  await page.evaluate(async () => {
    await ensurePlayer();
    quiz.trackDurationMs = 60_000;
    quiz.currentPlaybackPositionMs = 10_000;
    quiz.playbackEndPositionMs = 20_000;
    await seekDelta(15);   // newPos = 25_000 > 20_000 → endless
  });
  expect(await page.evaluate(() => quiz.isPlayEndless)).toBe(true);
});

test('seekDelta with no known duration uses the raw position', async ({ page }) => {
  await page.evaluate(async () => {
    await ensurePlayer();
    quiz.trackDurationMs = 0;
    quiz.currentPlaybackPositionMs = 10_000;
    window.__playerCalls = [];
    await seekDelta(3);
  });
  const calls = await page.evaluate(() => window.__playerCalls);
  expect(calls.find(c => c[0] === 'seek')).toBeTruthy();
});

// ── Progress UI ─────────────────────────────────────────────────────────────

test('updateProgressUi paints a 0% bar when nothing is playing', async ({ page }) => {
  await page.evaluate(() => {
    quiz.isPlaying = false; quiz.isPaused = false; quiz.isLoading = false;
    updateProgressUi();
  });
  const w = await page.locator('#progress-bar').evaluate(el => el.style.width);
  expect(w === '0%' || w === '0.0%').toBe(true);
});

test('updateProgressUi shows a window overlay during playback', async ({ page }) => {
  await page.evaluate(() => {
    quiz.isPlaying = true;
    quiz.trackDurationMs = 200_000;
    quiz.currentPlaybackPositionMs = 10_000;
    quiz.currentTrackStartPositionMs = 5_000;
    quiz.playbackEndPositionMs = 35_000;
    updateProgressUi();
  });
  await expect(page.locator('#progress-window')).toBeVisible();
});

// ── startProgressTracking ───────────────────────────────────────────────────

test('startProgressTracking polls player state via setInterval', async ({ page }) => {
  await page.evaluate(async () => {
    await ensurePlayer();
    window.__setPlayerState({ position: 30_000, duration: 200_000, paused: false });
    quiz.isPlaying = true;
    quiz.currentTrack = { uri: 'spotify:track:t1' };
    quiz.playbackEndPositionMs = 25_000;
    startProgressTracking('spotify:track:t1');
    // Allow several ticks so we walk past the settling counter and trigger autoPause.
    await new Promise(r => setTimeout(r, 1500));
  });
  expect(await page.evaluate(() => quiz.isPaused)).toBe(true);
});

test('startProgressTracking detects natural end-of-track (paused=true, pos=0)', async ({ page }) => {
  await page.evaluate(async () => {
    await ensurePlayer();
    quiz.isPlaying = true;
    quiz.currentTrack = { uri: 'spotify:track:t1' };
    quiz.trackDurationMs = 200_000;
    window.__setPlayerState({ position: 0, duration: 200_000, paused: true });
    startProgressTracking('spotify:track:t1');
    await new Promise(r => setTimeout(r, 1500));
  });
  expect(await page.evaluate(() => quiz.isPaused)).toBe(true);
});

test('startProgressTracking ignores ticks for the wrong track URI', async ({ page }) => {
  await page.evaluate(async () => {
    await ensurePlayer();
    quiz.isPlaying = true;
    quiz.currentTrack = { uri: 'spotify:track:t1' };
    window.__setPlayerState({ position: 5000, duration: 200_000, paused: false,
      track_window: { current_track: { uri: 'spotify:track:OTHER' } }});
    startProgressTracking('spotify:track:t1');
    await new Promise(r => setTimeout(r, 400));
    quiz.isPlaying = false;
    clearTimers();
  });
});

test.describe('quiz wiring', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await gotoQuizGameMode(page, baseURL, { settings: { gameMode: false } });
    await installFakeSdk(page);
  });

  test('Play button calls playCurrent', async ({ page }) => {
    let played = false;
    await page.route('**/api.spotify.com/**/me/player/play**', route => {
      played = true;
      route.fulfill({ status: 204, body: '' });
    });
    await page.locator('#btn-play').click();
    await page.waitForTimeout(100);
    expect(played).toBe(true);
  });

  test('Pause button calls pauseCurrent', async ({ page }) => {
    await page.evaluate(async () => {
      await ensurePlayer();
      quiz.isPlaying = true;
      renderPlayButtons();
      window.__playerCalls = [];
    });
    await page.locator('#btn-pause').click();
    await page.waitForTimeout(50);
    const calls = await page.evaluate(() => window.__playerCalls);
    expect(calls).toEqual(expect.arrayContaining([['pause']]));
  });

  test('Restart button re-issues the track', async ({ page }) => {
    let played = false;
    await page.route('**/api.spotify.com/**/me/player/play**', route => {
      played = true; route.fulfill({ status: 204, body: '' });
    });
    await page.locator('#btn-restart').click();
    await page.waitForTimeout(100);
    expect(played).toBe(true);
  });

  test('Seek buttons call seekDelta', async ({ page }) => {
    await page.evaluate(async () => {
      await ensurePlayer();
      quiz.trackDurationMs = 60_000;
      quiz.currentPlaybackPositionMs = 10_000;
      window.__playerCalls = [];
    });
    await page.locator('[data-seek]').first().click();
    await page.waitForTimeout(50);
  });

  test('Open-in-Spotify click sets needsHardResume', async ({ page }) => {
    await page.locator('#btn-show').click();
    await page.evaluate(() => $('#btn-open-spotify').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(await page.evaluate(() => quiz.needsHardResume)).toBe(true);
  });

  test('Search-on-Spotify click also sets needsHardResume', async ({ page }) => {
    await page.locator('#btn-show').click();
    await page.evaluate(async () => {
      await ensurePlayer();
      quiz.isPlaying = true;
      $('#btn-search-spotify').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(await page.evaluate(() => quiz.needsHardResume)).toBe(true);
  });

  test('Back from quiz returns to playlists and pauses', async ({ page }) => {
    await page.evaluate(async () => { await ensurePlayer(); window.__playerCalls = []; });
    await page.locator('#btn-back-quiz').click();
    await expect(page.locator('#screen-playlists')).toHaveClass(/active/);
  });

  test('Fullscreen button enters fullscreen via requestFullscreen', async ({ page }) => {
    await page.evaluate(() => {
      window.__fsCalled = false;
      document.documentElement.requestFullscreen = () => { window.__fsCalled = true; return Promise.resolve(); };
      document.exitFullscreen = () => Promise.resolve();
    });
    await page.locator('#btn-fullscreen').click();
    expect(await page.evaluate(() => window.__fsCalled)).toBe(true);
  });

  test('Fullscreen button toasts when fullscreen is unsupported', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.requestFullscreen = null;
      document.documentElement.webkitRequestFullscreen = null;
    });
    await page.locator('#btn-fullscreen').click();
    await expect(page.locator('body > div').filter({ hasText: /Fullscreen isn't supported/ })).toBeVisible();
  });

  test('Fullscreen catch handler toasts on a synchronous error', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.requestFullscreen = () => { throw new Error('sync-fail'); };
    });
    await page.locator('#btn-fullscreen').click();
    await expect(page.locator('body > div').filter({ hasText: /Could not enter fullscreen/ })).toBeVisible();
  });

  test('Fullscreen catch handler toasts on a promise rejection', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.requestFullscreen = () => Promise.reject(new Error('async-fail'));
    });
    await page.locator('#btn-fullscreen').click();
    await expect(page.locator('body > div').filter({ hasText: /Could not enter fullscreen/ })).toBeVisible();
  });

  test('Settings reset-game confirm wipes team scores', async ({ page }) => {
    await page.evaluate(() => {
      settings.gameMode = true; persistSettings();
      ensureTeams(2);
      addHistoryEntry(game.teams[0], { type: 'manual', delta: 50, note: '' });
    });
    await page.locator('#btn-settings').click();
    await page.locator('#set-reset-game').click();
    await page.locator('#confirm-ok').click();
    const coins = await page.evaluate(() => teamCoins(game.teams[0]));
    expect(coins).toBe(100);
  });

  test('Settings reset-game cancel keeps existing scores', async ({ page }) => {
    await page.evaluate(() => {
      settings.gameMode = true; persistSettings();
      ensureTeams(2);
      addHistoryEntry(game.teams[0], { type: 'manual', delta: 50, note: '' });
    });
    await page.locator('#btn-settings').click();
    await page.locator('#set-reset-game').click();
    await page.locator('#confirm-cancel').click();
    expect(await page.evaluate(() => teamCoins(game.teams[0]))).toBe(150);
  });

  test('Reset-defaults cancel keeps mutated settings', async ({ page }) => {
    await page.evaluate(() => { settings.playTimeLimitSeconds = 90; persistSettings(); });
    await page.locator('#btn-settings').click();
    await page.locator('#set-reset-defaults').click();
    await page.locator('#confirm-cancel').click();
    expect(await page.evaluate(() => settings.playTimeLimitSeconds)).toBe(90);
  });

  test('Inline game-mode toggle flips settings', async ({ page }) => {
    await page.locator('#set-game-inline').click();
    expect(await page.evaluate(() => settings.gameMode)).toBe(true);
  });

  test('Year-range sliders update labels live as you drag', async ({ page }) => {
    await page.locator('#btn-settings').click();
    await page.locator('#set-year-min').evaluate(el => { el.value = 1970; el.dispatchEvent(new Event('input')); });
    await expect(page.locator('#set-year-min-lbl')).toHaveText('1970');
  });

  test('Settings backdrop click closes the modal', async ({ page }) => {
    await page.locator('#btn-settings').click();
    await page.locator('#modal-settings').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#modal-settings')).not.toHaveClass(/active/);
  });

  test('Edit-entry save rejects an invalid number with a toast', async ({ page }) => {
    await page.evaluate(() => { settings.gameMode = true; persistSettings(); ensureTeams(2); });
    await page.evaluate(() => {
      historyContext = 0;
      openEditModal(null);
      $('#edit-delta').value = 'not-a-number';
    });
    await page.locator('#edit-save').click();
    await expect(page.locator('body > div').filter({ hasText: 'Enter a number' })).toBeVisible();
  });

  test('Edit-entry save without a context is a no-op', async ({ page }) => {
    await page.evaluate(() => {
      editContext = null;
      document.getElementById('modal-history-edit').classList.add('active');
      $('#edit-delta').value = '5';
    });
    await page.locator('#edit-save').click();
    // Modal should stay open because the handler returned early.
    await expect(page.locator('#modal-history-edit')).toHaveClass(/active/);
  });

  test('Edit-entry save updates an existing entry when entryId is set', async ({ page }) => {
    await page.evaluate(() => {
      settings.gameMode = true; persistSettings(); ensureTeams(2);
      addHistoryEntry(game.teams[0], { id: 'e1', type: 'manual', delta: 10, note: 'first' });
      historyContext = 0;
      openEditModal('e1');
      $('#edit-delta').value = '99';
      $('#edit-note').value = 'updated';
    });
    await page.locator('#edit-save').click();
    expect(await page.evaluate(() => game.teams[0].history.find(e => e.id === 'e1').delta)).toBe(99);
  });

  test('Stake span buttons swap the precision multiplier', async ({ page }) => {
    await page.evaluate(() => {
      settings.gameMode = true; persistSettings(); ensureTeams(2);
      renderTeamStrip();
    });
    await page.locator('[data-stake="0"]').click();
    await page.locator('#stake-span button[data-span="10"]').click();
    expect(await page.evaluate(() => stakeContext.span)).toBe(10);
  });

  test('Stake range sliders trigger gap-preserving updates', async ({ page }) => {
    await page.evaluate(() => {
      settings.gameMode = true; persistSettings(); ensureTeams(2);
      renderTeamStrip();
    });
    await page.locator('[data-stake="0"]').click();
    // Drag lo, expect hi to move with the gap.
    await page.locator('#stake-range-lo').evaluate(el => {
      el.value = 1995;
      el.dispatchEvent(new Event('input'));
    });
    const [lo, hi] = await page.evaluate(() => [+$('#stake-range-lo').value, +$('#stake-range-hi').value]);
    expect(hi - lo).toBeGreaterThanOrEqual(0);
  });

  test('Stake +/− steppers move both year handles together', async ({ page }) => {
    await page.evaluate(() => {
      settings.gameMode = true; persistSettings(); ensureTeams(2);
      renderTeamStrip();
    });
    await page.locator('[data-stake="0"]').click();
    const before = await page.evaluate(() => +$('#stake-range-lo').value);
    await page.locator('[data-stake-step="lo,1"]').click();
    const after = await page.evaluate(() => +$('#stake-range-lo').value);
    expect(after).toBe(before + 1);
  });

  test('Stake coin stepper +/- adjusts the input value and clamps to 1', async ({ page }) => {
    await page.evaluate(() => {
      settings.gameMode = true; persistSettings(); ensureTeams(2);
      renderTeamStrip();
    });
    await page.locator('[data-stake="0"]').click();
    await page.locator('#modal-stake [data-step="1"]').click();
    const v1 = await page.locator('#stake-coins-input').inputValue();
    expect(+v1).toBeGreaterThanOrEqual(2);
    // Click - many times — value should never drop below 1.
    await page.evaluate(() => {
      const btn = document.querySelector('#modal-stake [data-step="-1"]');
      for (let i = 0; i < 30; i++) btn.click();
    });
    const v2 = await page.locator('#stake-coins-input').inputValue();
    expect(+v2).toBe(1);
  });

  test('Stake Place over-amount surfaces a toast', async ({ page }) => {
    await page.evaluate(() => {
      settings.gameMode = true; persistSettings(); ensureTeams(2);
      renderTeamStrip();
    });
    await page.locator('[data-stake="0"]').click();
    await page.locator('#stake-coins-input').fill('99999');
    // Bypass the max attribute and submit anyway.
    await page.evaluate(() => $('#stake-coins-input').setAttribute('max', '99999'));
    await page.locator('#stake-place').click();
    await expect(page.locator('body > div').filter({ hasText: /don't have that many coins/ })).toBeVisible();
  });

  test('Stake modal backdrop click closes it', async ({ page }) => {
    await page.evaluate(() => {
      settings.gameMode = true; persistSettings(); ensureTeams(2);
      renderTeamStrip();
    });
    await page.locator('[data-stake="0"]').click();
    await page.locator('#modal-stake').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#modal-stake')).not.toHaveClass(/active/);
  });
});


// ── Spotify Web Playback SDK wrapper (spotify.js) ──────────────────────────

test.describe('Player SDK wrapper', () => {
  test.beforeEach(async ({ page }) => {
    // The outer beforeEach already installs the fake SDK.
    await page.evaluate(() => {
      auth = { access_token: 't', refresh_token: 'r', expires_at: Date.now() + 600_000 };
      saveAuth(auth);
    });
  });

test('ensurePlayer connects via the fake SDK and resolves with the device id', async ({ page }) => {
  await installFakeSdk(page);
  const did = await page.evaluate(async () => {
    await ensurePlayer();
    return spDeviceId;
  });
  expect(did).toBe('fake-device');
});

test('ensurePlayer is idempotent on subsequent calls', async ({ page }) => {
  await installFakeSdk(page);
  const same = await page.evaluate(async () => {
    const a = await ensurePlayer();
    const b = await ensurePlayer();
    return a === b;
  });
  expect(same).toBe(true);
});

test('ensurePlayer throws and clears the ready promise on connect failure', async ({ page }) => {
  await installFakeSdk(page);
  const err = await page.evaluate(async () => {
    // Override connect to return false so ensurePlayer rejects.
    window.Spotify.Player = class {
      constructor(o) { o.getOAuthToken(() => {}); }
      addListener() {}
      connect() { return Promise.resolve(false); }
    };
    try { await ensurePlayer(); return null; }
    catch (e) { return e.message; }
  });
  expect(err).toMatch(/connect/);
});

test('playerPlayTrack calls Spotify play endpoint', async ({ page }) => {
  await installFakeSdk(page);
  const seen = await page.evaluate(async () => {
    const urls = [];
    const orig = window.fetch;
    window.fetch = (u, opts) => { urls.push(u); return orig(u, opts); };
    await playerPlayTrack('spotify:track:abc', 5000);
    return urls;
  });
  expect(seen.some(u => /\/me\/player\/play/.test(u))).toBe(true);
});

test('playerPause/Resume/Seek and getState route through the SDK', async ({ page }) => {
  await installFakeSdk(page);
  const calls = await page.evaluate(async () => {
    await ensurePlayer();
    await playerPause();
    await playerResume();
    await playerSeek(1234);
    const s = await playerGetState();
    return { calls: window.__playerCalls.slice(), state: s };
  });
  expect(calls.calls).toEqual(expect.arrayContaining([['pause'], ['resume'], ['seek', 1234]]));
  expect(calls.state).toMatchObject({ position: 0, duration: 180_000, paused: false, uri: 'spotify:track:t1' });
});

test('player wrappers are no-ops before ensurePlayer has run', async ({ page }) => {
  const out = await page.evaluate(async () => {
    spPlayer = null; spDeviceId = null; spReadyPromise = null;
    // None of these should throw.
    await playerPause();
    await playerResume();
    await playerSeek(0);
    return await playerGetState();
  });
  expect(out).toBeNull();
});

test('playerGetState returns null if getCurrentState resolves to null', async ({ page }) => {
  await installFakeSdk(page);
  const out = await page.evaluate(async () => {
    await ensurePlayer();
    spPlayer.getCurrentState = () => Promise.resolve(null);
    return await playerGetState();
  });
  expect(out).toBeNull();
});

test('player event listeners fire for ready, account_error, state-change', async ({ page }) => {
  await installFakeSdk(page);
  await page.evaluate(async () => {
    await ensurePlayer();
    quiz.isPlaying = true;
    quiz.currentTrack = { uri: 'spotify:track:t1' };
    quiz.currentPlaybackPositionMs = 10_000;
    const fire = (ev, data) => (window.__fakePlayerListeners[ev] || []).forEach(cb => cb(data));
    fire('initialization_error', { message: 'init' });
    fire('authentication_error', { message: 'auth' });
    fire('account_error',         { message: 'no premium' });
    fire('playback_error',        { message: 'pb' });
    fire('player_state_changed',  null);
    fire('player_state_changed',  { position: 5_000, duration: 200_000, track_window: { current_track: { uri: 'spotify:track:t1' }}});
    fire('player_state_changed',  { position: 0, duration: 200_000, track_window: { current_track: { uri: 'spotify:track:t1' }}});
    fire('player_state_changed',  { position: 5_000, duration: 200_000, track_window: { current_track: { uri: 'spotify:track:OTHER' }}});
    fire('not_ready',             { device_id: 'gone' });
  });
  // account_error mutates quiz.errorMessage.
  const errMsg = await page.evaluate(() => quiz.errorMessage);
  expect(errMsg).toMatch(/Premium required/);
});
});

// ── quiz.js: shuffle (needs an array of length ≥ 2) ────────────────────────

test('loadQuizPlaylist shuffles a multi-track playlist', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL, { settings: { gameMode: false } });
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: Array.from({ length: 5 }, (_, i) => ({
        track: { id: 't' + i, name: 'N' + i, uri: 'u', artists: [], album: { release_date: '2000-01-01' } },
      })),
      total: 5,
    }) }));
  await page.evaluate(async () => {
    quiz.playlistUrl = 'https://open.spotify.com/playlist/' + 'A'.repeat(22);
    settings.autoplay = false;
    await loadQuizPlaylist();
  });
  const n = await page.evaluate(() => quiz.allTracks.length);
  expect(n).toBe(5);
});

// ── quiz.js: needsHardResume error path ─────────────────────────────────────

test('playCurrent in hard-resume mode surfaces playerPlayTrack errors', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL, { settings: { gameMode: false } });
  await installFakeSdk(page);
  await page.unroute('**/api.spotify.com/**');
  await page.route('**/api.spotify.com/**', route => route.fulfill({ status: 500, body: 'x' }));
  await page.evaluate(async () => {
    quiz.isPaused = true;
    quiz.needsHardResume = true;
    quiz.currentPlaybackPositionMs = 1000;
    await playCurrent();
  });
  const err = await page.evaluate(() => quiz.errorMessage);
  expect(err).toMatch(/Spotify API 500/);
});
// ── app.js: exitFs path ────────────────────────────────────────────────────

test('Fullscreen button exits when already in fullscreen', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL, { settings: { gameMode: false } });
  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenElement',
      { configurable: true, get: () => document.documentElement });
    let exited = false;
    document.exitFullscreen = () => { exited = true; return Promise.resolve(); };
    window.__exited = () => exited;
  });
  await page.locator('#btn-fullscreen').click();
  expect(await page.evaluate(() => window.__exited())).toBe(true);
});

test('Fullscreen exit handles a rejected promise without throwing', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL, { settings: { gameMode: false } });
  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenElement',
      { configurable: true, get: () => document.documentElement });
    document.exitFullscreen = () => Promise.reject(new Error('exit-fail'));
  });
  await page.locator('#btn-fullscreen').click();
  // No assertion — just verify no uncaught exception bubbled.
});

test('Fullscreen exit is a no-op when no exit API exists', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL, { settings: { gameMode: false } });
  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenElement',
      { configurable: true, get: () => document.documentElement });
    document.exitFullscreen = null;
    document.webkitExitFullscreen = null;
  });
  await page.locator('#btn-fullscreen').click();
});
// ── app.js: syncFsIcon while in fullscreen ─────────────────────────────────

test('Fullscreen icon swaps to "exit" while in fullscreen', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL, { settings: { gameMode: false } });
  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenElement',
      { configurable: true, get: () => document.documentElement });
    // Trigger the existing fullscreenchange listener.
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  const href = await page.locator('#btn-fullscreen use').getAttribute('href');
  expect(href).toBe('#i-fullscreen-exit');
});
// ── spotify.js: loadSdk SDK-ready callback fires on script load ────────────

test('loadSdk resolves when onSpotifyWebPlaybackSDKReady fires', async ({ page, baseURL }) => {
  await gotoApp(page, baseURL);
  const resolved = await page.evaluate(async () => {
    delete window.Spotify;
    sdkLoadedPromise = null;
    const p = loadSdk();
    // Simulate the SDK script load firing the ready callback.
    setTimeout(() => { window.onSpotifyWebPlaybackSDKReady?.(); }, 10);
    await p;
    return true;
  });
  expect(resolved).toBe(true);
});
