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

// A hand-built position for the campaign: `L` = { walls:[[c,r]], you:[[c,r,v,flags?]], foe:[...],
// powerups:[{type,c,r}], youE, foeE (castle energy), noSpawn, noStall, noElim:[bool,bool] }.
// flags: 's' on a piece = starts shielded. Rules live in g.rules (all optional).
function makeLevelGame(L) {
  const maxE = Math.round(window.TWEAKS.castleEnergy);
  const walls = new Set((L.walls || []).map(([c, r]) => cellKey(c, r)));
  // `max` stays the normal size, so a hand-set low energy shows as a low bar (and a heart can top it up)
  const castles = [
    { owner: 0, col: 4, row: 11, energy: L.youE || maxE, max: maxE, lastDrainT: -9, attackT: -9 },
    { owner: 1, col: 4, row: 1, energy: L.foeE || maxE, max: maxE, lastDrainT: -9, attackT: -9 },
  ];
  const pieces = [];
  let pid = 1;
  for (const [owner, list] of [[0, L.you || []], [1, L.foe || []]]) {
    for (const [c, r, v, fl] of list) {
      pieces.push({
        id: pid++, owner, value: v, col: c, row: r,
        path: null, prog: 0, from: null, shield: fl === 's', charged: false, boostUntil: -99,
        shieldUntil: fl === 's' ? 12 : 0,
      });
    }
  }
  const g = {
    boardIdx: 0, walls, castles, pieces,
    powerups: (L.powerups || []).map((u) => ({ type: u.type, col: u.c, row: u.r, born: 0 })),
    sel: [null, null], time: 0, powerTimer: 6, fx: [],
    winner: -1, over: false, overT: 0, shake: 0, flash: 0, nextId: pid,
    rules: { noSpawn: !!L.noSpawn, noStall: !!L.noStall, noTimer: !!L.noTimer, noElim: L.noElim || [false, false] },
  };
  return g;
}

