// .osz extraction.
//
// a .osz is just a zip with .osu files, audio and images in it. we don't need most of
// that, so video and storyboard files get skipped to save space. they're usually the
// biggest thing in the archive and nothing here can display them.

import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// stuff we actually use
const KEEP = /\.(osu|mp3|ogg|wav|jpg|jpeg|png)$/i;
// video and storyboard, always skipped
const SKIP = /\.(mp4|avi|flv|wmv|mov|mkv|osb)$/i;

// windows filename rules are stricter than zip entry names, so clean them up
function safeName(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, 120) || 'unnamed';
}

// a zip entry can say ../../ and escape the folder. don't let it.
function safeEntryPath(entry) {
  const parts = entry.split(/[\\/]/).filter((p) => p && p !== '.' && p !== '..');
  if (!parts.length) return null;
  return parts.map(safeName).join(path.sep);
}

export function folderNameFor(setId, artist, title) {
  return safeName(`${setId} ${artist} - ${title}`);
}

/**
 * unpack a .osz into songsDir. returns where it went and what was written.
 */
export async function extractOsz(buffer, songsDir, { setId, artist, title } = {}) {
  const { unzipSync } = await import('fflate');

  let files;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch (e) {
    throw new Error(`could not unzip the beatmap: ${e.message}`);
  }

  const names = Object.keys(files);
  if (!names.length) throw new Error('the archive was empty');

  // name the folder the way osu does, falling back to whatever is in the archive
  let folder;
  if (setId && artist && title) {
    folder = folderNameFor(setId, artist, title);
  } else {
    const anyOsu = names.find((n) => n.toLowerCase().endsWith('.osu'));
    folder = safeName(anyOsu ? path.basename(anyOsu, '.osu') : `beatmap-${Date.now()}`);
  }

  const dest = path.join(songsDir, folder);
  await mkdir(dest, { recursive: true });

  const written = [];
  let skipped = 0, bytes = 0;

  for (const name of names) {
    if (name.endsWith('/') || name.endsWith('\\')) continue;
    if (SKIP.test(name) || !KEEP.test(name)) { skipped++; continue; }

    const rel = safeEntryPath(name);
    if (!rel) { skipped++; continue; }

    const target = path.join(dest, rel);
    if (!target.startsWith(dest)) { skipped++; continue; }   // paranoia

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, files[name]);
    written.push(rel);
    bytes += files[name].length;
  }

  const osuCount = written.filter((f) => f.toLowerCase().endsWith('.osu')).length;
  if (!osuCount) throw new Error('no .osu files in the archive');

  return { dir: dest, folder, written, osuCount, skipped, bytes };
}

/** true if a set with this id is already in the songs folder */
export async function alreadyHave(songsDir, setId) {
  try {
    const dirs = await readdir(songsDir, { withFileTypes: true });
    const prefix = String(setId) + ' ';
    return dirs.some((d) => d.isDirectory() && (d.name === String(setId) || d.name.startsWith(prefix)));
  } catch {
    return false;
  }
}
