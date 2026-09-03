// in-game HUD: hit-error bar, 300/100/50/X legend, live grade.
// kept free of Win32 so the colours and layout can be tested on Linux.
import { rankFromCounts, rankColour } from '../grade.mjs';

export const JUDGE = {
  GREAT: { score: 300, colour: [90, 200, 255], hex: 0x5ac8ff, label: '300' },
  OK:    { score: 100, colour: [120, 230, 120], hex: 0x78e678, label: '100' },
  MEH:   { score: 50,  colour: [230, 200, 100], hex: 0xe6c864, label: '50' },
  MISS:  { score: 0,   colour: [255, 90, 90],  hex: 0xff5a5a, label: 'X' },
};

const SWATCH = '▪';
const ORDER = ['GREAT', 'OK', 'MEH', 'MISS'];

export function judgementColour(absError, windows) {
  if (absError <= windows.great) return JUDGE.GREAT.colour;
  if (absError <= windows.ok) return JUDGE.OK.colour;
  return JUDGE.MEH.colour;
}

// one legend item is "▪300:38". two spaces between items.
export function judgementLegend(counts) {
  const parts = ORDER.map((k) => {
    const j = JUDGE[k];
    return {
      key: k,
      hex: j.hex,
      rgb: j.colour,
      text: `${SWATCH}${j.label}:${counts[k] ?? 0}`,
    };
  });
  const str = parts.map((p) => p.text).join('  ');
  return { parts, str, swatch: SWATCH };
}

// live grade in the top-right corner (row 0), same table as results.
export function drawLiveRank(fb, counts, row = 0) {
  const rank = rankFromCounts(counts);
  const { hex } = rankColour(rank);
  const col = Math.max(0, fb.cols - rank.length - 1);
  fb.text(col, row, rank, hex);
  return { rank, col, row, hex };
}

export function drawJudgementLegend(fb, counts, row) {
  const { parts, str } = judgementLegend(counts);
  let col = Math.max(0, Math.floor((fb.cols - str.length) / 2));
  for (let i = 0; i < parts.length; i++) {
    if (i) col += 2;
    fb.text(col, row, parts[i].text, parts[i].hex);
    col += parts[i].text.length;
  }
  return str;
}

// dim track colours so the hit ticks still read on top
function zoneRgb(absMs, windows) {
  if (absMs <= windows.great) return [40, 78, 102];
  if (absMs <= windows.ok) return [38, 78, 42];
  return [78, 68, 36];
}

export const ERROR_TICK_FADE_MS = 3500;

export function errorOffset(item) {
  return typeof item === 'number' ? item : item.dt;
}

// 1 at the moment of the hit, 0 once fadeMs has passed. a plain number (the
// old shape) is treated as a live tick so existing tests keep working.
export function errorTickAlpha(item, now, fadeMs = ERROR_TICK_FADE_MS) {
  if (typeof item === 'number' || now == null || item?.at == null) return 1;
  const age = now - item.at;
  if (age >= fadeMs) return 0;
  if (age <= 0) return 1;
  return 1 - age / fadeMs;
}

export function meanError(errors) {
  if (!errors.length) return 0;
  let sum = 0;
  for (const e of errors) sum += errorOffset(e);
  return sum / errors.length;
}

export function drawHitErrorBar(fb, errors, windows, now = null, fadeMs = ERROR_TICK_FADE_MS) {
  const barW = Math.min(60, fb.cols - 20);
  const x0 = Math.floor((fb.cols - barW) / 2);
  const y = fb.height - 6;
  const meh = Math.max(1, windows.meh);

  for (let i = 0; i < barW; i++) {
    const absMs = Math.abs(((i + 0.5) / barW - 0.5) * 2) * meh;
    const [r, g, b] = zoneRgb(absMs, windows);
    fb.set(x0 + i, y, r, g, b);
  }
  fb.set(x0 + (barW >> 1), y, 200, 200, 200);

  for (let i = 0; i < errors.length; i++) {
    const item = errors[i];
    const a = errorTickAlpha(item, now, fadeMs);
    if (a <= 0) continue;
    const e = errorOffset(item);
    const px = x0 + Math.round(((e / meh) * 0.5 + 0.5) * (barW - 1));
    const col = judgementColour(Math.abs(e), windows);
    fb.blend(px, y, col[0], col[1], col[2], a);
  }

  return { x0, y, barW };
}
