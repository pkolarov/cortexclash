// Cortex Clash — canvas renderer (1080x1920 portrait)
'use strict';
const W = 1080, H = 1920;
const CELL = 118;
const BX = (W - COLS * CELL) / 2;   // 36
const BY = (H - ROWS * CELL) / 2;   // 232
const PLAYER_COLORS = ['#19e6ff', '#ff3df0'];
const PLAYER_DARK = ['#073039', '#380934'];
const PLAYER_NAMES = ['PLAYER 1', 'PLAYER 2'];
const FONT = '"Press Start 2P", monospace';
// running build number — read from this script's own ?v=NN so it always matches
// the deployed cache version (no separate constant to keep in sync)
const APP_VER = (() => {
  try {
    const s = document.currentScript && document.currentScript.src;
    const m = s && s.match(/[?&]v=(\d+)/);
    return m ? m[1] : '?';
  } catch (e) { return '?'; }
})();

function px(c) { return BX + c * CELL; }
function py(r) { return BY + r * CELL; }

// Player-1's numbers/text are mirrored ONLY in local face-to-face 2P (two
// humans sharing one screen). In single-player, AI-vs-AI watch, and online
// there's a single reader per screen, so everything stays upright (online
// readability is handled by the whole-board view flip instead).
function isLocal2P() { return !(window.NET && NET.active()) && !(window.AI && AI.active()); }
function textFlip(owner) {
  if (window.NET && NET.active()) return NET.S.view === 1;
  if (window.AI && AI.active()) return false;
  return owner === 1;
}
// which castle(s) the person watching this screen is defending — used to warn
// them when theirs is under attack
function myOwners() {
  if (window.NET && NET.active()) return [NET.myPlayer()];
  if (window.AI && AI.active() && !AI.S.watch) return [0];
  return [0, 1];
}

function rr(ctx, x, y, w, h, rad) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function glowText(ctx, text, x, y, size, color, blur, align) {
  ctx.save();
  ctx.font = size + 'px ' + FONT;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = (blur || 14) * window.TWEAKS.glow;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Register a button drawn in HUD-local coords. Top HUD is drawn under
// translate(W, HUD_H) + rotate(PI); bottom under translate(0, H - HUD_H).
function addBtn(x, y, w, h, action, rotated) {
  if (rotated) UI.buttons.push({ x: W - x - w, y: HUD_H - y - h, w, h, action });
  else UI.buttons.push({ x, y: H - HUD_H + y, w, h, action });
}

// ---------- pattern caches ----------
let scanCanvas = null;
function scanlines(ctx) {
  if (!window.TWEAKS.scanlines) return;
  if (!scanCanvas) {
    scanCanvas = document.createElement('canvas');
    scanCanvas.width = 8; scanCanvas.height = 4;
    const c = scanCanvas.getContext('2d');
    c.fillStyle = 'rgba(0,0,0,0.16)';
    c.fillRect(0, 0, 8, 1);
    c.fillStyle = 'rgba(255,255,255,0.02)';
    c.fillRect(0, 2, 8, 1);
  }
  ctx.save();
  ctx.fillStyle = ctx.createPattern(scanCanvas, 'repeat');
  ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---------- board ----------
function drawBoard(ctx, g) {
  ctx.save();
  rr(ctx, BX - 10, BY - 10, COLS * CELL + 20, ROWS * CELL + 20, 18);
  ctx.fillStyle = '#0b0c1a';
  ctx.fill();
  ctx.strokeStyle = 'rgba(110,140,255,0.35)';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#5a78ff';
  ctx.shadowBlur = 16 * window.TWEAKS.glow;
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(110,140,255,0.09)';
  ctx.lineWidth = 1;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath(); ctx.moveTo(px(c), BY); ctx.lineTo(px(c), BY + ROWS * CELL); ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(BX, py(r)); ctx.lineTo(BX + COLS * CELL, py(r)); ctx.stroke();
  }

  // center line
  ctx.strokeStyle = 'rgba(110,140,255,0.18)';
  ctx.setLineDash([10, 12]);
  ctx.beginPath(); ctx.moveTo(BX, py(6.5)); ctx.lineTo(BX + COLS * CELL, py(6.5)); ctx.stroke();
  ctx.setLineDash([]);

  // walls
  for (const wk of g.walls) {
    const [c, r] = wk.split(',').map(Number);
    const x = px(c) + 8, y = py(r) + 8, s = CELL - 16;
    ctx.fillStyle = '#262b4a';
    rr(ctx, x, y, s, s, 10); ctx.fill();
    ctx.fillStyle = '#3a4070';
    rr(ctx, x + 8, y + 8, s - 16, 14, 6); ctx.fill();
    ctx.fillStyle = '#14172e';
    rr(ctx, x + 8, y + s - 22, s - 16, 14, 6); ctx.fill();
  }
}

function drawLegal(ctx, g, t) {
  for (const pl of [0, 1]) {
    const p = g.sel[pl] && pieceById(g, g.sel[pl]);
    if (!p) continue;
    const col = PLAYER_COLORS[pl];
    const pulse = 0.16 + 0.08 * Math.sin(t * 6);
    for (const m of legalMoves(g, p)) {
      const x = px(m.c), y = py(m.r);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = col;
      rr(ctx, x + 6, y + 6, CELL - 12, CELL - 12, 12);
      ctx.fill();
      ctx.restore();
      if (m.kind === 'attack' || m.kind === 'castle') {
        ctx.save();
        ctx.strokeStyle = '#ff5566';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#ff5566';
        ctx.shadowBlur = 10 * window.TWEAKS.glow;
        const o = 14, l = 20;
        [[x + o, y + o, 1, 1], [x + CELL - o, y + o, -1, 1], [x + o, y + CELL - o, 1, -1], [x + CELL - o, y + CELL - o, -1, -1]]
          .forEach(([cx, cy, sx, sy]) => {
            ctx.beginPath();
            ctx.moveTo(cx + sx * l, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * l);
            ctx.stroke();
          });
        ctx.restore();
      } else if (m.kind === 'combine') {
        glowText(ctx, '+', x + CELL / 2, y + CELL / 2, 30, '#52ff9d', 10);
      }
    }
  }
}

// ---------- castles ----------
function drawCastle(ctx, g, k, t) {
  const x = px(k.col), y = py(k.row);
  const col = PLAYER_COLORS[k.owner];
  const draining = g.time - k.lastDrainT < 0.3;
  const cx = x + CELL / 2, cy = y + CELL / 2;
  ctx.save();
  if (draining) ctx.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);

  ctx.shadowColor = draining ? '#ff3344' : col;
  ctx.shadowBlur = (draining ? 26 : 18) * window.TWEAKS.glow;
  ctx.fillStyle = PLAYER_DARK[k.owner];
  rr(ctx, x + 10, y + 22, CELL - 20, CELL - 32, 8);
  ctx.fill();
  ctx.strokeStyle = draining ? '#ff3344' : col;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // battlements
  ctx.fillStyle = draining ? '#ff3344' : col;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(x + 16 + i * ((CELL - 32 - 14) / 2), y + 10, 14, 16);
  }
  ctx.restore();

  ctx.save();
  const flipNum = textFlip(k.owner);
  if (flipNum) { ctx.translate(cx, cy + 8); ctx.rotate(Math.PI); ctx.translate(-cx, -(cy + 8)); }
  glowText(ctx, String(Math.ceil(k.energy)), cx, cy + 8, 26, draining ? '#ff5566' : '#ffffff', 8);
  ctx.restore();

  if (draining) {
    for (let i = 0; i < 3; i++) {
      const a = t * 9 + i * 2.1;
      ctx.fillStyle = 'rgba(255,80,90,' + (0.5 + 0.3 * Math.sin(a * 3)) + ')';
      ctx.fillRect(cx + Math.cos(a) * 40 - 3, cy + Math.sin(a) * 40 - 3, 6, 6);
    }
  }
}

// ---------- power-ups ----------
function drawPowerGlyph(ctx, type, cx, cy, s) {
  ctx.save();
  ctx.lineWidth = 4;
  if (type === 'charge') {
    ctx.font = (s * 0.62) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+2', cx, cy + 2);
  } else if (type === 'bolt') {
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.12, cy - s * 0.5);
    ctx.lineTo(cx - s * 0.3, cy + s * 0.12);
    ctx.lineTo(cx - s * 0.02, cy + s * 0.12);
    ctx.lineTo(cx - s * 0.12, cy + s * 0.5);
    ctx.lineTo(cx + s * 0.3, cy - s * 0.12);
    ctx.lineTo(cx + s * 0.02, cy - s * 0.12);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'shield') {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.48);
    ctx.lineTo(cx + s * 0.4, cy - s * 0.26);
    ctx.lineTo(cx + s * 0.4, cy + s * 0.1);
    ctx.quadraticCurveTo(cx + s * 0.4, cy + 0.42 * s, cx, cy + s * 0.52);
    ctx.quadraticCurveTo(cx - s * 0.4, cy + 0.42 * s, cx - s * 0.4, cy + s * 0.1);
    ctx.lineTo(cx - s * 0.4, cy - s * 0.26);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'heart') {
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.45);
    ctx.bezierCurveTo(cx - s * 0.55, cy + s * 0.05, cx - s * 0.45, cy - s * 0.45, cx, cy - s * 0.12);
    ctx.bezierCurveTo(cx + s * 0.45, cy - s * 0.45, cx + s * 0.55, cy + s * 0.05, cx, cy + s * 0.45);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const POWER_COLORS = { charge: '#ffd23f', bolt: '#52ff9d', shield: '#e8f6ff', heart: '#ff5577' };
