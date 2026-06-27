// Cortex Clash — game rules + real-time simulation
'use strict';
const COLS = 9, ROWS = 13, MAXV = 6;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Live-tweakable settings (the Tweaks panel writes into this)
window.TWEAKS = Object.assign({
  speed: 1, castleEnergy: 36, powerEvery: 9, glow: 1, scanlines: true,
}, window.TWEAKS || {});

// Starting layout, defined for the TOP player (owner 1); bottom is mirrored.
const PIECE_LAYOUT = [[4, 2, 6], [3, 2, 5], [5, 2, 4], [2, 2, 3], [6, 2, 2], [2, 1, 1], [6, 1, 1]];

function cellKey(c, r) { return c + ',' + r; }
function inBounds(c, r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS; }

function makeGame(boardIdx) {
  const board = BOARDS[boardIdx];
  const walls = new Set();
  board.map.forEach((rowStr, r) => {
    for (let c = 0; c < COLS; c++) if (rowStr[c] === '#') walls.add(cellKey(c, r));
  });
  const maxE = Math.round(window.TWEAKS.castleEnergy);
  const castles = [
    { owner: 0, col: 4, row: 11, energy: maxE, max: maxE, lastDrainT: -9, attackT: -9 },
    { owner: 1, col: 4, row: 1, energy: maxE, max: maxE, lastDrainT: -9, attackT: -9 },
  ];
  const pieces = [];
  let pid = 1;
  const newPiece = (owner, value, col, row) => ({
    id: pid++, owner, value, col, row,
    path: null, prog: 0, from: null, shield: false, charged: false, boostUntil: -99,
  });
  if (board.random) {
    // CHAOS: mirrored random walls (rows 3–9 only, so castles stay reachable)
    const nPairs = 5 + ((Math.random() * 5) | 0);
    let guard = 0, made = 0;
    while (made < nPairs && guard++ < 300) {
      const c = (Math.random() * COLS) | 0;
      const r = 3 + ((Math.random() * 4) | 0);
      const k1 = cellKey(c, r), k2 = cellKey(c, ROWS - 1 - r);
      if (walls.has(k1) || walls.has(k2)) continue;
      walls.add(k1);
      if (k2 !== k1) walls.add(k2);
      made++;
    }
    // CHAOS: mirrored random armies — random size, values, and spread
    const n = 5 + ((Math.random() * 4) | 0);
    const used = new Set();
    let placed = 0;
    guard = 0;
    while (placed < n && guard++ < 400) {
      const c = (Math.random() * COLS) | 0;
      const r = (Math.random() * 5) | 0;
      if (c === 4 && r === 1) continue; // castle cell
      const key = cellKey(c, r);
      if (used.has(key) || walls.has(key)) continue;
      used.add(key);
      const v = 1 + ((Math.random() * MAXV) | 0);
      pieces.push(newPiece(1, v, c, r));
      pieces.push(newPiece(0, v, c, ROWS - 1 - r));
      placed++;
    }
  } else {
    for (const owner of [0, 1]) {
      for (const [c, r, v] of PIECE_LAYOUT) {
        pieces.push(newPiece(owner, v, c, owner === 1 ? r : ROWS - 1 - r));
      }
    }
  }
  return {
    boardIdx, walls, castles, pieces, powerups: [],
    sel: [null, null], time: 0, powerTimer: 6, fx: [],
    winner: -1, over: false, overT: 0, shake: 0, flash: 0, nextId: pid,
  };
}

function pieceById(g, id) { return g.pieces.find((p) => p.id === id) || null; }
function stationaryAt(g, c, r) { return g.pieces.find((p) => !p.path && p.col === c && p.row === r) || null; }
function anyMoving(g) { return g.pieces.some((p) => p.path); }
function castleAt(g, c, r) { return g.castles.find((k) => k.col === c && k.row === r) || null; }
function powerupAt(g, c, r) { return g.powerups.find((u) => u.col === c && u.row === r) || null; }

function reservedDests(g) {
  const s = new Set();
  for (const p of g.pieces) if (p.path) s.add(cellKey(p.path.dest[0], p.path.dest[1]));
  return s;
}

