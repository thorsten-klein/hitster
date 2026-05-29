/* ====================================================
 * Quiz screen: settings, state, controls, rendering.
 * Game-mode payout hook is owned by game.js; this file
 * just calls renderTeamStrip()/payoutOnReveal() (defined there)
 * when game.js is loaded.
 * ==================================================== */

const NOW_YEAR = new Date().getFullYear();
const defaultSettings = {
  yearMin: 1900,
  yearMax: NOW_YEAR,
  playTimeLimitSeconds: 30,
  startTimePercent: 0,
  randomStartTime: false,
  autoplay: true,
  gameMode: false,
  numTeams: 2,
  guessTheYear: true,
};
let settings = { ...defaultSettings, ...JSON.parse(localStorage.getItem(LS_KEY_SETTINGS) || '{}') };
function persistSettings() { localStorage.setItem(LS_KEY_SETTINGS, JSON.stringify(settings)); }

let quiz = {
  playlistTitle: '',
  playlistUrl: '',
  isLoading: false,
  allTracks: [],
  filteredTracks: [],
  currentTrackIndex: 0,
  currentTrack: null,
  isPlaying: false,
  isPaused: false,
  currentPlaybackPositionMs: 0,
  trackDurationMs: 0,
  currentTrackStartPositionMs: 0,
  playbackEndPositionMs: 0,
  errorMessage: null,
  hidden: true,
  progressIntervalId: null,
};

function filterByYear(tracks) {
  return tracks.filter(t => t.year >= settings.yearMin && t.year <= settings.yearMax);
}
function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Session counter — incremented every time we leave or re-enter the quiz screen.
// In-flight async work checks this before applying its result, so navigating away
// before the playlist finishes loading won't trigger playback later.
let quizSession = 0;

async function loadQuizPlaylist() {
  const sid = ++quizSession;
  quiz.isLoading = true;
  quiz.errorMessage = null;
  renderQuiz();
  try {
    const pid = getPlaylistId(quiz.playlistUrl);
    if (!pid) throw new Error('Invalid playlist URL');
    const tracks = await fetchPlaylistTracks(pid);
    if (sid !== quizSession) return; // user navigated away while loading
    const shuffled = shuffle(tracks);
    quiz.allTracks = shuffled;
    quiz.filteredTracks = filterByYear(shuffled);
    quiz.currentTrackIndex = 0;
    quiz.isLoading = false;
    selectCurrentTrack();
    renderQuiz();
  } catch (e) {
    if (sid !== quizSession) return;
    quiz.isLoading = false;
    quiz.errorMessage = 'Failed to load tracks: ' + e.message;
    renderQuiz();
  }
}

function selectCurrentTrack() {
  const tracks = quiz.filteredTracks;
  if (!tracks.length) {
    quiz.currentTrack = null;
    quiz.errorMessage = 'No tracks available in selected year range';
    quiz.isPaused = false;
    renderQuiz();
    return;
  }
  const i = quiz.currentTrackIndex % tracks.length;
  quiz.currentTrack = tracks[i];
  quiz.errorMessage = null;
  quiz.isPaused = false;
  quiz.currentTrackStartPositionMs = 0;
  quiz.playbackEndPositionMs = 0;
  quiz.isPlayEndless = false;
  quiz.trackDurationMs = 0;
  quiz.hidden = true;
  quiz.payoutDone = false;
  // New song = fresh round; clear any leftover stakes and the previous round's results.
  if (typeof clearPendingStakes === 'function') clearPendingStakes();
  if (typeof clearLastResults === 'function') clearLastResults();
  // Re-render the team strip and the quiz controls (so Next un-blocks).
  if (typeof renderTeamStrip === 'function') renderTeamStrip();
  renderQuiz();
  if (settings.autoplay) playCurrent();
}

function clearTimers() {
  if (quiz.progressIntervalId) { clearInterval(quiz.progressIntervalId); quiz.progressIntervalId = null; }
}