function drawPowerup(ctx, u, t) {
  const bob = Math.sin(t * 3 + u.born * 7) * 6;
  const cx = px(u.col) + CELL / 2, cy = py(u.row) + CELL / 2 + bob;
  const col = POWER_COLORS[u.type];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.shadowColor = col;
  ctx.shadowBlur = 16 * window.TWEAKS.glow;
  ctx.fillStyle = '#10122a';
  rr(ctx, -30, -30, 60, 60, 10);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  // glyphs ('+2', heart, etc.) have a reading orientation — flip them on the
  // guest's 180°-rotated board so they aren't upside down
  const flipGlyph = (window.NET && NET.active()) && NET.S.view === 1;
  if (flipGlyph) { ctx.translate(cx, cy); ctx.rotate(Math.PI); ctx.translate(-cx, -cy); }
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 8 * window.TWEAKS.glow;
  drawPowerGlyph(ctx, u.type, cx, cy, 38);
  ctx.restore();
}

// ---------- pieces ----------
// The token body at an arbitrary pixel center — shared by the in-game tokens
// and the title-screen battle so they look identical. o = options.
function drawTokenBody(ctx, cx, cy, value, owner, o) {
  o = o || {};
  const col = PLAYER_COLORS[owner];
  const size = 68 + value * 4;
  const rad = Math.max(8, 30 - value * 3.5);
  const t = o.t || 0;
  ctx.save();
  ctx.translate(cx, cy);
  if (o.flip) ctx.rotate(Math.PI);
  ctx.translate(0, o.bob || 0);

  if (o.boosted) {
    ctx.save();
    ctx.strokeStyle = '#ffd23f';
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 12]);
    ctx.lineDashOffset = -t * 60;
    ctx.beginPath();
    ctx.arc(0, 0, size / 2 + 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.shadowColor = col;
  ctx.shadowBlur = (o.sel ? 26 : 14) * window.TWEAKS.glow;
  ctx.fillStyle = PLAYER_DARK[owner];
  rr(ctx, -size / 2, -size / 2, size, size, rad);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = o.sel ? 6 : (value >= 5 ? 5 : 4);
  ctx.stroke();
  ctx.shadowBlur = 0;

  const ey = -size * 0.32;
  if (value === 3) { // visor band
    ctx.fillStyle = 'rgba(110,140,255,0.3)';
    rr(ctx, -size / 2 + 10, ey - 5, size - 20, 24, 6);
    ctx.fill();
  }
  // eyes
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-22, ey, 14, 14);
  ctx.fillRect(8, ey, 14, 14);
  ctx.fillStyle = '#10122a';
  ctx.fillRect(-18, ey + 4, 7, 7);
  ctx.fillRect(12, ey + 4, 7, 7);

  if (value === 1) { // speedster cheek dashes
    ctx.fillStyle = col;
    ctx.fillRect(-size / 2 + 4, ey + 18, 10, 4);
    ctx.fillRect(size / 2 - 14, ey + 18, 10, 4);
  }
  if (value === 2) { // antenna
    ctx.fillStyle = col;
    ctx.fillRect(-3, -size / 2 - 10, 6, 12);
    ctx.fillRect(-7, -size / 2 - 18, 14, 9);
  }
  if (value >= 4) { // brows — angrier with weight
    const tilt = 0.2 + (value - 4) * 0.12;
    ctx.fillStyle = col;
    ctx.save();
    ctx.translate(-15, ey - 7);
    ctx.rotate(tilt);
    ctx.fillRect(-11, -3, 22, 6);
    ctx.restore();
    ctx.save();
    ctx.translate(15, ey - 7);
    ctx.rotate(-tilt);
    ctx.fillRect(-11, -3, 22, 6);
    ctx.restore();
  }
  if (value >= 5) { // armor side plates
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(-size / 2 + 5, -4, 8, size * 0.4);
    ctx.fillRect(size / 2 - 13, -4, 8, size * 0.4);
  }
  if (value === 6) { // rivets
    ctx.fillStyle = col;
    ctx.fillRect(-size / 2 + 9, size / 2 - 15, 7, 7);
    ctx.fillRect(size / 2 - 16, size / 2 - 15, 7, 7);
  }

  ctx.font = (20 + value * 2) + 'px ' + FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (o.charged) {
    ctx.fillStyle = '#ffd23f'; ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 10 * window.TWEAKS.glow;
  } else {
    ctx.fillStyle = '#ffffff';
  }
  ctx.fillText(String(value), 0, size * 0.18);
  ctx.shadowBlur = 0;
  if (o.charged) {
    ctx.fillStyle = '#ffd23f';
    drawPowerGlyph(ctx, 'charge', -size / 2 + 16, -size / 2 + 12, 16);
  }

  if (o.shield) {
    ctx.strokeStyle = '#e8f6ff';
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(t * 5);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, size / 2 + 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (o.boosted) {
    ctx.fillStyle = '#ffd23f';
    ctx.shadowColor = '#ffd23f';
    ctx.shadowBlur = 8;
    drawPowerGlyph(ctx, 'bolt', size / 2 - 6, -size / 2 + 6, 20);
  }
  ctx.restore();
}

function drawToken(ctx, g, p, t) {
  const [bc, br] = piecePos(p);
  const cx = BX + bc * CELL + CELL / 2;
  const cy = BY + br * CELL + CELL / 2;
  const col = PLAYER_COLORS[p.owner];
  const sel = g.sel[p.owner] === p.id;
  const boosted = p.boostUntil > g.time;
  const size = 68 + p.value * 4;
  const rad = Math.max(8, 30 - p.value * 3.5);

  // motion trail
  if (p.path) {
    const dx = p.path.dest[0] - p.from[0], dy = p.path.dest[1] - p.from[1];
    const len = Math.max(Math.abs(dx), Math.abs(dy));
    for (let i = 1; i <= 3; i++) {
      const back = i * 0.22;
      const tt = Math.max(0, p.prog / p.path.cells - back / len);
      const gx = BX + (p.from[0] + dx * tt) * CELL + CELL / 2;
      const gy = BY + (p.from[1] + dy * tt) * CELL + CELL / 2;
      ctx.save();
      ctx.globalAlpha = 0.14 / i;
      ctx.fillStyle = boosted ? '#ffd23f' : col;
      rr(ctx, gx - size / 2, gy - size / 2, size, size, rad);
      ctx.fill();
      ctx.restore();
    }
  }

  const bob = p.path ? 0 : Math.sin(t * 2.2 + p.id) * 2;
  drawTokenBody(ctx, cx, cy, p.value, p.owner, {
    t, bob, sel, flip: textFlip(p.owner), charged: p.charged, shield: p.shield, boosted,
  });

  if (sel) { // pulsing bracket corners (not rotated, just geometry)
    const o = 4 + 3 * Math.sin(t * 7), l = 22, hs = size / 2 + 8;
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 5;
    ctx.shadowColor = col;
    ctx.shadowBlur = 12 * window.TWEAKS.glow;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      const x0 = cx + sx * (hs + o), y0 = cy + sy * (hs + o);
      ctx.beginPath();
      ctx.moveTo(x0 - sx * l, y0); ctx.lineTo(x0, y0); ctx.lineTo(x0, y0 - sy * l);
      ctx.stroke();
    });
    ctx.restore();
  }
}

// ---------- fx ----------
// 80s-arcade pixel style: chunky square blocks snapped to a grid, a hot
// flashing palette, and stepped (not smooth) animation.
const FX_GRID = 8;                                 // everything snaps to this
const HOT = ['#ffffff', '#ffe24a', '#ff8a1e', '#ff3b3b']; // explosion palette
const fxq = (v) => Math.round(v / FX_GRID) * FX_GRID;
function blk(ctx, x, y, s, c) { ctx.fillStyle = c; ctx.fillRect(fxq(x - s / 2), fxq(y - s / 2), Math.round(s), Math.round(s)); }

function drawFx(ctx, g, t) {
  for (const f of g.fx) {
    drawFxAt(ctx, px(f.c) + CELL / 2, py(f.r) + CELL / 2, f);
  }
}

