// osu!standard ranking-panel grades.
// https://osu.ppy.sh/wiki/en/Gameplay/Grade
//
// SS is a true 100%. S/A/B/C/D come from the 300 ratio, 50s, and misses — not
// a straight accuracy cutoff — which is why a 94% with a miss is an A, not an S.

export function accuracyFromCounts(counts) {
  const great = counts.GREAT ?? 0;
  const ok = counts.OK ?? 0;
  const meh = counts.MEH ?? 0;
  const miss = counts.MISS ?? 0;
  const n = great + ok + meh + miss;
  if (!n) return 1;
  return (great * 300 + ok * 100 + meh * 50) / (n * 300);
}

export function rankFromCounts(counts) {
  const great = counts.GREAT ?? 0;
  const ok = counts.OK ?? 0;
  const meh = counts.MEH ?? 0;
  const miss = counts.MISS ?? 0;
  const n = great + ok + meh + miss;
  if (n === 0) return 'SS';
  const p300 = great / n;
  const p50 = meh / n;
  if (accuracyFromCounts(counts) >= 1) return 'SS';
  if (p300 > 0.9 && p50 <= 0.01 && miss === 0) return 'S';
  if ((p300 > 0.8 && miss === 0) || p300 > 0.9) return 'A';
  if ((p300 > 0.7 && miss === 0) || p300 > 0.8) return 'B';
  if (p300 > 0.6) return 'C';
  return 'D';
}

// gold S/SS, green A, blue B, purple C, red D — same hues as the osu ranking panel
export function rankColour(rank) {
  switch (rank) {
    case 'SS':
    case 'S': return { rgb: [255, 210, 70], hex: 0xffd246 };
    case 'A': return { rgb: [110, 232, 108], hex: 0x6ee86c };
    case 'B': return { rgb: [88, 168, 255], hex: 0x58a8ff };
    case 'C': return { rgb: [199, 125, 255], hex: 0xc77dff };
    default:  return { rgb: [255, 86, 100], hex: 0xff5664 };
  }
}
