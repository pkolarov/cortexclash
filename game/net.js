// Cortex Clash — WebRTC online play (PeerJS signaling, host-authoritative)
'use strict';
const NET = (() => {
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — avoids confusion
  const PREFIX = 'cortex-clash-v1-';
  let peer = null, conn = null;
  let sfxOrig = null;
  let soundQ = [];
  let lastSent = 0;
  let H = {};

  const S = {
    mode: 'off',      // off | host | guest
    view: 0,          // 1 = render board rotated (guest)
    code: '',
    status: '',
    copyMsg: '',
    connected: false,
    hostSpeed: 1,
  };

  const active = () => S.mode !== 'off';
  const myPlayer = () => (S.mode === 'guest' ? 1 : 0);

  function genCode() {
    const a = new Uint32Array(4);
    crypto.getRandomValues(a);
    let c = '';
    for (let i = 0; i < 4; i++) c += ALPHA[a[i] % ALPHA.length];
    return c;
  }

  // While hosting, every engine sound is also queued and echoed to the guest.
  const SOUND_NAMES = ['cursor', 'select', 'deny', 'launch', 'combine', 'split', 'hit', 'boom', 'shieldBlock', 'power', 'spawn', 'drain', 'alarm', 'fanfare'];
  function wrapSounds() {
    if (sfxOrig) return;
    sfxOrig = {};
    for (const n of SOUND_NAMES) {
      sfxOrig[n] = SFX[n];
      SFX[n] = function () {
        const args = Array.prototype.slice.call(arguments);
        if (S.mode === 'host' && S.connected) soundQ.push(args.length ? [n, args] : [n]);
        sfxOrig[n].apply(SFX, args);
      };
    }
  }
  function unwrapSounds() {
    if (!sfxOrig) return;
    for (const n in sfxOrig) SFX[n] = sfxOrig[n];
    sfxOrig = null;
  }

  function teardown() {
    try { if (conn) conn.close(); } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
    conn = null; peer = null;
    unwrapSounds();
    soundQ = [];
    S.connected = false;
    S.mode = 'off'; S.view = 0; S.status = ''; S.copyMsg = '';
  }

  function leave() {
    if (conn && S.connected) { try { conn.send({ t: 'bye' }); } catch (e) {} }
    teardown();
  }

  function libMissing() {
    if (typeof Peer === 'undefined') { S.status = 'NETWORK LIB FAILED TO LOAD'; return true; }
    return false;
  }

  function netErrText(e) {
    return 'NETWORK ERROR — ' + String((e && e.type) || 'UNKNOWN').toUpperCase().replace(/-/g, ' ');
  }

  function onRemoteClosed() {
    if (!conn) return;
    conn = null;
    S.connected = false;
    soundQ = [];
    if (S.mode === 'host') S.status = 'WAITING FOR PLAYER 2'; // lobby can re-arm
    // NOTE: must NOT start with 'CONNECT' — the join screen colors any
    // 'CONNECT…' status as an in-progress (green) state
    else if (S.mode === 'guest') S.status = 'LINK LOST — TAP BACK';
    if (H.onRemoteGone) H.onRemoteGone();
  }

  function hostRoom() {
    teardown();
    S.mode = 'host'; S.view = 0; S.code = genCode(); S.status = 'OPENING ROOM…';
    if (libMissing()) return;
    peer = new Peer(PREFIX + S.code, { debug: 0 });
    peer.on('open', () => { S.status = 'WAITING FOR PLAYER 2'; });
    peer.on('connection', (c) => {
      if (conn) { try { c.close(); } catch (e) {} return; } // room is full
      conn = c;
      c.on('open', () => {
        S.connected = true;
        S.status = 'PLAYER 2 CONNECTED';
        wrapSounds();
        if (H.onPeerJoined) H.onPeerJoined();
      });
      c.on('data', onHostData);
      c.on('close', onRemoteClosed);
      c.on('error', onRemoteClosed);
    });
    peer.on('error', (e) => {
      if (e && e.type === 'unavailable-id') S.status = 'CODE CLASH — TAP CANCEL, RETRY';
      else S.status = netErrText(e);
    });
  }

  function join(code) {
    teardown();
    code = String(code || '').toUpperCase();
    S.mode = 'guest'; S.view = 1; S.code = code; S.status = 'CONNECTING…';
    if (libMissing()) return;
    peer = new Peer({ debug: 0 });
    peer.on('open', () => {
      conn = peer.connect(PREFIX + code, { reliable: true });
      conn.on('open', () => { S.connected = true; S.status = 'CONNECTED — STARTING…'; });
      conn.on('data', onGuestData);
      conn.on('close', onRemoteClosed);
      conn.on('error', onRemoteClosed);
    });
    peer.on('error', (e) => {
      if (e && e.type === 'peer-unavailable') S.status = 'GAME NOT FOUND — CHECK CODE';
      else S.status = netErrText(e);
    });
  }

  function onHostData(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'bye') { onRemoteClosed(); return; }
    if (H.onGuestInput) H.onGuestInput(m);
  }

  function onGuestData(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'bye') { onRemoteClosed(); return; }
    if (m.t === 'start' && H.onGuestStart) {
      S.hostSpeed = m.spd || 1;
      H.onGuestStart(m.b, m.m, m.walls, m.pcs);
    }
    if (m.t === 'state' && H.onState) {
      S.hostSpeed = m.v || S.hostSpeed;
      H.onState(m);
    }
  }

  // ---------- state sync ----------
  function pack(g) {
    return {
      p: g.pieces.map((p) => [p.id, p.owner, p.value, p.col, p.row, p.path ? p.path.dest : 0, p.path ? p.path.cells : 0, p.prog, p.from, p.shield ? 1 : 0, p.boostUntil, p.charged ? 1 : 0]),
      c: g.castles.map((k) => [k.energy, k.lastDrainT, k.max]),
      u: g.powerups.map((u) => [u.type, u.col, u.row, u.born]),
      f: g.fx.map((f) => [f.type, f.c, f.r, f.owner, f.t, f.m || 0]),
      sel: g.sel, time: g.time, w: g.winner, o: g.over ? 1 : 0, ot: g.overT, sh: g.shake, fl: g.flash || 0,
    };
  }

  function unpackInto(g, s) {
    g.pieces = s.p.map((a) => ({
      id: a[0], owner: a[1], value: a[2], col: a[3], row: a[4],
      path: a[5] ? { dest: a[5], cells: a[6] } : null,
      prog: a[7], from: a[8], shield: !!a[9], boostUntil: a[10], charged: !!a[11],
    }));
    s.c.forEach((ca, i) => { const k = g.castles[i]; k.energy = ca[0]; k.lastDrainT = ca[1]; k.max = ca[2]; });
    g.powerups = s.u.map((a) => ({ type: a[0], col: a[1], row: a[2], born: a[3] }));
    g.fx = s.f.map((a) => ({ type: a[0], c: a[1], r: a[2], owner: a[3], t: a[4], m: a[5] || 0 }));
    g.sel = s.sel; g.time = s.time; g.winner = s.w; g.over = !!s.o; g.overT = s.ot; g.shake = s.sh; g.flash = s.fl || 0;
  }

  function send(m) {
    if (conn && S.connected) { try { conn.send(m); } catch (e) {} }
  }

  function sendStart(boardIdx, g) {
    // ship the host's actual starting army too — CHAOS randomizes it per game,
    // so without this the guest would render its own locally-rolled pieces until
    // the first state packet (a visible wrong-army flash)
    const pcs = g ? g.pieces.map((p) => [p.id, p.owner, p.value, p.col, p.row]) : null;
    send({ t: 'start', b: boardIdx, m: Math.round(window.TWEAKS.castleEnergy), spd: window.TWEAKS.speed, walls: g ? Array.from(g.walls) : null, pcs });
  }

  function hostTick(g, paused, now) {
    if (S.mode !== 'host' || !S.connected) return;
    if (now - lastSent < 66) return; // ~15 Hz
    lastSent = now;
    const m = { t: 'state', s: pack(g), p: paused ? 1 : 0, v: window.TWEAKS.speed };
    if (soundQ.length) { m.snd = soundQ; soundQ = []; }
    send(m);
  }

  // Guest-side smoothing between snapshots: advance motion + fx only,
  // never trigger arrivals/combat — the host owns all rules.
  function guestSmooth(g, dt) {
    dt *= S.hostSpeed || 1;
    for (const f of g.fx) f.t += dt;
    g.fx = g.fx.filter((f) => f.t < 0.9);
    g.shake = Math.max(0, g.shake - dt * 4);
    g.flash = Math.max(0, (g.flash || 0) - dt * 2.6);
    if (g.over) { g.overT += dt; return; }
    g.time += dt;
    for (const p of g.pieces) {
      if (p.path) p.prog = Math.min(p.path.cells, p.prog + speedOf(g, p) * dt);
    }
  }

  function inviteLink() {
    try {
      const u = new URL(location.href);
      u.hash = 'room=' + S.code;
      return u.toString();
    } catch (e) { return ''; }
  }

  function copyLink() {
    const l = inviteLink();
    if (navigator.clipboard && l) {
      navigator.clipboard.writeText(l).then(
        () => { S.copyMsg = 'LINK COPIED — SEND IT!'; },
        () => { S.copyMsg = 'COPY BLOCKED — SHARE THE CODE'; }
      );
    } else {
      S.copyMsg = 'COPY BLOCKED — SHARE THE CODE';
    }
  }

  function bind(handlers) { H = handlers || {}; }

  return { S, ALPHA, active, myPlayer, hostRoom, join, leave, bind, send, sendStart, hostTick, guestSmooth, unpackInto, copyLink };
})();
window.NET = NET;
