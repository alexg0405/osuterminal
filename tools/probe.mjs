#!/usr/bin/env node
// checks what this terminal can actually do, mainly whether we can get precise mouse
// aim and key release events. writes probe-report.json. ctrl-c is fine at any point.

import { writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';

const CSI = '\x1b[';
const ms = () => Number(process.hrtime.bigint()) / 1e6;
const w = (s) => stdout.write(s);
const sleep = (n) => new Promise((r) => setTimeout(r, n));

const report = {
  when: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  env: {
    WT_SESSION: process.env.WT_SESSION ?? null,
    TERM_PROGRAM: process.env.TERM_PROGRAM ?? null,
    TERM: process.env.TERM ?? null,
    ConEmuANSI: process.env.ConEmuANSI ?? null,
  },
  isTTY: { stdin: stdin.isTTY === true, stdout: stdout.isTTY === true },
  size: { cols: stdout.columns ?? null, rows: stdout.rows ?? null },
};

if (!stdin.isTTY || !stdout.isTTY) {
  console.error('\nNOT A TTY. Run this directly in Windows Terminal:\n\n    node tools/probe.mjs\n');
  writeFileSync('probe-report.json', JSON.stringify({ ...report, fatal: 'not a tty' }, null, 2));
  process.exit(1);
}

// raw mode
stdin.setRawMode(true);
stdin.resume();

const listeners = [];
stdin.on('data', (chunk) => {
  const at = ms();
  for (const fn of listeners.slice()) fn(chunk, at);
});

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  w(CSI + '<u');                                     // pop kitty keyboard flags
  w(CSI + '?1016l' + CSI + '?1003l' + CSI + '?1002l' + CSI + '?1006l' + CSI + '?1000l');
  w(CSI + '?25h');                                   // show cursor
  try { stdin.setRawMode(false); } catch {}
  stdin.pause();
}
process.on('exit', restore);
process.on('SIGINT', () => { restore(); console.log('\naborted.'); process.exit(130); });

// helper for sending a query and collecting the reply
function query(seq, waitMs = 250) {
  return new Promise((resolve) => {
    let got = Buffer.alloc(0);
    const fn = (chunk) => { got = Buffer.concat([got, chunk]); };
    listeners.push(fn);
    w(seq);
    setTimeout(() => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
      resolve(got.toString('latin1'));
    }, waitMs);
  });
}

const show = (s) =>
  s.replace(/\x1b/g, 'ESC').replace(/[\x00-\x1f]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));

// DECRQM: CSI ? Ps $ p  ->  CSI ? Ps ; Pm $ y
const DECRQM_MEANING = {
  0: 'NOT RECOGNISED', 1: 'set', 2: 'reset (supported)',
  3: 'permanently set', 4: 'permanently reset',
};
async function decrqm(mode) {
  const res = await query(CSI + '?' + mode + '$p', 200);
  const m = res.match(new RegExp('\\x1b\\[\\?' + mode + ';(\\d)\\$y'));
  const v = m ? Number(m[1]) : null;
  return {
    mode,
    raw: show(res),
    value: v,
    meaning: v === null ? 'no reply' : (DECRQM_MEANING[v] ?? '?'),
    supported: v !== null && v !== 0,
  };
}

const banner = (t) => console.log('\n\x1b[1;36m' + t + '\x1b[0m\n' + '-'.repeat(t.length));
const p = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : null);

