#!/usr/bin/env node
// cli entry point.
//
//   osuterminal                     song select
//   osuterminal <search>            straight into the first match
//   osuterminal <search> -d 3       pick difficulty 3
//   osuterminal --list              print the library
//   osuterminal --calibrate         measure audio offset
//
// flags: --offset <ms>  --relative [--sens <n>]  --songs <dir>

import { readdir, access } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stdout } from 'node:process';
import { Beatmap } from './core/beatmap.mjs';
import { decodeAudio } from './audio/decode.mjs';
import { Game } from './game.mjs';
import { selectSong } from './select.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// config goes in the home directory instead of next to the source, so a global
// install keeps its calibration no matter where you run it from.
const CONFIG = path.join(os.homedir(), '.osuterminal.json');

// where osu keeps beatmaps on each platform
function defaultSongsDir() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA)
    return path.join(process.env.LOCALAPPDATA, 'osu!', 'Songs');
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'osu!', 'Songs');
  return path.join(os.homedir(), '.local', 'share', 'osu!', 'Songs');
}

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
    offset: cfg.audioOffsetMs ?? 0,
    sens: cfg.sensitivity ?? 1.0,
    aimMode: cfg.aimMode ?? 'absolute',
    songs: cfg.songsDir ?? defaultSongsDir(),
    offsetFromConfig: cfg.audioOffsetMs !== undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-d' || a === '--diff') out.diff = Number(argv[++i]);
    else if (a === '--offset') { out.offset = Number(argv[++i]); out.offsetFromConfig = false; }
    else if (a === '--sens') out.sens = Number(argv[++i]);
    else if (a === '--relative') out.aimMode = 'relative';
    else if (a === '--absolute') out.aimMode = 'absolute';
    else if (a === '--songs') out.songs = argv[++i];
    else if (a === '--list' || a === '-l') out.list = true;
    else if (a === '--calibrate' || a === '-c') out.calibrate = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else out.terms.push(a);
  }
  return out;
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

async function loadLibrary(songsDir) {
  let dirs;
  try { dirs = await readdir(songsDir, { withFileTypes: true }); }
  catch {
    throw new Error(`Cannot read the songs folder:\n  ${songsDir}\n\n` +
      `Point somewhere else with  --songs <dir>  (it will be remembered).`);
  }

  const maps = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(songsDir, d.name);
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
${bold('osuterminal')}  osu!standard in your terminal

  ${bold('osuterminal')}                  interactive song select
  ${bold('osuterminal <search>')}         jump into the first matching map
  ${bold('osuterminal <search> -d 3')}    ...choosing the 3rd difficulty
  ${bold('osuterminal --list')}           print your library
  ${bold('osuterminal --calibrate')}      measure your audio offset ${dim('(do this first)')}

${bold('options')}
  -d, --diff <n>     difficulty index within the matched set
      --offset <ms>  audio offset override
      --relative     relative aim instead of absolute ${dim('(cursor stops tracking your mouse)')}
      --sens <n>     sensitivity, relative mode only
      --songs <dir>  beatmap folder ${dim('(remembered)')}
  -l, --list         list maps and exit
  -h, --help         this

${bold('in game')}
  z / x / mouse      hit          space  pause
  + / -              nudge offset q      quit

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

  const maps = await loadLibrary(args.songs);
  if (!maps.length) throw new Error(`No osu!standard maps found under:\n  ${args.songs}`);

  if (args.list) return printList(maps);

  let chosen;
  const q = args.terms.join(' ').toLowerCase();
  if (q) {
    const matches = maps
      .filter((b) => `${b.artist} ${b.title} ${b.diffName} ${b.creator}`.toLowerCase().includes(q))
      .sort((a, b) => a.difficulty.ar - b.difficulty.ar);
    if (!matches.length) throw new Error(`No map matches "${q}". Try --list, or run with no arguments to browse.`);
    chosen = matches[clampIndex((args.diff ?? 1) - 1, matches.length)];
  } else {
    if (!stdout.isTTY) throw new Error('Song select needs a terminal. Use --list, or pass a search term.');
    chosen = await selectSong(maps);
    if (!chosen) return;                       // backed out of song select
  }

  await play(chosen, args, cfg);
}

