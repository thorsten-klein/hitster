/* ====================================================
 * Game mode — teams, coins, stakes, history, payout.
 * Depends on quiz.js (settings, quiz state) and util.js.
 * ==================================================== */

const LS_KEY_GAME = 'songster.game';
const GAME_STARTING_COINS = 100;
const STAKE_SPANS = [
  { years: 1,  mult: 8 },
  { years: 2,  mult: 5 },
  { years: 5,  mult: 3 },
  { years: 10, mult: 2 },
];

function loadGame() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY_GAME) || 'null');
    if (raw && Array.isArray(raw.teams)) return raw;
  } catch {}
  return { teams: [], pendingStakes: {} };
}
function persistGame() { localStorage.setItem(LS_KEY_GAME, JSON.stringify(game)); }
let game = loadGame();

function teamCoins(team) {
  return team.history.reduce((sum, e) => sum + (e.delta || 0), GAME_STARTING_COINS);
}
function makeTeam(id) {
  return { id, name: `Team ${id + 1}`, history: [] };
}
function ensureTeams(n) {
  // Add teams if needed, never delete (so history isn't lost when shrinking).
  while (game.teams.length < n) {
    game.teams.push(makeTeam(game.teams.length));
  }
  persistGame();
}
function activeTeams() { return game.teams.slice(0, settings.numTeams); }

function addHistoryEntry(team, entry) {
  entry.id = entry.id || ('e' + Date.now() + '_' + Math.floor(Math.random() * 1e6));
  entry.ts = entry.ts || Date.now();
  team.history.push(entry);
  persistGame();
}
function deleteHistoryEntry(team, entryId) {
  team.history = team.history.filter(e => e.id !== entryId);
  persistGame();
}
function updateHistoryEntry(team, entryId, patch) {
  const e = team.history.find(x => x.id === entryId);
  if (e) Object.assign(e, patch);
  persistGame();
}
function clearPendingStakes() { game.pendingStakes = {}; persistGame(); }
function clearLastResults() { game.lastResults = {}; persistGame(); }

/* ---------------- Team strip on the quiz screen ---------------- */
function renderTeamStrip() {
  const strip = $('#team-strip');
  if (!strip) return;
  if (!settings.gameMode) { strip.style.display = 'none'; strip.innerHTML = ''; return; }
  ensureTeams(settings.numTeams);
  strip.style.display = '';
  strip.dataset.n = settings.numTeams;
  const teams = activeTeams();
  const results = game.lastResults || {};
  const manualMode = settings.gameMode && !settings.guessTheYear && quiz.payoutDone;
  strip.innerHTML = teams.map(t => {
    const coins = teamCoins(t);
    const pending = game.pendingStakes[t.id];
    const lastDelta = results[t.id];
    const hasResult = Number.isFinite(lastDelta);
    // Manual-mode ✓/✗ buttons only for teams that actually placed a non-skipped stake.
    const needsDecision = manualMode && pending && !pending.skipped && !hasResult;

    let label, cls;
    if (hasResult) {
      label = (lastDelta > 0 ? '+' : '') + lastDelta;
      cls = lastDelta > 0 ? 'win' : (lastDelta < 0 ? 'loss' : 'placed');
    } else if (pending) {
      label = pending.skipped ? 'Skipped' : `Stake: ${pending.amount}`;
      cls = 'placed';
    } else {
      label = 'Stake';
      cls = '';
    }
    const decideRow = needsDecision
      ? `<div class="team-decide-row">
           <button class="team-decide accept" data-decide="${t.id},win" title="Correct">✓</button>
           <button class="team-decide decline" data-decide="${t.id},lose" title="Wrong">✗</button>
         </div>`
      : '';
    return `
      <div class="team-card" data-team="${t.id}">
        <div class="team-row">
          <div class="team-name">${escHtml(t.name)}</div>
          <div style="flex:1"></div>
        </div>
        <div class="team-row">
          <button class="team-coins ${pending ? 'stake-pending' : ''}" data-coins="${t.id}" title="Show history">
            🪙 ${coins}
          </button>
          <button class="team-stake ${cls}" data-stake="${t.id}" ${hasResult || needsDecision ? 'disabled' : ''}>${label}</button>
        </div>
        ${decideRow}
      </div>`;
  }).join('');
  strip.querySelectorAll('[data-decide]').forEach(el => {
    el.addEventListener('click', () => {
      const [tid, outcome] = el.dataset.decide.split(',');
      resolveManualStake(+tid, outcome === 'win');
      // Also refresh the quiz to update the disabled state on Next.
      if (typeof renderQuiz === 'function') renderQuiz();
    });
  });
  strip.querySelectorAll('[data-coins]').forEach(el => {
    el.addEventListener('click', () => openHistoryModal(+el.dataset.coins));
  });
  strip.querySelectorAll('[data-stake]').forEach(el => {
    el.addEventListener('click', () => openStakeModal(+el.dataset.stake));
  });
}