function rangeOf(p) { return 7 - p.value; }       // 1 reaches 6 cells, 6 reaches 1
function speedOf(g, p) {                          // cells per second: 1 is fast, 6 is slow
  let s = 0.8 + (MAXV - p.value) * 0.85;
  if (p.boostUntil > g.time) s *= 1.7;
  return s;
}

function legalMoves(g, p) {
  const out = [];
  if (!p || p.path) return out;
  const reserved = reservedDests(g);
  for (const [dx, dy] of DIRS) {
    for (let step = 1; step <= rangeOf(p); step++) {
      const c = p.col + dx * step, r = p.row + dy * step;
      if (!inBounds(c, r) || g.walls.has(cellKey(c, r))) break;
      const k = castleAt(g, c, r);
      if (k) {
        // a piece standing on a castle can be attacked — even on YOUR castle,
        // so defenders can fight off a sieging piece
        const occ = stationaryAt(g, c, r);
        if (occ && occ.owner !== p.owner) out.push({ c, r, kind: 'attack' });
        else if (!occ) out.push({ c, r, kind: k.owner !== p.owner ? 'castle' : 'move' });
        break;
      }
      const sp = stationaryAt(g, c, r);
      if (sp) {
        if (sp.owner !== p.owner) out.push({ c, r, kind: 'attack' });
        else if (sp.value + p.value <= MAXV) out.push({ c, r, kind: 'combine' });
        break;
      }
      if (reserved.has(cellKey(c, r))) continue; // can pass over, can't land on a claimed cell
      out.push({ c, r, kind: powerupAt(g, c, r) ? 'power' : 'move' });
    }
  }
  return out;
}

function commandMove(g, p, c, r) {
  // leaving an enemy castle costs 1 strength — camping is a commitment, not
  // a free in-and-out dance. At 0 the piece burns out entirely.
  const k = castleAt(g, p.col, p.row);
  if (k && k.owner !== p.owner) {
    p.value -= 1;
    addFx(g, 'ring', p.col, p.row, p.owner);
    if (p.value <= 0) {
      addFx(g, 'boom', p.col, p.row, p.owner);
      removePiece(g, p);
      SFX.boom();
      return;
    }
  }
  const n = Math.max(Math.abs(c - p.col), Math.abs(r - p.row));
  p.from = [p.col, p.row];
  p.path = { dest: [c, r], cells: n };
  p.prog = 0;
  SFX.launch(p.value);
}

function piecePos(p) { // board-cell coords (float) for rendering
  if (!p.path) return [p.col, p.row];
  const t = Math.min(1, p.prog / p.path.cells);
  return [
    p.from[0] + (p.path.dest[0] - p.from[0]) * t,
    p.from[1] + (p.path.dest[1] - p.from[1]) * t,
  ];
}

function removePiece(g, p) {
  g.pieces = g.pieces.filter((q) => q !== p);
  for (const pl of [0, 1]) if (g.sel[pl] === p.id) g.sel[pl] = null;
}

// m = a magnitude/value carried with the fx so the renderer can scale it and
// draw damage numbers. Synced to the guest in net.js.
function addFx(g, type, c, r, owner, m) { g.fx.push({ type, c, r, owner, t: 0, m: m || 0 }); }

