// overlapping hitcircles have to stay countable: rings, not solid discs.
// does not import game.mjs (that loads Win32 via koffi).

import { Framebuffer } from '../src/render/framebuffer.mjs';
import { drawHitCircle, comboVisible, STACK_COUNT_RGB } from '../src/render/hitcircle.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const PINK = [255, 102, 170];
const CYAN = [102, 204, 255];

function rimPixels(fb, cx, cy, rad, [r, g, b], tol = 40) {
  let n = 0;
  const inner = rad - 2.2, outer = rad + 2.2;
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++) {
    for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x++) {
      if (x < 0 || y < 0 || x >= fb.width || y >= fb.height) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < inner || d > outer) continue;
      const i = (y * fb.width + x) * 3;
      if (Math.abs(fb.px[i] - r) < tol && Math.abs(fb.px[i + 1] - g) < tol && Math.abs(fb.px[i + 2] - b) < tol)
        n++;
    }
  }
  return n;
}

function goldPixels(fb) {
  let n = 0;
  const [r, g, b] = STACK_COUNT_RGB;
  for (let i = 0; i < fb.px.length; i += 3) {
    if (Math.abs(fb.px[i] - r) < 30 && Math.abs(fb.px[i + 1] - g) < 30 && Math.abs(fb.px[i + 2] - b) < 30) n++;
  }
  return n;
}

console.log('\n=== combo visibility ===');
const next = { index: 0, x: 100, y: 100 };
check(comboVisible({ index: 0, x: 100, y: 100 }, next, 36), 'the next hit always shows a label');
check(!comboVisible({ index: 1, x: 110, y: 110 }, next, 36), 'a note sitting on the next hit hides its combo');
check(comboVisible({ index: 2, x: 200, y: 200 }, next, 36), 'a jump far from the next hit keeps its combo');

console.log('\n=== overlapping rings ===');
{
  const fb = new Framebuffer(80, 40);
  fb.clear(8, 8, 14);
  const rad = 12;
  // later note underneath, earlier note on top — same order as the game
  drawHitCircle(fb, 36, 36, rad, CYAN, 1);
  drawHitCircle(fb, 28, 28, rad, PINK, 1);
  const pinkRim = rimPixels(fb, 28, 28, rad, PINK);
  const cyanRim = rimPixels(fb, 36, 36, rad, CYAN);
  check(pinkRim > 20, `top ring is visible (${pinkRim} pink rim pixels)`);
  check(cyanRim > 12, `underneath ring still shows a crescent (${cyanRim} cyan rim pixels)`);
}

{
  const fb = new Framebuffer(80, 40);
  fb.clear(8, 8, 14);
  const rad = 11;
  // 5-stack staircase up-left, later notes drawn first
  for (let i = 4; i >= 0; i--) {
    drawHitCircle(fb, 50 - i * 5, 40 - i * 5, rad, i % 2 ? PINK : CYAN, 1, {
      stacked: true,
      count: i === 0 ? 5 : null,
    });
  }
  const pink = rimPixels(fb, 50 - 3 * 5, 40 - 3 * 5, rad, PINK);
  const cyan = rimPixels(fb, 50, 40, rad, CYAN);
  check(pink > 8 && cyan > 8, `a 5-stack shows more than one rim (pink ${pink}, base cyan ${cyan})`);
  check(goldPixels(fb) > 8, 'the next hit in the pile draws a gold remaining-count');
  // centre pips: the top of the pile is at (50-4*5, 40-4*5) = (30, 20)
  const pip = (fb.px[(20 * fb.width + 30) * 3] > 180);
  check(pip, 'stacked notes get a bright centre pip');
}

{
  const fb = new Framebuffer(50, 25);
  fb.clear(8, 8, 14);
  drawHitCircle(fb, 20, 20, 10, PINK, 1, { combo: 3 });
  const before = goldPixels(fb);
  const fb2 = new Framebuffer(50, 25);
  fb2.clear(8, 8, 14);
  drawHitCircle(fb2, 20, 20, 10, PINK, 1, { stacked: true, count: 4 });
  check(before === 0, 'a normal combo number is not gold');
  check(goldPixels(fb2) > before, 'stack remaining uses the gold count colour');
}

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall good\n');
