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

function px(c) { return BX + c * CELL; }
function py(r) { return BY + r * CELL; }

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
  const flipNum = (window.NET && NET.active()) ? NET.S.view === 1 : k.owner === 1;
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
function drawToken(ctx, g, p, t) {
  const [bc, br] = piecePos(p);
  const cx = BX + bc * CELL + CELL / 2;
  const cy = BY + br * CELL + CELL / 2;
  const col = PLAYER_COLORS[p.owner];
  const sel = g.sel[p.owner] === p.id;
  const boosted = p.boostUntil > g.time;
  // heavier pieces are physically bigger and squarer; runts are small and round
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

  ctx.save();
  ctx.translate(cx, cy);
  // local face-to-face: flip P2's tokens. Online: each device reads upright
  // (guest's whole view is already rotated, so re-flip every token there).
  const net = window.NET && NET.active();
  const flipTok = net ? NET.S.view === 1 : p.owner === 1;
  if (flipTok) ctx.rotate(Math.PI);
  const bob = p.path ? 0 : Math.sin(t * 2.2 + p.id) * 2;
  ctx.translate(0, bob);

  // speed-boost aura: rotating dashed ring
  if (boosted) {
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
  ctx.shadowBlur = (sel ? 26 : 14) * window.TWEAKS.glow;
  ctx.fillStyle = PLAYER_DARK[p.owner];
  rr(ctx, -size / 2, -size / 2, size, size, rad);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = sel ? 6 : (p.value >= 5 ? 5 : 4);
  ctx.stroke();
  ctx.shadowBlur = 0;

  const ey = -size * 0.32;
  if (p.value === 3) { // visor band
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

  if (p.value === 1) { // speedster cheek dashes
    ctx.fillStyle = col;
    ctx.fillRect(-size / 2 + 4, ey + 18, 10, 4);
    ctx.fillRect(size / 2 - 14, ey + 18, 10, 4);
  }
  if (p.value === 2) { // antenna
    ctx.fillStyle = col;
    ctx.fillRect(-3, -size / 2 - 10, 6, 12);
    ctx.fillRect(-7, -size / 2 - 18, 14, 9);
  }
  if (p.value >= 4) { // brows — angrier with weight
    const tilt = 0.2 + (p.value - 4) * 0.12;
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
  if (p.value >= 5) { // armor side plates
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(-size / 2 + 5, -4, 8, size * 0.4);
    ctx.fillRect(size / 2 - 13, -4, 8, size * 0.4);
  }
  if (p.value === 6) { // rivets
    ctx.fillStyle = col;
    ctx.fillRect(-size / 2 + 9, size / 2 - 15, 7, 7);
    ctx.fillRect(size / 2 - 16, size / 2 - 15, 7, 7);
  }

  // number — gold when permanently charged by a +2 power-up
  ctx.font = (20 + p.value * 2) + 'px ' + FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (p.charged) {
    ctx.fillStyle = '#ffd23f';
    ctx.shadowColor = '#ffd23f';
    ctx.shadowBlur = 10 * window.TWEAKS.glow;
  } else {
    ctx.fillStyle = '#ffffff';
  }
  ctx.fillText(String(p.value), 0, size * 0.18);
  ctx.shadowBlur = 0;
  if (p.charged) { // little charge spark
    ctx.fillStyle = '#ffd23f';
    drawPowerGlyph(ctx, 'charge', -size / 2 + 16, -size / 2 + 12, 16);
  }

  if (p.shield) {
    ctx.strokeStyle = '#e8f6ff';
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(t * 5);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, size / 2 + 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (boosted) {
    ctx.fillStyle = '#ffd23f';
    ctx.shadowColor = '#ffd23f';
    ctx.shadowBlur = 8;
    drawPowerGlyph(ctx, 'bolt', size / 2 - 6, -size / 2 + 6, 20);
  }
  ctx.restore();

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
function drawFx(ctx, g) {
  for (const f of g.fx) {
    const cx = px(f.c) + CELL / 2, cy = py(f.r) + CELL / 2;
    const col = f.owner != null ? PLAYER_COLORS[f.owner] : '#ffffff';
    const k = f.t / 0.8;
    ctx.save();
    if (f.type === 'boom') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + f.c * 3 + f.r;
        const d = 14 + k * 90;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = i % 2 ? col : '#ffd23f';
        const s = 12 * (1 - k) + 3;
        ctx.fillRect(cx + Math.cos(a) * d - s / 2, cy + Math.sin(a) * d - s / 2, s, s);
      }
    } else if (f.type === 'ring' || f.type === 'power' || f.type === 'shield') {
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.type === 'shield' ? '#e8f6ff' : col;
      ctx.lineWidth = 6 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 20 + k * 70, 0, Math.PI * 2);
      ctx.stroke();
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

// ---------- screens ----------
function drawGame(ctx, g, paused, t) {
  ctx.save();
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, W, H);
  // online guest sees the whole board rotated 180° so their side is at the bottom
  if (window.NET && NET.S.view === 1) { ctx.translate(W, H); ctx.rotate(Math.PI); }
  if (g.shake > 0) ctx.translate((Math.random() - 0.5) * 8 * g.shake, (Math.random() - 0.5) * 8 * g.shake);

  drawBoard(ctx, g);
  drawLegal(ctx, g, t);
  for (const u of g.powerups) drawPowerup(ctx, u, t);
  for (const k of g.castles) drawCastle(ctx, g, k, t);
  const moving = g.pieces.filter((p) => p.path);
  const still = g.pieces.filter((p) => !p.path);
  for (const p of still) drawToken(ctx, g, p, t);
  for (const p of moving) drawToken(ctx, g, p, t);
  drawFx(ctx, g);

  // bottom HUD (player 0)
  ctx.save();
  ctx.translate(0, H - HUD_H);
  drawHud(ctx, g, 0, t, false);
  ctx.restore();

  // top HUD (player 1) — rotated 180 so it reads from their side
  ctx.save();
  ctx.translate(W, HUD_H);
  ctx.rotate(Math.PI);
  drawHud(ctx, g, 1, t, true);
  ctx.restore();

  ctx.restore();

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
  const flipTok = (window.NET && NET.active()) ? NET.S.view === 1 : su.pl === 1;

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
  for (let i = 0; i < 70; i++) {
    const x = (i * 197) % W, y = (i * 397) % H;
    const tw = 0.25 + 0.5 * Math.abs(Math.sin(t * 1.5 + i));
    ctx.fillStyle = 'rgba(170,200,255,' + tw + ')';
    ctx.fillRect(x, y, 3, 3);
  }
}

// ---------- ambient battle behind the title logo ----------
const TFX = { tokens: [], booms: [], spawnT: 0, lastT: 0 };
const TFX_LANES = [115, 205, 295, 385, 470];

function titleBattle(ctx, t) {
  const dt = Math.min(0.05, Math.max(0, t - TFX.lastT));
  TFX.lastT = t;

  TFX.spawnT -= dt;
  if (TFX.spawnT <= 0 && TFX.tokens.length < 7) {
    TFX.spawnT = 0.9 + Math.random() * 1.4;
    const owner = Math.random() < 0.5 ? 0 : 1;       // 0 cyan from left, 1 magenta from right
    const v = 1 + ((Math.random() * 6) | 0);
    TFX.tokens.push({
      owner, v,
      x: owner === 0 ? -50 : W + 50,
      y: TFX_LANES[(Math.random() * TFX_LANES.length) | 0] + (Math.random() * 24 - 12),
      vx: (owner === 0 ? 1 : -1) * (60 + (7 - v) * 38),
    });
  }

  for (const k of TFX.tokens) k.x += k.vx * dt;

  // clashes: opposing tokens in the same lane collide; bigger one survives
  for (const a of TFX.tokens) {
    for (const b of TFX.tokens) {
      if (a === b || a.owner === b.owner || a.dead || b.dead) continue;
      if (Math.abs(a.y - b.y) < 40 && Math.abs(a.x - b.x) < 44) {
        const [w, l] = a.v >= b.v ? [a, b] : [b, a];
        l.dead = true;
        w.v -= l.v;
        if (w.v <= 0) w.dead = true;
        TFX.booms.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: 0, owner: l.owner });
      }
    }
  }
  TFX.tokens = TFX.tokens.filter((k) => !k.dead && k.x > -80 && k.x < W + 80);
  for (const bm of TFX.booms) bm.t += dt;
  TFX.booms = TFX.booms.filter((bm) => bm.t < 0.6);

  ctx.save();
  ctx.globalAlpha = 0.55;
  for (const k of TFX.tokens) {
    const s = 36 + k.v * 5;
    const col = PLAYER_COLORS[k.owner];
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 10 * window.TWEAKS.glow;
    ctx.fillStyle = PLAYER_DARK[k.owner];
    rr(ctx, k.x - s / 2, k.y - s / 2, s, s, 10);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    rr(ctx, k.x - s / 2, k.y - s / 2, s, s, 10);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = col;
    ctx.font = (14 + k.v * 2) + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(k.v), k.x, k.y + 2);
    ctx.restore();
  }
  for (const bm of TFX.booms) {
    const p = bm.t / 0.6;
    ctx.save();
    ctx.globalAlpha = 0.8 * (1 - p);
    ctx.strokeStyle = PLAYER_COLORS[bm.owner];
    ctx.lineWidth = 4 * (1 - p) + 1;
    ctx.beginPath();
    ctx.arc(bm.x, bm.y, 8 + p * 52, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + bm.t * 3;
      ctx.fillRect(bm.x + Math.cos(a) * p * 44 - 2, bm.y + Math.sin(a) * p * 44 - 2, 4, 4);
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawTitle(ctx, boardIdx, t) {
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, W, H);

  drawStars(ctx, t);
  titleBattle(ctx, t);

  glowText(ctx, 'HUMANS · CPUS · LLMS', W / 2, 130, 20, '#aebcff', 8);
  // logo with chromatic offsets
  ctx.save();
  ctx.globalAlpha = 0.6;
  glowText(ctx, 'CORTEX', W / 2 - 5, 235, 92, '#ff3df0', 2);
  glowText(ctx, 'CLASH', W / 2 - 5, 355, 92, '#ff3df0', 2);
  ctx.restore();
  glowText(ctx, 'CORTEX', W / 2 + 3, 238, 92, '#19e6ff', 26);
  glowText(ctx, 'CLASH', W / 2 + 3, 358, 92, '#19e6ff', 26);
  glowText(ctx, 'REAL-TIME NUMBER COMBAT', W / 2, 445, 19, 'rgba(232,246,255,0.65)', 6);

  glowText(ctx, 'CHOOSE ARENA', W / 2, 540, 24, '#ffd23f', 10);

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
  ctx.fillText('LLM MODES NEED YOUR OWN API KEY', W / 2, y + 96 + 24);

  scanlines(ctx);
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
  const waiting = st.indexOf('WAITING') === 0 || st.indexOf('OPENING') === 0;
  const dots = waiting ? '.'.repeat(1 + (Math.floor(t * 2) % 3)) : '';
  glowText(ctx, st + dots, W / 2, 725, 20, waiting ? '#52ff9d' : '#ff5566', 8);

  ['PLAYER 2: OPEN THIS GAME,', 'TAP "JOIN ONLINE"', 'AND ENTER THE CODE'].forEach((l, i) => {
    glowText(ctx, l, W / 2, 850 + i * 52, 19, 'rgba(232,246,255,0.75)', 5);
  });

  const bw2 = 560, bh2 = 104;
  drawBigBtn(ctx, W / 2 - bw2 / 2, 1075, bw2, bh2, 'COPY INVITE LINK', '#19e6ff', t, true, 22);
  UI.buttons.push({ x: W / 2 - bw2 / 2, y: 1075, w: bw2, h: bh2, action: ACTIONS.copyLink });
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
  const busy = st.indexOf('CONNECT') === 0;
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

Object.assign(window, { W, H, CELL, BX, BY, PLAYER_COLORS, drawGame, drawSplitUI, drawTitle, drawPicker, drawLobby, drawJoin, drawOverlayMsg });