// =====================================================================
async function main() {
  console.clear();
  console.log('\x1b[1mosuterminal capability probe\x1b[0m');
  console.log('terminal: ' + (report.env.WT_SESSION ? 'Windows Terminal (WT_SESSION set)' : report.env.TERM_PROGRAM || 'unknown'));
  console.log('size    : ' + report.size.cols + 'x' + report.size.rows + ' cells');

  // ---------- 1. identity + geometry ----------
  banner('1. terminal identity & geometry');
  report.da1 = show(await query(CSI + 'c'));
  report.da2 = show(await query(CSI + '>c'));
  const px = await query(CSI + '14t');    // text area, pixels
  const cell = await query(CSI + '16t');  // cell size, pixels
  const mPx = px.match(/\x1b\[4;(\d+);(\d+)t/);
  const mCell = cell.match(/\x1b\[6;(\d+);(\d+)t/);
  report.geometry = {
    textAreaPx: mPx ? { h: +mPx[1], w: +mPx[2] } : null,
    cellPx: mCell ? { h: +mCell[1], w: +mCell[2] } : null,
    raw: { px: show(px), cell: show(cell) },
  };
  console.log('DA1            : ' + (report.da1 || '(no reply)'));
  console.log('text area (px) : ' + (mPx ? mPx[2] + 'x' + mPx[1] : 'no reply'));
  console.log('cell size (px) : ' + (mCell ? mCell[2] + 'x' + mCell[1] : 'no reply'));

  // ---------- 2. mode support ----------
  banner('2. DECRQM mode support');
  report.modes = {};
  const MODES = [
    [1000, 'mouse: button press/release'],
    [1002, 'mouse: button + drag motion'],
    [1003, 'mouse: ANY motion (needed for aim)'],
    [1006, 'mouse: SGR coords (needed for >223 cols)'],
    [1016, 'mouse: SGR-PIXEL coords (precise aim!)'],
    [2004, 'bracketed paste'],
  ];
  for (const [mode, label] of MODES) {
    const r = await decrqm(mode);
    report.modes[mode] = Object.assign({}, r, { label });
    const mark = r.supported ? '\x1b[32mYES\x1b[0m' : '\x1b[31mNO \x1b[0m';
    console.log('  ' + mark + '  ' + String(mode).padEnd(5) + ' ' + label.padEnd(38) + ' ' + r.meaning);
  }

  // ---------- 3. kitty keyboard protocol ----------
  banner('3. kitty keyboard protocol (key RELEASE -> sliders/holds)');
  const kq = await query(CSI + '?u', 200);
  const km = kq.match(/\x1b\[\?(\d+)u/);
  report.kittyKeyboard = { supported: !!km, flags: km ? +km[1] : null, raw: show(kq) };
  console.log(km
    ? '  \x1b[32mYES\x1b[0m  supported, current flags = ' + km[1]
    : '  \x1b[31mNO \x1b[0m  no CSI ? u reply -> press-only input, no key-release');

  // ---------- 4. LIVE mouse motion test ----------
  banner('4. LIVE mouse test  (the make-or-break one)');
  const pixelMode = report.modes[1016] && report.modes[1016].supported;
  console.log('enabling: 1003 (any-motion) + 1006 (SGR)' + (pixelMode ? ' + 1016 (pixel)' : ''));
  console.log('\n  \x1b[1;33m>> Move your mouse around inside this window for 5 seconds. <<\x1b[0m');
  console.log('     wiggle it in circles, fast and slow - do NOT click\n');
  await sleep(1500);

  w(CSI + '?1000h' + CSI + '?1002h' + CSI + '?1003h' + CSI + '?1006h');
  if (pixelMode) w(CSI + '?1016h');

  const events = [];
  let rawMouseBytes = '';
  const t0 = ms();
  const onMouse = (chunk, at) => {
    const s = chunk.toString('latin1');
    if (rawMouseBytes.length < 400) rawMouseBytes += s;
    const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
    let m;
    while ((m = re.exec(s))) events.push({ t: at - t0, b: +m[1], x: +m[2], y: +m[3], press: m[4] === 'M' });
  };
  listeners.push(onMouse);

  for (let i = 5; i > 0; i--) { w('\r  collecting... ' + i + '   '); await sleep(1000); }
  listeners.splice(listeners.indexOf(onMouse), 1);
  w(CSI + '?1016l' + CSI + '?1003l' + CSI + '?1002l' + CSI + '?1000l' + CSI + '?1006l');
  w('\r                                \r');

  const xs = events.map((e) => e.x), ys = events.map((e) => e.y);
  const gaps = events.slice(1).map((e, i) => e.t - events[i].t).sort((a, b) => a - b);
  report.mouse = {
    pixelModeEnabled: !!pixelMode,
    eventCount: events.length,
    rateHz: events.length ? +(events.length / 5).toFixed(1) : 0,
    xRange: xs.length ? [Math.min(...xs), Math.max(...xs)] : null,
    yRange: ys.length ? [Math.min(...ys), Math.max(...ys)] : null,
    distinctX: new Set(xs).size,
    distinctY: new Set(ys).size,
    gapMs: { median: p(gaps, 0.5), p95: p(gaps, 0.95), max: gaps.length ? gaps[gaps.length - 1] : null },
    sample: events.slice(0, 12),
    rawSample: show(rawMouseBytes).slice(0, 400),
  };

  if (!events.length) {
    console.log('  \x1b[1;31mZERO mouse events received.\x1b[0m');
    console.log('  -> VT mouse reporting is not reaching this process.');
    console.log('     osu!standard aim is NOT possible here via terminal escape codes.');
    if (rawMouseBytes) console.log('  (but SOME bytes arrived: ' + show(rawMouseBytes).slice(0, 120) + ')');
  } else {
    const unit = pixelMode && report.mouse.xRange[1] > (report.size.cols || 0) ? 'PIXELS' : 'CELLS';
    report.mouse.coordUnit = unit;
    console.log('  \x1b[1;32m' + events.length + ' events\x1b[0m in 5s  (~' + report.mouse.rateHz + ' Hz)');
    console.log('  x range ' + report.mouse.xRange.join(' .. ') + '  (' + report.mouse.distinctX + ' distinct)');
    console.log('  y range ' + report.mouse.yRange.join(' .. ') + '  (' + report.mouse.distinctY + ' distinct)');
    console.log('  gap between events: median ' + (report.mouse.gapMs.median || 0).toFixed(1) +
                ' ms, p95 ' + (report.mouse.gapMs.p95 || 0).toFixed(1) + ' ms');
    console.log('  coordinates look like: \x1b[1m' + unit + '\x1b[0m');
  }

  // ---------- 5. LIVE key release test ----------
  banner('5. LIVE key-release test');
  if (report.kittyKeyboard.supported) {
    w(CSI + '>5u');  // flags 1|4 = disambiguate + report event types
    console.log('\n  \x1b[1;33m>> Press and HOLD the Z key ~1 second, then release. Then tap X. <<\x1b[0m\n');
    const keyEvents = [];
    const kt0 = ms();
    const onKey = (chunk, at) => {
      const s = chunk.toString('latin1');
      const re = /\x1b\[(\d+)(?:;(\d+)(?::(\d+))?)?u/g;
      let m, matched = false;
      while ((m = re.exec(s))) {
        matched = true;
        keyEvents.push({ t: +(at - kt0).toFixed(1), code: +m[1], type: m[3] ? +m[3] : 1, raw: show(m[0]) });
      }
      if (!matched) keyEvents.push({ t: +(at - kt0).toFixed(1), legacy: show(s) });
    };
    listeners.push(onKey);
    for (let i = 6; i > 0; i--) { w('\r  listening... ' + i + '   '); await sleep(1000); }
    listeners.splice(listeners.indexOf(onKey), 1);
    w(CSI + '<u');
    w('\r                                \r');

    const TYPE = { 1: 'press', 2: 'repeat', 3: 'RELEASE' };
    report.keyboard = { events: keyEvents, sawRelease: keyEvents.some((e) => e.type === 3) };
    if (!keyEvents.length) {
      console.log('  no key events captured (did you press anything?)');
    } else {
      for (const e of keyEvents.slice(0, 12)) {
        console.log('   ' + String(e.t).padStart(8) + ' ms  ' +
          (e.legacy ? 'legacy ' + e.legacy : 'code ' + e.code + ' ' + (TYPE[e.type] || e.type)));
      }
      console.log(report.keyboard.sawRelease
        ? '\n  \x1b[1;32mRELEASE events received\x1b[0m -> sliders & holds are implementable'
        : '\n  \x1b[1;31mno RELEASE events\x1b[0m -> holds must be faked with timeouts');
    }
  } else {
    report.keyboard = { skipped: 'kitty keyboard protocol unsupported' };
    console.log('  skipped: protocol unsupported.');
  }

  // ---------- done ----------
  restore();
  writeFileSync('probe-report.json', JSON.stringify(report, null, 2));
  banner('done');
  console.log('Wrote \x1b[1mprobe-report.json\x1b[0m. Tell your assistant "done" and it will read the file.\n');
  process.exit(0);
}

main().catch((e) => { restore(); console.error(e); process.exit(1); });
