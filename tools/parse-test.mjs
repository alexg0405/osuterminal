// parses every .osu in my library and checks nothing blows up.
import { Beatmap } from '../src/core/beatmap.mjs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const SONGS = 'C:/Users/16183/AppData/Local/osu!/Songs';
const files = [];
for (const d of await readdir(SONGS, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  for (const f of await readdir(path.join(SONGS, d.name)))
    if (f.endsWith('.osu')) files.push(path.join(SONGS, d.name, f));
}

let ok = 0, fail = 0, std = 0, circles = 0, sliders = 0, spinners = 0;
const modes = {}, versions = {}, errors = [];
for (const f of files) {
  try {
    const b = await Beatmap.load(f);
    ok++;
    modes[b.mode] = (modes[b.mode] ?? 0) + 1;
    versions[b.version] = (versions[b.version] ?? 0) + 1;
    if (b.isStandard) {
      std++;
      for (const o of b.hitObjects) {
        if (o.isSpinner) spinners++; else if (o.isSlider) sliders++; else if (o.isCircle) circles++;
      }
      if (!b.hitObjects.length) errors.push(`${path.basename(f)}: 0 hit objects`);
      if (!b.timingPoints.length) errors.push(`${path.basename(f)}: 0 timing points`);
      for (const o of b.hitObjects)
        if (o.isSlider && (!o.points || o.points.length < 2)) { errors.push(`${path.basename(f)}: slider @${o.time} missing points`); break; }
    }
  } catch (e) { fail++; errors.push(`${path.basename(f)}: ${e.message}`); }
}

console.log(`parsed        : ${ok}/${files.length}   failed: ${fail}`);
console.log(`modes         : ${Object.entries(modes).map(([k,v])=>['std','taiko','ctb','mania'][k]+'='+v).join('  ')}`);
console.log(`file versions : ${Object.entries(versions).map(([k,v])=>'v'+k+'='+v).join('  ')}`);
console.log(`std objects   : ${circles} circles, ${sliders} sliders, ${spinners} spinners`);
console.log(`anomalies     : ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('   ' + e);

// spot-check one map in detail
const sample = files.find(f => f.includes('Tower Of Heaven') && f.includes('[Hard]'));
if (sample) {
  const b = await Beatmap.load(sample);
  const d = b.difficulty;
  console.log(`\n--- ${b.artist} - ${b.title} [${b.diffName}] by ${b.creator} ---`);
  console.log(`  audio     : ${path.basename(b.audioPath)}  (lead-in ${b.audioLeadIn}ms)`);
  console.log(`  CS${d.cs} AR${d.ar} OD${d.od} HP${d.hp}`);
  console.log(`  radius    : ${d.radius.toFixed(1)} osu!px`);
  console.log(`  preempt   : ${d.preempt.toFixed(0)} ms   fadeIn ${d.fadeIn.toFixed(0)} ms`);
  const w = d.windows;
  console.log(`  windows   : 300=+/-${w.great.toFixed(0)}ms  100=+/-${w.ok.toFixed(0)}ms  50=+/-${w.meh.toFixed(0)}ms`);
  console.log(`  objects   : ${b.hitObjects.length}   timing points: ${b.timingPoints.length}`);
  const bpm = 60000 / b.timingAt(0).beatLength;
  console.log(`  BPM       : ${bpm.toFixed(1)}`);
  console.log(`  first 3   : ${b.hitObjects.slice(0,3).map(o=>`${o.isSlider?'slider':o.isSpinner?'spin':'circle'}@${o.time}ms(${o.x},${o.y})`).join('  ')}`);
}
