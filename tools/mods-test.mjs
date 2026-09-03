// Hidden / Hard Rock: parsing, difficulty, fade, score.
// does not import game.mjs (that loads Win32 via koffi).
import { Beatmap, Difficulty } from '../src/core/beatmap.mjs';
import {
  emptyMods, normalizeMods, parseModsList, consumeModFlag, applyModFlag,
  applyModsToDifficulty, flipY, PLAYFIELD_H, HR_RATE, HR_CAP,
  objectAlpha, approachAlpha, modsAcronyms, modsLabel, scoreMultiplier,
  HD_FADE_IN_MUL, HD_FADE_OUT_MUL, HD_SCORE_MUL, HR_SCORE_MUL,
  toggleHidden, toggleHardRock,
} from '../src/core/mods.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };
const almost = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('\n=== parse ===');
check(parseModsList('hd').hidden && !parseModsList('hd').hardRock, 'hd');
check(parseModsList('hr').hardRock && !parseModsList('hr').hidden, 'hr');
check(parseModsList('hd,hr').hidden && parseModsList('hd,hr').hardRock, 'hd,hr');
check(parseModsList('HDHR').hidden && parseModsList('HDHR').hardRock, 'HDHR compact');
check(parseModsList('hidden+hardrock').hidden && parseModsList('hidden+hardrock').hardRock, 'words');
check(!parseModsList('nm').hidden && !parseModsList('nm').hardRock, 'nm clears');
check(!parseModsList('').hidden && !parseModsList(null).hardRock, 'empty is NM');

{
  let m = emptyMods();
  m = applyModFlag(m, consumeModFlag('--hd'));
  check(m.hidden && !m.hardRock, '--hd');
  m = applyModFlag(m, consumeModFlag('--hr'));
  check(m.hidden && m.hardRock, '--hd then --hr stacks');
  m = applyModFlag(m, consumeModFlag('--nm'));
  check(!m.hidden && !m.hardRock, '--nm clears both');
  const flag = consumeModFlag('--mods', 'hdhr');
  check(flag.consume === 1, '--mods consumes the next arg');
  m = applyModFlag(emptyMods(), flag);
  check(m.hidden && m.hardRock, '--mods hdhr');
  check(consumeModFlag('--volume') === null, 'other flags are left alone');
}

check(modsAcronyms({ hidden: true, hardRock: true }) === 'HDHR', 'acronym order is HD then HR');
check(modsLabel(emptyMods()) === 'NM', 'no mods labels as NM');
check(almost(scoreMultiplier({ hidden: true, hardRock: true }), HD_SCORE_MUL * HR_SCORE_MUL),
  'HDHR multiplies both bonuses');
check(toggleHidden(emptyMods()).hidden, 'toggle Hidden on');
check(!toggleHardRock({ hardRock: true }).hardRock, 'toggle Hard Rock off');
check(normalizeMods({ hidden: 1, extra: true }).hidden && !normalizeMods({ hidden: 1 }).hardRock,
  'unknown keys are ignored');

console.log('\n=== hard rock difficulty ===');
{
  const d = applyModsToDifficulty(new Difficulty({ cs: 4, ar: 9, od: 8, hp: 5 }), { hardRock: true });
  check(d.cs === 5.6, `CS 4 * 1.4 = 5.6 (got ${d.cs})`);
  check(d.ar === 10, `AR 9 * 1.4 caps at 10 (got ${d.ar})`);
  check(d.od === 10, `OD 8 * 1.4 caps at 10 (got ${d.od})`);
  check(d.hp === 7, `HP 5 * 1.4 = 7 (got ${d.hp})`);
  check(d.preempt === new Difficulty({ ar: 10 }).preempt, 'preempt uses the capped AR');
  check(d.windows.great === new Difficulty({ od: 10 }).windows.great, 'hit windows use the capped OD');
  check(d.radius < new Difficulty({ cs: 4 }).radius, 'HR circles are smaller');
}
{
  const src = new Difficulty({ cs: 4, ar: 5, od: 5 });
  const left = applyModsToDifficulty(src, emptyMods());
  check(left === src, 'NM returns the same Difficulty object');
}
{
  const d = applyModsToDifficulty(new Difficulty({ cs: 4, ar: 3, od: 8 }), { hardRock: true });
  check(d.ar === 4.2, `AR 3 * 1.4 rounds to 4.2 (got ${d.ar})`);
}

check(flipY(0) === PLAYFIELD_H, 'HR flips y=0 to the bottom');
check(flipY(192) === 192, 'HR centre stays centre');
check(flipY(100) === 284, 'HR 100 -> 284');
check(HR_RATE === 1.4 && HR_CAP === 10, 'osu!stable HR constants');

console.log('\n=== hidden fade ===');
{
  const pre = 1200, fade = 800; // AR5
  check(objectAlpha(pre, pre, fade, false) === 0, 'NM is invisible at appear time');
  check(objectAlpha(pre - fade, pre, fade, false) === 1, 'NM is fully in after fadeIn');
  check(objectAlpha(0, pre, fade, false) === 1, 'NM stays opaque at hit time');
  check(approachAlpha(pre - fade / 2, pre, fade) === 0.5, 'approach fade-in is linear');

  const hdIn = fade * HD_FADE_IN_MUL;
  const hdOut = pre * HD_FADE_OUT_MUL;
  check(almost(objectAlpha(pre - hdIn / 2, pre, fade, true), 0.5), 'HD fade-in is 0.4x and linear');
  check(almost(objectAlpha(pre - hdIn, pre, fade, true), 1), 'HD is fully in at the end of its fade-in');
  check(objectAlpha(0, pre, fade, true) === 0, 'HD is gone by hit time');
  check(objectAlpha(pre - hdIn - hdOut, pre, fade, true) === 0, 'HD finishes fading out before the hit');
  check(objectAlpha(-50, pre, fade, true) === 0, 'HD stays gone after the hit');
  check(approachAlpha(0, pre, fade) === 1, 'approach circles stay with Hidden');
}
{
  const pre = new Difficulty({ ar: 9 }).preempt;
  const fade = new Difficulty({ ar: 9 }).fadeIn;
  check(objectAlpha(0, pre, fade, true) === 0, 'AR9 HD is still gone at hit time');
  check(objectAlpha(pre * 0.5, pre, fade, false) > 0, 'AR9 NM is visible at half preempt');
}

console.log('\n=== beatmap is not mutated ===');
{
  const map = Beatmap.parse([
    'osu file format v14', '', '[General]', 'Mode: 0', '',
    '[Difficulty]', 'CircleSize:4', 'OverallDifficulty:8', 'ApproachRate:9', '',
    '[TimingPoints]', '0,500,4,2,0,100,1,0', '',
    '[HitObjects]', '100,100,1000,1,0',
  ].join('\n'));
  applyModsToDifficulty(map.difficulty, { hardRock: true });
  check(map.difficulty.cs === 4 && map.difficulty.ar === 9, 'HR difficulty copy does not rewrite the map');
  check(map.hitObjects[0].y === 100, 'object y is still the authored value');
}

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall ok\n');