// One effect at an arbitrary pixel center — shared by in-game combat and the
// title battle. f carries {type, owner, t, m, c, r} (c/r only used to vary the
// debris angle, harmless if absent).
function drawFxAt(ctx, cx, cy, f) {
  const FR = 7;                                     // discrete animation frames
  {
    const col = f.owner != null ? PLAYER_COLORS[f.owner] : '#ffffff';
    const k = Math.min(1, f.t / 0.9);
    const step = Math.min(FR - 1, Math.floor(k * FR));   // 0..FR-1, steppy
    const sp = step / (FR - 1);                          // stepped phase 0..1
    const m = f.m || 1;
    const fc = f.c || 0, fr = f.r || 0;
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 6 * window.TWEAKS.glow; // light CRT bloom, hard fills

    if (f.type === 'boom') {
      // chunky shrapnel flung along arms in big pixel chunks + a flashing core cross
      const arms = 8 + Math.min(8, m);
      const reach = 34 + m * 16;
      for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2 + (fc + fr);
        for (let b = 0; b < 3; b++) {
          const d = sp * reach - b * 18;
          if (d < 0) continue;
          const s = (18 + m) - b * 5 - sp * 8;
          if (s <= 4) continue;
          blk(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, HOT[(i + b + step) % HOT.length]);
        }
      }
      if (step < 4) {
        const cs = (34 + m * 5) * (1 - step / 4);
        ctx.fillStyle = step % 2 ? '#ffffff' : '#ffe24a';
        ctx.fillRect(fxq(cx - cs / 2), fxq(cy - cs / 6), Math.round(cs), Math.round(cs / 3));
        ctx.fillRect(fxq(cx - cs / 6), fxq(cy - cs / 2), Math.round(cs / 3), Math.round(cs));
      }
    } else if (f.type === 'shock') {
      // pixelated expanding ring of blocks
      const rad = 12 + sp * (26 + m * 9);
      const n = Math.max(8, Math.round((rad * 2 * Math.PI) / 22));
      const s = 12 - sp * 5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        blk(ctx, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, s, (i + step) % 2 ? '#ffffff' : col);
      }
    } else if (f.type === 'clash') {
      // chunky impact star — fat pixel rays where a defender held
      const rays = 8;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        for (let b = 1; b <= 3; b++) {
          if (b / 3 > sp + 0.34) continue;
          const d = 6 + b * (8 + sp * 7);
          blk(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 14 - b * 2, (b + step) % 2 ? '#ffe24a' : '#ffffff');
        }
      }
    } else if (f.type === 'dmg') {
      // bold pixel damage number: hard block shadow + red/white flicker, steppy rise
      const rise = (Math.floor(sp * 6) / 6) * 84;
      const flip = textFlip(f.owner);
      ctx.shadowBlur = 0;
      ctx.translate(fxq(cx), fxq(cy - 24 - rise));
      if (flip) ctx.rotate(Math.PI);
      ctx.globalAlpha = sp < 0.7 ? 1 : Math.max(0, (1 - sp) / 0.3);
      ctx.font = '44px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000';                       // hard drop shadow
      ctx.fillText('-' + m, 5, 6);
      ctx.fillStyle = step % 2 ? '#ffffff' : '#ff3b3b';
      ctx.fillText('-' + m, 0, 0);
    } else if (f.type === 'merge') {
      const flip = textFlip(f.owner);
      const rise = (Math.floor(sp * 6) / 6) * 46;
      ctx.shadowBlur = 0;
      ctx.translate(fxq(cx), fxq(cy - 18 - rise));
      if (flip) ctx.rotate(Math.PI);
      ctx.globalAlpha = 1 - sp;
      ctx.font = '40px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0b3a23'; ctx.fillText('+', 4, 5);
      ctx.fillStyle = step % 2 ? '#ffffff' : '#52ff9d'; ctx.fillText('+', 0, 0);
    } else if (f.type === 'ring' || f.type === 'power' || f.type === 'shield') {
      // pixelated ring of blocks
      const c2 = f.type === 'shield' ? '#e8f6ff' : col;
      const rad = 16 + sp * (52 + m * 5);
      const n = Math.max(10, Math.round((rad * 2 * Math.PI) / 24));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        blk(ctx, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, 9, (i + step) % 2 ? c2 : '#ffffff');
      }
    }
    ctx.restore();
  }
}

// ---------- HUD ----------
const HUD_H = 190;
function drawHud(ctx, g, pl, t, rotated) {
  // drawn in local coords: (0,0)-(W, HUD_H), player's edge at bottom of local space
  const k = g.castles[pl];
  const col = PLAYER_COLORS[pl];
  const draining = g.time - k.lastDrainT < 0.3;
  const x0 = 104; // leaves room for the pause/mute icons at the screen corner
  const you = window.NET && NET.active() && pl === NET.myPlayer();

  glowText(ctx, PLAYER_NAMES[pl] + (you ? ' · YOU' : ''), x0, 48, 20, col, 8, 'left');
  // energy bar
  const bx = x0, bw = 510, bh = 28, by = 78;
  const segs = 15, sw = (bw - (segs - 1) * 5) / segs;
  const fill = Math.ceil((k.energy / k.max) * segs);
  for (let i = 0; i < segs; i++) {
    const on = i < fill;
    const low = k.energy < k.max * 0.3;
    ctx.save();
    ctx.fillStyle = on ? (low ? '#ff4455' : col) : 'rgba(110,140,255,0.13)';
    if (on) { ctx.shadowColor = low ? '#ff4455' : col; ctx.shadowBlur = 8 * window.TWEAKS.glow; }
    if (draining && on && i === fill - 1) ctx.globalAlpha = 0.4 + 0.6 * Math.sin(t * 20);
    rr(ctx, bx + i * (sw + 5), by, sw, bh, 4);
    ctx.fill();
    ctx.restore();
  }
  ctx.font = '15px ' + FONT;
  ctx.fillStyle = 'rgba(232,246,255,0.55)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.ceil(k.energy)), bx + bw + 22, by + bh / 2 + 1);

  // split button (only on the device that owns this side)
  const mySide = !(window.NET && NET.active()) || pl === NET.myPlayer();
  const p = g.sel[pl] && pieceById(g, g.sel[pl]);
  if (mySide && p && p.value >= 2 && !p.path) {
    const w2 = 264, h2 = 104, x2 = W - w2 - 28, y2 = 36;
    ctx.save();
    ctx.fillStyle = '#10122a';
    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    ctx.shadowColor = col;
    ctx.shadowBlur = 14 * window.TWEAKS.glow;
    rr(ctx, x2, y2, w2, h2, 16);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    glowText(ctx, '✶ SPLIT', x2 + w2 / 2, y2 + h2 / 2 + 2, 22, col, 8);
    addBtn(x2, y2, w2, h2, () => ACTIONS.split(pl), rotated);
  }
}

