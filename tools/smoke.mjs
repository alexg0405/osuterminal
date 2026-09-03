// tests for decoding, rendering and judgement. doesn't need a terminal.
import { Beatmap } from '../src/core/beatmap.mjs';
import { decodeAudio } from '../src/audio/decode.mjs';
import { Framebuffer } from '../src/render/framebuffer.mjs';
import { Game, sliderProgress } from '../src/game.mjs';
import { HitsoundBank, decodeWavFlexible } from '../src/audio/hitsounds.mjs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const SONGS = path.join(process.env.LOCALAPPDATA, 'osu!', 'Songs');
const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const HEADER = ['osu file format v14', '', '[General]', 'Mode: 0', '',
  '[Difficulty]', 'CircleSize:4', 'OverallDifficulty:8', 'ApproachRate:9',
  'SliderMultiplier:1.4', 'SliderTickRate:1', '',
  '[TimingPoints]', '0,500,4,2,0,100,1,0', '', '[HitObjects]'];
const makeMap = (...objects) => Beatmap.parse([...HEADER, ...objects].join('\n'));

// ---------------------------------------------------------------- decode
console.log('\n=== audio decode ===');
const dirs = await readdir(SONGS, { withFileTypes: true });
let mp3 = null;
for (const d of dirs) {
  if (!d.isDirectory()) continue;
  for (const f of await readdir(path.join(SONGS, d.name)))
    if (f.toLowerCase().endsWith('.mp3')) { mp3 = path.join(SONGS, d.name, f); break; }
  if (mp3) break;
}
const t0 = Date.now();
const audio = await decodeAudio(mp3);
console.log(`  ${path.basename(mp3)}`);
console.log(`  ${(audio.durationMs / 1000).toFixed(1)}s  ${audio.sampleRate}Hz  ${audio.channels}ch  ` +
            `${(audio.pcm.length / 1048576).toFixed(1)} MiB  decoded in ${Date.now() - t0}ms`);
check(audio.pcm.length > 0, 'produced PCM');
check(audio.sampleRate >= 8000 && audio.sampleRate <= 192000, 'plausible sample rate');
check(audio.durationMs > 5000, 'plausible duration');
check(audio.encoderDelaySamples > 0, `LAME encoder delay re-inserted (${audio.encoderDelaySamples} samples)`);
check(audio.pcm.subarray(0, audio.encoderDelaySamples * audio.channels * 2).every((b) => b === 0),
      're-inserted delay is silent');
let peak = 0;
for (let i = 0; i < Math.min(audio.pcm.length, 4_000_000); i += 2) peak = Math.max(peak, Math.abs(audio.pcm.readInt16LE(i)));
check(peak > 1000, `audio is not silent (peak ${peak})`);

// ---------------------------------------------------------------- framebuffer
console.log('\n=== framebuffer ===');
const fb = new Framebuffer(120, 30);
check(fb.width === 120 && fb.height === 60, 'half-block doubles vertical resolution (120x60 px)');
fb.clear(0, 0, 0);
fb.fillCircle(60, 30, 10, 255, 0, 0);
let lit = 0;
for (let i = 0; i < fb.px.length; i += 3) if (fb.px[i] > 128) lit++;
check(Math.abs(lit - Math.PI * 100) / (Math.PI * 100) < 0.15,
      `fillCircle area ~= pi*r^2 (got ${lit}, expect ~${Math.round(Math.PI * 100)})`);

const first = fb.render();
check(first.length > 1000, `first render emits full screen (${first.length} bytes)`);
check(fb.render().length === 0, 'unchanged frame emits nothing (diffing works)');
fb.fillCircle(60, 30, 10, 0, 255, 0);
const third = fb.render();
check(third.length > 0 && third.length < first.length / 2, `partial change emits less (${third.length} bytes)`);

fb.clear();
const N = 200, p0 = Number(process.hrtime.bigint());
for (let i = 0; i < N; i++) { fb.clear(8, 8, 14); fb.fillCircle(30 + i % 40, 30, 9, 255, 100, 170); fb.render(); }
const perFrame = (Number(process.hrtime.bigint()) - p0) / 1e6 / N;
console.log(`  render cost: ${perFrame.toFixed(2)} ms/frame  ->  ${Math.round(1000 / perFrame)} fps ceiling`);
check(perFrame < 8, 'render fits in a 60fps budget');

