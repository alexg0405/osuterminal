// the game itself. circles and sliders, timed against the audio clock.
// spinners aren't done, they need rotation tracking which is a separate thing.

import { Framebuffer } from './render/framebuffer.mjs';
import { Playfield } from './render/playfield.mjs';
import { Input } from './input/input.mjs';
import { AudioEngine } from './audio/engine.mjs';
import { HitsoundBank } from './audio/hitsounds.mjs';
import { SliderPath, sliderTiming, sliderTicks, sliderRepeats } from './core/slider.mjs';
import { applyStacking } from './core/stack.mjs';
import { drawHitCircle, comboVisible } from './render/hitcircle.mjs';
import { rankFromCounts } from './grade.mjs';
import { clampVolume, stepVolume, volumePercent, mixGains } from './volume.mjs';
import { loadBackground, coverScale, BG_DIM, backgroundVisible, backgroundLabel } from './render/background.mjs';
import { JUDGE, drawJudgementLegend, drawHitErrorBar } from './render/hud.mjs';
import {
  normalizeMods, applyModsToDifficulty, flipY, modsAcronyms, modsLabel, scoreMultiplier,
  objectAlpha, approachAlpha,
} from './core/mods.mjs';
import { stdout } from 'node:process';

const CSI = '\x1b[';
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

const COMBO_COLOURS = [
  [255, 102, 170], [102, 204, 255], [255, 187, 68], [136, 221, 119], [187, 136, 255],
];
// minimum quiet time before the first object so the map doesn't start instantly
const MIN_PREP_MS = 2200;

// osu lets the cursor drift to 2.4x the circle radius while tracking a slider
const FOLLOW_SCALE = 2.4;

export { Playfield } from './render/playfield.mjs';

// how far along a slider you are at time t, 0..1, accounting for reverses
export function sliderProgress(o, t) {
  const span = o.timing.spanDuration;
  if (span <= 0) return 0;
  const elapsed = t - o.time;
  if (elapsed <= 0) return 0;
  const s = Math.floor(elapsed / span);
  if (s >= o.slides) return o.slides % 2 === 1 ? 1 : 0;
  const frac = (elapsed - s * span) / span;
  return s % 2 === 1 ? 1 - frac : frac;
}

export class Game {
  #bgSrc = null;
  #bgFit = null;

