import { test, expect, gotoQuizGameMode } from './fixtures.js';

test.beforeEach(async ({ page, baseURL }) => {
  await gotoQuizGameMode(page, baseURL, { settings: { gameMode: false } });
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