// ---------------------------------------------------------------- helpers
// play the map perfectly, including holding and tracking every slider
function autoPlay(g) {
  g.frameWall = 0;
  for (const o of g.objects) {
    g.time = o.time;
    g.handleHit(0);
    if (o.kind !== 'slider') continue;
    const steps = Math.max(2, Math.ceil((o.endTime - o.time) / 8));
    for (let i = 1; i <= steps; i++) {
      g.time = o.time + ((o.endTime - o.time) * i) / steps;
      g.updateSliders(o.path.positionAt(sliderProgress(o, Math.min(g.time, o.endTime))), true);
    }
    g.time = o.endTime;
    g.updateSliders(o.path.positionAt(sliderProgress(o, o.endTime)), true);
  }
}

// ---------------------------------------------------------------- circles
console.log('\n=== judgement: circles ===');
const mapFile = (await readdir(path.join(SONGS, '128931 Feint - Tower Of Heaven (You Are Slaves)')))
  .find((f) => f.includes('[Hard]'));
const bm = await Beatmap.load(path.join(SONGS, '128931 Feint - Tower Of Heaven (You Are Slaves)', mapFile));
const w = bm.difficulty.windows;

{
  const g = new Game(bm);
  autoPlay(g);
  const judged = g.objects.filter((o) => o.result).length;
  check(judged === g.objects.length, `flawless play resolves all ${g.objects.length} objects (${judged})`);
  check(g.counts.GREAT === g.objects.length, `all judged 300 (${g.counts.GREAT})`);
  check(Math.abs(g.accuracy - 1) < 1e-9, `accuracy 100% (${(g.accuracy * 100).toFixed(2)}%)`);
  check(g.counts.MISS === 0, 'no misses');
}

const circleMap = makeMap('100,100,1000,1,0', '200,200,3000,1,0', '300,300,5000,1,0');
const cw = circleMap.difficulty.windows;
const atOffset = (off) => { const g = new Game(circleMap); g.frameWall = 0; g.time = 1000 + off; return g.handleHit(0); };
check(atOffset(cw.great - 0.5) === 'GREAT', `just inside 300 window (+-${cw.great}ms)`);
check(atOffset(cw.great + 0.5) === 'OK',    'just outside 300 -> 100');
check(atOffset(cw.ok + 0.5)    === 'MEH',   'just outside 100 -> 50');
check(atOffset(cw.meh + 1)     === null,    'outside 50 window -> swallowed');
check(atOffset(-cw.meh - 1)    === null,    'far too early -> swallowed');

{
  const g = new Game(circleMap); g.frameWall = 0; g.time = 1000;
  const o = g.objects[0];
  const rad = g.diff.radius;
  check(g.handleHit(0, { x: o.x + rad * 4, y: o.y }) === null,
    'a click far from the circle is ignored');
  check(o.headResult === null, 'a miss-aimed tap does not consume the note');
  check(g.handleHit(0, { x: o.x, y: o.y }) === 'GREAT', 'the same note is still hittable on-circle');
}

{
  const g = new Game(circleMap); g.frameWall = 0;
  g.time = 5000; g.processMisses();
  check(g.counts.MISS === 2, `objects skipped past expire as misses (${g.counts.MISS})`);
  check(g.combo === 0, 'a miss breaks combo');
  check(g.handleHit(0) === 'GREAT', 'the next object is still hittable');
}

{
  const g = new Game(makeMap('100,100,1000,1,0', '200,200,1040,1,0')); g.frameWall = 0;
  const [a, b] = g.objects;
  g.time = b.time;
  const kind = g.handleHit(0);
  check(a.result !== null, 'note-lock: the EARLIER object claims the tap');
  check(b.result === null, 'note-lock: the later object is untouched');
  check(kind === 'OK', `40ms late grades below 300 (${kind})`);
}

