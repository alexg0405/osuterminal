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
  check(a.stackGroup === b.stackGroup && a.stackGroup != null, 'both notes share a stack group');
  check(a.stackSize === 2 && b.stackSize === 2, 'stackSize is 2 for the pair');
}

{
  const a = circle(100, 100, 1000);
  const b = circle(100, 100, 4000);
  applyStacking([a, b], { preempt: 1200, stackLeniency: 0.7, radius: 32 });
  check(a.stackHeight === 0 && b.stackHeight === 0, 'notes far apart in time do not stack');
  check(a.x === 100 && b.x === 100, 'and they keep their positions');
  check(a.stackSize === 1 && b.stackSize === 1, 'they are not grouped');
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
  const expect = 2 * stackOffsetForRadius(32) * Math.SQRT2;
  check(Math.abs(spread - expect) < 1e-6, `the pile spreads ${spread.toFixed(1)}px (two steps)`);
  check(notes.every((n) => n.stackSize === 3), 'all three share stackSize 3');
  check(new Set(notes.map((n) => n.stackGroup)).size === 1, 'all three share one group');
}

{
  const notes = [0, 1, 2, 3, 4].map((i) => circle(256, 192, 1000 + i * 70));
  applyStacking(notes, { preempt: 900, stackLeniency: 0.7, radius: 32 });
  check(notes.every((n) => n.stackSize === 5), 'a 5-stack is one group of 5');
  check(notes[0].stackHeight === 4 && notes[4].stackHeight === 0, 'heights run 4..0');
}

{
  const a = circle(50, 50, 0);
  applyStacking([a], { preempt: 1200, stackLeniency: 0.7, radius: 32 });
  check(a.x === 50 && a.y === 50, 'a single note is left alone');
  check(a.stackSize === 1 && a.stackGroup == null, 'a single note has no group');
}

{
  const step = stackOffsetForRadius(32);
  check(step >= 11, `offset is at least 11 osu-px (got ${step.toFixed(1)})`);
  check(step >= 32 / 2.6 - 1e-9, 'offset is about a third of the circle');
}

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall good\n');
