// ranking grades (osu!standard table) and the results screen layout / keys.

import { EventEmitter } from 'node:events';
import proc from 'node:process';
import { Framebuffer } from '../src/render/framebuffer.mjs';
import {
  rankFromCounts, rankColour, accuracyFromCounts,
} from '../src/grade.mjs';
import {
  drawResult, showResult, resultActionForKey, formatScore, rankLetters,
} from '../src/result.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const c = (GREAT, OK, MEH, MISS) => ({ GREAT, OK, MEH, MISS });

console.log('\n=== osu!standard grades ===');

check(rankFromCounts(c(0, 0, 0, 0)) === 'SS', 'empty play is SS');
check(rankFromCounts(c(100, 0, 0, 0)) === 'SS', '100% 300s is SS');
check(accuracyFromCounts(c(100, 0, 0, 0)) === 1, '100% accuracy');

// 91×300 + 9×100, no miss: p300=0.91, p50=0 → S. accuracy 94%.
check(rankFromCounts(c(91, 9, 0, 0)) === 'S', '91% 300s and no 50s/miss is S');
check(Math.abs(accuracyFromCounts(c(91, 9, 0, 0)) - 0.94) < 1e-9, 'that play is 94%');

// same 300 ratio but a miss: over 90% 300s → A
check(rankFromCounts(c(91, 8, 0, 1)) === 'A', '91% 300s with a miss is A');

// 90% 300s exactly is not "over 90%", no miss, p300=0.9 → A via >80% no miss
check(rankFromCounts(c(90, 10, 0, 0)) === 'A', 'exactly 90% 300s is A, not S');

// 85% 300s, no miss → A
check(rankFromCounts(c(85, 15, 0, 0)) === 'A', '85% 300s FC is A');

// 85% 300s WITH a miss → B (over 80% 300s)
check(rankFromCounts(c(85, 14, 0, 1)) === 'B', '85% 300s with a miss is B');

// 75% 300s, no miss → B
check(rankFromCounts(c(75, 25, 0, 0)) === 'B', '75% 300s FC is B');
check(rankFromCounts(c(75, 24, 0, 1)) === 'C', '75% 300s with a miss is C');

check(rankFromCounts(c(65, 35, 0, 0)) === 'C', '65% 300s is C');
check(rankFromCounts(c(50, 20, 10, 20)) === 'D', '50% 300s is D');

// at most 1% 50s for S
check(rankFromCounts(c(98, 1, 1, 0)) === 'S', '1% 50s still S');
check(rankFromCounts(c(97, 1, 2, 0)) === 'A', '2% 50s drops to A');

check(rankColour('S').hex === rankColour('SS').hex, 'S and SS share gold');
check(rankColour('A').rgb[1] > rankColour('A').rgb[0], 'A is green');
check(rankColour('B').rgb[2] > rankColour('B').rgb[0], 'B is blue');
check(rankColour('D').rgb[0] > rankColour('D').rgb[1], 'D is red');
check(rankLetters('SS').join('') === 'SS', 'SS is two S glyphs');
check(rankLetters('A').join('') === 'A', 'A is one glyph');
check(formatScore(1234567) === '1,234,567', 'score groups thousands');

console.log('\n=== results screen ===');

const map = { artist: 'nekodex', title: 'circles!', diffName: 'Normal' };
const summary = {
  rank: 'S', score: 1234567, maxCombo: 142, accuracy: 0.94,
  counts: c(91, 9, 0, 0), meanError: 4.2,
};

const fbText = (fb) => {
  let s = '';
  for (let i = 0; i < fb.txtChar.length; i++) {
    if (i && i % fb.cols === 0) s += '\n';
    s += fb.txtChar[i] || ' ';
  }
  return s;
};

const countExact = (fb, r, g, b) => {
  let n = 0;
  const p = fb.px;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] === r && p[i + 1] === g && p[i + 2] === b) n++;
  }
  return n;
};

