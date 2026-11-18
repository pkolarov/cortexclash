// Cortex Clash — input, screens, main loop
'use strict';
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let screen = 'title'; // title | vs | camp | campintro | nameentry | lb | lobby | join | invite | game | picker
  let picker = null;    // { title, options: [rosterIds], onPick }
  // storage can throw (private mode, blocked site data): the game must still start
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  let watchBottom = null;
  let boardIdx = Math.min(BOARDS.length - 1, Math.max(0, parseInt(lsGet('cc-board') || '0', 10) || 0));
  let prefBoard = boardIdx; // the arena the player picked in the VS menu (a campaign borrows boardIdx per stage)
  let g = null;
  let paused = false;
  let netLost = false;
  let joinCode = '';
  let last = performance.now();

  // RTS (real-time) vs Turn-based (plan 30s, then everyone's queued orders play
  // out). Mode is chosen on the title screen and persists.
  let gameMode = lsGet('cc-mode') === 'turn' ? 'turn' : 'rts';
  window.CC_MODE = gameMode;
  const PLAN_SECS = 30;     // planning window per turn
  const MIN_RES = 1.6;      // resolution runs at least this long (so campers drain)
  const MAX_RES = 5;        // …and no longer than this (safety for stuck movement)
  const GRACE = 1.5;        // online: after the clock, wait this long for the guest's last orders + ready
  let guestGoTurn = -1;     // guest: the turn we pressed GO (or auto-readied) on
  let tickSec = -1;         // last whole-second we played a countdown tick on
  // local 2P: the player who most recently pressed one of their own pieces. A
  // follow-up tap on a cell both players' selections can reach goes to them
  // (not to whichever selected piece is nearer, which moved the wrong side)
  let lastSelPl = null;

  // ---- campaign ----
  // camp = { mode, stage, lives, score, cleared, won, result } while a run is on
  // ({kind: win|lose|draw|clear|gameover} appears when a stage ends); window.CAMP
  // mirrors it for the renderer.
  let camp = null;
  function setCamp(v) { camp = v; window.CAMP = v; }
  window.CAMP = null;
  let campBest = 0;           // best score for the current mode, shown on menus
  let lbMode = gameMode;      // which leaderboard tab is showing
  let lbList = [];
  let lbHi = null;            // timestamp of the entry just added (highlighted)
  let nameChars = [0, 0, 0];  // initials as 0..35 (A-Z, 0-9)
  const NAME_SET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const nameStr = () => nameChars.map((i) => NAME_SET[i]).join('');
  function refreshBest() { campBest = CAMPAIGN.best(gameMode); }
  function refreshLb() { lbList = CAMPAIGN.loadBoard(lbMode); }
  refreshBest();
  // A double-tap must never fire a different button that the next screen puts under the
  // same spot (NEXT STAGE -> QUIT RUN, CONTINUE -> SKIP...): after any menu / campaign
  // screen change, taps are ignored for a moment. QUIT RUN also needs a second, deliberate tap.
  const UI_LOCK_MS = 450;
  let uiKey = '', uiLockUntil = 0, quitArmUntil = 0;
  window.quitArmed = () => performance.now() < quitArmUntil;

  window.UI = { buttons: [] };

  // test hook: only with ?debug in the URL — lets automated checks reach the match and campaign state
  if (/[?&]debug\b/.test(location.search)) {
    window.__cc = { get g() { return g; }, get camp() { return camp; }, get screen() { return screen; } };
  }

  // Android edge-swipe / back gesture fires popstate, which would otherwise
  // quit the game. Push a guard entry so a stray back is captured by popstate
  // (below) and turned into a pause instead of an exit.
  // One guard entry is enough however many matches are played: pushing one per
  // game left a stack of them, and the title's back gesture then needed a press
  // for each. popstate consumes the guard (clears the flag).
  let guardOn = false;
  function pushGameGuard() {
    if (guardOn) return;
    try { history.pushState({ cc: 'game' }, ''); guardOn = true; } catch (e) {}
  }

  function startGame(lvl) {
    // a campaign lesson / puzzle is a hand-built position; everything else is a normal match on the chosen arena
    g = lvl && lvl.kind !== 'battle' ? makeLevelGame(CAMPAIGN.levelSpec(lvl, gameMode)) : makeGame(boardIdx);
    if (lvl && lvl.limit && gameMode === 'turn') g.limit = lvl.limit;
    g.mode = gameMode;              // host/solo/2P; an online guest is overridden by the host's start packet
    if (g.mode === 'turn') initTurnState();
    paused = false;
    netLost = false;
    setSplit(null);
    drags.clear();
    screen = 'game';
    pushGameGuard();
  }

  // (re)enter a planning phase: fresh 30s clock, empty order book, clean fx
  function initTurnState() {
    g.phase = 'plan';
    g.planT = g.rules && g.rules.noTimer ? 9999 : PLAN_SECS;
    g.resolveT = 0;
    g.orders = {};
    g.ready = [false, false];       // online: each side's "GO" flag (resolve when both, or timer)
    g.turnNo = (g.turnNo || 0) + 1;
    g.fx = []; g.shake = 0; g.flash = 0;
    // power-ups: one every other turn. The engine's spawn timer only ticks while
    // resolving (~2s a turn), which made them ~20x rarer than in real-time
    if (g.turnNo % 2 === 0) spawnPowerup(g);
    tickSec = -1;
    if (AI.newTurn) AI.newTurn(g);
  }

  function backToTitle() {
    NET.leave();
    AI.stop();
    picker = null;
    g = null;
    netLost = false;
    joinCode = '';
    guestGoTurn = -1;
    setSplit(null);
    drags.clear();
    setCamp(null);
    boardIdx = prefBoard;
    screen = 'vs'; // everything that calls this (match over, lobby cancelled) came from the VS menu
  }

  function startSinglePlayer(id) {
    if (!AI.ensureKeys([id])) { SFX.deny(); return; }
    NET.leave();
    SFX.select();
    AI.startSingle(id);
    startGame();
  }

  function startWatch(bottomId, topId) {
    if (!AI.ensureKeys([bottomId, topId])) { SFX.deny(); return; }
    NET.leave();
    SFX.select();
    AI.startWatch(bottomId, topId);
    startGame();
  }

  // ---- coach cards: short pop-up lessons that freeze the match until tapped ----
  let coach = null;       // { cards:[{title,lines,art?}], i, at }
  let coachFlags = {};    // triggers already fired this attempt
  window.COACH = null;
  function showCards(cards) {
    if (!cards || !cards.length) return;
    if (coach) { coach.cards = coach.cards.concat(cards); return; }
    coach = { cards: cards.slice(), i: 0, at: performance.now() };
    window.COACH = coach;
    SFX.select();
  }
  function coachCards(lvl, on) {
    const out = [];
    for (const c of lvl.coach || []) if (c.on === on) out.push(...c.cards);
    return out;
  }
  // each frame while playing a campaign level: lessons that react to what just happened
  function coachTick() {
    const lvl = camp.lvl;
    if (!lvl) return;
    // the first time a pickup type is on the board in this run, say what it does
    for (const u of g.powerups) {
      const info = CAMPAIGN.POWER_INFO[u.type];
      if (info && !camp.seen['power:' + u.type]) {
        camp.seen['power:' + u.type] = true;
        showCards([{ title: info.title, lines: info.lines, art: u.type, col: info.col }]);
        return;
      }
    }
    if (!coachFlags.camp && g.pieces.some((p) => p.owner === 0 && !p.path && p.col === 4 && p.row === 1)) {
      coachFlags.camp = true;
      showCards(coachCards(lvl, 'camp'));
    }
    if (g.mode === 'turn' && g.phase === 'plan' && coachFlags.turn !== g.turnNo) {
      coachFlags.turn = g.turnNo;
      if (g.turnNo > 1) showCards(coachCards(lvl, 'turn:' + g.turnNo));
    }
  }

  // the stage just ended (g.over): score it, spend a life on a loss
  function finishStage() {
    const w = g.winner, lvl = camp.lvl, levels = CAMPAIGN.levels(camp.mode);
    if (w === 0) {
      const sc = CAMPAIGN.levelScore(g, lvl, camp.stage, camp.mode, camp.tries);
      camp.score += sc.total;
      camp.cleared = camp.stage + 1;
      const last = camp.stage === levels.length - 1;
      let bonus = 0;
      if (last) { bonus = CAMPAIGN.clearBonus(camp.lives); camp.score += bonus; camp.won = true; }
      camp.result = { kind: last ? 'clear' : 'win', rows: sc.rows, bonus };
    } else if (w === 1) {
      camp.tries++;
      const why = g.timeUp ? 'OUT OF TURNS' : 'DEFEATED';
      if (lvl.free) camp.result = { kind: 'retry', why }; // lessons and puzzles: retry as often as you like
      else {
        camp.lives = Math.max(0, camp.lives - 1);
        camp.result = { kind: camp.lives > 0 ? 'lose' : 'gameover', why };
      }
    } else {
      camp.result = { kind: 'draw' }; // level finish: replay the level, no life lost
    }
  }

  // run is over (cleared or out of lives): name entry if the score places
  function finishRun() {
    AI.stop(); g = null; paused = false; boardIdx = prefBoard;
    if (CAMPAIGN.qualifies(camp.mode, camp.score)) {
      const saved = lsGet('cc-lb-name') || 'AAA';
      nameChars = [0, 1, 2].map((i) => Math.max(0, NAME_SET.indexOf(CAMPAIGN.cleanName(saved)[i] || 'A')));
      screen = 'nameentry';
    } else {
      lbMode = camp.mode; lbHi = null; refreshLb(); setCamp(null); screen = 'lb';
    }
  }

  window.ACTIONS = {
    start: () => { NET.leave(); AI.stop(); SFX.select(); startGame(); },
    vsComputer: () => {
      SFX.cursor();
      picker = { title: 'SELECT DIFFICULTY', options: AI.DIFF_IDS, onPick: startSinglePlayer };
      screen = 'picker';
    },
    vsClaude: () => {
      SFX.cursor();
      picker = { title: 'SELECT CLAUDE MODEL', options: AI.CLAUDE_IDS, onPick: startSinglePlayer };
      screen = 'picker';
    },
    aiVsAi: () => {
      SFX.cursor();
      watchBottom = null;
      picker = {
        title: 'PLAYER 1 · BOTTOM',
        options: AI.ROSTER.filter((r) => !r.hidden).map((r) => r.id),
        onPick: (id) => {
          watchBottom = id;
          SFX.cursor();
          picker = {
            title: 'PLAYER 2 · TOP',
            options: AI.ROSTER.filter((r) => !r.hidden).map((r) => r.id),
            onPick: (topId) => startWatch(watchBottom, topId),
          };
        },
      };
      screen = 'picker';
    },
    pickerChoose: (i) => { if (picker) picker.onPick(picker.options[i]); },
    pickerBack: () => { SFX.cursor(); picker = null; screen = 'vs'; },
    pickBoard: (i) => { boardIdx = prefBoard = i; lsSet('cc-board', String(i)); SFX.cursor(); },
    setMode: (m) => { gameMode = m === 'turn' ? 'turn' : 'rts'; window.CC_MODE = gameMode; lsSet('cc-mode', gameMode); lbMode = gameMode; refreshBest(); SFX.cursor(); },
    // ---- top-level menu ----
    menuVs: () => { SFX.cursor(); screen = 'vs'; },
    menuCampaign: () => { SFX.cursor(); refreshBest(); screen = 'camp'; },
    menuBack: () => { SFX.cursor(); picker = null; screen = 'title'; },
    // ---- campaign ----
    campStart: () => {
      NET.leave(); AI.stop(); SFX.select();
      setCamp({ mode: gameMode, stage: 0, lives: CAMPAIGN.LIVES, score: 0, cleared: 0, won: false, result: null, tries: 0, seen: {}, lvl: null });
      screen = 'campintro';
    },
    campFight: () => {
      if (!camp) return;
      const lvl = CAMPAIGN.levels(camp.mode)[camp.stage];
      if (!lvl) return;
      NET.leave(); SFX.select();
      camp.lvl = lvl; camp.result = null;
      coachFlags = {}; coach = null; window.COACH = null;
      if (lvl.kind === 'battle') {
        AI.startSingle(lvl.ai);
        boardIdx = lvl.board;
        startGame(lvl);
      } else {
        AI.startSingle(lvl.script ? 'cpu-script' : (lvl.ai || 'cpu-still'), { script: lvl.script, name: lvl.kind === 'puzzle' ? 'PUZZLE' : (lvl.foe && lvl.foe.length ? 'DUMMY' : 'TARGET') });
        startGame(lvl);
      }
      showCards(coachCards(lvl, 'start'));
    },
    campNext: () => {
      if (!camp || !camp.result) return;
      SFX.select();
      const k = camp.result.kind;
      if (k === 'win') { camp.stage++; camp.tries = 0; camp.result = null; AI.stop(); g = null; screen = 'campintro'; }
      else if (k === 'lose' || k === 'draw' || k === 'retry') { camp.result = null; AI.stop(); g = null; screen = 'campintro'; }
      else finishRun();
    },
    // leave the run (pause menu, stage intro): forfeits it, nothing is recorded
    campQuit: () => {
      if (!camp) return;
      const now = performance.now();
      if (now >= quitArmUntil) { quitArmUntil = now + 2500; SFX.cursor(); return; } // first tap arms it
      quitArmUntil = 0;
      SFX.cursor(); AI.stop(); g = null; paused = false; setSplit(null); drags.clear();
      coach = null; window.COACH = null;
      setCamp(null); boardIdx = prefBoard; refreshBest(); screen = 'camp';
    },
    campBoard: () => { SFX.cursor(); lbMode = gameMode; lbHi = null; refreshLb(); screen = 'lb'; },
    lbMode: (m) => { lbMode = m === 'turn' ? 'turn' : 'rts'; lbHi = null; refreshLb(); SFX.cursor(); },
    lbBack: () => { SFX.cursor(); refreshBest(); screen = 'camp'; },
    nameCycle: (i, d) => { nameChars[i] = (nameChars[i] + d + NAME_SET.length) % NAME_SET.length; SFX.cursor(); },
    nameOk: () => {
      if (!camp) { screen = 'camp'; return; }
      SFX.select();
      lsSet('cc-lb-name', nameStr());
      const e = CAMPAIGN.addEntry(camp.mode, { n: nameStr(), s: camp.score, st: camp.cleared, cl: camp.won });
      lbMode = camp.mode; lbHi = e ? e.t : null; refreshLb();
      setCamp(null); screen = 'lb';
    },
    nameSkip: () => {
      SFX.cursor();
      if (camp) lbMode = camp.mode;
      lbHi = null; refreshLb(); setCamp(null); screen = 'lb';
    },
    // commit your plan. Every mode is a "ready" handshake that tickTurn turns
    // into a resolve once every side is in (or the clock runs out): online each
    // device readies its own side, local 2P has a GO per player (one GO used to
    // resolve both plans mid-thought), and vs an AI we wait for an LLM's answer
    go: (pl) => {
      if (!(g && g.mode === 'turn' && g.phase === 'plan' && !g.over) || paused) return;
      // a player's GO closes THEIR split picker, not the other player's
      if (splitUI && (pl == null || splitUI.pl === (pl === 1 ? 1 : 0))) setSplit(null);
      SFX.cursor();
      if (NET.S.mode === 'guest') { NET.send({ t: 'ready', tn: g.turnNo }); g.ready[1] = true; guestGoTurn = g.turnNo; return; }
      if (NET.S.mode === 'host') { g.ready[0] = true; return; }
      if (controllablePls().length === 2) { g.ready[pl === 1 ? 1 : 0] = true; return; }
      g.ready[0] = g.ready[1] = true; // the lone human is in; the AI side counts once it has planned
    },
    createOnline: () => { SFX.select(); NET.hostRoom(); screen = 'lobby'; },
    joinOnline: () => { SFX.cursor(); joinCode = ''; screen = 'join'; },
    cancelOnline: () => { SFX.cursor(); backToTitle(); },
    copyLink: () => { SFX.cursor(); NET.copyLink(); },
    shareLink: () => { SFX.cursor(); NET.shareLink(); },
    coachNext: () => {
      if (!coach) return;
      const now = performance.now();
      if (now - coach.at < 350) return; // a double-tap must not skip a card unread
      coach.i++;
      if (coach.i >= coach.cards.length) { coach = null; window.COACH = null; SFX.select(); }
      else { coach.at = now; SFX.cursor(); }
    },
    key: (ch) => { if (joinCode.length < 4) { joinCode += ch; SFX.cursor(); } else SFX.deny(); },
    del: () => { joinCode = joinCode.slice(0, -1); SFX.cursor(); },
    joinGo: () => { if (joinCode.length === 4) { SFX.select(); NET.join(joinCode); } else SFX.deny(); },
    pause: () => {
      if (NET.S.mode === 'guest') { NET.send({ t: 'pause' }); SFX.cursor(); return; }
      paused = !paused;
      SFX.cursor();
    },
    mute: () => { SFX.toggleMute(); },
    // the SPLIT button now opens the explode picker for the selected piece
    // (a discoverable alternative to double-tapping it)
    split: (pl) => {
      if (!g || g.over || paused) return;
      if (AI.S.ctls[pl]) return; // an AI controls this side
      const id = g.sel[pl];
      const p = id && pieceById(g, id);
      if (!p || p.path || p.value < 2) { SFX.deny(); return; }
      openPicker(pl, id);
    },
    rematch: () => {
      if (NET.S.mode === 'guest') { NET.send({ t: 'rematch' }); SFX.cursor(); return; }
      SFX.select();
      if (AI.active()) AI.restart();
      startGame();
      if (NET.S.mode === 'host') NET.sendStart(boardIdx, g);
    },
    toTitle: () => { SFX.cursor(); backToTitle(); },
    netBack: () => { SFX.cursor(); backToTitle(); },
  };

  NET.bind({
    onPeerJoined: () => {
      // the previous guest dropped mid-match and someone (them, reloaded, or
      // anyone with the code) reconnected: pick the match up where it stands
      // instead of restarting it — a restart let a losing guest undo the position
      if (screen === 'game' && g && !g.over) { netLost = false; NET.sendStart(boardIdx, g); return; }
      startGame(); NET.sendStart(boardIdx, g);
    },
    onGuestStart: (bi, maxE, walls, pieces, mode) => {
      boardIdx = Math.max(0, Math.min(BOARDS.length - 1, bi | 0));
      g = makeGame(boardIdx);
      g.mode = mode === 'turn' ? 'turn' : 'rts';
      if (g.mode === 'turn') { g.phase = 'plan'; g.planT = PLAN_SECS; g.orders = {}; g.resolveT = 0; g.ready = [false, false]; }
      if (Array.isArray(walls)) g.walls = new Set(walls); // chaos arenas are host-generated
      // CHAOS armies are random per-makeGame; take the host's so there's no
      // start-of-match flash of a wrong (locally-rolled) army on the guest
      if (Array.isArray(pieces)) {
        g.pieces = pieces.map((a) => ({
          id: a[0], owner: a[1], value: a[2], col: a[3], row: a[4],
          path: null, prog: 0, from: null, shield: false, charged: false, boostUntil: -99,
        }));
        g.nextId = g.pieces.reduce((m, p) => Math.max(m, p.id), 0) + 1;
      }
      if (maxE > 0) for (const k of g.castles) { k.max = maxE; k.energy = maxE; }
      paused = false;
      netLost = false;
      guestGoTurn = -1; // a fresh match: no GO pressed yet (a stale one hid GO and stalled the host)
      setSplit(null);
      drags.clear();
      lastTap = { t: 0, c: -1, r: -1 };
      screen = 'game';
      pushGameGuard();
      SFX.select();
    },
    onState: (m) => {
      if (screen !== 'game' || !g) return;
      const prevPhase = g.phase;
      NET.unpackInto(g, m.s);
      paused = !!m.p;
      // guest: a phase flip (plan→resolve, or into a fresh plan) wipes our local
      // ghost orders — they've either fired or a new turn has begun
      if (g.mode === 'turn' && g.phase !== prevPhase) g.orders = {};
      // our GO may not have reached the host yet — don't let a snapshot un-ready it
      if (g.mode === 'turn' && g.ready && guestGoTurn === g.turnNo) g.ready[1] = true;
      if (m.snd) for (const s of m.snd) { const fn = SFX[s[0]]; if (typeof fn === 'function') fn.apply(SFX, s[1] || []); }
    },
    onGuestInput: (m) => {
      if (screen !== 'game' || !g) return;
      if (m.t === 'pause') { paused = !paused; SFX.cursor(); return; }
      if (g.over) {
        if (m.t === 'rematch') ACTIONS.rematch();
        return;
      }
      // (turn plans keep flowing while paused: the clock is frozen, and orders
      // already in flight when the pause began must not vanish from the host)
      if (paused && g.mode !== 'turn') return;
      // turn-based: the guest sends queued orders / a ready flag, not live taps
      if (g.mode === 'turn') {
        if (g.phase !== 'plan') return;
        // made in an earlier turn (slow link): it no longer matches the board
        if (m.tn != null && m.tn !== g.turnNo) return;
        if (m.t === 'order') {
          const p = pieceById(g, m.id | 0);
          if (p && p.owner === 1 && !p.path && legalMoves(g, p).some((x) => x.c === (m.c | 0) && x.r === (m.r | 0))) g.orders[p.id] = { id: p.id, kind: 'move', c: m.c | 0, r: m.r | 0 };
        } else if (m.t === 'sorder') {
          const p = pieceById(g, m.id | 0), k = m.k | 0;
          if (p && p.owner === 1 && !p.path && k >= 1 && k < p.value) {
            const ghost = Object.assign({}, p, { value: k });
            if (legalMoves(g, ghost).some((x) => x.c === (m.c | 0) && x.r === (m.r | 0))) g.orders[p.id] = { id: p.id, kind: 'split', k, c: m.c | 0, r: m.r | 0 };
          }
        } else if (m.t === 'cancel') {
          delete g.orders[m.id | 0];
        } else if (m.t === 'ready') {
          g.ready[1] = true;
        }
        return;
      }
      if (m.t === 'tap') {
        const c = m.c | 0, r = m.r | 0;
        if (inBounds(c, r)) tapCell(g, c, r, 1);
      }
      if (m.t === 'sel') {
        const c = m.c | 0, r = m.r | 0;
        if (inBounds(c, r)) selectAt(g, c, r, 1);
      }
      if (m.t === 'smove') {
        const c = m.c | 0, r = m.r | 0;
        if (inBounds(c, r)) splitMove(g, 1, m.id | 0, m.k | 0, c, r);
      }
      if (m.t === 'split') trySplit(g, 1);
    },
    onRemoteGone: () => {
      if (screen === 'game' && !netLost) { netLost = true; SFX.alarm(); } // make it heard, not just shown
      else if (screen === 'game') netLost = true;
      // lobby: NET resets status to WAITING and accepts a new guest
      // join: NET status shows the error on the join screen
    },
  });

  function fit() {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = Math.floor(W * s) + 'px';
    canvas.style.height = Math.floor(H * s) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  // a back/forward gesture during a live match pauses instead of quitting —
  // we re-push the guard so the page never actually navigates away
  window.addEventListener('popstate', () => {
    guardOn = false; // that entry is gone now
    if (screen === 'game' && g && !g.over && !netLost) {
      pushGameGuard();
      if (!paused) ACTIONS.pause();
    }
  });

  // which players this device may control right now (local 2P: both)
  function controllablePls() {
    if (NET.S.mode === 'guest') return [1];
    if (NET.S.mode === 'host') return [0];
    if (AI.S.watch) return [];
    if (AI.active()) return [0];
    return [0, 1];
  }

  // route a board tap through whichever channel owns the rules (move a piece
  // the engine already has selected, or select/clear via tapCell's toggle)
  // pieces another finger is mid-drag with right now
  function heldPieceIds() {
    const s = new Set();
    for (const d of drags.values()) if (d.pieceId != null && !d.fromChip) s.add(d.pieceId);
    return s;
  }
  // clear a selection only if it still points at this piece (a second finger may
  // have selected something else since)
  function deselect(pl, id) { if (g.sel[pl] === id) g.sel[pl] = null; }

  // local 2P shares one screen. A press on a piece owned by the OTHER player is
  // an attack when the opposing player is holding a selection that can legally
  // hit it (and they selected last, or nobody else did) — not a selection of the
  // enemy piece. Returns true if the press should be treated as that attack.
  function isAttackPress(c, r) {
    if (controllablePls().length < 2) return false;
    const sp = stationaryAt(g, c, r);
    if (!sp) return false;
    const atk = 1 - sp.owner, id = g.sel[atk], p = id != null && pieceById(g, id);
    if (!p || p.path || g.sel[sp.owner] === sp.id) return false;
    if (lastSelPl != null && lastSelPl !== atk) return false;
    return legalMoves(g, p).some((m) => m.c === c && m.r === r && m.kind === 'attack');
  }

  // split picker open, local 2P: a press that clearly belongs to the OTHER player
  // (their own piece, or a cell their selection can reach that isn't one of the
  // picker's landing cells) must not fire or cancel the opener's picker
  function isOtherPlayersPress(c, r) {
    if (!splitUI || controllablePls().length < 2) return false;
    const other = 1 - splitUI.pl;
    const sp = stationaryAt(g, c, r);
    if (sp && sp.owner === other) return true;
    if (splitDestLegal(c, r)) return false;
    const id = g.sel[other], p = id != null && pieceById(g, id);
    return !!(p && !p.path && lastSelPl === other && legalMoves(g, p).some((m) => m.c === c && m.r === r));
  }

  function dispatchTap(c, r) {
    // a finger mid-drag keeps its piece: a second finger's tap must not move it
    const held = heldPieceIds();
    if (held.size && NET.S.mode === 'guest') return; // the guest's selection lives on the host
    const saved = g.sel.slice();
    if (held.size) for (const pl of [0, 1]) if (held.has(g.sel[pl])) g.sel[pl] = null;
    try {
      if (NET.S.mode === 'guest') NET.send({ t: 'tap', c, r });
      else if (NET.S.mode === 'host') tapCell(g, c, r, 0);
      else if (AI.S.watch) { /* spectator: board taps do nothing */ }
      else if (AI.active()) tapCell(g, c, r, 0);
      else tapCell(g, c, r, null, lastSelPl);
    } finally {
      if (held.size) for (const pl of [0, 1]) if (held.has(saved[pl]) && g.sel[pl] == null && g.pieces.some((q) => q.id === saved[pl] && !q.path)) g.sel[pl] = saved[pl];
    }
  }

  // press-down on an own piece: select it without toggling (so a drag that
  // starts on an already-selected piece keeps it selected). Returns owner|null.
  function dispatchSelect(c, r) {
    if (NET.S.mode === 'guest') { NET.send({ t: 'sel', c, r }); const sp = ownPieceAt(c, r); return sp ? sp.owner : null; }
    if (NET.S.mode === 'host') return selectAt(g, c, r, 0);
    if (AI.S.watch) return null;
    if (AI.active()) return selectAt(g, c, r, 0);
    const pl = selectAt(g, c, r);
    if (pl != null) lastSelPl = pl;
    return pl;
  }

  // drag-place: move exactly the dragged piece (never closest-claim, so a drag
  // in local 2P can't grab the other player's selection). Returns true on move.
  function dispatchPlace(pl, pieceId, c, r) {
    if (NET.S.mode === 'guest') { NET.send({ t: 'tap', c, r }); return true; }
    return commandPieceTo(g, pl, pieceId, c, r);
  }

  // a pure tap on an own piece that the previously-selected piece can merge onto
  // (the green "+" cell): the id to merge, else null. Pressing the piece already
  // re-selected it, so the prior selection is captured at pointerdown.
  function tapMergeFrom(prevSel, pieceId, c, r) {
    if (prevSel == null || prevSel === pieceId) return null;
    const prev = pieceById(g, prevSel);
    if (!prev || prev.path) return null;
    return legalMoves(g, prev).some((m) => m.c === c && m.r === r && m.kind === 'combine') ? prev : null;
  }

  function dispatchMerge(pl, prev, c, r) {
    if (NET.S.mode === 'guest') {
      // the press already re-selected the target on the host — select the mover
      // again, then tap the target cell (the host's tapCell sees a legal combine)
      NET.send({ t: 'sel', c: prev.col, r: prev.row });
      NET.send({ t: 'tap', c, r });
      return;
    }
    if (commandPieceTo(g, pl, prev.id, c, r)) g.sel[pl] = null;
  }

  function dispatchSplitMove(pl, pieceId, k, c, r) {
    if (NET.S.mode === 'guest') { NET.send({ t: 'smove', id: pieceId, k, c, r }); return; }
    if (!splitMove(g, pl, pieceId, k, c, r)) SFX.deny();
  }

  function toLogical(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * W;
    const y = (e.clientY - rect.top) / rect.height * H;
    // guest view is rotated 180°; logical coords flip, abs-flagged buttons don't
    const flip = screen === 'game' && NET.S.view === 1;
    return { x, y, lx: flip ? W - x : x, ly: flip ? H - y : y };
  }

  // tap-and-drag: pointerdown selects the pressed piece, pointerup on another
  // cell places it. Each pointer is tracked separately so two local players can
  // drag at once. A pure tap (down+up same cell) just selects, preserving the
  // older tap-piece-then-tap-cell flow.
  const drags = new Map();
  let lastTap = { t: 0, c: -1, r: -1 };
  let splitUI = null; // { pl, pieceId, k, t0 } — double-tap explode picker
  window.SPLITUI = null;

  function ownPieceAt(c, r) {
    const sp = stationaryAt(g, c, r);
    return sp && controllablePls().includes(sp.owner) ? sp : null;
  }

  // keep window.SPLITUI (what drawSplitUI reads) in lockstep with the closure
  function setSplit(v) { splitUI = v; window.SPLITUI = v; }
  function closeSplitUI() { setSplit(null); }

  // explode the selected piece into a fragment picker. Clears the blue
  // selection (local/host) so only the gold fragment cells show.
  function openPicker(pl, pieceId) {
    const p = pieceById(g, pieceId);
    if (!p || p.path || p.value < 2) { SFX.deny(); return false; }
    if (g.mode === 'turn' && g.ready && g.ready[pl]) { SFX.deny(); return false; } // locked in with GO
    setSplit({ pl, pieceId, k: 0, t0: performance.now() / 1000 });
    if (NET.S.mode !== 'guest' && g.sel[pl] === pieceId) g.sel[pl] = null;
    SFX.select();
    return true;
  }

  // is (c,r) a legal landing cell for the currently-chosen fragment size?
  function splitDestLegal(c, r) {
    const su = splitUI;
    if (!su || !su.k) return false;
    const p = pieceById(g, su.pieceId);
    if (!p || (c === p.col && r === p.row)) return false;
    const ghost = Object.assign({}, p, { value: su.k });
    return legalMoves(g, ghost).some((m) => m.c === c && m.r === r);
  }

  function fireSplit(c, r) {
    if (g && g.mode === 'turn') { queueSplitOrder(splitUI.pl, splitUI.pieceId, splitUI.k, c, r); closeSplitUI(); return; }
    dispatchSplitMove(splitUI.pl, splitUI.pieceId, splitUI.k, c, r);
    closeSplitUI();
  }

  window.ACTIONS.chipPick = (k) => {
    if (splitUI) { splitUI.k = k; SFX.cursor(); }
  };

  const cellOf = (lx, ly) => [Math.floor((lx - BX) / CELL), Math.floor((ly - BY) / CELL)];

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    SFX.ensure();
    if ((screen !== 'game' || (camp && camp.result)) && performance.now() < uiLockUntil) return;
    const { x, y, lx, ly } = toLogical(e);
    for (let i = UI.buttons.length - 1; i >= 0; i--) {
      const b = UI.buttons[i];
      const tx = b.abs ? x : lx, ty = b.abs ? y : ly;
      if (tx >= b.x && tx <= b.x + b.w && ty >= b.y && ty <= b.y + b.h) {
        // fragment chips: arm the size AND begin a drag from the chip, so the
        // user can either tap a chip then tap a cell, or drag a chip to a cell.
        // chipBox lets pointerup tell a tap-on-chip (arm only) from a drag-off.
        if (b.chip != null && splitUI) {
          const wasArmed = splitUI.k === b.chip;
          splitUI.k = b.chip;
          SFX.cursor();
          try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
          drags.set(e.pointerId, {
            c: -1, r: -1, fromChip: true, wasArmed, chipBox: { x: b.x, y: b.y, w: b.w, h: b.h },
            pieceId: null, pl: splitUI.pl, ox: b.x + b.w / 2, oy: b.y + b.h / 2,
            lx, ly, startX: lx, startY: ly, moved: false, turn: g && g.turnNo,
          });
          return;
        }
        b.action();
        return;
      }
    }
    // paused: the overlay says "tap to resume" — so a tap anywhere (that didn't
    // hit a button above, e.g. mute) resumes the match
    if (screen === 'game' && g && !g.over && paused && !netLost) {
      ACTIONS.pause();
      return;
    }
    // turn-based planning has its own (queueing) board input, isolated from RTS
    if (screen === 'game' && g && g.mode === 'turn') { handleTurnDown(e, lx, ly); return; }
    if (screen === 'game' && g && !g.over && !paused && !netLost) {
      const [c, r] = cellOf(lx, ly);
      if (!inBounds(c, r)) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      const other = isOtherPlayersPress(c, r);
      drags.set(e.pointerId, { c, r, pieceId: null, pl: -1, lx, ly, startX: lx, startY: ly, moved: false, other });
      // while the picker is open, its owner's board presses resolve on pointerup
      // (tap a gold cell to launch, tap elsewhere to cancel); the other player's
      // presses carry on as normal and leave the picker alone
      if (splitUI && !other) return;
      const sp = ownPieceAt(c, r);
      if (sp && !isAttackPress(c, r)) { const d = drags.get(e.pointerId); d.pieceId = sp.id; d.pl = sp.owner; d.prevSel = g.sel[sp.owner]; dispatchSelect(c, r); }
      else dispatchTap(c, r); // empty/enemy cell: move the selected piece here
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (screen === 'game' && g && g.mode === 'turn') { handleTurnUp(e); return; }
    const drag = drags.get(e.pointerId);
    drags.delete(e.pointerId);
    if (!drag || screen !== 'game' || !g || g.over || paused || netLost) return;
    const { lx, ly } = toLogical(e);
    const [c, r] = cellOf(lx, ly);

    // released after pressing a fragment chip. If the finger never left the
    // chip it's just a tap (arm only — wait for a board tap). If it dragged off
    // onto a gold cell, launch there.
    if (drag.fromChip) {
      const b = drag.chipBox;
      const onChip = b && lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h;
      // a chip can end up over a gold cell: tapping the already-armed chip there
      // launches to the cell underneath, so no landing spot is unreachable
      if ((!onChip || drag.wasArmed) && splitUI && inBounds(c, r) && splitDestLegal(c, r)) fireSplit(c, r);
      return;
    }

    if (splitUI && !drag.other) {
      const tap = c === drag.c && r === drag.r;
      if (inBounds(c, r) && splitDestLegal(c, r)) fireSplit(c, r); // tap/drag a gold cell
      else if (tap) closeSplitUI();                                // tap elsewhere cancels
      return; // a stray drag neither fires nor cancels
    }

    if (!inBounds(c, r) || (c === drag.c && r === drag.r)) {
      // pure tap: detect a double-tap on an own splittable piece → explode.
      // Detecting on the *second tap's release* (not the press) means a
      // tap-then-drag is never mistaken for a double-tap.
      if (inBounds(c, r)) {
        const mate = drag.pieceId != null && tapMergeFrom(drag.prevSel, drag.pieceId, c, r);
        if (mate) { dispatchMerge(drag.pl, mate, c, r); lastTap.t = 0; return; }
        const now = performance.now();
        if (now - lastTap.t < 350 && lastTap.c === c && lastTap.r === r) {
          const sp = ownPieceAt(c, r);
          if (sp && sp.value >= 2) { openPicker(sp.owner, sp.id); lastTap.t = 0; return; }
        }
        lastTap = { t: now, c, r };
      }
      return;
    }
    // dragged to another cell: place the dragged piece. A drag is forgiving —
    // dragging past the piece's reach still sends it as far as allowed along
    // that direction (the clamped landing cell).
    lastTap.t = 0;
    if (drag.pieceId != null) {
      const p = pieceById(g, drag.pieceId);
      const land = p && dragLanding(g, p, c, r);
      if (land && land.landC != null) dispatchPlace(drag.pl, drag.pieceId, land.landC, land.landR);
      else SFX.deny();
    } else dispatchTap(c, r);
  });
  // track the finger while dragging so the renderer can draw a trail
  canvas.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    const { lx, ly } = toLogical(e);
    d.lx = lx; d.ly = ly;
    if (!d.moved && Math.hypot(lx - d.startX, ly - d.startY) > 16) d.moved = true;
  });
  canvas.addEventListener('pointercancel', (e) => drags.delete(e.pointerId));
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // snapshot of in-progress drags the renderer reads each frame to draw trails
  function buildDragVis() {
    const out = [];
    for (const d of drags.values()) {
      if (!d.moved) continue;
      if (d.fromChip) {
        out.push({ kind: 'chip', pl: d.pl, ox: d.ox, oy: d.oy, lx: d.lx, ly: d.ly, k: splitUI ? splitUI.k : 0 });
      } else if (d.pieceId != null && g) {
        const p = pieceById(g, d.pieceId);
        if (!p) continue;
        const [fc, fr] = cellOf(d.lx, d.ly);
        const land = dragLanding(g, p, fc, fr); // where it would actually land
        out.push({
          kind: 'piece', pl: d.pl, fromC: d.c, fromR: d.r, lx: d.lx, ly: d.ly, pieceId: d.pieceId,
          landC: land ? land.landC : null, landR: land ? land.landR : null,
          overreach: land ? land.overreach : true,
        });
      }
    }
    window.DRAGVIS = out;
  }

  // ---------- turn-based: plan → resolve loop ----------
  function tickTurn(dt) {
    if (g.over) return;
    if (g.phase === 'plan') {
      AI.tick(g, dt);                 // LLM sides request + queue orders; bots are planned at resolve
      g.planT -= dt;
      const s = Math.ceil(g.planT);
      if (s <= 5 && s >= 1 && s !== tickSec) { tickSec = s; SFX.cursor(); }  // last-5s countdown beeps
      const both = g.ready[0] && g.ready[1];
      if (NET.S.mode === 'host') {
        // the clock ran out: give the guest a moment so orders it queued in the
        // last instant (still in flight to us) aren't dropped — its client auto-
        // readies at 0 right after sending them, so we resolve as soon as that lands
        const gone = netLost || !NET.S.connected;
        if (both || (g.planT <= 0 && (g.ready[1] || gone || g.planT <= -GRACE))) startResolve();
      } else if (AI.S.watch) {
        if (g.planT <= 0 || (AI.turnReady() && g.planT <= PLAN_SECS - 1)) startResolve(); // AI vs AI: no GO to press
      } else if (g.planT <= 0 || (both && AI.turnReady())) {
        startResolve();
      }
    } else {
      updateGame(g, dt);
      g.resolveT += dt;
      if (g.over) return;
      // safety cap: never leave a piece frozen mid-lane through the next plan
      // phase (planning doesn't advance movement) — play the rest out now
      if (g.resolveT >= MAX_RES) {
        for (let i = 0; i < 900 && anyMoving(g) && !g.over; i++) updateGame(g, 1 / 30);
        if (g.over) return;
      }
      if ((g.resolveT >= MIN_RES && !anyMoving(g)) || g.resolveT >= MAX_RES) startPlan();
    }
  }

  // commit: bots plan their whole turn now, then every queued order fires at once
  function startResolve() {
    for (let own = 0; own < 2; own++) {
      const ctl = AI.S.ctls[own];
      if (ctl && ctl.spec.kind === 'bot') {
        for (const o of AI.planTurn(g, own)) if (!g.orders[o.id]) g.orders[o.id] = o;
      }
    }
    g.resolveStart = g.time; // pieces landing after this are contestants, not defenders
    applyOrders();
    setSplit(null);
    g.sel = [null, null];
    g.phase = 'resolve';
    g.resolveT = 0;
    SFX.select();
  }

  function startPlan() {
    // a puzzle's turn limit: the last turn has played out without a win
    if (g.limit && g.turnNo >= g.limit && !g.over) { g.timeUp = true; endGame(g, 1); return; }
    initTurnState(); SFX.cursor();
  }

  // dispatch the order book through the validating engine calls (illegal or now-
  // blocked orders are simply skipped), lowest id first for a stable resolution
  function applyOrders() {
    const ids = Object.keys(g.orders).map(Number).sort((a, b) => a - b);
    // Validate every order against the pre-move board (no piece is in flight yet,
    // so nothing is reserved), THEN commit them all. This way two pieces can be
    // ordered to the same cell — neither cancels the other; they move and collide
    // there. Movement + combat play out in updateGame.
    const ready = [];
    for (const id of ids) {
      const o = g.orders[id], p = pieceById(g, id);
      if (!p || p.path) continue;
      if (o.kind === 'split') {
        const k = o.k | 0;
        if (k < 1 || k >= p.value) continue;
        const ghost = Object.assign({}, p, { value: k });
        if (legalMoves(g, ghost).some((m) => m.c === (o.c | 0) && m.r === (o.r | 0))) ready.push({ p, kind: 'split', k, c: o.c | 0, r: o.r | 0 });
      } else if (legalMoves(g, p).some((m) => m.c === (o.c | 0) && m.r === (o.r | 0))) {
        ready.push({ p, kind: 'move', c: o.c | 0, r: o.r | 0 });
      }
    }
    for (const v of ready) {
      if (v.kind === 'split') splitMove(g, v.p.owner, v.p.id, v.k, v.c, v.r, true);
      else commandMove(g, v.p, v.c, v.r);
    }
    g.orders = {};
  }

  // online guest mirrors each order to the host (the authority), which validates
  // and stores it for owner-1; solo/2P/host just keep it locally
  function queueOrder(pl, pieceId, c, r) {
    g.orders[pieceId] = { id: pieceId, kind: 'move', c, r };
    if (NET.S.mode === 'guest') NET.send({ t: 'order', id: pieceId, c, r, tn: g.turnNo });
    SFX.select();
  }
  function queueSplitOrder(pl, pieceId, k, c, r) {
    g.orders[pieceId] = { id: pieceId, kind: 'split', k, c, r };
    if (NET.S.mode === 'guest') NET.send({ t: 'sorder', id: pieceId, k, c, r, tn: g.turnNo });
    SFX.split();
  }
  function cancelOrder(pieceId) {
    if (!g.orders[pieceId]) return;
    delete g.orders[pieceId];
    if (NET.S.mode === 'guest') NET.send({ t: 'cancel', id: pieceId, tn: g.turnNo });
    SFX.cursor();
  }

  // press during planning: select the pressed piece (for the legal-cell glow) and
  // start tracking the pointer so a tap and a drag can be told apart on release
  function handleTurnDown(e, lx, ly) {
    if (g.over || netLost || g.phase !== 'plan' || g.planT <= 0) return;
    const [c, r] = cellOf(lx, ly);
    if (!inBounds(c, r)) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    const other = isOtherPlayersPress(c, r);
    // enemy piece pressed while the opponent holds a selection that can hit it →
    // this is the attack's destination tap, not a selection of the enemy piece
    let sp = ownPieceAt(c, r);
    if (sp && isAttackPress(c, r)) sp = null;
    // READY locks that player's plan: no new selections or edits after GO
    if (sp && g.ready && g.ready[sp.owner]) sp = null;
    drags.set(e.pointerId, {
      c, r, pieceId: sp ? sp.id : null, pl: sp ? sp.owner : -1, lx, ly, startX: lx, startY: ly,
      moved: false, fromChip: false, wasSel: sp ? g.sel[sp.owner] === sp.id : false,
      hadOrder: sp ? !!g.orders[sp.id] : false, prevSel: sp ? g.sel[sp.owner] : null,
      other, turn: g.turnNo,
    });
    if (sp && (!splitUI || other)) { g.sel[sp.owner] = sp.id; lastSelPl = sp.owner; }
  }

  // release during planning: queue / replace / cancel an order
  function handleTurnUp(e) {
    const drag = drags.get(e.pointerId);
    drags.delete(e.pointerId);
    if (!drag || g.over || netLost || paused || g.phase !== 'plan' || g.planT <= 0) return;
    // a finger held down across a resolve (or any turn change) must not queue
    // an order in the next plan the player never made
    if (drag.turn !== g.turnNo) return;
    const { lx, ly } = toLogical(e);
    const [c, r] = cellOf(lx, ly);
    // fragment chip dragged onto a gold cell → queue a split
    if (drag.fromChip) {
      const b = drag.chipBox, onChip = b && lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h;
      if ((!onChip || drag.wasArmed) && splitUI && !g.ready[splitUI.pl] && inBounds(c, r) && splitDestLegal(c, r)) fireSplit(c, r);
      return;
    }
    if (splitUI && !drag.other) {
      if (inBounds(c, r) && splitDestLegal(c, r)) fireSplit(c, r);
      else if (c === drag.c && r === drag.r) closeSplitUI();
      return;
    }
    // released off the board (the GO strip, the HUD): cancel, like real-time
    if (!inBounds(c, r)) return;
    // dragged a piece onto another cell → queue that move
    if (drag.pieceId != null && drag.moved && !(c === drag.c && r === drag.r)) {
      const p = pieceById(g, drag.pieceId), land = p && dragLanding(g, p, c, r);
      if (land && land.landC != null) { queueOrder(drag.pl, drag.pieceId, land.landC, land.landR); deselect(drag.pl, drag.pieceId); }
      return;
    }
    // pure tap on the pressed own piece: double-tap explodes, a deliberate re-tap cancels its order
    if (drag.pieceId != null && c === drag.c && r === drag.r) {
      const mate = tapMergeFrom(drag.prevSel, drag.pieceId, c, r);
      if (mate) { queueOrder(drag.pl, mate.id, c, r); deselect(drag.pl, drag.pieceId); lastTap.t = 0; return; }
      const now = performance.now();
      if (now - lastTap.t < 350 && lastTap.c === c && lastTap.r === r) {
        const sp = ownPieceAt(c, r);
        if (sp && sp.value >= 2) { openPicker(sp.owner, sp.id); lastTap.t = 0; return; }
      }
      lastTap = { t: now, c, r };
      if (drag.wasSel && drag.hadOrder) { cancelOrder(drag.pieceId); deselect(drag.pl, drag.pieceId); }
      return;
    }
    // tapped a destination cell with a piece selected → queue the move
    if (inBounds(c, r)) {
      const pls = controllablePls().sort((a, b) => (b === lastSelPl) - (a === lastSelPl)); // last selector first
      for (const pl of pls) {
        if (g.ready && g.ready[pl]) continue; // locked in with GO
        const id = g.sel[pl], p = id != null && pieceById(g, id);
        if (p && legalMoves(g, p).some((m) => m.c === c && m.r === r)) { queueOrder(pl, p.id, c, r); deselect(pl, p.id); return; }
      }
    }
  }

  function frame(now) {
    // a thrown exception must never stop the loop — that would freeze the whole
    // game. Whatever happens in the body, always reschedule the next frame.
    try { frameBody(now); } catch (err) { if (window.console) console.error(err); }
    requestAnimationFrame(frame);
  }

  function frameBody(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    // 80s menu tune on the menus, silence during a match (idempotent each frame)
    if (screen === 'game') SFX.music.stop(); else SFX.music.start();
    UI.buttons.length = 0;
    const key = screen + (camp && camp.result ? ':r' + camp.result.kind : '') + (paused ? ':p' : '');
    if (key !== uiKey) { uiKey = key; uiLockUntil = now + UI_LOCK_MS; quitArmUntil = 0; }
    if (screen === 'game' && g) {
      // an opponent who backgrounded the app (phone locked, app switch) freezes
      // the match until they're back, instead of leaving their side defenceless
      const away = NET.S.peerAway && !netLost && !g.over;
      if (NET.S.mode === 'guest') {
        // turn-based: freeze while planning (the host owns the clock); the host's
        // phase/countdown arrive via the state stream. Smooth only during resolve.
        if (!paused && !(g.mode === 'turn' && g.phase === 'plan')) NET.guestSmooth(g, dt);
        // clock out: say we're done, right behind any orders still in flight, so
        // the host (which waits a short grace for this) resolves with all of them
        if (g.mode === 'turn' && g.phase === 'plan' && !g.over && g.planT <= 0 && guestGoTurn !== g.turnNo) {
          NET.send({ t: 'ready', tn: g.turnNo }); guestGoTurn = g.turnNo; setSplit(null);
        }
      } else if (!paused && !away && !coach && !(netLost && NET.S.mode === 'host')) {
        if (g.mode === 'turn') tickTurn(dt);
        else { updateGame(g, dt); AI.tick(g, dt); }
      }
      // the split picker dies with its piece (moved, killed, merged, game over)
      if (splitUI) {
        const p = pieceById(g, splitUI.pieceId);
        if (g.over || paused || !p || p.path || p.owner !== splitUI.pl || p.value < 2) setSplit(null);
        else if (splitUI.k >= p.value) splitUI.k = 0;
      }
      if (camp && g.over && !camp.result) finishStage();
      if (camp && !coach && !paused && !g.over && !camp.result) coachTick();
      window.SPLITUI = splitUI;
      buildDragVis();
      drawGame(ctx, g, paused, t);
      drawDragTrail(ctx, g, t);
      drawSplitUI(ctx, g, t);
      if (g.mode === 'turn') drawTurnHud(ctx, g, t);
      if (camp && camp.lvl) drawLevelHud(ctx, g, camp, t);
      if (!g.over) AI.drawHud(ctx); // don't freeze a taunt/status on the win screen
      if (coach && !g.over) drawCoach(ctx, coach, t);
      if (NET.S.mode === 'host') NET.hostTick(g, paused, now);
      if (away && !paused) drawOverlayMsg(ctx, 'OPPONENT AWAY', '#ffd23f', 'MATCH PAUSED UNTIL THEY RETURN');
      if (netLost) {
        drawOverlayMsg(ctx, 'OPPONENT LEFT', '#ff5566', NET.S.mode === 'host' && !g.over ? 'MATCH PAUSED · TAP TO LEAVE' : 'TAP TO RETURN TO TITLE');
        UI.buttons.push({ x: 0, y: 0, w: W, h: H, abs: true, action: ACTIONS.netBack });
      }
    } else if (screen === 'picker' && picker) {
      drawPicker(ctx, picker, t);
    } else if (screen === 'vs') {
      drawVs(ctx, boardIdx, t, gameMode);
    } else if (screen === 'camp') {
      drawCampMenu(ctx, t, gameMode, campBest);
    } else if (screen === 'campintro' && camp) {
      drawCampIntro(ctx, t, camp);
    } else if (screen === 'nameentry' && camp) {
      drawNameEntry(ctx, t, nameChars.map((i) => NAME_SET[i]), camp);
    } else if (screen === 'lb') {
      drawLeaderboard(ctx, t, lbMode, lbList, lbHi);
    } else if (screen === 'lobby') {
      drawLobby(ctx, boardIdx, t);
    } else if (screen === 'invite') {
      drawInvite(ctx, joinCode, t);
    } else if (screen === 'join') {
      drawJoin(ctx, joinCode, t);
    } else {
      drawTitle(ctx, t, gameMode, campBest);
    }
  }

  // opened via an invite link (#room=XXXX): show the invite landing and
  // auto-connect, then onGuestStart drops them straight into the match
  const roomMatch = (location.search + ' ' + location.hash).match(/room=([A-Za-z]{4})/);
  if (roomMatch) {
    joinCode = roomMatch[1].toUpperCase();
    screen = 'invite';
    // join() reports a missing network library on the invite screen itself (a skipped join left it saying DROPPING IN forever)
    setTimeout(() => { if (screen === 'invite') NET.join(joinCode); }, 400);
  }

  if (document.fonts && document.fonts.load) {
    document.fonts.load('20px "Press Start 2P"').catch(() => {});
  }
  requestAnimationFrame(frame);
})();
