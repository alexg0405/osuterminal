// beatmap mirror client.
//
// osu's own api needs an oauth app, so this uses public mirrors instead. no keys, no
// login. catboy is the primary since its search returns full per difficulty info in
// one request, nerinyan is the fallback for downloads if catboy is having a moment.
//
// downloads are .osz files, which are just zips.

const MIRRORS = [
  {
    name: 'catboy',
    search: (q, opts) =>
      `https://catboy.best/api/v2/search?query=${encodeURIComponent(q)}` +
      `&mode=${opts.mode}&limit=${opts.limit}` + (opts.status ? `&status=${opts.status}` : ''),
    download: (id) => `https://catboy.best/d/${id}`,
  },
  {
    name: 'nerinyan',
    search: (q, opts) =>
      `https://api.nerinyan.moe/search?q=${encodeURIComponent(q)}&m=${opts.mode}&ps=${opts.limit}`,
    download: (id) => `https://api.nerinyan.moe/d/${id}`,
  },
];

const TIMEOUT_MS = 30000;

async function fetchWithTimeout(url, opts = {}, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

// flatten a mirror's response into the shape the ui wants
function normalise(set) {
  const diffs = (set.beatmaps ?? [])
    .filter((b) => (b.mode_int ?? b.mode) === 0 || b.mode === 'osu')
    .map((b) => ({
      version: b.version ?? '?',
      stars: Number(b.difficulty_rating ?? 0),
      cs: b.cs, ar: b.ar, od: b.accuracy ?? b.od,
      circles: b.count_circles ?? 0,
      sliders: b.count_sliders ?? 0,
      length: b.total_length ?? 0,
    }))
    .sort((a, b) => a.stars - b.stars);

  return {
    id: set.id,
    artist: set.artist ?? '?',
    title: set.title ?? '?',
    creator: set.creator ?? set.user?.username ?? '?',
    bpm: set.bpm ?? 0,
    status: set.status ?? 'unknown',
    hasVideo: !!set.video,
    diffs,
  };
}

/**
 * search for beatmap sets. only returns sets with at least one std difficulty.
 */
export async function search(query, { mode = 0, limit = 50, status = null } = {}) {
  let lastErr = null;
  for (const m of MIRRORS) {
    try {
      const res = await fetchWithTimeout(m.search(query, { mode, limit, status }));
      if (!res.ok) throw new Error(`${m.name} returned ${res.status}`);
      const json = await res.json();
      const sets = Array.isArray(json) ? json : (json.data ?? json.beatmapsets ?? []);
      const out = sets.map(normalise).filter((s) => s.diffs.length);
      if (out.length || sets.length) return { mirror: m.name, results: out };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`every mirror failed. last error: ${lastErr?.message ?? 'unknown'}`);
}

// thrown when every mirror says 404. that means nobody hosts the file, which is
// different from the network being broken, and the ui should say so differently.
export class NotHostedError extends Error {
  constructor(setId) {
    super(`no mirror has set ${setId}`);
    this.name = 'NotHostedError';
    this.setId = setId;
  }
}

// is this set downloadable at all? search comes from osu's metadata, so plenty of
// results are not actually hosted anywhere.
//
// HEAD is no good here: catboy 404s on HEAD even for maps it has, and nerinyan just
// returns 405. and a Range request does not help either, catboy ignores it and starts
// sending the whole file. so start a normal GET, look at the status, and abort before
// reading any of the body.
// mirrors are asked in parallel, not one after another. going in sequence meant a fast
// 404 from catboy still had to wait out a slow nerinyan, which took over ten seconds
// and is far too slow to run off a highlight.
export async function checkAvailable(setId, timeoutMs = 5000) {
  const probe = async (m) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(m.download(setId), { signal: ctrl.signal, redirect: 'follow' });
      const ok = res.ok && !/text\/html/i.test(res.headers.get('content-type') ?? '');
      ctrl.abort();                       // tear it down, we only wanted the status
      if (!ok) throw new Error('unavailable');
      return m.name;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    // first mirror to say yes wins; rejects only when every one of them fails
    const mirror = await Promise.any(MIRRORS.map(probe));
    return { available: true, mirror };
  } catch {
    return { available: false, mirror: null };
  }
}

/**
 * download a beatmap set as a .osz buffer.
 * onProgress gets (bytesSoFar, totalBytesOrNull).
 */
export async function download(setId, onProgress = null) {
  const errors = [];
  let all404 = true;

  for (const m of MIRRORS) {
    try {
      const res = await fetchWithTimeout(m.download(setId), {}, 120000);
      if (!res.ok) {
        if (res.status !== 404) all404 = false;
        throw new Error(`${m.name} ${res.status}`);
      }

      const total = Number(res.headers.get('content-length')) || null;
      // some mirrors hand back an html error page with a 200, so check the type
      const type = res.headers.get('content-type') ?? '';
      if (/text\/html/i.test(type)) { all404 = false; throw new Error(`${m.name} sent html, not a beatmap`); }

      const chunks = [];
      let got = 0;
      for await (const chunk of res.body) {
        chunks.push(chunk);
        got += chunk.length;
        if (onProgress) onProgress(got, total);
      }
      const buf = Buffer.concat(chunks);
      if (buf.length < 1024) { all404 = false; throw new Error(`${m.name} sent ${buf.length} bytes`); }
      // zips start with PK
      if (buf[0] !== 0x50 || buf[1] !== 0x4b) { all404 = false; throw new Error(`${m.name} sent something that is not a zip`); }
      return { mirror: m.name, buffer: buf };
    } catch (e) {
      if (e.name === 'AbortError') { all404 = false; errors.push(`${m.name} timed out`); }
      else errors.push(e.message);
    }
  }

  if (all404) throw new NotHostedError(setId);
  throw new Error(`could not download ${setId} (${errors.join(', ')})`);
}
