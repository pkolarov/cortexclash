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

  return {
    ensure,
    isMuted: () => muted,
    toggleMute: () => { muted = !muted; if (!muted) { ensure(); tone(660, 0.06, 'square', 0.4); } return muted; },
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
    fanfare: () => { ensure(); [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, 'square', 0.5, null, i * 0.11)); },
  };
})();
window.SFX = SFX;
