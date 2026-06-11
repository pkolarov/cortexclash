// Cortex Clash — single-player AI: local heuristic bot + Claude (LLM) opponent.
// The AI always controls owner 1 (top side). The human is owner 0.
'use strict';
window.AI = (() => {
  const DIFFS = {
    easy: { label: 'EASY', interval: 3.2, noise: 40, splitChance: 0.0, skip: 0.3 },
    normal: { label: 'NORMAL', interval: 2.1, noise: 16, splitChance: 0.12, skip: 0.1 },
    hard: { label: 'HARD', interval: 1.3, noise: 5, splitChance: 0.3, skip: 0 },
  };
  const DIFF_ORDER = ['easy', 'normal', 'hard'];
  const MODELS = [
    { id: 'claude-opus-4-8', label: 'OPUS 4.8' },
    { id: 'claude-sonnet-4-6', label: 'SONNET 4.6' },
    { id: 'claude-haiku-4-5', label: 'HAIKU 4.5' },
  ];

  const S = {
    mode: null,                 // null | 'bot' | 'claude'
    diff: localStorage.getItem('cc-ai-diff') || 'normal',
    model: localStorage.getItem('cc-ai-model') || MODELS[0].id,
    status: '', taunt: '', tauntT: 0,
    busy: false, timer: 0, pending: null, errs: 0, gen: 0,
  };
  if (!DIFFS[S.diff]) S.diff = 'normal';
  if (!MODELS.some((m) => m.id === S.model)) S.model = MODELS[0].id;

  function start(mode) {
    S.mode = mode;
    S.status = '';
    S.taunt = '';
    S.tauntT = 0;
    S.busy = false;
    S.timer = mode === 'claude' ? 0.8 : 1.2;
    S.pending = null;
    S.errs = 0;
    S.gen++;
    PLAYER_NAMES[1] = mode === 'claude' ? 'CLAUDE' : 'CPU';
  }
  function stop() {
    S.mode = null;
    S.status = '';
    S.taunt = '';
    S.gen++;
    PLAYER_NAMES[1] = 'PLAYER 2';
  }
  function cycleDiff() {
    S.diff = DIFF_ORDER[(DIFF_ORDER.indexOf(S.diff) + 1) % DIFF_ORDER.length];
    localStorage.setItem('cc-ai-diff', S.diff);
  }
  function cycleModel() {
    const i = MODELS.findIndex((m) => m.id === S.model);
    S.model = MODELS[(i + 1) % MODELS.length].id;
    localStorage.setItem('cc-ai-model', S.model);
  }
  function diffLabel() { return DIFFS[S.diff].label; }
  function modelLabel() { return MODELS.find((m) => m.id === S.model).label; }

  function ensureKey() {
    let key = localStorage.getItem('cc-claude-key') || '';
    if (!key) {
      key = (window.prompt('Paste your Anthropic API key (sk-ant-...)\nIt is stored only on this device.') || '').trim();
      if (!key.startsWith('sk-ant')) return null;
      localStorage.setItem('cc-claude-key', key);
    }
    return key;
  }
  function clearKey() { localStorage.removeItem('cc-claude-key'); }

  // ---------- heuristic bot ----------
  const dist = (c1, r1, c2, r2) => Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2));

  // enemy pieces heading for (or sitting near) my castle; uses a mover's
  // destination, not its current cell, so incoming attacks are seen early
  function findThreats(g) {
    const mk = g.castles[1];
    const out = [];
    for (const q of g.pieces) {
      if (q.owner !== 0) continue;
      const c = q.path ? q.path.dest[0] : q.col;
      const r = q.path ? q.path.dest[1] : q.row;
      const d = dist(c, r, mk.col, mk.row);
      if (d <= 3) out.push({ q, c, r, d });
    }
    return out;
  }

  function scoreMove(g, p, m, threats) {
    const ek = g.castles[0], mk = g.castles[1]; // enemy / mine (AI is owner 1)
    const lowEnergy = mk.energy < mk.max * 0.55;
    if (m.kind === 'castle') return 200 + p.value * 10;
    if (m.kind === 'attack') {
      const t = stationaryAt(g, m.c, m.r);
      if (!t) return -999;
      let s;
      if (t.shield) s = p.value === 1 ? 25 : 8 - p.value * 4;
      else if (p.value >= t.value) s = 55 + t.value * 6;   // clean kill
      else s = p.value * 5 - 14;                           // chip damage, lose piece
      const dHome = dist(t.col, t.row, mk.col, mk.row);
      if (dHome <= 3) {
        s += (4 - dHome) * 30;                  // intercept urgency, closer = hotter
        if (!t.shield && t.value > p.value) s += 25; // chipping a big intruder is worth it
        if (lowEnergy) s += 35;
      }
      if (t.col === mk.col && t.row === mk.row) s += 120; // sieging my castle: kill it NOW
      return s;
    }
    if (m.kind === 'power') {
      const u = powerupAt(g, m.c, m.r);
      let s = 45;
      if (u && u.type === 'heart' && mk.energy < mk.max * 0.6) s += 30;
      if (u && u.type === 'charge' && p.value <= 4) s += 10;
      return s;
    }
    if (m.kind === 'combine') return 6;
    // plain move: advance toward the enemy castle, fast pieces lead the push
    let s = (dist(p.col, p.row, ek.col, ek.row) - dist(m.c, m.r, ek.col, ek.row)) * (7 - p.value) * 2.2;
    if (m.c === mk.col && m.r === mk.row) s -= 60; // never park on own castle
    // fall back toward incoming attackers; the hotter the threat, the harder the pull
    for (const t of threats) {
      const gain = dist(p.col, p.row, t.c, t.r) - dist(m.c, m.r, t.c, t.r);
      s += gain * (10 + (3 - t.d) * 4 + (lowEnergy ? 6 : 0));
      // garrison: stand next to the castle so the intruder can be hit on arrival
      if (gain > 0 && dist(m.c, m.r, mk.col, mk.row) === 1) s += 18;
    }
    return s;
  }

  function botAct(g) {
    const d = DIFFS[S.diff];
    if (Math.random() < d.skip) return; // hesitation, keeps lower levels human
    const threats = findThreats(g);
    const mine = g.pieces.filter((p) => p.owner === 1 && !p.path);
    if (!mine.length) return;
    // occasional split to swarm when low on pieces
    if (Math.random() < d.splitChance && g.pieces.filter((p) => p.owner === 1).length <= 3) {
      const big = mine.find((p) => p.value >= 4);
      if (big) {
        const prev = g.sel[1];
        g.sel[1] = big.id;
        trySplit(g, 1);
        g.sel[1] = prev === big.id ? null : prev;
        return;
      }
    }
    let best = null, bestScore = -Infinity;
    const mk = g.castles[1];
    for (const p of mine) {
      // standing on my own castle drains it — leaving is always urgent
      const leaveBonus = (p.col === mk.col && p.row === mk.row) ? 130 : 0;
      for (const m of legalMoves(g, p)) {
        const s = scoreMove(g, p, m, threats) + leaveBonus + Math.random() * d.noise;
        if (s > bestScore) { bestScore = s; best = { p, m }; }
      }
    }
    if (best && bestScore > 0) commandMove(g, best.p, best.m.c, best.m.r);
  }

  // ---------- Claude opponent ----------
  const SYS = [
    'You are PLAYER 1 (top side, magenta) in Cortex Clash, a real-time strategy duel on a 9x13 grid.',
    'Coordinates are (c,r): column c 0-8 left to right, row r 0-12 top to bottom.',
    'Your castle is at (4,1); the enemy castle is at (4,11).',
    'Win by draining the enemy castle to 0 energy: park pieces ON the enemy castle cell. Each parked piece drains energy equal to its value per second. Parking drains YOUR castle too, so never park on your own castle. You lose if your castle is drained or you run out of pieces.',
    'Pieces have a value 1-6. Value = attack damage and merge weight. Move range = 7 - value cells in a straight or diagonal line (blocked by walls and pieces). Low values are fast and long-ranged; high values are slow but hit hard.',
    'Landing on an enemy deals your value as damage; if the defender survives, your piece dies. Landing on your own piece merges values (max 6). Powerups: charge (+2 value), bolt (speed boost 8s), shield (blocks one hit), heart (+12 castle energy).',
    'Leaving an enemy castle cell costs 1 value (a piece at value 1 dies instead of leaving) - camping the enemy castle is a commitment. If one of your pieces ends up standing on YOUR OWN castle, move it off immediately; it has no exit penalty but it drains your castle every second it stays.',
    'Each turn you get the board state plus the exact legal destinations for each of your idle pieces. Choose up to 3 moves, strictly from the listed legal destinations. Optionally split one piece (value >= 2 splits half into an adjacent cell; use 0 for no split). Include a short retro-arcade taunt (max 40 chars).',
    'Strategy: rush and camp the enemy castle, intercept attackers near your castle, grab powerups, take favorable trades. Be aggressive - passivity loses. The game keeps running while you think, so commit to strong moves.',
  ].join('\n');

  const SCHEMA = {
    type: 'object',
    properties: {
      moves: {
        type: 'array',
        items: {
          type: 'object',
          properties: { piece: { type: 'integer' }, c: { type: 'integer' }, r: { type: 'integer' } },
          required: ['piece', 'c', 'r'],
          additionalProperties: false,
        },
      },
      split: { type: 'integer' },
      taunt: { type: 'string' },
    },
    required: ['moves', 'split', 'taunt'],
    additionalProperties: false,
  };

  function describe(g) {
    const L = [];
    L.push('TIME ' + g.time.toFixed(0) + 's | YOUR castle (4,1): ' + g.castles[1].energy.toFixed(0) + '/' + g.castles[1].max +
      ' | ENEMY castle (4,11): ' + g.castles[0].energy.toFixed(0) + '/' + g.castles[0].max);
    const walls = [...g.walls].map((k) => '(' + k + ')').join(' ');
    if (walls) L.push('WALLS: ' + walls);
    if (g.powerups.length) {
      L.push('POWERUPS: ' + g.powerups.map((u) => u.type + ' at (' + u.col + ',' + u.row + ')').join(', '));
    }
    const desc = (p) => 'id' + p.id + ' v' + p.value + (p.shield ? ' [shield]' : '') +
      (p.path ? ' moving to (' + p.path.dest[0] + ',' + p.path.dest[1] + ')' : ' at (' + p.col + ',' + p.row + ')');
    L.push('ENEMY pieces: ' + (g.pieces.filter((p) => p.owner === 0).map(desc).join('; ') || 'none'));
    L.push('YOUR pieces:');
    let any = false;
    for (const p of g.pieces.filter((q) => q.owner === 1)) {
      if (p.path) { L.push(' ' + desc(p)); continue; }
      const lm = legalMoves(g, p);
      if (!lm.length) { L.push(' ' + desc(p) + ' - no legal moves'); continue; }
      any = true;
      L.push(' ' + desc(p) + ' - legal: ' + lm.map((m) => m.kind + '(' + m.c + ',' + m.r + ')').join(' '));
    }
    return { text: L.join('\n'), hasMoves: any };
  }

  function applyPending(g) {
    const a = S.pending;
    S.pending = null;
    if (!a || g.over) return;
    if (a.taunt) { S.taunt = String(a.taunt).slice(0, 48).toUpperCase(); S.tauntT = 6; }
    let applied = 0;
    for (const mv of (a.moves || []).slice(0, 3)) {
      const p = pieceById(g, mv.piece | 0);
      if (!p || p.owner !== 1 || p.path) continue;
      if (!legalMoves(g, p).some((m) => m.c === mv.c && m.r === mv.r)) continue;
      commandMove(g, p, mv.c | 0, mv.r | 0);
      applied++;
    }
    if (a.split) {
      const p = pieceById(g, a.split | 0);
      if (p && p.owner === 1 && !p.path && p.value >= 2) {
        const prev = g.sel[1];
        g.sel[1] = p.id;
        trySplit(g, 1);
        g.sel[1] = prev === p.id ? null : prev;
      }
    }
    if (applied) S.errs = 0;
  }

  async function callClaude(g) {
    const key = localStorage.getItem('cc-claude-key');
    if (!key) { fallback('NO API KEY - BOT TOOK OVER'); return; }
    const d = describe(g);
    if (!d.hasMoves) { S.timer = 0.6; return; }
    S.busy = true;
    S.status = 'CLAUDE IS THINKING…';
    const gen = S.gen;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: S.model,
          max_tokens: 1024,
          system: SYS,
          output_config: { format: { type: 'json_schema', schema: SCHEMA } },
          messages: [{ role: 'user', content: d.text }],
        }),
      });
      if (gen !== S.gen) return; // game was reset while in flight
      if (res.status === 401) { clearKey(); fallback('BAD API KEY - BOT TOOK OVER'); return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const msg = await res.json();
      if (gen !== S.gen) return;
      const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      S.pending = JSON.parse(text);
      S.status = '';
      S.timer = 1.0;
    } catch (e) {
      if (gen !== S.gen) return;
      S.errs++;
      S.status = 'CLAUDE ERROR (' + S.errs + '/3)';
      S.timer = 2.5;
      if (S.errs >= 3) fallback('CLAUDE OFFLINE - BOT TOOK OVER');
    } finally {
      if (gen === S.gen) S.busy = false;
    }
  }

  function fallback(msg) {
    S.mode = 'bot';
    S.status = msg;
    S.busy = false;
    S.timer = 1.0;
    PLAYER_NAMES[1] = 'CPU';
  }

  function claudeTick(g, dt) {
    if (S.pending) { applyPending(g); return; }
    if (S.busy) return;
    S.timer -= dt;
    if (S.timer > 0) return;
    callClaude(g);
  }

  // ---------- shared ----------
  function tick(g, dt) {
    if (!S.mode || !g || g.over) return;
    if (S.tauntT > 0) S.tauntT -= dt;
    if (S.mode === 'bot') {
      S.timer -= dt;
      if (S.timer <= 0) { S.timer = DIFFS[S.diff].interval; botAct(g); }
    } else {
      claudeTick(g, dt);
    }
  }

  // status + taunt overlay, drawn after the board each frame
  function drawHud(ctx) {
    if (!S.mode) return;
    if (S.taunt && S.tauntT > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, S.tauntT);
      glowText(ctx, '«' + S.taunt + '»', W / 2, 206, 18, '#ff3df0', 8);
      ctx.restore();
    }
    if (S.status) {
      glowText(ctx, S.status, W / 2, H - 178, 15, '#ffd23f', 5);
    }
  }

  return { S, start, stop, tick, drawHud, cycleDiff, cycleModel, diffLabel, modelLabel, ensureKey };
})();
