#!/usr/bin/env node
// cli entry point.
//
//   osuterminal                     song select
//   osuterminal <search>            straight into the first match
//   osuterminal <search> -d 3       pick difficulty 3
//   osuterminal --list              print the library
//   osuterminal --calibrate         measure audio offset
//   osuterminal usesongs            include maps from the osu! Songs folder
//   osuterminal --no-import-osu     skip the osu! Songs folder
//
// flags: --offset <ms>  --volume <n>  --relative [--sens <n>]  --songs <dir>

import { readdir, access, mkdir } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stdout, stdin } from 'node:process';
import { Beatmap } from './core/beatmap.mjs';
import { decodeAudio } from './audio/decode.mjs';
import { Game } from './game.mjs';
import { selectSong } from './select.mjs';
import { showResult } from './result.mjs';
import { browseOnline } from './net/browse.mjs';
import { search as searchMirror, download as downloadSet } from './net/mirror.mjs';
import { extractOsz } from './net/osz.mjs';
import { clampVolume, parseVolumeArg } from './volume.mjs';
import {
  defaultSongsDir, osuSongsDir, osuSongsPresent, isOsuSongsPath,
  libraryRoots, mergeMaps, parseImportOsuArg,
} from './library.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// config goes in the home directory instead of next to the source, so a global
// install keeps its calibration no matter where you run it from.
const CONFIG = path.join(os.homedir(), '.osuterminal.json');

function loadConfig() {
  try { return existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {}; }
  catch { return {}; }
}
export function saveConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  return CONFIG;
}

function parseArgs(argv, cfg) {
  const out = {
    terms: [], diff: null, list: false, calibrate: false, help: false,
    online: null, get: null, download: false,
    offset: cfg.audioOffsetMs ?? 0,
    sens: cfg.sensitivity ?? 1.0,
    keys: cfg.keys ?? ['z', 'x'],
    aimMode: cfg.aimMode ?? 'absolute',
    songs: cfg.songsDir ?? defaultSongsDir(),
    importOsu: cfg.importOsu === true,
    importOsuFlag: null,          // 'on' | 'off' when they passed a flag this run
    masterVolume: clampVolume(cfg.masterVolume, 0.8),
    musicVolume: clampVolume(cfg.musicVolume, 1),
    effectVolume: clampVolume(cfg.effectVolume, 1),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-d' || a === '--diff') out.diff = Number(argv[++i]);
    else if (a === '--offset') out.offset = Number(argv[++i]);
    else if (a === '--volume') {
      const v = parseVolumeArg(argv[++i]);
      if (v != null) out.masterVolume = v;
    }
    else if (a === '--sens') out.sens = Number(argv[++i]);
    else if (a === '--relative') out.aimMode = 'relative';
    else if (a === '--absolute') out.aimMode = 'absolute';
    else if (a === '--songs') out.songs = argv[++i];
    else {
      const imp = parseImportOsuArg(a);
      if (imp === 'on') { out.importOsu = true; out.importOsuFlag = 'on'; }
      else if (imp === 'off') { out.importOsu = false; out.importOsuFlag = 'off'; }
      else if (a === '--keys') out.keys = parseKeys(argv[++i]) ?? out.keys;
      else if (a === '--list' || a === '-l') out.list = true;
      else if (a === '--calibrate' || a === '-c') out.calibrate = true;
      else if (a === '--help' || a === '-h') out.help = true;
      else if (a === '--search') out.online = argv[++i];
      else if (a === '--get') out.get = argv[++i];
      else if (a === '--download') out.download = true;
      else out.terms.push(a);
    }
  }
  return out;
}