function drawIconBtn(ctx, x, y, s, kind, on) {
  ctx.save();
  ctx.fillStyle = '#10122a';
  ctx.strokeStyle = 'rgba(110,140,255,0.5)';
  ctx.lineWidth = 3;
  rr(ctx, x, y, s, s, 12);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#aebcff';
  if (kind === 'pause') {
    if (on) { // play triangle = resume
      ctx.beginPath();
      ctx.moveTo(x + s * 0.36, y + s * 0.28);
      ctx.lineTo(x + s * 0.36, y + s * 0.72);
      ctx.lineTo(x + s * 0.74, y + s * 0.5);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillRect(x + s * 0.3, y + s * 0.28, s * 0.14, s * 0.44);
      ctx.fillRect(x + s * 0.56, y + s * 0.28, s * 0.14, s * 0.44);
    }
  } else { // mute
    ctx.beginPath();
    ctx.moveTo(x + s * 0.24, y + s * 0.4);
    ctx.lineTo(x + s * 0.4, y + s * 0.4);
    ctx.lineTo(x + s * 0.56, y + s * 0.26);
    ctx.lineTo(x + s * 0.56, y + s * 0.74);
    ctx.lineTo(x + s * 0.4, y + s * 0.6);
    ctx.lineTo(x + s * 0.24, y + s * 0.6);
    ctx.closePath(); ctx.fill();
    if (on) {
      ctx.strokeStyle = '#ff5566';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.62, y + s * 0.34); ctx.lineTo(x + s * 0.82, y + s * 0.62);
      ctx.moveTo(x + s * 0.82, y + s * 0.34); ctx.lineTo(x + s * 0.62, y + s * 0.62);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// pulsing red arena warning when the viewer's own castle is being drained by
// an enemy. Drawn in screen space (over the board), so it reads the same on a
// guest's flipped view.
function drawAttackWarning(ctx, g, t) {
  let who = -1;
  for (const o of myOwners()) {
    if (g.time - g.castles[o].attackT < 0.4) { who = o; break; }
  }
  if (who < 0) return;
  const pulse = 0.4 + 0.45 * Math.abs(Math.sin(t * 7));
  const x0 = BX - 6, y0 = BY - 6, w = COLS * CELL + 12, h = ROWS * CELL + 12;
  ctx.save();
  ctx.globalAlpha = pulse * 0.13;
  ctx.fillStyle = '#ff2d3d';
  rr(ctx, x0, y0, w, h, 18);
  ctx.fill();
  ctx.globalAlpha = pulse;
  ctx.strokeStyle = '#ff2d3d';
  ctx.lineWidth = 14;
  ctx.shadowColor = '#ff2d3d';
  ctx.shadowBlur = 28 * window.TWEAKS.glow;
  rr(ctx, x0, y0, w, h, 18);
  ctx.stroke();
  ctx.restore();
  // banner near the threatened castle, oriented to its owner
  const banY = who === 1 ? BY + 64 : BY + ROWS * CELL - 64;
  ctx.save();
  ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(t * 7));
  ctx.translate(W / 2, banY);
  if (textFlip(who)) ctx.rotate(Math.PI);
  glowText(ctx, 'CASTLE UNDER ATTACK!', 0, 0, 22, '#ff5566', 12);
  ctx.restore();
}

// ---------- screens ----------
function drawGame(ctx, g, paused, t) {
  ctx.save();
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, W, H);
  // online guest sees the whole board rotated 180° so their side is at the bottom
  if (window.NET && NET.S.view === 1) { ctx.translate(W, H); ctx.rotate(Math.PI); }
  if (g.shake > 0) {
    // chunky, whole-pixel shake — snaps in 8px steps for an arcade jolt
    const amp = Math.round(g.shake * 1.6);
    ctx.translate((((Math.random() * 2) | 0) - 1) * amp * 8, (((Math.random() * 2) | 0) - 1) * amp * 8);
  }

  drawBoard(ctx, g);
  drawLegal(ctx, g, t);
  for (const u of g.powerups) drawPowerup(ctx, u, t);
  for (const k of g.castles) drawCastle(ctx, g, k, t);
  const moving = g.pieces.filter((p) => p.path);
  const still = g.pieces.filter((p) => !p.path);
  for (const p of still) drawToken(ctx, g, p, t);
  for (const p of moving) drawToken(ctx, g, p, t);
  drawFx(ctx, g, t);

  // bottom HUD (player 0)
  ctx.save();
  ctx.translate(0, H - HUD_H);
  drawHud(ctx, g, 0, t, false);
  ctx.restore();

  // top HUD (player 1) — rotated 180 only in local 2P (and online, where the
  // board flip needs countering); upright for the lone reader in vs-AI / watch
  ctx.save();
  if (isLocal2P() || (window.NET && NET.active())) {
    ctx.translate(W, HUD_H);
    ctx.rotate(Math.PI);
    drawHud(ctx, g, 1, t, true);
  } else {
    drawHud(ctx, g, 1, t, false);
  }
  ctx.restore();

  ctx.restore();

  // combat screen flash — a hard white additive pop on big hits/kills
  if (g.flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(0.6, g.flash);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  if (!g.over && !paused) drawAttackWarning(ctx, g, t);

  if (paused && !g.over) drawOverlayMsg(ctx, 'PAUSED', '#aebcff', 'TAP ▶ TO RESUME');

  // pause + mute — drawn unrotated so they sit bottom-left on both devices
  if (!g.over) {
    const s = 64;
    drawIconBtn(ctx, 12, H - s - 12, s, 'pause', paused);
    drawIconBtn(ctx, 12, H - s * 2 - 24, s, 'mute', SFX.isMuted());
    UI.buttons.push({ x: 12, y: H - s - 12, w: s, h: s, abs: true, action: ACTIONS.pause });
    UI.buttons.push({ x: 12, y: H - s * 2 - 24, w: s, h: s, abs: true, action: ACTIONS.mute });
  }

  if (g.over) drawGameOver(ctx, g, t);
  scanlines(ctx);
}

// ---------- double-tap split picker ----------
// ---------- drag trail ----------
// Reads window.DRAGVIS (set by main.js each frame) and draws a glowing tether
// from a piece's home cell (or a fragment chip) to the finger, with a ghost
// token riding the finger, so the player can see they're mid-drag.
function drawDragTrail(ctx, g, t) {
  const list = window.DRAGVIS;
  if (!list || !list.length || !g) return;
  ctx.save();
  if (window.NET && NET.S.view === 1) { ctx.translate(W, H); ctx.rotate(Math.PI); }

  for (const d of list) {
    let ox, oy, col, label, flipTok, size, rad;
    if (d.kind === 'piece') {
      const p = pieceById(g, d.pieceId);
      if (!p) continue;
      ox = px(d.fromC) + CELL / 2; oy = py(d.fromR) + CELL / 2;
      col = PLAYER_COLORS[d.pl];
      label = String(p.value);
      flipTok = textFlip(d.pl);
      size = 64 + p.value * 4; rad = Math.max(8, 30 - p.value * 3.5);
      // faint outline of the home cell it lifts from
      ctx.save();
      ctx.strokeStyle = col; ctx.globalAlpha = 0.4; ctx.lineWidth = 3;
      ctx.setLineDash([8, 8]); ctx.lineDashOffset = -t * 30;
      rr(ctx, px(d.fromC) + 8, py(d.fromR) + 8, CELL - 16, CELL - 16, 12);
      ctx.stroke();
      ctx.restore();
    } else { // chip fragment drag
      ox = d.ox; oy = d.oy;
      col = '#ffd23f';
      label = d.k ? String(d.k) : '';
      flipTok = textFlip(d.pl);
      size = 64; rad = 32;
    }

    const RED = '#ff4d5e';
    const seg = (x1, y1, x2, y2, c) => {
      ctx.save();
      ctx.strokeStyle = c; ctx.globalAlpha = 0.75; ctx.lineWidth = 5;
      ctx.setLineDash([14, 12]); ctx.lineDashOffset = -t * 70;
      ctx.shadowColor = c; ctx.shadowBlur = 12 * window.TWEAKS.glow;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    };

    if (d.kind === 'piece' && d.landC != null) {
      // reachable part in the piece's colour, overreach beyond it in red,
      // and a bright pulsing marker on the cell it will actually land on
      const lx = px(d.landC) + CELL / 2, ly = py(d.landR) + CELL / 2;
      seg(ox, oy, lx, ly, col);
      if (d.overreach) seg(lx, ly, d.lx, d.ly, RED);
      const pulse = 0.45 + 0.25 * Math.sin(t * 7);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = col;
      rr(ctx, px(d.landC) + 8, py(d.landR) + 8, CELL - 16, CELL - 16, 12);
      ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
      ctx.shadowColor = col; ctx.shadowBlur = 16 * window.TWEAKS.glow;
      rr(ctx, px(d.landC) + 8, py(d.landR) + 8, CELL - 16, CELL - 16, 12);
      ctx.stroke();
      ctx.restore();
    } else if (d.kind === 'piece') {
      // no legal move in this direction at all — whole tether is a no-go
      seg(ox, oy, d.lx, d.ly, RED);
    } else {
      seg(ox, oy, d.lx, d.ly, col); // chip drag
    }

    // ghost token riding the finger
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(d.lx, d.ly);
    ctx.shadowColor = col; ctx.shadowBlur = 22 * window.TWEAKS.glow;
    ctx.fillStyle = d.kind === 'chip' ? PLAYER_DARK[d.pl] : PLAYER_DARK[d.pl];
    if (d.kind === 'chip') { ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, Math.PI * 2); ctx.fill(); }
    else { rr(ctx, -size / 2, -size / 2, size, size, rad); ctx.fill(); }
    ctx.strokeStyle = col; ctx.lineWidth = 5;
    if (d.kind === 'chip') { ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, Math.PI * 2); ctx.stroke(); }
    else { rr(ctx, -size / 2, -size / 2, size, size, rad); ctx.stroke(); }
    ctx.shadowBlur = 0;
    if (label) {
      if (flipTok) ctx.rotate(Math.PI);
      ctx.fillStyle = d.kind === 'chip' ? '#ffd23f' : '#fff';
      ctx.font = '30px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 3);
    }
    ctx.restore();
  }
  ctx.restore();
}

