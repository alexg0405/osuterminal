// gameplay mods. Hidden and Hard Rock for now.
//
// HR: CS/AR/OD/HP * 1.4, capped at 10, and the playfield is flipped on Y.
// HD: objects fade in faster then fade out before you have to hit them.
//     approach circles stay; the follow circle still shows once a slider starts.

import { Difficulty } from './beatmap.mjs';

export const PLAYFIELD_H = 384;
export const HR_RATE = 1.4;
export const HR_CAP = 10;
export const HD_FADE_IN_MUL = 0.4;
export const HD_FADE_OUT_MUL = 0.3;
export const HD_SCORE_MUL = 1.06;
export const HR_SCORE_MUL = 1.06;

export function emptyMods() {
  return { hidden: false, hardRock: false };
}

export function normalizeMods(m) {
  return { hidden: !!(m && m.hidden), hardRock: !!(m && m.hardRock) };
}

export function modsEqual(a, b) {
  const x = normalizeMods(a), y = normalizeMods(b);
  return x.hidden === y.hidden && x.hardRock === y.hardRock;
}

// osu writes these HD then HR
export function modsAcronyms(m) {
  const mods = normalizeMods(m);
  let s = '';
  if (mods.hidden) s += 'HD';
  if (mods.hardRock) s += 'HR';
  return s;
}

export function modsLabel(m) {
  return modsAcronyms(m) || 'NM';
}

export function scoreMultiplier(m) {
  const mods = normalizeMods(m);
  let n = 1;
  if (mods.hidden) n *= HD_SCORE_MUL;
  if (mods.hardRock) n *= HR_SCORE_MUL;
  return n;
}

export function toggleHidden(m) {
  const mods = normalizeMods(m);
  mods.hidden = !mods.hidden;
  return mods;
}

export function toggleHardRock(m) {
  const mods = normalizeMods(m);
  mods.hardRock = !mods.hardRock;
  return mods;
}

function capHR(v) {
  return Math.min(HR_CAP, Math.round(v * HR_RATE * 100) / 100);
}

export function applyModsToDifficulty(diff, m) {
  const mods = normalizeMods(m);
  if (!mods.hardRock) return diff;
  return new Difficulty({
    cs: capHR(diff.cs),
    ar: capHR(diff.ar),
    od: capHR(diff.od),
    hp: capHR(diff.hp),
    sliderMultiplier: diff.sliderMultiplier,
    sliderTickRate: diff.sliderTickRate,
  });
}

export function flipY(y) {
  return PLAYFIELD_H - y;
}

export function flipPoint(p) {
  return { x: p.x, y: flipY(p.y) };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// dt is ms until the hit time (positive = upcoming). NM fades in over fadeIn
// and stays opaque. HD fades in faster, then out, and is gone before you tap.
export function objectAlpha(dt, preempt, fadeIn, hidden = false) {
  if (!(preempt > 0)) return dt <= 0 ? 1 : 0;
  if (!hidden) return clamp01((preempt - dt) / Math.max(1, fadeIn));

  const fadeInDur = Math.max(1, fadeIn * HD_FADE_IN_MUL);
  const fadeOutDur = Math.max(1, preempt * HD_FADE_OUT_MUL);
  const sinceAppear = preempt - dt;
  if (sinceAppear <= 0) return 0;
  if (sinceAppear < fadeInDur) return sinceAppear / fadeInDur;
  const intoFadeOut = sinceAppear - fadeInDur;
  if (intoFadeOut >= fadeOutDur) return 0;
  return 1 - intoFadeOut / fadeOutDur;
}

// approach circles still show with Hidden; they use the normal fade-in.
export function approachAlpha(dt, preempt, fadeIn) {
  return objectAlpha(dt, preempt, fadeIn, false);
}

// "hd,hr" / "HDHR" / "hidden+hardrock" / "nm"
export function parseModsList(raw) {
  const out = emptyMods();
  const s = String(raw ?? '').toLowerCase();
  if (!s.trim()) return out;
  const compact = s.replace(/[^a-z0-9]+/g, '');
  if (!compact || compact === 'nm' || compact === 'nomod' || compact === 'none') return out;
  if (compact.includes('hidden') || /(^|[^a-z])hd([^a-z]|$)/.test(s) || compact.includes('hd'))
    out.hidden = true;
  if (compact.includes('hardrock') || compact.includes('hr'))
    out.hardRock = true;
  return out;
}

// null if this argv token is not a mod flag.
// { patch, consume, replace } otherwise. consume is how many extra argv slots to skip.
export function consumeModFlag(a, next) {
  const al = String(a).toLowerCase();
  if (al === '--hd' || al === '--hidden') return { patch: { hidden: true }, consume: 0 };
  if (al === '--hr' || al === '--hardrock' || al === '--hard-rock')
    return { patch: { hardRock: true }, consume: 0 };
  if (al === '--no-hd' || al === '--no-hidden') return { patch: { hidden: false }, consume: 0 };
  if (al === '--no-hr' || al === '--no-hardrock' || al === '--no-hard-rock')
    return { patch: { hardRock: false }, consume: 0 };
  if (al === '--nm' || al === '--nomod' || al === '--no-mod' || al === '--no-mods')
    return { patch: emptyMods(), consume: 0, replace: true };
  if (al === '--mods') {
    if (next == null || String(next).startsWith('-'))
      return { patch: emptyMods(), consume: 0, replace: true };
    return { patch: parseModsList(next), consume: 1, replace: true };
  }
  return null;
}

export function applyModFlag(current, flag) {
  if (!flag) return normalizeMods(current);
  if (flag.replace) return normalizeMods(flag.patch);
  return { ...normalizeMods(current), ...flag.patch };
}