// ---------------------------------------------------------------- sliders
console.log('\n=== judgement: sliders ===');
// 200px straight slider. SliderMultiplier 1.4 at beatLength 500 = 280px per beat.
const sliderMap = makeMap('100,100,1000,2,0,L|300:100,1,200');
{
  const g = new Game(sliderMap);
  const s = g.objects[0];
  const expectedSpan = 200 / (100 * 1.4 / 500);
  check(s.kind === 'slider', 'slider parsed as a slider');
  check(Math.abs(s.path.length - 200) < 0.01, `path fitted to 200px (${s.path.length.toFixed(3)})`);
  check(Math.abs(s.timing.spanDuration - expectedSpan) < 1,
        `span duration ${expectedSpan.toFixed(0)}ms (${s.timing.spanDuration.toFixed(1)})`);
  const mid = s.path.positionAt(0.5);
  check(Math.abs(mid.x - 200) < 0.01 && Math.abs(mid.y - 100) < 0.01,
        `midpoint is (200,100) (got ${mid.x.toFixed(1)},${mid.y.toFixed(1)})`);
  check(s.ticks.length >= 1, `at least one tick generated (${s.ticks.length})`);
}
{
  const g = new Game(sliderMap);
  autoPlay(g);
  const s = g.objects[0];
  check(s.result === 'GREAT', `fully tracked slider -> 300 (${s.result})`);
  check(s.tailHit === true, 'tail registered');
  check(s.ticks.every((t) => t.hit), 'all ticks registered');
}
{
  const g = new Game(sliderMap); g.frameWall = 0;
  const s = g.objects[0];
  g.time = s.time; g.handleHit(0);
  for (let t = s.time; t <= s.endTime; t += 8) { g.time = t; g.updateSliders({ x: s.x, y: s.y }, false); }
  g.time = s.endTime; g.updateSliders({ x: s.x, y: s.y }, false);
  check(s.result !== 'GREAT', `head-only slider is not a 300 (${s.result})`);
  check(s.result !== null, 'head-only slider still resolves');
  check(s.ticks.every((t) => t.hit === false), 'untracked ticks are missed');
}
{
  const g = new Game(sliderMap); g.frameWall = 0;
  const s = g.objects[0];
  g.time = s.time; g.handleHit(0);
  for (let t = s.time; t <= s.endTime; t += 8) { g.time = t; g.updateSliders({ x: 500, y: 350 }, true); }
  g.time = s.endTime; g.updateSliders({ x: 500, y: 350 }, true);
  check(s.ticks.every((t) => t.hit === false), 'holding far from the ball does not track');
  check(s.result !== 'GREAT', `out-of-range slider is not a 300 (${s.result})`);
}
{
  const g = new Game(sliderMap); g.frameWall = 0;
  const s = g.objects[0];
  g.time = s.time + cw.meh + 200; g.processMisses();
  check(s.headResult === 'MISS', 'head expired as a miss');
  for (let t = g.time; t <= s.endTime; t += 8) {
    g.time = t;
    g.updateSliders(s.path.positionAt(sliderProgress(s, Math.min(t, s.endTime))), true);
  }
  g.time = s.endTime; g.updateSliders(s.path.positionAt(sliderProgress(s, s.endTime)), true);
  check(s.result !== null, `slider resolves after a missed head (${s.result})`);
}
{
  const g = new Game(makeMap('100,100,1000,2,0,L|300:100,2,200'));
  const s = g.objects[0];
  check(s.slides === 2, 'two slides parsed');
  check(Math.abs(s.timing.duration - 2 * s.timing.spanDuration) < 1e-6, 'duration covers both spans');
  check(s.repeats.length === 1, `one repeat arrow (${s.repeats.length})`);
  check(Math.abs(sliderProgress(s, s.time) - 0) < 1e-6, 'progress starts at 0');
  check(Math.abs(sliderProgress(s, s.time + s.timing.spanDuration) - 1) < 1e-3,
        `progress reaches 1 at the reverse (${sliderProgress(s, s.time + s.timing.spanDuration).toFixed(4)})`);
  check(Math.abs(sliderProgress(s, s.endTime) - 0) < 1e-3,
        `progress returns to 0 at the end (${sliderProgress(s, s.endTime).toFixed(4)})`);
}

{
  const g = new Game(circleMap);
  g.counts = { GREAT: 1, OK: 1, MEH: 0, MISS: 0 };
  check(Math.abs(g.accuracy - (300 + 100) / 600) < 1e-9, 'accuracy = (300a+100b+50c)/(300n)');
}

