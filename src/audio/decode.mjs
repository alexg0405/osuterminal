// decode the song to interleaved 16 bit PCM.
// mp3 goes through a wasm decoder so no compiler is needed. wav is parsed here.
//
// everything comes out 44100 stereo. waveOut on a lot of windows machines will
// open 22050/mono just fine and then never actually play — GetPosition stays at
// 0, the countdown freezes on frame one. 44.1k stereo is what the mapper
// actually drives.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const TARGET_RATE = 44100;
export const TARGET_CHANNELS = 2;

export async function decodeAudio(file) {
  const ext = path.extname(file).toLowerCase();
  const raw = await readFile(file);
  let decoded;
  if (ext === '.wav') decoded = decodeWav(raw);
  else if (ext === '.mp3') decoded = await decodeMp3(raw);
  else throw new Error(`unsupported audio format: ${ext}`);
  return toTargetFormat(decoded);
}

// linear resample + channel convert to 44100 stereo int16.
export function convertPcm(pcm, srcCh, srcRate, dstCh = TARGET_CHANNELS, dstRate = TARGET_RATE) {
  const srcFrames = Math.floor(pcm.length / (srcCh * 2));
  if (srcFrames <= 0) return Buffer.alloc(0);
  if (srcCh === dstCh && srcRate === dstRate) return pcm;

  const dstFrames = srcRate === dstRate
    ? srcFrames
    : Math.max(1, Math.round((srcFrames * dstRate) / srcRate));
  const out = Buffer.alloc(dstFrames * dstCh * 2);
  const ratio = srcFrames / dstFrames;

  for (let f = 0; f < dstFrames; f++) {
    const src = f * ratio;
    const i0 = Math.min(srcFrames - 1, Math.floor(src));
    const i1 = Math.min(srcFrames - 1, i0 + 1);
    const t = src - i0;
    for (let c = 0; c < dstCh; c++) {
      let v;
      if (srcCh === 1) {
        const s0 = pcm.readInt16LE(i0 * 2);
        const s1 = pcm.readInt16LE(i1 * 2);
        v = s0 + (s1 - s0) * t;
      } else {
        const sc = Math.min(c, srcCh - 1);
        const s0 = pcm.readInt16LE((i0 * srcCh + sc) * 2);
        const s1 = pcm.readInt16LE((i1 * srcCh + sc) * 2);
        v = s0 + (s1 - s0) * t;
      }
      out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), (f * dstCh + c) * 2);
    }
  }
  return out;
}

function toTargetFormat(decoded) {
  const { pcm, channels, sampleRate } = decoded;
  const out = convertPcm(pcm, channels, sampleRate);
  const delay = decoded.encoderDelaySamples
    ? Math.round(decoded.encoderDelaySamples * TARGET_RATE / sampleRate)
    : 0;
  return {
    pcm: out,
    channels: TARGET_CHANNELS,
    sampleRate: TARGET_RATE,
    durationMs: (out.length / (TARGET_CHANNELS * 2) / TARGET_RATE) * 1000,
    encoderDelaySamples: delay,
    sourceSampleRate: sampleRate,
    sourceChannels: channels,
  };
}

// LAME/Xing encoder delay in samples.
//
// this is a sync thing, not a quality thing. mpg123 does gapless playback, so it strips
// the encoder delay off the front and the stream starts at the first real sample. osu
// uses BASS, which doesn't do that, so hit times in the map line up against a stream
// that still has those samples. decoding gapless shifts the whole song earlier and
// every hit reads as late.
//
// checked on a real map: 576 samples, 13.1ms. the Xing header says 7187 frames, so
// 7187 * 1152 = 8279424, but only 8278272 came back. the difference is exactly
// delay + padding.
function readEncoderDelay(buf) {
  const head = buf.subarray(0, 4096);
  let tag = head.indexOf('Xing');
  if (tag < 0) tag = head.indexOf('Info');
  if (tag < 0) return 0;

  const lame = tag + 120;                       // LAME extension is always at this offset
  if (lame + 24 > buf.length) return 0;
  const sig = buf.toString('latin1', lame, lame + 4);
  if (!/^(LAME|Lavf|Lavc)/.test(sig)) return 0;

  const o = lame + 21;                          // 12 bits delay then 12 bits padding
  const delay = (buf[o] << 4) | (buf[o + 1] >> 4);
  return delay > 0 && delay < 3000 ? delay : 0; // bail out if it clearly misparsed
}

async function decodeMp3(raw) {
  const { MPEGDecoder } = await import('mpg123-decoder');
  const dec = new MPEGDecoder();
  await dec.ready;
  try {
    const { channelData, samplesDecoded, sampleRate, errors } = dec.decode(new Uint8Array(raw));
    if (errors?.length) {
      // mpg123 reports frame errors it recovered from, so only bail if we got nothing
      if (!samplesDecoded) throw new Error(`mp3 decode failed: ${errors[0]?.message ?? 'no samples'}`);
    }
    const { pcm, channels } = interleave(channelData, samplesDecoded);

    // add the delay back so our timeline matches what the map was made against
    const delay = readEncoderDelay(raw);
    const out = delay ? Buffer.concat([Buffer.alloc(delay * channels * 2), pcm]) : pcm;

    return {
      pcm: out, channels, sampleRate,
      durationMs: (out.length / (channels * 2) / sampleRate) * 1000,
      encoderDelaySamples: delay,
    };
  } finally {
    dec.free();
  }
}

// planar float32 to interleaved int16
function interleave(channelData, frames) {
  const channels = Math.min(2, channelData.length);
  const pcm = Buffer.alloc(frames * channels * 2);
  if (channels === 2) {
    const [l, r] = channelData;
    for (let i = 0; i < frames; i++) {
      pcm.writeInt16LE(clamp16(l[i]), i * 4);
      pcm.writeInt16LE(clamp16(r[i]), i * 4 + 2);
    }
  } else {
    const m = channelData[0];
    for (let i = 0; i < frames; i++) pcm.writeInt16LE(clamp16(m[i]), i * 2);
  }
  return { pcm, channels };
}

const clamp16 = (f) => {
  const v = Math.round(f * 32767);
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v;
};

function decodeWav(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE')
    throw new Error('not a RIFF/WAVE file');

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
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(buf.length, body + size));
    }
    pos = body + size + (size & 1);   // chunks are word aligned
  }
  if (!fmt || !data) throw new Error('wav missing fmt or data chunk');
  if (fmt.format !== 1 || fmt.bits !== 16)
    throw new Error(`wav must be 16-bit PCM (got format ${fmt.format}, ${fmt.bits}-bit)`);

  return {
    pcm: Buffer.from(data),
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    durationMs: (data.length / (fmt.channels * 2) / fmt.sampleRate) * 1000,
  };
}
