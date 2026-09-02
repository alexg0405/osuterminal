// slider paths.
//
// a slider in the .osu file is a curve type, some control points, and a length in osu
// pixels. the control points rarely give exactly that length, so you sample the curve
// and then cut it short or extend the end to match. everything after that (duration,
// ticks, ball position) uses the corrected length, not the raw geometry.
//
// curve types:
//   L  straight lines through the points
//   P  circle through 3 points, falls back to a line if they are collinear
//   B  bezier, a repeated point splits it into segments
//   C  catmull, only old maps use this

const EPS = 1e-6;
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// ---------------------------------------------------------------- curve kernels
// repeated point = red anchor = start a new segment
function bezierSegments(points) {
  const segs = [];
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x === points[i - 1].x && points[i].y === points[i - 1].y) {
      if (i - start >= 2) segs.push(points.slice(start, i));
      start = i;
    }
  }
  if (points.length - start >= 2) segs.push(points.slice(start));
  return segs;
}

// de casteljau, works for any degree
function bezierAt(pts, t) {
  const n = pts.length;
  let xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = pts[i].x; ys[i] = pts[i].y; }
  for (let k = n - 1; k > 0; k--) {
    for (let i = 0; i < k; i++) {
      xs[i] += (xs[i + 1] - xs[i]) * t;
      ys[i] += (ys[i + 1] - ys[i]) * t;
    }
  }
  return { x: xs[0], y: ys[0] };
}

function sampleBezier(points, out) {
  for (const seg of bezierSegments(points)) {
    // more samples for longer segments. length accuracy matters here since it is
    // what decides where the path gets cut off.
    let poly = 0;
    for (let i = 1; i < seg.length; i++) poly += dist(seg[i - 1], seg[i]);
    const steps = Math.max(16, Math.min(400, Math.ceil(poly / 1.5)));
    for (let i = 0; i <= steps; i++) out.push(bezierAt(seg, i / steps));
  }
}

// circle through 3 points, null if they are basically in a line
function circleThrough(p0, p1, p2) {
  const a = 2 * (p0.x * (p1.y - p2.y) + p1.x * (p2.y - p0.y) + p2.x * (p0.y - p1.y));
  if (Math.abs(a) < EPS) return null;
  const s0 = p0.x * p0.x + p0.y * p0.y, s1 = p1.x * p1.x + p1.y * p1.y, s2 = p2.x * p2.x + p2.y * p2.y;
  const cx = (s0 * (p1.y - p2.y) + s1 * (p2.y - p0.y) + s2 * (p0.y - p1.y)) / a;
  const cy = (s0 * (p2.x - p1.x) + s1 * (p0.x - p2.x) + s2 * (p1.x - p0.x)) / a;
  return { cx, cy, r: Math.hypot(p0.x - cx, p0.y - cy) };
}

function samplePerfect(points, out) {
  if (points.length !== 3) return sampleBezier(points, out);
  const [p0, p1, p2] = points;
  const c = circleThrough(p0, p1, p2);
  // huge radius means it looks straight anyway and the math goes unstable
  if (!c || c.r > 1e5) { out.push(p0, p1, p2); return; }

  const ang = (p) => Math.atan2(p.y - c.cy, p.x - c.cx);
  let a0 = ang(p0), a1 = ang(p1), a2 = ang(p2);

  // go a0 -> a2 whichever way actually passes through a1
  const TAU = Math.PI * 2;
  const norm = (x) => ((x % TAU) + TAU) % TAU;
  const ccw = norm(a1 - a0) < norm(a2 - a0);
  let sweep = ccw ? norm(a2 - a0) : -norm(a0 - a2);

  const arcLen = Math.abs(sweep) * c.r;
  const steps = Math.max(16, Math.min(400, Math.ceil(arcLen / 1.5)));
  for (let i = 0; i <= steps; i++) {
    const a = a0 + sweep * (i / steps);
    out.push({ x: c.cx + Math.cos(a) * c.r, y: c.cy + Math.sin(a) * c.r });
  }
}