const fb = new Framebuffer(80, 24);
drawResult(fb, map, summary);
const text = fbText(fb);
check(text.includes('nekodex - circles!'), 'song title is on the panel');
check(text.includes('[Normal]'), 'difficulty is on the panel');
{
  const modsFb = new Framebuffer(80, 24);
  drawResult(modsFb, map, { ...summary, mods: 'HDHR' });
  check(fbText(modsFb).includes('+HDHR'), 'results show the mods that were on');
}
check(text.includes('94.00%'), 'accuracy percentage is shown');
check(text.includes('1,234,567'), 'score is shown');
check(text.includes('142x'), 'max combo is shown');
check(text.includes('FC'), 'no-miss play shows FC');
check(text.includes('300') && text.includes('91'), '300 count is shown');
check(text.includes('miss') && text.includes('0'), 'miss count is shown');
check(text.includes('+4ms'), 'mean error is shown');
check(text.includes('r retry'), 'footer has retry');
check(text.includes('song select'), 'footer has song select');

const gold = rankColour('S').rgb;
check(countExact(fb, ...gold) > 80, `gold S pixels are drawn (${countExact(fb, ...gold)})`);

{
  const a = new Framebuffer(80, 24);
  drawResult(a, map, { ...summary, rank: 'A', accuracy: 0.91, counts: c(85, 15, 0, 0) });
  const green = rankColour('A').rgb;
  check(countExact(a, ...green) > 80, 'green A pixels are drawn');
  check(fbText(a).includes('91.00%'), 'A panel still shows accuracy');
}
{
  const d = new Framebuffer(80, 24);
  drawResult(d, map, { ...summary, rank: 'D', accuracy: 0.42, counts: c(10, 10, 10, 70), maxCombo: 3 });
  const red = rankColour('D').rgb;
  check(countExact(d, ...red) > 80, 'red D pixels are drawn');
  check(!fbText(d).includes('FC'), 'a map with misses is not FC');
}
{
  const ss = new Framebuffer(80, 24);
  drawResult(ss, map, { ...summary, rank: 'SS', accuracy: 1, counts: c(100, 0, 0, 0), maxCombo: 100 });
  check(fbText(ss).includes('PERFECT'), '100% shows PERFECT');
  check(fbText(ss).includes('100.00%'), 'SS panel shows 100%');
  const goldPx = countExact(ss, ...gold);
  check(goldPx > countExact(fb, ...gold), `SS uses more gold pixels than S (${goldPx})`);
}

check(resultActionForKey('r') === 'retry', 'r retries');
check(resultActionForKey('R') === 'retry', 'R retries');
check(resultActionForKey('\r') === 'menu', 'enter goes to song select');
check(resultActionForKey('q') === 'menu', 'q goes to song select');
check(resultActionForKey('\x1b') === 'menu', 'esc goes to song select');
check(resultActionForKey('\x03') === 'quit', 'ctrl+c quits');
check(resultActionForKey('w') === null, 'other keys are ignored');

console.log('\n=== results keys ===');

const realIn = proc.stdin, realOut = proc.stdout;
const fin = new EventEmitter();
fin.setRawMode = () => {};
fin.resume = () => {};
const fout = new EventEmitter();
fout.write = () => true;
fout.columns = 80;
fout.rows = 24;
Object.defineProperty(proc, 'stdin', { value: fin, configurable: true });
Object.defineProperty(proc, 'stdout', { value: fout, configurable: true });

{
  const p = showResult(map, summary);
  fin.emit('data', Buffer.from('r'));
  const r = await p;
  check(r?.type === 'retry', 'r on the live screen returns retry');
}
{
  const p = showResult(map, summary);
  fin.emit('data', Buffer.from('\r'));
  const r = await p;
  check(r?.type === 'menu', 'enter on the live screen returns menu');
}
{
  const p = showResult(map, summary);
  fin.emit('data', Buffer.from('\x03'));
  const r = await p;
  check(r?.type === 'quit', 'ctrl+c on the live screen returns quit');
}

Object.defineProperty(proc, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(proc, 'stdout', { value: realOut, configurable: true });

console.log(`\n${failures === 0 ? '\x1b[1;32mall checks passed\x1b[0m' : `\x1b[1;31m${failures} failure(s)\x1b[0m`}\n`);
process.exit(failures ? 1 : 0);
