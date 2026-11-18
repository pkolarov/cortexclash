// Headless turn-based simulator for campaign puzzles. Loads the REAL game scripts (engine.js, ai.js)
// and mirrors main.js's plan -> resolve loop (applyOrders / tickTurn / startPlan).
//
//   const S = require('./turn-sim.js');
//   const g = S.newPuzzle(spec);                 // spec = level object (see PUZZLE SPEC below)
//   const r = S.playTurn(g, [ {id:1, kind:'move', c:4, r:2}, {id:2, kind:'split', k:1, c:3, r:5} ]);
//   S.legalOrders(g, 0)   -> every legal single order for the human side (moves + splits), for search
//   S.clone(g)            -> deep copy (use it for backtracking search)
//   S.outcome(g)          -> 'win' | 'lose' | 'draw' | 'running'
//   S.solve(spec, opts)   -> a simple example iterative-deepening solver you may copy/modify
//
// PUZZLE SPEC (== a campaign level):
//   { walls:[[c,r]...], you:[[c,r,v,'s'?]...], foe:[[c,r,v,'s'?]...], powerups:[{type,c,r}],
//     youE, foeE   (castle energy, default 36; castles sit at (4,11)=you and (4,1)=foe),
//     noElim:[false,true] (true = that side is NOT lost when it has no pieces),
//     limit  (you must win within this many turns),
//     script:[ [ {from:[c,r], to:[c,r], k?} ... ] ... ]  foe orders per turn (index = turn-1); k = split a fragment of size k off
//   }
// Board 9 cols x 13 rows (c 0..8, r 0..12). You are owner 0 (bottom). Foe owner 1 (top).
// A piece of value v can move up to 7-v cells in any of the 8 directions, sliding until blocked by a wall/piece;
// it cannot pass over pieces (landing on an enemy = attack, on a friend = merge, max 6). Power-ups are collected
// only by LANDING on their cell.
'use strict';
const fs = require('fs'), vm = require('vm');
const R = require('path').join(__dirname, '..', '..', 'game') + '/';
const noop = () => {};
const ctx = { console, Math, Set, Map, Object, Array, JSON, localStorage: { getItem: () => null, setItem: noop } };
ctx.window = ctx; ctx.SFX = new Proxy({}, { get: () => noop }); ctx.PLAYER_NAMES = ['YOU', 'FOE'];
vm.createContext(ctx);
for (const f of ['boards.js', 'engine.js', 'ai.js']) vm.runInContext(fs.readFileSync(R + f, 'utf8'), ctx, { filename: f });
const E = ctx, AI = ctx.AI;
const MIN_RES = 1.6, MAX_RES = 5;