function combat(g, atk, def) {
  const av = atk.value, dv = def.value;
  // only heavyweight clashes rattle the screen — a 5 or 6 has to be involved;
  // skirmishes between small numbers stay calm
  const big = Math.max(av, dv);
  if (big >= 5) g.shake = Math.max(g.shake, big >= 6 ? 1.6 : 0.95);
  if (def.shield) {
    def.shield = false;
    addFx(g, 'shield', def.col, def.row, def.owner, dv);
    addFx(g, 'boom', atk.col, atk.row, atk.owner, av);
    removePiece(g, atk);
    SFX.shieldBlock();
    return;
  }
  // floating "-N" damage number over the defender, oriented to its owner's seat
  addFx(g, 'dmg', def.col, def.row, def.owner, av);
  def.value -= av;
  if (def.value < 0 || (def.value === 0 && g.mode !== 'turn')) {
    // attacker outweighs the defender (equal counts as a win in real-time):
    // defender destroyed, attacker survives
    addFx(g, 'boom', def.col, def.row, def.owner, dv);
    addFx(g, 'shock', def.col, def.row, atk.owner, av);
    g.flash = Math.min(0.55, g.flash + 0.12 + dv * 0.05);
    removePiece(g, def);
    SFX.boom(dv);
  } else if (def.value === 0) {
    // turn-based head-on of equal pieces: both annihilate
    addFx(g, 'boom', def.col, def.row, def.owner, big);
    addFx(g, 'shock', def.col, def.row, atk.owner, big);
    g.flash = Math.min(0.55, g.flash + 0.14 + big * 0.05);
    removePiece(g, def);
    removePiece(g, atk);
    SFX.boom(big);
  } else {
    // defender holds: a sharp clash spark at the defender, attacker bursts
    addFx(g, 'clash', def.col, def.row, def.owner, av);
    addFx(g, 'boom', atk.col, atk.row, atk.owner, av);
    g.flash = Math.min(0.4, g.flash + 0.06 + av * 0.03);
    removePiece(g, atk);
    SFX.hit(av, dv);
  }
}

function applyPower(g, p, u) {
  g.powerups = g.powerups.filter((x) => x !== u);
  if (u.type === 'charge') { p.value = Math.min(MAXV, p.value + 2); p.charged = true; }
  if (u.type === 'bolt') p.boostUntil = g.time + 8;
  if (u.type === 'shield') p.shield = true;
  if (u.type === 'heart') {
    const k = g.castles[p.owner];
    k.energy = Math.min(k.max, k.energy + 12);
  }
  addFx(g, 'power', p.col, p.row, p.owner);
  SFX.power();
}

function arrive(g, p) {
  const [c, r] = p.path.dest;
  p.path = null;
  p.prog = 0;
  p.col = c;
  p.row = r;
  const sp = g.pieces.find((q) => q !== p && !q.path && q.col === c && q.row === r);
  if (sp && sp.owner === p.owner) {
    sp.value = Math.min(MAXV, sp.value + p.value);
    sp.shield = sp.shield || p.shield;
    sp.charged = sp.charged || p.charged;
    removePiece(g, p);
    addFx(g, 'ring', c, r, sp.owner, sp.value);
    addFx(g, 'merge', c, r, sp.owner, sp.value);
    SFX.combine(sp.value);
    return;
  }
  if (sp) combat(g, p, sp);
  if (!g.pieces.includes(p)) return;
  const u = powerupAt(g, c, r);
  if (u) applyPower(g, p, u);
}

const POWER_TYPES = ['charge', 'bolt', 'shield', 'heart'];
function spawnPowerup(g) {
  if (g.powerups.length >= 3) return;
  const cells = [];
  for (let r = 4; r <= 8; r++) {
    for (let c = 0; c < COLS; c++) {
      if (g.walls.has(cellKey(c, r)) || stationaryAt(g, c, r) || castleAt(g, c, r) || powerupAt(g, c, r)) continue;
      cells.push([c, r]);
    }
  }
  if (!cells.length) return;
  const [c, r] = cells[(Math.random() * cells.length) | 0];
  g.powerups.push({ type: POWER_TYPES[(Math.random() * POWER_TYPES.length) | 0], col: c, row: r, born: g.time });
  SFX.spawn();
}

function endGame(g, winner) {
  if (g.over) return;
  g.over = true;
  g.overT = 0;
  g.winner = winner;
  g.sel = [null, null];
  SFX.fanfare();
}