function sampleCatmull(points, out) {
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const steps = Math.max(8, Math.min(100, Math.ceil(dist(p1, p2) / 1.5)));
    for (let j = 0; j <= steps; j++) {
      const t = j / steps, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
}

// ---------------------------------------------------------------- path
export class SliderPath {
  // controlPoints[0] is the slider head. pixelLength wins over the geometry.
  constructor(curveType, controlPoints, pixelLength) {
    this.curveType = curveType;
    this.expectedLength = pixelLength;

    const pts = controlPoints.filter(Boolean);
    const raw = [];
    if (pts.length < 2) raw.push(pts[0] ?? { x: 0, y: 0 });
    else if (curveType === 'L') raw.push(...pts);
    else if (curveType === 'P') samplePerfect(pts, raw);
    else if (curveType === 'C') sampleCatmull(pts, raw);
    else sampleBezier(pts, raw);

    // drop duplicate points so the distances always go up
    const poly = [raw[0]];
    for (let i = 1; i < raw.length; i++) if (dist(raw[i], poly[poly.length - 1]) > EPS) poly.push(raw[i]);
    if (poly.length === 1) poly.push({ x: poly[0].x + EPS, y: poly[0].y });

    // running length along the path
    const cum = [0];
    for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + dist(poly[i - 1], poly[i]));
    const geomLength = cum[cum.length - 1];

    // make it match pixelLength. cut it short if too long, extend the last bit if
    // it came out short.
    const target = pixelLength > 0 ? pixelLength : geomLength;
    if (geomLength > target + EPS) {
      let i = 1;
      while (i < cum.length && cum[i] < target) i++;
      const over = cum[i] - target, seg = cum[i] - cum[i - 1];
      const t = seg > EPS ? 1 - over / seg : 0;
      const a = poly[i - 1], b = poly[i];
      poly.length = i;
      cum.length = i;
      poly.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      cum.push(target);
    } else if (target > geomLength + EPS && poly.length >= 2) {
      const a = poly[poly.length - 2], b = poly[poly.length - 1];
      const d = dist(a, b) || 1;
      const extra = target - geomLength;
      poly.push({ x: b.x + ((b.x - a.x) / d) * extra, y: b.y + ((b.y - a.y) / d) * extra });
      cum.push(target);
    }

    this.points = poly;
    this.cumulative = cum;
    this.length = cum[cum.length - 1];
  }

  // where you are at progress 0..1 along the path
  positionAt(progress) {
    const cum = this.cumulative, pts = this.points;
    const target = Math.max(0, Math.min(1, progress)) * this.length;

    // binary search for the right segment
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid; else hi = mid;
    }
    const seg = cum[hi] - cum[lo];
    const t = seg > EPS ? (target - cum[lo]) / seg : 0;
    return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * t, y: pts[lo].y + (pts[hi].y - pts[lo].y) * t };
  }
}

// ---------------------------------------------------------------- timing
// how long a slider takes and how far apart ticks go.
// osu says you cover 100 * SliderMultiplier pixels per beat, scaled by whatever the
// current inherited timing point SV is. duration and tick spacing both come from that.
export function sliderTiming(beatmap, hitObject) {
  const uninherited = beatmap.timingAt(hitObject.time);
  const effective = beatmap.effectiveAt(hitObject.time);
  const beatLength = uninherited?.beatLength > 0 ? uninherited.beatLength : 500;
  const sv = effective && !effective.uninherited ? effective.sliderVelocity : 1;

  const scoringDistance = 100 * beatmap.difficulty.sliderMultiplier * sv;
  const velocity = scoringDistance / beatLength;                 // osu!px per ms
  const spanDuration = hitObject.pixelLength / velocity;         // one traversal
  const tickDistance = scoringDistance / beatmap.difficulty.sliderTickRate;

  return {
    beatLength, sv, velocity,
    spanDuration,
    duration: spanDuration * hitObject.slides,
    endTime: hitObject.time + spanDuration * hitObject.slides,
    tickDistance,
  };
}

// tick positions and times. no head, repeats or tail here.
// ticks get spaced along one span then mirrored each time it reverses.
export function sliderTicks(path, timing, hitObject) {
  const ticks = [];
  const { tickDistance, spanDuration } = timing;
  if (!(tickDistance > 0) || path.length <= 0) return ticks;

  // where ticks go on a single span
  const offsets = [];
  for (let d = tickDistance; d < path.length - 1e-3; d += tickDistance) offsets.push(d);
  // osu throws a tick away if it lands within about 10px of the end
  while (offsets.length && path.length - offsets[offsets.length - 1] < 10) offsets.pop();

  for (let span = 0; span < hitObject.slides; span++) {
    const reversed = span % 2 === 1;
    const spanStart = hitObject.time + span * spanDuration;
    for (const d of offsets) {
      const progress = reversed ? 1 - d / path.length : d / path.length;
      ticks.push({
        time: spanStart + (reversed ? spanDuration - (d / path.length) * spanDuration
                                    : (d / path.length) * spanDuration),
        ...path.positionAt(progress),
      });
    }
  }
  ticks.sort((a, b) => a.time - b.time);
  return ticks;
}

// reverse arrows, one per span boundary but not the actual end
export function sliderRepeats(path, timing, hitObject) {
  const out = [];
  for (let span = 1; span < hitObject.slides; span++) {
    const atEnd = span % 2 === 1;
    out.push({
      time: hitObject.time + span * timing.spanDuration,
      ...path.positionAt(atEnd ? 1 : 0),
    });
  }
  return out;
}
