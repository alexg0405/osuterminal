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

function tagStack(objects, a, b) {
  const ga = a.stackGroup, gb = b.stackGroup;
  if (ga != null && gb != null && ga !== gb) {
    for (const o of objects) if (o.stackGroup === gb) o.stackGroup = ga;
    a.stackGroup = b.stackGroup = ga;
    return;
  }
  const g = ga ?? gb ?? (tagStack.next++);
  a.stackGroup = b.stackGroup = g;
}

// osu stable uses radius/10, which disappears on a terminal. about a third of
// the circle per step leaves a crescent you can count, even at 80x24.
export function stackOffsetForRadius(radius) {
  return Math.max(radius / 2.6, 11);
}

// mutates objects: writes stackHeight / stackGroup / stackSize, then shifts x/y.
export function applyStacking(objects, { preempt, stackLeniency = 0.7, radius }) {
  const stackThreshold = preempt * stackLeniency;
  const n = objects.length;
  tagStack.next = 0;
  for (const o of objects) {
    o.stackHeight = 0;
    o.stackGroup = null;
    o.stackSize = 1;
  }
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
            if (dist(nEnd, startPos(objects[j])) < STACK_DISTANCE) {
              objects[j].stackHeight -= offset;
              tagStack(objects, objects[j], objectN);
            }
          }
          break;
        }

        if (dist(startPos(objectN), iPos) < STACK_DISTANCE) {
          tagStack(objects, objectN, objectI);
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
          tagStack(objects, objectN, objectI);
          objectN.stackHeight = objectI.stackHeight + 1;
          objectI = objectN;
        }
      }
    }
  }

  const sizes = new Map();
  for (const o of objects) {
    if (o.stackGroup == null) continue;
    sizes.set(o.stackGroup, (sizes.get(o.stackGroup) ?? 0) + 1);
  }
  for (const o of objects) {
    o.stackSize = o.stackGroup == null ? 1 : sizes.get(o.stackGroup);
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