// turn-based mid-flight combat: two opposing moving pieces that overlap (a swap
// or a path crossing) clash where they meet — the bigger rolls on, equal values
// annihilate. Checked per frame, so timing is respected: a piece that already
// passed the crossing is no longer near.
function clashMoving(g, a, b) {
  const av = a.value, bv = b.value, big = Math.max(av, bv);
  const pa = piecePos(a), pb = piecePos(b);
  if (big >= 5) g.shake = Math.max(g.shake, big >= 6 ? 1.6 : 0.95);
  g.flash = Math.min(0.55, g.flash + 0.12 + big * 0.05);
  addFx(g, 'shock', Math.round((pa[0] + pb[0]) / 2), Math.round((pa[1] + pb[1]) / 2), a.owner, big);
  if (av === bv) {
    addFx(g, 'boom', Math.round(pa[0]), Math.round(pa[1]), a.owner, av);
    addFx(g, 'boom', Math.round(pb[0]), Math.round(pb[1]), b.owner, bv);
    removePiece(g, a); removePiece(g, b);
  } else {
    const l = av > bv ? b : a, pl = piecePos(l);
    addFx(g, 'boom', Math.round(pl[0]), Math.round(pl[1]), l.owner, l.value);
    removePiece(g, l);
  }
  SFX.boom(big);
}

function resolveCrossings(g) {
  const movers = g.pieces.filter((p) => p.path);
  for (const a of movers) {
    if (!a.path || !g.pieces.includes(a)) continue;
    const pa = piecePos(a);
    for (const b of g.pieces) {
      if (b === a || b.owner === a.owner || !g.pieces.includes(b)) continue;
      const pb = piecePos(b);
      if (Math.abs(pa[0] - pb[0]) >= 0.6 || Math.abs(pa[1] - pb[1]) >= 0.6) continue;
      if (b.path) { clashMoving(g, a, b); break; }       // two movers cross / meet head-on
      // a moving piece overlapping a STATIONARY enemy that stopped in its lane
      // can't fly over it — it collides like an attack. (Its own destination is
      // left to arrival, so the normal land-on-enemy attack still runs there.)
      if (a.path.dest[0] !== b.col || a.path.dest[1] !== b.row) { combat(g, a, b); break; }
    }
  }
}

function updateGame(g, dt) {
  dt *= window.TWEAKS.speed;
  for (const f of g.fx) f.t += dt;
  g.fx = g.fx.filter((f) => f.t < 0.9);
  g.shake = Math.max(0, g.shake - dt * 4);
  g.flash = Math.max(0, g.flash - dt * 2.6);
  if (g.over) { g.overT += dt; return; }
  g.time += dt;

  for (const p of [...g.pieces]) {
    if (p.path) p.prog += speedOf(g, p) * dt;
  }
  // turn-based: opposing pieces that meet head-on / cross mid-flight collide
  // where they overlap (real-time leaves combat to arrival, so two moving pieces
  // would otherwise pass straight through each other)
  if (g.mode === 'turn') resolveCrossings(g);
  for (const p of [...g.pieces]) {
    if (p.path && p.prog >= p.path.cells) arrive(g, p);
  }

  // castle drain — ANY parked piece drains the castle (even the owner's, so
  // defending in person costs energy until the piece moves off), at 70% rate
  for (const k of g.castles) {
    let drain = 0, enemyDrain = false;
    for (const p of g.pieces) {
      if (!p.path && p.col === k.col && p.row === k.row) {
        drain += p.value;
        if (p.owner !== k.owner) enemyDrain = true; // an enemy is camping = under attack
      }
    }
    if (drain > 0) {
      k.energy -= drain * dt * 0.7;
      k.lastDrainT = g.time;
      if (g.time % 0.5 < dt) SFX.drain();
      if (enemyDrain) {
        k.attackT = g.time; // drives the arena warning flash in the renderer
        // urgent klaxon — faster + escalated once the castle is critically low
        const critical = k.energy < k.max * 0.3;
        if (g.time % (critical ? 0.7 : 1.0) < dt) SFX.underAttack(critical ? 1 : 0);
      } else if (k.energy < k.max * 0.3 && g.time % 1.2 < dt) {
        SFX.alarm();
      }
      if (k.energy <= 0) { k.energy = 0; endGame(g, 1 - k.owner); return; }
    }
  }

  // elimination
  for (const pl of [0, 1]) {
    if (!g.pieces.some((p) => p.owner === pl)) { endGame(g, 1 - pl); return; }
  }

  // power-up spawns
  g.powerTimer -= dt;
  if (g.powerTimer <= 0) {
    g.powerTimer = Math.max(4, window.TWEAKS.powerEvery);
    spawnPowerup(g);
  }

  // drop stale selections
  for (const pl of [0, 1]) {
    const p = g.sel[pl] && pieceById(g, g.sel[pl]);
    if (!p || p.path || p.owner !== pl) g.sel[pl] = null;
  }
}