// accepts "zx", "z,x" or "z x". has to come out as exactly two single characters.
function parseKeys(raw) {
  if (!raw) return null;
  const k = String(raw).toLowerCase().replace(/[,\s]+/g, '').split('');
  return k.length === 2 ? k : null;
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

async function loadFromDir(root) {
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

const BUNDLED = path.join(HERE, '..', 'bundled');

async function ensureSongsDir(songsDir) {
  // never create the osu! Songs path; that is only read when they import.
  if (isOsuSongsPath(songsDir)) return;
  try { await readdir(songsDir); }
  catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      try { await mkdir(songsDir, { recursive: true }); }
      catch {
        throw new Error(`Cannot create the songs folder:\n  ${songsDir}\n\n` +
          `Point somewhere else with  --songs <dir>  (it will be remembered).`);
      }
    } else {
      throw new Error(`Cannot read the songs folder:\n  ${songsDir}\n\n` +
        `Point somewhere else with  --songs <dir>  (it will be remembered).`);
    }
  }
}

async function loadLibrary(songsDir, { importOsu } = {}) {
  await ensureSongsDir(songsDir);
  const lists = [];
  for (const dir of libraryRoots({ bundledDir: BUNDLED, songsDir, importOsu })) {
    lists.push(await loadFromDir(dir));
  }
  return mergeMaps(...lists);
}

async function askImportOsu(osuDir) {
  if (!stdout.isTTY || !stdin.isTTY) return null;
  console.log(`\n  Found an osu! Songs folder:\n  ${dim(osuDir)}\n`);
  console.log('  Include those maps in osuterminal? They stay where they are; nothing is copied.\n');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question('  Import osu! library? [y/N] ');
    return /^\s*y/i.test(answer);
  } finally {
    rl.close();
  }
}

function printList(maps) {
  const bySet = new Map();
  for (const b of maps) {
    const key = `${b.artist} - ${b.title}`;
    if (!bySet.has(key)) bySet.set(key, []);
    bySet.get(key).push(b);
  }
  console.log(bold(`\n${maps.length} osu!standard maps in ${bySet.size} sets\n`));
  for (const [key, list] of [...bySet].sort()) {
    console.log(`  ${bold(key)}`);
    list.sort((a, b) => a.difficulty.ar - b.difficulty.ar);
    list.forEach((b, i) => {
      const d = b.difficulty;
      console.log(dim(`      ${i + 1}. ${b.diffName.padEnd(22)} CS${d.cs} AR${d.ar} OD${d.od}   ${b.hitObjects.length} objects`));
    });
  }
  console.log();
}

function printHelp() {
  console.log(`
${bold('osuterminal')}  unofficial osu!standard in your terminal
  ${dim('not affiliated with ppy Pty Ltd or osu!')}

  ${bold('osuterminal')}                  interactive song select
  ${bold('osuterminal usesongs')}         include your osu! Songs folder ${dim('(remembered)')}
  ${bold('osuterminal <search>')}         jump into the first matching map
  ${bold('osuterminal <search> -d 3')}    ...choosing the 3rd difficulty
  ${bold('osuterminal --download')}       browse and download beatmaps
  ${bold('osuterminal --list')}           print your library
  ${bold('osuterminal --calibrate')}      measure your audio offset

${bold('options')}
  -d, --diff <n>     difficulty index within the matched set
      --keys <ab>    tap keys, default zx ${dim('(remembered)')}
      --relative     relative aim instead of absolute ${dim('(cursor stops tracking your mouse)')}
      --sens <n>     sensitivity, relative mode only
      --offset <ms>  audio offset override ${dim('(default 0, remembered after --calibrate)')}
      --volume <n>   master volume 0–100 ${dim('(remembered)')}
      --songs <dir>  where downloads go ${dim('(default ~/osuterminal/Songs, remembered)')}
      --no-import-osu  stop including the osu! Songs folder
      --search <q>   search the mirrors and print results
      --get <id>     download a beatmap set by id
  -l, --list         list maps and exit
  -h, --help         this

${bold('in game')}
  z / x / mouse      hit
  - / =              master volume
  [ / ]              music volume
  , / .              hitsounds
  esc                pause, then r retry or q song select
  after a map        results: r retry, enter song select
  song select        \\ download more   / filter this list

config: ${dim(CONFIG)}
`);
}

