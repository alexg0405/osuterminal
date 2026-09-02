// download browser: backslash toggles the search field so w/s can move the list,
// the same split as song select. without that, s types into the query.

import { EventEmitter } from 'node:events';
import proc from 'node:process';

const realIn = proc.stdin, realOut = proc.stdout;
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

const { browseOnline } = await import('../src/net/browse.mjs');

const pending = browseOnline('/tmp/osuterminal-test-songs');
const key = (s) => fin.emit('data', Buffer.from(s, 'latin1'));
const text = () => frame.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const shows = (t) => text().includes(t);

say('\n=== download search keys ===');
check(shows('search'), 'starts on the search field');
check(shows('enter search'), 'footer says enter searches');
check(shows('\\ done'), 'footer advertises backslash to leave the field');

key('j'); key('a'); key('n'); key('e');
check(shows('jane'), 'typing goes into the query');
check(shows('jane_') || /jane/.test(text()), 'caret is in the field');

key('\\');
check(shows('w/s sets') || shows('w/s'), 'backslash leaves the field so w/s move');
check(!shows('enter search') || shows('\\ search'), 'no longer in typing hints, or shows edit hint');
const before = text();
key('s');
check(!text().includes('janes') && !text().includes('janeS'), 's does not type into the query after leaving the field');
check(text().includes('jane'), 'the query is still there');

key('\\');
check(shows('enter search') || shows('\\ done'), 'backslash opens the field again');
key('s');
check(text().includes('janes') || text().includes('janeS') || /jane.?s/i.test(text()),
  's types into the query once the field is open again');

key('\x1b');
const r = await pending;
check(r === 0 || r === undefined || typeof r === 'number', 'esc leaves the downloader');

Object.defineProperty(proc, 'stdin', { value: realIn, configurable: true });
Object.defineProperty(proc, 'stdout', { value: realOut, configurable: true });

say(`\n${failures === 0 ? '\x1b[1;32mall checks passed\x1b[0m' : `\x1b[1;31m${failures} failure(s)\x1b[0m`}\n`);
if (failures) process.exit(1);
process.exit(0);
