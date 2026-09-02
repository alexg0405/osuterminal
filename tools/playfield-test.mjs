// notes at the top and bottom of the 512x384 field used to clip: centres fit,
// but the disc (and the HUD) stuck out past the terminal.

import { Playfield, HUD_PAD_TOP, HUD_PAD_BOTTOM } from '../src/render/playfield.mjs';
import { Difficulty } from '../src/core/beatmap.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const CS4 = new Difficulty({ cs: 4 }).radius;

function discFits(pf, x, y, radius, fbW, fbH, slop = 0.6) {
  const r = pf.len(radius);
  const cx = pf.sx(x), cy = pf.sy(y);
  return {
    top: cy - r >= pf.padTop - slop,
    bottom: cy + r <= fbH - pf.padBottom + slop,
    left: cx - r >= -slop,
    right: cx + r <= fbW + slop,
    cx, cy, r,
  };
}

console.log('\n=== playfield vertical fit ===');

for (const [cols, rows] of [[80, 24], [120, 30], [60, 20]]) {
  const fbW = cols, fbH = rows * 2;
  const pf = new Playfield(fbW, fbH, { radius: CS4 });
  const top = discFits(pf, 256, 0, CS4, fbW, fbH);
  const bot = discFits(pf, 256, 384, CS4, fbW, fbH);
  const left = discFits(pf, 0, 192, CS4, fbW, fbH);
  const right = discFits(pf, 512, 192, CS4, fbW, fbH);
  check(top.top, `${cols}x${rows}: note at y=0 stays below the HUD (cy-r=${(top.cy - top.r).toFixed(1)})`);
  check(bot.bottom, `${cols}x${rows}: note at y=384 stays above the footer (cy+r=${(bot.cy + bot.r).toFixed(1)} of ${fbH})`);
  check(left.left && right.right, `${cols}x${rows}: left/right edge notes stay on screen`);
  check(pf.oy >= HUD_PAD_TOP - 0.01, `${cols}x${rows}: playfield starts below the title row`);
  check(pf.oy + pf.h <= fbH - HUD_PAD_BOTTOM + 0.01,
    `${cols}x${rows}: playfield ends above the combo row`);
}

{
  const fbW = 80, fbH = 48;
  const oldScale = Math.min(fbW / 512, fbH / 384) * 0.94;
  const oldOy = (fbH - 384 * oldScale) / 2;
  const oldTop = oldOy - CS4 * oldScale;
  check(oldTop < 0, `old mapping did clip at the top (y=${oldTop.toFixed(1)})`);
  const pf = new Playfield(fbW, fbH, { radius: CS4 });
  check(pf.sy(0) - pf.len(CS4) >= HUD_PAD_TOP - 0.6, 'new mapping does not clip a CS4 circle at y=0');
  check(pf.sy(384) + pf.len(CS4) <= fbH - HUD_PAD_BOTTOM + 0.6, 'new mapping does not clip a CS4 circle at y=384');
}

{
  const pf = new Playfield(80, 48, { radius: CS4 });
  const c = pf.toOsu(pf.sx(256), pf.sy(192));
  check(Math.abs(c.x - 256) < 0.01 && Math.abs(c.y - 192) < 0.01, 'toOsu round-trips the centre');
}

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall good\n');
