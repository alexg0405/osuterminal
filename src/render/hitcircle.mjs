// hit circles.
//
// streams are a path of overlapping discs with combo numbers 1, 2, 3… — same
// idea as osu. stacks stay rings + pips + a gold remaining-count so a same-spot
// pile is countable at terminal resolution.

export const STACK_COUNT_RGB = [255, 210, 87];

export const APPROACH_STROKE = 0.9;
export const APPROACH_ALPHA = 0.4;

// stacks hide combo digits (the gold remaining-count is the label).
// streams keep every number so you can read direction.
export function comboVisible(o, next, _radius, { stacked = false } = {}) {
  if (!next || o.index === next.index) return true;
  if (stacked || (o.stackSize ?? 1) >= 2) return false;
  return true;
}

export function approachRadius(rad, dt, preempt) {
  if (!(preempt > 0)) return rad;
  return rad * (1 + 3 * Math.max(0, dt) / preempt);
}

export function drawApproachCircle(fb, cx, cy, rad, dt, preempt, [cr, cg, cb], acA) {
  if (!(dt > 0 && acA > 0 && rad > 0)) return;
  fb.strokeCircle(cx, cy, approachRadius(rad, dt, preempt), APPROACH_STROKE, cr, cg, cb, acA * APPROACH_ALPHA);
}

export function drawHitCircle(fb, cx, cy, rad, [cr, cg, cb], alpha, {
  stacked = false, combo = null, count = null,
} = {}) {
  if (alpha <= 0 || rad <= 0) return;
  const fillA = alpha * (stacked ? 0.12 : 0.55);
  const shade = stacked ? 0.20 : 0.62;
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
