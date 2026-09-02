// audio engine. music plus hitsounds, mixed here rather than by the OS.
//
// the old version handed the whole song to waveOut as one buffer. the clock was good
// but you can't do hitsounds that way, because waveOut plays queued buffers one after
// another instead of mixing them. hitsounds also fire when you click, not at a time we
// know in advance, so they have to be mixed in live.
//
// so instead there's a ring of small buffers. refill each one when the device finishes
// with it, and add up music plus whatever samples are playing. the clock works the same
// way as before, waveOutGetPosition counts samples across the whole stream.
//
// ring size is a tradeoff. anything already queued is committed, so a new hitsound
// can't play until after all of it, which means queue depth equals hitsound latency.
// too small and a GC pause starves the device, which stalls the clock.

import koffi from 'koffi';

const winmm = koffi.load('winmm.dll');

const waveOutOpen = winmm.func(
  'uint __stdcall waveOutOpen(_Out_ void **phwo, uint uDeviceID, void *pwfx, size_t cb, size_t inst, uint flags)');
const waveOutPrepareHeader   = winmm.func('uint __stdcall waveOutPrepareHeader(void *hwo, void *pwh, uint cb)');
const waveOutUnprepareHeader = winmm.func('uint __stdcall waveOutUnprepareHeader(void *hwo, void *pwh, uint cb)');
const waveOutWrite           = winmm.func('uint __stdcall waveOutWrite(void *hwo, void *pwh, uint cb)');
const waveOutGetPosition     = winmm.func('uint __stdcall waveOutGetPosition(void *hwo, void *pmmt, uint cb)');
const waveOutReset           = winmm.func('uint __stdcall waveOutReset(void *hwo)');
const waveOutClose           = winmm.func('uint __stdcall waveOutClose(void *hwo)');
const waveOutPause           = winmm.func('uint __stdcall waveOutPause(void *hwo)');
const waveOutRestart         = winmm.func('uint __stdcall waveOutRestart(void *hwo)');
const waveOutGetErrorText    = winmm.func('uint __stdcall waveOutGetErrorTextA(uint err, _Out_ char *buf, uint cch)');

const WAVE_MAPPER  = 0xffffffff;
const TIME_SAMPLES = 0x0002;
const WAVEHDR_SIZE = 48;
const MMTIME_SIZE  = 12;

// WAVEHDR.dwFlags, at offset 24 on x64
const WHDR_DONE     = 0x01;
const WHDR_PREPARED = 0x02;
const WHDR_INQUEUE  = 0x10;
const FLAGS_OFFSET  = 24;

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

export class AudioEngine {
  #hwo = null;
  #buffers = [];      // PCM byte buffers handed to the device
  #headers = [];      // WAVEHDRs, kept prepared and reused
  #mmtime = Buffer.alloc(MMTIME_SIZE);
  #mix = null;        // Float32 accumulator, reused every fill
  #voices = [];
  #music = null;
  #musicFrames = 0;
  #writeFrame = 0;    // absolute frame index of the next frame we will generate
  #started = false;
  #paused = false;

