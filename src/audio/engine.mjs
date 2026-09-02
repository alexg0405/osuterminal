// audio engine. music plus hitsounds, mixed here rather than by the OS.
//
// the old version handed the whole song to waveOut as one buffer. the clock was good
// but you can't do hitsounds that way, because waveOut plays queued buffers one after
// another instead of mixing them. hitsounds also fire when you click, not at a time we
// know in advance, so they have to be mixed in live.
//
// so instead there's a ring of small buffers. refill each one when the device finishes
// with it, and add up music plus whatever samples are playing. the clock prefers
// waveOutGetPosition (TIME_SAMPLES, then TIME_BYTES) so judgement tracks the hardware.
// if the device never actually starts — some drivers do this for odd formats, or if
// WHDR_DONE never comes back and the ring underruns — we fall back to the wall clock
// so the countdown can't freeze on frame one.

import koffi from 'koffi';

const winmm = koffi.load('winmm.dll');

const waveOutOpen = winmm.func(
  'uint __stdcall waveOutOpen(_Out_ void **phwo, uint uDeviceID, void *pwfx, void *cb, size_t inst, uint flags)');
const waveOutPrepareHeader   = winmm.func('uint __stdcall waveOutPrepareHeader(void *hwo, void *pwh, uint cb)');
const waveOutUnprepareHeader = winmm.func('uint __stdcall waveOutUnprepareHeader(void *hwo, void *pwh, uint cb)');
const waveOutWrite           = winmm.func('uint __stdcall waveOutWrite(void *hwo, void *pwh, uint cb)');
const waveOutGetPosition     = winmm.func('uint __stdcall waveOutGetPosition(void *hwo, void *pmmt, uint cb)');
const waveOutReset           = winmm.func('uint __stdcall waveOutReset(void *hwo)');
const waveOutClose           = winmm.func('uint __stdcall waveOutClose(void *hwo)');
const waveOutPause           = winmm.func('uint __stdcall waveOutPause(void *hwo)');
const waveOutRestart         = winmm.func('uint __stdcall waveOutRestart(void *hwo)');
const waveOutGetErrorText    = winmm.func('uint __stdcall waveOutGetErrorTextA(uint err, _Out_ char *buf, uint cch)');

const WAVE_MAPPER           = 0xffffffff;
const CALLBACK_FUNCTION     = 0x00030000;
const TIME_MS               = 0x0001;
const TIME_SAMPLES          = 0x0002;
const TIME_BYTES            = 0x0004;
const MMTIME_SIZE           = 12;

const PTR                   = process.arch === 'ia32' ? 4 : 8;
const WAVEHDR_SIZE          = PTR === 8 ? 48 : 32;
const LEN_OFFSET            = PTR;
const FLAGS_OFFSET          = PTR === 8 ? 24 : 16;

const WHDR_DONE     = 0x01;
const WHDR_PREPARED = 0x02;

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

function check(code, what) {
  if (code === 0) return;
  const buf = Buffer.alloc(256);
  waveOutGetErrorText(code, buf, 256);
  throw new Error(`${what} failed (mmsys ${code}): ${buf.toString('latin1').split('\0')[0]}`);
}

function makeWaveFormatEx(channels, sampleRate, bitsPerSample) {
  const wfx = Buffer.alloc(20);
  const blockAlign = (channels * bitsPerSample) / 8;
  wfx.writeUInt16LE(1, 0);
  wfx.writeUInt16LE(channels, 2);
  wfx.writeUInt32LE(sampleRate, 4);
  wfx.writeUInt32LE(sampleRate * blockAlign, 8);
  wfx.writeUInt16LE(blockAlign, 12);
  wfx.writeUInt16LE(bitsPerSample, 14);
  wfx.writeUInt16LE(0, 16);
  return wfx;
}

function writeLpData(hdr, data) {
  const addr = koffi.address(data);
  if (PTR === 8) hdr.writeBigUInt64LE(BigInt(addr), 0);
  else hdr.writeUInt32LE(Number(addr), 0);
}

let WaveProc = null;
try {
  WaveProc = koffi.proto(
    'void __stdcall WaveProc(void *hwo, uint msg, size_t inst, size_t p1, size_t p2)');
} catch { /* proto unavailable, open with CALLBACK_NULL */ }

export class AudioEngine {
  #hwo = null;
  #buffers = [];
  #headers = [];
  #mmtime = Buffer.alloc(MMTIME_SIZE);
  #mix = null;
  #voices = [];
  #music = null;
  #musicFrames = 0;
  #writeFrame = 0;
  #started = false;
  #paused = false;
  #cb = null;