function newPuzzle(spec, dt) {
  const g = E.makeLevelGame(Object.assign({ noSpawn: true, noStall: true, noTimer: true }, spec));
  g.mode = 'turn'; g.phase = 'plan'; g.turnNo = 1; g.orders = {}; g.ready = [false, false]; g.resolveT = 0;
  g.limit = spec.limit || 0; g.spec = spec; g.dt = dt || 1 / 60;
  AI.startSingle(spec.script ? 'cpu-script' : 'cpu-still', { script: spec.script });
  return g;
}
// copy of main.js applyOrders: validate all orders against the pre-move board, then commit
function applyOrders(g) {
  const ids = Object.keys(g.orders).map(Number).sort((a, b) => a - b);
  const ready = [];
  for (const id of ids) {
    const o = g.orders[id], p = E.pieceById(g, id);
    if (!p || p.path) continue;
    if (o.kind === 'split') {
      const k = o.k | 0;
      if (k < 1 || k >= p.value) continue;
      const ghost = Object.assign({}, p, { value: k });
      if (E.legalMoves(g, ghost).some((m) => m.c === (o.c | 0) && m.r === (o.r | 0))) ready.push({ p, kind: 'split', k, c: o.c | 0, r: o.r | 0 });
    } else if (E.legalMoves(g, p).some((m) => m.c === (o.c | 0) && m.r === (o.r | 0))) ready.push({ p, kind: 'move', c: o.c | 0, r: o.r | 0 });
  }
  for (const v of ready) {
    if (v.kind === 'split') E.splitMove(g, v.p.owner, v.p.id, v.k, v.c, v.r, true);
    else E.commandMove(g, v.p, v.c, v.r);
  }
  g.orders = {};
}
// one full turn: your orders + the foe's scripted/idle orders fire together, then it resolves
function playTurn(g, orders) {
  if (g.over) return outcome(g);
  g.orders = {};
  for (const o of orders || []) g.orders[o.id] = Object.assign({ kind: 'move' }, o);
  for (const o of AI.planTurn(g, 1)) if (!g.orders[o.id]) g.orders[o.id] = o;
  g.resolveStart = g.time;
  applyOrders(g);
  g.sel = [null, null]; g.phase = 'resolve'; g.resolveT = 0;
  const dt = g.dt;
  for (let i = 0; i < 100000; i++) {
    E.updateGame(g, dt); g.resolveT += dt;
    if (g.over) break;
    if (g.resolveT >= MAX_RES) { for (let j = 0; j < 900 && E.anyMoving(g) && !g.over; j++) E.updateGame(g, 1 / 30); break; }
    if (g.resolveT >= MIN_RES && !E.anyMoving(g)) break;
  }
  if (!g.over) {
    if (g.limit && g.turnNo >= g.limit) { g.timeUp = true; E.endGame(g, 1); }
    else { g.phase = 'plan'; g.turnNo++; g.orders = {}; g.fx = []; }
  }
  return outcome(g);
}
const outcome = (g) => (!g.over ? 'running' : g.winner === 0 ? 'win' : g.winner === 1 ? 'lose' : 'draw');
function clone(g) {
  // plain-data deep copy (the engine keeps everything in plain objects + one Set)
  const c = JSON.parse(JSON.stringify(Object.assign({}, g, { walls: Array.from(g.walls), spec: undefined })));
  c.walls = new Set(c.walls); c.spec = g.spec; c.dt = g.dt;
  return c;
}
// every legal single order for `owner` (whole-piece moves + split-off fragments)
function legalOrders(g, owner) {
  const out = [];
  for (const p of g.pieces) {
    if (p.owner !== owner || p.path) continue;
    for (const m of E.legalMoves(g, p)) out.push({ id: p.id, kind: 'move', c: m.c, r: m.r, kind2: m.kind });
    for (let k = 1; k < p.value; k++) {
      const ghost = Object.assign({}, p, { value: k });
      for (const m of E.legalMoves(g, ghost)) out.push({ id: p.id, kind: 'split', k, c: m.c, r: m.r });
    }
  }
  return out;
}
const summary = (g) => g.pieces.map((p) => (p.owner ? 'F' : 'Y') + p.value + (p.shield ? 's' : '') + '@' + p.col + ',' + p.row).join(' ') +
  ' | castles ' + g.castles.map((k) => k.energy.toFixed(1)).join('/') + ' | T' + g.turnNo + (g.over ? ' OVER w=' + g.winner : '');

// Example: iterative-deepening search over "turn plans" (each plan = at most `width` orders, one per piece).
// Branching explodes fast, so prune: pass opts.orderFilter(g, order) to keep only sensible orders.
function solve(spec, opts) {
  opts = opts || {};
  const maxT = opts.maxTurns || spec.limit || 4;
  const g0 = newPuzzle(spec, opts.dt);
  let nodes = 0;
  function plans(g) {
    const per = {};
    for (const o of legalOrders(g, 0)) { if (opts.orderFilter && !opts.orderFilter(g, o)) continue; (per[o.id] = per[o.id] || []).push(o); }
    const ids = Object.keys(per);
    let acc = [[]];
    for (const id of ids) {
      const next = [];
      for (const a of acc) { next.push(a); for (const o of per[id]) next.push(a.concat([o])); }
      acc = next;
    }
    return acc;
  }
  function dfs(g, depth, path) {
    if (depth === 0) return null;
    for (const pl of plans(g)) {
      nodes++;
      if (nodes > (opts.maxNodes || 3e5)) return null;
      const h = clone(g); const res = playTurn(h, pl);
      if (res === 'win') return path.concat([pl]);
      if (res === 'running') { const sub = dfs(h, depth - 1, path.concat([pl])); if (sub) return sub; }
    }
    return null;
  }
  for (let d = 1; d <= maxT; d++) { const s = dfs(g0, d, []); if (s) return { turns: s.length, plan: s, nodes }; }
  return { turns: null, nodes };
}
// replay a plan (array of turns, each an array of orders) and report
function replay(spec, plan, dt) {
  const g = newPuzzle(spec, dt); const log = [];
  for (const t of plan) { const r = playTurn(g, t); log.push(summary(g)); if (r !== 'running') break; }
  return { outcome: outcome(g), turns: g.turnNo, log, g };
}
module.exports = { E, AI, newPuzzle, playTurn, clone, legalOrders, outcome, summary, solve, replay, applyOrders };