  constructor(beatmap, {
    audioOffsetMs = 0, sensitivity = 1.0, aimMode = 'absolute', keys = ['z', 'x'],
    masterVolume = 0.8, musicVolume = 1, effectVolume = 1, onVolume = null,
    showBackground = true, onBackground = null, mods = null,
  } = {}) {
    this.map = beatmap;
    this.mods = normalizeMods(mods);
    this.diff = applyModsToDifficulty(beatmap.difficulty, this.mods);
    this.scoreMul = scoreMultiplier(this.mods);
    this.audioOffsetMs = audioOffsetMs;
    this.sensitivity = sensitivity;
    this.aimMode = aimMode;
    this.keys = keys;
    this.masterVolume = clampVolume(masterVolume, 0.8);
    this.musicVolume = clampVolume(musicVolume, 1);
    this.effectVolume = clampVolume(effectVolume, 1);
    this.onVolume = onVolume;
    this.showBackground = backgroundVisible(showBackground);
    this.onBackground = onBackground;
    this.volumeToast = null;

    const src = beatmap.hitObjects.filter((o) => !o.isSpinner);
    const fy = (y) => this.mods.hardRock ? flipY(y) : y;
    this.objects = src.map((o, i) => {
      const base = {
        index: i, kind: o.isSlider ? 'slider' : 'circle',
        x: o.x, y: fy(o.y), time: o.time, endTime: o.time,
        combo: 0, comboColour: 0,
        headResult: null, headAt: 0, error: 0,
        result: null, resultAt: 0,
      };
      if (!o.isSlider) return base;

      const points = (o.points ?? []).map((p) => ({ x: p.x, y: fy(p.y) }));
      const path = new SliderPath(o.curveType, points, o.pixelLength);
      const timing = sliderTiming(beatmap, o);
      return {
        ...base,
        path, timing, slides: o.slides,
        endTime: timing.endTime,
        ticks: sliderTicks(path, timing, o).map((t) => ({ ...t, hit: null })),
        repeats: sliderRepeats(path, timing, o).map((r) => ({ ...r, hit: null })),
        nextTick: 0, nextRepeat: 0,
        tracking: false, everTracked: false, tailHit: false, finalized: false,
      };
    });

    // combo numbers reset on each new combo object, same as the real game
    let combo = 0, colour = 0;
    for (let i = 0; i < this.objects.length; i++) {
      if (src[i].isNewCombo || i === 0) { combo = 1; colour = (colour + 1) % COMBO_COLOURS.length; }
      else combo++;
      this.objects[i].combo = combo;
      this.objects[i].comboColour = colour;
    }

    // stacked notes share a position in the .osu; shift them up-left so the pile
    // is visible instead of one disc covering the rest. rings + remaining-count
    // do the rest of the work at draw time.
    const stackLeniency = Number(beatmap.general.StackLeniency);
    applyStacking(this.objects, {
      preempt: this.diff.preempt,
      stackLeniency: Number.isFinite(stackLeniency) ? stackLeniency : 0.7,
      radius: this.diff.radius,
    });

    // lead in. silence gets stuck on the front of the audio so the first object isn't
    // on you the second playback starts. the clock is still the audio clock, song time
    // just runs negative through the lead in and hits zero when the real audio starts.
    const first = this.objects[0]?.time ?? 0;
    this.leadInMs = Math.max(
      beatmap.audioLeadIn,                              // whatever the map asks for
      Math.max(0, MIN_PREP_MS - first),                 // time to get ready
      Math.max(0, this.diff.preempt + 400 - first),     // enough to see the first approach circle
    );

    this.reset();
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { GREAT: 0, OK: 0, MEH: 0, MISS: 0 };
    this.errors = [];
    this.nextIndex = 0;    // first object with an unjudged head, this is what note lock uses
    for (const o of this.objects) {
      o.headResult = null; o.headAt = 0; o.error = 0;
      o.result = null; o.resultAt = 0;
      if (o.kind === 'slider') {
        o.nextTick = 0; o.nextRepeat = 0;
        o.tracking = false; o.everTracked = false; o.tailHit = false; o.finalized = false;
        for (const t of o.ticks) t.hit = null;
        for (const r of o.repeats) r.hit = null;
      }
    }
  }

  get accuracy() {
    const c = this.counts;
    const total = c.GREAT + c.OK + c.MEH + c.MISS;
    if (!total) return 1;
    return (c.GREAT * 300 + c.OK * 100 + c.MEH * 50) / (total * 300);
  }

  get progress() {
    const last = this.objects[this.objects.length - 1];
    return last ? Math.min(1, Math.max(0, this.time / (last.endTime + 1000))) : 0;
  }