/* ---------------- Stake modal ---------------- */
let stakeContext = null; // { teamId, span }

// Span button label = window WIDTH in years. The gap between the two
// slider handles is therefore (span - 1):
//   1y → gap 0  (lo == hi, e.g. 1999–1999, exact match)
//   2y → gap 1  (e.g. 1999–2000)
//   5y → gap 4
//   10y → gap 9
function stakeGap(span) { return Math.max(0, span - 1); }

// Resolve a stored stake's [lo, hi] window, falling back to the legacy
// {guess, span as half-width} format if needed.
function stakeWindow(stake) {
  if (stake && Number.isFinite(stake.lo) && Number.isFinite(stake.hi)) return [stake.lo, stake.hi];
  if (stake && Number.isFinite(stake.guess) && Number.isFinite(stake.span)) {
    return [stake.guess - stake.span, stake.guess + stake.span];
  }
  return [NOW_YEAR, NOW_YEAR];
}

function openStakeModal(teamId) {
  const team = game.teams[teamId];
  if (!team) return;
  const existing = game.pendingStakes[teamId];
  const initSpan = existing && !existing.skipped ? existing.span : STAKE_SPANS[1].years;
  stakeContext = { teamId, span: initSpan };

  $('#stake-title').textContent = `${team.name} — place your stake`;
  $('#stake-coins').textContent = `Coins available: ${teamCoins(team)}`;

  // In manual mode, the team just stakes coins and says the answer aloud — no
  // year range and no precision multiplier; wins return the flat stake amount.
  const yearMode = !!settings.guessTheYear;
  show($('#stake-precision-block'), yearMode);
  show($('#stake-range-block'), yearMode);
  show($('#stake-info-block'), !yearMode);

  const lo = $('#stake-range-lo');
  const hi = $('#stake-range-hi');
  lo.min = hi.min = 1900;
  lo.max = hi.max = NOW_YEAR;
  const mn = +lo.min, mx = +lo.max;
  const gap = stakeGap(initSpan);

  let initLo, initHi;
  if (existing && !existing.skipped) {
    const [pLo] = stakeWindow(existing);
    initLo = pLo;
    initHi = pLo + gap;
  } else {
    const center = NOW_YEAR - 25;
    initLo = center - Math.floor(gap / 2);
    initHi = initLo + gap;
  }
  if (initLo < mn) { initLo = mn; initHi = initLo + gap; }
  if (initHi > mx) { initHi = mx; initLo = initHi - gap; }
  lo.value = initLo;
  hi.value = initHi;

  $('#stake-coins-input').value = (existing && !existing.skipped ? existing.amount : 10);
  $('#stake-coins-input').max = teamCoins(team);

  paintStakeSpan();
  syncStakeRange();
  updateStakeSummary();
  $('#modal-stake').classList.add('active');
}

function paintStakeSpan() {
  document.querySelectorAll('#stake-span button').forEach(b => {
    b.classList.toggle('active', +b.dataset.span === stakeContext.span);
  });
}

function stakeMult(span) {
  const s = STAKE_SPANS.find(x => x.years === span);
  return s ? s.mult : 1;
}

// Refresh the green fill + readout under the slider from the current input values.
function syncStakeRange() {
  const lo = $('#stake-range-lo');
  const hi = $('#stake-range-hi');
  const mn = +lo.min, mx = +lo.max;
  const span = mx - mn || 1;
  const fill = $('#stake-range-fill');
  fill.style.left  = ((+lo.value - mn) / span * 100) + '%';
  fill.style.right = ((mx - +hi.value) / span * 100) + '%';
  $('#stake-range-lo-lbl').textContent = lo.value;
  $('#stake-range-hi-lbl').textContent = hi.value;
}