// ---------- double-tap split picker ----------
// Reads window.SPLITUI ({pl, pieceId, k, t0}) set by main.js each frame.
// Drawn after drawGame, so the guest's 180° view flip is reapplied here.
function drawSplitUI(ctx, g, t) {
  const su = window.SPLITUI;
  if (!su || !g) return;
  const p = pieceById(g, su.pieceId);
  if (!p || p.path) return;

  ctx.save();
  if (window.NET && NET.S.view === 1) { ctx.translate(W, H); ctx.rotate(Math.PI); }

  // gold preview of where the chosen fragment can go
  if (su.k) {
    const ghost = Object.assign({}, p, { value: su.k });
    const pulse = 0.2 + 0.1 * Math.sin(t * 6);
    for (const m of legalMoves(g, ghost)) {
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ffd23f';
      rr(ctx, px(m.c) + 6, py(m.r) + 6, CELL - 12, CELL - 12, 12);
      ctx.fill();
      ctx.restore();
    }
  }

  const cx = px(p.col) + CELL / 2, cy = py(p.row) + CELL / 2;
  // clamp to [0,1] — t (rAF clock) can read a hair before t0 (performance.now
  // at open), and a negative pop makes the burst-ring radius negative, which
  // throws IndexSizeError in ctx.arc and would freeze the frame loop
  const pop = Math.max(0, Math.min(1, (t - su.t0) * 6));
  const flipTok = textFlip(su.pl);

  // burst ring around the exploding piece
  ctx.save();
  ctx.strokeStyle = '#ffd23f';
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 10]);
  ctx.lineDashOffset = -t * 80;
  ctx.beginPath();
  ctx.arc(cx, cy, (CELL * 0.62) * pop, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // fragment chips 1..value-1 laid out as a clamped horizontal row near the
  // piece — never overlaps and always on-screen, even in a board corner
  const n = p.value - 1;
  const R = 42, gap = 16;
  const rowW = n * (2 * R) + (n - 1) * gap;
  const rowX0 = Math.max(20 + R, Math.min(W - 20 - rowW + R, cx - rowW / 2 + R));
  // place the row between the piece and the board centre, toward the owner's seat
  let rowY = su.pl === 1 ? cy + CELL * 1.15 : cy - CELL * 1.15;
  rowY = Math.max(HUD_H + R + 30, Math.min(H - HUD_H - R - 30, rowY));
  const col = PLAYER_COLORS[su.pl];
  for (let i = 0; i < n; i++) {
    const k = i + 1;
    const chx = rowX0 + i * (2 * R + gap);
    const chy = rowY;
    const on = su.k === k;
    ctx.save();
    ctx.globalAlpha = pop;
    ctx.shadowColor = on ? '#ffd23f' : col;
    ctx.shadowBlur = (on ? 24 : 12) * window.TWEAKS.glow;
    ctx.fillStyle = PLAYER_DARK[su.pl];
    ctx.beginPath();
    ctx.arc(chx, chy, R * (0.6 + 0.4 * pop), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = on ? '#ffd23f' : col;
    ctx.lineWidth = on ? 6 : 4;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.translate(chx, chy);
    if (flipTok) ctx.rotate(Math.PI);
    ctx.fillStyle = on ? '#ffd23f' : '#e8f6ff';
    ctx.font = '30px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(k), 0, 3);
    ctx.restore();
    UI.buttons.push({ x: chx - R, y: chy - R, w: R * 2, h: R * 2, chip: k, action: () => ACTIONS.chipPick(k) });
  }

  // one-line hint, readable from the owner's seat, x-clamped so it never clips
  ctx.save();
  const hy = su.pl === 1 ? rowY + R + 28 : rowY - R - 28;
  ctx.translate(Math.max(260, Math.min(W - 260, cx)), Math.max(HUD_H + 20, Math.min(H - HUD_H - 20, hy)));
  if (flipTok) ctx.rotate(Math.PI);
  glowText(ctx, su.k ? 'TAP A GOLD CELL TO LAUNCH ' + su.k : 'PICK A FRAGMENT SIZE', 0, 0, 15, '#ffd23f', 6);
  ctx.restore();

  ctx.restore();
}

function drawOverlayMsg(ctx, big, color, small) {
  ctx.save();
  ctx.fillStyle = 'rgba(4,4,12,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  glowText(ctx, big, W / 2, H / 2 - 30, 64, color, 24);
  if (small) glowText(ctx, small, W / 2, H / 2 + 60, 20, 'rgba(232,246,255,0.7)', 8);
}

function drawGameOver(ctx, g, t) {
  const net = window.NET && NET.active();
  const col = PLAYER_COLORS[g.winner];
  ctx.save();
  ctx.fillStyle = 'rgba(4,4,12,' + Math.min(0.78, g.overT * 1.5) + ')';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const flick = 0.85 + 0.15 * Math.sin(t * 9);
  ctx.save();
  ctx.globalAlpha = flick;
  if (net) {
    const win = NET.myPlayer() === g.winner;
    glowText(ctx, win ? 'YOU' : PLAYER_NAMES[g.winner], W / 2, H / 2 - 210, 56, col, 28);
    glowText(ctx, win ? 'WIN!' : 'WINS!', W / 2, H / 2 - 120, 56, col, 28);
  } else {
    // readable for the winner from their side; show both orientations
    glowText(ctx, PLAYER_NAMES[g.winner], W / 2, H / 2 - 210, 56, col, 28);
    glowText(ctx, 'WINS!', W / 2, H / 2 - 120, 56, col, 28);
    ctx.save();
    ctx.translate(W / 2, H / 2 + 340);
    ctx.rotate(Math.PI);
    glowText(ctx, PLAYER_NAMES[g.winner] + ' WINS!', 0, 0, 30, col, 16);
    ctx.restore();
  }
  ctx.restore();

  const bw = 480, bh = 110;
  drawBigBtn(ctx, W / 2 - bw / 2, H / 2 - 10, bw, bh, 'REMATCH', col, t);
  UI.buttons.push({ x: W / 2 - bw / 2, y: H / 2 - 10, w: bw, h: bh, abs: true, action: ACTIONS.rematch });
  drawBigBtn(ctx, W / 2 - bw / 2, H / 2 + 130, bw, bh, net ? 'LEAVE MATCH' : 'CHANGE ARENA', '#aebcff', t, true);
  UI.buttons.push({ x: W / 2 - bw / 2, y: H / 2 + 130, w: bw, h: bh, abs: true, action: ACTIONS.toTitle });
}

function drawBigBtn(ctx, x, y, w, h, label, col, t, quiet, size) {
  ctx.save();
  ctx.fillStyle = '#10122a';
  ctx.strokeStyle = col;
  ctx.lineWidth = 5;
  ctx.shadowColor = col;
  ctx.shadowBlur = (quiet ? 8 : 16 + 8 * Math.sin(t * 4)) * window.TWEAKS.glow;
  rr(ctx, x, y, w, h, 18);
  ctx.fill(); ctx.stroke();
  ctx.restore();
  glowText(ctx, label, x + w / 2, y + h / 2 + 2, size || 26, col, 8);
}

// ---------- turn-based planning overlay ----------
function drawArrow(ctx, ax, ay, bx, by, col) {
  ctx.save();
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.shadowColor = col; ctx.shadowBlur = 10 * window.TWEAKS.glow; ctx.globalAlpha = 0.92;
  ctx.setLineDash([14, 10]);
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  ctx.setLineDash([]);
  const a = Math.atan2(by - ay, bx - ax), hl = 26;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - hl * Math.cos(a - 0.5), by - hl * Math.sin(a - 0.5));
  ctx.lineTo(bx - hl * Math.cos(a + 0.5), by - hl * Math.sin(a + 0.5));
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// the 30s planning UI: a countdown, a GO button, and a ghost arrow for every
// queued order (a faded fragment token marks a queued split's landing cell).
function drawTurnHud(ctx, g, t) {
  if (g.over) return;
  const mine = myOwners();
  // order ghosts are board-space — match the guest's 180° board flip, and only
  // show MY side's plan (a simultaneous-turn game keeps the opponent's hidden)
  if (g.phase === 'plan') {
    ctx.save();
    if (window.NET && NET.S.view === 1) { ctx.translate(W, H); ctx.rotate(Math.PI); }
    for (const id in g.orders) {
      const o = g.orders[id], p = pieceById(g, +id);
      if (!p || mine.indexOf(p.owner) < 0) continue;
      const col = PLAYER_COLORS[p.owner];
      const ax = BX + (p.col + 0.5) * CELL, ay = BY + (p.row + 0.5) * CELL;
      const bx = BX + (o.c + 0.5) * CELL, by = BY + (o.r + 0.5) * CELL;
      drawArrow(ctx, ax, ay, bx, by, col);
      if (o.kind === 'split') { ctx.save(); ctx.globalAlpha = 0.8; drawTokenBody(ctx, bx, by, o.k, p.owner, { t, bob: 0 }); ctx.restore(); }
    }
    ctx.restore();
  }
  // screen-space UI, upright on both devices
  if (g.phase === 'resolve') { glowText(ctx, 'RESOLVING…', W / 2, 160, 28, '#ffd23f', 12); return; }
  const secs = Math.max(0, Math.ceil(g.planT)), warn = secs <= 5;
  glowText(ctx, 'PLAN  ' + secs + 's', W / 2, 160, 32, warn ? '#ff5566' : '#19e6ff', warn ? 16 : 8);
  let n = 0;
  for (const id in g.orders) { const p = pieceById(g, +id); if (p && mine.indexOf(p.owner) >= 0) n++; }
  glowText(ctx, n + ' ORDER' + (n === 1 ? '' : 'S') + ' QUEUED', W / 2, 198, 14, 'rgba(232,246,255,0.6)', 4);
  const bw = 320, bh = 70, bx = W / 2 - bw / 2, by = H - 80;
  drawBigBtn(ctx, bx, by, bw, bh, '▶ GO', '#52ff9d', t, false, 30);
  UI.buttons.push({ x: bx, y: by, w: bw, h: bh, abs: true, action: ACTIONS.go });
}

// ---------- title ----------
function drawMiniMap(ctx, board, x, y, cs) {
  ctx.fillStyle = 'rgba(110,140,255,0.12)';
  ctx.fillRect(x - 3, y - 3, COLS * cs + 6, ROWS * cs + 6);
  if (board.random) {
    ctx.font = (cs * 5) + 'px ' + FONT;
    ctx.fillStyle = '#ffd23f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + (COLS * cs) / 2, y + (ROWS * cs) / 2 + 2);
    return;
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board.map[r][c] === '#') {
        ctx.fillStyle = '#3a4070';
        ctx.fillRect(x + c * cs, y + r * cs, cs - 1, cs - 1);
      }
    }
  }
  ctx.fillStyle = PLAYER_COLORS[1];
  ctx.fillRect(x + 4 * cs, y + 1 * cs, cs, cs);
  ctx.fillStyle = PLAYER_COLORS[0];
  ctx.fillRect(x + 4 * cs, y + 11 * cs, cs, cs);
}

