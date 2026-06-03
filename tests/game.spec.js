import { test, expect, gotoApp, gotoQuizGameMode } from './fixtures.js';

test.beforeEach(async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
});

// ── Teams / coins ───────────────────────────────────────────────────────────

test('new teams start with 100 coins', async ({ page }) => {
  const coins = await page.evaluate(() => teamCoins(game.teams[0]));
  expect(coins).toBe(100);
});

test('the team strip shows one card per team', async ({ page }) => {
  await expect(page.locator('#team-strip .team-card')).toHaveCount(2);
});

test('addHistoryEntry adjusts team coins by the delta', async ({ page }) => {
  await page.evaluate(() =>
    addHistoryEntry(game.teams[0], { type: 'manual', delta: 25, note: 'bonus' }));
  const coins = await page.evaluate(() => teamCoins(game.teams[0]));
  expect(coins).toBe(125);
});

test('a negative delta reduces a team\'s coins', async ({ page }) => {
  await page.evaluate(() =>
    addHistoryEntry(game.teams[0], { type: 'manual', delta: -30, note: '' }));
  const coins = await page.evaluate(() => teamCoins(game.teams[0]));
  expect(coins).toBe(70);
});

test('deleteHistoryEntry rolls back its delta', async ({ page }) => {
  await page.evaluate(() => {
    addHistoryEntry(game.teams[0], { type: 'manual', delta: 25, id: 'e1' });
    deleteHistoryEntry(game.teams[0], 'e1');
  });
  const coins = await page.evaluate(() => teamCoins(game.teams[0]));
  expect(coins).toBe(100);
});

// ── ensureTeams ─────────────────────────────────────────────────────────────

test('ensureTeams grows the team list but never shrinks it', async ({ page }) => {
  await page.evaluate(() => ensureTeams(4));
  expect(await page.evaluate(() => game.teams.length)).toBe(4);
  await page.evaluate(() => ensureTeams(2));
  // Still 4 — shrinking is forbidden so history isn't lost.
  expect(await page.evaluate(() => game.teams.length)).toBe(4);
});

// ── Stake span / multiplier ─────────────────────────────────────────────────

test('stakeMult returns the configured multiplier per span', async ({ page }) => {
  expect(await page.evaluate(() => stakeMult(1))).toBe(8);
  expect(await page.evaluate(() => stakeMult(2))).toBe(5);
  expect(await page.evaluate(() => stakeMult(5))).toBe(3);
  expect(await page.evaluate(() => stakeMult(10))).toBe(2);
});

test('stakeMult falls back to 1 for an unknown span', async ({ page }) => {
  expect(await page.evaluate(() => stakeMult(99))).toBe(1);
});

test('stakeGap is span minus one (handles cross at 1y exact match)', async ({ page }) => {
  expect(await page.evaluate(() => stakeGap(1))).toBe(0);
  expect(await page.evaluate(() => stakeGap(2))).toBe(1);
  expect(await page.evaluate(() => stakeGap(10))).toBe(9);
});

// ── Stake modal ─────────────────────────────────────────────────────────────

test('clicking a team\'s stake button opens the stake modal', async ({ page }) => {
  await page.locator('[data-stake="0"]').click();
  await expect(page.locator('#modal-stake')).toHaveClass(/active/);
  await expect(page.locator('#stake-title')).toContainText('Team 1');
});

test('stake modal shows the precision picker in year-guess mode', async ({ page }) => {
  await page.locator('[data-stake="0"]').click();
  await expect(page.locator('#stake-precision-block')).toBeVisible();
  await expect(page.locator('#stake-range-block')).toBeVisible();
});

test('stake modal hides the precision picker in manual mode', async ({ page }) => {
  await page.evaluate(() => { settings.guessTheYear = false; persistSettings(); });
  await page.locator('[data-stake="0"]').click();
  await expect(page.locator('#stake-precision-block')).toBeHidden();
  await expect(page.locator('#stake-info-block')).toBeVisible();
});

