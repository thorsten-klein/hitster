/* ====================================================
 * Wiring + boot. Loaded last.
 * ==================================================== */

function showAuthError(html) {
  $('#modal-auth-error-body').innerHTML = html +
    '<div style="text-align:right;margin-top:16px"><button id="modal-auth-error-close" class="primary">OK</button></div>';
  $('#modal-auth-error-close').addEventListener('click', () => $('#modal-auth-error').classList.remove('active'));
  $('#modal-auth-error').classList.add('active');
}

function disconnectPlayer() {
  if (spPlayer) { try { spPlayer.disconnect(); } catch {} }
  spPlayer = null; spDeviceId = null; spReadyPromise = null;
}

function wireAuth() {
  closeOnBackdrop('modal-auth-error');

  $('#btn-login').addEventListener('click', () => {
    const val = $('#cfg-client-id').value.trim();
    CLIENT_ID = val || DEFAULT_CLIENT_ID;
    // Keep the URL in sync with the CID actually being used.
    const url = new URL(location.href);
    url.searchParams.set('cid', CLIENT_ID);
    history.replaceState(null, '', url);
    localStorage.setItem(LS_KEY_LAST_CID, CLIENT_ID);
    beginLogin().catch(e => showAuthError(escHtml(e.message)));
  });
  $('#btn-disconnect').addEventListener('click', () => {
    disconnectPlayer();
    saveAuth(null);
    updateAuthUi();
  });
  $('#btn-continue-auth').addEventListener('click', () => { goToPlaylists(); });

  let cidOnFocus = '';
  let cidDisconnected = false;
  $('#cfg-client-id').addEventListener('focus', () => {
    cidOnFocus = $('#cfg-client-id').value.trim();
    cidDisconnected = false;
  });
  $('#cfg-client-id').addEventListener('input', () => {
    if (cidDisconnected) return;
    if ($('#cfg-client-id').value.trim() === cidOnFocus) return;
    cidDisconnected = true;
    disconnectPlayer();
    saveAuth(null);
    auth = null;
    updateAuthUi();
  });

  $('#btn-copy-link').addEventListener('click', () => {
    const cid = $('#cfg-client-id').value.trim() || DEFAULT_CLIENT_ID;
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('cid', cid);
    copyToClipboard(url.toString(), 'Link copied');
  });

  $('#btn-copy-redirect').addEventListener('click', () => {
    copyToClipboard('https://thorsten-klein.github.io/universal-callback/index.html', 'Redirect URI copied');
  });

  $('#btn-clear-storage').addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Clear all saved data?',
      message: 'This removes your Spotify login, saved playlists, settings, and any custom Client ID. You will need to log in again.',
      okLabel: 'Clear everything',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    disconnectPlayer();
    localStorage.clear();
    CLIENT_ID = DEFAULT_CLIENT_ID;
    $('#cfg-client-id').value = '';
    auth = null;
    updateAuthUi();
    toast('All data cleared');
  });
}