// A tap on board cell (c,r). ownerFilter limits which player's pieces/claims
// respond (used in online play: each device controls one side only).
function tapCell(g, c, r, ownerFilter) {
  // Is this cell a legal destination for either player's current selection?
  const claims = [];
  for (const pl of [0, 1]) {
    if (ownerFilter != null && pl !== ownerFilter) continue;
    const p = g.sel[pl] && pieceById(g, g.sel[pl]);
    if (!p) continue;
    const lm = legalMoves(g, p);
    if (lm.some((m) => m.c === c && m.r === r)) claims.push({ pl, p });
  }
  if (claims.length) {
    claims.sort((a, b) => {
      const da = Math.max(Math.abs(a.p.col - c), Math.abs(a.p.row - r));
      const db = Math.max(Math.abs(b.p.col - c), Math.abs(b.p.row - r));
      return da - db;
    });
    const { pl, p } = claims[0];
    commandMove(g, p, c, r);
    g.sel[pl] = null;
    return;
  }
  const sp = stationaryAt(g, c, r);
  if (sp && ownerFilter != null && sp.owner !== ownerFilter) return;
  if (sp) {
    if (g.sel[sp.owner] === sp.id) {
      g.sel[sp.owner] = null;
      SFX.cursor();
    } else {
      g.sel[sp.owner] = sp.id;
      SFX.select();
    }
    return;
  }
  // empty tap: clear any selection whose legal set didn't include it? leave selections alone.
}

function trySplit(g, pl) {
  const p = g.sel[pl] && pieceById(g, g.sel[pl]);
  if (!p || p.path || p.value < 2) { SFX.deny(); return; }
  const half = Math.floor(p.value / 2);
  // splitting a fragment off a piece camped on an enemy castle still pays the
  // exit penalty — the fragment is what leaves, so it loses 1 (matches the
  // splitMove picker and a plain move off the castle; no free value ferrying).
  const onEnemyCastle = (() => { const k = castleAt(g, p.col, p.row); return k && k.owner !== pl; })();
  const fragVal = onEnemyCastle ? half - 1 : half;
  if (fragVal < 1) { SFX.deny(); return; }
  const reserved = reservedDests(g);
  const dirs = [...DIRS].sort(() => Math.random() - 0.5);
  for (const [dx, dy] of dirs) {
    const c = p.col + dx, r = p.row + dy;
    if (!inBounds(c, r) || g.walls.has(cellKey(c, r)) || castleAt(g, c, r)) continue;
    if (stationaryAt(g, c, r) || powerupAt(g, c, r) || reserved.has(cellKey(c, r))) continue;
    p.value -= half;
    g.pieces.push({
      id: g.nextId++, owner: pl, value: fragVal, col: c, row: r,
      path: null, prog: 0, from: null, shield: false, charged: false, boostUntil: -99,
    });
    addFx(g, 'ring', p.col, p.row, pl);
    SFX.split();
    return;
  }
  SFX.deny();
}

// Non-toggling select of an own stationary piece (the drag/tap-down handler
// wants "press always selects", not tapCell's toggle). Returns the owner or null.
function selectAt(g, c, r, ownerFilter) {
  const sp = stationaryAt(g, c, r);
  if (!sp || (ownerFilter != null && sp.owner !== ownerFilter)) return null;
  if (g.sel[sp.owner] !== sp.id) SFX.select();
  g.sel[sp.owner] = sp.id;
  return sp.owner;
}