test('stake modal Skip records a skipped stake and closes', async ({ page }) => {
  await page.locator('[data-stake="0"]').click();
  await page.locator('#stake-skip').click();
  await expect(page.locator('#modal-stake')).not.toHaveClass(/active/);
  const skipped = await page.evaluate(() => game.pendingStakes[0]?.skipped);
  expect(skipped).toBe(true);
});

test('stake modal Place stake records a non-skipped stake', async ({ page }) => {
  await page.locator('[data-stake="0"]').click();
  await page.locator('#stake-coins-input').fill('20');
  await page.locator('#stake-place').click();
  await expect(page.locator('#modal-stake')).not.toHaveClass(/active/);
  const st = await page.evaluate(() => game.pendingStakes[0]);
  expect(st.amount).toBe(20);
  expect(st.skipped).toBeUndefined();
});

test('stake modal rejects a non-positive coin amount', async ({ page }) => {
  await page.locator('[data-stake="0"]').click();
  await page.locator('#stake-coins-input').fill('0');
  await page.locator('#stake-place').click();
  // Modal stays open and an error toast appears.
  await expect(page.locator('#modal-stake')).toHaveClass(/active/);
});

// ── Payout on reveal ────────────────────────────────────────────────────────

test('payoutOnReveal awards stake * multiplier for a correct year guess', async ({ page }) => {
  await page.evaluate(() => {
    quiz.currentTrack = { name: 's', artist: 'a', year: 2005 };
    game.pendingStakes[0] = { amount: 10, span: 5, lo: 2003, hi: 2007 };
    quiz.payoutDone = true;
    payoutOnReveal();
  });
  const coins = await page.evaluate(() => teamCoins(game.teams[0]));
  // 100 + 10*3 (span=5 → 3×)
  expect(coins).toBe(130);
});

test('payoutOnReveal subtracts the stake for a wrong year guess', async ({ page }) => {
  await page.evaluate(() => {
    quiz.currentTrack = { name: 's', artist: 'a', year: 1980 };
    game.pendingStakes[0] = { amount: 15, span: 1, lo: 2005, hi: 2005 };
    quiz.payoutDone = true;
    payoutOnReveal();
  });
  const coins = await page.evaluate(() => teamCoins(game.teams[0]));
  expect(coins).toBe(85);
});

test('payoutOnReveal records a 0-delta skip entry for skipped teams', async ({ page }) => {
  await page.evaluate(() => {
    quiz.currentTrack = { name: 's', artist: 'a', year: 2005 };
    game.pendingStakes[0] = { skipped: true };
    quiz.payoutDone = true;
    payoutOnReveal();
  });
  const history = await page.evaluate(() => game.teams[0].history);
  expect(history).toHaveLength(1);
  expect(history[0].type).toBe('skip');
  expect(history[0].delta).toBe(0);
});

test('hasPendingDecisions is false in year-guess mode', async ({ page }) => {
  await page.evaluate(() => {
    settings.guessTheYear = true;
    quiz.payoutDone = true;
    game.pendingStakes[0] = { amount: 10, span: 5, lo: 2000, hi: 2010 };
  });
  expect(await page.evaluate(() => hasPendingDecisions())).toBe(false);
});

test('hasPendingDecisions is true in manual mode with an unresolved stake', async ({ page }) => {
  await page.evaluate(() => {
    settings.gameMode = true;
    settings.guessTheYear = false;
    quiz.payoutDone = true;
    game.pendingStakes[0] = { amount: 10 };
  });
  expect(await page.evaluate(() => hasPendingDecisions())).toBe(true);
});

// ── Manual resolution ───────────────────────────────────────────────────────

test('resolveManualStake(true) awards the flat stake amount', async ({ page }) => {
  await page.evaluate(() => {
    settings.guessTheYear = false;
    quiz.currentTrack = { name: 's', artist: 'a', year: 2005 };
    game.pendingStakes[0] = { amount: 20 };
    resolveManualStake(0, true);
  });
  expect(await page.evaluate(() => teamCoins(game.teams[0]))).toBe(120);
});

