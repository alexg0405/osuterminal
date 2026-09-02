// hitsounds.
//
// osu picks a hitsound from three things: the sample set (normal/soft/drum, from the
// timing point unless the object overrides it), the sound bits on the object (normal,
// plus whistle/finish/clap on top), and a custom index that gets appended to the
// filename. that gives you names like soft-hitclap2.wav.
//
// maps only include the samples they changed, and the defaults live inside osu itself,
// so we don't have them. anything missing gets synthesized instead. without that most
// maps would be silent on most hits.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const SAMPLE_SETS = { 0: 'normal', 1: 'normal', 2: 'soft', 3: 'drum' };
export const SOUND_BITS = { NORMAL: 1, WHISTLE: 2, FINISH: 4, CLAP: 8 };

// ---------------------------------------------------------------- wav decoding
// wav to float32 interleaved. beatmap hitsounds come in a lot of formats: 8/16/24/32
// bit PCM and 32/64 bit float, at any sample rate.
export function decodeWavFlexible(buf) {
  if (buf.length < 44) return null;
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;

  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
      // EXTENSIBLE puts the real format tag at the start of its GUID
      if (fmt.format === 0xfffe && size >= 40) fmt.format = buf.readUInt16LE(body + 24);
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(buf.length, body + size));
    }
    if (size <= 0) break;
    pos = body + size + (size & 1);
  }
  if (!fmt || !data || !fmt.channels || !fmt.sampleRate) return null;

  const bytes = fmt.bits >> 3;
  if (!bytes) return null;
  const count = Math.floor(data.length / bytes);
  const out = new Float32Array(count);

  try {
    if (fmt.format === 3) {                                  // float
      if (fmt.bits === 32) for (let i = 0; i < count; i++) out[i] = data.readFloatLE(i * 4);
      else if (fmt.bits === 64) for (let i = 0; i < count; i++) out[i] = data.readDoubleLE(i * 8);
      else return null;
    } else if (fmt.format === 1) {                           // int PCM
      if (fmt.bits === 8)       for (let i = 0; i < count; i++) out[i] = (data[i] - 128) / 128;
      else if (fmt.bits === 16) for (let i = 0; i < count; i++) out[i] = data.readInt16LE(i * 2) / 32768;
      else if (fmt.bits === 24) for (let i = 0; i < count; i++) {
        const o = i * 3;
        out[i] = ((data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) << 8 >> 8) << 8 >> 8) / 8388608;
      }
      else if (fmt.bits === 32) for (let i = 0; i < count; i++) out[i] = data.readInt32LE(i * 4) / 2147483648;
      else return null;
    } else return null;
  } catch { return null; }

  return { data: out, channels: fmt.channels, sampleRate: fmt.sampleRate };
}

// linear resample, fine for short percussive samples
function resample(data, channels, from, to) {
  if (from === to) return data;
  const inFrames = Math.floor(data.length / channels);
  const outFrames = Math.max(1, Math.round((inFrames * to) / from));
  const out = new Float32Array(outFrames * channels);
  const ratio = inFrames / outFrames;
  for (let f = 0; f < outFrames; f++) {
    const src = f * ratio;
    const i0 = Math.floor(src), i1 = Math.min(inFrames - 1, i0 + 1), t = src - i0;
    for (let c = 0; c < channels; c++) {
      out[f * channels + c] = data[i0 * channels + c] * (1 - t) + data[i1 * channels + c] * t;
    }
  }
  return out;
}

const toInt16 = (f32) => {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.round(f32[i] * 32767);
    out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return out;
};