  #startedAt = 0;
  #pausedAt = 0;
  #pauseAccum = 0;
  #lastHwMs = 0;
  #lastHwWall = 0;
  #fallback = false;
  #posMode = 'samples';

  constructor({ sampleRate = 44100, channels = 2, bufferMs = 5, bufferCount = 8 } = {}) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.bitsPerSample = 16;
    this.bytesPerFrame = (channels * this.bitsPerSample) / 8;
    this.bufferFrames = Math.max(64, Math.round((sampleRate * bufferMs) / 1000));
    this.bufferCount = bufferCount;
    this.musicGain = 1;
    this.effectGain = 1;
    this.underruns = 0;
  }

  get queueDepthMs() { return (this.bufferFrames * this.bufferCount / this.sampleRate) * 1000; }
  get usingWallClock() { return this.#fallback; }

  open() {
    if (this.#hwo) throw new Error('already open');
    const wfx = makeWaveFormatEx(this.channels, this.sampleRate, this.bitsPerSample);
    const out = [null];

    // CALLBACK_FUNCTION makes more drivers actually set WHDR_DONE. the callback
    // itself is a no-op — refill stays on the game thread so mixing isn't racy.
    let opened = false;
    if (WaveProc) {
      try {
        this.#cb = koffi.register(() => {}, WaveProc);
        check(waveOutOpen(out, WAVE_MAPPER, wfx, this.#cb, 0, CALLBACK_FUNCTION), 'waveOutOpen');
        opened = true;
      } catch {
        try { if (this.#cb) koffi.unregister(this.#cb); } catch {}
        this.#cb = null;
      }
    }
    if (!opened) {
      check(waveOutOpen(out, WAVE_MAPPER, wfx, null, 0, 0), 'waveOutOpen');
    }
    this.#hwo = out[0];

    const bytes = this.bufferFrames * this.bytesPerFrame;
    for (let i = 0; i < this.bufferCount; i++) {
      const data = Buffer.alloc(bytes);
      const hdr = Buffer.alloc(WAVEHDR_SIZE);
      writeLpData(hdr, data);
      hdr.writeUInt32LE(bytes, LEN_OFFSET);
      check(waveOutPrepareHeader(this.#hwo, hdr, WAVEHDR_SIZE), 'waveOutPrepareHeader');
      this.#buffers.push(data);
      this.#headers.push(hdr);
    }
    this.#mix = new Float32Array(this.bufferFrames * this.channels);
    return this;
  }

  setMusic(pcm) {
    this.#music = pcm;
    this.#musicFrames = pcm.length / this.bytesPerFrame;
    return this;
  }

  start() {
    if (this.#started) return this;
    this.#started = true;
    this.#startedAt = nowMs();
    this.#lastHwWall = this.#startedAt;
    // do not pause before the first write. some drivers then ignore Restart and
    // GetPosition stays at 0 forever. first Write starts playback; a couple of
    // ms of race on the first buffer is swallowed by the lead-in silence.
    for (let i = 0; i < this.bufferCount; i++) this.#fillAndSubmit(i);
    return this;
  }

  pump() {
    if (!this.#started || this.#paused) return;
    let done = 0;
    for (let i = 0; i < this.bufferCount; i++) {
      const flags = this.#headers[i].readUInt32LE(FLAGS_OFFSET);
      // WHDR_DONE is the only bit we can trust. some drivers leave INQUEUE set
      // after finishing, and skipping those starves the ring and freezes the clock.
      if (!(flags & WHDR_DONE)) continue;
      done++;
      this.#fillAndSubmit(i);
    }
    if (done === this.bufferCount) this.underruns++;
  }

  #fillAndSubmit(i) {
    this.#fill(this.#buffers[i]);
    const hdr = this.#headers[i];
    hdr.writeUInt32LE(WHDR_PREPARED, FLAGS_OFFSET);
    check(waveOutWrite(this.#hwo, hdr, WAVEHDR_SIZE), 'waveOutWrite');
  }

  #fill(dest) {
    const n = this.bufferFrames, ch = this.channels, mix = this.#mix;
    mix.fill(0);

    const music = this.#music;
    if (music) {
      const start = this.#writeFrame;
      const avail = Math.max(0, Math.min(n, this.#musicFrames - start));
      const g = this.musicGain;
      for (let f = 0; f < avail; f++) {
        const src = (start + f) * ch * 2;
        for (let c = 0; c < ch; c++) mix[f * ch + c] += music.readInt16LE(src + c * 2) * g;
      }
    }

    const g = this.effectGain;
    for (let v = this.#voices.length - 1; v >= 0; v--) {
      const voice = this.#voices[v];
      const { pcm, vch } = voice;
      const total = pcm.length / vch;
      const gain = voice.gain * g;
      let pos = voice.pos;
      const take = Math.min(n, total - pos);
      for (let f = 0; f < take; f++) {
        const s = (pos + f) * vch;
        if (vch === ch) for (let c = 0; c < ch; c++) mix[f * ch + c] += pcm[s + c] * gain;
        else {
          const mono = vch === 1 ? pcm[s] : (pcm[s] + pcm[s + 1]) / 2;
          for (let c = 0; c < ch; c++) mix[f * ch + c] += mono * gain;
        }
      }
      voice.pos = pos + take;
      if (voice.pos >= total) this.#voices.splice(v, 1);
    }

    for (let k = 0; k < n * ch; k++) {
      let s = mix[k];
      if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
      dest.writeInt16LE(s | 0, k * 2);
    }

    this.#writeFrame += n;
  }

  playSample(sample, gain = 1) {
    if (!sample?.pcm?.length) return;
    if (this.#voices.length > 24) this.#voices.shift();
    this.#voices.push({ pcm: sample.pcm, vch: sample.channels, pos: 0, gain });
  }

  get activeVoices() { return this.#voices.length; }

  #query(type) {
    this.#mmtime.writeUInt32LE(type, 0);
    const code = waveOutGetPosition(this.#hwo, this.#mmtime, MMTIME_SIZE);
    if (code !== 0) return null;
    if (this.#mmtime.readUInt32LE(0) !== type) return null;
    return this.#mmtime.readUInt32LE(4);
  }

  positionSamples() {
    if (this.#posMode === 'samples') {
      const s = this.#query(TIME_SAMPLES);
      if (s !== null) return s;
      this.#posMode = 'bytes';
    }
    if (this.#posMode === 'bytes') {
      const b = this.#query(TIME_BYTES);
      if (b !== null) return Math.floor(b / this.bytesPerFrame);
      this.#posMode = 'ms';
    }
    if (this.#posMode === 'ms') {
      const ms = this.#query(TIME_MS);
      if (ms !== null) return Math.floor((ms / 1000) * this.sampleRate);
    }
    return 0;
  }

  #wallMs() {
    const t = this.#paused ? this.#pausedAt : nowMs();
    return Math.max(0, t - this.#startedAt - this.#pauseAccum);
  }

  #armFallback(fromMs) {
    this.#fallback = true;
    this.#posMode = 'wall';
    const wall = this.#paused ? this.#pausedAt : nowMs();
    this.#startedAt = wall - fromMs - this.#pauseAccum;
  }

  positionMs() {
    if (this.#fallback) return this.#wallMs();

    const samples = this.positionSamples();
    const hw = (samples / this.sampleRate) * 1000;
    const wall = nowMs();

    if (hw > this.#lastHwMs + 0.01) {
      this.#lastHwMs = hw;
      this.#lastHwWall = wall;
      return hw;
    }

    if (this.#paused) return this.#lastHwMs;

    const stalledFor = wall - (this.#lastHwWall || this.#startedAt);
    if (stalledFor > 120) {
      this.#armFallback(this.#lastHwMs);
      return this.#wallMs();
    }
    return this.#lastHwMs;
  }

  get durationMs() { return (this.#musicFrames / this.sampleRate) * 1000; }

  pause() {
    if (this.#paused) return;
    try { check(waveOutPause(this.#hwo), 'waveOutPause'); } catch {}
    this.#paused = true;
    this.#pausedAt = nowMs();
  }
  resume() {
    if (!this.#paused) return;
    this.#pauseAccum += nowMs() - this.#pausedAt;
    this.#paused = false;
    this.#lastHwWall = nowMs();
    try { check(waveOutRestart(this.#hwo), 'waveOutRestart'); } catch {}
  }
  get paused() { return this.#paused; }

  close() {
    if (!this.#hwo) return;
    try { waveOutReset(this.#hwo); } catch {}
    for (const hdr of this.#headers) {
      try { waveOutUnprepareHeader(this.#hwo, hdr, WAVEHDR_SIZE); } catch {}
    }
    try { waveOutClose(this.#hwo); } catch {}
    if (this.#cb) {
      try { koffi.unregister(this.#cb); } catch {}
      this.#cb = null;
    }
    this.#hwo = null;
    this.#buffers = []; this.#headers = []; this.#voices = []; this.#music = null;
  }
}
