// Cortex Clash — AI controllers: local heuristic bot + LLM opponents
// (Claude / GPT / Gemini). A controller drives one side; in single player the
// AI owns side 1 (top), in watch mode controllers drive both sides.
'use strict';
window.AI = (() => {
  const DIFFS = {
    easy: { interval: 3.2, noise: 40, splitChance: 0.0, skip: 0.3 },
    normal: { interval: 2.1, noise: 16, splitChance: 0.12, skip: 0.1 },
    hard: { interval: 1.3, noise: 5, splitChance: 0.3, skip: 0 },
  };

  // every selectable opponent. `name` is the in-game HUD label (keep short).
  const ROSTER = [
    { id: 'cpu-easy', label: 'CPU · EASY', name: 'CPU EASY', kind: 'bot', diff: 'easy' },
    { id: 'cpu-normal', label: 'CPU · NORMAL', name: 'CPU', kind: 'bot', diff: 'normal' },
    { id: 'cpu-hard', label: 'CPU · HARD', name: 'CPU HARD', kind: 'bot', diff: 'hard' },
    { id: 'claude-opus', label: 'CLAUDE OPUS 4.8', name: 'OPUS', kind: 'llm', provider: 'anthropic', model: 'claude-opus-4-8' },
    { id: 'claude-sonnet', label: 'CLAUDE SONNET 4.6', name: 'SONNET', kind: 'llm', provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { id: 'claude-haiku', label: 'CLAUDE HAIKU 4.5', name: 'HAIKU', kind: 'llm', provider: 'anthropic', model: 'claude-haiku-4-5' },
    { id: 'gpt-55', label: 'GPT-5.5', name: 'GPT-5.5', kind: 'llm', provider: 'openai', model: 'gpt-5.5' },
    { id: 'gpt-54-mini', label: 'GPT-5.4 MINI', name: 'GPT MINI', kind: 'llm', provider: 'openai', model: 'gpt-5.4-mini' },
    { id: 'gemini-35-flash', label: 'GEMINI 3.5 FLASH', name: 'GEMINI', kind: 'llm', provider: 'gemini', model: 'gemini-3.5-flash' },
  ];
  const CLAUDE_IDS = ['claude-opus', 'claude-sonnet', 'claude-haiku'];
  const DIFF_IDS = ['cpu-easy', 'cpu-normal', 'cpu-hard'];

  const PROVIDERS = {
    anthropic: { keyName: 'cc-key-anthropic', keyHint: 'Anthropic API key (sk-ant-...)' },
    openai: { keyName: 'cc-key-openai', keyHint: 'OpenAI API key (sk-...)' },
    gemini: { keyName: 'cc-key-gemini', keyHint: 'Google Gemini API key (AIza...)' },
  };

  // ctls[owner] drives that side; null = human
  const S = { ctls: [null, null], watch: false, gen: 0 };

  function byId(id) { return ROSTER.find((r) => r.id === id) || null; }

  function makeCtl(spec, own) {
    return {
      spec, origSpec: spec, own,
      timer: spec.kind === 'llm' ? 0.8 : 1.2,
      busy: false, pending: null, errs: 0,
      status: '', taunt: '', tauntT: 0,
    };
  }

  function startSingle(rosterId) {
    const spec = byId(rosterId);
    if (!spec) return;
    S.gen++;
    S.watch = false;
    S.ctls = [null, makeCtl(spec, 1)];
    PLAYER_NAMES[0] = 'PLAYER 1';
    PLAYER_NAMES[1] = spec.name;
  }

  function startWatch(idBottom, idTop) {
    const a = byId(idBottom), b = byId(idTop);
    if (!a || !b) return;
    S.gen++;
    S.watch = true;
    S.ctls = [makeCtl(a, 0), makeCtl(b, 1)];
    PLAYER_NAMES[0] = a.name;
    PLAYER_NAMES[1] = b.name;
  }

  function restart() {
    S.gen++;
    // restore the originally chosen opponent — if an LLM fell back to the CPU
    // mid-match, a rematch should give it another shot
    S.ctls = S.ctls.map((c) => c && makeCtl(c.origSpec, c.own));
    for (const c of S.ctls) if (c) PLAYER_NAMES[c.own] = c.spec.name;
  }

  function stop() {
    S.gen++;
    S.ctls = [null, null];
    S.watch = false;
    PLAYER_NAMES[0] = 'PLAYER 1';
    PLAYER_NAMES[1] = 'PLAYER 2';
  }

  function active() { return !!(S.ctls[0] || S.ctls[1]); }

  // prompt for any missing provider keys; false if the user bails
  function ensureKeys(rosterIds) {
    for (const id of rosterIds) {
      const spec = byId(id);
      if (!spec || spec.kind !== 'llm') continue;
      const prov = PROVIDERS[spec.provider];
      if (localStorage.getItem(prov.keyName)) continue;
      const key = (window.prompt('Paste your ' + prov.keyHint + '\nIt is stored only on this device.') || '').trim();
      if (!key) return false;
      localStorage.setItem(prov.keyName, key);
    }
    return true;
  }

  // ---------- heuristic bot ----------
  const dist = (c1, r1, c2, r2) => Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2));

  function findThreats(g, own) {
    const mk = g.castles[own];
    const out = [];
    for (const q of g.pieces) {
      if (q.owner === own) continue;
      const c = q.path ? q.path.dest[0] : q.col;
      const r = q.path ? q.path.dest[1] : q.row;
      const d = dist(c, r, mk.col, mk.row);
      if (d <= 3) out.push({ q, c, r, d });
    }
    return out;
  }

  function scoreMove(g, own, p, m, threats) {
    const ek = g.castles[1 - own], mk = g.castles[own];
    const lowEnergy = mk.energy < mk.max * 0.55;
    // a piece sitting on the enemy castle pays 1 value to leave; a value-1
    // camper would die, so never order it off — let it keep draining
    if (ek.col === p.col && ek.row === p.row) {
      if (p.value <= 1) return -999;
      // mildly discourage abandoning a live siege when the castle isn't dead yet
      if (ek.energy > 0) return -40 + p.value;
    }
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

  function botAct(g, ctl) {
    const own = ctl.own;
    const d = DIFFS[ctl.spec.diff];
    if (Math.random() < d.skip) return; // hesitation, keeps lower levels human
    const threats = findThreats(g, own);
    const mine = g.pieces.filter((p) => p.owner === own && !p.path);
    if (!mine.length) return;
    if (Math.random() < d.splitChance && g.pieces.filter((p) => p.owner === own).length <= 3) {
      const big = mine.find((p) => p.value >= 4);
      if (big) {
        const prev = g.sel[own];
        g.sel[own] = big.id;
        trySplit(g, own);
        g.sel[own] = prev === big.id ? null : prev;
        return;
      }
    }
    let best = null, bestScore = -Infinity;
    const mk = g.castles[own];
    for (const p of mine) {
      // standing on my own castle drains it — leaving is always urgent
      const leaveBonus = (p.col === mk.col && p.row === mk.row) ? 130 : 0;
      for (const m of legalMoves(g, p)) {
        const s = scoreMove(g, own, p, m, threats) + leaveBonus + Math.random() * d.noise;
        if (s > bestScore) { bestScore = s; best = { p, m }; }
      }
    }
    if (best && bestScore > 0) commandMove(g, best.p, best.m.c, best.m.r);
  }

  // ---------- LLM opponents ----------
  function sysFor(own) {
    const side = own === 1 ? 'the TOP side (magenta)' : 'the BOTTOM side (cyan)';
    const myC = own === 1 ? '(4,1)' : '(4,11)';
    const enC = own === 1 ? '(4,11)' : '(4,1)';
    return [
      'You are playing ' + side + ' in Cortex Clash, a real-time strategy duel on a 9x13 grid.',
      'Coordinates are (c,r): column c 0-8 left to right, row r 0-12 top to bottom.',
      'Your castle is at ' + myC + '; the enemy castle is at ' + enC + '.',
      'Win by draining the enemy castle to 0 energy: park pieces ON the enemy castle cell. Each parked piece drains energy equal to its value per second. Parking drains YOUR castle too, so never park on your own castle. You lose if your castle is drained or you run out of pieces.',
      'Pieces have a value 1-6. Value = attack damage and merge weight. Move range = 7 - value cells in a straight or diagonal line (blocked by walls and pieces). Low values are fast and long-ranged; high values are slow but hit hard.',
      'Landing on an enemy deals your value as damage; if the defender survives, your piece dies. Landing on your own piece merges values (max 6). Powerups: charge (+2 value), bolt (speed boost 8s), shield (blocks one hit), heart (+12 castle energy).',
      'Leaving an enemy castle cell costs 1 value (a piece at value 1 dies instead of leaving) - camping the enemy castle is a commitment. If one of your pieces ends up standing on YOUR OWN castle, move it off immediately; it has no exit penalty but it drains your castle every second it stays.',
      'Each turn you get the board state plus the exact legal destinations for each of your idle pieces. Choose up to 3 moves, strictly from the listed legal destinations. Optionally split one piece (value >= 2 splits half into an adjacent cell; use 0 for no split). Include a short retro-arcade taunt (max 40 chars).',
      'Strategy: rush and camp the enemy castle, intercept attackers near your castle, grab powerups, take favorable trades. Be aggressive - passivity loses. The game keeps running while you think, so commit to strong moves.',
    ].join('\n');
  }

  function describe(g, own) {
    const mk = g.castles[own], ek = g.castles[1 - own];
    const L = [];
    L.push('TIME ' + g.time.toFixed(0) + 's | YOUR castle: ' + mk.energy.toFixed(0) + '/' + mk.max +
      ' | ENEMY castle: ' + ek.energy.toFixed(0) + '/' + ek.max);
    const walls = [...g.walls].map((k) => '(' + k + ')').join(' ');
    if (walls) L.push('WALLS: ' + walls);
    if (g.powerups.length) {
      L.push('POWERUPS: ' + g.powerups.map((u) => u.type + ' at (' + u.col + ',' + u.row + ')').join(', '));
    }
    const desc = (p) => 'id' + p.id + ' v' + p.value + (p.shield ? ' [shield]' : '') +
      (p.path ? ' moving to (' + p.path.dest[0] + ',' + p.path.dest[1] + ')' : ' at (' + p.col + ',' + p.row + ')');
    L.push('ENEMY pieces: ' + (g.pieces.filter((p) => p.owner !== own).map(desc).join('; ') || 'none'));
    L.push('YOUR pieces:');
    let any = false;
    for (const p of g.pieces.filter((q) => q.owner === own)) {
      if (p.path) { L.push(' ' + desc(p)); continue; }
      const lm = legalMoves(g, p);
      if (!lm.length) { L.push(' ' + desc(p) + ' - no legal moves'); continue; }
      any = true;
      L.push(' ' + desc(p) + ' - legal: ' + lm.map((m) => m.kind + '(' + m.c + ',' + m.r + ')').join(' '));
    }
    return { text: L.join('\n'), hasMoves: any };
  }

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

  // Gemini wants an OpenAPI-style schema, not raw JSON Schema
  const GEMINI_SCHEMA = {
    type: 'OBJECT',
    properties: {
      moves: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { piece: { type: 'INTEGER' }, c: { type: 'INTEGER' }, r: { type: 'INTEGER' } },
          required: ['piece', 'c', 'r'],
        },
      },
      split: { type: 'INTEGER' },
      taunt: { type: 'STRING' },
    },
    required: ['moves', 'split', 'taunt'],
  };

  function authErr(msg) { const e = new Error(msg); e.auth = true; return e; }

  // a 12s abort guard so a hung fetch can't leave the AI side inert forever
  async function postJSON(url, opts) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    try { return await fetch(url, Object.assign({ signal: ctrl.signal }, opts)); }
    finally { clearTimeout(to); }
  }

  // classify a non-ok response: bad key (auth, permanent) vs transient. Gemini
  // returns 400 (not 401) for an invalid key, so we sniff the body text too.
  async function classifyError(res) {
    let body = '';
    try { body = await res.text(); } catch (e) {}
    if (res.status === 401 || res.status === 403) return authErr('' + res.status);
    if (/api[\s_-]?key|invalid.?key|API_KEY_INVALID|unauthor|permission.?denied/i.test(body)) {
      return authErr('bad key (' + res.status + ')');
    }
    return new Error('HTTP ' + res.status);
  }

  // returns the parsed {moves, split, taunt} object, or throws.
  // a thrown error with .auth = true means a bad/expired key.
  async function llmRequest(spec, sys, user) {
    const key = localStorage.getItem(PROVIDERS[spec.provider].keyName);
    if (!key) throw authErr('no key');

    if (spec.provider === 'anthropic') {
      const res = await postJSON('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: spec.model,
          max_tokens: 1024,
          system: sys,
          output_config: { format: { type: 'json_schema', schema: SCHEMA } },
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) throw await classifyError(res);
      const msg = await res.json();
      const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return JSON.parse(text);
    }

    if (spec.provider === 'openai') {
      const res = await postJSON('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model: spec.model,
          max_completion_tokens: 2048,
          reasoning_effort: 'low',
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'cortex_moves', strict: true, schema: SCHEMA },
          },
        }),
      });
      if (!res.ok) throw await classifyError(res);
      const msg = await res.json();
      return JSON.parse(msg.choices[0].message.content);
    }

    if (spec.provider === 'gemini') {
      const res = await postJSON('https://generativelanguage.googleapis.com/v1beta/models/' +
        spec.model + ':generateContent?key=' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: GEMINI_SCHEMA,
            maxOutputTokens: 2048,
          },
        }),
      });
      if (!res.ok) throw await classifyError(res);
      const msg = await res.json();
      return JSON.parse(msg.candidates[0].content.parts[0].text);
    }
    throw new Error('unknown provider');
  }

  function applyPending(g, ctl) {
    const a = ctl.pending;
    ctl.pending = null;
    if (!a || g.over) return;
    if (a.taunt) { ctl.taunt = String(a.taunt).slice(0, 48).toUpperCase(); ctl.tauntT = 6; }
    for (const mv of (a.moves || []).slice(0, 3)) {
      const p = pieceById(g, mv.piece | 0);
      if (!p || p.owner !== ctl.own || p.path) continue;
      if (!legalMoves(g, p).some((m) => m.c === mv.c && m.r === mv.r)) continue;
      commandMove(g, p, mv.c | 0, mv.r | 0);
      ctl.errs = 0;
    }
    if (a.split) {
      const p = pieceById(g, a.split | 0);
      if (p && p.owner === ctl.own && !p.path && p.value >= 2) {
        const prev = g.sel[ctl.own];
        g.sel[ctl.own] = p.id;
        trySplit(g, ctl.own);
        g.sel[ctl.own] = prev === p.id ? null : prev;
      }
    }
  }

  function fallbackToBot(ctl, msg) {
    ctl.spec = byId('cpu-normal');
    ctl.status = msg;
    ctl.busy = false;
    ctl.pending = null;
    ctl.timer = 1.0;
    PLAYER_NAMES[ctl.own] = 'CPU';
  }

  async function llmCall(g, ctl) {
    const d = describe(g, ctl.own);
    if (!d.hasMoves) { ctl.timer = 0.6; return; }
    ctl.busy = true;
    ctl.status = ctl.spec.name + ' THINKING…';
    const gen = S.gen;
    try {
      const out = await llmRequest(ctl.spec, sysFor(ctl.own), d.text);
      if (gen !== S.gen) return;
      ctl.pending = out;
      ctl.status = '';
      ctl.timer = 1.0;
    } catch (e) {
      if (gen !== S.gen) return;
      if (e.auth) {
        localStorage.removeItem(PROVIDERS[ctl.spec.provider].keyName);
        fallbackToBot(ctl, 'BAD API KEY - CPU TOOK OVER');
        return;
      }
      ctl.errs++;
      ctl.status = ctl.spec.name + ' ERROR (' + ctl.errs + '/3)';
      ctl.timer = 2.5;
      if (ctl.errs >= 3) fallbackToBot(ctl, ctl.spec.name + ' OFFLINE - CPU TOOK OVER');
    } finally {
      if (gen === S.gen) ctl.busy = false;
    }
  }

  function tickCtl(g, ctl, dt) {
    if (ctl.tauntT > 0) ctl.tauntT -= dt;
    if (ctl.spec.kind === 'bot') {
      ctl.timer -= dt;
      if (ctl.timer <= 0) { ctl.timer = DIFFS[ctl.spec.diff].interval; botAct(g, ctl); }
      return;
    }
    if (ctl.pending) { applyPending(g, ctl); return; }
    if (ctl.busy) return;
    ctl.timer -= dt;
    if (ctl.timer > 0) return;
    llmCall(g, ctl);
  }

  function tick(g, dt) {
    if (!g || g.over) return;
    for (const ctl of S.ctls) if (ctl) tickCtl(g, ctl, dt);
  }

  // status + taunt overlay; top side speaks at the top, bottom side at the bottom
  function drawHud(ctx) {
    for (const ctl of S.ctls) {
      if (!ctl) continue;
      const y = ctl.own === 1 ? 206 : H - 206;
      const ty = ctl.own === 1 ? 206 : H - 206;
      const sy = ctl.own === 1 ? 240 : H - 240;
      if (ctl.taunt && ctl.tauntT > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, ctl.tauntT);
        glowText(ctx, '«' + ctl.taunt + '»', W / 2, ty, 18, PLAYER_COLORS[ctl.own], 8);
        ctx.restore();
      }
      if (ctl.status) glowText(ctx, ctl.status, W / 2, sy, 14, '#ffd23f', 5);
    }
  }

  return {
    S, ROSTER, CLAUDE_IDS, DIFF_IDS,
    startSingle, startWatch, restart, stop, active, ensureKeys,
    tick, drawHud, byId,
  };
})();
