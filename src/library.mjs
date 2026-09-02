// where maps live.
//
// downloads and anything we create go in ~/osuterminal/Songs. if the user already
// has osu! installed we still *read* that Songs folder, but we never mkdir it —
// creating %LOCALAPPDATA%\osu!\Songs made it look like we were pretending to be
// osu, and people without osu! didn't want a fake install sitting there.

import { readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Beatmap } from './core/beatmap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BUNDLED_SONGS = path.join(HERE, '..', 'bundled');

export function userSongsDir() {
  return path.join(os.homedir(), 'osuterminal', 'Songs');
}

export function osuSongsDir() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA)
    return path.join(process.env.LOCALAPPDATA, 'osu!', 'Songs');
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'osu!', 'Songs');
  return path.join(os.homedir(), '.local', 'share', 'osu!', 'Songs');
}

export function sameDir(a, b) {
  return path.resolve(a) === path.resolve(b);
}

export function isOsuSongsPath(dir) {
  return sameDir(dir, osuSongsDir());
}

// create our own library folder. never create the osu! path, even if someone
// pointed --songs at it — extract still mkdirs the set folder inside if it exists.
export async function ensureSongsDir(dir) {
  if (isOsuSongsPath(dir)) return dir;
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    throw new Error(`Cannot create the songs folder:\n  ${dir}\n\n` +
      `Point somewhere else with  --songs <dir>  (it will be remembered).`);
  }
  return dir;
}

export async function loadFromDir(root) {
  let dirs;
  try { dirs = await readdir(root, { withFileTypes: true }); }
  catch { return []; }
  const maps = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    let files;
    try { files = await readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.osu')) continue;
      try {
        const b = await Beatmap.load(path.join(dir, f));
        if (b.isStandard && b.hitObjects.length) maps.push(b);
      } catch { /* skip unreadable maps */ }
    }
  }
  return maps;
}

// bundled first, then the writable library, then the real osu! folder if it
// exists and isn't the same path. missing folders just contribute nothing.
export async function loadLibrary(songsDir) {
  await ensureSongsDir(songsDir);
  const maps = [...await loadFromDir(BUNDLED_SONGS), ...await loadFromDir(songsDir)];
  const osu = osuSongsDir();
  if (!sameDir(osu, songsDir)) maps.push(...await loadFromDir(osu));
  return maps;
}