function startProgressTracking(expectedUri) {
  if (quiz.progressIntervalId) clearInterval(quiz.progressIntervalId);
  let settling = 4;
  quiz.progressIntervalId = setInterval(async () => {
    if (!quiz.isPlaying) return;
    try {
      const s = await playerGetState();
      if (!s) return;
      if (expectedUri && s.uri && s.uri !== expectedUri) return;
      if (settling > 0) { settling--; return; }
      // Spotify sets paused=true and position=0 when a track finishes naturally.
      if (s.paused && quiz.isPlaying) {
        quiz.currentPlaybackPositionMs = quiz.trackDurationMs || s.duration;
        quiz.trackDurationMs = s.duration || quiz.trackDurationMs;
        updateProgressUi();
        applyPause(false);
        return;
      }
      quiz.trackDurationMs = s.duration;
      quiz.currentPlaybackPositionMs = s.duration > 0 ? Math.min(s.position, s.duration) : s.position;
      updateProgressUi();
      if (!quiz.isPlayEndless && quiz.playbackEndPositionMs && s.position >= quiz.playbackEndPositionMs) {
        autoPause();
      }
    } catch {}
  }, 250);
}

// Incremented whenever a play is cancelled (pause/next/prev) so in-flight
// playerPlayTrack calls can detect they've been superseded.
let playGen = 0;

async function playCurrent() {
  const t = quiz.currentTrack;
  if (!t) return;
  if (quiz.isPaused) {
    if (quiz.pausedByTimer) quiz.isPlayEndless = true;
    quiz.pausedByTimer = false;
    await playerResume();
    quiz.isPlaying = true;
    quiz.isPaused = false;
    renderPlayButtons();
    startProgressTracking(t.uri);
    return;
  }
  const gen = ++playGen;
  clearTimers();
  let startPositionMs;
  const playMs = settings.playTimeLimitSeconds * 1000;
  // Use known duration if available, otherwise assume 2 minutes.
  const durationMs = quiz.trackDurationMs > playMs ? quiz.trackDurationMs : 120_000;
  const maxStart = Math.max(0, durationMs - playMs);
  if (settings.randomStartTime) {
    startPositionMs = Math.floor(Math.random() * maxStart);
  } else {
    startPositionMs = Math.floor((settings.startTimePercent / 100) * maxStart);
  }
  // Reset display immediately so the UI never shows a stale position.
  quiz.currentPlaybackPositionMs = startPositionMs;
  updateProgressUi();
  try {
    await playerPlayTrack(t.uri, startPositionMs);
    if (gen !== playGen) {
      // Pause (or next/prev) was requested while we were awaiting the play call.
      // Spotify started playing anyway — stop it now that the command completed.
      playerPause().catch(() => {});
      return;
    }
    quiz.currentTrackStartPositionMs = startPositionMs;
    updateProgressUi();
    afterPlayStarted(t, startPositionMs);
  } catch (e) {
    quiz.errorMessage = e.message;
    renderQuiz();
  }
}

async function applyPause(byTimer = false) {
  quiz.isPlaying = false; // set synchronously so player_state_changed ignores the position reset
  clearTimers();
  await playerPause();
  quiz.isPaused = true;
  quiz.pausedByTimer = byTimer;
  renderPlayButtons();
}
async function pauseCurrent() {
  playGen++; // invalidate any in-flight playCurrent
  await applyPause(false);
}
async function autoPause() {
  await applyPause(true);
}

// Shared post-play-command success path for playCurrent and restartCurrent.
function afterPlayStarted(t, pos) {
  quiz.isPlayEndless = false;
  quiz.isPlaying = true;
  quiz.isPaused = false;
  quiz.currentPlaybackPositionMs = pos;
  quiz.playbackEndPositionMs = pos + (settings.playTimeLimitSeconds * 1000);
  renderPlayButtons();
  updateProgressUi();
  startProgressTracking(t.uri);
}

async function restartCurrent() {
  const t = quiz.currentTrack; if (!t) return;
  const gen = ++playGen;
  clearTimers();
  const pos = quiz.currentTrackStartPositionMs;
  try {
    await playerPlayTrack(t.uri, pos);
    if (gen !== playGen) { playerPause().catch(() => {}); return; }
    afterPlayStarted(t, pos);
  } catch (e) { quiz.errorMessage = e.message; renderQuiz(); }
}