// ---------------------------------------------------------------- synthesis
// stand ins for osu's default samples, which are inside the game and not ours to ship.
// kept short and sharp so the timing is easy to hear.
function synthesize(sound, rate) {
  const make = (secs, fn) => {
    const n = Math.round(rate * secs);
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = fn(i / rate, i / n);
    return a;
  };
  const noise = () => Math.random() * 2 - 1;

  switch (sound) {
    case 'hitnormal':   // thump plus a click so it cuts through the song
      return make(0.055, (t, p) => {
        const env = Math.exp(-t * 90);
        return (Math.sin(2 * Math.PI * 190 * t) * 0.55 + noise() * 0.28) * env * 0.55;
      });
    case 'hitwhistle':  // bright and pitched
      return make(0.09, (t) => {
        const env = Math.exp(-t * 45);
        return (Math.sin(2 * Math.PI * 1320 * t) * 0.6 + Math.sin(2 * Math.PI * 1980 * t) * 0.25) * env * 0.4;
      });
    case 'hitfinish':   // cymbal-ish, long and bright
      return make(0.34, (t) => {
        const env = Math.exp(-t * 11);
        return (noise() * 0.7 + Math.sin(2 * Math.PI * 3200 * t) * 0.18) * env * 0.42;
      });
    case 'hitclap':     // short sharp burst
      return make(0.075, (t) => {
        const env = Math.exp(-t * 65);
        return noise() * env * 0.5;
      });
    case 'slidertick':
      return make(0.035, (t) => Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 130) * 0.3);
    default:
      return make(0.04, (t) => noise() * Math.exp(-t * 100) * 0.35);
  }
}

// ---------------------------------------------------------------- bank
export class HitsoundBank {
  #cache = new Map();     // resolved name -> {pcm, channels}
  #files = new Map();     // lowercased filename -> absolute path
  #synth = new Map();

  constructor(sampleRate) { this.sampleRate = sampleRate; this.loaded = 0; this.synthesized = 0; }

  // index the folder once so lookups don't hit the disk each time
  static async forBeatmap(beatmap, sampleRate) {
    const bank = new HitsoundBank(sampleRate);
    try {
      for (const f of await readdir(beatmap.dir)) {
        if (f.toLowerCase().endsWith('.wav') || f.toLowerCase().endsWith('.ogg'))
          bank.#files.set(f.toLowerCase(), path.join(beatmap.dir, f));
      }
    } catch { /* no folder, everything gets synthesized */ }
    return bank;
  }

  async #load(name) {
    if (this.#cache.has(name)) return this.#cache.get(name);

    let result = null;
    const file = this.#files.get(`${name}.wav`);
    if (file) {
      try {
        const decoded = decodeWavFlexible(await readFile(file));
        if (decoded && decoded.data.length) {
          const rs = resample(decoded.data, decoded.channels, decoded.sampleRate, this.sampleRate);
          result = { pcm: toInt16(rs), channels: decoded.channels };
          this.loaded++;
        }
      } catch { /* fall back to synthesis */ }
    }

    if (!result) {
      // key synthesis on the bare sound, not the set. a synthesized drum-hitclap and
      // a synthesized soft-hitclap are the same thing, and caching saves redoing it.
      const bare = name.replace(/^(normal|soft|drum)-/, '').replace(/\d+$/, '');
      if (!this.#synth.has(bare)) {
        this.#synth.set(bare, { pcm: toInt16(synthesize(bare, this.sampleRate)), channels: 1 });
        this.synthesized++;
      }
      result = this.#synth.get(bare);
    }

    this.#cache.set(name, result);
    return result;
  }

  // which samples a hit should play.
  // set: 0 inherit, 1 normal, 2 soft, 3 drum. bits: the hitSound field. index: custom
  // sample number, 0 and 1 both mean no suffix.
  async resolve(set, bits, index = 0) {
    const setName = SAMPLE_SETS[set] ?? 'normal';
    const suffix = index > 1 ? String(index) : '';
    const names = [`${setName}-hitnormal${suffix}`];
    if (bits & SOUND_BITS.WHISTLE) names.push(`${setName}-hitwhistle${suffix}`);
    if (bits & SOUND_BITS.FINISH)  names.push(`${setName}-hitfinish${suffix}`);
    if (bits & SOUND_BITS.CLAP)    names.push(`${setName}-hitclap${suffix}`);
    return Promise.all(names.map((n) => this.#load(n)));
  }

  // preload everything the map uses so nothing hits the disk mid song
  async prime(beatmap) {
    const combos = new Set();
    for (const o of beatmap.hitObjects) {
      const tp = beatmap.effectiveAt(o.time);
      combos.add(`${tp?.sampleSet ?? 1}|${o.hitSound ?? 1}|${tp?.sampleIndex ?? 0}`);
    }
    for (const c of combos) {
      const [set, bits, idx] = c.split('|').map(Number);
      await this.resolve(set, bits, idx);
    }
    return this;
  }
}
