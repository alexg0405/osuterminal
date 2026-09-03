// hit windows and the 300/100/50/X colour legend. does not import game.mjs.

import { Difficulty, hitWindows } from '../src/core/beatmap.mjs';
import { Framebuffer, comboPixelSize, hudComboPixelSize, comboGlyphSize } from '../src/render/framebuffer.mjs';
import {
  JUDGE, judgementLegend, judgementColour, drawJudgementLegend, drawHitErrorBar,
  ERROR_TICK_FADE_MS, errorTickAlpha, meanError, drawLiveRank,
} from '../src/render/hud.mjs';
import { rankColour } from '../src/grade.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const stable300 = (od) => 80 - 6 * od;

console.log('\n=== hit windows ===');
{
  const w = hitWindows(5);
  check(w.ok === 140 - 8 * 5, 'OD5 100 window matches osu!stable');
  check(w.meh === 200 - 10 * 5, 'OD5 50 window matches osu!stable');
  check(w.great === stable300(5), 'OD5 300 is 80-6*OD (±50ms)');
  check(w.great === 50, 'OD5 300 is ±50ms');
  check(w.great < w.ok && w.ok < w.meh, '300 < 100 < 50');
}
{
  const w = hitWindows(8);
  check(w.great === 32, `OD8 300 is ±32ms (got ${w.great})`);
  check(w.great === stable300(8), 'OD8 300 matches osu!stable');
  check(w.great < w.ok, 'OD8 300 still sits inside 100');
}
{
  const w = hitWindows(10);
  check(w.great === 20, `OD10 300 is ±20ms (got ${w.great})`);
  check(w.great === stable300(10), 'OD10 300 matches osu!stable');
  check(w.great <= w.ok - 8, 'OD10 300 is clamped inside 100');
}
{
  const d = new Difficulty({ od: 4 });
  check(d.windows.great === hitWindows(4).great, 'Difficulty.windows uses hitWindows');
}

console.log('\n=== judgement legend ===');
{
  const { parts, str, swatch } = judgementLegend({ GREAT: 38, OK: 13, MEH: 3, MISS: 2 });
  check(swatch === '▪', 'legend uses a tiny square');
  check(str === '▪300:38  ▪100:13  ▪50:3  ▪X:2', `legend string is "${str}"`);
  check(parts[0].hex === JUDGE.GREAT.hex, '300 square is blue');
  check(parts[1].hex === JUDGE.OK.hex, '100 square is green');
  check(parts[2].hex === JUDGE.MEH.hex, '50 square is yellow');
  check(parts[3].hex === JUDGE.MISS.hex, 'X square is red');
  check(judgementLegend({ GREAT: 0, OK: 0, MEH: 0, MISS: 0 }).str.includes('▪300:0'),
    'zeros still show the colour key');
}

{
  const fb = new Framebuffer(80, 24);
  fb.clear(8, 8, 14);
  const str = drawJudgementLegend(fb, { GREAT: 38, OK: 13, MEH: 3, MISS: 2 }, 22);
  const row = fb.txtChar.slice(22 * 80, 23 * 80).join('');
  check(row.includes('▪300:38') && row.includes('▪100:13') && row.includes('▪X:2'),
    'footer row contains the coloured counts');
  const start = row.indexOf('▪300:38');
  check(start >= 0 && fb.txtFg[22 * 80 + start] === JUDGE.GREAT.hex,
    '300 swatch cell is drawn in the 300 colour');
  const hundred = row.indexOf('▪100:13');
  check(hundred >= 0 && fb.txtFg[22 * 80 + hundred] === JUDGE.OK.hex,
    '100 swatch cell is drawn in the 100 colour');
  check(str.length < 80, 'legend fits a normal terminal width');
}

console.log('\n=== hit error bar zones ===');
{
  const w = hitWindows(5);
  check(judgementColour(0, w) === JUDGE.GREAT.colour, 'dead centre is a 300');
  check(judgementColour(w.great, w) === JUDGE.GREAT.colour, 'on the 300 edge is still a 300');
  check(judgementColour(w.great + 1, w) === JUDGE.OK.colour, 'just outside 300 is a 100');
  check(judgementColour(w.ok + 1, w) === JUDGE.MEH.colour, 'outside 100 is a 50');

  const fb = new Framebuffer(80, 24);
  fb.clear(8, 8, 14);
  const { x0, y, barW } = drawHitErrorBar(fb, [], w);
  const pix = (x) => {
    const i = (y * fb.width + x) * 3;
    return [fb.px[i], fb.px[i + 1], fb.px[i + 2]];
  };
  const mid = pix(x0 + (barW >> 1));
  check(mid[0] > 180 && mid[1] > 180 && mid[2] > 180, 'centre tick is white');
  const inner = pix(x0 + (barW >> 1) - 2);
  const edge = pix(x0 + 1);
  check(inner[2] > inner[1] && inner[2] > inner[0], 'near-centre track is blue (300 zone)');
  check(edge[0] > edge[2], 'outer track is yellow (50 zone)');

  drawHitErrorBar(fb, [0], w);
  const hit = pix(x0 + (barW >> 1));
  check(hit[2] > 180 && hit[0] < 150, 'a perfect hit paints a blue tick on the centre');
}