// Campaign boss handicaps on top of a normal match (all optional):
//   youE / foeE   castle energy to start with (capped at the castle's max)
//   foeExtra      [[c,r,v]] extra enemy pieces (skipped if the cell is a wall / castle / occupied)
//   youDrop       remove your n weakest pieces
//   noSpawn       no power-ups appear;  spawnEvery  seconds between power-up spawns (real-time)
function applyBattleMods(g, m) {
  if (!m) return g;
  if (m.youE) g.castles[0].energy = Math.min(m.youE, g.castles[0].max);
  if (m.foeE) g.castles[1].energy = Math.min(m.foeE, g.castles[1].max);
  for (const [c, r, v] of m.foeExtra || []) {
    if (!inBounds(c, r) || g.walls.has(cellKey(c, r)) || castleAt(g, c, r) || stationaryAt(g, c, r)) continue;
    g.pieces.push({ id: g.nextId++, owner: 1, value: v, col: c, row: r, path: null, prog: 0, from: null, shield: false, charged: false, boostUntil: -99 });
  }
  for (let i = 0; i < (m.youDrop || 0); i++) {
    const mine = g.pieces.filter((p) => p.owner === 0).sort((a, b) => a.value - b.value);
    if (mine.length > 1) g.pieces = g.pieces.filter((p) => p !== mine[0]);
  }
  g.rules = Object.assign({}, g.rules, { noSpawn: !!m.noSpawn });
  if (m.spawnEvery) g.spawnEvery = m.spawnEvery;
  return g;
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
        // a piece on a castle can be attacked (even on YOUR castle, so defenders
        // can fight off a sieging piece) or, if it's yours, reinforced by merging
        // onto it — so you can pile value onto a piece already sieging/garrisoning
        const occ = stationaryAt(g, c, r);
        if (occ) {
          if (occ.owner !== p.owner) out.push({ c, r, kind: 'attack' });
          else if (occ.value + p.value <= MAXV) out.push({ c, r, kind: 'combine' });
        } else {
          out.push({ c, r, kind: k.owner !== p.owner ? 'castle' : 'move' });
        }
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

// A shield fades after this many seconds of game time (turn-based only ticks
// game time while resolving, so there it lasts about 7 turns).
const SHIELD_TIME = 12;

function applyPower(g, p, u) {
  g.powerups = g.powerups.filter((x) => x !== u);
  if (u.type === 'charge') { p.value = Math.min(MAXV, p.value + 2); p.charged = true; }
  if (u.type === 'bolt') p.boostUntil = g.time + 8;
  if (u.type === 'shield') { p.shield = true; p.shieldUntil = g.time + SHIELD_TIME; }
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
  p.landT = g.time; // turn-based: marks a piece that landed during this resolve (not a defender)
  // an attacker that touches down on the enemy castle spends its shield
  const hitK = castleAt(g, c, r);
  if (p.shield && hitK && hitK.owner !== p.owner) {
    p.shield = false; p.shieldUntil = 0;
    addFx(g, 'shield', c, r, p.owner, p.value);
  }
  const sp = g.pieces.find((q) => q !== p && !q.path && q.col === c && q.row === r);
  if (sp && sp.owner === p.owner) {
    // merge up to the 6 cap; any excess isn't destroyed — it stays as the
    // arriving piece, bumped to a free neighbouring cell (two friendly orders
    // converging on one cell, or a target that grew while this piece flew)
    const excess = sp.value + p.value - MAXV;
    sp.value = Math.min(MAXV, sp.value + p.value);
    if (p.shield) { sp.shieldUntil = Math.max(sp.shield ? sp.shieldUntil || 0 : 0, p.shieldUntil || 0); sp.shield = true; }
    sp.charged = sp.charged || p.charged;
    addFx(g, 'ring', c, r, sp.owner, sp.value);
    addFx(g, 'merge', c, r, sp.owner, sp.value);
    SFX.combine(sp.value);
    const spot = excess > 0 && freeNeighbour(g, c, r, p.from);
    if (spot) {
      p.value = excess; p.shield = false; p.shieldUntil = 0; p.charged = false;
      p.col = spot[0]; p.row = spot[1];
    } else removePiece(g, p);
    return;
  }
  if (sp) combat(g, p, sp);
  if (!g.pieces.includes(p)) return;
  const u = powerupAt(g, c, r);
  if (u) applyPower(g, p, u);
}

// nearest free cell around (c,r) for a bumped piece, preferring the side it
// came from and the closest ring (1..3 cells out, so a target boxed in by
// walls/pieces doesn't swallow the excess): in bounds, no wall / castle /
// power-up / parked piece / claimed landing. null only if nothing is free.
function freeNeighbour(g, c, r, from) {
  const reserved = reservedDests(g);
  const fx = from ? Math.sign(from[0] - c) : 0, fy = from ? Math.sign(from[1] - r) : 0;
  const cand = [];
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      if (!dx && !dy) continue;
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      const side = Math.abs(Math.sign(dx) - fx) + Math.abs(Math.sign(dy) - fy);
      cand.push([ring * 10 + side, dx, dy]);
    }
  }
  cand.sort((a, b) => a[0] - b[0]);
  for (const [, dx, dy] of cand) {
    const cc = c + dx, rr = r + dy;
    if (!inBounds(cc, rr) || g.walls.has(cellKey(cc, rr)) || castleAt(g, cc, rr) || powerupAt(g, cc, rr)) continue;
    if (stationaryAt(g, cc, rr) || reserved.has(cellKey(cc, rr))) continue;
    return [cc, rr];
  }
  return null;
}

