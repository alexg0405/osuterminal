// tests the range intersection that works out where the terminal is on screen.
//
// windows won't tell you where the text area is, GetConsoleWindow gives back a hidden
// pseudo console window. so instead we pair each motion event's cell with GetCursorPos's
// pixel. the mouse is somewhere inside that cell, so
//     origin + (col-1)*cellW <= sx < origin + col*cellW
// which is a one cell wide range. intersect enough of them and you get a single value.
// this fakes it with an origin we already know so we can check the answer.

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const CELL_W = 10, CELL_H = 20;

// same logic as Input#observeOrigin
function makeSolver() {
  const o = { lx: null, ux: null, ly: null, uy: null, x: 0, y: 0, precision: Infinity, known: false };
  return {
    o,
    observe(col, row, sx, sy) {
      const ux = sx - (col - 1) * CELL_W, lx = ux - CELL_W;
      const uy = sy - (row - 1) * CELL_H, ly = uy - CELL_H;
      if (o.lx === null) Object.assign(o, { lx, ux, ly, uy });
      else {
        const nlx = Math.max(o.lx, lx), nux = Math.min(o.ux, ux);
        const nly = Math.max(o.ly, ly), nuy = Math.min(o.uy, uy);
        if (nlx > nux || nly > nuy) Object.assign(o, { lx, ux, ly, uy });
        else Object.assign(o, { lx: nlx, ux: nux, ly: nly, uy: nuy });
      }
      o.x = (o.lx + o.ux) / 2;
      o.y = (o.ly + o.uy) / 2;
      o.precision = Math.max(o.ux - o.lx, o.uy - o.ly);
      o.known = true;
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

// worst case, mouse never leaves one cell. should stay consistent, never be wrong.
{
  const TOX = 100, TOY = 50;
  const s = makeSolver();
  for (let i = 0; i < 50; i++) {
    const r = report(TOX, TOY, TOX + 3, TOY + 7);
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

console.log(`\n${failures === 0 ? '\x1b[1;32mall checks passed\x1b[0m' : `\x1b[1;31m${failures} failure(s)\x1b[0m`}\n`);
process.exit(failures ? 1 : 0);
