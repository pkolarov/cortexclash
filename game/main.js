// Cortex Clash — input, screens, main loop
'use strict';
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let screen = 'title'; // title | lobby | join | game | picker
  let picker = null;    // { title, options: [rosterIds], onPick }
  let watchBottom = null;
  let boardIdx = Math.min(BOARDS.length - 1, Math.max(0, parseInt(localStorage.getItem('cc-board') || '0', 10) || 0));
  let g = null;
  let paused = false;
  let netLost = false;
  let joinCode = '';
  let last = performance.now();

  window.UI = { buttons: [] };

  function startGame() {
    g = makeGame(boardIdx);
    paused = false;
    netLost = false;
    setSplit(null);
    drags.clear();
    screen = 'game';
  }

  function backToTitle() {
    NET.leave();
    AI.stop();
    picker = null;
    g = null;
    netLost = false;
    setSplit(null);
    drags.clear();
    screen = 'title';
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
        options: AI.ROSTER.map((r) => r.id),
        onPick: (id) => {
          watchBottom = id;
          SFX.cursor();
          picker = {
            title: 'PLAYER 2 · TOP',
            options: AI.ROSTER.map((r) => r.id),
            onPick: (topId) => startWatch(watchBottom, topId),
          };
        },
      };
      screen = 'picker';
    },
    pickerChoose: (i) => { if (picker) picker.onPick(picker.options[i]); },
    pickerBack: () => { SFX.cursor(); picker = null; screen = 'title'; },
    pickBoard: (i) => { boardIdx = i; localStorage.setItem('cc-board', String(i)); SFX.cursor(); },
    createOnline: () => { SFX.select(); NET.hostRoom(); screen = 'lobby'; },
    joinOnline: () => { SFX.cursor(); screen = 'join'; },
    cancelOnline: () => { SFX.cursor(); backToTitle(); },
    copyLink: () => { SFX.cursor(); NET.copyLink(); },
    key: (ch) => { if (joinCode.length < 4) { joinCode += ch; SFX.cursor(); } else SFX.deny(); },
    del: () => { joinCode = joinCode.slice(0, -1); SFX.cursor(); },
    joinGo: () => { if (joinCode.length === 4) { SFX.select(); NET.join(joinCode); } else SFX.deny(); },
    pause: () => {
      if (NET.S.mode === 'guest') { NET.send({ t: 'pause' }); SFX.cursor(); return; }
      paused = !paused;
      SFX.cursor();
    },
    mute: () => { SFX.toggleMute(); },
    split: (pl) => {
      if (!g || g.over || paused) return;
      if (NET.S.mode === 'guest') { NET.send({ t: 'split' }); return; }
      if (AI.S.ctls[pl]) return; // an AI controls this side
      trySplit(g, pl);
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
    onPeerJoined: () => { startGame(); NET.sendStart(boardIdx, g); },
    onGuestStart: (bi, maxE, walls, pieces) => {
      boardIdx = Math.max(0, Math.min(BOARDS.length - 1, bi | 0));
      g = makeGame(boardIdx);
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
      setSplit(null);
      drags.clear();
      lastTap = { t: 0, c: -1, r: -1 };
      screen = 'game';
      SFX.select();
    },
    onState: (m) => {
      if (screen !== 'game' || !g) return;
      NET.unpackInto(g, m.s);
      paused = !!m.p;
      if (m.snd) for (const s of m.snd) { const fn = SFX[s[0]]; if (typeof fn === 'function') fn.apply(SFX, s[1] || []); }
    },
    onGuestInput: (m) => {
      if (screen !== 'game' || !g) return;
      if (m.t === 'pause') { paused = !paused; SFX.cursor(); return; }
      if (g.over) {
        if (m.t === 'rematch') ACTIONS.rematch();
        return;
      }
      if (paused) return;
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
      if (screen === 'game') netLost = true;
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
  function dispatchTap(c, r) {
    if (NET.S.mode === 'guest') NET.send({ t: 'tap', c, r });
    else if (NET.S.mode === 'host') tapCell(g, c, r, 0);
    else if (AI.S.watch) { /* spectator: board taps do nothing */ }
    else if (AI.active()) tapCell(g, c, r, 0);
    else tapCell(g, c, r);
  }

  // press-down on an own piece: select it without toggling (so a drag that
  // starts on an already-selected piece keeps it selected). Returns owner|null.
  function dispatchSelect(c, r) {
    if (NET.S.mode === 'guest') { NET.send({ t: 'sel', c, r }); const sp = ownPieceAt(c, r); return sp ? sp.owner : null; }
    if (NET.S.mode === 'host') return selectAt(g, c, r, 0);
    if (AI.S.watch) return null;
    if (AI.active()) return selectAt(g, c, r, 0);
    return selectAt(g, c, r);
  }

  // drag-place: move exactly the dragged piece (never closest-claim, so a drag
  // in local 2P can't grab the other player's selection). Returns true on move.
  function dispatchPlace(pl, pieceId, c, r) {
    if (NET.S.mode === 'guest') { NET.send({ t: 'tap', c, r }); return true; }
    return commandPieceTo(g, pl, pieceId, c, r);
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
    dispatchSplitMove(splitUI.pl, splitUI.pieceId, splitUI.k, c, r);
    closeSplitUI();
  }

  window.ACTIONS.chipPick = (k) => {
    if (splitUI) { splitUI.k = k; SFX.cursor(); }
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    SFX.ensure();
    const { x, y, lx, ly } = toLogical(e);
    for (let i = UI.buttons.length - 1; i >= 0; i--) {
      const b = UI.buttons[i];
      const tx = b.abs ? x : lx, ty = b.abs ? y : ly;
      if (tx >= b.x && tx <= b.x + b.w && ty >= b.y && ty <= b.y + b.h) { b.action(); return; }
    }
    if (screen === 'game' && g && !g.over && !paused && !netLost) {
      const c = Math.floor((lx - BX) / CELL);
      const r = Math.floor((ly - BY) / CELL);
      if (!inBounds(c, r)) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      const d = { c, r, pieceId: null, pl: -1, opened: false };
      drags.set(e.pointerId, d);

      // a board press while the picker is open either launches the chosen
      // fragment at a gold cell or dismisses the picker (chip taps are buttons,
      // handled above, so they never reach here)
      if (splitUI) {
        if (splitDestLegal(c, r)) { fireSplit(c, r); return; }
        closeSplitUI();
        return;
      }

      // double-tap on an own splittable piece explodes it into a fragment picker
      const now = performance.now();
      const dbl = now - lastTap.t < 350 && lastTap.c === c && lastTap.r === r;
      lastTap = { t: now, c, r };
      if (dbl) {
        const sp = ownPieceAt(c, r);
        if (sp && sp.value >= 2) {
          setSplit({ pl: sp.owner, pieceId: sp.id, k: 0, t0: performance.now() / 1000 });
          d.opened = true; // ignore this pointer's lift so it can't self-close
          SFX.select();
          return;
        }
      }

      const sp = ownPieceAt(c, r);
      if (sp) { d.pieceId = sp.id; d.pl = sp.owner; dispatchSelect(c, r); }
      else dispatchTap(c, r); // empty/enemy cell: move the selected piece here
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    const drag = drags.get(e.pointerId);
    drags.delete(e.pointerId);
    if (!drag || screen !== 'game' || !g || g.over || paused || netLost) return;
    if (drag.opened) return; // the gesture that opened the picker doesn't act on lift
    const { lx, ly } = toLogical(e);
    const c = Math.floor((lx - BX) / CELL);
    const r = Math.floor((ly - BY) / CELL);
    if (!inBounds(c, r) || (c === drag.c && r === drag.r)) return; // pure tap
    lastTap.t = 0; // a drag is not part of a double-tap
    if (splitUI) {
      if (splitDestLegal(c, r)) fireSplit(c, r); // dragged a chip onto a gold cell
      return; // never close the picker on a stray lift
    }
    if (drag.pieceId != null) dispatchPlace(drag.pl, drag.pieceId, c, r);
    else dispatchTap(c, r);
  });
  canvas.addEventListener('pointercancel', (e) => drags.delete(e.pointerId));
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    UI.buttons.length = 0;
    if (screen === 'game' && g) {
      if (NET.S.mode === 'guest') {
        if (!paused) NET.guestSmooth(g, dt);
      } else if (!paused) {
        updateGame(g, dt);
        AI.tick(g, dt);
      }
      // the split picker dies with its piece (moved, killed, merged, game over)
      if (splitUI) {
        const p = pieceById(g, splitUI.pieceId);
        if (g.over || paused || !p || p.path || p.owner !== splitUI.pl || p.value < 2) setSplit(null);
        else if (splitUI.k >= p.value) splitUI.k = 0;
      }
      window.SPLITUI = splitUI;
      drawGame(ctx, g, paused, t);
      drawSplitUI(ctx, g, t);
      if (!g.over) AI.drawHud(ctx); // don't freeze a taunt/status on the win screen
      if (NET.S.mode === 'host') NET.hostTick(g, paused, now);
      if (netLost) {
        drawOverlayMsg(ctx, 'OPPONENT LEFT', '#ff5566', 'TAP TO RETURN TO TITLE');
        UI.buttons.push({ x: 0, y: 0, w: W, h: H, abs: true, action: ACTIONS.netBack });
      }
    } else if (screen === 'picker' && picker) {
      drawPicker(ctx, picker, t);
    } else if (screen === 'lobby') {
      drawLobby(ctx, boardIdx, t);
    } else if (screen === 'join') {
      drawJoin(ctx, joinCode, t);
    } else {
      drawTitle(ctx, boardIdx, t);
    }
    requestAnimationFrame(frame);
  }

  // auto-join when opened via an invite link (#room=XXXX)
  const roomMatch = (location.search + ' ' + location.hash).match(/room=([A-Za-z]{4})/);
  if (roomMatch) {
    joinCode = roomMatch[1].toUpperCase();
    screen = 'join';
    setTimeout(() => { if (typeof Peer !== 'undefined' && screen === 'join') NET.join(joinCode); }, 400);
  }

  if (document.fonts && document.fonts.load) {
    document.fonts.load('20px "Press Start 2P"').catch(() => {});
  }
  requestAnimationFrame(frame);
})();
