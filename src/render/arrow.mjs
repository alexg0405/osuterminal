// reverse arrows: a double chevron pointing back along the slider.
// circles at the bounce were easy to miss next to ticks and the tail ring.

export function fillTriangle(fb, x1, y1, x2, y2, x3, y3, r, g, b, a) {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2, x3)));
  const maxX = Math.min(fb.width - 1, Math.ceil(Math.max(x1, x2, x3)));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2, y3)));
  const maxY = Math.min(fb.height - 1, Math.ceil(Math.max(y1, y2, y3)));
  const area = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((x2 - x) * (y3 - y) - (x3 - x) * (y2 - y)) / area;
      const w1 = ((x3 - x) * (y1 - y) - (x1 - x) * (y3 - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) fb.blend(x, y, r, g, b, a);
    }
  }
}

function chevron(tipX, tipY, ux, uy, size) {
  const px = -uy, py = ux;
  const back = size * 0.9;
  const spread = size * 0.65;
  return {
    tipX, tipY,
    lX: tipX - ux * back + px * spread,
    lY: tipY - uy * back + py * spread,
    rX: tipX - ux * back - px * spread,
    rY: tipY - uy * back - py * spread,
  };
}

export function drawReverseArrow(fb, cx, cy, dx, dy, size, r = 255, g = 255, b = 255, a = 1) {
  if (a <= 0 || size < 2) return;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;

  // tip sits forward of the reverse point so the "<< " reads as a direction
  const tipX = cx + ux * size * 0.72;
  const tipY = cy + uy * size * 0.72;

  const back = chevron(tipX, tipY, ux, uy, size + 1.8);
  fillTriangle(fb, back.lX, back.lY, back.tipX, back.tipY, back.rX, back.rY, 8, 8, 14, a * 0.85);

  const front = chevron(tipX, tipY, ux, uy, size);
  fillTriangle(fb, front.lX, front.lY, front.tipX, front.tipY, front.rX, front.rY, r, g, b, a);

  const rear = chevron(tipX - ux * size * 0.42, tipY - uy * size * 0.42, ux, uy, size * 0.85);
  fillTriangle(fb, rear.lX, rear.lY, rear.tipX, rear.tipY, rear.rX, rear.rY, r, g, b, a * 0.9);
}