console.log('\n=== mods ===');
{
  const g = new Game(circleMap, { mods: { hardRock: true } });
  check(g.objects[0].y === 384 - 100, `HR flips y=100 to ${384 - 100} (got ${g.objects[0].y})`);
  check(g.objects[0].x === 100, 'HR leaves x alone');
  check(g.diff.cs === 5.6, `HR CS 4 -> 5.6 (got ${g.diff.cs})`);
  check(g.diff.ar === 10, 'HR AR 9 caps at 10');
  check(g.diff.od === 10, 'HR OD 8 caps at 10');
  const later = new Game(circleMap);
  check(later.objects[0].y === 100, 'a following NM play is not flipped');
  check(circleMap.hitObjects[0].y === 100, 'the beatmap itself is not mutated');
}
{
  const g = new Game(sliderMap, { mods: { hardRock: true } });
  const s = g.objects[0];
  const mid = s.path.positionAt(0.5);
  check(Math.abs(mid.y - (384 - 100)) < 0.01 && Math.abs(mid.x - 200) < 0.01,
    `HR slider body is flipped (mid ${mid.x.toFixed(1)},${mid.y.toFixed(1)})`);
}
{
  const g = new Game(circleMap, { mods: { hidden: true } });
  g.frameWall = 0;
  g.time = 1000;
  check(g.handleHit(0) === 'GREAT', 'Hidden does not change hit windows');
  check(g.diff.windows.great === circleMap.difficulty.windows.great, 'HD keeps the map OD');
}
{
  const g = new Game(makeMap('100,100,1000,1,0'));
  g.frameWall = 0; g.time = 1000; g.handleHit(0);
  const hr = new Game(makeMap('100,100,1000,1,0'), { mods: { hardRock: true } });
  hr.frameWall = 0; hr.time = 1000; hr.handleHit(0);
  check(hr.score > g.score, `HR score bonus (${hr.score} > ${g.score})`);
}

// ---------------------------------------------------------------- hitsounds
console.log('\n=== hitsounds ===');
{
  // build a wav in each format that actually shows up in real beatmaps
  const buildWav = (format, bits, channels, rate, frames) => {
    const bytes = bits >> 3;
    const dataLen = frames * channels * bytes;
    const b = Buffer.alloc(44 + dataLen);
    b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8, 'latin1');
    b.write('fmt ', 12, 'latin1'); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(format, 20); b.writeUInt16LE(channels, 22);
    b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * channels * bytes, 28);
    b.writeUInt16LE(channels * bytes, 32); b.writeUInt16LE(bits, 34);
    b.write('data', 36, 'latin1'); b.writeUInt32LE(dataLen, 40);
    for (let i = 0; i < frames * channels; i++) {
      const v = Math.sin(i * 0.1) * 0.5;
      const o = 44 + i * bytes;
      if (format === 3 && bits === 32) b.writeFloatLE(v, o);
      else if (format === 1 && bits === 16) b.writeInt16LE(Math.round(v * 32767), o);
      else if (format === 1 && bits === 8) b[o] = Math.round(v * 127) + 128;
      else if (format === 1 && bits === 32) b.writeInt32LE(Math.round(v * 2147483647), o);
    }
    return b;
  };

  for (const [fmt, bits, label] of [[3, 32, 'float32'], [1, 16, 'pcm16'], [1, 8, 'pcm8'], [1, 32, 'pcm32']]) {
    const d = decodeWavFlexible(buildWav(fmt, bits, 2, 48000, 100));
    check(d !== null && d.channels === 2 && d.sampleRate === 48000 && d.data.length === 200,
          `decodes ${label} stereo 48kHz`);
    if (d) {
      let peak = 0;
      for (const v of d.data) peak = Math.max(peak, Math.abs(v));
      check(peak > 0.3 && peak <= 1.0, `  ${label} normalised to +-1 (peak ${peak.toFixed(3)})`);
    }
  }
  check(decodeWavFlexible(Buffer.alloc(20)) === null, 'rejects a truncated file rather than throwing');
  check(decodeWavFlexible(Buffer.from('NOTAWAVE'.repeat(8))) === null, 'rejects a non-WAV');
}
{
  // a folder with no samples in it should still give us sound for everything
  const bank = await HitsoundBank.forBeatmap({ dir: path.join(SONGS, '__does_not_exist__') }, 44100);
  const samples = await bank.resolve(2, 1 | 2 | 4 | 8, 0);
  check(samples.length === 4, `normal+whistle+finish+clap resolves to 4 samples (${samples.length})`);
  check(samples.every((s) => s.pcm.length > 0), 'every fallback is non-empty');
  let peak = 0;
  for (const s of samples) for (const v of s.pcm) peak = Math.max(peak, Math.abs(v));
  check(peak > 3000, `synthesized samples are audible (peak ${peak})`);
  check(bank.loaded === 0 && bank.synthesized === 4, `all four synthesized (${bank.synthesized})`);

  const justNormal = await bank.resolve(2, 1, 0);
  check(justNormal.length === 1, 'a plain hit resolves to one sample');
}
{
  // with a real beatmap the samples it ships should load off disk
  const bank = await HitsoundBank.forBeatmap(bm, 44100);
  await bank.prime(bm);
  check(bank.loaded > 0, `loads real samples from the beatmap folder (${bank.loaded})`);
  const s = await bank.resolve(bm.timingPoints[0].sampleSet, 1, 0);
  check(s[0].pcm.length > 0, 'resolved sample has audio');
  check(bm.timingPoints[0].sampleSet >= 0 && bm.timingPoints[0].volume > 0,
        `timing points expose sampleSet/volume (set ${bm.timingPoints[0].sampleSet}, vol ${bm.timingPoints[0].volume})`);
}
{
  // objects get their samples attached up front so nothing awaits mid game
  const g = new Game(bm);
  await g.prepareAudio(44100);
  const withSamples = g.objects.filter((o) => o.samples?.length).length;
  check(withSamples === g.objects.length, `all ${g.objects.length} objects have samples attached (${withSamples})`);
  check(g.objects.every((o) => o.sampleGain > 0 && o.sampleGain <= 1), 'sample gains are in range');
  check(g.tickSample?.pcm.length > 0, 'slider tick sample resolved');
}

