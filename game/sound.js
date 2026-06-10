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
    launch:  (v) => { ensure(); tone(260 + v * 55, 0.12, 'triangle', 0.5, 620); },
    combine: () => { ensure(); tone(440, 0.07, 'square', 0.45); tone(554, 0.07, 'square', 0.45, null, 0.06); tone(660, 0.1, 'square', 0.45, null, 0.12); },
    split:   () => { ensure(); tone(660, 0.07, 'square', 0.45); tone(440, 0.1, 'square', 0.45, null, 0.07); },
    hit:     () => { ensure(); tone(220, 0.12, 'sawtooth', 0.6, 80); noise(0.08, 0.3); },
    boom:    () => { ensure(); noise(0.32, 0.7); tone(120, 0.3, 'sawtooth', 0.55, 40); },
    power:   () => { ensure(); [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.08, 'square', 0.4, null, i * 0.06)); },
    spawn:   () => { ensure(); tone(880, 0.07, 'sine', 0.3, 1320); },
    drain:   () => { ensure(); tone(196, 0.06, 'square', 0.18, 160); },
    alarm:   () => { ensure(); tone(880, 0.1, 'square', 0.4, 440); tone(880, 0.1, 'square', 0.4, 440, 0.16); },
    fanfare: () => { ensure(); [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, 'square', 0.5, null, i * 0.11)); },
  };
})();
window.SFX = SFX;
