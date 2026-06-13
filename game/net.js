// Cortex Clash — WebRTC online play (PeerJS signaling, host-authoritative)
'use strict';
const NET = (() => {
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — avoids confusion
  const PREFIX = 'cortex-clash-v1-';
  let peer = null, conn = null;
  let sfxOrig = null;
  let soundQ = [];
  let lastSent = 0;
  let hbTimer = null, lastRecvAt = 0; // heartbeat: detect a peer that vanished
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
    stopHeartbeat();
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

  // broker-socket hiccups (e.g. the tab gets backgrounded while the native
  // share sheet is open) are recoverable — PeerJS keeps the same ID and we
  // just re-open the signaling socket instead of killing the room
  const RECOVERABLE = ['network', 'socket-error', 'socket-closed', 'server-error', 'disconnected'];
  function tryReconnect() {
    if (!peer || peer.destroyed || !peer.disconnected) return;
    S.status = 'RECONNECTING…';
    try { peer.reconnect(); } catch (e) {}
  }
  // returning to the foreground after sharing: re-establish the dropped socket
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && active()) tryReconnect();
    });
  }
  function onPeerError(e, fatalMap) {
    const ty = (e && e.type) || '';
    if (fatalMap[ty]) { S.status = fatalMap[ty]; return; }
    if (RECOVERABLE.indexOf(ty) >= 0) { S.status = 'RECONNECTING…'; setTimeout(tryReconnect, 600); return; }
    S.status = netErrText(e);
  }

  function onRemoteClosed() {
    if (!conn) return;
    stopHeartbeat();
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
    peer.on('open', () => { if (!S.connected) S.status = 'WAITING FOR PLAYER 2'; });
    peer.on('connection', (c) => {
      if (conn) { try { c.close(); } catch (e) {} return; } // room is full
      conn = c;
      c.on('open', () => {
        S.connected = true;
        S.status = 'PLAYER 2 CONNECTED';
        wrapSounds();
        startHeartbeat();
        if (H.onPeerJoined) H.onPeerJoined();
      });
      c.on('data', onHostData);
      c.on('close', onRemoteClosed);
      c.on('error', onRemoteClosed);
    });
    peer.on('disconnected', tryReconnect);
    peer.on('error', (e) => onPeerError(e, { 'unavailable-id': 'CODE CLASH — TAP CANCEL, RETRY' }));
  }

  function join(code) {
    teardown();
    code = String(code || '').toUpperCase();
    S.mode = 'guest'; S.view = 1; S.code = code; S.status = 'CONNECTING…';
    if (libMissing()) return;
    peer = new Peer({ debug: 0 });
    peer.on('open', () => {
      if (conn) return; // a reconnect to the broker — keep the existing data link
      conn = peer.connect(PREFIX + code, { reliable: true });
      conn.on('open', () => { S.connected = true; S.status = 'CONNECTED — STARTING…'; startHeartbeat(); });
      conn.on('data', onGuestData);
      conn.on('close', onRemoteClosed);
      conn.on('error', onRemoteClosed);
    });
    peer.on('disconnected', tryReconnect);
    peer.on('error', (e) => onPeerError(e, { 'peer-unavailable': 'GAME NOT FOUND — CHECK CODE' }));
  }

  // a peer that closes its tab often never fires a clean 'close', so each side
  // pings every 1.5s and declares the opponent gone after ~6s of silence
  function startHeartbeat() {
    stopHeartbeat();
    lastRecvAt = Date.now();
    hbTimer = setInterval(() => {
      if (!conn || !S.connected) return;
      try { conn.send({ t: 'ping' }); } catch (e) {}
      if (Date.now() - lastRecvAt > 6000) onRemoteClosed();
    }, 1500);
  }
  function stopHeartbeat() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }

  function onHostData(m) {
    if (!m || typeof m !== 'object') return;
    lastRecvAt = Date.now();
    if (m.t === 'bye') { onRemoteClosed(); return; }
    if (m.t === 'ping') return;
    if (H.onGuestInput) H.onGuestInput(m);
  }

  function onGuestData(m) {
    if (!m || typeof m !== 'object') return;
    lastRecvAt = Date.now();
    if (m.t === 'bye') { onRemoteClosed(); return; }
    if (m.t === 'ping') return;
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

  const canShare = () => typeof navigator !== 'undefined' && !!navigator.share;

  // ALWAYS copy the link to the clipboard (reliable everywhere), and on devices
  // with a native share sheet also offer to send it. Fire the clipboard write
  // without awaiting so navigator.share still counts as a direct user gesture.
  function shareLink() {
    const l = inviteLink();
    if (!l) { S.copyMsg = 'NO LINK YET'; return; }
    let copied = false;
    if (navigator.clipboard) { navigator.clipboard.writeText(l).then(() => {}, () => {}); copied = true; }
    if (canShare()) {
      navigator.share({ title: 'Cortex Clash', text: '⚔ I challenge you to a Cortex Clash duel! Tap to join:', url: l })
        .then(() => { S.copyMsg = 'INVITE SHARED!'; })
        .catch(() => { S.copyMsg = copied ? 'LINK COPIED — SEND IT!' : 'COPY THE CODE INSTEAD'; });
    } else {
      S.copyMsg = copied ? 'LINK COPIED — SEND IT!' : 'COPY BLOCKED — SHARE THE CODE';
    }
  }

  function bind(handlers) { H = handlers || {}; }

  return { S, ALPHA, active, myPlayer, hostRoom, join, leave, bind, send, sendStart, hostTick, guestSmooth, unpackInto, copyLink, shareLink, canShare };
})();
window.NET = NET;