// User dragged the lo handle: move hi to keep the gap. Clamp at max.
function onStakeRangeLoInput() {
  if (!stakeContext) return;
  const lo = $('#stake-range-lo');
  const hi = $('#stake-range-hi');
  const gap = stakeGap(stakeContext.span);
  const mx = +lo.max;
  let newLo = +lo.value;
  let newHi = newLo + gap;
  if (newHi > mx) { newHi = mx; newLo = mx - gap; lo.value = newLo; }
  hi.value = newHi;
  syncStakeRange();
}
// User dragged the hi handle: move lo to keep the gap. Clamp at min.
function onStakeRangeHiInput() {
  if (!stakeContext) return;
  const lo = $('#stake-range-lo');
  const hi = $('#stake-range-hi');
  const gap = stakeGap(stakeContext.span);
  const mn = +hi.min;
  let newHi = +hi.value;
  let newLo = newHi - gap;
  if (newLo < mn) { newLo = mn; newHi = mn + gap; hi.value = newHi; }
  lo.value = newLo;
  syncStakeRange();
}
// User picked a different precision: same clamping logic as dragging lo handle.
function applyStakeSpan() { onStakeRangeLoInput(); }

// Clicked the ± button next to lo or hi: nudge the chosen end by ±1, the
// other end follows so the gap stays fixed (same behavior as dragging).
function nudgeStake(which, delta) {
  if (!stakeContext) return;
  const lo = $('#stake-range-lo');
  const hi = $('#stake-range-hi');
  if (which === 'lo') {
    lo.value = +lo.value + delta;
    onStakeRangeLoInput();
  } else {
    hi.value = +hi.value + delta;
    onStakeRangeHiInput();
  }
}

function updateStakeSummary() {
  if (!stakeContext) return;
  const coins = +$('#stake-coins-input').value || 0;
  const mult = settings.guessTheYear ? stakeMult(stakeContext.span) : 1;
  const win = coins * mult;
  $('#stake-summary').innerHTML =
    `Correct: <span class="win">+${win}</span> &nbsp;·&nbsp; Wrong: <span class="loss">−${coins}</span>`;
}

/* ---------------- Payout on reveal ---------------- */
// True when game mode is on, "Guess the year" is off, the song has been
// revealed, and at least one team that placed a real stake hasn't been marked yet.
function hasPendingDecisions() {
  if (!settings.gameMode || settings.guessTheYear || !quiz.payoutDone) return false;
  for (const stake of Object.values(game.pendingStakes)) {
    if (stake && !stake.skipped) return true;
  }
  return false;
}

// Manual-mode resolution for a single team: user marks the answer accept/decline.
// In manual mode there's no precision multiplier — a correct guess returns the
// flat stake; a wrong one loses the flat stake.
function resolveManualStake(tid, win) {
  const team = game.teams[tid];
  const stake = game.pendingStakes[tid];
  if (!team || !stake || stake.skipped) return;
  const track = quiz.currentTrack;
  const actual = track?.year;
  const delta = win ? stake.amount : -stake.amount;
  game.lastResults = game.lastResults || {};
  game.lastResults[tid] = delta;
  addHistoryEntry(team, {
    type: 'stake', delta,
    stakeAmount: stake.amount, span: null, lo: null, hi: null, win,
    songName: track?.name, songArtist: track?.artist, songYear: actual,
  });
  delete game.pendingStakes[tid];
  persistGame();
  renderTeamStrip();
}

function recordSkip(team, tid, track, actual) {
  game.lastResults[+tid] = 0;
  addHistoryEntry(team, {
    type: 'skip', delta: 0,
    songName: track.name, songArtist: track.artist, songYear: actual,
  });
}

function payoutOnReveal() {
  if (!settings.gameMode) return;
  const track = quiz.currentTrack;
  if (!track) return;
  const actual = track.year;
  game.lastResults = {};
  // Manual mode: only auto-process skips; leave real stakes for the host to mark.
  if (!settings.guessTheYear) {
    for (const [tid, stake] of Object.entries(game.pendingStakes)) {
      const team = game.teams[+tid];
      if (!team || !stake.skipped) continue;
      recordSkip(team, tid, track, actual);
      delete game.pendingStakes[+tid];
    }
    persistGame();
    renderTeamStrip();
    return;
  }
  for (const [tid, stake] of Object.entries(game.pendingStakes)) {
    const team = game.teams[+tid];
    if (!team) continue;
    if (stake.skipped) {
      recordSkip(team, tid, track, actual);
      continue;
    }
    const [lo, hi] = stakeWindow(stake);
    const win = actual >= lo && actual <= hi;
    const delta = win
      ? stake.amount * stakeMult(stake.span)
      : -stake.amount;
    game.lastResults[+tid] = delta;
    addHistoryEntry(team, {
      type: 'stake', delta,
      stakeAmount: stake.amount, span: stake.span, lo, hi, win,
      songName: track.name, songArtist: track.artist, songYear: actual,
    });
  }
  clearPendingStakes();
  renderTeamStrip();
}

