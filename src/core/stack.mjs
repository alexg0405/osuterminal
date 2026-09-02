// osu!standard stacking.
//
// notes that land on the same spot within StackLeniency * preempt get offset
// up-left so you can see the pile instead of one circle eating the next.
// distance threshold is the same 3px as stable; the per-level offset is larger
// than osu's radius/10 so it still reads on a terminal grid.

const STACK_DISTANCE = 3;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function endPos(o) {
  if (o.kind === 'slider' && o.path) {
    return o.path.positionAt(o.slides % 2 === 1 ? 1 : 0);
  }
  return { x: o.x, y: o.y };
}

function startPos(o) { return { x: o.x, y: o.y }; }

// osu stable uses radius/10, which is a couple of pixels at 1080p and basically
// nothing in a terminal. radius/5 keeps the staircase readable on a 80x24 grid.
export function stackOffsetForRadius(radius) {
  return Math.max(radius / 5, 6);
}

// mutates objects: writes stackHeight, then shifts x/y (and slider geometry).
export function applyStacking(objects, { preempt, stackLeniency = 0.7, radius }) {
  const stackThreshold = preempt * stackLeniency;
  const n = objects.length;
  for (const o of objects) o.stackHeight = 0;
  if (n < 2 || !(stackThreshold > 0) || !(radius > 0)) return objects;

  for (let i = n - 1; i > 0; i--) {
    let objectI = objects[i];
    if (objectI.stackHeight !== 0 || objectI.kind === 'spinner') continue;

    if (objectI.kind !== 'slider') {
      for (let k = i - 1; k >= 0; k--) {
        const objectN = objects[k];
        if (objectN.kind === 'spinner') continue;
        const nEndTime = objectN.endTime ?? objectN.time;
        if (objectI.time - nEndTime > stackThreshold) break;

        const nEnd = endPos(objectN);
        const iPos = startPos(objectI);

        if (objectN.kind === 'slider' && dist(nEnd, iPos) < STACK_DISTANCE) {
          const offset = objectI.stackHeight - objectN.stackHeight + 1;
          for (let j = k + 1; j <= i; j++) {
            if (dist(nEnd, startPos(objects[j])) < STACK_DISTANCE)
              objects[j].stackHeight -= offset;
          }
          break;
        }

        if (dist(startPos(objectN), iPos) < STACK_DISTANCE) {
          objectN.stackHeight = objectI.stackHeight + 1;
          objectI = objectN;
        }
      }
    } else {
      for (let k = i - 1; k >= 0; k--) {
        const objectN = objects[k];
        if (objectN.kind === 'spinner') continue;
        if (objectI.time - objectN.time > stackThreshold) break;
        if (dist(endPos(objectN), startPos(objectI)) < STACK_DISTANCE) {
          objectN.stackHeight = objectI.stackHeight + 1;
          objectI = objectN;
        }
      }
    }
  }

  const step = stackOffsetForRadius(radius);
  for (const o of objects) {
    const h = o.stackHeight ?? 0;
    if (!h) continue;
    const dx = -h * step, dy = -h * step;
    o.x += dx;
    o.y += dy;
    if (o.path?.points) {
      for (const p of o.path.points) { p.x += dx; p.y += dy; }
    }
    for (const t of o.ticks ?? []) { t.x += dx; t.y += dy; }
    for (const r of o.repeats ?? []) { r.x += dx; r.y += dy; }
  }
  return objects;
}
