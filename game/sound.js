// Cortex Clash — retro WebAudio bleeps
'use strict';
const SFX = (() => {
  let ctx = null, master = null, muted = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, dur, type, vol, slideTo, when) {
    if (muted || !ctx) return;
    type = type || 'square'; vol = vol || 0.5; when = when || 0;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }

  function noise(dur, vol, when) {
    if (muted || !ctx) return;
    when = when || 0;
    const len = Math.max(1, (dur * ctx.sampleRate) | 0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g); g.connect(master);
    src.start(ctx.currentTime + when);
  }

  // ---------- 80s chiptune menu loop ----------
  // A driving I–V–vi–IV synthwave progression: triangle bass, square arp,
  // square lead hook, and noise/sine drums, scheduled ahead on the WebAudio
  // clock so it stays locked even when the main rAF loop hitches.
  const NF = (() => {
    // equal-tempered note frequencies for the octaves we use
    const names = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
    const t = {};
    for (let oct = 2; oct <= 6; oct++) {
      for (let i = 0; i < 12; i++) {
        const midi = (oct + 1) * 12 + i;
        t[names[i] + oct] = 440 * Math.pow(2, (midi - 69) / 12);
      }
    }
    return t;
  })();
  const M_BPM = 128, M_SP = 60 / M_BPM / 2;          // eighth-note seconds
  const M_PROG = ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G'];
  const M_CH = { C: ['C4', 'E4', 'G4', 'C5'], G: ['G3', 'B3', 'D4', 'G4'], Am: ['A3', 'C4', 'E4', 'A4'], F: ['F3', 'A3', 'C4', 'F4'] };
  const M_BASS = { C: 'C2', G: 'G2', Am: 'A2', F: 'F2' };
  // catchy lead hook over the 8-bar form (0 = rest), 8 eighths per bar
  const M_LEAD = [
    'E5', 0, 'G5', 'E5', 0, 'C5', 'D5', 'E5',   // C
    'D5', 0, 'B4', 'D5', 0, 'G4', 'A4', 'B4',   // G
    'C5', 0, 'E5', 'C5', 0, 'A4', 'B4', 'C5',   // Am
    'D5', 'C5', 'A4', 0, 'F4', 'A4', 'C5', 0,   // F
    'E5', 0, 'G5', 'E5', 0, 'C5', 'D5', 'E5',   // C
    'D5', 0, 'B4', 'D5', 0, 'G4', 'A4', 'B4',   // G
    'A4', 'C5', 'F5', 'E5', 'D5', 'C5', 'A4', 0, // F
    'G4', 'B4', 'D5', 'G5', 'D5', 'B4', 'G4', 0, // G turnaround
  ];
  const M_STEPS = M_LEAD.length;
  let musicGain = null, musicOn = false, musicTimer = null, mNext = 0, mStep = 0;

  function mGain() {
    if (!musicGain && ctx) { musicGain = ctx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(ctx.destination); }
    return musicGain;
  }
  function mNote(freq, dur, type, vol, time, slideTo) {
    const mg = mGain(); if (!mg || !freq) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), time + dur);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, time + dur);
    o.connect(g); g.connect(mg);
    o.start(time); o.stop(time + dur + 0.03);
  }
  function mDrum(dur, vol, time, hp) {
    const mg = mGain(); if (!mg) return;
    const len = Math.max(1, (dur * ctx.sampleRate) | 0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = vol;
    if (hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; src.connect(f); f.connect(g); }
    else src.connect(g);
    g.connect(mg); src.start(time); src.stop(time + dur + 0.02);
  }
  function mSchedule(s, time) {
    const inBar = s % 8;
    const chord = M_PROG[(s / 8 | 0) % M_PROG.length];
    const bass = NF[M_BASS[chord]];
    mNote(inBar % 2 === 0 ? bass : bass * 2, M_SP * 0.9, 'triangle', 0.42, time);   // octave-bounce bass
    const arp = M_CH[chord];                                                          // square arp (two 16ths)
    mNote(NF[arp[inBar % arp.length]], M_SP * 0.45, 'square', 0.15, time);
    mNote(NF[arp[(inBar + 2) % arp.length]], M_SP * 0.45, 'square', 0.13, time + M_SP / 2);
    if (M_LEAD[s]) mNote(NF[M_LEAD[s]], M_SP * 0.95, 'square', 0.5, time);            // lead hook
    if (inBar === 0 || inBar === 4) mNote(72, 0.12, 'sine', 0.6, time, 40);           // kick
    if (inBar === 2 || inBar === 6) mDrum(0.13, 0.32, time, 1200);                    // snare
    mDrum(0.03, inBar % 2 ? 0.10 : 0.05, time + (inBar % 2 ? 0 : M_SP / 2), 7000);    // hat
  }
  function mTick() {
    if (!musicOn || !ctx || muted || ctx.state !== 'running') { if (ctx) mNext = ctx.currentTime + 0.1; return; }
    while (mNext < ctx.currentTime + 0.18) {
      mSchedule(mStep, mNext);
      mNext += M_SP;
      mStep = (mStep + 1) % M_STEPS;
    }
  }

  return {
    ensure,
    isMuted: () => muted,
    toggleMute: () => { muted = !muted; if (!muted) { ensure(); tone(660, 0.06, 'square', 0.4); } return muted; },
    music: {
      start: () => { if (musicOn) return; ensure(); musicOn = true; mStep = 0; if (ctx) mNext = ctx.currentTime + 0.1; if (!musicTimer) musicTimer = setInterval(mTick, 35); },
      stop: () => { if (!musicOn && !musicTimer) return; musicOn = false; if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } },
    },
    cursor:  () => { ensure(); tone(520, 0.05, 'square', 0.3); },
    select:  () => { ensure(); tone(660, 0.06, 'square', 0.45); tone(990, 0.08, 'square', 0.45, null, 0.05); },
    deny:    () => { ensure(); tone(150, 0.16, 'sawtooth', 0.5, 110); },
    // launch: a quick upward zap — heavier pieces launch with a lower, beefier whoosh
    launch:  (v) => { ensure(); v = v || 3; tone(300 + (7 - v) * 70, 0.10, 'triangle', 0.45, 720 + (7 - v) * 80); tone(150 + v * 30, 0.06, 'square', 0.16); },
    // combine: ascending arpeggio, more notes for bigger merges
    combine: (v) => { ensure(); v = v || 3; const base = [330, 415, 494, 622, 740, 880]; const n = Math.min(6, Math.max(2, v | 0)); for (let i = 0; i < n; i++) tone(base[i], 0.08, 'square', 0.4, null, i * 0.05); },
    split:   () => { ensure(); tone(660, 0.07, 'square', 0.45); tone(440, 0.1, 'square', 0.45, null, 0.07); tone(990, 0.06, 'sine', 0.25, null, 0.02); },
    // hit: defender holds — metallic clash. Body tone deepens with attacker value,
    // a high zing reflects the defender's value.
    hit:     (av, dv) => { ensure(); av = av || 3; dv = dv || 3; noise(0.07, 0.32); tone(520 - av * 40, 0.10, 'sawtooth', 0.5, 180); tone(900 + dv * 40, 0.05, 'square', 0.22, null, 0.02); },
    // boom: a kill — explosion scaled by the destroyed piece's value
    boom:    (v) => { ensure(); v = v || 3; noise(0.22 + v * 0.03, 0.55 + v * 0.03); tone(180 - v * 14, 0.30 + v * 0.02, 'sawtooth', 0.55, 36); tone(Math.max(40, 90 - v * 5), 0.34, 'sine', 0.4, 30, 0.01); },
    // shieldBlock: bright shimmer + descending absorb
    shieldBlock: () => { ensure(); tone(1320, 0.05, 'sine', 0.4, 1760); tone(880, 0.18, 'triangle', 0.4, 330, 0.03); noise(0.05, 0.14, 0.02); },
    power:   () => { ensure(); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.08, 'square', 0.4, null, i * 0.05)); },
    spawn:   () => { ensure(); tone(880, 0.07, 'sine', 0.3, 1320); },
    drain:   () => { ensure(); tone(196, 0.06, 'square', 0.18, 160); },
    alarm:   () => { ensure(); tone(880, 0.1, 'square', 0.4, 440); tone(880, 0.1, 'square', 0.4, 440, 0.16); },
    // castle under attack: a louder, more urgent rising klaxon. urgent=1 adds a top siren.
    underAttack: (urgent) => { ensure(); tone(420, 0.14, 'sawtooth', 0.62, 700); tone(620, 0.14, 'sawtooth', 0.62, 920, 0.11); if (urgent) { tone(960, 0.12, 'square', 0.55, 480, 0.22); noise(0.05, 0.2, 0.22); } },
    fanfare: () => { ensure(); [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, 'square', 0.5, null, i * 0.11)); },
  };
})();
window.SFX = SFX;
