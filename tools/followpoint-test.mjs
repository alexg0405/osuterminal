// follow points match osu!stable spacing. no game.mjs / Win32.

import { Framebuffer } from '../src/render/framebuffer.mjs';
import { Playfield } from '../src/render/playfield.mjs';
import {
  FOLLOW_POINT_SPACING, shouldDrawFollowPoints, followPointsBetween,
  followPointAlpha, followPointSpacingOsu, drawFollowPoints, objectEndPos,
} from '../src/render/followpoint.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const a = (over = {}) => ({ x: 100, y: 100, time: 1000, endTime: 1000, combo: 1, ...over });
const b = (over = {}) => ({ x: 300, y: 100, time: 1400, endTime: 1400, combo: 2, ...over });

console.log('\n=== follow point rules ===');
check(FOLLOW_POINT_SPACING === 32, 'spacing is osu!stable 32 osu px');
check(shouldDrawFollowPoints(a(), b()), 'connects two notes in the same combo');
check(!shouldDrawFollowPoints(a(), b({ combo: 1 })), 'does not connect into a new combo');
check(!shouldDrawFollowPoints(null, b()), 'missing previous object is skipped');

{
  const packed = followPointsBetween(a(), { x: 140, y: 100, time: 1080, combo: 2 });
  check(packed.length === 0, `a 40px stream gap has no follow points (${packed.length})`);
}

{
  const jump = followPointsBetween(a(), b());
  check(jump.length >= 3, `a 200px jump has a trail (${jump.length} points)`);
  check(jump[0].x > 100 && jump[0].x < 300, 'points sit between the two notes');
  check(jump[0].time > 1000 && jump[jump.length - 1].time < 1400, 'point times interpolate');
}

{
  const end = objectEndPos({ kind: 'circle', x: 10, y: 20 });
  check(end.x === 10 && end.y === 20, 'circle end is its centre');
}

check(followPointAlpha(1000, 2000, 600, 400) === 0, 'a point 1s away is still hidden');
check(followPointAlpha(1600, 1600, 600, 400) === 1, 'a point at its time is fully on');
check(followPointAlpha(1750, 1600, 600, 400) === 0, 'a point 150ms past is gone');

check(followPointSpacingOsu(1) === 32, 'full-scale terminals use 32 osu px');
check(followPointSpacingOsu(0.05) > 32, 'tiny terminals space points farther apart');

console.log('\n=== drawing ===');
{
  const fb = new Framebuffer(80, 24);
  fb.clear(8, 8, 14);
  const pf = new Playfield(fb.width, fb.height, { radius: 32 });
  const n = drawFollowPoints(fb, pf, a(), b(), 1200, 600, 400);
  check(n > 0, `jump trail is drawn (${n} dots)`);
  let lit = 0;
  for (let i = 0; i < fb.px.length; i += 3) {
    if (fb.px[i] > 40 && fb.px[i + 1] > 40 && fb.px[i + 2] > 40) lit++;
  }
  check(lit >= 2, `trail pixels are visible (${lit})`);

  const none = drawFollowPoints(fb, pf, a(), b({ combo: 1 }), 1200, 600, 400);
  check(none === 0, 'new-combo pairs draw nothing');
}

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall good\n');
