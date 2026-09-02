// beatmap backgrounds, scaled down to the framebuffer.
//
// osu puts a jpg/png behind the playfield and dims it so circles still read.
// we do the same at terminal resolution: decode, cover-crop, nearest-neighbour
// so it looks pixelated on purpose, then keep a cached copy the size of the fb.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { parseBackgroundEvent } from '../core/beatmap.mjs';

export { parseBackgroundEvent };
export const BG_DIM = 0.22;
export const MAX_BG_BYTES = 12_000_000;
export const MAX_BG_PIXELS = 12_000_000;

export function rgbaToRgb(data, width, height) {
  const n = width * height;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = i * 4, d = i * 3;
    out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2];
  }
  return out;
}

export function decodeImage(buf, filename = '') {
  const ext = path.extname(filename).toLowerCase();
  const looksPng = ext === '.png' || (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50);
  const looksJpg = ext === '.jpg' || ext === '.jpeg' || (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8);
  try {
    if (looksPng) {
      const png = PNG.sync.read(Buffer.from(buf));
      return { width: png.width, height: png.height, data: rgbaToRgb(png.data, png.width, png.height) };
    }
    if (looksJpg) {
      const jpg = jpeg.decode(Buffer.from(buf), { useTArray: true, formatAsRGBA: true });
      return { width: jpg.width, height: jpg.height, data: rgbaToRgb(jpg.data, jpg.width, jpg.height) };
    }
  } catch {
    return null;
  }
  return null;
}

// cover-crop into dw x dh with nearest neighbour, then dim
export function coverScale(src, sw, sh, dw, dh, dim = BG_DIM) {
  const out = new Uint8Array(dw * dh * 3);
  if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return out;
  const scale = Math.max(dw / sw, dh / sh);
  const tw = sw * scale, th = sh * scale;
  const ox = (tw - dw) / 2, oy = (th - dh) / 2;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, Math.floor((y + oy) / scale)));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, Math.floor((x + ox) / scale)));
      const si = (sy * sw + sx) * 3;
      const di = (y * dw + x) * 3;
      out[di]     = src[si] * dim;
      out[di + 1] = src[si + 1] * dim;
      out[di + 2] = src[si + 2] * dim;
    }
  }
  return out;
}

export async function loadBackground(file) {
  if (!file) return null;
  let buf;
  try { buf = await readFile(file); }
  catch { return null; }
  if (buf.length < 24 || buf.length > MAX_BG_BYTES) return null;
  const img = decodeImage(buf, file);
  if (!img || img.width * img.height > MAX_BG_PIXELS) return null;
  return img;
}
