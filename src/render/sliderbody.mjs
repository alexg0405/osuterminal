// slider body: a dim fill with a bright rim so the path reads at terminal
// resolution. osu's border is a dark ring around a coloured sausage; here the
// rim has to be the combo colour or it disappears into the background.

export function sliderBodyRadius(rad) {
  return rad * 0.92;
}

export function sliderStrokeWidth(rad) {
  return Math.max(2.4, Math.min(4.2, rad * 0.36));
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
  const haloW = Math.max(1.4, strokeW * 0.7);

  for (const p of samples) {
    fb.fillCircle(p.x, p.y, bodyR, cr * 0.28, cg * 0.28, cb * 0.28, bodyA);
  }
  for (const p of samples) {
    fb.fillCircle(p.x, p.y, rad * 0.34, cr * 0.55, cg * 0.55, cb * 0.55, bodyA);
  }
  // dark outer edge, then the combo rim — two bands so the path pops on any bg
  for (const p of samples) {
    fb.strokeCircle(p.x, p.y, bodyR + haloW * 0.55, haloW, 12, 12, 20, alpha * 0.9);
  }
  for (const p of samples) {
    fb.strokeCircle(p.x, p.y, bodyR, strokeW, cr, cg, cb, alpha);
  }
}
