// checks the audio clock actually works. makes a tone, plays it, and sees whether
// waveOutGetPosition is real, sample accurate, and not drifting against the wall clock.
// plays about 4s of a quiet tone.

import { WaveOutPlayer } from '../src/audio/waveout.mjs';

const ms = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (n) => new Promise((r) => setTimeout(r, n));
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

const RATE = 44100, CH = 2, SECS = 4;
const frames = RATE * SECS;
const pcm = Buffer.alloc(frames * CH * 2);
for (let i = 0; i < frames; i++) {
  // quiet A440 with a short fade in/out so it is not harsh
  const env = Math.min(1, i / 2000, (frames - i) / 2000) * 0.18;
  const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / RATE) * 32767 * env);
  pcm.writeInt16LE(v, i * 4);
  pcm.writeInt16LE(v, i * 4 + 2);
}

const p = new WaveOutPlayer({ sampleRate: RATE, channels: CH, bitsPerSample: 16 });
console.log('opening device...');
p.open(pcm);
console.log(`duration: ${p.durationMs.toFixed(1)} ms`);

const samples = [];
const t0 = ms();
p.play();

while (ms() - t0 < SECS * 1000 - 200) {
  samples.push({ wall: ms() - t0, audio: p.positionMs(), raw: p.positionSamples() });
  await sleep(20);
}

p.close();

// results
const moving = samples.filter((s) => s.raw > 0);
if (!moving.length) {
  console.log('\nFAIL: position never advanced. waveOutGetPosition is not usable.');
  process.exit(1);
}

// the audio position lags the wall clock by however deep the device buffer is. a
// constant offset is fine since calibration removes it, what matters is the slope.
const first = moving[0], last = moving[moving.length - 1];
const slope = (last.audio - first.audio) / (last.wall - first.wall);
const offsets = moving.map((s) => s.wall - s.audio);
const medOffset = pct(offsets, 0.5);
const resid = moving.map((s) => (s.wall - s.audio) - medOffset);
const absResid = resid.map(Math.abs);

// does the position move smoothly or jump in chunks
const steps = [];
for (let i = 1; i < moving.length; i++) {
  const d = moving[i].raw - moving[i - 1].raw;
  if (d > 0) steps.push(d);
}
const uniq = new Set(moving.map((s) => s.raw)).size;

console.log('\n=== AUDIO CLOCK ===');
console.log(`  polls                 : ${samples.length} (${moving.length} after playback started)`);
console.log(`  distinct positions    : ${uniq}  ${uniq > moving.length * 0.8 ? '(advances every poll - smooth)' : '(chunky)'}`);
console.log(`  smallest advance      : ${Math.min(...steps)} samples = ${(Math.min(...steps) / RATE * 1000).toFixed(2)} ms`);
console.log(`  clock rate vs wall    : ${slope.toFixed(6)}x  -> drift ${((slope - 1) * 1e6).toFixed(0)} ppm`);
console.log(`  = ${(Math.abs(slope - 1) * 60000).toFixed(2)} ms drift per minute of play`);
console.log(`  output latency (const): ${medOffset.toFixed(1)} ms  <- calibrated out, does not hurt`);
console.log(`  residual jitter       : med ${pct(absResid, 0.5).toFixed(2)} ms  p95 ${pct(absResid, 0.95).toFixed(2)} ms  max ${Math.max(...absResid).toFixed(2)} ms`);

const ok = Math.abs(slope - 1) < 0.002 && pct(absResid, 0.95) < 5;
console.log(`\n  VERDICT: ${ok ? '\x1b[1;32mUSABLE as a game clock\x1b[0m' : '\x1b[1;31mNOT usable\x1b[0m'}`);
console.log('  (osu! OD8 "300" window is +/-31 ms; residual jitter is the part that eats into it)');