  // ------------------------------------------------------------- combo/score
  #addCombo(points) {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += Math.round(points * (1 + Math.max(0, this.combo - 1) / 25) * this.scoreMul);
  }
  #breakCombo() { this.combo = 0; }

  // ------------------------------------------------------------- judgement
  // runs on every tap. at is when the input actually arrived, not the frame time.
  handleHit(at) {
    const t = this.timeAtWall(at);
    const w = this.diff.windows;

    this.expireBefore(t);

    // note lock: only the earliest object with an unjudged head can be hit
    const o = this.objects[this.nextIndex];
    if (!o || o.headResult) return null;

    const dt = t - o.time;
    if (dt < -w.meh || dt > w.meh) return null;

    const ad = Math.abs(dt);
    const kind = ad <= w.great ? 'GREAT' : ad <= w.ok ? 'OK' : 'MEH';
    this.#judgeHead(o, kind, dt);
    return kind;
  }

  #judgeHead(o, kind, dt) {
    o.headResult = kind;
    o.headAt = this.time;
    o.error = dt;

    if (kind === 'MISS') this.#breakCombo();
    else {
      this.#addCombo(o.kind === 'slider' ? 30 : JUDGE[kind].score);
      this.#playHitsound(o);
      this.errors.push(dt);
      if (this.errors.length > 48) this.errors.shift();
    }

    // circles finish right away, sliders stay live until the tail
    if (o.kind === 'circle') this.#finish(o, kind);
    else if (kind !== 'MISS') o.everTracked = true;   // hitting the head counts as tracking

    this.#advance();
  }

  #stackRemaining(o) {
    const g = o.stackGroup;
    if (g == null) return 1;
    let n = 0;
    for (let i = this.nextIndex; i < this.objects.length; i++) {
      const x = this.objects[i];
      if (x.stackGroup === g && !x.headResult) n++;
    }
    return n;
  }

  #finish(o, kind) {
    o.result = kind;
    o.resultAt = this.time;
    this.counts[kind]++;
    if (kind === 'MISS') this.#breakCombo();
  }

  // play an object's hitsounds. these go off on your input, not at the authored time,
  // which is why the audio has to mix live instead of being rendered ahead.
  #playHitsound(o) {
    if (!this.audio || !o.samples) return;
    for (const s of o.samples) this.audio.playSample(s, o.sampleGain);
  }

  #playTickSound(gain = 0.5) {
    if (!this.audio || !this.tickSample) return;
    this.audio.playSample(this.tickSample, gain);
  }

  // work out every object's samples up front so nothing touches the disk mid game.
  // skipping this is fine, you just get no hitsounds.
  async prepareAudio(sampleRate) {
    const bank = await HitsoundBank.forBeatmap(this.map, sampleRate);
    const bgP = this.#loadBackground();
    await bank.prime(this.map);

    const src = this.map.hitObjects.filter((h) => !h.isSpinner);
    for (let i = 0; i < this.objects.length; i++) {
      const h = src[i];
      const tp = this.map.effectiveAt(h.time);
      this.objects[i].samples = await bank.resolve(tp?.sampleSet ?? 1, h.hitSound ?? 1, tp?.sampleIndex ?? 0);
      this.objects[i].sampleGain = ((tp?.volume ?? 100) / 100) * 0.9;
    }
    [this.tickSample] = await bank.resolve(this.map.timingPoints[0]?.sampleSet ?? 1, 0, 0);
    this.hitsoundStats = { loaded: bank.loaded, synthesized: bank.synthesized };
    await bgP;
    return this;
  }

  async #loadBackground() {
    this.#bgSrc = await loadBackground(this.map.backgroundPath);
    this.#bgFit = null;
  }

  #applyGains(player = this.audio) {
    if (!player) return;
    const g = mixGains(this.masterVolume, this.musicVolume, this.effectVolume);
    player.musicGain = g.music;
    player.effectGain = g.effect;
  }

  #handleVolumeKey(ch) {
    let which = null, dir = 0;
    if (ch === '-' || ch === '_') { which = 'masterVolume'; dir = -1; }
    else if (ch === '=' || ch === '+') { which = 'masterVolume'; dir = 1; }
    else if (ch === '[') { which = 'musicVolume'; dir = -1; }
    else if (ch === ']') { which = 'musicVolume'; dir = 1; }
    else if (ch === ',') { which = 'effectVolume'; dir = -1; }
    else if (ch === '.') { which = 'effectVolume'; dir = 1; }
    else return false;
    this[which] = stepVolume(this[which], dir);
    this.#applyGains();
    this.volumeToast = { which, until: nowMs() + 1400 };
    this.onVolume?.({
      masterVolume: this.masterVolume,
      musicVolume: this.musicVolume,
      effectVolume: this.effectVolume,
    });
    return true;
  }

  #handleBackgroundKey(ch) {
    if (ch !== 'b' && ch !== 'B') return false;
    this.showBackground = !this.showBackground;
    this.volumeToast = { which: 'showBackground', until: nowMs() + 1400 };
    this.onBackground?.(this.showBackground);
    return true;
  }

  #advance() {
    while (this.nextIndex < this.objects.length && this.objects[this.nextIndex].headResult)
      this.nextIndex++;
  }

  // expire any heads whose 50 window closed before t
  expireBefore(t) {
    const w = this.diff.windows;
    for (let i = this.nextIndex; i < this.objects.length; i++) {
      const o = this.objects[i];
      if (o.headResult) continue;
      if (t <= o.time + w.meh) break;
      this.#judgeHead(o, 'MISS', w.meh);
    }
  }

  processMisses() { this.expireBefore(this.time); }

  // slider tracking, runs every frame. ticks and repeats count if the cursor was inside
  // the follow circle with a button held when they went past. the slider's final
  // judgement is just the fraction of its parts that landed.
  updateSliders(cursor, holding) {
    const followR = this.diff.radius * FOLLOW_SCALE;
    const t = this.time;

    for (let i = Math.max(0, this.nextIndex - 4); i < this.objects.length; i++) {
      const o = this.objects[i];
      if (o.kind !== 'slider' || o.finalized) continue;
      if (t < o.time) break;

      const ballAt = sliderProgress(o, Math.min(t, o.endTime));
      const ball = o.path.positionAt(ballAt);
      const inRange = Math.hypot(cursor.x - ball.x, cursor.y - ball.y) <= followR;
      o.tracking = holding && inRange && o.headResult !== null;
      if (o.tracking) o.everTracked = true;

      while (o.nextTick < o.ticks.length && o.ticks[o.nextTick].time <= t) {
        const tk = o.ticks[o.nextTick++];
        tk.hit = o.tracking;
        if (tk.hit) { this.#addCombo(10); this.#playTickSound(0.45); } else this.#breakCombo();
      }
      while (o.nextRepeat < o.repeats.length && o.repeats[o.nextRepeat].time <= t) {
        const rp = o.repeats[o.nextRepeat++];
        rp.hit = o.tracking;
        if (rp.hit) { this.#addCombo(30); this.#playHitsound(o); } else this.#breakCombo();
      }

      if (t >= o.endTime) {
        o.tailHit = o.tracking;
        if (o.tailHit) { this.#addCombo(30); this.#playHitsound(o); }
        this.#finalizeSlider(o);
      }
    }
  }

  #finalizeSlider(o) {
    o.finalized = true;
    const parts = 2 + o.ticks.length + o.repeats.length;   // head, tail, ticks, repeats
    const hit = (o.headResult && o.headResult !== 'MISS' ? 1 : 0)
      + (o.tailHit ? 1 : 0)
      + o.ticks.filter((x) => x.hit).length
      + o.repeats.filter((x) => x.hit).length;

    const frac = hit / parts;
    const kind = frac >= 1 ? 'GREAT' : frac >= 0.5 ? 'OK' : frac > 0 ? 'MEH' : 'MISS';
    this.#finish(o, kind);
  }

  // ------------------------------------------------------------- clock
  timeAtWall(at) { return this.time + (at - this.frameWall); }

  // ------------------------------------------------------------- loop
  async run({ pcm, sampleRate, channels }) {
    let fb = new Framebuffer(stdout.columns, stdout.rows);
    let pf = new Playfield(fb.width, fb.height, { radius: this.diff.radius });
    const input = new Input({ mode: this.aimMode, sensitivity: this.sensitivity, keys: this.keys });
    const player = new AudioEngine({ sampleRate, channels });
    this.audio = player;

    const leadInFrames = Math.round((this.leadInMs / 1000) * sampleRate);
    const padded = leadInFrames > 0
      ? Buffer.concat([Buffer.alloc(leadInFrames * channels * 2), pcm])
      : pcm;

    this.time = 0;
    this.frameWall = nowMs();
    let quit = false, paused = false, restart = false, toMenu = false, quitApp = false;

    input.on('hit', ({ at }) => { if (!paused) this.handleHit(at); });
    const setPaused = (v) => {
      if (v === paused) return;
      paused = v;
      paused ? player.pause() : player.resume();
    };

    input.on('key', ({ ch }) => {
      if (ch === '\x03') { quitApp = true; quit = true; return; }
      if (this.#handleVolumeKey(ch)) return;
      if (this.#handleBackgroundKey(ch)) return;
      // escape opens the pause screen instead of dumping you out mid map
      if (ch === '\x1b' || ch === ' ') { setPaused(!paused); return; }
      if (paused) {
        if (ch === 'q') { toMenu = true; quit = true; }
        else if (ch === 'r') { restart = true; quit = true; }
      }
    });

    stdout.write(`${CSI}?1049h${CSI}?25l`);
    await input.enable();
    player.open().setMusic(padded);
    this.#applyGains(player);
    player.start();

    try {
      while (!quit) {
        // checking this instead of using stdout's resize event, because going
        // fullscreen doesn't reliably fire one on windows and comparing two ints
        // every frame costs nothing
        if (fb.cols !== stdout.columns || fb.rows !== stdout.rows) {
          fb = new Framebuffer(stdout.columns, stdout.rows);
          pf = new Playfield(fb.width, fb.height, { radius: this.diff.radius });
          stdout.write(`${CSI}2J`);
        }

        player.pump();          // refill finished audio buffers
        this.frameWall = nowMs();
        this.time = player.positionMs() - this.leadInMs - this.audioOffsetMs;

        input.poll();
        // input gives fractional cells. framebuffer is 1px per column and 2px per row,
        // so y gets doubled before converting back to osu coords.
        const cursor = pf.toOsu(input.cellX, input.cellY * 2);
        if (!paused) {
          this.processMisses();
          this.updateSliders(cursor, input.anyDown);
        }

        this.draw(fb, pf, input, paused, cursor);
        const frame = fb.render();
        if (frame) stdout.write(frame);

        if (this.time > this.objects[this.objects.length - 1].endTime + 2500) break;
        await new Promise((r) => setTimeout(r, 1));
      }
    } finally {
      player.close();
      input.disable();
      stdout.write(`${CSI}?25h${CSI}?1049l`);
    }

    return { ...this.#summary(), restart, toMenu, quitApp };
  }

  // ------------------------------------------------------------- rendering
  // public so the render benchmark can call it without a terminal
  draw(fb, pf, input, paused, cursor) {
    if (!this.#blitBackground(fb)) fb.clear(8, 8, 14);

    const pre = this.diff.preempt, fade = this.diff.fadeIn;
    const rad = pf.len(this.diff.radius);

    const visible = [];
    for (let i = Math.max(0, this.nextIndex - 8); i < this.objects.length; i++) {
      const o = this.objects[i];
      if (o.time - this.time > pre) break;
      if (o.result && this.time - o.resultAt > 220) continue;
      if (this.time > o.endTime + 250) continue;
      visible.push(o);
    }
    for (let i = visible.length - 1; i >= 0; i--) this.#drawObject(fb, pf, visible[i], rad, pre, fade);

    this.#drawHud(fb, paused);
    this.#drawCursor(fb, pf, input, cursor);
    this.#drawVolumeToast(fb, paused);
  }

  #blitBackground(fb) {
    if (!backgroundVisible(this.showBackground) || !this.#bgSrc) return false;
    if (!this.#bgFit || this.#bgFit.w !== fb.width || this.#bgFit.h !== fb.height) {
      this.#bgFit = {
        w: fb.width, h: fb.height,
        px: coverScale(this.#bgSrc.data, this.#bgSrc.width, this.#bgSrc.height, fb.width, fb.height, BG_DIM),
      };
    }
    return fb.blit(this.#bgFit.px);
  }

  #drawVolumeToast(fb, paused) {
    if (paused || !this.volumeToast || nowMs() > this.volumeToast.until) return;
    if (this.volumeToast.which === 'showBackground') {
      const text = `  background ${backgroundLabel(this.showBackground)}  `;
      fb.textCentered(Math.min(fb.rows - 3, Math.floor(fb.rows / 2) + 5), text, 0xffd257, 0x12121a);
      return;
    }
    const label = { masterVolume: 'volume', musicVolume: 'music', effectVolume: 'hitsounds' }[this.volumeToast.which];
    const text = `  ${label} ${volumePercent(this[this.volumeToast.which])}  `;
    fb.textCentered(Math.min(fb.rows - 3, Math.floor(fb.rows / 2) + 5), text, 0xffd257, 0x12121a);
  }

  #drawObject(fb, pf, o, rad, pre, fade) {
    const dt = o.time - this.time;
    const [cr, cg, cb] = COMBO_COLOURS[o.comboColour];
    const alpha = objectAlpha(dt, pre, fade, this.mods.hidden);
    const acA = approachAlpha(dt, pre, fade);
    const liveSlider = o.kind === 'slider' && this.time >= o.time && this.time <= o.endTime && !o.finalized;
    if (alpha <= 0 && !liveSlider && !o.result && !(dt > 0 && acA > 0 && !o.headResult)) return;

    if ((alpha > 0 || liveSlider) && o.kind === 'slider') this.#drawSlider(fb, pf, o, rad, alpha, [cr, cg, cb]);

    const cx = pf.sx(o.x), cy = pf.sy(o.y);

    if (o.result) {
      const age = (this.time - o.resultAt) / 220;
      if (age < 1) {
        const jc = JUDGE[o.result].colour;
        fb.strokeCircle(cx, cy, rad * (1 + age * 0.7), 1.6, jc[0], jc[1], jc[2], (1 - age) * 0.8);
      }
      return;
    }

    // keep drawing the head circle until the head is judged. Hidden fades the
    // disc out early; the approach circle still shrinks in so you have a cue.
    if (!o.headResult) {
      if (alpha > 0) {
        const stacked = (o.stackSize ?? 1) >= 2;
        const remaining = stacked && o.index === this.nextIndex ? this.#stackRemaining(o) : 0;
        const next = this.objects[this.nextIndex];
        const combo = remaining >= 2 || !comboVisible(o, next, this.diff.radius) ? null : o.combo;
        drawHitCircle(fb, cx, cy, rad, [cr, cg, cb], alpha, {
          stacked, combo, count: remaining >= 2 ? remaining : null,
        });
      }
      if (dt > 0 && acA > 0) {
        fb.strokeCircle(cx, cy, rad * (1 + 3 * (dt / pre)), 1.2, cr, cg, cb, acA * 0.75);
      }
    }
  }

  #drawSlider(fb, pf, o, rad, alpha, [cr, cg, cb]) {
    const path = o.path;
    // stamp discs along the path. spacing is based on the radius so the body stays
    // solid without doing one disc per pixel, which would be way too slow on long ones.
    if (alpha > 0) {
      const step = Math.max(1.2, rad / 2.5);
      const n = Math.max(2, Math.ceil(pf.len(path.length) / step));
      const bodyA = alpha * 0.5;

      for (let i = 0; i <= n; i++) {
        const p = path.positionAt(i / n);
        fb.fillCircle(pf.sx(p.x), pf.sy(p.y), rad * 0.92, cr * 0.22, cg * 0.22, cb * 0.22, bodyA);
      }
      for (let i = 0; i <= n; i++) {
        const p = path.positionAt(i / n);
        fb.fillCircle(pf.sx(p.x), pf.sy(p.y), rad * 0.34, cr * 0.55, cg * 0.55, cb * 0.55, bodyA);
      }

      // tail marker
      const tail = path.positionAt(o.slides % 2 === 1 ? 1 : 0);
      fb.strokeCircle(pf.sx(tail.x), pf.sy(tail.y), rad * 0.8, 1.2, cr, cg, cb, alpha * 0.7);

      // pending repeat arrows
      for (let i = o.nextRepeat; i < o.repeats.length; i++) {
        const r = o.repeats[i];
        fb.strokeCircle(pf.sx(r.x), pf.sy(r.y), rad * 0.5, 1.4, 255, 255, 255, alpha * 0.8);
        break;   // only draw the next one, same as osu
      }

      // pending ticks
      for (let i = o.nextTick; i < o.ticks.length; i++) {
        const tk = o.ticks[i];
        if (tk.time - this.time > this.diff.preempt) break;
        fb.fillCircle(pf.sx(tk.x), pf.sy(tk.y), Math.max(1, rad * 0.13), 255, 255, 255, alpha * 0.75);
      }
    }

    // ball and follow circle while the slider is going. Hidden keeps these
    // after the body has faded so you can still track.
    if (this.time >= o.time && this.time <= o.endTime && !o.finalized) {
      const b = o.path.positionAt(sliderProgress(o, this.time));
      const bx = pf.sx(b.x), by = pf.sy(b.y);
      fb.fillCircle(bx, by, rad * 0.55, cr, cg, cb, 0.95);
      fb.strokeCircle(bx, by, rad * (o.tracking ? FOLLOW_SCALE : 1.15), o.tracking ? 1.6 : 1,
        o.tracking ? 255 : 160, o.tracking ? 230 : 160, o.tracking ? 120 : 160,
        o.tracking ? 0.85 : 0.4);
    }
  }

  #drawCursor(fb, pf, input, cursor) {
    const c = cursor ?? { x: 256, y: 192 };
    const cx = pf.sx(c.x), cy = pf.sy(c.y);
    const hot = input.anyDown;
    const r = hot ? 2.6 : 2.0;
    fb.fillCircle(cx, cy, r, hot ? 255 : 235, hot ? 210 : 235, hot ? 90 : 245, 0.95);
    fb.strokeCircle(cx, cy, r + 1.4, 1, 255, 255, 255, 0.55);
  }

  #drawHud(fb, paused) {
    const c = this.counts;
    const acc = (this.accuracy * 100).toFixed(2);
    const m = this.map;

    const modsTag = modsAcronyms(this.mods);
    const title = modsTag
      ? `${m.artist} - ${m.title} [${m.diffName}] +${modsTag}`
      : `${m.artist} - ${m.title} [${m.diffName}]`;
    fb.text(1, 0, title.slice(0, fb.cols - 24), 0x9aa4b8);
    const right = `${String(this.score).padStart(8, '0')}   ${acc}%`;
    fb.text(fb.cols - right.length - 1, 0, right, 0xffffff);

    fb.text(1, fb.rows - 1, `${this.combo}x`, this.combo > 0 ? 0xffd257 : 0x555555);
    const help = 'esc pause';
    fb.text(fb.cols - help.length - 1, fb.rows - 1, help, 0x5a6272);
    // coloured squares sit on the row under the error bar so 300/100/50/X
    // match the ticks above instead of being a grey blob of numbers.
    drawJudgementLegend(fb, c, fb.rows - 2);
    drawHitErrorBar(fb, this.errors, this.diff.windows);

    const filled = Math.round(this.progress * fb.cols);
    for (let x = 0; x < fb.cols; x++) {
      const on = x < filled;
      fb.set(x, 0, on ? 90 : 26, on ? 150 : 26, on ? 220 : 34);
    }

    if (paused) this.#drawPauseMenu(fb);
    else if (this.time < 0) this.#drawCountdown(fb);
  }

  #drawPauseMenu(fb) {
    const row = Math.max(1, Math.floor(fb.rows / 2) - 5);
    fb.textCentered(row, '  paused  ', 0x000000, 0xffd257);
    fb.textCentered(row + 2, `-/=  volume    ${volumePercent(this.masterVolume)}`, 0xc8d0dc);
    fb.textCentered(row + 3, `[/]  music     ${volumePercent(this.musicVolume)}`, 0x8a94a8);
    fb.textCentered(row + 4, `,/.  hitsounds ${volumePercent(this.effectVolume)}`, 0x8a94a8);
    fb.textCentered(row + 5, `b    background ${backgroundLabel(this.showBackground)}`, 0x8a94a8);
    fb.textCentered(row + 6, `mods ${modsLabel(this.mods)}`, 0x8a94a8);
    fb.textCentered(row + 8, 'esc  resume', 0xc8d0dc);
    fb.textCentered(row + 9, 'r    retry', 0x8a94a8);
    fb.textCentered(row + 10, 'q    menu', 0x8a94a8);
  }

  // shown while song time is negative, so during the lead in
  #drawCountdown(fb) {
    const remain = -this.time;
    const row = Math.floor(fb.rows / 2);
    const secs = Math.ceil(remain / 1000);

    // bar that empties as the lead in runs out, plus a number so it's obvious
    const width = Math.min(40, fb.cols - 8);
    const left = Math.round((remain / this.leadInMs) * width);
    const bar = '='.repeat(Math.max(0, left)) + ' '.repeat(Math.max(0, width - left));
    fb.textCentered(row - 1, `  ${secs}  `, 0xffd257);
    fb.textCentered(row, bar, 0x4a5262);
    fb.textCentered(row + 2, 'get ready', 0x8a94a8);
  }

  #summary() {
    const c = this.counts;
    return {
      score: this.score, maxCombo: this.maxCombo, accuracy: this.accuracy,
      counts: { ...c },
      meanError: this.errors.length ? this.errors.reduce((a, b) => a + b, 0) / this.errors.length : 0,
      rank: rankFromCounts(c),
      mods: modsAcronyms(this.mods),
    };
  }
}
