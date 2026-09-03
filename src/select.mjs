// song select.
//
// sets on the left, difficulties of the highlighted set on the right.
//
// two modes. browsing is the default: w/s or up/down move between songs, a/d or
// left/right pick a difficulty. slash opens a filter on this list; slash again
// closes it so w/s move, without clearing the text. backslash (or tab) opens
// the online downloader — that is the search for getting more maps.
//
// this uses plain ANSI instead of the framebuffer because it's all text, and text
// needs real characters rather than half blocks.

import process from 'node:process';
import {
  normalizeMods, toggleHidden, toggleHardRock, modsAcronyms, applyModsToDifficulty,
} from './core/mods.mjs';

const CSI = '\x1b[';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const fg = (hex) => `${CSI}38;2;${(hex >> 16) & 255};${(hex >> 8) & 255};${hex & 255}m`;
const bg = (hex) => `${CSI}48;2;${(hex >> 16) & 255};${(hex >> 8) & 255};${hex & 255}m`;
const RESET = `${CSI}0m`;
const DIM = fg(0x6a7282);
const TEXT = fg(0xc8d0dc);
const BRIGHT = fg(0xffffff);
const ACCENT = fg(0xff66aa);
const GOLD = fg(0xffd257);

// rough difficulty estimate for the colours. real star rating needs the whole pp
// algorithm.
function difficultyTint(b, mods) {
  const d = applyModsToDifficulty(b.difficulty, mods);
  const score = d.ar * 0.5 + d.od * 0.3 + d.cs * 0.2 + Math.min(4, b.hitObjects.length / 250);
  if (score < 5) return fg(0x88dd77);
  if (score < 7) return fg(0x66ccff);
  if (score < 9) return fg(0xffbb44);
  if (score < 11) return fg(0xff6688);
  return fg(0xbb88ff);
}

const pad = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s.padEnd(n));

