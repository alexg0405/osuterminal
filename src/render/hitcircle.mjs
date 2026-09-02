// hit circles as rings so overlapping notes (streams, stacks) stay countable.
// a solid disc at terminal resolution eats everything underneath; a dim fill
// plus a strong rim leaves a crescent of each circle behind.

export const STACK_COUNT_RGB = [255, 210, 87];

// hide combo numbers that sit under the next hit — they turn into noise.
// the next note always keeps its label (combo, or stack remaining).
export function comboVisible(o, next, radius) {
  if (!next || o.index === next.index) return true;
  return Math.hypot(o.x - next.x, o.y - next.y) >= radius * 1.55;
}

export function drawHitCircle(fb, cx, cy, rad, [cr, cg, cb], alpha, {
  stacked = false, combo = null, count = null,
} = {}) {
  if (alpha <= 0 || rad <= 0) return;
  const fillA = alpha * (stacked ? 0.12 : 0.20);
  const shade = stacked ? 0.20 : 0.30;
  fb.fillCircle(cx, cy, rad, cr * shade, cg * shade, cb * shade, fillA);

  const strokeW = stacked
    ? Math.max(1.7, Math.min(2.8, rad * 0.24))
    : Math.max(1.4, Math.min(2.2, rad * 0.18));
  fb.strokeCircle(cx, cy, rad, strokeW, cr, cg, cb, alpha);
  if (stacked) {
    fb.strokeCircle(cx, cy, rad * 0.68, 1.15, 255, 255, 255, alpha * 0.55);
    // a bright pip at each centre so a long pile is a countable chain, not a tube
    fb.fillCircle(cx, cy, Math.max(1.2, rad * 0.13), 255, 255, 255, alpha * 0.9);
  }

  if (count >= 2 && rad > 3) {
    fb.drawCombo(cx, cy, count, rad, STACK_COUNT_RGB[0], STACK_COUNT_RGB[1], STACK_COUNT_RGB[2], alpha);
  } else if (combo != null && rad > 3) {
    fb.drawCombo(cx, cy, combo, rad, 255, 255, 255, alpha);
  }
}