function wirePlaylists() {
  $('#btn-back-playlists').addEventListener('click', () => setScreen('auth'));
  $('#btn-about').addEventListener('click', async () => {
    $('#modal-about').classList.add('active');
    try {
      const me = await spotifyFetch('/me');
      const name = me.display_name || me.id || '';
      $('#about-user-name').textContent = name;
      $('#about-user-email').textContent = '';
      $('#about-user').style.display = name ? '' : 'none';
    } catch { $('#about-user').style.display = 'none'; }
  });
  $('#about-close').addEventListener('click', () => $('#modal-about').classList.remove('active'));
  closeOnBackdrop('modal-about');
  $('#input-url').addEventListener('input', e => { currentPl.url = e.target.value; syncSelectedHistory(); });
  $('#input-desc').addEventListener('input', e => { currentPl.desc = e.target.value; });
  $('#btn-save').addEventListener('click', () => {
    const ok = savePlaylist({ playlistUrl: currentPl.url || $('#input-url').value, description: currentPl.desc || $('#input-desc').value });
    if (ok) toast('Saved playlist: ' + ($('#input-desc').value || currentPl.desc));
  });
  $('#btn-check').addEventListener('click', async () => {
    const url = $('#input-url').value;
    const pid = getPlaylistId(url);
    if (!pid) { setPlaylistsMsg('Invalid playlist URL'); return; }
    try {
      const j = await spotifyFetch(`/playlists/${pid}?fields=name,tracks(total)`);
      setPlaylistsMsg(`OK: "${j.name}" (${j.tracks?.total ?? '?'} tracks)`, 'ok');
    } catch (e) {
      setPlaylistsMsg(e.message);
    }
  });
  $('#btn-start').addEventListener('click', async () => {
    const btn = $('#btn-start');
    const url = $('#input-url').value.trim();
    let desc = $('#input-desc').value.trim();
    if (!url) { setPlaylistsMsg('Playlist URL must be set'); return; }
    const pid = getPlaylistId(url);
    if (!pid) { setPlaylistsMsg('Invalid Spotify playlist URL'); return; }

    // Validate against Spotify before navigating to the quiz.
    setPlaylistsMsg(null);
    const origLabel = btn.querySelector('span')?.textContent;
    if (btn.querySelector('span')) btn.querySelector('span').textContent = 'Checking…';
    btn.disabled = true;
    try {
      const j = await spotifyFetch(`/playlists/${pid}?fields=name,tracks(total)`);
      const total = j?.tracks?.total ?? 0;
      if (!total) {
        setPlaylistsMsg(`Playlist "${j?.name || 'Unknown'}" has no songs.`);
        return;
      }
      if (!desc) desc = j?.name || url;
    } catch (e) {
      setPlaylistsMsg('Could not load playlist: ' + e.message);
      return;
    } finally {
      if (btn.querySelector('span') && origLabel) btn.querySelector('span').textContent = origLabel;
      syncStartButton();
    }

    markPlaylistPlayed(url);

    quiz.playlistUrl = url;
    quiz.playlistTitle = desc;
    quiz.allTracks = []; quiz.filteredTracks = []; quiz.currentTrackIndex = 0;
    quiz.currentTrack = null; quiz.isPlaying = false; quiz.isPaused = false;
    quiz.currentPlaybackPositionMs = 0; quiz.trackDurationMs = 0;
    quiz.currentTrackStartPositionMs = 0; quiz.playbackEndPositionMs = 0;
    quiz.isPlayEndless = false; quiz.pausedByTimer = false;
    quiz.hidden = true;
    setScreen('quiz');
    renderQuiz();
    // Initialize player early (user gesture), then load tracks. Both run in
    // parallel; if the player init fails, surface the error AFTER the playlist
    // load settles — otherwise selectCurrentTrack's errorMessage reset
    // overwrites the player error in races where the playlist finishes second.
    const playlistPromise = loadQuizPlaylist();
    ensurePlayer().catch(async e => {
      await playlistPromise.catch(() => {});
      quiz.errorMessage = 'Player init failed: ' + e.message;
      renderQuiz();
    });
  });
  $('#btn-show-spotify-pls').addEventListener('click', openSpotifyPlsModal);
  $('#modal-pls-close').addEventListener('click', () => $('#modal-spotify-pls').classList.remove('active'));
  $('#modal-pls-search').addEventListener('input', e => renderSpotifyPlsList(e.target.value));
  closeOnBackdrop('modal-spotify-pls');

  // Search public playlists
  $('#btn-search-public-pls').addEventListener('click', openSearchPublicModal);
  $('#search-public-close').addEventListener('click', () => $('#modal-search-public').classList.remove('active'));
  closeOnBackdrop('modal-search-public');
  $('#search-public-q').addEventListener('input', e => {
    const q = e.target.value;
    clearTimeout(searchPubDebounce);
    searchPubDebounce = setTimeout(() => runPublicSearch(q), 350);
  });
  $('#search-public-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      clearTimeout(searchPubDebounce);
      runPublicSearch(e.target.value);
    }
  });

  // Playlist details (songs) modal
  $('#details-pl-close').addEventListener('click', () => $('#modal-pl-details').classList.remove('active'));
  closeOnBackdrop('modal-pl-details');
  $('#details-pl-use').addEventListener('click', () => {
    const p = detailsCurrentPl;
    if (!p) return;
    $('#input-url').value = p.url;
    $('#input-desc').value = p.name || p.url;
    currentPl = { url: p.url, desc: $('#input-desc').value };
    $('#modal-pl-details').classList.remove('active');
    $('#modal-spotify-pls').classList.remove('active');
    $('#modal-search-public').classList.remove('active');
  });

  // "Details" button next to Check on the playlists screen.
  $('#btn-details').addEventListener('click', async () => {
    const url = $('#input-url').value.trim();
    const desc = $('#input-desc').value.trim();
    if (!url) { setPlaylistsMsg('Enter a playlist URL first'); return; }
    if (!getPlaylistId(url)) { setPlaylistsMsg('Invalid playlist URL'); return; }
    setPlaylistsMsg(null);
    openPlaylistDetails({ url, name: desc || url, tracksTotal: 0, owner: '' });
  });

  $('#btn-export').addEventListener('click', () => {
    const data = JSON.stringify({ playlists: loadPlaylists(), exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'songster-playlists.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#history-search').addEventListener('input', e => {
    historyQuery = e.target.value;
    renderHistory();
  });
  document.querySelectorAll('.history-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const col = btn.dataset.sort;
      if (historySort.col === col) {
        historySort.dir = -historySort.dir;
      } else {
        historySort.col = col;
        historySort.dir = col === 'date' ? -1 : 1;
      }
      renderHistory();
    });
  });
  $('#btn-reset-history').addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Reset playlist history?',
      message: 'This clears your saved playlists and reloads the defaults from Spotify.',
      okLabel: 'Reset',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    localStorage.removeItem(LS_KEY_PLAYLISTS);
    renderHistory();
    await seedDefaultsIfFirstRun();
  });
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const text = await f.text();
      const obj = JSON.parse(text);
      const incoming = Array.isArray(obj) ? obj : (obj.playlists || []);
      if (!Array.isArray(incoming)) throw new Error('Invalid format');
      const existing = loadPlaylists();
      const map = new Map(existing.map(p => [p.playlistUrl, p]));
      for (const p of incoming) {
        if (p && p.playlistUrl && p.description) {
          map.set(p.playlistUrl, { playlistUrl: p.playlistUrl, description: p.description });
        }
      }
      savePlaylists(Array.from(map.values()));
      toast(`Imported ${incoming.length} playlists`);
    } catch (err) {
      toast('Import failed: ' + err.message, 'err');
    } finally {
      e.target.value = '';
    }
  });
}

