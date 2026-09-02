// framebuffer built on half block characters.
//
// each cell draws U+2580 (upper half block) with the foreground as the top pixel and
// the background as the bottom one. so a WxH grid of cells is really W x 2H pixels, and
// they come out roughly square. that matters because the osu playfield is 4:3 and
// terminal cells are closer to 1:2.
//
// there's a text layer on top. any cell with text draws a real character instead of a
// half block, so the HUD stays readable.

const UPPER_HALF = '▀';
const ESC = '\x1b[';

export class Framebuffer {
  constructor(cols, rows) {
    this.resize(cols, rows);
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.width = cols;
    this.height = rows * 2;
    // rgb, 3 bytes per pixel
    this.px = new Uint8Array(this.width * this.height * 3);
    // text layer, 0 means no text in that cell
    this.txtChar = new Array(cols * rows).fill(0);
    this.txtFg = new Uint32Array(cols * rows);
    this.txtBg = new Uint32Array(cols * rows);
    // previous frame, for diffing
    this.prev = null;
    this.curr = new Uint32Array(cols * rows * 2);   // packed top|bottom colour per cell
    this.prevChar = new Array(cols * rows).fill(0);
  }

  clear(r = 0, g = 0, b = 0) {
    const p = this.px;
    if (r === 0 && g === 0 && b === 0) p.fill(0);
    else for (let i = 0; i < p.length; i += 3) { p[i] = r; p[i + 1] = g; p[i + 2] = b; }
    this.txtChar.fill(0);
  }

  set(x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b;
  }

  // blend a pixel, a is 0..1
  blend(x, y, r, g, b, a) {
    if (a >= 1) return this.set(x, y, r, g, b);
    if (a <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    const p = this.px, ia = 1 - a;
    p[i]     = p[i] * ia + r * a;
    p[i + 1] = p[i + 1] * ia + g * a;
    p[i + 2] = p[i + 2] * ia + b * a;
  }

  fillCircle(cx, cy, rad, r, g, b, a = 1) {
    if (rad <= 0) return;
    const r2 = rad * rad;
    const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(this.height - 1, Math.ceil(cy + rad));
    const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(this.width - 1, Math.ceil(cx + rad));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy, dy2 = dy * dy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, d2 = dx * dx + dy2;
        if (d2 > r2) continue;
        // soften the outer pixel, otherwise small circles look like squares
        const edge = rad - Math.sqrt(d2);
        this.blend(x, y, r, g, b, a * Math.min(1, Math.max(0, edge)));
      }
    }
  }

  strokeCircle(cx, cy, rad, thickness, r, g, b, a = 1) {
    if (rad <= 0) return;
    const outer = rad + thickness / 2, inner = Math.max(0, rad - thickness / 2);
    const o2 = outer * outer, i2 = inner * inner;
    const y0 = Math.max(0, Math.floor(cy - outer)), y1 = Math.min(this.height - 1, Math.ceil(cy + outer));
    const x0 = Math.max(0, Math.floor(cx - outer)), x1 = Math.min(this.width - 1, Math.ceil(cx + outer));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy, dy2 = dy * dy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, d2 = dx * dx + dy2;
        if (d2 > o2 || d2 < i2) continue;
        const d = Math.sqrt(d2);
        const cov = Math.min(1, outer - d, d - inner + 1);
        this.blend(x, y, r, g, b, a * Math.max(0, Math.min(1, cov)));
      }
    }
  }

  line(x0, y0, x1, y1, r, g, b, a = 1) {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.blend(Math.round(x0 + dx * t), Math.round(y0 + dy * t), r, g, b, a);
    }
  }

  rect(x, y, w, h, r, g, b, a = 1) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.blend(xx, yy, r, g, b, a);
  }

  // combo numbers used to be terminal characters, which snap to the cell grid.
  // a circle's pixel centre rarely lands on a cell centre, so "3" and "4" sat in
  // different corners of their circles. these glyphs are drawn in pixel space
  // and the whole number is centred on (cx, cy).
  drawCombo(cx, cy, label, rad, r = 255, g = 255, b = 255, a = 1) {
    const str = String(label);
    const ps = comboPixelSize(rad, str.length);
    if (ps <= 0) return;
    const { x0, y0 } = comboLabelBox(cx, cy, str, ps);
    for (let i = 0; i < str.length; i++) {
      const d = str.charCodeAt(i) - 48;
      if (d < 0 || d > 9) continue;
      const gx = x0 + i * (DIGIT_W + DIGIT_GAP) * ps;
      blitDigit(this, gx, y0, DIGITS[d], ps, r, g, b, a);
    }
  }

  // text is at cell resolution and replaces the half block for those cells
  text(col, row, str, fg = 0xffffff, bg = null) {
    if (row < 0 || row >= this.rows) return;
    for (let i = 0; i < str.length; i++) {
      const c = col + i;
      if (c < 0 || c >= this.cols) continue;
      const idx = row * this.cols + c;
      this.txtChar[idx] = str[i];
      this.txtFg[idx] = fg;
      // null bg means use whatever colour is already there
      this.txtBg[idx] = bg === null ? 0xff000000 : bg;
    }
  }

  textCentered(row, str, fg, bg) { this.text(Math.floor((this.cols - str.length) / 2), row, str, fg, bg); }

  // turn it into ANSI. only writes cells that changed, which on a mostly static
  // screen is around ten times less output.
  render(force = false) {
    const { cols, rows, width, px } = this;
    const out = [];
    let lastFg = -1, lastBg = -1, cursorCol = -1, cursorRow = -1;

    for (let row = 0; row < rows; row++) {
      const topBase = (row * 2) * width * 3;
      const botBase = (row * 2 + 1) * width * 3;
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const o = col * 3;

        let ch, fg, bg;
        const t = this.txtChar[idx];
        if (t !== 0) {
          ch = t;
          fg = this.txtFg[idx];
          bg = this.txtBg[idx] === 0xff000000
            ? (px[botBase + o] << 16) | (px[botBase + o + 1] << 8) | px[botBase + o + 2]
            : this.txtBg[idx];
        } else {
          ch = UPPER_HALF;
          fg = (px[topBase + o] << 16) | (px[topBase + o + 1] << 8) | px[topBase + o + 2];
          bg = (px[botBase + o] << 16) | (px[botBase + o + 1] << 8) | px[botBase + o + 2];
        }

        const ci = idx * 2;
        const changed = force || this.prev === null ||
          this.prev[ci] !== fg || this.prev[ci + 1] !== bg || this.prevChar[idx] !== ch;
        this.curr[ci] = fg; this.curr[ci + 1] = bg;

        if (!changed) { this.prevChar[idx] = ch; continue; }

        if (cursorRow !== row || cursorCol !== col) {
          out.push(`${ESC}${row + 1};${col + 1}H`);
          cursorRow = row; cursorCol = col;
        }
        if (fg !== lastFg) { out.push(`${ESC}38;2;${fg >> 16 & 255};${fg >> 8 & 255};${fg & 255}m`); lastFg = fg; }
        if (bg !== lastBg) { out.push(`${ESC}48;2;${bg >> 16 & 255};${bg >> 8 & 255};${bg & 255}m`); lastBg = bg; }
        out.push(ch);
        cursorCol++;
        this.prevChar[idx] = ch;
      }
    }

    if (this.prev === null) this.prev = new Uint32Array(this.curr.length);
    this.prev.set(this.curr);
    return out.join('');
  }

  // drop the diff state. call this if anything else wrote to the terminal.
  invalidate() { this.prev = null; this.prevChar.fill(0); }
}

