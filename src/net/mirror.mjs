// beatmap mirror client.
//
// osu's own api needs an oauth app, so this goes through public mirrors instead. no
// keys, no login. downloads are .osz files, which are just zips.

// four of them, because any one can be down, banned, or just having a bad day. all of
// them return the same osu api shape for search, so normalise() handles them all.
//
// entries can do search, download, or both. sayobot is download only since its search
// api is a different format and we do not need it.
const MIRRORS = [
  {
    name: 'catboy',
    search: (q, o) =>
      `https://catboy.best/api/v2/search?query=${encodeURIComponent(q)}` +
      `&mode=${o.mode}&limit=${o.limit}` + (o.status ? `&status=${o.status}` : ''),
    download: (id) => `https://catboy.best/d/${id}`,
  },
  {
    name: 'osu.direct',
    search: (q, o) =>
      `https://osu.direct/api/v2/search?query=${encodeURIComponent(q)}&amount=${o.limit}&mode=${o.mode}`,
    download: (id) => `https://osu.direct/api/d/${id}`,
  },
  {
    name: 'nerinyan',
    search: (q, o) =>
      `https://api.nerinyan.moe/search?q=${encodeURIComponent(q)}&m=${o.mode}&ps=${o.limit}`,
    download: (id) => `https://api.nerinyan.moe/d/${id}`,
  },
  {
    // dl.sayobot.cn is flaky, txy1 is their cdn host and answers reliably.
    // novideo because we throw the video away on extract anyway.
    name: 'sayobot',
    download: (id) => `https://txy1.sayobot.cn/beatmaps/download/novideo/${id}`,
  },
];

const SEARCH_MIRRORS = MIRRORS.filter((m) => m.search);

// a mirror that 403s or 429s us gets dropped for the rest of the session. tracked per
// mirror rather than globally, otherwise one banned mirror either takes everything down
// or gets retried forever.
const blocked = new Set();
export const blockedMirrors = () => [...blocked];
export const isRateLimited = () => blocked.size > 0 && blocked.size >= SEARCH_MIRRORS.length;
export const clearRateLimit = () => blocked.clear();
const usable = (list) => list.filter((m) => !blocked.has(m.name));

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
  const errors = [];
  for (const m of usable(SEARCH_MIRRORS)) {
    try {
      const res = await fetchWithTimeout(m.search(query, { mode, limit, status }));
      if (res.status === 403 || res.status === 429) { blocked.add(m.name); throw new Error(`${m.name} blocked us`); }
      if (!res.ok) throw new Error(`${m.name} ${res.status}`);
      const json = await res.json();
      const sets = Array.isArray(json) ? json : (json.data ?? json.beatmapsets ?? []);
      const out = sets.map(normalise).filter((s) => s.diffs.length);
      if (out.length || sets.length) return { mirror: m.name, results: out };
    } catch (e) {
      errors.push(e.name === 'AbortError' ? `${m.name} timed out` : e.message);
    }
  }
  throw new Error(`no mirror answered (${errors.join(', ')})`);
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
// results are not hosted on any mirror.
//
// HEAD is no good for this: catboy 404s on HEAD even for maps it has, and nerinyan
// returns 405. a Range request does not work either, catboy ignores it and starts
// sending the whole file. so it starts a normal GET, reads the status, and aborts
// before touching the body.
//
// this only ever runs for the one set you are looking at. i tried scanning a whole
// page of 30 in parallel and catboy banned us outright for it. not worth it.
//
// 'yes' hosted, 'no' definitely not hosted, 'unknown' could not tell.
// only a real 404 means 'no'. a 403 or a timeout means we were blocked or the mirror is
// having a bad day, and treating that as 'not hosted' marks half the page dead wrongly.
export async function checkAvailable(setId, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const list = usable(MIRRORS);
  if (!list.length) return { status: 'unknown', mirror: null };

  let saw404 = false;
  let anyAnswered = false;
  for (const m of list) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(m.download(setId), { signal: ctrl.signal, redirect: 'follow' });
      ctrl.abort();                        // we only wanted the status line

      if (res.status === 403 || res.status === 429) { blocked.add(m.name); continue; }
      anyAnswered = true;
      if (res.status === 404) { saw404 = true; continue; }
      if (res.ok && !/text\/html/i.test(res.headers.get('content-type') ?? '')) {
        return { status: 'yes', mirror: m.name };
      }
    } catch {
      /* timeout or network error, tells us nothing */
    } finally {
      clearTimeout(timer);
    }
  }

  // only claim "not hosted" if a mirror actually answered 404. if everything was
  // blocked or timed out we genuinely do not know.
  return { status: saw404 && anyAnswered ? 'no' : 'unknown', mirror: null };
}

/**
 * download a beatmap set as a .osz buffer.
 * onProgress gets (bytesSoFar, totalBytesOrNull).
 */
export async function download(setId, onProgress = null) {
  const errors = [];
  let all404 = true;

  for (const m of usable(MIRRORS)) {
    try {
      const res = await fetchWithTimeout(m.download(setId), {}, 120000);
      if (!res.ok) {
        if (res.status === 403 || res.status === 429) {
          blocked.add(m.name);
          all404 = false;
          throw new Error(`${m.name} blocked us`);
        }
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
