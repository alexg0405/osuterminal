// absolute-aim origin solver. kept free of Win32 so tests can run on Linux.
//
// windows will not tell you where the text area is. GetConsoleWindow is a hidden
// pseudo console. so we pair each VT motion event's cell with GetCursorPos's
// pixel. the mouse is somewhere inside that cell:
//     origin + (col-1)*cellW <= sx < origin + col*cellW
// which is a one cell wide range. intersect enough of them and you get a pixel.
//
// if the window moves, ranges stop overlapping and we start over — but only when
// the pixel is still over the terminal. VT clamps out-of-window motion to an
// edge cell while GetCursorPos is far outside. treating that as a window move
// replaces a good origin with garbage, and poll() then clamps aim to that edge
// for the rest of the map. that is what made countdown-then-leave unplayable.

export function emptyOrigin() {
  return { lx: null, ux: null, ly: null, uy: null, x: 0, y: 0, known: false, precision: Infinity };
}

export function isBorderCell(col, row, cols, rows) {
  return col <= 1 || row <= 1 || col >= cols || row >= rows;
}

function finalize(o) {
  o.x = (o.lx + o.ux) / 2;
  o.y = (o.ly + o.uy) / 2;
  o.precision = Math.max(o.ux - o.lx, o.uy - o.ly);
  o.known = true;
}

export function pixelInTerminal(sx, sy, o, cols, rows, cellW, cellH) {
  if (!o || !o.known) return false;
  const pad = Math.max(cellW, cellH) * 2;
  return sx >= o.x - pad
    && sx <= o.x + cols * cellW + pad
    && sy >= o.y - pad
    && sy <= o.y + rows * cellH + pad;
}

// click-to-focus after the mouse left used to wipe a good origin, fall back
// to relative aim, and leave the game cursor stuck on the left edge. keep it
// when the pointer is still over the same window; only drop it if the click
// is outside (title bar, other monitor, window actually moved).
export function shouldKeepOriginOnFocus(origin, sx, sy, cols, rows, cellW, cellH) {
  return pixelInTerminal(sx, sy, origin, cols, rows, cellW, cellH);
}

// mutates `o`. returns whether this sample was applied.
export function observeOrigin(o, col, row, sx, sy, { cols, rows, cellW, cellH }) {
  if (col < 1 || col > cols || row < 1 || row > rows) return false;

  const ux = sx - (col - 1) * cellW, lx = ux - cellW;
  const uy = sy - (row - 1) * cellH, ly = uy - cellH;

  if (o.lx === null) {
    // do not lock onto a clamped edge cell. that is what VT reports when the
    // pointer is already outside during the 3-2-1 countdown.
    if (isBorderCell(col, row, cols, rows)) return false;
    Object.assign(o, { lx, ux, ly, uy });
    finalize(o);
    return true;
  }

  const nlx = Math.max(o.lx, lx), nux = Math.min(o.ux, ux);
  const nly = Math.max(o.ly, ly), nuy = Math.min(o.uy, uy);
  if (nlx <= nux && nly <= nuy) {
    Object.assign(o, { lx: nlx, ux: nux, ly: nly, uy: nuy });
    finalize(o);
    return true;
  }

  // ranges stopped overlapping. window moved, or the mouse left the terminal.
  // only restart when the pixel is still over the window and the cell is not
  // a clamped edge — otherwise keep the origin we already have.
  if (isBorderCell(col, row, cols, rows)) return false;
  if (!pixelInTerminal(sx, sy, o, cols, rows, cellW, cellH)) return false;

  Object.assign(o, { lx, ux, ly, uy });
  finalize(o);
  return true;
}

// same mapping poll() uses once origin.known is true.
export function cellFromPixel(sx, sy, origin, cellW, cellH, cols, rows) {
  return {
    cellX: Math.max(0, Math.min(cols, (sx - origin.x) / cellW)),
    cellY: Math.max(0, Math.min(rows, (sy - origin.y) / cellH)),
  };
}