test('resolveManualStake(false) subtracts the flat stake amount', async ({ page }) => {
  await page.evaluate(() => {
    settings.guessTheYear = false;
    quiz.currentTrack = { name: 's', artist: 'a', year: 2005 };
    game.pendingStakes[0] = { amount: 20 };
    resolveManualStake(0, false);
  });
  expect(await page.evaluate(() => teamCoins(game.teams[0]))).toBe(80);
});

// ── History modal ───────────────────────────────────────────────────────────

test('clicking the coins button opens the team history modal', async ({ page }) => {
  await page.evaluate(() =>
    addHistoryEntry(game.teams[0], { type: 'manual', delta: 5, note: 'test' }));
  await page.locator('[data-coins="0"]').click();
  await expect(page.locator('#modal-history')).toHaveClass(/active/);
  await expect(page.locator('#history-title')).toContainText('Team 1');
});

test('Manual entry modal can add a coin adjustment', async ({ page }) => {
  await page.locator('[data-coins="0"]').click();
  await page.locator('#history-add').click();
  await page.locator('#edit-delta').fill('50');
  await page.locator('#edit-note').fill('manual bonus');
  await page.locator('#edit-save').click();
  await expect(page.locator('#modal-history-edit')).not.toHaveClass(/active/);
  expect(await page.evaluate(() => teamCoins(game.teams[0]))).toBe(150);
});

// ── game.js: nudgeStake('hi', ...) ──────────────────────────────────────────

test('nudgeStake on the hi handle moves both with the gap', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.locator('[data-stake="0"]').click();
  const before = await page.evaluate(() => +$('#stake-range-hi').value);
  await page.locator('[data-stake-step="hi,-1"]').click();
  const after = await page.evaluate(() => +$('#stake-range-hi').value);
  expect(after).toBe(before - 1);
});

// ── game.js: hasPendingDecisions returns false when no stake matches ───────

test('hasPendingDecisions returns false when only skipped stakes are pending', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  const out = await page.evaluate(() => {
    settings.gameMode = true; settings.guessTheYear = false;
    quiz.payoutDone = true;
    game.pendingStakes = { 0: { skipped: true } };
    return hasPendingDecisions();
  });
  expect(out).toBe(false);
});

// ── game.js: payoutOnReveal manual-mode skip branch ────────────────────────

test('payoutOnReveal in manual mode processes skipped stakes only', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    settings.gameMode = true; settings.guessTheYear = false;
    quiz.currentTrack = { name: 's', artist: 'a', year: 2000 };
    game.pendingStakes = { 0: { skipped: true }, 1: { amount: 10 } };
    payoutOnReveal();
  });
  // Team 0 (skipped) got a skip entry; team 1's stake is still pending.
  const t0 = await page.evaluate(() => game.teams[0].history.length);
  const pending = await page.evaluate(() => Object.keys(game.pendingStakes));
  expect(t0).toBe(1);
  expect(pending).toContain('1');
});

// ── game.js: payoutOnReveal in year-guess mode records skipped stakes ──────

test('payoutOnReveal in year-guess mode records a skip entry', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    settings.gameMode = true; settings.guessTheYear = true;
    quiz.currentTrack = { name: 's', artist: 'a', year: 2000 };
    game.pendingStakes = { 0: { skipped: true } };
    payoutOnReveal();
  });
  const last = await page.evaluate(() => game.teams[0].history.at(-1));
  expect(last.type).toBe('skip');
});

// ── game.js: history list renders stake / skip / manual entries ────────────

test('history list renders stake entries with the year window and outcome', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    addHistoryEntry(game.teams[0], {
      type: 'stake', delta: 30, win: true,
      stakeAmount: 10, span: 5, lo: 2000, hi: 2005,
      songName: 'Track', songArtist: 'Band', songYear: 2003,
    });
  });
  await page.locator('[data-coins="0"]').click();
  await expect(page.locator('#history-content')).toContainText('Track');
  await expect(page.locator('#history-content')).toContainText('window 2000–2005');
});

