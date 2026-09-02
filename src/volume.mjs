// master / music / hitsound volume. all 0..1, stepped in 5% clicks.
// the engine already mixes with musicGain and effectGain; these helpers keep
// the three sliders from drifting off the 5% grid.

export const VOLUME_STEP = 0.05;

export function clampVolume(v, fallback = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

// --volume 70 means 70%. --volume 0.4 means 40%.
export function parseVolumeArg(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return clampVolume(n > 1 ? n / 100 : n);
}

export function stepVolume(v, dir) {
  const pct = Math.round(clampVolume(v) * 100 / 5) * 5 + Math.sign(dir) * 5;
  return clampVolume(pct / 100);
}

export function volumePercent(v) {
  return `${Math.round(clampVolume(v) * 100)}%`;
}

export function mixGains(master, music, effect) {
  const m = clampVolume(master, 0.8);
  return {
    music: m * clampVolume(music, 1),
    effect: m * clampVolume(effect, 1),
  };
}
