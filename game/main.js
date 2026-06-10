// Cortex Clash — input, screens, main loop
'use strict';
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let screen = 'title'; // title | lobby | join | game
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
    screen = 'game';
  }

  function backToTitle() {
    NET.leave();
    g = null;
    netLost = false;
    screen = 'title';
  }

  window.ACTIONS = {
    start: () => { NET.leave(); SFX.select(); startGame(); },
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
      trySplit(g, pl);
    },
    rematch: () => {
      if (NET.S.mode === 'guest') { NET.send({ t: 'rematch' }); SFX.cursor(); return; }
      SFX.select();
      startGame();
      if (NET.S.mode === 'host') NET.sendStart(boardIdx, g);
    },
    toTitle: () => { SFX.cursor(); backToTitle(); },
    netBack: () => { SFX.cursor(); backToTitle(); },
  };

  NET.bind({
    onPeerJoined: () => { startGame(); NET.sendStart(boardIdx, g); },
    onGuestStart: (bi, maxE, walls) => {
      boardIdx = Math.max(0, Math.min(BOARDS.length - 1, bi | 0));
      g = makeGame(boardIdx);
      if (Array.isArray(walls)) g.walls = new Set(walls); // chaos arenas are host-generated
      if (maxE > 0) for (const k of g.castles) { k.max = maxE; k.energy = maxE; }
      paused = false;
      netLost = false;
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

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    SFX.ensure();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * W;
    const y = (e.clientY - rect.top) / rect.height * H;
    // guest view is rotated 180°; logical coords flip, abs-flagged buttons don't
    const flip = screen === 'game' && NET.S.view === 1;
    const lx = flip ? W - x : x;
    const ly = flip ? H - y : y;
    for (let i = UI.buttons.length - 1; i >= 0; i--) {
      const b = UI.buttons[i];
      const tx = b.abs ? x : lx, ty = b.abs ? y : ly;
      if (tx >= b.x && tx <= b.x + b.w && ty >= b.y && ty <= b.y + b.h) { b.action(); return; }
    }
    if (screen === 'game' && g && !g.over && !paused && !netLost) {
      const c = Math.floor((lx - BX) / CELL);
      const r = Math.floor((ly - BY) / CELL);
      if (inBounds(c, r)) {
        if (NET.S.mode === 'guest') NET.send({ t: 'tap', c, r });
        else if (NET.S.mode === 'host') tapCell(g, c, r, 0);
        else tapCell(g, c, r);
      }
    }
  });
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
      }
      drawGame(ctx, g, paused, t);
      if (NET.S.mode === 'host') NET.hostTick(g, paused, now);
      if (netLost) {
        drawOverlayMsg(ctx, 'OPPONENT LEFT', '#ff5566', 'TAP TO RETURN TO TITLE');
        UI.buttons.push({ x: 0, y: 0, w: W, h: H, abs: true, action: ACTIONS.netBack });
      }
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
