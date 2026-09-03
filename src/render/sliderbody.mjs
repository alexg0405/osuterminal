// slider body: a sausage, not a stream.
//
// filling with overlapping discs is fine. stroking a full ring at every sample
// is not — that draws a complete hitcircle at each stamp, so the path looks
// like a stream. outline the left/right edges and cap the ends instead.

export function sliderBodyRadius(rad) {
  return rad * 0.92;
}

export function sliderStrokeWidth(rad) {
  return Math.max(1.6, Math.min(2.8, rad * 0.22));
}

export function sampleSliderScreen(path, pf, rad) {
  const step = Math.max(1, rad / 3.2);
  const n = Math.max(2, Math.ceil(pf.len(path.length) / step));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = path.positionAt(i / n);
    pts.push({ x: pf.sx(p.x), y: pf.sy(p.y) });
  }
  return pts;
}

function tangentAt(samples, i) {
  const prev = samples[Math.max(0, i - 1)];
  const next = samples[Math.min(samples.length - 1, i + 1)];
  let tx = next.x - prev.x, ty = next.y - prev.y;
  const len = Math.hypot(tx, ty);
  if (len < 1e-6) return null;
  return { x: tx / len, y: ty / len };
}

export function sliderEdgePoints(samples, bodyR) {
  const left = [], right = [];
  for (let i = 0; i < samples.length; i++) {
    const t = tangentAt(samples, i);
    if (!t) continue;
    const nx = -t.y, ny = t.x;
    const p = samples[i];
    left.push({ x: p.x + nx * bodyR, y: p.y + ny * bodyR });
    right.push({ x: p.x - nx * bodyR, y: p.y - ny * bodyR });
  }
  return { left, right };
}

function stampEdge(fb, pts, r, cr, cg, cb, a) {
  for (const p of pts) fb.fillCircle(p.x, p.y, r, cr, cg, cb, a);
}

export function drawSliderBody(fb, samples, rad, [cr, cg, cb], alpha) {
  if (alpha <= 0 || rad <= 0 || !samples?.length) return;
  const bodyR = sliderBodyRadius(rad);
  const strokeW = sliderStrokeWidth(rad);
  const pip = Math.max(0.9, strokeW / 2);
  const bodyA = alpha * 0.42;
  const fillR = cr * 0.32, fillG = cg * 0.32, fillB = cb * 0.32;

  for (const p of samples) fb.fillCircle(p.x, p.y, bodyR, fillR, fillG, fillB, bodyA);

  const { left, right } = sliderEdgePoints(samples, bodyR);
  stampEdge(fb, left, pip + 0.6, 14, 14, 22, alpha * 0.85);
  stampEdge(fb, right, pip + 0.6, 14, 14, 22, alpha * 0.85);
  stampEdge(fb, left, pip, cr, cg, cb, alpha);
  stampEdge(fb, right, pip, cr, cg, cb, alpha);

  const first = samples[0], last = samples[samples.length - 1];
  fb.strokeCircle(first.x, first.y, bodyR, strokeW, cr, cg, cb, alpha);
  if (last !== first) fb.strokeCircle(last.x, last.y, bodyR, strokeW, cr, cg, cb, alpha);
}
