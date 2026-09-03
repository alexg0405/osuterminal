// tests the range intersection that works out where the terminal is on screen.
//
// windows won't tell you where the text area is, GetConsoleWindow gives back a hidden
// pseudo console window. so instead we pair each motion event's cell with GetCursorPos's
// pixel. the mouse is somewhere inside that cell, so
//     origin + (col-1)*cellW <= sx < origin + col*cellW
// which is a one cell wide range. intersect enough of them and you get a single value.
// this fakes it with an origin we already know so we can check the answer.
//
// imports origin.mjs, never input.mjs — the Win32 bindings cannot load on Linux.

import { emptyOrigin, observeOrigin, cellFromPixel, shouldKeepOriginOnFocus } from '../src/input/origin.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const CELL_W = 10, CELL_H = 20;
const COLS = 160, ROWS = 80;
const geom = { cols: COLS, rows: ROWS, cellW: CELL_W, cellH: CELL_H };

function makeSolver() {
  const o = emptyOrigin();
  return {
    o,
    observe(col, row, sx, sy) {
      return observeOrigin(o, col, row, sx, sy, geom);
    },
  };
}

// pretend the mouse is at a screen pixel, given the real origin
function report(trueOx, trueOy, sx, sy) {
  return { col: Math.floor((sx - trueOx) / CELL_W) + 1, row: Math.floor((sy - trueOy) / CELL_H) + 1, sx, sy };
}

console.log('\n=== origin solver ===');

// does it converge from random movement
{
  const TOX = 437, TOY = 216;
  const s = makeSolver();
  let convergedAt = null;
  for (let i = 0; i < 200; i++) {
    const sx = TOX + Math.floor(Math.random() * 1200);
    const sy = TOY + Math.floor(Math.random() * 600);
    const r = report(TOX, TOY, sx, sy);
    s.observe(r.col, r.row, r.sx, r.sy);
    if (convergedAt === null && s.o.precision <= 1) convergedAt = i + 1;
  }
  const errX = Math.abs(s.o.x - TOX), errY = Math.abs(s.o.y - TOY);
  console.log(`  true origin ${TOX},${TOY}  solved ${s.o.x.toFixed(2)},${s.o.y.toFixed(2)}`);
  console.log(`  converged to <=1px after ${convergedAt} motion events; final precision ${s.o.precision.toFixed(2)}px`);
  check(errX < 1 && errY < 1, `solved origin within 1px (dx ${errX.toFixed(2)}, dy ${errY.toFixed(2)})`);
  check(convergedAt !== null && convergedAt < 60, `converges quickly (${convergedAt} events)`);
}

// worst case, mouse never leaves one interior cell. should stay consistent, never be wrong.
{
  const TOX = 100, TOY = 50;
  const s = makeSolver();
  for (let i = 0; i < 50; i++) {
    const r = report(TOX, TOY, TOX + 25, TOY + 35);
    s.observe(r.col, r.row, r.sx, r.sy);
  }
  const within = s.o.x >= s.o.lx && s.o.x <= s.o.ux;
  check(within, 'a stationary pointer still yields a bounded estimate');
  check(Math.abs(s.o.x - TOX) <= CELL_W / 2, `estimate stays within half a cell (${Math.abs(s.o.x - TOX).toFixed(1)}px)`);
}

// window moves halfway through, ranges stop overlapping and it should restart
{
  const s = makeSolver();
  for (let i = 0; i < 40; i++) {
    const r = report(100, 50, 100 + (i * 37) % 900, 50 + (i * 53) % 400);
    s.observe(r.col, r.row, r.sx, r.sy);
  }
  const before = s.o.x;
  check(Math.abs(before - 100) < 1, `locked onto the first origin (${before.toFixed(2)})`);

  for (let i = 0; i < 60; i++) {
    const r = report(700, 300, 700 + (i * 41) % 900, 300 + (i * 59) % 400);
    s.observe(r.col, r.row, r.sx, r.sy);
  }
  check(Math.abs(s.o.x - 700) < 1, `re-locked after the window moved (${s.o.x.toFixed(2)})`);
}