function wireQuiz() {
  // Fullscreen on mobile is finicky — iOS Safari uses webkit-prefixed APIs, and
  // standalone PWAs (Add to Home Screen) report fullscreen via the display-mode
  // media query rather than the fullscreen API. Cover all three cases.
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  const enterFs = () => {
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) {
      toast('Fullscreen isn\'t supported here. On iPhone, tap Share → "Add to Home Screen" instead.', 'err');
      return;
    }
    try {
      const p = fn.call(el);
      if (p && p.catch) p.catch(err => toast('Could not enter fullscreen: ' + (err.message || err), 'err'));
    } catch (e) {
      toast('Could not enter fullscreen: ' + (e.message || e), 'err');
    }
  };
  const exitFs = () => {
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (!fn) return;
    try { const p = fn.call(document); if (p && p.catch) p.catch(()=>{}); } catch {}
  };
  const syncFsIcon = () => {
    const icon = $('#btn-fullscreen')?.querySelector('use');
    if (icon) icon.setAttribute('href', (fsEl() || isStandalone()) ? '#i-fullscreen-exit' : '#i-fullscreen');
  };
  $('#btn-fullscreen').addEventListener('click', () => {
    if (fsEl()) exitFs(); else enterFs();
  });
  document.addEventListener('fullscreenchange', syncFsIcon);
  document.addEventListener('webkitfullscreenchange', syncFsIcon);
  syncFsIcon();

  $('#btn-back-quiz').addEventListener('click', async () => {
    // Invalidate any in-flight playlist load so it can't resume playback after we leave.
    quizSession++;
    quiz.isLoading = false;
    clearTimers();
    try { await playerPause(); } catch {}
    if (fsEl()) exitFs();
    setScreen('playlists');
  });
  $('#btn-settings').addEventListener('click', openSettings);
  $('#set-close').addEventListener('click', closeSettings);
  closeOnBackdrop('modal-settings', closeSettings);

  $('#btn-play').addEventListener('click', () => playCurrent());
  $('#btn-pause').addEventListener('click', () => pauseCurrent());
  $('#btn-restart').addEventListener('click', () => restartCurrent());
  $('#btn-prev').addEventListener('click', () => prevSong());
  $('#btn-next').addEventListener('click', () => nextSong());
  // Set payoutDone BEFORE running payout — payoutOnReveal calls renderTeamStrip,
  // which inspects quiz.payoutDone to decide whether to show the ✓/✗ buttons.
  const onReveal = () => { if (!quiz.payoutDone) { quiz.payoutDone = true; payoutOnReveal(); } };
  $('#btn-show').addEventListener('click', () => { quiz.hidden = false; onReveal(); renderQuiz(); });
  $('#btn-hide').addEventListener('click', () => { quiz.hidden = true; renderQuiz(); });
  $('#reveal-card').addEventListener('click', () => {
    if (!quiz.currentTrack || quiz.isLoading) return;
    quiz.hidden = !quiz.hidden;
    if (!quiz.hidden) onReveal();
    renderQuiz();
  });
  // Opening Spotify elsewhere takes playback off our Web Playback SDK device,
  // so spPlayer.resume() would no-op afterwards. Flag the next play to do a
  // hard "play at current position" via REST instead.
  const onSpotifyLinkClick = e => {
    e.stopPropagation();
    quiz.needsHardResume = true;
    if (quiz.isPlaying) pauseCurrent();
  };
  $('#btn-open-spotify').addEventListener('click', onSpotifyLinkClick);
  $('#btn-search-spotify').addEventListener('click', onSpotifyLinkClick);
  // Reveal-card dropdowns (Open in Spotify / Ask Google). Toggle on click,
  // close any sibling that was open, and stop propagation so the reveal card
  // doesn't collapse. A document-level click closes whichever menu is open.
  $$('.reveal-menu .reveal-act-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const menu = btn.closest('.reveal-menu');
      const wasOpen = menu.classList.contains('open');
      $$('.reveal-menu.open').forEach(m => {
        m.classList.remove('open');
        m.querySelector('.reveal-act-toggle')?.setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        menu.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
  $$('.reveal-menu .reveal-menu-list').forEach(list => {
    // Item clicks should let the link navigate but not bubble to the reveal card.
    list.addEventListener('click', e => e.stopPropagation());
  });
  document.addEventListener('click', () => {
    $$('.reveal-menu.open').forEach(m => {
      m.classList.remove('open');
      m.querySelector('.reveal-act-toggle')?.setAttribute('aria-expanded', 'false');
    });
  });
  $$('[data-seek]').forEach(el => {
    el.addEventListener('click', () => seekDelta(+el.dataset.seek));
  });

  // ----- Stake modal -----
  closeOnBackdrop('modal-stake');
  $('#stake-cancel').addEventListener('click', () => $('#modal-stake').classList.remove('active'));
  $('#stake-span').addEventListener('click', e => {
    const b = e.target.closest('button[data-span]');
    if (!b) return;
    stakeContext.span = +b.dataset.span;
    paintStakeSpan();
    applyStakeSpan();
    updateStakeSummary();
  });
  $('#stake-range-lo').addEventListener('input', onStakeRangeLoInput);
  $('#stake-range-hi').addEventListener('input', onStakeRangeHiInput);
  $('#stake-coins-input').addEventListener('input', updateStakeSummary);
  // +/- steppers next to the coin input (data-step) and next to each year (data-stake-step="lo,±1")
  document.querySelectorAll('#modal-stake .num-step').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.stakeStep) {
        const [which, delta] = btn.dataset.stakeStep.split(',');
        nudgeStake(which, +delta);
        return;
      }
      const input = $('#stake-coins-input');
      const step = +btn.dataset.step;
      const max = +(input.max || 0) || Infinity;
      let v = (+input.value || 0) + step;
      if (v < 1) v = 1;
      if (v > max) v = max;
      input.value = v;
      updateStakeSummary();
    });
  });
  $('#stake-place').addEventListener('click', () => {
    if (!stakeContext) return;
    const team = game.teams[stakeContext.teamId];
    const coins = +$('#stake-coins-input').value;
    const lo = +$('#stake-range-lo').value;
    const hi = +$('#stake-range-hi').value;
    if (!Number.isFinite(coins) || coins <= 0) { toast('Enter a positive coin amount', 'err'); return; }
    if (coins > teamCoins(team)) { toast("You don't have that many coins", 'err'); return; }
    game.pendingStakes[team.id] = { amount: coins, span: stakeContext.span, lo, hi };
    persistGame();
    $('#modal-stake').classList.remove('active');
    renderTeamStrip();
  });
  $('#stake-skip').addEventListener('click', () => {
    if (!stakeContext) return;
    game.pendingStakes[stakeContext.teamId] = { skipped: true };
    persistGame();
    $('#modal-stake').classList.remove('active');
    renderTeamStrip();
  });

  // ----- History modal -----
  closeOnBackdrop('modal-history');
  $('#history-close').addEventListener('click', () => $('#modal-history').classList.remove('active'));
  $('#history-add').addEventListener('click', () => openEditModal(null));

  // ----- Edit-entry modal -----
  closeOnBackdrop('modal-history-edit');
  $('#edit-cancel').addEventListener('click', () => $('#modal-history-edit').classList.remove('active'));
  $('#edit-save').addEventListener('click', () => {
    if (!editContext) return;
    const team = game.teams[editContext.teamId];
    if (!team) return;
    const delta = parseInt($('#edit-delta').value, 10);
    const note = $('#edit-note').value.trim();
    if (!Number.isFinite(delta)) { toast('Enter a number', 'err'); return; }
    if (editContext.entryId) {
      updateHistoryEntry(team, editContext.entryId, { delta, note });
    } else {
      addHistoryEntry(team, { type: 'manual', delta, note });
    }
    $('#modal-history-edit').classList.remove('active');
    $('#history-coins').textContent = `Current coins: ${teamCoins(team)}`;
    renderHistoryList();
    renderTeamStrip();
  });

  // Settings handlers
  const yMin = $('#set-year-min'), yMax = $('#set-year-max');
  const updateYearLabels = () => {
    // Show labels in order (lo on the left, hi on the right) even if the
    // handles physically cross — applyYearRange will swap the stored values
    // on release.
    const lo = Math.min(+yMin.value, +yMax.value);
    const hi = Math.max(+yMin.value, +yMax.value);
    $('#set-year-min-lbl').textContent = lo;
    $('#set-year-max-lbl').textContent = hi;
    updateYearRangeFill();
  };
  yMin.max = NOW_YEAR; yMax.max = NOW_YEAR;
  yMin.addEventListener('input', updateYearLabels);
  yMax.addEventListener('input', updateYearLabels);
  yMin.addEventListener('change', applyYearRange);
  yMax.addEventListener('change', applyYearRange);

  const pt = $('#set-pt');
  pt.addEventListener('input', () => { $('#set-pt-lbl').textContent = pt.value; updatePlayTimeFill(); });
  pt.addEventListener('change', () => { settings.playTimeLimitSeconds = +pt.value; persistSettings(); });

  const st = $('#set-st');
  st.addEventListener('input', () => { $('#set-st-lbl').textContent = st.value; updateStartTimeFill(); });
  st.addEventListener('change', () => { settings.startTimePercent = +st.value; persistSettings(); });

  $('#set-rand').addEventListener('click', () => {
    settings.randomStartTime = !settings.randomStartTime;
    $('#set-rand').classList.toggle('on', settings.randomStartTime);
    $('#set-st').disabled = settings.randomStartTime;
    persistSettings();
  });
  $('#set-auto').addEventListener('click', () => {
    settings.autoplay = !settings.autoplay;
    $('#set-auto').classList.toggle('on', settings.autoplay);
    persistSettings();
  });

  const toggleGameMode = () => {
    settings.gameMode = !settings.gameMode;
    syncGameModeToggles();
    persistSettings();
    if (settings.gameMode) ensureTeams(settings.numTeams);
    renderTeamStrip();
  };
  $('#set-game').addEventListener('click', toggleGameMode);
  $('#set-game-inline').addEventListener('click', toggleGameMode);
  syncGameModeToggles();
  $('#set-guess-year').addEventListener('click', () => {
    settings.guessTheYear = !settings.guessTheYear;
    $('#set-guess-year').classList.toggle('on', settings.guessTheYear);
    persistSettings();
    renderTeamStrip();
    if (typeof renderQuiz === 'function') renderQuiz();
  });
  $('#set-teams').addEventListener('click', e => {
    const btn = e.target.closest('button[data-n]');
    if (!btn) return;
    settings.numTeams = +btn.dataset.n;
    persistSettings();
    ensureTeams(settings.numTeams);
    syncTeamSeg();
    renderTeamStrip();
  });
  $('#set-reset-defaults').addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Reset settings to defaults?',
      message: 'All quiz settings will be reset to their defaults. Team scores are not affected.',
      okLabel: 'Reset',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    Object.assign(settings, defaultSettings);
    persistSettings();
    quiz.filteredTracks = filterByYear(quiz.allTracks);
    quiz.currentTrackIndex = 0;
    selectCurrentTrack();
    openSettings();
    renderTeamStrip();
    if (typeof renderQuiz === 'function') renderQuiz();
  });
  $('#set-reset-game').addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Reset team scores?',
      message: 'All teams will go back to ' + GAME_STARTING_COINS + ' coins and lose their stake history.',
      okLabel: 'Reset',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    game = { teams: [], pendingStakes: {} };
    ensureTeams(settings.numTeams);
    persistGame();
    renderTeamStrip();
  });
}

/* ---------------- Boot ---------------- */
async function boot() {
  // Apply ?cid= query param before anything else.
  const cidParam = new URLSearchParams(location.search).get('cid');
  if (cidParam) {
    const lastCid = localStorage.getItem(LS_KEY_LAST_CID);
    if (lastCid && lastCid !== cidParam) {
      // Different CID — wipe all data so the user starts fresh with the new app.
      localStorage.clear();
    }
    localStorage.setItem(LS_KEY_LAST_CID, cidParam);
    $('#cfg-client-id').value = cidParam;
  }

  auth = loadAuth();
  wireAuth();
  wirePlaylists();
  wireQuiz();
  renderFeatures();
  renderHistory();
  installModalScrollLock();
  updateAuthUi();
  installBackTrap();
  if (isAuthValid()) {
    await goToPlaylists();
  } else {
    setScreen('auth');
  }
}
boot();
