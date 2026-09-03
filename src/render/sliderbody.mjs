// slider body: a dim fill with a bright rim so the path reads at terminal
// resolution. osu's border is a dark ring around a coloured sausage; here the
// rim has to be the combo colour or it disappears into the background.

export function sliderBodyRadius(rad) {
  return rad * 0.92;
}

export function sliderStrokeWidth(rad) {
  return Math.max(1.8, Math.min(3.4, rad * 0.28));
}

export function sampleSliderScreen(path, pf, rad) {
  const step = Math.max(1.2, rad / 2.5);
  const n = Math.max(2, Math.ceil(pf.len(path.length) / step));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = path.positionAt(i / n);
    pts.push({ x: pf.sx(p.x), y: pf.sy(p.y) });
  }
  return pts;
}

export function drawSliderBody(fb, samples, rad, [cr, cg, cb], alpha) {
  if (alpha <= 0 || rad <= 0 || !samples?.length) return;
  const bodyR = sliderBodyRadius(rad);
  const strokeW = sliderStrokeWidth(rad);
  const bodyA = alpha * 0.55;
  const haloW = Math.max(1.1, strokeW * 0.55);

  for (const p of samples) {
    fb.fillCircle(p.x, p.y, bodyR, cr * 0.28, cg * 0.28, cb * 0.28, bodyA);
  }
  for (const p of samples) {
    fb.fillCircle(p.x, p.y, rad * 0.34, cr * 0.55, cg * 0.55, cb * 0.55, bodyA);
  }
  // white halo first so the coloured rim sits on top and stays readable
  for (const p of samples) {
    fb.strokeCircle(p.x, p.y, bodyR + haloW * 0.45, haloW, 240, 240, 248, alpha * 0.4);
  }
  for (const p of samples) {
    fb.strokeCircle(p.x, p.y, bodyR, strokeW, cr, cg, cb, alpha * 0.95);
  }
}
