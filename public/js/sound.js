// Lightweight sound effects for 飞机棋, synthesized entirely with the Web
// Audio API — no audio files to load or license. Effects are short
// oscillator/noise bursts shaped with a gain envelope.

(function () {
  const STORAGE_KEY = 'afc_muted';
  let ctx = null;
  let muted = localStorage.getItem(STORAGE_KEY) === '1';

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, duration, opts) {
    if (muted) return;
    const ac = getCtx();
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = (opts && opts.type) || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts && opts.sweepTo) {
      osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + duration);
    }
    const gain = ac.createGain();
    const peak = (opts && opts.gain) || 0.2;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + ((opts && opts.attack) || 0.006));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function noiseBurst(duration, opts) {
    if (muted) return;
    const ac = getCtx();
    const t0 = ac.currentTime;
    const size = Math.max(1, Math.floor(ac.sampleRate * duration));
    const buffer = ac.createBuffer(1, size, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = (opts && opts.filterType) || 'lowpass';
    filter.frequency.value = (opts && opts.filterFreq) || 800;
    const gain = ac.createGain();
    gain.gain.setValueAtTime((opts && opts.gain) || 0.3, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start(t0);
  }

  const Sound = {
    isMuted() { return muted; },
    setMuted(v) {
      muted = v;
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
    },
    roll() {
      for (let i = 0; i < 3; i++) {
        setTimeout(() => noiseBurst(0.035, { filterFreq: 2600, gain: 0.14 }), i * 65);
      }
    },
    launch() {
      tone(220, 0.18, { type: 'triangle', sweepTo: 660, gain: 0.14 });
    },
    move() {
      tone(480, 0.07, { type: 'sine', gain: 0.09 });
    },
    jump() {
      tone(392, 0.08, { type: 'square', sweepTo: 587, gain: 0.11 });
      setTimeout(() => tone(587, 0.1, { type: 'square', sweepTo: 880, gain: 0.11 }), 70);
    },
    capture() {
      noiseBurst(0.22, { filterFreq: 400, gain: 0.32 });
      tone(130, 0.2, { type: 'sawtooth', sweepTo: 55, gain: 0.18 });
    },
    gasShortcut() {
      tone(300, 0.35, { type: 'sawtooth', sweepTo: 1300, gain: 0.14 });
    },
    home() {
      tone(523.25, 0.12, { type: 'sine', gain: 0.15 });
      setTimeout(() => tone(783.99, 0.18, { type: 'sine', gain: 0.15 }), 100);
    },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        setTimeout(() => tone(f, 0.25, { type: 'triangle', gain: 0.17 }), i * 140);
      });
    },
  };

  window.AirplaneSound = Sound;

  // Browsers require an AudioContext to be created/resumed as a direct
  // result of a user gesture. Our actual sound triggers fire later (after
  // a server round-trip), so prime the context on the very first click
  // anywhere on the page.
  document.addEventListener('click', getCtx, { once: true });
})();
