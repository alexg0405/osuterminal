// drives song select with a fake stdin/stdout so the key handling can be checked
// without a terminal. mostly here because the browse/search mode split is easy to
// break in a way you only notice by hand.

import { EventEmitter } from 'node:events';
import proc from 'node:process';

const realIn = proc.stdin, realOut = proc.stdout;

// console.log goes through process.stdout, which this test replaces, so results have to
// be written at the real one or they vanish into the fake buffer
const say = (m) => realOut.write(m + '\n');
const ok = (c, m) => say(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };
const fin = new EventEmitter();
fin.setRawMode = () => {}; fin.resume = () => {};
let frame = '';
const fout = new EventEmitter();
fout.write = (s) => { frame = s; return true; };
fout.columns = 120; fout.rows = 30;

Object.defineProperty(proc, 'stdin', { value: fin, configurable: true });
Object.defineProperty(proc, 'stdout', { value: fout, configurable: true });

const { Beatmap } = await import('../src/core/beatmap.mjs');
const { selectSong } = await import('../src/select.mjs');

const mk = (artist, title, diff, ar) => Beatmap.parse([
  'osu file format v14', '', '[General]', 'Mode: 0', '',
  '[Metadata]', `Artist:${artist}`, `Title:${title}`, `Version:${diff}`, 'Creator:me', '',
  '[Difficulty]', 'CircleSize:4', 'OverallDifficulty:8', `ApproachRate:${ar}`, 'SliderMultiplier:1.4', '',
  '[TimingPoints]', '0,500,4,2,0,100,1,0', '', '[HitObjects]', '100,100,1000,1,0',
].join('\n'));

const maps = [
  mk('Alpha', 'One', 'Easy', 3), mk('Alpha', 'One', 'Hard', 8),
  mk('Beta', 'Two', 'Normal', 5), mk('Gamma', 'Three', 'Insane', 9),
];

const pending = selectSong(maps);
const key = (s) => fin.emit('data', Buffer.from(s, 'latin1'));
const text = () => frame.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const shows = (t) => text().includes(t);
// the highlighted row is the one drawn with the selection background. a brightness
// code follows it immediately, so skip any escape sequences before the label.
const highlighted = () => {
  const m = /\x1b\[48;2;42;48;64m(?:\x1b\[[0-9;]*m)*\s*([^\x1b]+?)\s*\x1b/.exec(frame);
  return m ? m[1].trim() : null;
};

say('\n=== song select keys ===');
check(shows('w/s song'), 'footer advertises w/s');
check(shows('\\ to search'), 'footer advertises backslash for search');
check(highlighted() === 'Alpha - One', `starts on the first set (${highlighted()})`);

key('s');
check(highlighted() === 'Beta - Two', `s moves down (${highlighted()})`);
key('s');
check(highlighted() === 'Gamma - Three', `s again moves down (${highlighted()})`);
key('w');
check(highlighted() === 'Beta - Two', `w moves up (${highlighted()})`);

key('\x1b[B');
check(highlighted() === 'Gamma - Three', 'down arrow still works');
key('\x1b[A');
check(highlighted() === 'Beta - Two', 'up arrow still works');

key('w');
check(highlighted() === 'Alpha - One', 'back at the top');
key('d');
check(shows('Hard'), 'd moves to the next difficulty');
key('a');
check(shows('Easy'), 'a moves back');

// search mode
key('\\');
check(shows('typing a filter'), 'backslash opens search');
key('g'); key('a');
check(text().includes('Gamma') && !text().includes('Beta'), 'typing filters the list');
check(!shows('w/s song'), 'movement hints hidden while typing');

key('\x7f');
check(text().includes('Gamma'), 'backspace deletes one character while searching');

key('\r');
check(shows('w/s song'), 'enter leaves search mode');
const before = highlighted();
key('s');
check(highlighted() !== before || shows('w/s song'), 's is movement again, not text');

key('\x7f');
check(text().includes('Beta'), 'backspace in browse mode clears the whole filter');

key('\x1b');
const result = await pending;
check(result === null, 'esc in browse mode quits');

// a second run to check enter returns a map, and tab asks for the downloader
{
  const p2 = selectSong(maps);
  key('\r');
  const r = await p2;
  check(r?.type === 'play' && !!r.map, 'enter returns the highlighted map');
}
{
  const p3 = selectSong(maps);
  key('\t');
  const r = await p3;
  check(r?.type === 'browse', 'tab asks for the downloader');
}

Object.defineProperty(proc, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(proc, 'stdout', { value: realOut, configurable: true });

say(`\n${failures === 0 ? '\x1b[1;32mall checks passed\x1b[0m' : `\x1b[1;31m${failures} failure(s)\x1b[0m`}\n`);
process.exit(failures ? 1 : 0);
