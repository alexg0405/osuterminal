#!/usr/bin/env node
// writes the two beginner maps that ship inside the npm package.
// original audio (not from osu!), so we can redistribute it.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bundled');
const RATE = 22050;

function writeWav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function synth({ bpm, seconds, melody, bass }) {
  const frames = Math.ceil(seconds * RATE);
  const pcm = Buffer.alloc(frames * 2);
  const beat = 60 / bpm;
  const twoPi = 2 * Math.PI;

  for (let i = 0; i < frames; i++) {
    const t = i / RATE;
    const beatIdx = Math.floor(t / beat);
    const inBeat = (t / beat) % 1;

    // kick on every beat, hat on offbeats
    const kick = Math.exp(-inBeat * 18) * Math.sin(twoPi * (90 + inBeat * 40) * t);
    const hat = (beatIdx % 2 === 1) ? Math.exp(-inBeat * 40) * (Math.random() * 2 - 1) * 0.25 : 0;

    const mNote = melody[beatIdx % melody.length];
    const bNote = bass[Math.floor(beatIdx / 2) % bass.length];
    const melEnv = mNote ? Math.min(1, inBeat * 12) * Math.exp(-inBeat * 2.2) : 0;
    const bassEnv = bNote ? 0.7 : 0;
    const mel = mNote ? Math.sin(twoPi * mNote * t) * melEnv : 0;
    const low = bNote ? Math.sin(twoPi * bNote * t) * bassEnv * 0.45 : 0;

    const s = (kick * 0.55 + hat * 0.2 + mel * 0.5 + low) * 0.7;
    const v = Math.max(-1, Math.min(1, s));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return writeWav(pcm);
}

function osu({ title, version, bpm, cs, ar, od, objects }) {
  const beat = 60000 / bpm;
  return `osu file format v14

[General]
AudioFilename: audio.wav
AudioLeadIn: 0
PreviewTime: 0
Mode: 0

[Metadata]
Title:${title}
TitleUnicode:${title}
Artist:osuterminal
ArtistUnicode:osuterminal
Creator:osuterminal
Version:${version}
Source:osuterminal
Tags:beginner bundled

[Difficulty]
HPDrainRate:2
CircleSize:${cs}
OverallDifficulty:${od}
ApproachRate:${ar}
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,${beat},4,1,0,80,1,0

[HitObjects]
${objects.join('\n')}
`;
}

const circle = (x, y, t, combo = false) => `${x},${y},${t},${combo ? 5 : 1},0,0:0:0:0:`;
const slider = (x, y, t, tx, ty, len, combo = false) =>
  `${x},${y},${t},${combo ? 6 : 2},0,L|${tx}:${ty},1,${len}`;

// 80bpm, quarters on every other beat — about 2 star
function warmupObjects() {
  const beat = 750;
  const pts = [[128, 192], [384, 192], [256, 96], [256, 288]];
  const out = [];
  let t = 2000;
  for (let i = 0; i < 24; i++) {
    const [x, y] = pts[i % pts.length];
    out.push(circle(x, y, t, i % 4 === 0));
    t += beat * 2;
  }
  return out;
}

// 100bpm, 1/1 circles plus a few one-beat sliders — about 3 star
function firstStepsObjects() {
  const beat = 600;
  const square = [[128, 128], [384, 128], [384, 256], [128, 256]];
  const out = [];
  let t = 1800;
  for (let i = 0; i < 8; i++) {
    const [x, y] = square[i % 4];
    out.push(circle(x, y, t, i % 4 === 0));
    t += beat;
  }
  // a few horizontal sliders, one beat each (pixelLength 140 at SM 1.4)
  for (let i = 0; i < 4; i++) {
    const y = i % 2 === 0 ? 160 : 224;
    out.push(slider(96, y, t, 416, y, 140, true));
    t += beat * 2;
  }
  for (let i = 0; i < 20; i++) {
    const [x, y] = square[i % 4];
    out.push(circle(x, y, t, i % 4 === 0));
    t += beat;
  }
  return out;
}

const C4 = 261.63, D4 = 293.66, E4 = 329.63, G4 = 392.00, A4 = 440.00;
const C3 = 130.81, G3 = 196.00, A3 = 220.00, F3 = 174.61;

await mkdir(path.join(ROOT, '0 Warmup'), { recursive: true });
await mkdir(path.join(ROOT, '1 First Steps'), { recursive: true });

await writeFile(path.join(ROOT, '0 Warmup', 'audio.wav'), synth({
  bpm: 80,
  seconds: 42,
  melody: [C4, 0, E4, 0, G4, 0, E4, 0, D4, 0, E4, 0, C4, 0, G4, 0],
  bass: [C3, C3, G3, G3, A3, A3, G3, G3],
}));
await writeFile(path.join(ROOT, '0 Warmup', 'warmup.osu'), osu({
  title: 'Warmup', version: 'Easy', bpm: 80, cs: 3, ar: 4, od: 3,
  objects: warmupObjects(),
}));

await writeFile(path.join(ROOT, '1 First Steps', 'audio.wav'), synth({
  bpm: 100,
  seconds: 40,
  melody: [E4, G4, A4, G4, E4, D4, C4, 0, G4, A4, C4 * 2, A4, G4, E4, D4, 0],
  bass: [C3, G3, A3, F3, C3, G3, F3, G3],
}));
await writeFile(path.join(ROOT, '1 First Steps', 'first-steps.osu'), osu({
  title: 'First Steps', version: 'Normal', bpm: 100, cs: 3.5, ar: 5, od: 4,
  objects: firstStepsObjects(),
}));

console.log('wrote bundled beginner maps');
