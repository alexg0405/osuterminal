// song select.
//
// sets on the left, difficulties of the highlighted set on the right. typing filters.
// this uses plain ANSI instead of the framebuffer because it's all text, and text
// needs real characters rather than half blocks.

import { stdin, stdout } from 'node:process';

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
function difficultyTint(b) {
  const d = b.difficulty;
  const score = d.ar * 0.5 + d.od * 0.3 + d.cs * 0.2 + Math.min(4, b.hitObjects.length / 250);
  if (score < 5) return fg(0x88dd77);
  if (score < 7) return fg(0x66ccff);
  if (score < 9) return fg(0xffbb44);
  if (score < 11) return fg(0xff6688);
  return fg(0xbb88ff);
}

const pad = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s.padEnd(n));

// returns the chosen map, or null if they backed out
export function selectSong(maps) {
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
      const listH = rows - 6;
      const leftW = Math.max(24, Math.min(52, Math.floor(cols * 0.5)));
      const rightW = cols - leftW - 3;

      if (setIdx < scroll) scroll = setIdx;
      if (setIdx >= scroll + listH) scroll = setIdx - listH + 1;

      const out = [`${CSI}H${CSI}J`];
      out.push(`${BRIGHT}  osuterminal${RESET}${DIM}   ${filtered.length} sets`);
      out.push(query ? `   ${ACCENT}/${query}${RESET}` : `   ${DIM}type to search${RESET}`);
      out.push('\r\n\r\n');

      const cur = filtered[setIdx];
      for (let i = 0; i < listH; i++) {
        const idx = scroll + i;
        out.push('  ');
        if (idx < filtered.length) {
          const s = filtered[idx];
          const sel = idx === setIdx;
          const label = pad(`${s.artist} - ${s.title}`, leftW - 2);
          out.push(sel ? `${bg(0x2a3040)}${BRIGHT} ${label} ${RESET}` : `${TEXT} ${label} ${RESET}`);
        } else {
          out.push(' '.repeat(leftW));
        }

        // right side, difficulties of the highlighted set
        out.push(`${DIM} | ${RESET}`);
        if (cur && i < cur.diffs.length && rightW > 20) {
          const b = cur.diffs[i];
          const sel = i === diffIdx;
          const d = b.difficulty;
          const stats = `CS${d.cs} AR${d.ar} OD${d.od}  ${String(b.hitObjects.length).padStart(4)}`;
          const name = pad(b.diffName, Math.max(8, rightW - stats.length - 4));
          const tint = difficultyTint(b);
          out.push(sel ? `${bg(0x3a2438)}${tint}> ${name} ${DIM}${stats}${RESET}`
                       : `${tint}  ${name} ${DIM}${stats}${RESET}`);
        }
        out.push('\r\n');
      }

      out.push('\r\n');
      if (cur && cur.diffs[diffIdx]) {
        const b = cur.diffs[diffIdx];
        const d = b.difficulty;
        out.push(`  ${GOLD}${pad(b.diffName, 24)}${RESET}${DIM} by ${b.creator}   ` +
          `300:±${d.windows.great.toFixed(0)}ms  preempt ${d.preempt.toFixed(0)}ms${RESET}\r\n`);
      } else {
        out.push(`  ${DIM}no matches${RESET}\r\n`);
      }
      out.push(`  ${DIM}up/down set   left/right difficulty   enter play   esc quit${RESET}`);
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

    const onKey = (chunk) => {
      const s = chunk.toString('latin1');

      if (s === '\x1b' || s === '\x03') return finish(null);
      if (s === '\r' || s === '\n') {
        const cur = filtered[setIdx];
        return cur ? finish(cur.diffs[diffIdx]) : undefined;
      }
      if (s === '\x7f' || s === '\b') { query = query.slice(0, -1); refilter(); return draw(); }

      // arrow keys
      if (s.startsWith('\x1b[')) {
        const cur = filtered[setIdx];
        const k = s[2];
        if (k === 'A') setIdx = clamp(setIdx - 1, 0, Math.max(0, filtered.length - 1)), diffIdx = 0;
        else if (k === 'B') setIdx = clamp(setIdx + 1, 0, Math.max(0, filtered.length - 1)), diffIdx = 0;
        else if (k === 'D') diffIdx = clamp(diffIdx - 1, 0, Math.max(0, (cur?.diffs.length ?? 1) - 1));
        else if (k === 'C') diffIdx = clamp(diffIdx + 1, 0, Math.max(0, (cur?.diffs.length ?? 1) - 1));
        else if (k === '5') setIdx = clamp(setIdx - 10, 0, Math.max(0, filtered.length - 1)), diffIdx = 0;   // pgup
        else if (k === '6') setIdx = clamp(setIdx + 10, 0, Math.max(0, filtered.length - 1)), diffIdx = 0;   // pgdn
        return draw();
      }

      // anything printable goes into the search
      if (s.length === 1 && s >= ' ' && s <= '~') { query += s; refilter(); return draw(); }
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