  // total buffered audio is bufferMs * bufferCount
  constructor({ sampleRate = 44100, channels = 2, bufferMs = 5, bufferCount = 8 } = {}) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.bitsPerSample = 16;
    this.bufferFrames = Math.max(64, Math.round((sampleRate * bufferMs) / 1000));
    this.bufferCount = bufferCount;
    this.musicGain = 1;
    this.effectGain = 1;
    this.underruns = 0;
  }

  // audio already committed ahead of the play head, which is the hitsound latency
  get queueDepthMs() { return (this.bufferFrames * this.bufferCount / this.sampleRate) * 1000; }

  open() {
    if (this.#hwo) throw new Error('already open');
    const wfx = makeWaveFormatEx(this.channels, this.sampleRate, this.bitsPerSample);
    const out = [null];
    check(waveOutOpen(out, WAVE_MAPPER, wfx, 0, 0, 0), 'waveOutOpen');
    this.#hwo = out[0];

    const bytes = this.bufferFrames * this.channels * 2;
    for (let i = 0; i < this.bufferCount; i++) {
      const data = Buffer.alloc(bytes);
      const hdr = Buffer.alloc(WAVEHDR_SIZE);
      hdr.writeBigUInt64LE(BigInt(koffi.address(data)), 0);
      hdr.writeUInt32LE(bytes, 8);
      check(waveOutPrepareHeader(this.#hwo, hdr, WAVEHDR_SIZE), 'waveOutPrepareHeader');
      this.#buffers.push(data);
      this.#headers.push(hdr);
    }
    this.#mix = new Float32Array(this.bufferFrames * this.channels);
    return this;
  }

  // pcm is interleaved 16 bit at our sample rate
  setMusic(pcm) {
    this.#music = pcm;
    this.#musicFrames = pcm.length / (this.channels * 2);
    return this;
  }

  start() {
    if (this.#started) return this;
    this.#started = true;
    // pause, fill the whole ring, then start. playback begins with a full buffer so
    // the first frames can't underrun.
    check(waveOutPause(this.#hwo), 'waveOutPause');
    for (let i = 0; i < this.bufferCount; i++) this.#fillAndSubmit(i);
    check(waveOutRestart(this.#hwo), 'waveOutRestart');
    return this;
  }

  // refill whatever the device finished with. has to be called at least once per
  // ring depth of real time, which any normal frame loop does easily.
  pump() {
    if (!this.#started || this.#paused) return;
    let done = 0;
    for (let i = 0; i < this.bufferCount; i++) {
      const flags = this.#headers[i].readUInt32LE(FLAGS_OFFSET);
      if (!(flags & WHDR_DONE) || (flags & WHDR_INQUEUE)) continue;
      done++;
      this.#fillAndSubmit(i);
    }
    // every buffer finished before we got here, so the device ran dry
    if (done === this.bufferCount) this.underruns++;
  }

  #fillAndSubmit(i) {
    this.#fill(this.#buffers[i]);
    const hdr = this.#headers[i];
    // waveOutWrite needs PREPARED set and INQUEUE clear, and we clear DONE ourselves
    hdr.writeUInt32LE(WHDR_PREPARED, FLAGS_OFFSET);
    check(waveOutWrite(this.#hwo, hdr, WAVEHDR_SIZE), 'waveOutWrite');
  }

  #fill(dest) {
    const n = this.bufferFrames, ch = this.channels, mix = this.#mix;
    mix.fill(0);

    // music
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

    // samples
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
          // mono into stereo, or stereo folded down to mono
          const mono = vch === 1 ? pcm[s] : (pcm[s] + pcm[s + 1]) / 2;
          for (let c = 0; c < ch; c++) mix[f * ch + c] += mono * gain;
        }
      }
      voice.pos = pos + take;
      if (voice.pos >= total) this.#voices.splice(v, 1);
    }

    // clamp to int16
    for (let k = 0; k < n * ch; k++) {
      let s = mix[k];
      if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
      dest.writeInt16LE(s | 0, k * 2);
    }

    this.#writeFrame += n;
  }

  // play a sample. it lands at the write head, so worst case you hear it
  // queueDepthMs later.
  playSample(sample, gain = 1) {
    if (!sample?.pcm?.length) return;
    // cap this, a dense stream stacks up a lot of voices and clips
    if (this.#voices.length > 24) this.#voices.shift();
    this.#voices.push({ pcm: sample.pcm, vch: sample.channels, pos: 0, gain });
  }

  get activeVoices() { return this.#voices.length; }

  positionSamples() {
    this.#mmtime.writeUInt32LE(TIME_SAMPLES, 0);
    check(waveOutGetPosition(this.#hwo, this.#mmtime, MMTIME_SIZE), 'waveOutGetPosition');
    if (this.#mmtime.readUInt32LE(0) !== TIME_SAMPLES) throw new Error('device refused TIME_SAMPLES');
    return this.#mmtime.readUInt32LE(4);
  }

  positionMs() { return (this.positionSamples() / this.sampleRate) * 1000; }
  get durationMs() { return (this.#musicFrames / this.sampleRate) * 1000; }

  pause()  { if (!this.#paused) { check(waveOutPause(this.#hwo), 'waveOutPause'); this.#paused = true; } }
  resume() { if (this.#paused) { this.#paused = false; check(waveOutRestart(this.#hwo), 'waveOutRestart'); } }
  get paused() { return this.#paused; }

  close() {
    if (!this.#hwo) return;
    try { waveOutReset(this.#hwo); } catch {}
    for (const hdr of this.#headers) {
      try { waveOutUnprepareHeader(this.#hwo, hdr, WAVEHDR_SIZE); } catch {}
    }
    try { waveOutClose(this.#hwo); } catch {}
    this.#hwo = null;
    this.#buffers = []; this.#headers = []; this.#voices = []; this.#music = null;
  }
}
