// volume helpers: clamp, --volume parsing, 5% steps, mix into engine gains.
import {
  clampVolume, parseVolumeArg, stepVolume, volumePercent, mixGains, VOLUME_STEP,
  HITSOUND_BOOST, hitsoundSampleGain,
} from '../src/volume.mjs';
import { HitsoundBank } from '../src/audio/hitsounds.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

console.log('\n=== volume ===');

check(clampVolume(0.4) === 0.4, 'passthrough in range');
check(clampVolume(-1) === 0, 'floor at 0');
check(clampVolume(2) === 1, 'cap at 1');
check(clampVolume('nope', 0.8) === 0.8, 'non-numeric uses fallback');
check(clampVolume(undefined, 0.8) === 0.8, 'undefined uses fallback');

check(parseVolumeArg('70') === 0.7, '--volume 70 means 70%');
check(parseVolumeArg('0.4') === 0.4, '--volume 0.4 means 40%');
check(parseVolumeArg('0') === 0, '--volume 0 mutes');
check(parseVolumeArg('150') === 1, '--volume 150 caps at 100%');
check(parseVolumeArg('nope') === null, 'junk --volume is ignored');
check(parseVolumeArg(undefined) === null, 'missing --volume value is ignored');

check(VOLUME_STEP === 0.05, 'steps are 5%');
check(Math.abs(stepVolume(0.8, -1) - 0.75) < 1e-12, '0.80 minus one step is 75%');
check(Math.abs(stepVolume(0.8, 1) - 0.85) < 1e-12, '0.80 plus one step is 85%');
check(stepVolume(0, -1) === 0, 'cannot step below 0');
check(stepVolume(1, 1) === 1, 'cannot step above 1');
check(Math.abs(stepVolume(0.83, 1) - 0.9) < 1e-12, 'off-grid snaps to nearest then steps up');
check(Math.abs(stepVolume(0.83, -1) - 0.80) < 1e-12, 'off-grid snaps to nearest then steps down');

check(volumePercent(0.8) === '80%', 'percent label');
check(volumePercent(0) === '0%', 'muted label');
check(volumePercent(1) === '100%', 'full label');

const mixed = mixGains(0.8, 0.5, 1);
check(Math.abs(mixed.music - 0.4) < 1e-9, 'music gain is master * music');
check(Math.abs(mixed.effect - 0.8 * HITSOUND_BOOST) < 1e-9,
  `effect gain is master * hitsounds * ${HITSOUND_BOOST} boost`);
check(HITSOUND_BOOST > 1, 'hitsounds are mixed hotter than 1:1');
{
  const even = mixGains(0.8, 1, 1);
  check(even.effect > even.music, 'at 100% sliders, hitsounds sit above the song');
}
const silent = mixGains(0, 1, 1);
check(silent.music === 0 && silent.effect === 0, 'master 0 mutes both');

check(hitsoundSampleGain(100) === 1, 'timing volume 100 is full sample gain');
check(hitsoundSampleGain(80) === 0.8, 'timing volume 80 is 80%');
check(hitsoundSampleGain(0) === 0, 'timing volume 0 is silent');
check(hitsoundSampleGain(undefined) === 1, 'missing timing volume defaults to 100');
check(hitsoundSampleGain(100) > 0.9, 'the old 0.9 fudge is gone');

console.log('\n=== synthesized hitsounds ===');
{
  const bank = await HitsoundBank.forBeatmap({ dir: '/tmp/osuterminal-no-samples' }, 44100);
  const samples = await bank.resolve(1, 1, 0);
  let peak = 0;
  for (const s of samples) for (const v of s.pcm) peak = Math.max(peak, Math.abs(v));
  check(peak > 12000, `fallback hitnormal is loud (peak ${peak})`);
}

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall ok');
