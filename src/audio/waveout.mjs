// waveOut through koffi.
//
// using this instead of a node audio package because we don't need a player so much as
// an accurate clock. waveOutGetPosition with TIME_SAMPLES gives the exact number of
// samples the device has played, which is the only thing you can trust for a rhythm
// game. a normal timer drifts against the sound card within a minute.
//
// WAVEHDR is a raw Buffer here rather than a koffi struct on purpose. windows writes
// status flags back into it while it plays, so it has to be the same memory we handed
// over, and a marshalled copy would break that.

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
const waveOutSetVolume       = winmm.func('uint __stdcall waveOutSetVolume(void *hwo, uint dwVolume)');
const waveOutGetErrorText    = winmm.func('uint __stdcall waveOutGetErrorTextA(uint err, _Out_ char *buf, uint cch)');

const WAVE_MAPPER  = 0xffffffff;
const TIME_SAMPLES = 0x0002;
const WAVEHDR_SIZE = 48;   // x64: lpData(8) len(4) rec(4) user(8) flags(4) loops(4) next(8) reserved(8)
const MMTIME_SIZE  = 12;   // wType(4) + union(8)

function check(code, what) {
  if (code === 0) return;
  const buf = Buffer.alloc(256);
  waveOutGetErrorText(code, buf, 256);
  const msg = buf.toString('latin1').split('\0')[0];
  throw new Error(`${what} failed (mmsys ${code}): ${msg}`);
}

function makeWaveFormatEx({ channels, sampleRate, bitsPerSample }) {
  const wfx = Buffer.alloc(20);
  const blockAlign = (channels * bitsPerSample) / 8;
  wfx.writeUInt16LE(1, 0);                            // WAVE_FORMAT_PCM
  wfx.writeUInt16LE(channels, 2);
  wfx.writeUInt32LE(sampleRate, 4);
  wfx.writeUInt32LE(sampleRate * blockAlign, 8);      // nAvgBytesPerSec
  wfx.writeUInt16LE(blockAlign, 12);
  wfx.writeUInt16LE(bitsPerSample, 14);
  wfx.writeUInt16LE(0, 16);                           // cbSize
  return wfx;
}

// simple player, whole track in one buffer, with an accurate clock.
// costs about 40MB for a 4 minute song, but there's no streaming, no refills, no
// underruns and no drift between chunks. only calibration uses this now.
export class WaveOutPlayer {
  #hwo = null;
  #hdr = null;
  #pcm = null;
  #mmtime = Buffer.alloc(MMTIME_SIZE);
  #startedAt = null;
  #paused = false;

  constructor({ sampleRate = 44100, channels = 2, bitsPerSample = 16 } = {}) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.bitsPerSample = bitsPerSample;
    this.bytesPerFrame = (channels * bitsPerSample) / 8;
  }

  // pcm has to match the format passed to the constructor
  open(pcm) {
    if (this.#hwo) throw new Error('already open');
    this.#pcm = pcm;                                   // keep a reference, the device is reading this

    const wfx = makeWaveFormatEx(this);
    const out = [null];
    check(waveOutOpen(out, WAVE_MAPPER, wfx, 0, 0, 0), 'waveOutOpen');
    this.#hwo = out[0];

    const hdr = Buffer.alloc(WAVEHDR_SIZE);
    hdr.writeBigUInt64LE(BigInt(koffi.address(pcm)), 0);  // lpData
    hdr.writeUInt32LE(pcm.length, 8);                     // dwBufferLength
    this.#hdr = hdr;

    check(waveOutPrepareHeader(this.#hwo, hdr, WAVEHDR_SIZE), 'waveOutPrepareHeader');
    return this;
  }

  // pause then restart so position 0 is well defined
  play() {
    check(waveOutPause(this.#hwo), 'waveOutPause');
    check(waveOutWrite(this.#hwo, this.#hdr, WAVEHDR_SIZE), 'waveOutWrite');
    check(waveOutRestart(this.#hwo), 'waveOutRestart');
    this.#startedAt = Number(process.hrtime.bigint()) / 1e6;
    return this;
  }

  pause()  { check(waveOutPause(this.#hwo), 'waveOutPause'); this.#paused = true; }
  resume() { check(waveOutRestart(this.#hwo), 'waveOutRestart'); this.#paused = false; }
  get paused() { return this.#paused; }

  // 0..1
  setVolume(v) {
    const lvl = Math.max(0, Math.min(1, v));
    const s = Math.round(lvl * 0xffff);
    check(waveOutSetVolume(this.#hwo, (s << 16 | s) >>> 0), 'waveOutSetVolume');
  }

  // samples the device has played. this is the clock.
  positionSamples() {
    this.#mmtime.writeUInt32LE(TIME_SAMPLES, 0);
    check(waveOutGetPosition(this.#hwo, this.#mmtime, MMTIME_SIZE), 'waveOutGetPosition');
    if (this.#mmtime.readUInt32LE(0) !== TIME_SAMPLES) throw new Error('device refused TIME_SAMPLES');
    return this.#mmtime.readUInt32LE(4);
  }

  // position in ms
  positionMs() { return (this.positionSamples() / this.sampleRate) * 1000; }

  get durationMs() { return (this.#pcm.length / this.bytesPerFrame / this.sampleRate) * 1000; }
  get ended() { return this.positionSamples() >= this.#pcm.length / this.bytesPerFrame; }

  close() {
    if (!this.#hwo) return;
    try { waveOutReset(this.#hwo); } catch {}
    try { waveOutUnprepareHeader(this.#hwo, this.#hdr, WAVEHDR_SIZE); } catch {}
    try { waveOutClose(this.#hwo); } catch {}
    this.#hwo = null; this.#hdr = null; this.#pcm = null;
  }
}
