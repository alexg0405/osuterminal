// stacked notes that share a position have to be offset, otherwise the later
// circle eats the earlier one and you cannot see the pile.

import { applyStacking, stackOffsetForRadius } from '../src/core/stack.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const circle = (x, y, time) => ({ kind: 'circle', x, y, time, endTime: time, stackHeight: 0 });

console.log('\n=== stacking ===');

{
  const a = circle(100, 100, 1000);
  const b = circle(100, 100, 1100);
  applyStacking([a, b], { preempt: 1200, stackLeniency: 0.7, radius: 32 });
  check(a.stackHeight === 1, `earlier note is on top of the stack (height ${a.stackHeight})`);
  check(b.stackHeight === 0, `later note stays at the original spot (height ${b.stackHeight})`);
  const step = stackOffsetForRadius(32);
  check(Math.abs(a.x - (100 - step)) < 1e-9 && Math.abs(a.y - (100 - step)) < 1e-9,
    `earlier note is shifted up-left (${a.x.toFixed(1)}, ${a.y.toFixed(1)})`);
  check(b.x === 100 && b.y === 100, 'later note is not moved');
}

{
  const a = circle(100, 100, 1000);
  const b = circle(100, 100, 4000);
  applyStacking([a, b], { preempt: 1200, stackLeniency: 0.7, radius: 32 });
  check(a.stackHeight === 0 && b.stackHeight === 0, 'notes far apart in time do not stack');
  check(a.x === 100 && b.x === 100, 'and they keep their positions');
}

{
  const a = circle(100, 100, 1000);
  const b = circle(200, 200, 1100);
  applyStacking([a, b], { preempt: 1200, stackLeniency: 0.7, radius: 32 });
  check(a.stackHeight === 0 && b.stackHeight === 0, 'notes far apart in space do not stack');
}

{
  const notes = [0, 1, 2].map((i) => circle(256, 192, 1000 + i * 80));
  applyStacking(notes, { preempt: 900, stackLeniency: 0.7, radius: 32 });
  check(notes[0].stackHeight === 2 && notes[1].stackHeight === 1 && notes[2].stackHeight === 0,
    `a triple stack is 2,1,0 (${notes.map((n) => n.stackHeight).join(',')})`);
  check(notes[0].x < notes[1].x && notes[1].x < notes[2].x,
    'each earlier note sits further up-left');
  const spread = Math.hypot(notes[2].x - notes[0].x, notes[2].y - notes[0].y);
  check(spread > 8, `the pile is visibly spread (${spread.toFixed(1)}px)`);
}

{
  const a = circle(50, 50, 0);
  applyStacking([a], { preempt: 1200, stackLeniency: 0.7, radius: 32 });
  check(a.x === 50 && a.y === 50, 'a single note is left alone');
}

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall good\n');
