// slider body outline has to read as a path, not a faint smear.
// does not import game.mjs (that loads Win32 via koffi).

import { Beatmap } from '../src/core/beatmap.mjs';
import { SliderPath } from '../src/core/slider.mjs';
import { Framebuffer } from '../src/render/framebuffer.mjs';
import { Playfield } from '../src/render/playfield.mjs';
import {
  drawSliderBody, sampleSliderScreen, sliderBodyRadius, sliderStrokeWidth,
} from '../src/render/sliderbody.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const PINK = [255, 102, 170];
const HEADER = ['osu file format v14', '', '[General]', 'Mode: 0', '',
  '[Difficulty]', 'CircleSize:4', 'OverallDifficulty:8', 'ApproachRate:9',
  'SliderMultiplier:1.4', 'SliderTickRate:1', '',
  '[TimingPoints]', '0,500,4,2,0,100,1,0', '', '[HitObjects]'];
const makeMap = (...objects) => Beatmap.parse([...HEADER, ...objects].join('\n'));

function pix(fb, x, y) {
  const i = (Math.round(y) * fb.width + Math.round(x)) * 3;
  return [fb.px[i], fb.px[i + 1], fb.px[i + 2]];
}

console.log('\n=== slider outline ===');
check(Math.abs(sliderBodyRadius(10) - 9.2) < 1e-9, 'body radius is 0.92 of the hit radius');
check(sliderStrokeWidth(10) >= 2.4, 'outline is at least 2.4px');
check(sliderStrokeWidth(20) > sliderStrokeWidth(8), 'bigger circles get a thicker rim');

{
  const bm = makeMap('100,192,1000,2,0,L|412:192,1,200');
  const o = bm.hitObjects[0];
  const path = new SliderPath(o.curveType, o.points, o.pixelLength);
  const fb = new Framebuffer(80, 24);
  fb.clear(8, 8, 14);
  const pf = new Playfield(fb.width, fb.height, { radius: 36 });
  const rad = 10;
  const samples = sampleSliderScreen(path, pf, rad);
  check(samples.length >= 3, `path is sampled (${samples.length} stamps)`);
  drawSliderBody(fb, samples, rad, PINK, 1);

  const mid = samples[Math.floor(samples.length / 2)];
  const bodyR = sliderBodyRadius(rad);
  const [cr] = pix(fb, mid.x, mid.y);
  const rim = pix(fb, mid.x, mid.y - bodyR);
  check(cr > 20, `fill is present down the lane (centre r=${cr})`);
  check(rim[0] > 140 && rim[0] > rim[2],
    `outline is the combo colour (rim rgb ${rim.join(',')})`);
  check(rim[0] > cr, 'outline is brighter than the fill');
}

{
  const fb = new Framebuffer(40, 20);
  fb.clear(8, 8, 14);
  drawSliderBody(fb, [{ x: 20, y: 20 }], 8, PINK, 1);
  let pink = 0;
  for (let i = 0; i < fb.px.length; i += 3) {
    if (fb.px[i] > 180 && fb.px[i + 1] < 140) pink++;
  }
  check(pink > 20, `a stamped disc has a visible pink rim (${pink} px)`);
}

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall good\n');
