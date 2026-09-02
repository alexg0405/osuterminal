// input handling.
//
// ran the probe and windows terminal gives us VT mouse but no pixel mouse (mode 1016)
// and no kitty keyboard, so no key release events. had to split things up:
//
//   aim    -> Win32 GetCursorPos, pixel accurate. only needs to be right in space,
//             not in time, so once a frame is fine
//   clicks -> VT stdin. SGR mouse gives press ('M') and release ('m') separately and
//             it's event driven so we can timestamp it properly. this is the part
//             that actually has to be accurate, so no polling it
//   keys   -> VT stdin for the press, GetAsyncKeyState to see if it's still held.
//             the held check is only for slider holds so frame rate is good enough
//
// so nothing that needs tight timing gets polled, and nothing that needs pixel
// accuracy goes through the terminal.
//
// absolute vs relative aim:
// absolute means the game cursor sits exactly where your real mouse is. that needs the
// screen position of the terminal's text area, and windows doesn't give you it.
// GetConsoleWindow returns a hidden pseudo console window, not the real one.
//
// so we solve for it. motion events give the cell, GetCursorPos gives the pixel, and
// together that narrows the origin to a one cell wide range. intersect enough of those
// and you get the exact value. if the window moves the ranges stop overlapping, which
// is easy to detect, and it starts over.
//
// relative mode warps the OS pointer back to screen centre near the edges so you can
// keep spinning. absolute mode must never do that — before the origin is solved we
// still read deltas, and after a refocus the pointer is often on the title bar, which
// used to look "near the edge" and pin the cursor to the middle of the primary display
// every frame. you could not click out, and on a second monitor you never even had to
// be near an edge.

import koffi from 'koffi';
import { stdin, stdout } from 'node:process';
import { leftoverKeys, focusAfterChunk, mouseWarpEnabled } from './vt.mjs';

const CSI = '\x1b[';
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

const user32 = koffi.load('user32.dll');
const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
const GetCursorPos     = user32.func('bool __stdcall GetCursorPos(_Out_ POINT *p)');
const SetCursorPos     = user32.func('bool __stdcall SetCursorPos(int x, int y)');
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int i)');

export const VK = { LBUTTON: 0x01, RBUTTON: 0x02, ESCAPE: 0x1b, SPACE: 0x20 };

// GetAsyncKeyState wants a virtual key code. for letters and digits that is just the
// uppercase ascii value, which covers every key anyone sensibly binds to.
function vkFor(ch) {
  const c = ch.toUpperCase();
  if (c.length !== 1) return null;
  const code = c.charCodeAt(0);
  return (code >= 0x30 && code <= 0x5a) ? code : null;
}

export class Input {
  #pt = {};
  #listeners = { hit: [], release: [], key: [] };
  #enabled = false;
  #focused = true;
  #lastScreen = null;
  #origin = { lx: null, ux: null, ly: null, uy: null, x: 0, y: 0, known: false, precision: Infinity };
  #savedConsoleMode = null;
  #k32 = null;

  // mode 'absolute' sticks to the real mouse, 'relative' integrates deltas.
  // sensitivity only does anything in relative mode.
  constructor({ mode = 'absolute', sensitivity = 1.0, keys = ['z', 'x'] } = {}) {
    this.mode = mode;
    this.sensitivity = sensitivity;
    // the two tap keys. lowercased so the lookup is a simple map hit.
    this.keys = keys.map((k) => String(k).toLowerCase());
    this.keyMap = new Map(this.keys.map((k, i) => [k, i === 0 ? 'k1' : 'k2']));
    this.screenW = GetSystemMetrics(0);
    this.screenH = GetSystemMetrics(1);
    this.geometry = { cellW: 10, cellH: 20, known: false };

    // cursor in fractional cell coords (0..cols, 0..rows). keeping it resolution
    // independent so game.mjs can map it however it wants.
    this.cellX = (stdout.columns ?? 80) / 2;
    this.cellY = (stdout.rows ?? 24) / 2;

    this.buttons = { m1: false, m2: false, k1: false, k2: false };
    this.anyDown = false;
  }