async function main() {
  const cfg = loadConfig();
  const args = parseArgs(process.argv.slice(2), cfg);

  if (args.help) return printHelp();
  if (args.calibrate) {
    // needs pathToFileURL, a plain windows path isn't a valid import specifier
    await import(pathToFileURL(path.join(HERE, '..', 'tools', 'calibrate.mjs')).href);
    return;
  }

  // remember the songs folder so you only have to pass it once
  if (process.argv.includes('--songs')) saveConfig({ songsDir: args.songs });
  if (process.argv.includes('--volume')) saveConfig({ masterVolume: args.masterVolume });

  if (args.importOsuFlag === 'on') saveConfig({ importOsu: true });
  if (args.importOsuFlag === 'off') saveConfig({ importOsu: false });

  // --keys on its own is a settings command: save, say so, done. combined with anything
  // else it just applies to that run as well.
  if (process.argv.includes('--keys')) {
    const raw = process.argv[process.argv.indexOf('--keys') + 1];
    if (!parseKeys(raw)) {
      throw new Error(`--keys needs exactly two characters, like  --keys df\nGot: ${raw ?? '(nothing)'}`);
    }
    saveConfig({ keys: args.keys });
    console.log(`\ntap keys are now ${bold(args.keys[0])} and ${bold(args.keys[1])}` +
      dim(`   saved to ${CONFIG}\n`));
    // "--keys df" and nothing else means they only wanted to set the keys
    if (process.argv.slice(2).length === 2) return;
  }

  if (args.online) return printSearch(args.online);
  if (args.get) return getById(args.get, args.songs);
  if (args.download) {
    if (!stdout.isTTY) throw new Error('The downloader needs a terminal. Use --search and --get instead.');
    const got = await browseOnline(args.songs);
    console.log(got ? `\n  downloaded ${got} set${got === 1 ? '' : 's'}\n` : '\n  nothing downloaded\n');
    return;
  }

  // first launch: if they already have osu! maps, ask once. never on by default.
  if (args.importOsuFlag == null && cfg.importOsu === undefined && osuSongsPresent()) {
    const choice = await askImportOsu(osuSongsDir());
    if (choice != null) {
      args.importOsu = choice;
      saveConfig({ importOsu: choice });
      console.log(choice
        ? dim(`\n  importing from ${osuSongsDir()}  (--no-import-osu to undo)\n`)
        : dim(`\n  skipped.  osuterminal usesongs  later if you change your mind\n`));
    }
  } else if (args.importOsuFlag === 'on' && osuSongsPresent()) {
    console.log(dim(`\n  importing from ${osuSongsDir()}\n`));
  } else if (args.importOsu && !osuSongsPresent()) {
    console.log(`\n  osu! Songs folder not found:\n  ${dim(osuSongsDir())}\n`);
  }

  let maps = await loadLibrary(args.songs, { importOsu: args.importOsu });
  if (args.list) return printList(maps);

  // an empty library used to be a dead end. now it just means you need maps.
  if (!maps.length) {
    console.log(`\n  No osu!standard maps found under:\n  ${dim(args.songs)}\n`);
    if (!args.importOsu && osuSongsPresent()) {
      console.log(`  You have an osu! library at:\n  ${dim(osuSongsDir())}`);
      console.log(`  Include it with  ${bold('osuterminal usesongs')}\n`);
    }
    if (!stdout.isTTY) throw new Error('Run  osuterminal --download  in a terminal to get some.');
    console.log('  Opening the downloader...\n');
    await new Promise((r) => setTimeout(r, 900));
    const got = await browseOnline(args.songs);
    if (!got) return;
    maps = await loadLibrary(args.songs, { importOsu: args.importOsu });
    if (!maps.length) return;
  }

  const q = args.terms.join(' ').toLowerCase();
  let startMap = null;
  if (q) {
    const matches = maps
      .filter((b) => `${b.artist} ${b.title} ${b.diffName} ${b.creator}`.toLowerCase().includes(q))
      .sort((a, b) => a.difficulty.ar - b.difficulty.ar);
    if (!matches.length) throw new Error(`No map matches "${q}". Try --list, or run with no arguments to browse.`);
    startMap = matches[clampIndex((args.diff ?? 1) - 1, matches.length)];
  }

  if (!stdout.isTTY) throw new Error('Song select needs a terminal. Use --list, or pass a search term.');

  if (startMap) {
    const result = await play(startMap, args);
    if (result?.quitApp) return;
  }

  // loop so tab can bounce out to the downloader and q from pause comes back here
  for (;;) {
    const action = await selectSong(maps);
    if (!action) return;
    if (action.type === 'browse') {
      const got = await browseOnline(args.songs);
      if (got) maps = await loadLibrary(args.songs, { importOsu: args.importOsu });
      continue;
    }
    const result = await play(action.map, args);
    if (result?.quitApp) return;
  }
}

