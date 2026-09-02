// hits the real mirrors, so this one needs internet. kept out of smoke.mjs so that
// stays offline and fast.
//
// the ids here are picked on purpose: some are hosted, some exist in search but are
// not hosted anywhere. that second case is common and used to just look like a crash.

import { search, download, checkAvailable, NotHostedError } from '../src/net/mirror.mjs';
import { extractOsz } from '../src/net/osz.mjs';
import { Beatmap } from '../src/core/beatmap.mjs';
import { rm, readdir } from 'node:fs/promises';
import path from 'node:path';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

const HOSTED = 354366;      // nekodex circles!, catboy has it
const NOT_HOSTED = 844554;  // harumachi clover swing arrange, in search but nobody hosts it

console.log('\n=== search ===');
{
  const t = Date.now();
  const { mirror, results } = await search('nekodex', { limit: 10 });
  console.log(`  ${results.length} sets from ${mirror} in ${Date.now() - t}ms`);
  check(results.length > 0, 'search returns results');
  check(results.every((r) => r.id && r.artist && r.title), 'every result has id, artist, title');
  check(results.every((r) => r.diffs.length > 0), 'every result has at least one std difficulty');
  check(results.every((r) => r.diffs.every((d) => d.stars >= 0)), 'difficulties carry a star rating');
  const sorted = results[0].diffs.every((d, i, a) => i === 0 || a[i - 1].stars <= d.stars);
  check(sorted, 'difficulties come back easiest first');
}

console.log('\n=== availability ===');
{
  let t = Date.now();
  const a = await checkAvailable(HOSTED);
  const tHosted = Date.now() - t;
  check(a.status === 'yes', `hosted set reports available (via ${a.mirror}, ${tHosted}ms)`);
  check(tHosted < 4000, `hosted answer is quick enough for a ui (${tHosted}ms)`);

  t = Date.now();
  const b = await checkAvailable(NOT_HOSTED);
  const tMissing = Date.now() - t;
  check(b.status === 'no', `unhosted set reports unavailable (${tMissing}ms)`);
  check(tMissing < 7000, `unhosted answer still bounded by the timeout (${tMissing}ms)`);
}

console.log('\n=== bulk availability scan ===');
{
  const { results } = await search('harumachi clover', { limit: 30 });
  check(results.length > 10, `enough results to be worth scanning (${results.length})`);

  let firstAt = null;
  const t = Date.now();
  const map = await checkManyAvailable(results.map((r) => r.id), {
    onResult: () => { if (firstAt === null) firstAt = Date.now() - t; },
  });
  const total = Date.now() - t;
  const dead = [...map.values()].filter((v) => v === false).length;
  console.log(`  ${map.size} sets in ${total}ms, first mark after ${firstAt}ms, ${dead} unavailable`);

  check(map.size === results.length, `every result got a verdict (${map.size}/${results.length})`);
  check(firstAt !== null && firstAt < 2000, `first mark lands quickly (${firstAt}ms)`);
  check(total < 15000, `whole page scanned in reasonable time (${total}ms)`);
  check(dead > 0, `the scan actually finds unhosted sets (${dead})`);
  check(map.get(NOT_HOSTED) === false, 'the set that failed by hand is flagged unavailable');
  check(map.get(557118) === true, 'a sibling set that IS hosted is not flagged');

  // aborting has to actually stop the workers, otherwise a new search races the old scan
  const ac = new AbortController();
  let seen = 0;
  const t2 = Date.now();
  const p = checkManyAvailable(results.map((r) => r.id), { signal: ac.signal, onResult: () => { seen++; } });
  setTimeout(() => ac.abort(), 400);
  await p;
  check(seen < results.length, `abort stops the scan early (${seen}/${results.length} checked)`);
  check(Date.now() - t2 < 4000, 'abort returns promptly');
}

console.log('\n=== download ===');
{
  let threw = null;
  try { await download(NOT_HOSTED); } catch (e) { threw = e; }
  check(threw instanceof NotHostedError, `a set nobody hosts throws NotHostedError, not a raw string (${threw?.name})`);
  check(threw?.setId === NOT_HOSTED, 'the error carries the set id');

  const t = Date.now();
  let got = null;
  const seen = [];
  got = await download(HOSTED, (b, total) => seen.push([b, total]));
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  const mib = (got.buffer.length / 1048576).toFixed(2);
  console.log(`  ${mib} MiB from ${got.mirror} in ${secs}s`);
  check(got.buffer.length > 100000, 'download returns a real payload');
  check(got.buffer[0] === 0x50 && got.buffer[1] === 0x4b, 'payload is a zip');
  check(seen.length > 1, `progress callback fired ${seen.length} times`);
  check(seen.at(-1)[0] === got.buffer.length, 'final progress matches the payload size');

  const tmp = path.join(process.env.TEMP ?? '/tmp', 'osuterminal-mirror-test');
  await rm(tmp, { recursive: true, force: true });
  const r = await extractOsz(got.buffer, tmp, { setId: HOSTED, artist: 'nekodex', title: 'circles!' });
  check(r.osuCount > 0, `extracted ${r.osuCount} difficulties`);

  let parsed = 0;
  for (const f of await readdir(r.dir)) {
    if (!f.endsWith('.osu')) continue;
    const b = await Beatmap.load(path.join(r.dir, f));
    if (b.isStandard && b.hitObjects.length) parsed++;
  }
  check(parsed === r.osuCount, `all ${r.osuCount} downloaded maps parse and are playable`);
  await rm(tmp, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? '\x1b[1;32mall checks passed\x1b[0m' : `\x1b[1;31m${failures} failure(s)\x1b[0m`}\n`);
process.exit(failures ? 1 : 0);
