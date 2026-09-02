// checks that the library stays in ~/osuterminal/Songs, that an existing osu!
// Songs folder can be scanned, and that we never treat osu! as the default dest.

import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import {
  defaultSongsDir, osuSongsDir, osuSongsPresent, isOsuSongsPath,
  libraryRoots, mergeMaps, mapIdentity,
} from '../src/library.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

console.log('\n=== library paths ===');

const homeSongs = defaultSongsDir();
check(homeSongs === path.join(os.homedir(), 'osuterminal', 'Songs'),
  `default songs dir is ~/osuterminal/Songs  (${homeSongs})`);
check(!homeSongs.split(path.sep).includes('osu!'),
  'default songs dir is not inside osu!');
check(path.resolve(homeSongs) !== path.resolve(osuSongsDir()),
  'osu! Songs is a separate path');
check(osuSongsDir().split(path.sep).includes('osu!'),
  `osu! Songs path contains osu!  (${osuSongsDir()})`);
check(isOsuSongsPath(osuSongsDir()), 'isOsuSongsPath recognises the osu! folder');
check(!isOsuSongsPath(homeSongs), 'our library is not the osu! folder');

const bundled = path.join(os.tmpdir(), 'osuterminal-bundled');
const songs = path.join(os.tmpdir(), 'osuterminal-songs');
const off = libraryRoots({ bundledDir: bundled, songsDir: songs, importOsu: false });
check(off.length === 2, 'without import, bundled + songs dir only');
check(!off.some((d) => path.resolve(d) === path.resolve(osuSongsDir())),
  'osu! Songs is not scanned when they opt out');

const on = libraryRoots({ bundledDir: bundled, songsDir: songs, importOsu: true });
check(on.length === 3, 'import adds a third root');
check(on.some((d) => path.resolve(d) === path.resolve(osuSongsDir())),
  'import scans osu! Songs');

const implied = libraryRoots({ bundledDir: bundled, songsDir: songs });
check(implied.some((d) => path.resolve(d) === path.resolve(osuSongsDir())),
  'osu! Songs is scanned by default');

const dup = libraryRoots({ bundledDir: bundled, songsDir: osuSongsDir(), importOsu: true });
check(dup.filter((d) => path.resolve(d) === path.resolve(osuSongsDir())).length === 1,
  'osu! Songs is not listed twice if it is also --songs');

const a = { artist: 'A', title: 'T', diffName: 'Easy', creator: 'me' };
const b = { artist: 'A', title: 'T', diffName: 'Easy', creator: 'me' };
const c = { artist: 'A', title: 'T', diffName: 'Hard', creator: 'me' };
check(mapIdentity(a) === mapIdentity(b), 'same map has the same identity');
check(mergeMaps([a], [b, c]).length === 2, 'duplicate maps from two folders collapse');

const tmp = mkdtempSync(path.join(os.tmpdir(), 'osuterminal-osu-'));
check(!osuSongsPresent(tmp), 'empty folder does not count as an osu! library');
writeFileSync(path.join(tmp, '.hidden'), 'x');
check(!osuSongsPresent(tmp), 'dotfiles alone do not count');
mkdirSync(path.join(tmp, '123 song'));
check(osuSongsPresent(tmp), 'a song folder counts as present');
check(!osuSongsPresent(path.join(tmp, 'does-not-exist')), 'missing folder is not present');
rmSync(tmp, { recursive: true, force: true });

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall good\n');