const clampIndex = (i, n) => Math.max(0, Math.min(n - 1, i));

async function printSearch(query) {
  process.stdout.write(`  searching for ${bold(query)}... `);
  const { mirror, results } = await searchMirror(query, { limit: 30 });
  console.log(dim(`${results.length} sets from ${mirror}\n`));
  for (const r of results) {
    console.log(`  ${bold(String(r.id).padStart(7))}  ${r.artist} - ${r.title}`);
    const stars = r.diffs.map((d) => d.stars.toFixed(1)).join(' ');
    console.log(dim(`           by ${r.creator}  ${r.bpm}bpm  ${r.status}  ${r.diffs.length} diffs [${stars}]`));
  }
  console.log(`\n  grab one with  ${bold('osuterminal --get <id>')}\n`);
}

async function getById(id, songsDir) {
  if (!/^\d+$/.test(String(id))) throw new Error(`"${id}" is not a beatmap set id.`);
  process.stdout.write(`  downloading ${bold(id)}... `);
  let last = 0;
  const { mirror, buffer } = await downloadSet(id, (got, total) => {
    if (!total || Date.now() - last < 200) return;
    last = Date.now();
    process.stdout.write(`\r  downloading ${bold(id)}... ${Math.floor((got / total) * 100)}%   `);
  });
  console.log(`\r  downloading ${bold(id)}... ${(buffer.length / 1048576).toFixed(1)} MiB from ${mirror}   `);
  const r = await extractOsz(buffer, songsDir, { setId: id });
  console.log(`  saved ${r.osuCount} difficulties to ${dim(r.folder)}\n`);
}

async function play(chosen, args) {
  const d = chosen.difficulty;
  console.log(bold(`\n${chosen.artist} - ${chosen.title}`) + dim(`  [${chosen.diffName}]`));
  console.log(dim(`CS${d.cs} AR${d.ar} OD${d.od}  ${chosen.hitObjects.length} objects`));

  try { await access(chosen.audioPath); }
  catch { throw new Error(`Audio file missing:\n  ${chosen.audioPath}`); }

  process.stdout.write(dim('loading... '));
  const audio = await decodeAudio(chosen.audioPath);

  if (!stdout.isTTY) throw new Error('Not a TTY. Run this directly in a terminal.');
  if (stdout.columns < 60 || stdout.rows < 20)
    throw new Error(`Terminal too small: ${stdout.columns}x${stdout.rows} (need at least 60x20).`);

  const game = new Game(chosen, {
    audioOffsetMs: args.offset, sensitivity: args.sens, aimMode: args.aimMode, keys: args.keys,
    masterVolume: args.masterVolume, musicVolume: args.musicVolume, effectVolume: args.effectVolume,
    onVolume: (v) => saveConfig(v),
  });
  await game.prepareAudio(audio.sampleRate);
  console.log(dim(`${args.keys[0]} / ${args.keys[1]} / mouse to hit   esc pause   -/= volume`));
  await new Promise((r) => setTimeout(r, 700));

  // retry from pause or the results screen replays the same map. q from pause
  // skips results and goes back to song select.
  for (;;) {
    const result = await game.run(audio);
    if (result.restart) { game.reset(); continue; }
    if (result.quitApp) return { quitApp: true };
    if (result.toMenu) return { toMenu: true };
    const next = await showResult(chosen, result);
    if (next?.type === 'retry') { game.reset(); continue; }
    if (next?.type === 'quit') return { quitApp: true };
    return { toMenu: true };
  }
}

main().catch((e) => { console.error(`\n\x1b[31m${e.message}\x1b[0m\n`); process.exit(1); });