test('history list renders an exact-year stake (lo === hi) without a dash', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    addHistoryEntry(game.teams[0], {
      type: 'stake', delta: -8, win: false,
      stakeAmount: 8, span: 1, lo: 1999, hi: 1999,
      songName: 'X', songArtist: 'Y', songYear: 2003,
    });
  });
  await page.locator('[data-coins="0"]').click();
  // Exact-year window renders as just "1999" (no en-dash).
  await expect(page.locator('#history-content')).toContainText('window 1999 (1y)');
});

test('history list renders skip entries with the actual year', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    addHistoryEntry(game.teams[0], {
      type: 'skip', delta: 0, songName: 'Tune', songYear: 2010,
    });
  });
  await page.locator('[data-coins="0"]').click();
  await expect(page.locator('#history-content')).toContainText('skipped (actual 2010)');
});

test('history list renders manual entries with their note', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    addHistoryEntry(game.teams[0], { type: 'manual', delta: 25, note: 'bonus round' });
  });
  await page.locator('[data-coins="0"]').click();
  await expect(page.locator('#history-content')).toContainText('Manual adjustment');
  await expect(page.locator('#history-content')).toContainText('bonus round');
});

// ── game.js: history list delete button (confirm flow) ─────────────────────

test('history list Delete confirm removes the entry', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    addHistoryEntry(game.teams[0], { id: 'D1', type: 'manual', delta: 20, note: 'oops' });
  });
  await page.locator('[data-coins="0"]').click();
  await page.locator('[data-del="D1"]').click();
  await page.locator('#confirm-ok').click();
  const remaining = await page.evaluate(() => game.teams[0].history.length);
  expect(remaining).toBe(0);
});

test('history list Delete cancel keeps the entry', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    addHistoryEntry(game.teams[0], { id: 'D2', type: 'manual', delta: 20, note: 'keep' });
  });
  await page.locator('[data-coins="0"]').click();
  await page.locator('[data-del="D2"]').click();
  await page.locator('#confirm-cancel').click();
  const remaining = await page.evaluate(() => game.teams[0].history.length);
  expect(remaining).toBe(1);
});

// ── game.js: history list Edit button reopens the edit modal ───────────────

test('history list Edit opens the edit modal preloaded with the entry', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    addHistoryEntry(game.teams[0], { id: 'E1', type: 'manual', delta: 42, note: 'reason' });
  });
  await page.locator('[data-coins="0"]').click();
  await page.locator('[data-edit="E1"]').click();
  await expect(page.locator('#modal-history-edit')).toHaveClass(/active/);
  await expect(page.locator('#edit-delta')).toHaveValue('42');
  await expect(page.locator('#edit-note')).toHaveValue('reason');
});

// ── game.js: ensureTeams persistence when growing ──────────────────────────

test('the manual-mode decide buttons resolve a single team\'s stake', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    settings.gameMode = true; settings.guessTheYear = false;
    quiz.currentTrack = { name: 's', artist: 'a', year: 2005 };
    game.pendingStakes[0] = { amount: 15 };
    quiz.payoutDone = true;
    renderTeamStrip();
  });
  await page.locator('[data-decide="0,win"]').click();
  expect(await page.evaluate(() => teamCoins(game.teams[0]))).toBe(115);
});

test('the manual-mode decide ✗ button subtracts the stake', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    settings.gameMode = true; settings.guessTheYear = false;
    quiz.currentTrack = { name: 's', artist: 'a', year: 2005 };
    game.pendingStakes[1] = { amount: 15 };
    quiz.payoutDone = true;
    renderTeamStrip();
  });
  await page.locator('[data-decide="1,lose"]').click();
  expect(await page.evaluate(() => teamCoins(game.teams[1]))).toBe(85);
});

// ── game.js: openHistoryModal early-out branches ──────────────────────────

test('openHistoryModal with an out-of-range team id returns silently', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => openHistoryModal(999));
  await expect(page.locator('#modal-history')).not.toHaveClass(/active/);
});