// the origin we solved should round trip, pixel to cell has to match the terminal
{
  const TOX = 333, TOY = 111;
  const s = makeSolver();
  for (let i = 0; i < 100; i++) {
    const sx = TOX + Math.floor(Math.random() * 1000), sy = TOY + Math.floor(Math.random() * 500);
    const r = report(TOX, TOY, sx, sy);
    s.observe(r.col, r.row, r.sx, r.sy);
  }
  let mismatches = 0;
  for (let i = 0; i < 500; i++) {
    const sx = TOX + Math.floor(Math.random() * 1000), sy = TOY + Math.floor(Math.random() * 500);
    const truth = report(TOX, TOY, sx, sy);
    const solvedCol = Math.floor((sx - s.o.x) / CELL_W) + 1;
    const solvedRow = Math.floor((sy - s.o.y) / CELL_H) + 1;
    if (solvedCol !== truth.col || solvedRow !== truth.row) mismatches++;
  }
  check(mismatches === 0, `solved origin reproduces the terminal's own cell reports (${mismatches}/500 mismatched)`);
}

console.log('\n=== mouse left the terminal (countdown OOB) ===');

// VT clamps the cell to the last column while GetCursorPos is far outside.
// the old solver treated that as a window move and replaced the origin.
{
  const TOX = 200, TOY = 100;
  const s = makeSolver();
  for (let i = 0; i < 40; i++) {
    const r = report(TOX, TOY, TOX + 80 + (i * 47) % 700, TOY + 60 + (i * 31) % 300);
    s.observe(r.col, r.row, r.sx, r.sy);
  }
  check(s.o.known && Math.abs(s.o.x - TOX) < 1, `origin locked before leaving (${s.o.x.toFixed(2)})`);
  const locked = { x: s.o.x, y: s.o.y, known: s.o.known };

  for (let i = 0; i < 30; i++) {
    // last column, pointer hundreds of pixels to the right of the window
    const sx = TOX + COLS * CELL_W + 400 + i * 17;
    const sy = TOY + 80;
    s.observe(COLS, 4, sx, sy);
  }
  check(s.o.known === locked.known, 'origin stays known after leaving');
  check(Math.abs(s.o.x - locked.x) < 0.01 && Math.abs(s.o.y - locked.y) < 0.01,
    `origin is unchanged after OOB motion (${s.o.x.toFixed(2)},${s.o.y.toFixed(2)})`);

  // with the poisoned origin the whole window mapped to one edge. with the
  // kept origin, a pixel still inside the terminal must map to an interior cell.
  const inside = cellFromPixel(TOX + 400, TOY + 200, s.o, CELL_W, CELL_H, COLS, ROWS);
  check(inside.cellX > 5 && inside.cellX < COLS - 5 && inside.cellY > 2 && inside.cellY < ROWS - 2,
    `in-window pixel still maps to an interior cell (${inside.cellX.toFixed(1)}, ${inside.cellY.toFixed(1)})`);

  // some terminals keep the last interior cell while GetCursorPos walks off-screen
  const beforeStale = { x: s.o.x, y: s.o.y };
  for (let i = 0; i < 20; i++) {
    s.observe(40, 10, TOX + COLS * CELL_W + 900 + i * 11, TOY + 200);
  }
  check(Math.abs(s.o.x - beforeStale.x) < 0.01,
    'a stale interior cell with an off-window pixel does not restart origin');
}

