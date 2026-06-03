import { test, expect, gotoQuizGameMode } from './fixtures.js';

test.beforeEach(async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL, { settings: { gameMode: false } });
});

// ── Settings defaults ───────────────────────────────────────────────────────

test('default settings include sensible values', async ({ page }) => {
  const s = await page.evaluate(() => ({ ...defaultSettings }));
  expect(s.yearMin).toBe(1900);
  expect(s.playTimeLimitSeconds).toBe(30);
  expect(s.startTimePercent).toBe(0);
  expect(s.autoplay).toBe(true);
  expect(s.gameMode).toBe(false);
  expect(s.numTeams).toBe(2);
  expect(s.guessTheYear).toBe(true);
});

// ── Settings modal ──────────────────────────────────────────────────────────

test('settings modal opens via the gear button', async ({ page }) => {
  await page.locator('#btn-settings').click();
  await expect(page.locator('#modal-settings')).toHaveClass(/active/);
});

test('settings modal closes via the Close button', async ({ page }) => {
  await page.locator('#btn-settings').click();
  await page.locator('#set-close').click();
  await expect(page.locator('#modal-settings')).not.toHaveClass(/active/);
});

test('changing play time persists to localStorage', async ({ page }) => {
  await page.locator('#btn-settings').click();
  await page.locator('#set-pt').evaluate(el => { el.value = 45; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('songster.settings')));
  expect(stored.playTimeLimitSeconds).toBe(45);
});

test('changing start time percent persists to localStorage', async ({ page }) => {
  await page.locator('#btn-settings').click();
  await page.locator('#set-st').evaluate(el => { el.value = 25; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('songster.settings')));
  expect(stored.startTimePercent).toBe(25);
});

test('random start toggle disables the start-time slider', async ({ page }) => {
  await page.locator('#btn-settings').click();
  await page.locator('#set-rand').click();
  await expect(page.locator('#set-st')).toBeDisabled();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('songster.settings')));
  expect(stored.randomStartTime).toBe(true);
});

test('autoplay toggle flips the persisted value', async ({ page }) => {
  await page.evaluate(() => { settings.autoplay = true; persistSettings(); });
  await page.locator('#btn-settings').click();
  await page.locator('#set-auto').click();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('songster.settings')));
  expect(stored.autoplay).toBe(false);
});

test('game mode toggle exposes the team count selector', async ({ page }) => {
  await page.locator('#btn-settings').click();
  await expect(page.locator('#game-opts')).toBeHidden();
  await page.locator('#set-game').click();
  await expect(page.locator('#game-opts')).toBeVisible();
});

test('switching team count from 2 to 3 persists and creates an extra team', async ({ page }) => {
  await page.locator('#btn-settings').click();
  await page.locator('#set-game').click();
  await page.locator('#set-teams button[data-n="3"]').click();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('songster.settings')));
  expect(stored.numTeams).toBe(3);
  const teamCount = await page.evaluate(() => game.teams.length);
  expect(teamCount).toBeGreaterThanOrEqual(3);
});

test('Guess the Year toggle persists', async ({ page }) => {
  await page.locator('#btn-settings').click();
  await page.locator('#set-game').click();
  // Default is true — toggle to false.
  await page.locator('#set-guess-year').click();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('songster.settings')));
  expect(stored.guessTheYear).toBe(false);
});

// ── Year range ──────────────────────────────────────────────────────────────

test('applyYearRange swaps min/max if entered in reverse order', async ({ page }) => {
  await page.locator('#btn-settings').click();
  await page.evaluate(() => {
    $('#set-year-min').value = 2020;
    $('#set-year-max').value = 1980;
    applyYearRange();
  });
  const s = await page.evaluate(() => ({ ...settings }));
  expect(s.yearMin).toBe(1980);
  expect(s.yearMax).toBe(2020);
});

// ── Reset to defaults ───────────────────────────────────────────────────────

test('Reset-defaults restores settings after a confirmation', async ({ page }) => {
  await page.locator('#btn-settings').click();
  // Mutate a setting first.
  await page.locator('#set-pt').evaluate(el => { el.value = 60; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await page.locator('#set-reset-defaults').click();
  await page.locator('#confirm-ok').click();
  const s = await page.evaluate(() => ({ ...settings }));
  expect(s.playTimeLimitSeconds).toBe(30);
});

// ── Filter by year ──────────────────────────────────────────────────────────

test('filterByYear keeps only tracks within the configured range', async ({ page }) => {
  const out = await page.evaluate(() => {
    settings.yearMin = 2000;
    settings.yearMax = 2010;
    return filterByYear([
      { year: 1980 }, { year: 2000 }, { year: 2005 }, { year: 2011 }
    ]);
  });
  expect(out.map(t => t.year)).toEqual([2000, 2005]);
});
// ── openSettings / closeSettings ────────────────────────────────────────────

test('openSettings populates the modal from current settings', async ({ page }) => {
  await page.evaluate(() => {
    settings.yearMin = 1970; settings.yearMax = 1990;
    settings.playTimeLimitSeconds = 25; settings.startTimePercent = 10;
    settings.randomStartTime = true; settings.autoplay = false;
    openSettings();
  });
  await expect(page.locator('#set-year-min-lbl')).toHaveText('1970');
  await expect(page.locator('#set-year-max-lbl')).toHaveText('1990');
  await expect(page.locator('#set-pt-lbl')).toHaveText('25');
  await expect(page.locator('#set-st-lbl')).toHaveText('10');
  await expect(page.locator('#set-st')).toBeDisabled();
});

test('closeSettings removes the active class', async ({ page }) => {
  await page.evaluate(() => { openSettings(); closeSettings(); });
  await expect(page.locator('#modal-settings')).not.toHaveClass(/active/);
});
