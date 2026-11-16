// A quiet generated soundscape: wind in the canopy, rain, and water dripping into a buried jar (suikinkutsu).

export function createAmbience() {
  let ctx = null, master, rainGain, wet, on = false, timer = 0;

  const noise = (brown) => {
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.start();
    return src;
  };

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);

    // wind
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const windGain = ctx.createGain(); windGain.gain.value = 0.10;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.045;
    lfo.connect(lfoAmt).connect(windGain.gain); lfo.start();
    noise(true).connect(lp).connect(windGain).connect(master);

    // rain
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1700;
    const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 8500;
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    noise(false).connect(hp).connect(rl).connect(rainGain).connect(master);

    // resonance for the drips
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.29;
    const fb = ctx.createGain(); fb.gain.value = 0.36;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2600;
    wet = ctx.createGain(); wet.gain.value = 0.5;
    wet.connect(delay); delay.connect(damp).connect(fb).connect(delay); damp.connect(master);
  }

  const SCALE = [587.33, 622.25, 783.99, 880.0, 932.33, 1174.66, 1244.51, 1567.98];   // D in-scale
  function drip() {
    if (!on) return;
    const t = ctx.currentTime + 0.05;
    const f = SCALE[Math.floor(Math.random() * SCALE.length)];
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(f * 1.03, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const g = ctx.createGain();
    const peak = 0.04 + Math.random() * 0.06;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    osc.connect(g); g.connect(master); g.connect(wet);
    osc.start(t); osc.stop(t + 1.7);
    timer = setTimeout(drip, 1800 + Math.random() * 6000);
  }

  return {
    get enabled() { return on; },
    setEnabled(v) {
      if (v && !ctx) build();
      if (!ctx) return;
      on = v;
      if (v) ctx.resume();
      master.gain.setTargetAtTime(v ? 0.9 : 0, ctx.currentTime, 0.4);
      clearTimeout(timer);
      if (v) timer = setTimeout(drip, 1200);
    },
    setRain(x) { if (ctx) rainGain.gain.setTargetAtTime(x * 0.15, ctx.currentTime, 0.3); },
  };
}
