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

/**
 * download a beatmap set as a .osz buffer.
 * onProgress gets (bytesSoFar, totalBytesOrNull).
 */
export async function download(setId, onProgress = null) {
  let lastErr = null;
  for (const m of MIRRORS) {
    try {
      const res = await fetchWithTimeout(m.download(setId), {}, 120000);
      if (!res.ok) throw new Error(`${m.name} returned ${res.status}`);

      const total = Number(res.headers.get('content-length')) || null;
      // some mirrors hand back an html error page with a 200, so sanity check the type
      const type = res.headers.get('content-type') ?? '';
      if (/text\/html/i.test(type)) throw new Error(`${m.name} returned html, not a beatmap`);

      const chunks = [];
      let got = 0;
      for await (const chunk of res.body) {
        chunks.push(chunk);
        got += chunk.length;
        if (onProgress) onProgress(got, total);
      }
      const buf = Buffer.concat(chunks);
      if (buf.length < 1024) throw new Error(`${m.name} returned ${buf.length} bytes`);
      // zips start with PK
      if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error(`${m.name} did not return a zip`);
      return { mirror: m.name, buffer: buf };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`could not download ${setId}. last error: ${lastErr?.message ?? 'unknown'}`);
}