// Where a drag toward (tc,tr) actually lands. Pieces only travel along the 8
// straight/diagonal directions, so the drag vector is snapped to the nearest
// of them, then the landing is the furthest LEGAL cell along that direction up
// to the dragged distance — i.e. drag past your reach and you still go as far
// as allowed. Returns { sdx, sdy, landC, landR, overreach } or null.
//   landC/landR null  → can't move that way at all (whole tether is "no-go")
//   overreach true     → the finger is beyond the landing (draw that part red)
function dragLanding(g, p, tc, tr) {
  if (!p || p.path) return null;
  const dx = tc - p.col, dy = tr - p.row;
  if (dx === 0 && dy === 0) return null;
  let oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  oct = ((oct % 8) + 8) % 8;
  const sdx = [1, 1, 0, -1, -1, -1, 0, 1][oct];
  const sdy = [0, 1, 1, 1, 0, -1, -1, -1][oct];
  const intended = Math.max(Math.abs(dx), Math.abs(dy));
  // legal landing steps along this ray (reserved cells leave gaps, so collect
  // them rather than assuming a contiguous run)
  const steps = [];
  for (const m of legalMoves(g, p)) {
    const cc = m.c - p.col, rr = m.r - p.row;
    let step;
    if (sdx === 0) { if (cc !== 0) continue; step = rr * sdy; }
    else if (sdy === 0) { if (rr !== 0) continue; step = cc * sdx; }
    else { if (cc * sdy !== rr * sdx) continue; step = cc * sdx; }
    if (step > 0) steps.push(step);
  }
  if (!steps.length) return { sdx, sdy, landC: null, landR: null, overreach: true };
  steps.sort((a, b) => a - b);
  let landStep = steps[0];
  for (const s of steps) if (s <= intended) landStep = s;
  return {
    sdx, sdy,
    landC: p.col + sdx * landStep,
    landR: p.row + sdy * landStep,
    overreach: intended > landStep,
  };
}

// Drag-place: command one specific piece (by id) to (c,r). Uses the dragged
// piece directly instead of tapCell's closest-claim, so a drag never moves the
// wrong side's piece. Returns true if the move was legal and issued.
function commandPieceTo(g, pl, pieceId, c, r) {
  const p = pieceById(g, pieceId);
  if (!p || p.owner !== pl || p.path || g.over) return false;
  if (!legalMoves(g, p).some((m) => m.c === c && m.r === r)) return false;
  commandMove(g, p, c, r);
  if (g.sel[pl] === pieceId) g.sel[pl] = null;
  return true;
}

// Split a fragment of size k off piece `pieceId` and send it straight to
// (c,r). k === value moves the whole piece. Legality is judged for a value-k
// piece standing on the parent's cell (smaller fragments reach farther).
// `force` skips the legality check (turn resolution pre-validates against the
// pre-move board, so a reserved cell must not cancel an already-legal split).
function splitMove(g, pl, pieceId, k, c, r, force) {
  const p = pieceById(g, pieceId);
  if (!p || p.owner !== pl || p.path || g.over) return false;
  k = k | 0;
  if (k < 1 || k > p.value) return false;
  if (k === p.value) {
    if (!force && !legalMoves(g, p).some((m) => m.c === c && m.r === r)) return false;
    commandMove(g, p, c, r);
    return true;
  }
  const ghost = Object.assign({}, p, { value: k });
  if (!force && !legalMoves(g, ghost).some((m) => m.c === c && m.r === r)) return false;
  p.value -= k;
  const frag = {
    id: g.nextId++, owner: p.owner, value: k, col: p.col, row: p.row,
    path: null, prog: 0, from: null, shield: false, charged: false, boostUntil: -99,
  };
  g.pieces.push(frag);
  addFx(g, 'ring', p.col, p.row, p.owner);
  SFX.split();
  commandMove(g, frag, c, r); // castle exit penalty applies to the fragment
  return true;
}

Object.assign(window, {
  COLS, ROWS, MAXV, makeGame, updateGame, tapCell, trySplit, splitMove, selectAt, commandPieceTo, dragLanding, speedOf,
  legalMoves, pieceById, piecePos, inBounds, cellKey, stationaryAt, castleAt, anyMoving,
});