const DIGIT_W = 5, DIGIT_H = 7, DIGIT_GAP = 1;

// 5x7, bit 4 is the left column. each glyph is designed around column 2 / row 3
// so 1 and 4 share a centre instead of sitting on the left of a character cell.
const DIGITS = [
  [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110], // 0
  [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110], // 1
  [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111], // 2
  [0b01110, 0b10001, 0b00001, 0b01110, 0b00001, 0b10001, 0b01110], // 3
  [0b00100, 0b01010, 0b10010, 0b11111, 0b00100, 0b00100, 0b00100], // 4
  [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110], // 5
  [0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110], // 6
  [0b11111, 0b00001, 0b00010, 0b00100, 0b00100, 0b00100, 0b00100], // 7
  [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110], // 8
  [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110], // 9
];

export function comboPixelSize(rad, digits = 1) {
  const n = Math.max(1, digits);
  const width = n * DIGIT_W + (n - 1) * DIGIT_GAP;
  // keep the glyph inside the circle; floor so it never outgrows a small CS
  const byH = Math.floor(rad / (DIGIT_H / 2 + 0.5));
  const byW = Math.floor((rad * 1.6) / width);
  return Math.max(1, Math.min(byH, byW, 4));
}

export function comboLabelBox(cx, cy, label, pixelSize = 1) {
  const n = String(label).length;
  const w = n * DIGIT_W + Math.max(0, n - 1) * DIGIT_GAP;
  const h = DIGIT_H;
  const x0 = Math.round(cx - (w * pixelSize) / 2);
  const y0 = Math.round(cy - (h * pixelSize) / 2);
  return { x0, y0, w: w * pixelSize, h: h * pixelSize, pixelSize };
}

function blitDigit(fb, x0, y0, rows, ps, r, g, b, a) {
  for (let y = 0; y < DIGIT_H; y++) {
    const bits = rows[y];
    for (let x = 0; x < DIGIT_W; x++) {
      if (((bits >> (DIGIT_W - 1 - x)) & 1) === 0) continue;
      const px = x0 + x * ps, py = y0 + y * ps;
      if (ps === 1) fb.blend(px, py, r, g, b, a);
      else fb.rect(px, py, ps, ps, r, g, b, a);
    }
  }
}