const POWER_TYPES = ['charge', 'bolt', 'shield', 'heart'];
function spawnPowerup(g) {
  if (g.rules && g.rules.noSpawn) return;
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

// Resolve a pile-up of pieces that meet at one spot mid-flight as a single
// group, deterministically (no dependence on who arrived a frame sooner): each
// side's values combine, the totals cancel, and the heavier side keeps the
// difference — its strongest piece carries up to 6 and any remainder stays on
// its next-strongest pieces (so 6+6 vs 2 leaves a 6 and a 4, not just a 6).
// Equal totals wipe the whole pile. A shield blocks the hit exactly like it
// does on arrival: the shielded side's shields pop and it takes no damage,
// while an unshielded side that ran into it bursts. (A piece landing exactly
// on a stationary enemy at its destination is a deliberate attack and is left
// to arrival.)
function resolveCluster(g, cluster) {
  const side = [cluster.filter((p) => p.owner === 0), cluster.filter((p) => p.owner === 1)];
  const at = piecePos(cluster[0]);
  const ac = Math.round(at[0]), ar = Math.round(at[1]);
  const shielded = side.map((s) => s.some((p) => p.shield));
  if (shielded[0] || shielded[1]) {
    for (const pl of [0, 1]) {
      if (!shielded[pl]) continue;
      for (const p of side[pl]) if (p.shield) { p.shield = false; addFx(g, 'shield', ac, ar, pl, p.value); }
    }
    // both sides shielded: both shields pop, nobody is hurt; if they're still
    // overlapping next frame they collide again, unshielded
    for (const pl of [0, 1]) {
      if (shielded[pl] || !shielded[1 - pl]) continue;
      for (const p of side[pl]) { addFx(g, 'boom', ac, ar, pl, p.value); removePiece(g, p); }
    }
    SFX.shieldBlock();
    return;
  }
  const s0 = side[0].reduce((a, p) => a + p.value, 0), s1 = side[1].reduce((a, p) => a + p.value, 0);
  const big = Math.min(MAXV, Math.max(s0, s1));
  if (big >= 5) g.shake = Math.max(g.shake, big >= 6 ? 1.6 : 0.95);
  g.flash = Math.min(0.55, g.flash + 0.12 + big * 0.05);
  addFx(g, 'shock', ac, ar, cluster[0].owner, big);
  const keep = new Set();
  if (s0 !== s1) {
    const win = s0 > s1 ? 0 : 1;
    let rem = Math.abs(s0 - s1);       // combined force minus the opposing total
    for (const p of [...side[win]].sort((x, y) => y.value - x.value)) {
      if (rem <= 0) break;
      p.value = Math.min(MAXV, rem);
      rem -= p.value;
      keep.add(p);
    }
  }
  for (const p of cluster) {
    if (keep.has(p)) continue;
    const pp = piecePos(p);
    addFx(g, 'boom', Math.round(pp[0]), Math.round(pp[1]), p.owner, p.value);
    removePiece(g, p);
  }
  SFX.boom(big);
}

// Is cell (c,r) on the straight lane mover a is flying along (past its start)?
// A parked piece only counts as "in the way" if it is — a diagonal flier passing
// beside a piece never touches it, however close the two positions get.
function onLane(a, c, r) {
  const [fx, fy] = a.from, [tx, ty] = a.path.dest;
  const sx = Math.sign(tx - fx), sy = Math.sign(ty - fy);
  for (let k = 1; k <= a.path.cells; k++) if (fx + sx * k === c && fy + sy * k === r) return true;
  return false;
}

function resolveCrossings(g) {
  const movers = g.pieces.filter((p) => p.path);
  for (const a of movers) {
    if (!a.path || !g.pieces.includes(a)) continue;
    const pa = piecePos(a);
    const cluster = [];
    let hasEnemy = false;
    for (const b of g.pieces) {
      const pb = piecePos(b);
      if (Math.abs(pa[0] - pb[0]) >= 0.6 || Math.abs(pa[1] - pb[1]) >= 0.6) continue;
      if (b !== a && !b.path && !onLane(a, b.col, b.row)) continue; // bystander beside the lane
      // a stationary enemy sitting on a's destination is a deliberate attack —
      // leave it to arrival (so it uses the normal land-on-enemy combat). But a
      // piece that only just landed there this resolve raced a to the cell: that's
      // a simultaneous pile-up, not a defence, so it resolves as a group too —
      // otherwise whoever happened to arrive first would be the "defender" and
      // eat the damage (5 + 3 racing to one cell left a 5 or a 2 by timing)
      const landedNow = b.landT != null && g.resolveStart != null && b.landT > g.resolveStart;
      if (b !== a && !b.path && !landedNow && a.path.dest[0] === b.col && a.path.dest[1] === b.row) continue;
      cluster.push(b);
      if (b.owner !== a.owner) hasEnemy = true;
    }
    if (hasEnemy && cluster.length >= 2) resolveCluster(g, cluster);
  }
}

// Stall rule. Game time (turn-based only advances it while resolving, ~1.6s a
// turn, so 16s is about 10 turns of nothing happening).
const STALL_RTS = 90, STALL_TURN = 16, SD_RATE_RTS = 0.5, SD_RATE_TURN = 2;
// Progress = army value per side or castle energy changing. Piece COUNT is left
// out on purpose: a split followed by a merge changes it but nothing else, and
// would otherwise let one player stall sudden death forever.
function progressSig(g) {
  let v0 = 0, v1 = 0;
  for (const p of g.pieces) { if (p.owner === 0) v0 += p.value; else v1 += p.value; }
  return v0 + ':' + v1 + ':' + g.castles.map((k) => Math.ceil(k.energy)).join(':');
}
function stallWatch(g, dt) {
  if (g.suddenDeath || (g.rules && g.rules.noStall)) return;
  const sig = progressSig(g);
  if (sig !== g.stallSig) { g.stallSig = sig; g.stallT = 0; return; }
  g.stallT = (g.stallT || 0) + dt;
  if (g.stallT >= (g.mode === 'turn' ? STALL_TURN : STALL_RTS)) {
    g.suddenDeath = true;
    g.flash = Math.min(0.55, g.flash + 0.3);
    SFX.alarm();
  }
}

// Both sides lost on the same frame: the healthier castle wins, then the
// bigger surviving army; only a dead-even split is a draw (-1).
function tieBreak(g) {
  // real (unrounded, not yet clamped) energy: 0.9 beats 0.3 even though both
  // display as 1. Within 0.001 counts as level and falls through to army value.
  const e0 = g.castles[0].energy, e1 = g.castles[1].energy;
  if (Math.abs(e0 - e1) > 0.001) return e0 > e1 ? 0 : 1;
  let a0 = 0, a1 = 0;
  for (const p of g.pieces) { if (p.owner === 0) a0 += p.value; else a1 += p.value; }
  return a0 === a1 ? -1 : a0 > a1 ? 0 : 1;
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
    if (p.shield && p.shieldUntil != null && g.time >= p.shieldUntil) {
      p.shield = false; p.shieldUntil = 0; // timed out
      const [sc, sr] = piecePos(p);
      addFx(g, 'shield', Math.round(sc), Math.round(sr), p.owner, p.value);
    }
  }
  // opposing pieces that meet head-on / cross mid-flight — or a flier reaching
  // a piece that stepped into its lane after it launched — collide where they
  // overlap, in both modes (otherwise they'd pass straight through each other)
  resolveCrossings(g);
  for (const p of [...g.pieces]) {
    if (p.path && p.prog >= p.path.cells) arrive(g, p);
  }

  // castle drain — ANY parked piece drains the castle (even the owner's, so
  // defending in person costs energy until the piece moves off), at 70% rate
  const lost = [false, false];
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
      if (k.energy <= 0) lost[k.owner] = true; // clamped after the winner is picked
    }
  }

  // sudden death: once nothing has changed for a while (no kill, merge, drain
  // or pickup — e.g. two 6s stuck either side of a wall) both castles start to
  // bleed, so a deadlocked match still ends: the healthier castle wins
  stallWatch(g, dt);
  if (g.suddenDeath) {
    const rate = g.mode === 'turn' ? SD_RATE_TURN : SD_RATE_RTS;
    for (const k of g.castles) {
      k.energy -= rate * dt;
      k.lastDrainT = g.time;
      if (k.energy <= 0) lost[k.owner] = true;
    }
  }

  // castle drained or army eliminated. Judge both sides together: when both
  // fall on the same frame (e.g. the last pieces trade out in turn-based),
  // checking one side first would hand the top player every tie
  // (a campaign lesson can switch elimination off for a side that starts with no army)
  for (const pl of [0, 1]) {
    if (g.rules && g.rules.noElim && g.rules.noElim[pl]) continue;
    if (!g.pieces.some((p) => p.owner === pl)) lost[pl] = true;
  }
  if (lost[0] || lost[1]) {
    const w = lost[0] && lost[1] ? tieBreak(g) : lost[0] ? 1 : 0;
    for (const k of g.castles) k.energy = Math.max(0, k.energy);
    endGame(g, w);
    return;
  }

  // power-up spawns (real-time; turn-based spawns per turn — see spawnPowerup
  // in main.js — since this only runs during the short resolve phase)
  if (g.mode !== 'turn') {
    g.powerTimer -= dt;
    if (g.powerTimer <= 0) {
      g.powerTimer = Math.max(4, g.spawnEvery || window.TWEAKS.powerEvery);
      spawnPowerup(g);
    }
  }

  // drop stale selections
  for (const pl of [0, 1]) {
    const p = g.sel[pl] && pieceById(g, g.sel[pl]);
    if (!p || p.path || p.owner !== pl) g.sel[pl] = null;
  }
}

