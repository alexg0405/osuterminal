#!/usr/bin/env node
// measures your audio offset by making you tap along to a metronome.
//
// there are a few sources of latency and none of them can be worked out ahead of time:
// the waveOut buffer, your headphones, the terminal's own display pipeline, and your
// reaction time. this measures all of it at once, which is the only number the game
// needs. saves to ~/.osuterminal.json.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stdout } from 'node:process';
import { WaveOutPlayer } from '../src/audio/waveout.mjs';
import { Input } from '../src/input/input.mjs';

const CSI = '\x1b[';
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;
// Same location main.mjs reads, so a global install keeps its calibration.
const CONFIG = path.join(os.homedir(), '.osuterminal.json');

const RATE = 44100, CH = 2;
const INTERVAL = 800;      // ms between clicks
const WARMUP = 4;          // ignore the first few while you find the beat
const BEATS = 20;

if (!stdout.isTTY) {
  console.error('\nNeeds a real terminal. Run:  node tools/calibrate.mjs\n');
  process.exit(1);
}

// build the metronome track
const totalMs = INTERVAL * (BEATS + 2);
const frames = Math.ceil((totalMs / 1000) * RATE);
const pcm = Buffer.alloc(frames * CH * 2);
const beatTimes = [];
for (let b = 0; b < BEATS; b++) {
  const t = INTERVAL * (b + 1);
  beatTimes.push(t);
  const start = Math.floor((t / 1000) * RATE);
  // 40ms 1kHz burst with a fast decay, easy to lock onto
  for (let i = 0; i < RATE * 0.04; i++) {
    const env = Math.exp(-i / (RATE * 0.006)) * 0.5;
    const v = Math.round(Math.sin((2 * Math.PI * 1000 * i) / RATE) * 32767 * env);
    const off = (start + i) * 4;
    if (off + 3 < pcm.length) { pcm.writeInt16LE(v, off); pcm.writeInt16LE(v, off + 2); }
  }
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// run it
const player = new WaveOutPlayer({ sampleRate: RATE, channels: CH, bitsPerSample: 16 });
const input = new Input({ mode: 'relative', sensitivity: 1 });
const taps = [];
let songTime = 0, frameWall = nowMs(), quit = false;

input.on('hit', ({ at }) => {
  const t = songTime + (at - frameWall);        // same extrapolation the game does
  let best = null, bestD = Infinity;
  for (const b of beatTimes) {
    const d = t - b;
    if (Math.abs(d) < Math.abs(bestD)) { bestD = d; best = b; }
  }
  if (best === null || Math.abs(bestD) > INTERVAL / 2) return;
  const idx = beatTimes.indexOf(best);
  if (idx < WARMUP) return;                      // warmup taps don't count
  if (taps.some((x) => x.beat === best)) return; // one tap per beat only
  taps.push({ beat: best, error: bestD });
});
input.on('key', ({ ch }) => { if (ch === '\x1b' || ch === '\x03' || ch === 'q') quit = true; });

console.clear();
console.log('\x1b[1maudio offset calibration\x1b[0m\n');
console.log('  Tap \x1b[1mz\x1b[0m, \x1b[1mx\x1b[0m or a \x1b[1mmouse button\x1b[0m in time with the clicks you HEAR.');
console.log('  Ignore what you see on screen, go off the sound.');
console.log(`  First ${WARMUP} clicks are warmup and are not scored.\n`);
console.log('  q to abort.  Starting in 2s...');
await new Promise((r) => setTimeout(r, 2000));

stdout.write(`${CSI}?1049h${CSI}?25l`);
await input.enable();
player.open(pcm).play();

try {
  while (!quit) {
    frameWall = nowMs();
    songTime = player.positionMs();
    input.poll();

    const beat = Math.floor(songTime / INTERVAL);
    const phase = (songTime % INTERVAL) / INTERVAL;
    const pulse = phase < 0.12 ? '\x1b[1;33m' : '\x1b[2m';
    const scored = taps.length;

    let out = `${CSI}H${CSI}J`;
    out += `\n   ${pulse}${'#'.repeat(Math.max(0, Math.round((1 - phase) * 20)))}${CSI}0m\n\n`;
    out += `   beat ${Math.max(0, beat)} / ${BEATS}      scored taps: ${scored}\n\n`;
    if (scored >= 3) {
      const errs = taps.map((t) => t.error);
      const m = median(errs);
      const spread = median(errs.map((e) => Math.abs(e - m)));
      out += `   running offset: \x1b[1m${m >= 0 ? '+' : ''}${m.toFixed(1)} ms\x1b[0m   (consistency +/-${spread.toFixed(1)} ms)\n`;
    } else {
      out += `   tap along...\n`;
    }
    stdout.write(out);

    if (songTime > INTERVAL * (BEATS + 1)) break;
    await new Promise((r) => setTimeout(r, 8));
  }
} finally {
  player.close();
  input.disable();
  stdout.write(`${CSI}?25h${CSI}?1049l`);
}

// results
if (taps.length < 5) {
  console.log(`\n\x1b[31mOnly ${taps.length} taps recorded, need at least 5. Run it again.\x1b[0m\n`);
  process.exit(1);
}

const errs = taps.map((t) => t.error);
const m = median(errs);
const spread = median(errs.map((e) => Math.abs(e - m)));
const offset = Math.round(m);

console.log(`\n\x1b[1mresult\x1b[0m`);
console.log(`  taps scored   : ${taps.length}`);
console.log(`  median offset : \x1b[1m${offset >= 0 ? '+' : ''}${offset} ms\x1b[0m`);
console.log(`  consistency   : +/-${spread.toFixed(1)} ms ${spread > 25 ? '\x1b[33m(noisy, maybe run it again)\x1b[0m' : ''}`);
console.log(`  raw errors    : ${errs.map((e) => e.toFixed(0)).join(' ')}`);

const cfg = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {};
cfg.audioOffsetMs = offset;
cfg.calibratedAt = new Date().toISOString();
cfg.calibrationSpreadMs = Number(spread.toFixed(1));
writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');

console.log(`\n  saved to ${CONFIG}, the game picks this up automatically.`);
console.log(`  override per-run with --offset <ms>\n`);
