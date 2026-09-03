// .osu parser, v14 and older.
// covers what std needs for circles and timing. slider control points are parsed here
// but the curve math is in slider.mjs.
// the format is roughly ini sections, except each section has its own syntax.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const HitObjectType = {
  CIRCLE: 1 << 0,
  SLIDER: 1 << 1,
  NEW_COMBO: 1 << 2,
  SPINNER: 1 << 3,
  HOLD: 1 << 7,   // osu!mania only
};

const NUM = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// one-sided hit windows in ms. 100 matches osu!stable (140-8*OD).
// 300 is 30ms wider than stable (110-6*OD) so blues are easier.
// 50 is 30ms tighter (170-10*OD) so yellows are a thin band before a miss.
// 300 is clamped inside 100 so a high OD can never make a 300 wider than a 100.
export function hitWindows(od) {
  const ok = 140 - 8 * od;
  const meh = Math.max(ok + 8, 170 - 10 * od);
  const great = Math.min(110 - 6 * od, ok - 8);
  return { great, ok, meh };
}

// true if the cursor is on the object's disc. a missing cursor skips the check
// so autoplay / unit tests can still call handleHit(at) without a position.
export function cursorOnObject(cursor, object, radius) {
  if (cursor == null || object == null) return true;
  const dx = cursor.x - object.x;
  const dy = cursor.y - object.y;
  return dx * dx + dy * dy <= radius * radius;
}

// 0,0,"bg.jpg",0,0   or   Background,0,bg.jpg
export function parseBackgroundEvent(line) {
  const t = String(line).trim();
  if (!t || t.startsWith('//')) return null;
  const m = t.match(/^(?:0|Background)\s*,\s*[^,]*\s*,\s*(?:"([^"]+)"|([^,]+))/i);
  if (!m) return null;
  const name = (m[1] ?? m[2] ?? '').trim();
  return name || null;
}

// CS/AR/OD turn into real numbers through these curves. same values osu uses.
export class Difficulty {
  constructor({ cs = 5, ar = 5, od = 5, hp = 5, sliderMultiplier = 1.4, sliderTickRate = 1 } = {}) {
    Object.assign(this, { cs, ar, od, hp, sliderMultiplier, sliderTickRate });
  }

  // circle radius in osu pixels
  get radius() { return 54.4 - 4.48 * this.cs; }

  // ms before the hit time that an object appears
  get preempt() {
    return this.ar < 5 ? 1200 + (600 * (5 - this.ar)) / 5
         : this.ar > 5 ? 1200 - (750 * (this.ar - 5)) / 5
         : 1200;
  }

  // fade in time in ms
  get fadeIn() {
    return this.ar < 5 ? 800 + (400 * (5 - this.ar)) / 5
         : this.ar > 5 ? 800 - (500 * (this.ar - 5)) / 5
         : 800;
  }

  // hit windows in ms, one side. anything past the 50 window is a miss.
  get windows() { return hitWindows(this.od); }
}

export class TimingPoint {
  constructor(o) { Object.assign(this, o); }
  // inherited points store SV as a negative reciprocal percentage
  get sliderVelocity() { return this.uninherited ? 1 : Math.max(0.1, Math.min(10, -100 / this.beatLength)); }
}

export class HitObject {
  constructor(o) { Object.assign(this, o); }
  get isCircle()  { return !!(this.type & HitObjectType.CIRCLE); }
  get isSlider()  { return !!(this.type & HitObjectType.SLIDER); }
  get isSpinner() { return !!(this.type & HitObjectType.SPINNER); }
  get isNewCombo(){ return !!(this.type & HitObjectType.NEW_COMBO); }
}

export class Beatmap {
  constructor() {
    this.version = 14;
    this.general = {};
    this.metadata = {};
    this.difficulty = new Difficulty();
    this.timingPoints = [];
    this.hitObjects = [];
    this.dir = '';
    this.file = '';
    this.backgroundFile = '';
  }