/* ---------------- History modal ---------------- */
let historyContext = null; // teamId
function openHistoryModal(teamId) {
  historyContext = teamId;
  const team = game.teams[teamId];
  if (!team) return;
  $('#history-title').textContent = `${team.name} — history`;
  $('#history-coins').textContent = `Current coins: ${teamCoins(team)}`;
  renderHistoryList();
  $('#modal-history').classList.add('active');
}
function renderHistoryList() {
  const team = game.teams[historyContext];
  if (!team) return;
  const root = $('#history-content');
  if (!team.history.length) {
    root.innerHTML = `<div class="muted" style="text-align:center;padding:24px">No entries yet.</div>`;
    return;
  }
  const rows = team.history.slice().reverse().map(e => {
    const dClass = e.delta > 0 ? 'd-pos' : (e.delta < 0 ? 'd-neg' : 'd-zero');
    const dStr = (e.delta > 0 ? '+' : '') + e.delta;
    let what = '';
    if (e.type === 'stake') {
      const win = e.win ? '✓' : '✗';
      const [lo, hi] = stakeWindow(e);
      const range = lo === hi ? `${lo}` : `${lo}–${hi}`;
      what = `<b>${escHtml(e.songName || '?')}</b> — ${escHtml(e.songArtist || '')}<br>
        <span class="muted" style="font-size:11px">window ${range} (${e.span}y), actual ${e.songYear ?? '?'}, stake ${e.stakeAmount} ${win}</span>`;
    } else if (e.type === 'skip') {
      what = `<b>${escHtml(e.songName || '?')}</b><br><span class="muted" style="font-size:11px">skipped (actual ${e.songYear ?? '?'})</span>`;
    } else {
      what = `<b>Manual adjustment</b>${e.note ? `<br><span class="muted" style="font-size:11px">${escHtml(e.note)}</span>` : ''}`;
    }
    return `<tr data-id="${e.id}">
      <td>${what}</td>
      <td class="${dClass}">${dStr}</td>
      <td class="actions">
        <button class="edit" data-edit="${e.id}">Edit</button>
        <button class="del" data-del="${e.id}">Delete</button>
      </td>
    </tr>`;
  }).join('');
  root.innerHTML = `<table class="hist-tbl">
    <thead><tr><th>Event</th><th style="text-align:right">Δ</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  root.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', () => openEditModal(el.dataset.edit));
  });
  root.querySelectorAll('[data-del]').forEach(el => {
    el.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Delete entry?',
        message: "This removes the entry and adjusts the team's coins accordingly.",
        okLabel: 'Delete', cancelLabel: 'Cancel',
      });
      if (!ok) return;
      deleteHistoryEntry(team, el.dataset.del);
      $('#history-coins').textContent = `Current coins: ${teamCoins(team)}`;
      renderHistoryList();
      renderTeamStrip();
    });
  });
}

/* ---------------- Edit / add history entry ---------------- */
let editContext = null; // { teamId, entryId } — entryId null means "create new manual entry"
function openEditModal(entryId) {
  const team = game.teams[historyContext];
  if (!team) return;
  if (entryId) {
    const entry = team.history.find(e => e.id === entryId);
    if (!entry) return;
    editContext = { teamId: historyContext, entryId };
    $('#edit-delta').value = entry.delta;
    $('#edit-note').value = entry.note || '';
  } else {
    editContext = { teamId: historyContext, entryId: null };
    $('#edit-delta').value = 0;
    $('#edit-note').value = '';
  }
  $('#modal-history-edit').classList.add('active');
}

function syncTeamSeg() {
  document.querySelectorAll('#set-teams button').forEach(b => {
    b.classList.toggle('active', +b.dataset.n === settings.numTeams);
  });
}

function syncGameModeToggles() {
  $('#set-game')?.classList.toggle('on', !!settings.gameMode);
  $('#set-game-inline')?.classList.toggle('on', !!settings.gameMode);
  const opts = $('#game-opts');
  if (opts) opts.style.display = settings.gameMode ? '' : 'none';
}
