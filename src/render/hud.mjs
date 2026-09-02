// in-game footer: hit-error bar and the 300/100/50/X legend under it.
// kept free of Win32 so the colours and layout can be tested on Linux.

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

export function drawHitErrorBar(fb, errors, windows) {
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
    const e = errors[i];
    const age = errors.length <= 1 ? 1 : i / (errors.length - 1);
    const px = x0 + Math.round(((e / meh) * 0.5 + 0.5) * (barW - 1));
    const col = judgementColour(Math.abs(e), windows);
    fb.blend(px, y, col[0], col[1], col[2], 0.25 + age * 0.75);
  }

  return { x0, y, barW };
}