// returns { type: 'play', map, mods } or { type: 'browse' }, or null if they backed out
export function selectSong(maps, opts = {}) {
  // grabbed here rather than imported at the top, because node:process named exports
  // are bound once at load and cannot be swapped out for a test double
  const stdin = process.stdin;
  const stdout = process.stdout;

  return new Promise((resolve) => {
    // group into sets, easiest difficulty first
    const sets = [];
    const byKey = new Map();
    for (const b of maps) {
      const key = `${b.artist} - ${b.title}`;
      if (!byKey.has(key)) { const s = { key, artist: b.artist, title: b.title, diffs: [] }; byKey.set(key, s); sets.push(s); }
      byKey.get(key).diffs.push(b);
    }
    for (const s of sets) s.diffs.sort((a, b) => a.difficulty.ar - b.difficulty.ar || a.hitObjects.length - b.hitObjects.length);
    sets.sort((a, b) => a.key.localeCompare(b.key));

    let query = '';
    let filtered = sets;
    let setIdx = 0, diffIdx = 0, scroll = 0;
    let done = false;
    let searching = false;    // slash toggles the filter field; the text stays
    let mods = normalizeMods(opts.mods);
    const bumpMods = (next) => {
      mods = next;
      opts.onMods?.(mods);
    };

    const refilter = () => {
      const q = query.toLowerCase();
      filtered = q
        ? sets.filter((s) => (s.key + ' ' + s.diffs.map((d) => d.diffName + ' ' + d.creator).join(' ')).toLowerCase().includes(q))
        : sets;
      setIdx = clamp(setIdx, 0, Math.max(0, filtered.length - 1));
      diffIdx = 0;
      scroll = 0;
    };

    const draw = () => {
      const rows = stdout.rows ?? 24, cols = stdout.columns ?? 80;
      // 5 lines of chrome: title, search, blank, detail, footer
      const listH = Math.max(3, rows - 5);
      // '  ' + left + ' | ' + right must equal cols or the terminal wraps and
      // eats the songs below, which looked like the list just stopping.
      const gutter = 2, div = 3;
      const leftW = Math.max(18, Math.min(48, Math.floor((cols - gutter - div) * 0.58)));
      const rightW = Math.max(0, cols - gutter - div - leftW);

      if (setIdx < scroll) scroll = setIdx;
      if (setIdx >= scroll + listH) scroll = setIdx - listH + 1;
      scroll = clamp(scroll, 0, Math.max(0, filtered.length - listH));

      const out = [`${CSI}H${CSI}J`];
      const from = filtered.length ? scroll + 1 : 0;
      const to = Math.min(filtered.length, scroll + listH);
      const more = filtered.length > to ? `  ${to < filtered.length ? '▼' : ''}` : '';
      const above = scroll > 0 ? '▲ ' : '';
      const tag = modsAcronyms(mods);
      out.push(`${BRIGHT}  osuterminal${RESET}${DIM}   ${filtered.length} set${filtered.length === 1 ? '' : 's'}`);
      if (tag) out.push(`${GOLD}   +${tag}${RESET}`);
      if (filtered.length) out.push(`${DIM}   ${above}${from}-${to}${RESET}${more}`);
      out.push('\r\n');
      out.push(searching ? `   ${ACCENT}/${query}_${RESET}`
        : query ? `   ${ACCENT}/${query}${RESET}${DIM}  / to edit   backspace clears${RESET}`
        : `   ${DIM}\\ to download more   / to filter   h HD   r HR${RESET}`);
      out.push('\r\n');

      const cur = filtered[setIdx];
      for (let i = 0; i < listH; i++) {
        const idx = scroll + i;
        out.push('  ');
        if (idx < filtered.length) {
          const s = filtered[idx];
          const sel = idx === setIdx;
          const label = pad(`${s.artist} - ${s.title}`, Math.max(4, leftW - 2));
          out.push(sel ? `${bg(0x2a3040)}${BRIGHT} ${label} ${RESET}` : `${TEXT} ${label} ${RESET}`);
        } else {
          out.push(' '.repeat(leftW));
        }

        out.push(`${DIM} | ${RESET}`);
        if (cur && i < cur.diffs.length && rightW > 16) {
          const b = cur.diffs[i];
          const sel = i === diffIdx;
          const d = applyModsToDifficulty(b.difficulty, mods);
          const stats = `CS${fmtStat(d.cs)} AR${fmtStat(d.ar)} OD${fmtStat(d.od)}`;
          const name = pad(b.diffName, Math.max(4, rightW - stats.length - 4));
          const tint = difficultyTint(b, mods);
          out.push(sel ? `${bg(0x3a2438)}${tint}> ${name} ${DIM}${stats}${RESET}`
                       : `${tint}  ${name} ${DIM}${stats}${RESET}`);
        }
        out.push('\r\n');
      }

      if (cur && cur.diffs[diffIdx]) {
        const b = cur.diffs[diffIdx];
        const d = applyModsToDifficulty(b.difficulty, mods);
        out.push(`  ${GOLD}${pad(b.diffName, Math.min(24, cols - 8))}${RESET}${DIM} by ${b.creator}   ` +
          `300:±${d.windows.great.toFixed(0)}ms  preempt ${d.preempt.toFixed(0)}ms${RESET}\r\n`);
      } else {
        out.push(`  ${DIM}no matches${RESET}\r\n`);
      }
      out.push(searching
        ? `  ${DIM}typing a filter   / done   then w/s move   esc also stops${RESET}`
        : `  ${DIM}w/s song   enter play   \\ download   / filter   esc quit${RESET}`);
      stdout.write(out.join(''));
    };

    const finish = (result) => {
      if (done) return;
      done = true;
      stdin.off('data', onKey);
      // has to be removed. if it stays attached, a resize later repaints the song
      // list on top of the running game.
      stdout.off('resize', draw);
      try { stdin.setRawMode(false); } catch {}
      stdout.write(`${CSI}?25h${CSI}?1049l`);
      resolve(result);
    };

    const lastSet = () => Math.max(0, filtered.length - 1);
    const lastDiff = () => Math.max(0, (filtered[setIdx]?.diffs.length ?? 1) - 1);
    const moveSet = (n) => { setIdx = clamp(setIdx + n, 0, lastSet()); diffIdx = 0; };
    const moveDiff = (n) => { diffIdx = clamp(diffIdx + n, 0, lastDiff()); };

    const onKey = (chunk) => {
      const s = chunk.toString('latin1');

      if (s === '\x03') return finish(null);

      // arrows work in both modes
      if (s.startsWith('\x1b[')) {
        const k = s[2];
        if (k === 'A') moveSet(-1);
        else if (k === 'B') moveSet(1);
        else if (k === 'D') moveDiff(-1);
        else if (k === 'C') moveDiff(1);
        else if (k === '5') moveSet(-10);      // pgup
        else if (k === '6') moveSet(10);       // pgdn
        return draw();
      }

      // ---- typing a search ----
      // held separately from browsing so w/s can be movement keys rather than text
      if (searching) {
        // slash leaves the field. the filter stays so w/s move again.
        if (s === '/') { searching = false; return draw(); }
        if (s === '\\') { searching = false; return draw(); }
        if (s === '\x1b') { searching = false; return draw(); }
        if (s === '\r' || s === '\n') { searching = false; return draw(); }
        if (s === '\x7f' || s === '\b') { query = query.slice(0, -1); refilter(); return draw(); }
        if (s.length === 1 && s >= ' ' && s <= '~') { query += s; refilter(); return draw(); }
        return;
      }

      // ---- browsing ----
      if (s === '\x1b') return finish(null);
      if (s === '/') { searching = true; return draw(); }
      if (s === '\\' || s === '\t') return finish({ type: 'browse' });
      if (s === '\r' || s === '\n') {
        const cur = filtered[setIdx];
        return cur ? finish({ type: 'play', map: cur.diffs[diffIdx], mods }) : undefined;
      }
      // clearing the filter without having to open the search again
      if (s === '\x7f' || s === '\b') {
        if (!query) return;
        query = '';
        refilter();
        return draw();
      }

      const k = s.toLowerCase();
      if (k === 'w') { moveSet(-1); return draw(); }
      if (k === 's') { moveSet(1); return draw(); }
      if (k === 'a') { moveDiff(-1); return draw(); }
      if (k === 'd') { moveDiff(1); return draw(); }
      if (k === 'h') { bumpMods(toggleHidden(mods)); return draw(); }
      if (k === 'r') { bumpMods(toggleHardRock(mods)); return draw(); }
      if (k === 'q') return finish(null);
    };

    stdout.write(`${CSI}?1049h${CSI}?25l`);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onKey);
    stdout.on('resize', draw);
    refilter();
    draw();
  });
}

function fmtStat(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