// ---------------------------------------------------------------- osz extraction
console.log('\n=== osz extraction ===');
{
  const { zipSync } = await import('fflate');
  const { extractOsz, folderNameFor, alreadyHave } = await import('../src/net/osz.mjs');
  const { rm, readdir, readFile } = await import('node:fs/promises');
  const enc = (s) => new TextEncoder().encode(s);

  const tmp = path.join(process.env.TEMP ?? '/tmp', 'osuterminal-osz-test');
  await rm(tmp, { recursive: true, force: true });

  const osu = ['osu file format v14', '', '[General]', 'Mode: 0', '',
    '[Difficulty]', 'CircleSize:4', 'OverallDifficulty:8', 'ApproachRate:9', '',
    '[TimingPoints]', '0,500,4,2,0,100,1,0', '',
    '[HitObjects]', '100,100,1000,1,0'].join('\n');

  const zip = zipSync({
    'song [Easy].osu': enc(osu),
    'song [Hard].osu': enc(osu),
    'audio.mp3': enc('not really an mp3 but it is a file'),
    'bg.jpg': enc('image bytes'),
    'video.mp4': enc('x'.repeat(50000)),      // should be skipped
    'storyboard.osb': enc('sb'),              // should be skipped
    'readme.txt': enc('junk'),                // not in the keep list
  });

  const r = await extractOsz(Buffer.from(zip), tmp, { setId: 999, artist: 'Test', title: 'Song' });
  const onDisk = (await readdir(r.dir)).sort();
  check(r.osuCount === 2, `both .osu files extracted (${r.osuCount})`);
  check(onDisk.includes('audio.mp3') && onDisk.includes('bg.jpg'), 'audio and background kept');
  check(!onDisk.includes('video.mp4'), 'video skipped');
  check(!onDisk.includes('storyboard.osb'), 'storyboard skipped');
  check(!onDisk.includes('readme.txt'), 'unknown file types skipped');
  check(r.skipped === 3, `three files skipped (${r.skipped})`);
  check(r.folder === '999 Test - Song', `folder named like osu does (${r.folder})`);
  check(await alreadyHave(tmp, 999), 'alreadyHave finds it afterwards');
  check(!(await alreadyHave(tmp, 1000)), 'alreadyHave says no for a set we do not have');

  // the extracted maps have to survive our own parser
  const parsed = await Beatmap.load(path.join(r.dir, 'song [Easy].osu'));
  check(parsed.isStandard && parsed.hitObjects.length === 1, 'extracted .osu parses');

  // a zip entry that tries to escape the folder must not
  const evil = zipSync({
    '../../../pwned.osu': enc(osu),
    'ok [Normal].osu': enc(osu),
  });
  const r2 = await extractOsz(Buffer.from(evil), tmp, { setId: 998, artist: 'Evil', title: 'Zip' });
  const escaped = (await readdir(tmp)).includes('pwned.osu');
  check(!escaped, 'path traversal entry cannot escape the songs folder');
  check(r2.written.every((f) => !f.includes('..')), 'no .. survives in written paths');

  // filenames windows will not accept
  const nasty = zipSync({ 'a:b*c?.osu': enc(osu) });
  const r3 = await extractOsz(Buffer.from(nasty), tmp, { setId: 997, artist: 'Bad<>Name', title: 'Q?' });
  check(!/[<>:"|?*]/.test(r3.folder), `folder name sanitised (${r3.folder})`);
  check(r3.osuCount === 1, 'file with illegal characters still extracted');

  // empty and broken archives
  let threw = false;
  try { await extractOsz(Buffer.from(zipSync({ 'only.txt': enc('x') })), tmp, { setId: 1, artist: 'a', title: 'b' }); }
  catch { threw = true; }
  check(threw, 'archive with no .osu files is rejected');

  threw = false;
  try { await extractOsz(Buffer.from('not a zip at all'), tmp, { setId: 2, artist: 'a', title: 'b' }); }
  catch { threw = true; }
  check(threw, 'garbage input is rejected');

  check(folderNameFor(123, 'A/B', 'C:D') === '123 A_B - C_D', 'folderNameFor sanitises slashes and colons');

  await rm(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------- availability logic
// mocked fetch so this stays offline. the point is the status handling: a 403 must not
// be mistaken for "not hosted", which is the bug that made a whole page look dead.
console.log('\n=== availability status handling ===');
{
  const { checkAvailable, isRateLimited, clearRateLimit } = await import('../src/net/mirror.mjs');

  const fakeFetch = (status, type = 'application/x-osu-beatmap-archive') => async () => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) },
  });

  clearRateLimit();
  check((await checkAvailable(1, { fetchImpl: fakeFetch(200) })).status === 'yes', '200 means hosted');

  clearRateLimit();
  check((await checkAvailable(1, { fetchImpl: fakeFetch(404) })).status === 'no', '404 from every mirror means not hosted');

  clearRateLimit();
  const limited = await checkAvailable(1, { fetchImpl: fakeFetch(403) });
  check(limited.status === 'unknown', '403 is unknown, NOT "not hosted"');
  check(isRateLimited() === true, '403 trips the rate limit flag');
  check((await checkAvailable(2, { fetchImpl: fakeFetch(404) })).status === 'unknown',
        'once rate limited it stops asking and answers unknown');

  clearRateLimit();
  check(isRateLimited() === false, 'the flag can be cleared');
  check((await checkAvailable(1, { fetchImpl: fakeFetch(429) })).status === 'unknown', '429 is unknown too');

  clearRateLimit();
  check((await checkAvailable(1, { fetchImpl: fakeFetch(500) })).status === 'unknown', '500 is unknown');

  clearRateLimit();
  check((await checkAvailable(1, { fetchImpl: fakeFetch(200, 'text/html') })).status === 'unknown',
        'a 200 that is actually an html error page is not treated as hosted');

  clearRateLimit();
  const boom = async () => { throw new Error('network down'); };
  check((await checkAvailable(1, { fetchImpl: boom })).status === 'unknown', 'a network error is unknown, not missing');

  // one mirror 404s, the other has it
  clearRateLimit();
  let call = 0;
  const mixed = async () => {
    call++;
    const status = call === 1 ? 404 : 200;
    return { status, ok: status === 200, headers: { get: () => 'application/zip' } };
  };
  check((await checkAvailable(1, { fetchImpl: mixed })).status === 'yes',
        'one mirror missing it but another having it still counts as hosted');
  clearRateLimit();
}

console.log(`\n${failures === 0 ? '\x1b[1;32mall checks passed\x1b[0m' : `\x1b[1;31m${failures} failure(s)\x1b[0m`}\n`);
process.exit(failures ? 1 : 0);
