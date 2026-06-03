import { test, expect, gotoQuizGameMode } from './fixtures.js';

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
