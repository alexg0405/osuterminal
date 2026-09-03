// clicks must land on the circle. does not import game.mjs (Win32 via koffi).
import { Difficulty, cursorOnObject } from '../src/core/beatmap.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const r = new Difficulty({ cs: 4 }).radius;
const o = { x: 100, y: 100 };

console.log('\n=== cursor on object ===');
check(cursorOnObject({ x: 100, y: 100 }, o, r), 'centre of the circle is a hit');
check(cursorOnObject({ x: 100 + r, y: 100 }, o, r), 'on the rim is still a hit');
check(!cursorOnObject({ x: 100 + r + 0.5, y: 100 }, o, r), 'just outside the rim is ignored');
check(!cursorOnObject({ x: 100 + r * 3, y: 100 }, o, r), 'a click far away is ignored');
check(!cursorOnObject({ x: 256, y: 192 }, o, r), 'playfield centre does not hit a corner note');
check(cursorOnObject(null, o, r), 'a missing cursor skips the check');
check(cursorOnObject(undefined, o, r), 'undefined cursor skips the check');

{
  const cs8 = new Difficulty({ cs: 8 }).radius;
  check(cs8 < r, 'higher CS has a smaller disc');
  check(cursorOnObject({ x: 100 + cs8 * 0.99, y: 100 }, o, cs8), 'CS8 still hits inside its disc');
  check(!cursorOnObject({ x: 100 + r, y: 100 }, o, cs8), 'a CS4-rim click misses a CS8 circle');
}

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall good\n');