test('openEditModal with no team in history-context returns silently', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    historyContext = 999;
    openEditModal('any');
  });
  await expect(page.locator('#modal-history-edit')).not.toHaveClass(/active/);
});

test('openEditModal with an unknown entryId returns silently', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    historyContext = 0;
    openEditModal('does-not-exist');
  });
  await expect(page.locator('#modal-history-edit')).not.toHaveClass(/active/);
});

// ── game.js: stakeWindow legacy {guess,span} shape ────────────────────────

test('stakeWindow handles legacy {guess, span} shaped stakes', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  const out = await page.evaluate(() => stakeWindow({ guess: 2000, span: 5 }));
  expect(out).toEqual([1995, 2005]);
});

test('stakeWindow returns the current year for an empty stake', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  const out = await page.evaluate(() => stakeWindow({}));
  expect(out[0]).toBe(out[1]);
});

// ── game.js: resolveManualStake early-out branches ────────────────────────

test('resolveManualStake with no team / stake / a skipped stake is a no-op', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  const before = await page.evaluate(() => teamCoins(game.teams[0]));
  await page.evaluate(() => {
    resolveManualStake(999, true);   // no team
    resolveManualStake(0, true);      // no stake
    game.pendingStakes[0] = { skipped: true };
    resolveManualStake(0, true);      // skipped
  });
  const after = await page.evaluate(() => teamCoins(game.teams[0]));
  expect(after).toBe(before);
});
// ── game.js: openStakeModal restores an already-pending stake's range ─────

test('reopening the stake modal pre-fills the previously placed range', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    game.pendingStakes[0] = { amount: 25, span: 5, lo: 1985, hi: 1989 };
    openStakeModal(0);
  });
  expect(await page.evaluate(() => +$('#stake-range-lo').value)).toBe(1985);
  expect(await page.evaluate(() => +$('#stake-range-hi').value)).toBe(1989);
});
// ── game.js: onStakeRangeHiInput clamp ─────────────────────────────────────

test('dragging hi handle below min clamps both handles', async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL);
  await page.evaluate(() => {
    settings.gameMode = true; persistSettings(); ensureTeams(2);
    renderTeamStrip();
  });
  await page.locator('[data-stake="0"]').click();
  await page.evaluate(() => {
    $('#stake-range-hi').value = '1800'; // below min 1900
    onStakeRangeHiInput();
  });
  const [lo, hi] = await page.evaluate(() => [+$('#stake-range-lo').value, +$('#stake-range-hi').value]);
  expect(hi).toBeGreaterThanOrEqual(1900);
  expect(lo).toBeGreaterThanOrEqual(1900);
});
// ── game.js: loadGame branches (corrupt JSON, non-array teams) ─────────────

test('loadGame returns the default state when teams is not an array', async ({ page, baseURL }) => {
  await gotoApp(page, baseURL);
  const out = await page.evaluate(() => {
    localStorage.setItem('songster.game', JSON.stringify({ teams: 'not-array' }));
    return loadGame();
  });
  expect(out).toEqual({ teams: [], pendingStakes: {} });
});

test('loadGame returns the default state on corrupt JSON', async ({ page, baseURL }) => {
  await gotoApp(page, baseURL);
  const out = await page.evaluate(() => {
    localStorage.setItem('songster.game', 'not valid');
    return loadGame();
  });
  expect(out).toEqual({ teams: [], pendingStakes: {} });
});

test('loadGame returns the stored state when teams is an array', async ({ page, baseURL }) => {
  await gotoApp(page, baseURL);
  const out = await page.evaluate(() => {
    localStorage.setItem('songster.game', JSON.stringify({
      teams: [{ id: 0, name: 'T1', history: [] }],
      pendingStakes: { 0: { amount: 5 } },
    }));
    return loadGame();
  });
  expect(out.teams).toHaveLength(1);
  expect(out.pendingStakes).toEqual({ 0: { amount: 5 } });
});
