// renders a real map frame by frame with no terminal, to check slider bodies don't
// blow the frame budget. they stamp discs along the path, which is the only part of
// the renderer that gets more expensive the busier the map is.
import { Beatmap } from '../src/core/beatmap.mjs';
import { Framebuffer } from '../src/render/framebuffer.mjs';
import { Game, sliderProgress } from '../src/game.mjs';
import { Playfield } from '../src/render/playfield.mjs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const SONGS = path.join(process.env.LOCALAPPDATA, 'osu!', 'Songs');
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

// grab the densest map available, worst case for the renderer
let worst = null;
for (const d of await readdir(SONGS, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  for (const f of await readdir(path.join(SONGS, d.name))) {
    if (!f.endsWith('.osu')) continue;
    try {
      const b = await Beatmap.load(path.join(SONGS, d.name, f));
      if (b.isStandard && (!worst || b.hitObjects.length > worst.hitObjects.length)) worst = b;
    } catch {}
  }
}

const sizes = [[120, 30], [240, 60]];
console.log(`\nmap: ${worst.artist} - ${worst.title} [${worst.diffName}]`);
console.log(`     ${worst.hitObjects.length} objects, AR${worst.difficulty.ar} CS${worst.difficulty.cs}\n`);

for (const [cols, rows] of sizes) {
  const fb = new Framebuffer(cols, rows);
  const g = new Game(worst);
  const pf = new Playfield(fb.width, fb.height, { radius: g.diff.radius });
  const input = { x: 256, y: 192, cursor: { x: 256, y: 192 }, anyDown: false };

  const last = g.objects[g.objects.length - 1].endTime;
  const drawT = [], totalT = [];
  let peakVisible = 0;

  // step through the whole map at 60fps and render every frame
  for (let t = g.objects[0].time - 500; t < last; t += 16.667) {
    g.time = t;
    g.frameWall = 0;
    g.processMisses();
    g.updateSliders(input.cursor, false);

    const a = Number(process.hrtime.bigint());
    g.draw(fb, pf, input, false);
    const b = Number(process.hrtime.bigint());
    const out = fb.render();
    const c = Number(process.hrtime.bigint());

    drawT.push((b - a) / 1e6);
    totalT.push((c - a) / 1e6);

    let vis = 0;
    for (const o of g.objects) if (o.time - t <= g.diff.preempt && t <= o.endTime + 250) vis++;
    peakVisible = Math.max(peakVisible, vis);
  }

  console.log(`  ${String(cols + 'x' + rows).padEnd(8)} frames ${String(drawT.length).padStart(5)}   peak objects on screen ${peakVisible}`);
  console.log(`           draw   med ${pct(drawT, .5).toFixed(2)}  p95 ${pct(drawT, .95).toFixed(2)}  p99 ${pct(drawT, .99).toFixed(2)}  max ${Math.max(...drawT).toFixed(2)} ms`);
  console.log(`           +encode med ${pct(totalT, .5).toFixed(2)}  p95 ${pct(totalT, .95).toFixed(2)}  p99 ${pct(totalT, .99).toFixed(2)}  max ${Math.max(...totalT).toFixed(2)} ms`);
  const over = totalT.filter((x) => x > 16.667).length;
  console.log(`           frames over 16.67ms budget: ${over} (${(over / totalT.length * 100).toFixed(2)}%)`);
  console.log(`           headroom at p99: ${(16.667 / pct(totalT, .99)).toFixed(1)}x\n`);
}
