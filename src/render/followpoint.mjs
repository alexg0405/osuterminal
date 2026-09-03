// follow points — the dotted trail osu draws between consecutive hit objects.
//
// stable places diamonds every 32 osu pixels, starting 1.5 spacings after the
// previous object and stopping one spacing before the next. new combos do not
// connect. tight streams often have no room for a point; jumps do.

export const FOLLOW_POINT_SPACING = 32;

export function objectEndPos(o) {
  if (o?.kind === 'slider' && o.path) {
    return o.path.positionAt((o.slides ?? 1) % 2 === 1 ? 1 : 0);
  }
  return { x: o.x, y: o.y };
}

// combo 1 is always a new combo (including the first object of the map).
export function shouldDrawFollowPoints(from, to) {
  if (!from || !to) return false;
  if ((to.combo ?? 0) === 1) return false;
  return true;
}

export function followPointSpacingOsu(scale, minScreen = 3.5) {
  if (!(scale > 0)) return FOLLOW_POINT_SPACING;
  return Math.max(FOLLOW_POINT_SPACING, minScreen / scale);
}

export function followPointsBetween(from, to, spacing = FOLLOW_POINT_SPACING) {
  const a = objectEndPos(from);
  const b = { x: to.x, y: to.y };
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const gap = Math.max(1, spacing);
  const pts = [];
  if (!(dist > gap * 2.5)) return pts;
  const t0 = from.endTime ?? from.time;
  const t1 = to.time;
  const inv = 1 / dist;
  for (let d = gap * 1.5; d < dist - gap; d += gap) {
    const u = d * inv;
    pts.push({
      x: a.x + dx * u,
      y: a.y + dy * u,
      time: t0 + u * (t1 - t0),
    });
  }
  return pts;
}

export function followPointAlpha(now, pointTime, preempt, fadeIn) {
  const dt = pointTime - now;
  if (!(preempt > 0)) return dt <= 0 ? 1 : 0;
  if (dt > preempt) return 0;
  if (dt < -90) return 0;
  if (dt < 0) return Math.max(0, 1 + dt / 90);
  return Math.max(0, Math.min(1, (preempt - dt) / Math.max(1, fadeIn)));
}

export function drawFollowPoints(fb, pf, from, to, now, preempt, fadeIn) {
  if (!shouldDrawFollowPoints(from, to)) return 0;
  const spacing = followPointSpacingOsu(pf.scale);
  const pts = followPointsBetween(from, to, spacing);
  const r = Math.max(0.85, Math.min(1.7, pf.len(FOLLOW_POINT_SPACING) * 0.14));
  let n = 0;
  for (const p of pts) {
    const a = followPointAlpha(now, p.time, preempt, fadeIn);
    if (a <= 0) continue;
    fb.fillCircle(pf.sx(p.x), pf.sy(p.y), r, 220, 220, 232, a * 0.88);
    n++;
  }
  return n;
}