function drawStars(ctx, t) {
  // three parallax layers drifting downward — an attract-mode flight through
  // space. Near layers are bigger, brighter and faster (depth cue).
  const layers = [[40, 13, 2, 0.30], [26, 33, 3, 0.5], [14, 70, 4, 0.78]]; // [count, speed, size, baseAlpha]
  for (let L = 0; L < layers.length; L++) {
    const n = layers[L][0], speed = layers[L][1], size = layers[L][2], base = layers[L][3];
    for (let i = 0; i < n; i++) {
      const seed = i * 167 + L * 911;
      const x = (seed * 197) % W;
      const y = (((seed * 397) % H) + t * speed) % H;
      const a = base + 0.22 * Math.sin(t * 2 + seed);
      ctx.fillStyle = 'rgba(180,205,255,' + Math.max(0.08, Math.min(1, a)) + ')';
      ctx.fillRect(x, y, size, size);
    }
  }
}

// ---------- ambient battle behind the title logo ----------
// Real game tokens charge across and clash with the actual combat FX, so the
// menu previews exactly how a match looks.
const TFX = { tokens: [], fx: [], spawnT: 0, lastT: 0, id: 0 };
const TFX_LANES = [150, 250, 360, 470];
const TFX_SCALE = 0.72;

function titleBattle(ctx, t) {
  const dt = Math.min(0.05, Math.max(0, t - TFX.lastT));
  TFX.lastT = t;

  TFX.spawnT -= dt;
  if (TFX.spawnT <= 0 && TFX.tokens.length < 6) {
    TFX.spawnT = 0.8 + Math.random() * 1.3;
    const owner = Math.random() < 0.5 ? 0 : 1;       // 0 cyan from left, 1 magenta from right
    const v = 1 + ((Math.random() * 6) | 0);
    TFX.tokens.push({
      owner, v, id: ++TFX.id,
      x: owner === 0 ? -60 : W + 60,
      y: TFX_LANES[(Math.random() * TFX_LANES.length) | 0] + (Math.random() * 30 - 15),
      vx: (owner === 0 ? 1 : -1) * (70 + (7 - v) * 34),
    });
  }

  for (const k of TFX.tokens) k.x += k.vx * dt;

  // clashes: opposing tokens overlap → real combat resolution + the game's FX
  for (const a of TFX.tokens) {
    for (const b of TFX.tokens) {
      if (a === b || a.owner === b.owner || a.dead || b.dead) continue;
      if (Math.abs(a.y - b.y) < 50 && Math.abs(a.x - b.x) < 56) {
        const [w, l] = a.v >= b.v ? [a, b] : [b, a];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, wv = w.v;
        l.dead = true;
        TFX.fx.push({ type: 'dmg', owner: 0, m: wv, x: mx, y: my, t: 0 });
        TFX.fx.push({ type: 'boom', owner: l.owner, m: l.v, x: l.x, y: l.y, t: 0 });
        TFX.fx.push({ type: 'shock', owner: w.owner, m: wv, x: mx, y: my, t: 0 });
        w.v -= l.v;
        if (w.v <= 0) { w.dead = true; TFX.fx.push({ type: 'boom', owner: w.owner, m: wv, x: w.x, y: w.y, t: 0 }); }
      }
    }
  }
  TFX.tokens = TFX.tokens.filter((k) => !k.dead && k.x > -90 && k.x < W + 90);
  for (const f of TFX.fx) { f.t += dt; f.x += (f.vx || 0) * dt; }
  TFX.fx = TFX.fx.filter((f) => f.t < 0.9);

  // tokens (slightly dimmed so the logo reads over them)
  ctx.save();
  ctx.globalAlpha = 0.72;
  for (const k of TFX.tokens) {
    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.scale(TFX_SCALE, TFX_SCALE);
    drawTokenBody(ctx, 0, 0, k.v, k.owner, { t, bob: Math.sin(t * 2.2 + k.id) * 2 });
    ctx.restore();
  }
  ctx.restore();
  // FX at full punch — the same chunky pixel explosions as the game
  for (const f of TFX.fx) drawFxAt(ctx, f.x, f.y, f);
}

