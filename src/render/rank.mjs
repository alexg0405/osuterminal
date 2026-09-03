// 5×7 rank letters shared by the results screen and the in-game live grade.

import { rankColour } from '../grade.mjs';

export const LETTER_W = 5, LETTER_H = 7, LETTER_GAP = 1;
// bit 4 is the left column. same grid as the combo digits.
export const LETTERS = {
  S: [0b01110, 0b10001, 0b10000, 0b01110, 0b00001, 0b10001, 0b01110],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
};

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

// live HUD grade: bigger than a text cell, same 2px scale as the combo so it
// does not eat the top-right of the playfield. A is 10×14; SS is 22×14.
export function liveRankPixelSize(_rows) {
  return 2;
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

export function drawRankLetter(fb, rank, cx, cy, ps, { glow = true } = {}) {
  const glyphs = rankLetters(rank);
  const gw = glyphs.length * LETTER_W + (glyphs.length - 1) * LETTER_GAP;
  const x0 = Math.round(cx - (gw * ps) / 2);
  const y0 = Math.round(cy - (LETTER_H * ps) / 2);
  const { rgb } = rankColour(rank);
  const [r, g, b] = rgb;
  // the results screen wants a soft disc; the live HUD letter is already
  // small and the disc made SS look like a 26px badge.
  if (glow) fb.fillCircle(cx, cy, Math.max(gw, LETTER_H) * ps * 0.58, r, g, b, 0.18);
  for (let i = 0; i < glyphs.length; i++) {
    const rows = LETTERS[glyphs[i]] ?? LETTERS.D;
    blitLetter(fb, x0 + i * (LETTER_W + LETTER_GAP) * ps, y0, rows, ps, r, g, b);
  }
  return { x0, y0, w: gw * ps, h: LETTER_H * ps, ps };
}