function stepSong(delta) {
  if (!quiz.filteredTracks.length) return;
  playGen++;
  clearTimers();
  playerPause().catch(() => {});
  const n = quiz.filteredTracks.length;
  quiz.currentTrackIndex = (quiz.currentTrackIndex + delta + n) % n;
  quiz.isPlaying = false; quiz.isPaused = false;
  quiz.currentPlaybackPositionMs = 0; quiz.trackDurationMs = 0;
  selectCurrentTrack();
}
function nextSong() {
  if (typeof hasPendingDecisions === 'function' && hasPendingDecisions()) {
    toast("Mark each team's answer first", 'err');
    return;
  }
  stepSong(1);
}
function prevSong() { stepSong(-1); }

async function seekDelta(seconds) {
  const dur = quiz.trackDurationMs;
  const rawPos = quiz.currentPlaybackPositionMs + (seconds * 1000);
  const newPos = Math.max(0, dur > 0 ? Math.min(rawPos, dur) : rawPos);
  if (quiz.playbackEndPositionMs) {
    quiz.isPlayEndless = newPos >= quiz.playbackEndPositionMs;
  }
  // Seeking to/past the end: clamp, show 100%, pause.
  if (dur > 0 && newPos >= dur) {
    quiz.currentPlaybackPositionMs = dur;
    updateProgressUi();
    if (quiz.isPlaying) applyPause(false);
    return;
  }
  await playerSeek(newPos);
  quiz.currentPlaybackPositionMs = newPos;
  updateProgressUi();
}

/* ---------------- Quiz rendering ---------------- */
function renderQuiz() {
  $('#quiz-pl-title').textContent = quiz.playlistTitle || '';
  $('#quiz-avail-tracks').textContent = `Available tracks: ${quiz.filteredTracks.length}`;

  const showLoading = quiz.isLoading;
  show($('#reveal-loading'), showLoading);
  show($('#reveal-hidden'), !showLoading && quiz.hidden);
  show($('#reveal-shown'), !showLoading && !quiz.hidden && !!quiz.currentTrack);
  show($('#reveal-hint'), !showLoading && quiz.hidden && !!quiz.currentTrack);

  if (quiz.currentTrack) {
    $('#d-name').textContent = quiz.currentTrack.name;
    $('#d-artist').textContent = quiz.currentTrack.artist;
    $('#d-album').textContent = quiz.currentTrack.album;
    $('#d-year').textContent = quiz.currentTrack.year || '—';
    $('#d-date').textContent = quiz.currentTrack.releaseDate || '—';
  }

  // Bottom row
  show($('#bottom-row-hidden'), quiz.hidden);
  show($('#bottom-row-shown'), !quiz.hidden);
  const multi = quiz.filteredTracks.length >= 2;
  const blockedByDecisions = typeof hasPendingDecisions === 'function' && hasPendingDecisions();
  $('#btn-prev').disabled = !multi || quiz.isLoading;
  $('#btn-next').disabled = !multi || blockedByDecisions || quiz.isLoading;
  if (blockedByDecisions) $('#btn-next').title = 'Mark each team\'s answer first';
  else $('#btn-next').removeAttribute('title');
  $('#btn-show').disabled = !quiz.currentTrack || quiz.isLoading;

  // Error
  $('#quiz-msg').innerHTML = quiz.errorMessage
    ? `<div class="err"><svg class="icon" style="vertical-align:middle;color:#ff8a8a"><use href="#i-err"/></svg> ${escHtml(quiz.errorMessage)}</div>`
    : '';

  renderPlayButtons();
  updateProgressUi();
}

function renderPlayButtons() {
  show($('#btn-play'), !quiz.isPlaying);
  show($('#btn-pause'), quiz.isPlaying);
  $('#btn-play').disabled = !quiz.currentTrack || quiz.isLoading;
  $('#btn-restart').disabled = !quiz.currentTrack || quiz.isLoading;
  $$('[data-seek]').forEach(el => { el.disabled = quiz.isLoading; });
}