// same bug, but the first motion events are already OOB (mouse left before
// the solver saw an interior cell). must not lock onto the edge sample.
{
  const s = makeSolver();
  for (let i = 0; i < 20; i++) {
    s.observe(COLS, 1, 4000 + i, 20);
  }
  check(s.o.known === false, 'edge-only OOB samples do not lock a garbage origin');

  const TOX = 120, TOY = 80;
  for (let i = 0; i < 40; i++) {
    const r = report(TOX, TOY, TOX + 90 + (i * 53) % 600, TOY + 70 + (i * 29) % 250);
    s.observe(r.col, r.row, r.sx, r.sy);
  }
  check(s.o.known && Math.abs(s.o.x - TOX) < 1,
    `an interior sweep after OOB still locks the real origin (${s.o.x.toFixed(2)})`);
}

// cells outside 1..cols / 1..rows are ignored even before origin is known
{
  const s = makeSolver();
  check(s.observe(0, 5, 500, 200) === false, 'col 0 is ignored');
  check(s.observe(COLS + 1, 5, 500, 200) === false, 'col past cols is ignored');
  check(s.o.known === false, 'out-of-grid samples leave origin unknown');
}

// what the old restart would have done: OOB last-column sample replaces origin,
// then poll() clamps every in-window pixel to the right edge.
{
  const TOX = 200, TOY = 100;
  const good = { x: TOX, y: TOY };
  // far enough right that every in-window pixel sits left of the poisoned origin
  const sx = TOX + COLS * CELL_W + 2000;
  const sy = TOY + 40;
  const ux = sx - (COLS - 1) * CELL_W, lx = ux - CELL_W;
  const uy = sy - (4 - 1) * CELL_H, ly = uy - CELL_H;
  const poisoned = { x: (lx + ux) / 2, y: (ly + uy) / 2 };
  const left = cellFromPixel(TOX + 20, TOY + 200, poisoned, CELL_W, CELL_H, COLS, ROWS);
  const right = cellFromPixel(TOX + COLS * CELL_W - 20, TOY + 200, poisoned, CELL_W, CELL_H, COLS, ROWS);
  const okAim = cellFromPixel(TOX + 400, TOY + 200, good, CELL_W, CELL_H, COLS, ROWS);
  check(left.cellX === 0 && right.cellX === 0,
    `old OOB restart pinned the whole window to one edge (${left.cellX}, ${right.cellX})`);
  check(okAim.cellX === 40, `kept origin maps the same pixel to cell ${okAim.cellX}`);
}

console.log('\n=== click-to-focus after leaving (keep origin) ===');
{
  const TOX = 200, TOY = 100;
  const o = { known: true, x: TOX, y: TOY };
  check(shouldKeepOriginOnFocus(o, TOX + 400, TOY + 200, COLS, ROWS, CELL_W, CELL_H) === true,
    'a click still over the text area keeps the origin');
  check(shouldKeepOriginOnFocus(o, TOX - 80, TOY - 80, COLS, ROWS, CELL_W, CELL_H) === false,
    'a click on the title bar / outside drops the origin');
  check(shouldKeepOriginOnFocus(emptyOrigin(), TOX + 400, TOY + 200, COLS, ROWS, CELL_W, CELL_H) === false,
    'an unsolved origin cannot be kept');

  // old path: always reset origin on I, poll falls back to relative with cellX
  // still clamped to 0 from the OOB sample. in-game cursor sits on the left
  // of every hit object. new path keeps origin so the same OS pixel maps back.
  const inside = cellFromPixel(TOX + 400, TOY + 200, o, CELL_W, CELL_H, COLS, ROWS);
  check(inside.cellX === 40 && inside.cellY === 10,
    `refocus with kept origin puts the game cursor on the mouse (${inside.cellX}, ${inside.cellY})`);
  const stuckLeft = cellFromPixel(TOX + 400, TOY + 200, { x: 0, y: 0 }, CELL_W, CELL_H, COLS, ROWS);
  check(stuckLeft.cellX !== 40,
    'wiping the origin would have mapped that click somewhere else');
}

console.log(`\n${failures === 0 ? '\x1b[1;32mall checks passed\x1b[0m' : `\x1b[1;31m${failures} failure(s)\x1b[0m`}\n`);
process.exit(failures ? 1 : 0);
