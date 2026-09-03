// reverse arrows: direction along the path, and a chevron that reads as an arrow
// rather than another circle. does not import game.mjs.
import { Beatmap } from '../src/core/beatmap.mjs';
import { SliderPath, sliderTiming, sliderRepeats, reverseDirection } from '../src/core/slider.mjs';
import { Framebuffer } from '../src/render/framebuffer.mjs';
import { drawReverseArrow } from '../src/render/arrow.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const HEADER = ['osu file format v14', '', '[General]', 'Mode: 0', '',
  '[Difficulty]', 'CircleSize:4', 'OverallDifficulty:8', 'ApproachRate:9',
  'SliderMultiplier:1.4', 'SliderTickRate:1', '',
  '[TimingPoints]', '0,500,4,2,0,100,1,0', '', '[HitObjects]'];
const makeMap = (...objects) => Beatmap.parse([...HEADER, ...objects].join('\n'));

console.log('\n=== reverse direction ===');
{
  const bm = makeMap('100,100,1000,2,0,L|300:100,2,200');
  const o = bm.hitObjects[0];
  const path = new SliderPath(o.curveType, o.points, o.pixelLength);
  const timing = sliderTiming(bm, o);
  const repeats = sliderRepeats(path, timing, o);
  check(repeats.length === 1, 'two slides -> one reverse');
  check(repeats[0].atEnd === true, 'first reverse is at the tail');
  const dir = reverseDirection(path, true);
  check(dir.dx < -0.9 && Math.abs(dir.dy) < 0.15, `tail reverse points back left (dx=${dir.dx.toFixed(2)})`);
}
{
  const bm = makeMap('100,100,1000,2,0,L|300:100,3,200');
  const o = bm.hitObjects[0];
  const path = new SliderPath(o.curveType, o.points, o.pixelLength);
  const timing = sliderTiming(bm, o);
  const repeats = sliderRepeats(path, timing, o);
  check(repeats.length === 2, 'three slides -> two reverses');
  check(repeats[0].atEnd && !repeats[1].atEnd, 'second reverse is back at the head');
  const dir = reverseDirection(path, false);
  check(dir.dx > 0.9 && Math.abs(dir.dy) < 0.15, `head reverse points right (dx=${dir.dx.toFixed(2)})`);
}
{
  const bm = makeMap('100,300,1000,2,0,L|100:100,2,200');
  const o = bm.hitObjects[0];
  const path = new SliderPath(o.curveType, o.points, o.pixelLength);
  const dir = reverseDirection(path, true);
  check(dir.dy > 0.9 && Math.abs(dir.dx) < 0.15, `vertical slider reverse points back down (dy=${dir.dy.toFixed(2)})`);
}

console.log('\n=== arrow pixels ===');
{
  const extent = (fb) => {
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0;
    for (let y = 0; y < fb.height; y++) {
      for (let x = 0; x < fb.width; x++) {
        const i = (y * fb.width + x) * 3;
        if (fb.px[i] + fb.px[i + 1] + fb.px[i + 2] > 200) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          n++;
        }
      }
    }
    return { minX, maxX, minY, maxY, n };
  };

  const fb = new Framebuffer(40, 20);
  fb.clear(8, 8, 14);
  drawReverseArrow(fb, 20, 20, 1, 0, 10, 255, 255, 255, 1);
  const right = extent(fb);
  check(right.n > 20, `a right-pointing arrow paints a chevron (${right.n} px)`);
  check(right.maxX - 20 > 20 - right.minX,
    `it sticks out further to the right than the left (${right.minX}..${right.maxX})`);

  fb.clear(8, 8, 14);
  drawReverseArrow(fb, 20, 20, -1, 0, 10, 255, 255, 255, 1);
  const left = extent(fb);
  check(20 - left.minX > left.maxX - 20,
    `a left-pointing arrow sticks out further left (${left.minX}..${left.maxX})`);

  fb.clear(8, 8, 14);
  drawReverseArrow(fb, 20, 20, 0, 1, 10, 255, 255, 255, 1);
  const down = extent(fb);
  check(down.maxY - 20 > 20 - down.minY,
    `a down-pointing arrow sticks out further down (${down.minY}..${down.maxY})`);
}

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall ok\n');