// A tap on board cell (c,r). ownerFilter limits which player's pieces/claims
// respond (used in online play: each device controls one side only). prefer
// names the player who most likely tapped (local 2P: whoever selected last) and
// wins when the cell is a legal destination for both players' selections.
function tapCell(g, c, r, ownerFilter, prefer) {
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
    const pick = prefer != null && claims.find((cl) => cl.pl === prefer);
    if (pick) claims.unshift(pick);
    else claims.sort((a, b) => {
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
// If every legal step along the ray is further than the finger (nearer cells are
// claimed), the piece still goes to the nearest legal one — a forgiving drag — and
// overreach stays false because the finger is short of, not beyond, the landing.
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
  // the fragment is what leaves a camped enemy castle and pays its 1-value exit
  // penalty, so a 1 would burn out on the spot (the split just destroyed value)
  const ck = castleAt(g, p.col, p.row);
  if (ck && ck.owner !== pl && k < 2) return false;
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
  COLS, ROWS, MAXV, makeGame, makeLevelGame, applyBattleMods, endGame, updateGame, spawnPowerup, tapCell, trySplit, splitMove, selectAt, commandPieceTo, dragLanding, speedOf,
  legalMoves, pieceById, piecePos, inBounds, cellKey, stationaryAt, castleAt, anyMoving,
});
