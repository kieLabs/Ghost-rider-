export const EXTERNAL_AUDIO_CLIPS = {
  pickup: null,
  chain: null,
  hit: null,
  jump: null,
  whoosh: null,
  flame: null,
  win: null,
  lose: null
};

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.muted = false;
    this.engineStarted = false;
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineLfo = null;
    this.engineFilter = null;
    this.engineGain = null;
    this.noiseBuffer = null;
    this.externalBuffers = new Map();
  }

  initOnGesture() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.55;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this._createNoiseBuffer();
      this._preloadExternalClips();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  async _preloadExternalClips() {
    for (const [key, url] of Object.entries(EXTERNAL_AUDIO_CLIPS)) {
      if (!url) continue;
      try {
        const res = await fetch(url);
        const arr = await res.arrayBuffer();
        const decoded = await this.ctx.decodeAudioData(arr);
        this.externalBuffers.set(key, decoded);
      } catch {
        // Fallback procedural synth handles playback automatically
      }
    }
  }

  _createNoiseBuffer() {
    const length = this.ctx.sampleRate * 1.5;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  setMuted(mute) {
    this.muted = Boolean(mute);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.04);
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  startEngine() {
    this.initOnGesture();
    if (!this.ctx || this.engineStarted) return;

    const now = this.ctx.currentTime;
    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineLfo = this.ctx.createOscillator();
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineGain = this.ctx.createGain();

    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.setValueAtTime(48, now);

    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.setValueAtTime(72, now);

    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.09;
    this.engineLfo.type = 'sine';
    this.engineLfo.frequency.setValueAtTime(11, now);
    this.engineLfo.connect(lfoGain);
    lfoGain.connect(this.engineGain.gain);

    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(240, now);

    this.engineGain.gain.setValueAtTime(0.001, now);

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOsc1.start(now);
    this.engineOsc2.start(now);
    this.engineLfo.start(now);
    this.engineStarted = true;
  }

  updateEngine(speedRatio, isBoosting, isPlaying) {
    if (!this.ctx || !this.engineStarted) return;
    const now = this.ctx.currentTime;
    if (!isPlaying) {
      this.engineGain.gain.setTargetAtTime(0.0001, now, 0.08);
      return;
    }
    const baseFreq = 44 + speedRatio * 74 + (isBoosting ? 28 : 0);
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.06);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.49, now, 0.06);
    this.engineLfo.frequency.setTargetAtTime(10 + speedRatio * 18, now, 0.06);
    this.engineFilter.frequency.setTargetAtTime(
      220 + speedRatio * 560 + (isBoosting ? 420 : 0),
      now,
      0.06
    );
    this.engineGain.gain.setTargetAtTime(isBoosting ? 0.24 : 0.14 + speedRatio * 0.06, now, 0.06);
  }

  _playExternalIfPresent(key, volume = 0.65) {
    const buf = this.externalBuffers.get(key);
    if (!buf || !this.ctx) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.masterGain);
    src.start();
    return true;
  }

  playFlameBurst() {
    this.initOnGesture();
    if (!this.ctx || this._playExternalIfPresent('flame', 0.55)) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(950, now);
    lp.frequency.exponentialRampToValueAtTime(240, now + 0.32);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.28, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    src.connect(lp).connect(g).connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.35);
  }

  playPickup() {
    this.initOnGesture();
    if (!this.ctx || this._playExternalIfPresent('pickup', 0.5)) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(580, now);
    osc.frequency.exponentialRampToValueAtTime(1180, now + 0.14);
    g.gain.setValueAtTime(0.24, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  playChainStrike() {
    this.initOnGesture();
    if (!this.ctx || this._playExternalIfPresent('chain', 0.6)) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, now);
    bp.frequency.exponentialRampToValueAtTime(420, now + 0.22);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    src.connect(bp).connect(g).connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.25);

    const metal = this.ctx.createOscillator();
    const mg = this.ctx.createGain();
    metal.type = 'square';
    metal.frequency.setValueAtTime(840, now);
    metal.frequency.exponentialRampToValueAtTime(210, now + 0.14);
    mg.gain.setValueAtTime(0.14, now);
    mg.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    metal.connect(mg).connect(this.masterGain);
    metal.start(now);
    metal.stop(now + 0.16);
  }

  playHit() {
    this.initOnGesture();
    if (!this.ctx || this._playExternalIfPresent('hit', 0.65)) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.22);
    g.gain.setValueAtTime(0.38, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  playJump() {
    this.initOnGesture();
    if (!this.ctx || this._playExternalIfPresent('jump', 0.5)) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(460, now + 0.18);
    g.gain.setValueAtTime(0.2, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  playWhoosh() {
    this.initOnGesture();
    if (!this.ctx || this._playExternalIfPresent('whoosh', 0.45)) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(320, now);
    bp.frequency.exponentialRampToValueAtTime(920, now + 0.16);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    src.connect(bp).connect(g).connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.23);
  }

  playMissionComplete() {
    this.initOnGesture();
    if (!this.ctx || this._playExternalIfPresent('win', 0.65)) return;
    const notes = [392, 493.88, 587.33, 783.99];
    const now = this.ctx.currentTime;
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);
      g.gain.setValueAtTime(0.2, now + idx * 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.35);
      osc.connect(g).connect(this.masterGain);
      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.36);
    });
  }

  playGameOver() {
    this.initOnGesture();
    if (!this.ctx || this._playExternalIfPresent('lose', 0.65)) return;
    const notes = [260, 210, 155, 110];
    const now = this.ctx.currentTime;
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      g.gain.setValueAtTime(0.22, now + idx * 0.14);
      g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.28);
      osc.connect(g).connect(this.masterGain);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.3);
    });
  }
}