console.log('\n=== hit error ticks fade ===');
{
  const w = hitWindows(5);
  check(errorTickAlpha(0, 9999) === 1, 'a bare number is always live');
  check(errorTickAlpha({ dt: 0, at: 1000 }, 1000) === 1, 'a fresh tick is fully opaque');
  check(errorTickAlpha({ dt: 0, at: 0 }, ERROR_TICK_FADE_MS) === 0, 'a tick older than the fade window is gone');
  check(errorTickAlpha({ dt: 0, at: 0 }, ERROR_TICK_FADE_MS / 2) === 0.5, 'halfway through the fade is half alpha');
  check(meanError([{ dt: -10, at: 0 }, { dt: 10, at: 1 }]) === 0, 'meanError uses dt, not timestamps');
  check(meanError([4, 8]) === 6, 'meanError still accepts bare numbers');

  const fb = new Framebuffer(80, 24);
  fb.clear(8, 8, 14);
  const empty = drawHitErrorBar(fb, [], w);
  const pix = (x) => {
    const i = (empty.y * fb.width + x) * 3;
    return [fb.px[i], fb.px[i + 1], fb.px[i + 2]];
  };
  const mid = empty.x0 + (empty.barW >> 1);
  const rest = pix(mid);

  fb.clear(8, 8, 14);
  drawHitErrorBar(fb, [{ dt: 0, at: 0 }], w, 0);
  const fresh = pix(mid);
  check(fresh[2] > rest[2] && fresh[0] < rest[0], 'a fresh centre hit is bluer than the track');

  fb.clear(8, 8, 14);
  drawHitErrorBar(fb, [{ dt: 0, at: 0 }], w, ERROR_TICK_FADE_MS + 50);
  const expired = pix(mid);
  check(expired[0] === rest[0] && expired[1] === rest[1] && expired[2] === rest[2],
    'an expired tick leaves the track untouched');
}

console.log('\n=== live rank ===');
{
  const fb = new Framebuffer(80, 24);
  fb.clear(8, 8, 14);
  const ss = drawLiveRank(fb, { GREAT: 0, OK: 0, MEH: 0, MISS: 0 });
  check(ss.rank === 'SS' && ss.row === 0, 'starts as SS on the top row');
  check(ss.col === 80 - 2 - 1, 'SS is right-aligned');
  check(fb.txtChar[ss.col] === 'S' && fb.txtChar[ss.col + 1] === 'S', 'SS glyphs are drawn');
  check(fb.txtFg[ss.col] === rankColour('SS').hex, 'SS is gold');

  const a = drawLiveRank(fb, { GREAT: 85, OK: 15, MEH: 0, MISS: 0 });
  check(a.rank === 'A', '85% 300s FC is A live');
  check(a.col === 80 - 1 - 1, 'A is one column in from the right edge');
  check(fb.txtChar[a.col] === 'A', 'A sits in the top-right');
  check(fb.txtFg[a.col] === rankColour('A').hex, 'A is green');

  const d = drawLiveRank(fb, { GREAT: 10, OK: 10, MEH: 10, MISS: 70 });
  check(d.rank === 'D' && fb.txtFg[d.col] === rankColour('D').hex, 'D is red');
}

console.log('\n=== HUD combo ===');
{
  check(hudComboPixelSize(24) === 2, '24-row terminals get 2px glyphs');
  check(hudComboPixelSize(50) === 3, 'tall terminals cap at 3px');
  check(hudComboPixelSize(24) < 3, 'HUD combo is smaller than the old 3–5px scale');
  check(hudComboPixelSize(50) > comboPixelSize(30), 'HUD combo is still bigger than on-circle labels');
  check(comboGlyphSize('8', 2).w === 10 && comboGlyphSize('8', 2).h === 14, 'one digit at 2px is 10×14');
  check(comboGlyphSize('128', 2).w === 34, 'three digits at 2px are 34 wide');

  const fb = new Framebuffer(80, 24);
  fb.clear(8, 8, 14);
  fb.text(3, fb.rows - 1, 'xxx', 0xffffff);
  fb.text(fb.cols - 9, fb.rows - 1, 'esc pause', 0x5a6272);
  const box = fb.drawHudCombo(128, 0xffd257);
  check(box.pixelSize === 2, `drawn HUD combo uses ${box.pixelSize}px glyphs`);
  check(box.x0 <= 2, 'combo sits on the left');
  check(box.y0 + box.h === fb.height, 'combo sits flush with the bottom');
  check(box.h === 14, 'combo is 14 pixels tall');

  let gold = 0;
  for (let y = box.y0; y < box.y0 + box.h; y++) {
    for (let x = box.x0; x < box.x0 + box.w; x++) {
      const i = (y * fb.width + x) * 3;
      if (fb.px[i] > 200 && fb.px[i + 1] > 180 && fb.px[i + 2] < 120) gold++;
    }
  }
  check(gold > 40, `gold combo ink is present (${gold} px)`);
  check(fb.txtChar[(fb.rows - 1) * 80 + 3] === 0, 'HUD text under the combo is cleared');
  check(fb.txtChar[(fb.rows - 1) * 80 + fb.cols - 9] === 'e', 'help text on the right survives');
}

console.log(`\n${failures === 0 ? '\x1b[1;32mall checks passed\x1b[0m' : `\x1b[1;31m${failures} failure(s)\x1b[0m`}\n`);
process.exit(failures ? 1 : 0);
