// decode + resample. bundled beginner wavs used to be 22050 mono, which some
// windows waveOut devices would open and then never play.

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { decodeAudio, convertPcm, TARGET_RATE, TARGET_CHANNELS } from '../src/audio/decode.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

function writeWav({ channels, rate, frames, toneHz = 440 }) {
  const dataLen = frames * channels * 2;
  const b = Buffer.alloc(44 + dataLen);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * toneHz * i) / rate) * 16000);
    for (let c = 0; c < channels; c++) b.writeInt16LE(v, 44 + (i * channels + c) * 2);
  }
  return b;
}

function peak(pcm) {
  let p = 0;
  for (let i = 0; i < pcm.length; i += 2) p = Math.max(p, Math.abs(pcm.readInt16LE(i)));
  return p;
}

console.log('\n=== convertPcm ===');
{
  const srcRate = 22050, srcCh = 1, secs = 0.5;
  const frames = srcRate * secs;
  const src = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    src.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / srcRate) * 16000), i * 2);
  }
  const out = convertPcm(src, srcCh, srcRate);
  check(out.length === Math.round(frames * TARGET_RATE / srcRate) * TARGET_CHANNELS * 2,
    `22050 mono -> ${TARGET_RATE} stereo size`);
  const same = convertPcm(out, TARGET_CHANNELS, TARGET_RATE);
  check(same === out, 'already-target PCM is left alone');
  check(peak(out) > 1000, `resampled tone is not silent (peak ${peak(out)})`);
}

console.log('\n=== bundled maps ===');
for (const rel of ['bundled/0 Warmup/audio.wav', 'bundled/1 First Steps/audio.wav']) {
  const audio = await decodeAudio(path.join(ROOT, rel));
  check(audio.sampleRate === TARGET_RATE, `${rel} sampleRate ${audio.sampleRate}`);
  check(audio.channels === TARGET_CHANNELS, `${rel} channels ${audio.channels}`);
  check(audio.durationMs > 35000 && audio.durationMs < 50000,
    `${rel} duration ${(audio.durationMs / 1000).toFixed(1)}s`);
  check(peak(audio.pcm) > 1000, `${rel} is not silent (peak ${peak(audio.pcm)})`);
}

console.log('\n=== decode odd wav ===');
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'osuterminal-wav-'));
  const file = path.join(tmp, 'odd.wav');
  writeFileSync(file, writeWav({ channels: 1, rate: 22050, frames: 22050 }));
  const audio = await decodeAudio(file);
  check(audio.sampleRate === 44100 && audio.channels === 2, 'decoded 22050 mono as 44100 stereo');
  check(Math.abs(audio.durationMs - 1000) < 20, `duration preserved (${audio.durationMs.toFixed(1)}ms)`);
  check(peak(audio.pcm) > 1000, `decoded tone is not silent (peak ${peak(audio.pcm)})`);
  rmSync(tmp, { recursive: true, force: true });
}

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall good\n');
