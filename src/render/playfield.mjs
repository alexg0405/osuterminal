// maps osu pixel space (512x384, 4:3) onto the framebuffer.
//
// object *centres* live in 512x384, but the disc sticks out by the circle radius
// and stacks shift a bit more up-left. the HUD owns the top and bottom rows. if
// you fit 512x384 to the whole terminal, notes on the top and bottom edges clip.

import { stackOffsetForRadius } from '../core/stack.mjs';

export const HUD_PAD_TOP = 3;     // below title + progress bar
export const HUD_PAD_BOTTOM = 8;  // above combo, hit-error bar, help

export class Playfield {
  constructor(fbW, fbH, opts = {}) {
    const margin = typeof opts === 'number' ? opts : (opts.margin ?? 1);
    const radius = typeof opts === 'number' ? 0 : (opts.radius ?? 0);
    const padTop = typeof opts === 'number' ? HUD_PAD_TOP : (opts.padTop ?? HUD_PAD_TOP);
    const padBottom = typeof opts === 'number' ? HUD_PAD_BOTTOM : (opts.padBottom ?? HUD_PAD_BOTTOM);

    // disc radius plus a couple of stack steps so a short pile at the edge stays on screen
    const osuPad = radius > 0 ? radius + 8 + stackOffsetForRadius(radius) * 2 : 0;
    const innerW = fbW;
    const innerH = Math.max(16, fbH - padTop - padBottom);
    this.scale = Math.min(innerW / (512 + 2 * osuPad), innerH / (384 + 2 * osuPad)) * margin;
    this.w = 512 * this.scale;
    this.h = 384 * this.scale;
    this.ox = (fbW - this.w) / 2;
    this.oy = padTop + (innerH - this.h) / 2;
    this.padTop = padTop;
    this.padBottom = padBottom;
  }
  sx(x) { return this.ox + x * this.scale; }
  sy(y) { return this.oy + y * this.scale; }
  len(l) { return l * this.scale; }

  // framebuffer pixel to osu pixel, clamped to the playfield
  toOsu(fx, fy) {
    return {
      x: Math.max(0, Math.min(512, (fx - this.ox) / this.scale)),
      y: Math.max(0, Math.min(384, (fy - this.oy) / this.scale)),
    };
  }
}
