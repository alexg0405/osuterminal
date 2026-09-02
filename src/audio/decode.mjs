// decode the song to interleaved 16 bit PCM.
// mp3 goes through a wasm decoder so no compiler is needed. wav is parsed here.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function decodeAudio(file) {
  const ext = path.extname(file).toLowerCase();
  const raw = await readFile(file);
  if (ext === '.wav') return decodeWav(raw);
  if (ext === '.mp3') return await decodeMp3(raw);
  throw new Error(`unsupported audio format: ${ext}`);
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
