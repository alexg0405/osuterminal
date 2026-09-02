// where maps live, and how the library is assembled.
//
// downloads go to ~/osuterminal/Songs. the osu! Songs folder is only scanned
// when they opt in — we never create it, and we never copy maps out of it.

import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function defaultSongsDir() {
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

// true when the folder exists and has at least one real song directory inside.
// an empty leftover we accidentally created does not count.
export function osuSongsPresent(dir = osuSongsDir()) {
  try {
    if (!existsSync(dir)) return false;
    const ents = readdirSync(dir, { withFileTypes: true });
    return ents.some((e) => e.isDirectory() && !e.name.startsWith('.'));
  } catch {
    return false;
  }
}

// osuterminal usesongs  /  --import-osu  turn the osu! Songs scan on.
export function parseImportOsuArg(a) {
  const s = String(a).toLowerCase();
  if (s === 'usesongs' || s === 'use-songs' || s === '--usesongs' || s === '--import-osu') return 'on';
  if (s === '--no-import-osu' || s === '--no-usesongs') return 'off';
  return null;
}

export function libraryRoots({ bundledDir, songsDir, importOsu = false } = {}) {
  const roots = [];
  const seen = new Set();
  const add = (dir) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    roots.push(dir);
  };
  add(bundledDir);
  add(songsDir);
  if (importOsu) add(osuSongsDir());
  return roots;
}

export function mapIdentity(b) {
  return `${b.artist}\0${b.title}\0${b.diffName}\0${b.creator ?? ''}`.toLowerCase();
}

export function mergeMaps(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const b of list) {
      const k = mapIdentity(b);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(b);
    }
  }
  return out;
}