  on(evt, fn) { this.#listeners[evt].push(fn); return this; }
  #emit(evt, ...a) { for (const f of this.#listeners[evt]) f(...a); }

  // ask the terminal how big a cell is. has to happen before mouse reporting is on
  // or the reply gets buried in mouse events.
  #queryGeometry() {
    return new Promise((resolve) => {
      let buf = '';
      const onData = (c) => { buf += c.toString('latin1'); };
      stdin.on('data', onData);
      stdout.write(`${CSI}16t${CSI}14t`);
      setTimeout(() => {
        stdin.off('data', onData);
        const m16 = buf.match(/\x1b\[6;(\d+);(\d+)t/);   // cell size in px
        const m14 = buf.match(/\x1b\[4;(\d+);(\d+)t/);   // text area in px
        if (m16) resolve({ cellH: +m16[1], cellW: +m16[2], known: true });
        else if (m14 && stdout.columns && stdout.rows)
          resolve({ cellH: +m14[1] / stdout.rows, cellW: +m14[2] / stdout.columns, known: true });
        else resolve({ cellW: 10, cellH: 20, known: false });
      }, 200);
    });
  }

  async enable() {
    if (this.#enabled) return this;
    this.#enabled = true;
    stdin.setRawMode(true);
    stdin.resume();
    // node raw mode does not clear ENABLE_QUICK_EDIT_MODE. a click to focus the
    // console then enters mark mode, stdin goes silent, and the mouse is captured.
    this.#setQuickEdit(false);

    this.geometry = await this.#queryGeometry();

    // 1000 = buttons, 1006 = SGR coords, 1004 = focus. only turn on motion (1003)
    // for absolute mode since that is the only thing that needs cell reports.
    const motion = this.mode === 'absolute' ? `${CSI}?1003h` : '';
    stdout.write(`${CSI}?1000h${motion}${CSI}?1006h${CSI}?1004h`);
    stdin.on('data', this.#onData);

    GetCursorPos(this.#pt);
    this.#lastScreen = { x: this.#pt.x, y: this.#pt.y };
    return this;
  }

  disable() {
    if (!this.#enabled) return;
    this.#enabled = false;
    stdin.off('data', this.#onData);
    stdout.write(`${CSI}?1004l${CSI}?1006l${CSI}?1003l${CSI}?1000l`);
    this.#setQuickEdit(true);
    try { stdin.setRawMode(false); } catch {}
  }

  #onData = (chunk) => {
    const at = nowMs();                       // timestamp first, parse after
    const s = chunk.toString('latin1');

    const mouse = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
    let m;
    while ((m = mouse.exec(s))) {
      const code = Number(m[1]);
      const col = Number(m[2]), row = Number(m[3]);

      // bit 5 means motion. grab the pixel pos right now so the two line up and
      // we can narrow down the origin.
      if (code & 32) { this.#observeOrigin(col, row); continue; }

      const btn = code & 3;
      const name = btn === 0 ? 'm1' : btn === 2 ? 'm2' : null;
      if (!name) continue;
      const press = m[4] === 'M';
      this.buttons[name] = press;
      this.#recomputeAnyDown();
      this.#emit(press ? 'hit' : 'release', { at, source: name, x: this.cellX, y: this.cellY });
    }

    const wasFocused = this.#focused;
    this.#focused = focusAfterChunk(s, this.#focused);
    if (this.#focused && !wasFocused) {
      // window may have moved while we were in another app. click-to-focus can
      // also leave m1 stuck down from the VT press that never got a release.
      this.#resetOrigin();
      this.#lastScreen = null;
      this.buttons.m1 = false;
      this.buttons.m2 = false;
      this.#recomputeAnyDown();
    }

    // mouse / focus in the same stdin chunk used to drop z, x, esc, ctrl+c
    const keys = leftoverKeys(s);
    for (const ch of keys) {
      const lower = ch.toLowerCase();
      const bound = this.keyMap.get(lower);
      if (bound) {
        const name = bound;
        if (!this.buttons[name]) {
          this.buttons[name] = true;
          this.#recomputeAnyDown();
          this.#emit('hit', { at, source: name, x: this.cellX, y: this.cellY });
        }
      }
      this.#emit('key', { at, ch, code: ch.charCodeAt(0) });
    }
  };

  // one cell+pixel pair. mouse is somewhere inside cell col, so
  //   origin + (col-1)*cellW <= sx < origin + col*cellW
  // which gives a one cell wide range. keep intersecting those and it collapses
  // down to a single value.
  #observeOrigin(col, row) {
    const { cellW, cellH } = this.geometry;
    GetCursorPos(this.#pt);
    const sx = this.#pt.x, sy = this.#pt.y;

    const ux = sx - (col - 1) * cellW, lx = ux - cellW;
    const uy = sy - (row - 1) * cellH, ly = uy - cellH;
    const o = this.#origin;

    if (o.lx === null) {
      Object.assign(o, { lx, ux, ly, uy });
    } else {
      const nlx = Math.max(o.lx, lx), nux = Math.min(o.ux, ux);
      const nly = Math.max(o.ly, ly), nuy = Math.min(o.uy, uy);
      // ranges stopped overlapping, window must have moved. start over.
      if (nlx > nux || nly > nuy) Object.assign(o, { lx, ux, ly, uy });
      else Object.assign(o, { lx: nlx, ux: nux, ly: nly, uy: nuy });
    }

    o.x = (o.lx + o.ux) / 2;
    o.y = (o.ly + o.uy) / 2;
    o.precision = Math.max(o.ux - o.lx, o.uy - o.ly);
    o.known = true;
  }

  #resetOrigin() {
    this.#origin = { lx: null, ux: null, ly: null, uy: null, x: 0, y: 0, known: false, precision: Infinity };
  }

  #recomputeAnyDown() {
    const b = this.buttons;
    this.anyDown = b.m1 || b.m2 || b.k1 || b.k2;
  }

  // ENABLE_QUICK_EDIT_MODE (0x40) is on by default in conhost. clearing it needs
  // ENABLE_EXTENDED_FLAGS (0x80) in the same SetConsoleMode call or the bit is ignored.
  #setQuickEdit(on) {
    const ENABLE_MOUSE_INPUT = 0x0010;
    const ENABLE_QUICK_EDIT_MODE = 0x0040;
    const ENABLE_EXTENDED_FLAGS = 0x0080;
    try {
      if (!this.#k32) {
        const dll = koffi.load('kernel32.dll');
        this.#k32 = {
          GetStdHandle: dll.func('void * __stdcall GetStdHandle(int32 nStdHandle)'),
          GetConsoleMode: dll.func('bool __stdcall GetConsoleMode(void *h, _Out_ uint32 *mode)'),
          SetConsoleMode: dll.func('bool __stdcall SetConsoleMode(void *h, uint32 mode)'),
        };
      }
      const h = this.#k32.GetStdHandle(-10);
      if (!h) return;
      if (!on) {
        const mode = [0];
        if (!this.#k32.GetConsoleMode(h, mode)) return;
        this.#savedConsoleMode = mode[0];
        this.#k32.SetConsoleMode(
          h,
          (mode[0] | ENABLE_EXTENDED_FLAGS) & ~ENABLE_QUICK_EDIT_MODE & ~ENABLE_MOUSE_INPUT,
        );
      } else if (this.#savedConsoleMode != null) {
        this.#k32.SetConsoleMode(h, this.#savedConsoleMode);
        this.#savedConsoleMode = null;
      }
    } catch { /* conpty / missing kernel32 — leave the console as-is */ }
  }

  // call every frame. moves the cursor and checks if keys got released.
  poll() {
    if (!this.#focused) return;
    const cols = stdout.columns ?? 80, rows = stdout.rows ?? 24;

    GetCursorPos(this.#pt);
    const p = this.#pt;

    if (this.mode === 'absolute' && this.#origin.known) {
      // same pixel as the real mouse
      this.cellX = Math.max(0, Math.min(cols, (p.x - this.#origin.x) / this.geometry.cellW));
      this.cellY = Math.max(0, Math.min(rows, (p.y - this.#origin.y) / this.geometry.cellH));
    } else {
      // relative mode, also what we fall back to before the origin is solved
      if (this.#lastScreen === null) this.#lastScreen = { x: p.x, y: p.y };
      const dx = p.x - this.#lastScreen.x, dy = p.y - this.#lastScreen.y;
      if (dx || dy) {
        this.cellX = Math.max(0, Math.min(cols, this.cellX + (dx * this.sensitivity) / this.geometry.cellW));
        this.cellY = Math.max(0, Math.min(rows, this.cellY + (dy * this.sensitivity) / this.geometry.cellH));
      }
      this.#lastScreen = { x: p.x, y: p.y };
      // FPS mouse lock. never in absolute aim, including before origin.known —
      // that path is what trapped the OS cursor after tabbing back in.
      if (mouseWarpEnabled(this.mode, this.#origin.known) && this.screenW && this.screenH) {
        const M = 80;
        if (p.x < M || p.y < M || p.x > this.screenW - M || p.y > this.screenH - M) {
          const cx = this.screenW >> 1, cy = this.screenH >> 1;
          SetCursorPos(cx, cy);
          this.#lastScreen = { x: cx, y: cy };
        }
      }
    }

    // no key release events on this terminal so we have to poll for it
    for (const [name, ch] of [['k1', this.keys[0]], ['k2', this.keys[1]]]) {
      const vk = vkFor(ch);
      if (!vk) continue;
      const down = (GetAsyncKeyState(vk) & 0x8000) !== 0;
      if (this.buttons[name] && !down) {
        this.buttons[name] = false;
        this.#recomputeAnyDown();
        this.#emit('release', { at: nowMs(), source: name, x: this.cellX, y: this.cellY });
      }
    }
  }

  // fractional cell coords
  get cursorCell() { return { x: this.cellX, y: this.cellY }; }
  get originKnown() { return this.#origin.known; }
  get originPrecision() { return this.#origin.precision; }
  get focused() { return this.#focused; }
}