  get title()   { return this.metadata.Title ?? '(unknown)'; }
  get artist()  { return this.metadata.Artist ?? '(unknown)'; }
  get creator() { return this.metadata.Creator ?? '(unknown)'; }
  get diffName(){ return this.metadata.Version ?? '(unknown)'; }
  get mode()    { return NUM(this.general.Mode, 0); }
  get isStandard() { return this.mode === 0; }
  get audioPath()  { return path.join(this.dir, this.general.AudioFilename ?? ''); }
  get audioLeadIn(){ return NUM(this.general.AudioLeadIn, 0); }
  get backgroundPath() {
    if (!this.backgroundFile || !this.dir) return null;
    const resolved = path.resolve(this.dir, this.backgroundFile.replace(/[\\/]+/g, path.sep));
    const rel = path.relative(path.resolve(this.dir), resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return resolved;
  }

  // last uninherited timing point at or before this time
  timingAt(time) {
    let found = this.timingPoints.find((p) => p.uninherited) ?? null;
    for (const p of this.timingPoints) {
      if (p.time > time) break;
      if (p.uninherited) found = p;
    }
    return found;
  }

  // last timing point of any kind, used for slider velocity
  effectiveAt(time) {
    let found = this.timingPoints[0] ?? null;
    for (const p of this.timingPoints) { if (p.time > time) break; found = p; }
    return found;
  }

  static async load(file) {
    return new Beatmap().#parse(await readFile(file, 'utf8'), file);
  }

  static parse(text, file = '') {
    return new Beatmap().#parse(text, file);
  }

  #parse(text, file) {
    this.file = file;
    this.dir = file ? path.dirname(file) : '';

    const vm = text.match(/^﻿?osu file format v(\d+)/);
    if (vm) this.version = NUM(vm[1], 14);

    const diff = {};
    let section = null;

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//')) continue;

      const sec = line.match(/^\[(.+)\]$/);
      if (sec) { section = sec[1]; continue; }

      switch (section) {
        case 'General':   this.#kv(line, this.general); break;
        case 'Metadata':  this.#kv(line, this.metadata); break;
        case 'Editor':    break;
        case 'Difficulty': this.#kv(line, diff); break;
        case 'TimingPoints': this.#timingPoint(line); break;
        case 'HitObjects':   this.#hitObject(line); break;
        case 'Events':       this.#event(line); break;
        default: break;   // Colours, etc. not needed
      }
    }

    this.difficulty = new Difficulty({
      cs: NUM(diff.CircleSize, 5),
      ar: NUM(diff.ApproachRate, NUM(diff.OverallDifficulty, 5)),  // maps before v8 have no AR, it follows OD
      od: NUM(diff.OverallDifficulty, 5),
      hp: NUM(diff.HPDrainRate, 5),
      sliderMultiplier: NUM(diff.SliderMultiplier, 1.4),
      sliderTickRate: NUM(diff.SliderTickRate, 1),
    });

    this.timingPoints.sort((a, b) => a.time - b.time);
    this.hitObjects.sort((a, b) => a.time - b.time);
    return this;
  }

  #kv(line, into) {
    const i = line.indexOf(':');
    if (i < 0) return;
    into[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }

  // 0,0,"bg.jpg",0,0  — first background wins. video/storyboard lines are ignored.
  #event(line) {
    if (this.backgroundFile) return;
    const name = parseBackgroundEvent(line);
    if (name) this.backgroundFile = name;
  }

  // time,beatLength,meter,sampleSet,sampleIndex,volume,uninherited,effects
  #timingPoint(line) {
    const f = line.split(',');
    if (f.length < 2) return;
    const beatLength = NUM(f[1], 500);
    // older maps leave the trailing fields off. default to uninherited, and a positive
    // beatLength means uninherited regardless of what the flag says.
    const uninherited = f.length > 6 ? f[6].trim() === '1' : true;
    this.timingPoints.push(new TimingPoint({
      time: NUM(f[0]),
      beatLength,
      meter: NUM(f[2], 4),
      sampleSet: NUM(f[3], 1),      // 0 inherit, 1 normal, 2 soft, 3 drum
      sampleIndex: NUM(f[4], 0),    // custom suffix, 0 and 1 both mean none
      volume: NUM(f[5], 100),
      uninherited: uninherited || beatLength > 0,
      kiai: f.length > 7 ? (NUM(f[7]) & 1) === 1 : false,
    }));
  }

  #hitObject(line) {
    const f = line.split(',');
    if (f.length < 4) return;
    const x = NUM(f[0]), y = NUM(f[1]), time = NUM(f[2]), type = NUM(f[3]);
    const hitSound = NUM(f[4]);

    const o = { x, y, time, type, hitSound };

    if (type & HitObjectType.SLIDER && f.length >= 8) {
      // curveType|x:y|x:y,slides,length[,edgeSounds,edgeSets,hitSample]
      const [curveType, ...pts] = f[5].split('|');
      o.curveType = curveType;
      o.points = [{ x, y }, ...pts.map((p) => {
        const [px, py] = p.split(':');
        return { x: NUM(px), y: NUM(py) };
      })];
      o.slides = Math.max(1, NUM(f[6], 1));
      o.pixelLength = NUM(f[7]);
    } else if (type & HitObjectType.SPINNER && f.length >= 6) {
      o.endTime = NUM(f[5]);
    }

    this.hitObjects.push(new HitObject(o));
  }
}