// attract-mode shine: a bright highlight sweeps across the logo letters every
// few seconds (only the strokes catch the light, since we re-fill the text).
function logoSweep(ctx, t) {
  const pos = (t * 0.42) % 3.4;            // travels 0→1 across the screen, then a long gap
  if (pos > 1) return;
  const gx = -120 + pos * (W + 240);
  const g = ctx.createLinearGradient(gx - 150, 0, gx + 150, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.font = '92px ' + FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = g;
  ctx.fillText('CORTEX', W / 2 + 3, 238);
  ctx.fillText('CLASH', W / 2 + 3, 358);
  ctx.restore();
}

// CRT tube motion: a soft refresh band rolling down over the scanlines
function crtFx(ctx, t) {
  if (!window.TWEAKS.scanlines) return;
  const bandY = (t * 130) % (H + 260) - 130;
  const g = ctx.createLinearGradient(0, bandY - 130, 0, bandY + 130);
  g.addColorStop(0, 'rgba(180,220,255,0)');
  g.addColorStop(0.5, 'rgba(190,225,255,0.05)');
  g.addColorStop(1, 'rgba(180,220,255,0)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, bandY - 130, W, 260);
  ctx.restore();
}

function drawTitle(ctx, boardIdx, t, mode) {
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, W, H);

  drawStars(ctx, t);
  titleBattle(ctx, t);

  // coin-op cabinet flavour in the top corners
  glowText(ctx, 'CREDIT  FREE PLAY', 40, 62, 13, 'rgba(120,230,180,0.6)', 4, 'left');
  glowText(ctx, '© 2126 PKZIPYA', W - 40, 62, 13, 'rgba(120,230,180,0.45)', 4, 'right');

  glowText(ctx, 'HUMANS · CPUS · LLMS', W / 2, 132, 20, '#aebcff', 8);
  // logo with animated chromatic offsets + a pulsing neon glow
  const chroma = 4 + 2.5 * Math.sin(t * 2);
  const pulse = 22 + 8 * Math.sin(t * 2.4);
  ctx.save();
  ctx.globalAlpha = 0.6;
  glowText(ctx, 'CORTEX', W / 2 - chroma, 235, 92, '#ff3df0', 2);
  glowText(ctx, 'CLASH', W / 2 - chroma, 355, 92, '#ff3df0', 2);
  ctx.restore();
  glowText(ctx, 'CORTEX', W / 2 + chroma * 0.4, 238, 92, '#19e6ff', pulse);
  glowText(ctx, 'CLASH', W / 2 + chroma * 0.4, 358, 92, '#19e6ff', pulse);
  logoSweep(ctx, t);
  glowText(ctx, 'REAL-TIME NUMBER COMBAT', W / 2, 445, 19, 'rgba(232,246,255,0.65)', 6);

  // game-mode slider: real-time vs turn-based
  const sw = 460, sh = 60, sx = W / 2 - sw / 2, sy = 468;
  ctx.save();
  ctx.fillStyle = '#0c0e20';
  ctx.strokeStyle = 'rgba(110,140,255,0.35)';
  ctx.lineWidth = 2;
  rr(ctx, sx, sy, sw, sh, 16); ctx.fill(); ctx.stroke();
  ctx.restore();
  const segs = [['REAL-TIME', 'rts', '#19e6ff'], ['TURN-BASED', 'turn', '#ffd23f']];
  for (let i = 0; i < 2; i++) {
    const label = segs[i][0], m = segs[i][1], col = segs[i][2];
    const x = sx + 6 + i * (sw / 2 - 3), w = sw / 2 - 9, y = sy + 6, h = sh - 12, on = mode === m;
    if (on) {
      ctx.save();
      ctx.fillStyle = col; ctx.globalAlpha = 0.16; rr(ctx, x, y, w, h, 12); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.shadowColor = col; ctx.shadowBlur = 10 * window.TWEAKS.glow; rr(ctx, x, y, w, h, 12); ctx.stroke();
      ctx.restore();
    }
    glowText(ctx, label, x + w / 2, y + h / 2 + 1, 16, on ? col : 'rgba(232,246,255,0.5)', on ? 8 : 0);
    UI.buttons.push({ x, y, w, h, action: () => ACTIONS.setMode(m) });
  }

  glowText(ctx, 'CHOOSE ARENA', W / 2, 552, 24, '#ffd23f', 10);

  const bw = 880, bh = 88, gap = 10;
  let y = 585;
  BOARDS.forEach((b, i) => {
    const x = (W - bw) / 2;
    const on = i === boardIdx;
    ctx.save();
    ctx.fillStyle = on ? '#141738' : '#0c0e20';
    ctx.strokeStyle = on ? '#19e6ff' : 'rgba(110,140,255,0.3)';
    ctx.lineWidth = on ? 4 : 2;
    if (on) { ctx.shadowColor = '#19e6ff'; ctx.shadowBlur = 14 * window.TWEAKS.glow; }
    rr(ctx, x, y, bw, bh, 16);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    drawMiniMap(ctx, b, x + 28, y + 5, 6);
    glowText(ctx, b.name, x + 120, y + 36, 22, on ? '#19e6ff' : '#aebcff', on ? 10 : 0, 'left');
    ctx.font = '15px ' + FONT;
    ctx.fillStyle = 'rgba(232,246,255,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText(b.tag, x + 120, y + 70);
    if (on) glowText(ctx, '◆', x + bw - 44, y + bh / 2, 24, '#19e6ff', 10);
    UI.buttons.push({ x, y, w: bw, h: bh, action: () => ACTIONS.pickBoard(i) });
    y += bh + gap;
  });

  // how to play
  y += 14;
  const lines = [
    ['TAP YOUR PIECE, TAP A GLOWING CELL', '#e8f6ff'],
    ['LOW NUMBERS RUN FAR AND FAST', '#19e6ff'],
    ['HIGH NUMBERS HIT HARD', '#ff3df0'],
    ['LAND ON A FOE: DEAL YOUR NUMBER', '#e8f6ff'],
    ['MERGE ONTO YOURS · SPLIT TO SWARM', '#e8f6ff'],
    ['CAMP THE ENEMY CASTLE TO DRAIN IT', '#ffd23f'],
  ];
  lines.forEach(([txt, c], i) => {
    glowText(ctx, txt, W / 2, y + i * 32, 18, c, 5);
  });
  y += lines.length * 32 + 18;

  // power-up legend — what each pickup actually does
  const legend = [
    ['charge', 'POWER +2', 'PIECE VALUE +2 · PERMANENT'],
    ['bolt', 'SPEED', '70% FASTER FOR 8 SEC'],
    ['shield', 'SHIELD', 'BLOCKS ONE ENEMY HIT'],
    ['heart', 'REPAIR', 'YOUR CASTLE +12 ENERGY'],
  ];
  const cw = 480, ch = 60, lgx = 16, lgy = 10;
  legend.forEach(([type, label, desc], i) => {
    const x = W / 2 + (i % 2 === 0 ? -cw - lgx / 2 : lgx / 2);
    const cy = y + Math.floor(i / 2) * (ch + lgy);
    const pc = POWER_COLORS[type];
    ctx.save();
    ctx.fillStyle = '#0c0e20';
    ctx.strokeStyle = 'rgba(110,140,255,0.25)';
    ctx.lineWidth = 2;
    rr(ctx, x, cy, cw, ch, 12);
    ctx.fill();
    ctx.stroke();
    // diamond pickup icon, same look as in-game
    ctx.translate(x + 38, cy + ch / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#10122a';
    ctx.strokeStyle = pc;
    ctx.lineWidth = 3;
    ctx.shadowColor = pc;
    ctx.shadowBlur = 8 * window.TWEAKS.glow;
    rr(ctx, -16, -16, 32, 32, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = pc;
    ctx.shadowColor = pc;
    ctx.shadowBlur = 6 * window.TWEAKS.glow;
    drawPowerGlyph(ctx, type, x + 38, cy + ch / 2, 20);
    ctx.restore();
    ctx.font = '16px ' + FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = pc;
    ctx.fillText(label, x + 72, cy + 22);
    ctx.font = '14px ' + FONT;
    ctx.fillStyle = 'rgba(232,246,255,0.62)';
    ctx.fillText(desc, x + 72, cy + 47);
  });
  y += 2 * ch + lgy + 16;

  const sw2 = 760;
  const bx0 = W / 2 - sw2 / 2;
  const hw = (sw2 - 18) / 2;
  drawBigBtn(ctx, bx0, y, hw, 96, 'VS COMPUTER', '#ffd23f', t, false, 22);
  UI.buttons.push({ x: bx0, y, w: hw, h: 96, action: ACTIONS.vsComputer });
  drawBigBtn(ctx, bx0 + sw2 - hw, y, hw, 96, 'VS CLAUDE', '#b18cff', t, false, 22);
  UI.buttons.push({ x: bx0 + sw2 - hw, y, w: hw, h: 96, action: ACTIONS.vsClaude });
  y += 96 + 12;
  drawBigBtn(ctx, bx0, y, hw, 96, '2P LOCAL', '#52ff9d', t, true, 22);
  UI.buttons.push({ x: bx0, y, w: hw, h: 96, action: ACTIONS.start });
  drawBigBtn(ctx, bx0 + sw2 - hw, y, hw, 96, 'AI VS AI', '#ff8c3d', t, true, 22);
  UI.buttons.push({ x: bx0 + sw2 - hw, y, w: hw, h: 96, action: ACTIONS.aiVsAi });
  y += 96 + 12;
  drawBigBtn(ctx, bx0, y, hw, 96, 'HOST ONLINE', '#19e6ff', t, true, 22);
  UI.buttons.push({ x: bx0, y, w: hw, h: 96, action: ACTIONS.createOnline });
  drawBigBtn(ctx, bx0 + sw2 - hw, y, hw, 96, 'JOIN ONLINE', '#ff3df0', t, true, 22);
  UI.buttons.push({ x: bx0 + sw2 - hw, y, w: hw, h: 96, action: ACTIONS.joinOnline });
  ctx.font = '14px ' + FONT;
  ctx.fillStyle = 'rgba(232,246,255,0.45)';
  ctx.textAlign = 'center';
  ctx.fillText('By PKZIPYA     Version #: ' + APP_VER, W / 2, y + 96 + 24);

  scanlines(ctx);
  crtFx(ctx, t);
}

// ---------- opponent picker ----------
function drawPicker(ctx, picker, t) {
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, W, H);
  drawStars(ctx, t);
  titleBattle(ctx, t);

  glowText(ctx, picker.title, W / 2, 360, 30, '#ffd23f', 12);

  const bw = 880, bh = 108, gap = 16;
  const total = picker.options.length * (bh + gap) - gap;
  let y = Math.max(440, (H - total) / 2 - 60);
  picker.options.forEach((id, i) => {
    const spec = AI.byId(id);
    const x = (W - bw) / 2;
    const col = spec.kind === 'bot' ? '#ffd23f'
      : spec.provider === 'anthropic' ? '#b18cff'
      : spec.provider === 'openai' ? '#52ff9d'
      : '#19e6ff';
    drawBigBtn(ctx, x, y, bw, bh, spec.label, col, t, true, 24);
    if (spec.kind === 'llm') {
      ctx.font = '13px ' + FONT;
      ctx.fillStyle = 'rgba(232,246,255,0.4)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('API KEY', x + bw - 26, y + bh / 2);
    }
    UI.buttons.push({ x, y, w: bw, h: bh, action: () => ACTIONS.pickerChoose(i) });
    y += bh + gap;
  });

  y += 18;
  drawBigBtn(ctx, W / 2 - 220, y, 440, 90, '◀ BACK', '#aebcff', t, true, 20);
  UI.buttons.push({ x: W / 2 - 220, y, w: 440, h: 90, action: ACTIONS.pickerBack });

  scanlines(ctx);
  crtFx(ctx, t);
}

// ---------- online screens ----------
function drawCodeBoxes(ctx, code, x0, y, bw, bh, gap, color, t, cursor) {
  for (let i = 0; i < 4; i++) {
    const x = x0 + i * (bw + gap);
    ctx.save();
    ctx.fillStyle = '#10122a';
    ctx.strokeStyle = code[i] ? color : 'rgba(110,140,255,0.4)';
    ctx.lineWidth = 4;
    if (code[i]) { ctx.shadowColor = color; ctx.shadowBlur = 12 * window.TWEAKS.glow; }
    rr(ctx, x, y, bw, bh, 14);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (code[i]) {
      glowText(ctx, code[i], x + bw / 2, y + bh / 2 + 4, Math.floor(bh * 0.42), color, 10);
    } else if (cursor && i === code.length && Math.sin(t * 6) > 0) {
      ctx.fillStyle = color;
      ctx.fillRect(x + bw / 2 - 20, y + bh - 28, 40, 6);
    }
  }
}

function drawLobby(ctx, boardIdx, t) {
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, W, H);
  drawStars(ctx, t);

  glowText(ctx, 'ONLINE BATTLE', W / 2, 170, 44, '#19e6ff', 18);
  glowText(ctx, 'YOU ARE PLAYER 1 · HOST', W / 2, 245, 18, 'rgba(232,246,255,0.6)', 6);

  glowText(ctx, 'ROOM CODE', W / 2, 395, 24, '#ffd23f', 10);
  const bw = 150, gap = 26;
  drawCodeBoxes(ctx, NET.S.code, W / 2 - (4 * bw + 3 * gap) / 2, 445, bw, 180, gap, '#ffd23f', t, false);

  const st = NET.S.status || '';
  const waiting = st.indexOf('WAITING') === 0 || st.indexOf('OPENING') === 0 || st.indexOf('RECONNECT') === 0 || st.indexOf('PLAYER 2 CONNECTED') === 0;
  const dots = waiting ? '.'.repeat(1 + (Math.floor(t * 2) % 3)) : '';
  glowText(ctx, st + dots, W / 2, 725, 20, waiting ? '#52ff9d' : '#ff5566', 8);

  ['SHARE THE LINK — PLAYER 2 TAPS IT', 'TO DROP STRAIGHT INTO YOUR GAME.', 'OR THEY CAN ENTER THE CODE ABOVE.'].forEach((l, i) => {
    glowText(ctx, l, W / 2, 850 + i * 52, 19, 'rgba(232,246,255,0.75)', 5);
  });

  const bw2 = 620, bh2 = 104;
  // label matches what the device actually does (share sheet vs clipboard copy)
  const shareLabel = NET.canShare() ? 'SHARE INVITE LINK' : 'COPY INVITE LINK';
  drawBigBtn(ctx, W / 2 - bw2 / 2, 1075, bw2, bh2, shareLabel, '#52ff9d', t, false, 24);
  UI.buttons.push({ x: W / 2 - bw2 / 2, y: 1075, w: bw2, h: bh2, action: ACTIONS.shareLink });
  if (NET.S.copyMsg) glowText(ctx, NET.S.copyMsg, W / 2, 1230, 17, '#ffd23f', 6);

  glowText(ctx, 'ARENA: ' + BOARDS[boardIdx].name, W / 2, 1340, 20, '#aebcff', 6);
  drawMiniMap(ctx, BOARDS[boardIdx], W / 2 - (COLS * 9) / 2, 1380, 9);

  drawBigBtn(ctx, W / 2 - 240, 1620, 480, 104, 'CANCEL', '#ff5566', t, true, 22);
  UI.buttons.push({ x: W / 2 - 240, y: 1620, w: 480, h: 104, action: ACTIONS.cancelOnline });

  scanlines(ctx);
}

function drawJoin(ctx, code, t) {
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, W, H);
  drawStars(ctx, t);

  glowText(ctx, 'JOIN GAME', W / 2, 170, 44, '#ff3df0', 18);
  glowText(ctx, 'YOU ARE PLAYER 2 · GET THE CODE FROM PLAYER 1', W / 2, 245, 16, 'rgba(232,246,255,0.6)', 5);

  glowText(ctx, 'ENTER ROOM CODE', W / 2, 360, 22, '#ffd23f', 8);
  const bw = 140, gap = 24;
  drawCodeBoxes(ctx, code, W / 2 - (4 * bw + 3 * gap) / 2, 405, bw, 170, gap, '#ff3df0', t, true);

  const st = (NET.S.mode === 'guest' && NET.S.status) || '';
  const busy = st.indexOf('CONNECT') === 0 || st.indexOf('RECONNECT') === 0;
  if (st) glowText(ctx, st, W / 2, 650, 18, busy ? '#52ff9d' : '#ff5566', 6);

  // keypad
  const kw = 150, kh = 104, kgap = 16, perRow = 6;
  const x0 = (W - (perRow * kw + (perRow - 1) * kgap)) / 2;
  const y0 = 740;
  for (let i = 0; i < NET.ALPHA.length; i++) {
    const ch = NET.ALPHA[i];
    const x = x0 + (i % perRow) * (kw + kgap);
    const y = y0 + Math.floor(i / perRow) * (kh + kgap);
    ctx.save();
    ctx.fillStyle = '#10122a';
    ctx.strokeStyle = 'rgba(110,140,255,0.45)';
    ctx.lineWidth = 3;
    rr(ctx, x, y, kw, kh, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    glowText(ctx, ch, x + kw / 2, y + kh / 2 + 3, 30, '#aebcff', 4);
    UI.buttons.push({ x, y, w: kw, h: kh, action: () => ACTIONS.key(ch) });
  }
  const rowY = y0 + 4 * (kh + kgap) + 14;
  drawBigBtn(ctx, x0, rowY, 380, 110, '⌫ DEL', '#aebcff', t, true, 22);
  UI.buttons.push({ x: x0, y: rowY, w: 380, h: 110, action: ACTIONS.del });
  const ready = code.length === 4;
  drawBigBtn(ctx, x0 + 380 + kgap, rowY, perRow * kw + (perRow - 1) * kgap - 380 - kgap, 110, busy ? 'CONNECTING…' : '▶ JOIN', ready ? '#52ff9d' : 'rgba(110,140,255,0.4)', t, !ready, 22);
  UI.buttons.push({ x: x0 + 380 + kgap, y: rowY, w: perRow * kw + (perRow - 1) * kgap - 380 - kgap, h: 110, action: ACTIONS.joinGo });

  drawBigBtn(ctx, W / 2 - 240, rowY + 160, 480, 100, 'BACK', '#ff5566', t, true, 22);
  UI.buttons.push({ x: W / 2 - 240, y: rowY + 160, w: 480, h: 100, action: ACTIONS.cancelOnline });

  scanlines(ctx);
}

// the guest's landing when they open an invite link — a friendly "you're in"
// screen that auto-connects, then onGuestStart drops them into the match
function drawInvite(ctx, code, t) {
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, W, H);
  drawStars(ctx, t);
  titleBattle(ctx, t);

  glowText(ctx, "YOU'RE INVITED!", W / 2, 420, 50, '#ff3df0', 22);
  glowText(ctx, 'TO A CORTEX CLASH DUEL', W / 2, 505, 22, 'rgba(232,246,255,0.7)', 6);

  glowText(ctx, 'ROOM', W / 2, 650, 22, '#ffd23f', 8);
  const bw = 150, gap = 26;
  drawCodeBoxes(ctx, code, W / 2 - (4 * bw + 3 * gap) / 2, 700, bw, 180, gap, '#ff3df0', t, false);

  const st = (NET.S.mode === 'guest' && NET.S.status) || 'CONNECTING';
  const busy = st.indexOf('CONNECT') === 0 || st.indexOf('RECONNECT') === 0;
  const dots = busy ? '.'.repeat(1 + (Math.floor(t * 2) % 3)) : '';
  glowText(ctx, st + dots, W / 2, 985, 22, busy ? '#52ff9d' : '#ff5566', 8);
  glowText(ctx, busy ? 'YOU ARE PLAYER 2 — DROPPING IN…' : 'TAP CANCEL AND TRY THE LINK AGAIN', W / 2, 1075, 18, 'rgba(232,246,255,0.6)', 5);

  drawBigBtn(ctx, W / 2 - 240, 1500, 480, 104, 'CANCEL', '#ff5566', t, true, 22);
  UI.buttons.push({ x: W / 2 - 240, y: 1500, w: 480, h: 104, action: ACTIONS.cancelOnline });

  scanlines(ctx);
}

Object.assign(window, { W, H, CELL, BX, BY, PLAYER_COLORS, drawGame, drawDragTrail, drawSplitUI, drawTitle, drawPicker, drawLobby, drawJoin, drawInvite, drawOverlayMsg });
