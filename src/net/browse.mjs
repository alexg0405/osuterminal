// online beatmap browser.
//
// type a query, enter to search, arrows to move through results, enter again to
// download. same two pane layout as the offline song select so it doesn't feel like a
// different app.
//
// search comes from osu's metadata, so a chunk of what comes back is not actually
// hosted on any mirror. whichever set you highlight gets checked in the background and
// marked, and tab hides everything already known to be dead.
//
// only the highlighted one, deliberately. scanning a whole page at once got catboy to
// 403 everything for a while.

import { stdin, stdout } from 'node:process';
import { search, download, checkAvailable, isRateLimited, NotHostedError } from './mirror.mjs';
import { extractOsz, alreadyHave } from './osz.mjs';

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
const GREEN = fg(0x88dd77);
const RED = fg(0xff6677);

// same colour bands osu uses for star rating, roughly
function starColour(sr) {
  if (sr < 2) return fg(0x88dd77);
  if (sr < 2.7) return fg(0x66ccff);
  if (sr < 4) return fg(0xffbb44);
  if (sr < 5.3) return fg(0xff6688);
  if (sr < 6.5) return fg(0xbb88ff);
  return fg(0x8866cc);
}

const pad = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s.padEnd(n));
const secs = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// returns how many sets were downloaded, so the caller knows whether to reload
export function browseOnline(songsDir) {
  return new Promise((resolve) => {
    let query = '';
    let results = [];             // everything the search gave us
    let view = [];                // what is actually on screen after filtering
    let setIdx = 0, diffIdx = 0, scroll = 0;
    let mode = 'typing';          // typing | browsing
    let statusLine = 'type something and hit enter';
    let busy = false;
    let downloaded = 0;
    let owned = new Set();
    let done = false;
    let hideDead = false;         // tab toggles this
    const avail = new Map();      // setId -> 'yes' | 'no' | 'checking'
    let availTimer = null;

    const rebuildView = () => {
      const keep = hideDead ? results.filter((r) => avail.get(r.id) !== 'no') : results;
      // keep the highlight on the same set across a filter toggle where possible
      const wasOn = view[setIdx]?.id;
      view = keep;
      const again = view.findIndex((r) => r.id === wasOn);
      setIdx = again >= 0 ? again : clamp(setIdx, 0, Math.max(0, view.length - 1));
      diffIdx = 0;
    };

    const draw = () => {
      const rows = stdout.rows ?? 24, cols = stdout.columns ?? 80;
      const listH = Math.max(3, rows - 8);
      const leftW = Math.max(24, Math.min(52, Math.floor(cols * 0.5)));
      const rightW = cols - leftW - 5;

      if (setIdx < scroll) scroll = setIdx;
      if (setIdx >= scroll + listH) scroll = setIdx - listH + 1;

      const out = [`${CSI}H${CSI}J`];
      out.push(`${BRIGHT}  download beatmaps${RESET}\r\n\r\n`);
      const caret = mode === 'typing' ? `${ACCENT}_${RESET}` : '';
      out.push(`  ${DIM}search${RESET} ${BRIGHT}${query}${caret}${RESET}\r\n`);
      out.push(`  ${DIM}${statusLine}${RESET}\r\n\r\n`);

      const cur = view[setIdx];
      for (let i = 0; i < listH; i++) {
        const idx = scroll + i;
        out.push('  ');
        if (idx < view.length) {
          const s = view[idx];
          const sel = idx === setIdx && mode === 'browsing';
          const a = avail.get(s.id);
          // + already have it, x nobody hosts it, ? checking, blank means not looked at
          const mark = owned.has(s.id) ? `${GREEN}+${RESET}`
            : a === 'no' ? `${RED}x${RESET}`
            : a === 'checking' ? `${DIM}?${RESET}` : ' ';
          const dead = a === 'no';
          const label = pad(`${s.artist} - ${s.title}`, leftW - 4);
          const body = sel ? `${bg(0x2a3040)}${BRIGHT} ${label} ${RESET}`
            : dead ? `${DIM} ${label} ${RESET}` : `${TEXT} ${label} ${RESET}`;
          out.push(mark + body);
        } else {
          out.push(' '.repeat(leftW - 1));
        }

        out.push(`${DIM} | ${RESET}`);
        if (cur && i < cur.diffs.length && rightW > 24) {
          const d = cur.diffs[i];
          const sel = i === diffIdx && mode === 'browsing';
          const stats = `${d.stars.toFixed(2)}* CS${d.cs} AR${d.ar}  ${secs(d.length)}`;
          const name = pad(d.version, Math.max(8, rightW - stats.length - 4));
          const tint = starColour(d.stars);
          out.push(sel ? `${bg(0x3a2438)}${tint}> ${name} ${DIM}${stats}${RESET}`
                       : `${tint}  ${name} ${DIM}${stats}${RESET}`);
        }
        out.push('\r\n');
      }

      out.push('\r\n');
      if (cur) {
        out.push(`  ${GOLD}${pad(cur.creator, 20)}${RESET}${DIM} ${cur.bpm} bpm  ${cur.status}` +
                 `  ${cur.diffs.length} diffs${cur.hasVideo ? '  (has video, skipped)' : ''}${RESET}\r\n`);
      } else {
        out.push('\r\n');
      }
      const filterHint = hideDead ? `${GREEN}hiding unavailable${RESET}${DIM}` : 'tab hide unavailable';
      out.push(mode === 'typing'
        ? `  ${DIM}enter search   down to browse   ${filterHint}   esc back${RESET}`
        : `  ${DIM}up/down sets   enter download   left/right diffs   ${filterHint}   esc back${RESET}`);
      stdout.write(out.join(''));
    };

    const refreshOwned = async () => {
      owned = new Set();
      for (const r of results) if (await alreadyHave(songsDir, r.id)) owned.add(r.id);
    };

    // check whatever is highlighted, after it settles for a moment
    const queueCheck = () => {
      clearTimeout(availTimer);
      const s2 = view[setIdx];
      if (!s2 || avail.has(s2.id) || owned.has(s2.id) || isRateLimited()) return;
      availTimer = setTimeout(async () => {
        const id = view[setIdx]?.id;
        if (!id || avail.has(id)) return;
        avail.set(id, 'checking');
        draw();
        const { status } = await checkAvailable(id);
        // 'unknown' means the mirror would not say, so leave it unmarked rather than
        // claiming it is missing
        if (status === 'unknown') avail.delete(id); else avail.set(id, status);
        if (hideDead && status === 'no') rebuildView();
        if (!done) draw();
      }, 400);
    };

    const doSearch = async () => {
      if (!query.trim() || busy) return;
      busy = true;
      clearTimeout(availTimer);
      statusLine = 'searching...';
      draw();
      try {
        const { mirror, results: r } = await search(query, { limit: 50 });
        results = r;
        avail.clear();
        setIdx = 0; diffIdx = 0; scroll = 0;
        await refreshOwned();
        rebuildView();
        statusLine = r.length ? `${r.length} sets from ${mirror}` : 'nothing found';
        mode = r.length ? 'browsing' : 'typing';
        busy = false;
        draw();
        queueCheck();
        return;
      } catch (e) {
        results = []; view = [];
        statusLine = `search failed: ${e.message}`;
      }
      busy = false;
      draw();
    };

    const doDownload = async () => {
      const s = view[setIdx];
      if (!s || busy) return;
      busy = true;
      try {
        statusLine = `downloading ${s.artist} - ${s.title}...`;
        draw();
        let lastDraw = 0;
        const { buffer } = await download(s.id, (got, total) => {
          const now = Date.now();
          if (now - lastDraw < 120) return;
          lastDraw = now;
          statusLine = total
            ? `downloading ${Math.floor((got / total) * 100)}%  (${(total / 1048576).toFixed(1)} MiB)`
            : `downloading ${(got / 1048576).toFixed(1)} MiB`;
          draw();
        });
        statusLine = 'extracting...';
        draw();
        const r = await extractOsz(buffer, songsDir, { setId: s.id, artist: s.artist, title: s.title });
        downloaded++;
        owned.add(s.id);
        avail.set(s.id, 'yes');
        statusLine = `${GREEN}saved ${r.osuCount} difficulties to ${r.folder}${RESET}${DIM}`;
      } catch (e) {
        if (e instanceof NotHostedError) {
          avail.set(s.id, 'no');
          if (hideDead) rebuildView();
          statusLine = `${RED}no mirror has this one${RESET}${DIM}`;
        } else if (isRateLimited()) {
          statusLine = `${RED}mirror is rate limiting us${RESET}${DIM} give it a minute`;
        } else {
          statusLine = `${RED}failed${RESET}${DIM} ${e.message}`;
        }
      }
      busy = false;
      draw();
    };

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(availTimer);
      stdin.off('data', onKey);
      stdout.off('resize', draw);
      try { stdin.setRawMode(false); } catch {}
      stdout.write(`${CSI}?25h${CSI}?1049l`);
      resolve(downloaded);
    };

    const onKey = (chunk) => {
      if (busy) return;
      const s = chunk.toString('latin1');

      if (s === '\x03') return finish();
      if (s === '\x1b') {
        if (mode === 'browsing') { mode = 'typing'; return draw(); }
        return finish();
      }
      if (s === '\t') {
        hideDead = !hideDead;
        rebuildView();
        const dead = [...avail.values()].filter((v) => v === 'no').length;
        statusLine = hideDead ? `hiding ${dead} unavailable` : `showing all ${results.length}`;
        return draw();
      }
      if (s === '\r' || s === '\n') {
        return mode === 'typing' ? doSearch() : doDownload();
      }
      if (s === '\x7f' || s === '\b') {
        mode = 'typing';
        query = query.slice(0, -1);
        return draw();
      }

      if (s.startsWith('\x1b[')) {
        const k = s[2];
        if (!view.length) return;
        if (k === 'B') {
          if (mode === 'typing') { mode = 'browsing'; setIdx = 0; }
          else setIdx = clamp(setIdx + 1, 0, view.length - 1);
          diffIdx = 0;
        } else if (k === 'A') {
          if (mode === 'browsing' && setIdx === 0) mode = 'typing';
          else setIdx = clamp(setIdx - 1, 0, view.length - 1);
          diffIdx = 0;
        } else if (k === 'D') {
          diffIdx = clamp(diffIdx - 1, 0, Math.max(0, (view[setIdx]?.diffs.length ?? 1) - 1));
        } else if (k === 'C') {
          diffIdx = clamp(diffIdx + 1, 0, Math.max(0, (view[setIdx]?.diffs.length ?? 1) - 1));
        }
        queueCheck();
        return draw();
      }

      if (s.length === 1 && s >= ' ' && s <= '~') {
        mode = 'typing';
        query += s;
        return draw();
      }
    };

    stdout.write(`${CSI}?1049h${CSI}?25l`);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onKey);
    stdout.on('resize', draw);
    draw();
  });
}