const clampIndex = (i, n) => Math.max(0, Math.min(n - 1, i));

async function play(chosen, args, cfg) {
  const d = chosen.difficulty;
  console.log(bold(`\n${chosen.artist} - ${chosen.title}`));
  console.log(`  [${chosen.diffName}] by ${chosen.creator}`);
  console.log(dim(`  CS${d.cs} AR${d.ar} OD${d.od} HP${d.hp}  |  ${chosen.hitObjects.length} objects`));
  console.log(dim(`  300: ±${d.windows.great.toFixed(0)}ms   100: ±${d.windows.ok.toFixed(0)}ms   50: ±${d.windows.meh.toFixed(0)}ms`));

  try { await access(chosen.audioPath); }
  catch { throw new Error(`Audio file missing:\n  ${chosen.audioPath}`); }

  process.stdout.write('\n  decoding audio... ');
  const t0 = Date.now();
  const audio = await decodeAudio(chosen.audioPath);
  console.log(`${(audio.durationMs / 1000).toFixed(0)}s @ ${audio.sampleRate}Hz ${audio.channels}ch (${Date.now() - t0}ms)`);

  if (!stdout.isTTY) throw new Error('Not a TTY. Run this directly in a terminal.');
  if (stdout.columns < 60 || stdout.rows < 20)
    throw new Error(`Terminal too small: ${stdout.columns}x${stdout.rows} (need at least 60x20).`);

  if (args.offsetFromConfig)
    console.log(dim(`\n  audio offset ${args.offset >= 0 ? '+' : ''}${args.offset}ms (calibrated ${cfg.calibratedAt?.slice(0, 10) ?? ''})`));
  else if (args.offset !== 0)
    console.log(dim(`\n  audio offset ${args.offset >= 0 ? '+' : ''}${args.offset}ms (--offset)`));
  else
    console.log(`\n  \x1b[33mno calibration\x1b[0m${dim(' - if timing feels off, run  osuterminal --calibrate')}`);

  console.log(dim(`  aim: ${args.aimMode}${args.aimMode === 'relative'
    ? ` (sens ${args.sens})` : ' - cursor tracks your mouse'}`));
  console.log(dim('\n  z / x / mouse buttons to hit    space pause    +/- offset    q quit'));
  await new Promise((r) => setTimeout(r, 1200));

  const game = new Game(chosen, { audioOffsetMs: args.offset, sensitivity: args.sens, aimMode: args.aimMode });

  process.stdout.write('  loading hitsounds... ');
  const h0 = Date.now();
  await game.prepareAudio(audio.sampleRate);
  const hs = game.hitsoundStats;
  console.log(`${hs.loaded} from map, ${hs.synthesized} synthesized (${Date.now() - h0}ms)`);

  const result = await game.run(audio);

  const c = result.counts;
  console.log(bold(`\n  ${result.rank}  ${(result.accuracy * 100).toFixed(2)}%`));
  console.log(`  score ${result.score}   max combo ${result.maxCombo}x`);
  console.log(`  300:${c.GREAT}  100:${c.OK}  50:${c.MEH}  miss:${c.MISS}`);
  console.log(dim(`  mean timing error ${result.meanError >= 0 ? '+' : ''}${result.meanError.toFixed(1)}ms ` +
    `${Math.abs(result.meanError) > 8 ? `- try --offset ${Math.round(args.offset + result.meanError)}` : ''}`));
  console.log();
}

main().catch((e) => { console.error(`\n\x1b[31m${e.message}\x1b[0m\n`); process.exit(1); });