function updateProgressUi() {
  const active = !quiz.isLoading && (quiz.isPlaying || quiz.isPaused);
  const dur = quiz.trackDurationMs > 0 ? quiz.trackDurationMs : 180_000;
  const ratio = active ? Math.max(0, Math.min(1, quiz.currentPlaybackPositionMs / dur)) : 0;

  $('#progress-bar').style.width = (ratio * 100).toFixed(1) + '%';
  $('#progress-pct').textContent = active ? Math.round(ratio * 100) + '%' : '';
  const tc = $('#time-cur');
  if (tc) tc.firstChild.textContent = active ? fmtTime(quiz.currentPlaybackPositionMs) + ' / ' : '';

  const win = $('#progress-window');
  if (win) {
    const endPos = quiz.playbackEndPositionMs;
    if (active && endPos > 0) {
      const left = Math.min(1, quiz.currentTrackStartPositionMs / dur);
      const right = Math.min(1, endPos / dur);
      win.style.left = (left * 100).toFixed(1) + '%';
      win.style.width = ((right - left) * 100).toFixed(1) + '%';
      win.style.display = 'block';
    } else {
      win.style.display = 'none';
    }
  }
}

/* ---------------- Settings UI ---------------- */
function updateYearRangeFill() {
  const mn = +$('#set-year-min').min;
  const mx = +$('#set-year-min').max;
  const lo = Math.min(+$('#set-year-min').value, +$('#set-year-max').value);
  const hi = Math.max(+$('#set-year-min').value, +$('#set-year-max').value);
  const span = mx - mn || 1;
  $('#year-range-fill').style.left  = ((lo - mn) / span * 100) + '%';
  $('#year-range-fill').style.right = ((mx - hi) / span * 100) + '%';
}

// We disable native slider appearance to style the thumb, which also disables
// accent-color filling. Paint the track ourselves with a two-stop gradient.
function paintSliderFill(el, side='left') {
  const pct = ((+el.value - +el.min) / ((+el.max - +el.min) || 1)) * 100;
  el.style.background = side === 'left'
    ? `linear-gradient(to right, #1db954 0%, #1db954 ${pct}%, #ddd ${pct}%, #ddd 100%)`
    : `linear-gradient(to right, #ddd 0%, #ddd ${pct}%, #1db954 ${pct}%, #1db954 100%)`;
}
function updateStartTimeFill() { paintSliderFill($('#set-st'), 'right'); }
function updatePlayTimeFill()  { paintSliderFill($('#set-pt'), 'left'); }

function openSettings() {
  $('#set-year-min').value = settings.yearMin;
  $('#set-year-max').value = settings.yearMax;
  $('#set-year-min-lbl').textContent = settings.yearMin;
  $('#set-year-max-lbl').textContent = settings.yearMax;
  $('#set-pt').value = settings.playTimeLimitSeconds;
  $('#set-pt-lbl').textContent = settings.playTimeLimitSeconds;
  $('#set-st').value = settings.startTimePercent;
  $('#set-st-lbl').textContent = settings.startTimePercent;
  $('#set-rand').classList.toggle('on', !!settings.randomStartTime);
  $('#set-auto').classList.toggle('on', !!settings.autoplay);
  $('#set-st').disabled = !!settings.randomStartTime;
  $('#set-avail-tracks').textContent = `Available tracks: ${quiz.filteredTracks.length}`;
  if (typeof syncGameModeToggles === 'function') syncGameModeToggles();
  if (typeof syncTeamSeg === 'function') syncTeamSeg();
  $('#set-guess-year')?.classList.toggle('on', !!settings.guessTheYear);
  // Paint the slider fills *after* their values are set, otherwise the gradient
  // is computed from the slider's previous/default value.
  updateYearRangeFill();
  updateStartTimeFill();
  updatePlayTimeFill();
  $('#modal-settings').classList.add('active');
}
function closeSettings() { $('#modal-settings').classList.remove('active'); }

function applyYearRange() {
  let mn = +$('#set-year-min').value;
  let mx = +$('#set-year-max').value;
  if (mn > mx) [mn, mx] = [mx, mn];
  settings.yearMin = mn;
  settings.yearMax = mx;
  $('#set-year-min-lbl').textContent = mn;
  $('#set-year-max-lbl').textContent = mx;
  persistSettings();
  quiz.filteredTracks = filterByYear(quiz.allTracks);
  quiz.currentTrackIndex = 0;
  $('#set-avail-tracks').textContent = `Available tracks: ${quiz.filteredTracks.length}`;
  selectCurrentTrack();
}
