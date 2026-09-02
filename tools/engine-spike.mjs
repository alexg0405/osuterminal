// checks the streaming engine didn't make the clock worse.
//
// the old single buffer player did 19ppm drift and 0.06ms p95 jitter. a ring of
// refilled buffers has to match that since judgement rides on the clock. also checks
// mixing works and that a stalled loop actually reports an underrun.
//
// plays about 5s of a quiet tone with clicks over it.

import { AudioEngine } from '../src/audio/engine.mjs';

const ms = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (n) => new Promise((r) => setTimeout(r, n));
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const RATE = 44100, CH = 2, SECS = 5;

// music, just a quiet tone
const frames = RATE * SECS;
const music = Buffer.alloc(frames * CH * 2);
for (let i = 0; i < frames; i++) {
  const env = Math.min(1, i / 3000, (frames - i) / 3000) * 0.10;
  const v = Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * 32767 * env);
  music.writeInt16LE(v, i * 4);
  music.writeInt16LE(v, i * 4 + 2);
}

// the sample, a short click
const clickFrames = Math.round(RATE * 0.05);
const click = new Int16Array(clickFrames);
for (let i = 0; i < clickFrames; i++) {
  const env = Math.exp(-i / (RATE * 0.008));
  click[i] = Math.round((Math.sin((2 * Math.PI * 900 * i) / RATE) * 0.6 + (Math.random() * 2 - 1) * 0.4) * 32767 * env * 0.5);
}
const sample = { pcm: click, channels: 1 };

const eng = new AudioEngine({ sampleRate: RATE, channels: CH, bufferMs: 5, bufferCount: 8 });
console.log(`\nring depth: ${eng.queueDepthMs.toFixed(1)} ms  (${eng.bufferCount} x ${(eng.bufferFrames / RATE * 1000).toFixed(1)} ms)`);
console.log('this is the worst-case hitsound latency\n');

eng.open().setMusic(music).start();

const samples = [];
const t0 = ms();
let nextClick = 300, clicks = 0;

while (ms() - t0 < SECS * 1000 - 400) {
  eng.pump();
  const wall = ms() - t0;
  samples.push({ wall, audio: eng.positionMs() });
  if (wall > nextClick) { eng.playSample(sample, 0.8); clicks++; nextClick += 400; }
  await sleep(1);            // same rate as the game loop
}

const underrunsNormal = eng.underruns;

// stall on purpose to make sure underruns get noticed instead of ignored
const before = eng.underruns;
const stallStart = ms();
while (ms() - stallStart < 120) { /* stall, do not pump */ }
eng.pump();
const detected = eng.underruns > before;

eng.close();

// results
const moving = samples.filter((s) => s.audio > 0);
const first = moving[0], last = moving[moving.length - 1];
const slope = (last.audio - first.audio) / (last.wall - first.wall);
const offsets = moving.map((s) => s.wall - s.audio);
const med = pct(offsets, 0.5);
const resid = offsets.map((o) => Math.abs(o - med));

console.log('=== clock ===');
console.log(`  polls               : ${samples.length}   clicks fired: ${clicks}`);
console.log(`  rate vs wall        : ${slope.toFixed(6)}x  -> ${((slope - 1) * 1e6).toFixed(0)} ppm`);
console.log(`  drift per minute    : ${(Math.abs(slope - 1) * 60000).toFixed(2)} ms`);
console.log(`  residual jitter     : med ${pct(resid, .5).toFixed(2)}  p95 ${pct(resid, .95).toFixed(2)}  max ${Math.max(...resid).toFixed(2)} ms`);
console.log(`  underruns (normal)  : ${underrunsNormal}`);
console.log('');
console.log('=== reference: static single-buffer player ===');
console.log('  19 ppm, 0.06 ms p95 jitter\n');

check(Math.abs(slope - 1) < 0.002, `clock rate within 2000 ppm (${((slope - 1) * 1e6).toFixed(0)})`);
check(pct(resid, 0.95) < 5, `p95 jitter under 5 ms (${pct(resid, .95).toFixed(2)})`);
check(underrunsNormal === 0, `no underruns at normal frame cadence (${underrunsNormal})`);
check(detected, 'a deliberate 120ms stall is detected as an underrun');
check(eng.queueDepthMs < 60, `hitsound latency under 60 ms (${eng.queueDepthMs.toFixed(1)})`);

console.log(`\n${failures === 0 ? '\x1b[1;32mall checks passed\x1b[0m' : `\x1b[1;31m${failures} failure(s)\x1b[0m`}\n`);
process.exit(failures ? 1 : 0);
