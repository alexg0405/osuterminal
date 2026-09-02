// runs every slider in my osu library through the path code to check it holds up.
import { Beatmap } from '../src/core/beatmap.mjs';
import { SliderPath, sliderTiming, sliderTicks, sliderRepeats } from '../src/core/slider.mjs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const SONGS = path.join(process.env.LOCALAPPDATA, 'osu!', 'Songs');
const files = [];
for (const d of await readdir(SONGS, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  for (const f of await readdir(path.join(SONGS, d.name)))
    if (f.endsWith('.osu')) files.push(path.join(SONGS, d.name, f));
}

const byType = {};
let total = 0, lenBad = 0, nan = 0, endpointBad = 0, tickCount = 0, repeatCount = 0;
let worstLenErr = 0, worstLenInfo = '';
const durations = [];
const t0 = Date.now();

for (const f of files) {
  let bm;
  try { bm = await Beatmap.load(f); } catch { continue; }
  if (!bm.isStandard) continue;

  for (const o of bm.hitObjects) {
    if (!o.isSlider) continue;
    total++;
    byType[o.curveType] = (byType[o.curveType] ?? 0) + 1;

    const p = new SliderPath(o.curveType, o.points, o.pixelLength);

    // no NaN or Infinity anywhere
    let bad = false;
    for (const pt of p.points) if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) { bad = true; break; }
    if (bad) { nan++; continue; }

    // the fitted length has to match what the map says
    const err = Math.abs(p.length - o.pixelLength);
    if (err > worstLenErr) { worstLenErr = err; worstLenInfo = `${o.curveType} len=${o.pixelLength} got=${p.length.toFixed(2)}`; }
    if (err > 0.5) lenBad++;

    // head should be on the first control point, and positionAt should cover the path
    const head = p.positionAt(0), tail = p.positionAt(1);
    if (Math.hypot(head.x - o.x, head.y - o.y) > 0.5) endpointBad++;
    if (!Number.isFinite(tail.x) || !Number.isFinite(tail.y)) { nan++; continue; }

    // progress should only go forward
    let prev = p.positionAt(0), walked = 0;
    for (let i = 1; i <= 20; i++) { const q = p.positionAt(i / 20); walked += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
    if (walked > p.length * 1.05 + 1) endpointBad++;

    const timing = sliderTiming(bm, o);
    durations.push(timing.duration);
    if (!Number.isFinite(timing.duration) || timing.duration <= 0) nan++;
    tickCount += sliderTicks(p, timing, o).length;
    repeatCount += sliderRepeats(p, timing, o).length;
  }
}

const ms = Date.now() - t0;
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * q)]; };
const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);

console.log(`\nsliders evaluated : ${total} across ${files.length} files in ${ms}ms (${(ms / total).toFixed(3)}ms each)`);
console.log(`curve types       : ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join('  ')}`);
console.log(`ticks generated   : ${tickCount}   repeats: ${repeatCount}`);
console.log(`durations         : median ${pct(durations, 0.5).toFixed(0)}ms  p95 ${pct(durations, 0.95).toFixed(0)}ms  max ${Math.max(...durations).toFixed(0)}ms`);
console.log(`worst length err  : ${worstLenErr.toFixed(4)}px  (${worstLenInfo})\n`);

let fails = 0;
const check = (c, m) => { if (!c) fails++; ok(c, m); };
check(total > 5000, `evaluated a meaningful sample (${total} sliders)`);
check(nan === 0, `no NaN/Inf produced (${nan})`);
check(lenBad === 0, `every path fitted to its declared pixelLength (${lenBad} off by >0.5px)`);
check(endpointBad === 0, `heads land on control point 0 and progress is monotonic (${endpointBad} bad)`);
check(worstLenErr < 0.01, `worst length error under 0.01px (${worstLenErr.toFixed(5)})`);
check(Object.keys(byType).length >= 3, `exercised multiple curve types (${Object.keys(byType).join(',')})`);

console.log(`\n${fails === 0 ? '\x1b[1;32mall checks passed\x1b[0m' : `\x1b[1;31m${fails} failure(s)\x1b[0m`}\n`);
process.exit(fails ? 1 : 0);
