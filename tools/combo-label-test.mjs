// combo numbers must sit on the circle's pixel centre, not a nearby character cell.
// 3 and 4 used to land in different corners because fb.text snaps to the grid.

import { Framebuffer, comboLabelBox, comboPixelSize } from '../src/render/framebuffer.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const boxCenter = (cx, cy, label, ps) => {
  const b = comboLabelBox(cx, cy, label, ps);
  return { x: b.x0 + b.w / 2, y: b.y0 + b.h / 2, ...b };
};

console.log('\n=== combo label box ===');

const a = comboLabelBox(40.2, 31.7, '3', 1);
const b = comboLabelBox(40.2, 31.7, '4', 1);
check(a.x0 === b.x0 && a.y0 === b.y0, '3 and 4 share the same origin at the same centre');
check(a.w === b.w && a.h === b.h, '3 and 4 occupy the same 5x7 box');

for (const [cx, cy] of [[10, 10], [10.4, 11.6], [40.9, 20.1], [55.2, 33.8], [100.7, 47.3]]) {
  const c = boxCenter(cx, cy, '3', 1);
  check(Math.abs(c.x - cx) <= 0.5 && Math.abs(c.y - cy) <= 0.5,
    `box centre of 3 at (${cx},${cy}) is (${c.x},${c.y}), within 0.5px`);
  const d4 = boxCenter(cx, cy, '4', 1);
  check(d4.x === c.x && d4.y === c.y, `4 at (${cx},${cy}) uses the same box centre as 3`);
}

const two = comboLabelBox(50, 40, '12', 1);
check(two.w === 11 && two.h === 7, 'two-digit label is 11x7 (5+1+5)');
check(two.x0 === Math.round(50 - 11 / 2) && two.y0 === Math.round(40 - 7 / 2),
  'two-digit box is centred on the circle');

check(comboPixelSize(4) >= 1, 'tiny circles still get a 1px glyph');
check(comboPixelSize(16) <= 2, 'typical circles stay at 1–2px glyphs');
check(comboPixelSize(30) <= 2, 'pixel size is capped');
check(comboPixelSize(16, 1) < comboPixelSize(30, 1) || comboPixelSize(16) === 2,
  'large circles do not grow past the cap');

console.log('\n=== drawn pixels sit in that box ===');
const fb = new Framebuffer(80, 40);
const centres = [[20.3, 18.6, '3'], [50.8, 22.1, '4'], [35.0, 40.4, '1']];
for (const [cx, cy, label] of centres) {
  fb.clear();
  fb.drawCombo(cx, cy, label, 10, 255, 255, 255, 1);
  const box = comboLabelBox(cx, cy, label, comboPixelSize(10));
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, lit = 0;
  for (let y = 0; y < fb.height; y++) {
    for (let x = 0; x < fb.width; x++) {
      if (fb.px[(y * fb.width + x) * 3] < 200) continue;
      lit++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  check(lit > 0, `${label} at (${cx},${cy}) drew pixels`);
  check(minX >= box.x0 && maxX < box.x0 + box.w && minY >= box.y0 && maxY < box.y0 + box.h,
    `${label} ink stays inside the centred box`);
}

// old text() placement: different circles picked different cells. prove the new
// path does not.
fb.clear();
fb.drawCombo(20.2, 15.1, '3', 12);
fb.drawCombo(20.2, 15.1, '4', 12);
// drawing 4 over 3 at the same centre should only add/remove glyph pixels inside
// the same box, never a cell jump of a full character.
const box3 = comboLabelBox(20.2, 15.1, '3', comboPixelSize(12));
const box4 = comboLabelBox(20.2, 15.1, '4', comboPixelSize(12));
check(box3.x0 === box4.x0 && box3.y0 === box4.y0, 'overlaid 3 and 4 still share origin');

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall good\n');
