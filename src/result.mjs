// ranking panel after a map. giant coloured letter on the left, score / accuracy
// / 300s on the right, same idea as osu's results screen.

import process from 'node:process';
import { Framebuffer } from './render/framebuffer.mjs';
import { rankFromCounts, rankColour, accuracyFromCounts } from './grade.mjs';

const CSI = '\x1b[';

const LETTER_W = 5, LETTER_H = 7, LETTER_GAP = 1;
// bit 4 is the left column. 5x7 so the letter can scale up like the combo digits.
const LETTERS = {
  S: [0b01110, 0b10001, 0b10000, 0b01110, 0b00001, 0b10001, 0b01110],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
};

export function resultActionForKey(s) {
  if (s === '\x03') return 'quit';
  if (s === 'r' || s === 'R') return 'retry';
  if (s === '\r' || s === '\n' || s === 'q' || s === 'Q' || s === '\x1b') return 'menu';
  return null;
}

export function formatScore(n) {
  return String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function rankLetters(rank) {
  return rank === 'SS' ? ['S', 'S'] : [rank[0] ?? 'D'];
}

export function rankGlyphSize(fb, rank, leftPx) {
  const n = rankLetters(rank).length;
  const gw = n * LETTER_W + (n - 1) * LETTER_GAP;
  const top = 8, bot = 6;
  const availH = Math.max(LETTER_H, fb.height - top - bot);
  const availW = Math.max(LETTER_W, leftPx ?? Math.floor(fb.width * 0.62));
  return Math.max(2, Math.min(12, Math.floor(availH / LETTER_H), Math.floor(availW / gw)));
}

function blitLetter(fb, x0, y0, rows, ps, r, g, b) {
  for (let y = 0; y < LETTER_H; y++) {
    const bits = rows[y];
    for (let x = 0; x < LETTER_W; x++) {
      if (((bits >> (LETTER_W - 1 - x)) & 1) === 0) continue;
      fb.rect(x0 + x * ps, y0 + y * ps, ps, ps, r, g, b, 1);
    }
  }
}

export function drawRankLetter(fb, rank, cx, cy, ps) {
  const glyphs = rankLetters(rank);
  const gw = glyphs.length * LETTER_W + (glyphs.length - 1) * LETTER_GAP;
  const x0 = Math.round(cx - (gw * ps) / 2);
  const y0 = Math.round(cy - (LETTER_H * ps) / 2);
  const { rgb } = rankColour(rank);
  const [r, g, b] = rgb;
  // soft disc behind the letter so it reads as a badge, not just pixels
  fb.fillCircle(cx, cy, Math.max(gw, LETTER_H) * ps * 0.58, r, g, b, 0.18);
  for (let i = 0; i < glyphs.length; i++) {
    const rows = LETTERS[glyphs[i]] ?? LETTERS.D;
    blitLetter(fb, x0 + i * (LETTER_W + LETTER_GAP) * ps, y0, rows, ps, r, g, b);
  }
  return { x0, y0, w: gw * ps, h: LETTER_H * ps, ps };
}

function pad(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s;
}

export function drawResult(fb, map, summary) {
  const counts = summary.counts ?? {};
  const rank = summary.rank ?? rankFromCounts(counts);
  const acc = summary.accuracy ?? accuracyFromCounts(counts);
  const col = rankColour(rank);

  fb.clear(10, 10, 18);

  const title = `${map.artist} - ${map.title}`;
  fb.text(2, 1, pad(title, fb.cols - 4), 0xffffff);
  fb.text(2, 2, pad(`[${map.diffName}]`, fb.cols - 4), 0x8a94a8);

  // stats live in a right column so the letter can eat most of the screen
  const sc = Math.max(22, fb.cols - 24);
  const numCol = sc + 10;
  const ps = rankGlyphSize(fb, rank, sc - 3);
  const cx = Math.floor((sc - 1) / 2);
  const cy = Math.floor(fb.height / 2);
  drawRankLetter(fb, rank, cx, cy, ps);

  for (let y = 8; y < fb.height - 6; y++) fb.set(sc - 2, y, 36, 38, 52);

  const mid = Math.floor(fb.rows / 2) - 6;
  let row = Math.max(4, mid);

  const line = (r, label, value, fg, valueFg = 0xffffff) => {
    if (r < 3 || r >= fb.rows - 2) return r + 1;
    fb.text(sc, r, label, fg);
    const v = String(value);
    fb.text(Math.max(sc + 1, numCol + 6 - v.length), r, v, valueFg);
    return r + 1;
  };

  fb.text(sc, row, (acc * 100).toFixed(2) + '%', col.hex);
  row++;
  fb.text(sc, row, 'accuracy', 0x6a7282);
  row += 2;

  fb.text(sc, row, formatScore(summary.score ?? 0), 0xffffff);
  row++;
  fb.text(sc, row, 'score', 0x6a7282);
  row += 2;

  const combo = `${summary.maxCombo ?? 0}x`;
  fb.text(sc, row, combo, 0xffd257);
  const fc = (counts.MISS ?? 0) === 0;
  const perfect = acc >= 1;
  if (perfect) fb.text(sc + combo.length + 2, row, 'PERFECT', 0xffd246);
  else if (fc) fb.text(sc + combo.length + 2, row, 'FC', 0xffd246);
  row++;
  fb.text(sc, row, 'max combo', 0x6a7282);
  row += 2;

  row = line(row, '300', counts.GREAT ?? 0, 0x5ac8ff, 0x5ac8ff);
  row = line(row, '100', counts.OK ?? 0, 0x78e678, 0x78e678);
  row = line(row, '50', counts.MEH ?? 0, 0xe6c864, 0xe6c864);
  row = line(row, 'miss', counts.MISS ?? 0, 0xff5a5a, 0xff5a5a);
  row += 1;

  if (row < fb.rows - 2 && summary.meanError != null) {
    const err = `${summary.meanError >= 0 ? '+' : ''}${summary.meanError.toFixed(0)}ms`;
    fb.text(sc, row, 'mean error', 0x6a7282);
    fb.text(Math.max(sc + 1, numCol + 6 - err.length), row, err, 0xc8d0dc);
  }

  fb.text(2, fb.rows - 2, 'r retry', 0xffd257);
  fb.text(12, fb.rows - 2, 'enter  song select', 0x6a7282);
}

export function showResult(map, summary) {
  const stdin = process.stdin;
  const stdout = process.stdout;

  return new Promise((resolve) => {
    let done = false;
    let fb = new Framebuffer(stdout.columns ?? 80, stdout.rows ?? 24);

    const paint = () => {
      const cols = stdout.columns ?? 80, rows = stdout.rows ?? 24;
      if (fb.cols !== cols || fb.rows !== rows) {
        fb = new Framebuffer(cols, rows);
        stdout.write(`${CSI}2J`);
      }
      fb.invalidate();
      drawResult(fb, map, summary);
      stdout.write(fb.render(true));
    };

    const finish = (action) => {
      if (done) return;
      done = true;
      stdin.off('data', onKey);
      stdout.off('resize', paint);
      try { stdin.setRawMode(false); } catch {}
      stdout.write(`${CSI}?25h${CSI}?1049l`);
      resolve(action);
    };

    const onKey = (chunk) => {
      const action = resultActionForKey(chunk.toString('latin1'));
      if (action) finish({ type: action });
    };

    stdout.write(`${CSI}?1049h${CSI}?25l`);
    try { stdin.setRawMode(true); } catch {}
    stdin.resume();
    stdin.on('data', onKey);
    stdout.on('resize', paint);
    paint();
  });
}
