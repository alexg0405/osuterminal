// VT mouse / focus helpers. imports only src/input/vt.mjs — never input.mjs —
// because the Win32 bindings cannot load on Linux.

import { leftoverKeys, focusAfterChunk, mouseWarpEnabled } from '../src/input/vt.mjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

console.log('\n=== mouse warp (absolute must never lock the OS cursor) ===');
check(mouseWarpEnabled('absolute', false) === false,
  'absolute aim does not warp before the terminal origin is solved');
check(mouseWarpEnabled('absolute', true) === false,
  'absolute aim does not warp after the origin is solved');
check(mouseWarpEnabled('relative', false) === true,
  'relative aim still warps (FPS mouse lock)');
check(mouseWarpEnabled('relative', true) === true,
  'relative aim warps regardless of origin.known');

console.log('\n=== leftover keys after mouse / focus ===');
check(leftoverKeys('\x1b[<32;10;5Mz') === 'z',
  'tap key after a motion event is not dropped');
check(leftoverKeys('\x1b[<0;1;1M\x03') === '\x03',
  'ctrl+c after a click still gets through');
check(leftoverKeys('\x1b[<0;1;1m\x1b') === '\x1b',
  'esc after a mouse release still gets through');
check(leftoverKeys('\x1b[I\x1b[Oq') === 'q',
  'q after focus reports is leftover');
check(leftoverKeys('\x1b[<32;4;2M\x1b[Ix') === 'x',
  'x after motion + focus-in is leftover');
check(leftoverKeys('\x1b[<32;4;2M\x1b[I') === '',
  'a chunk that is only mouse + focus has no leftover keys');
check(leftoverKeys('zx') === 'zx', 'plain keys pass through unchanged');

console.log('\n=== focus reports (last in the chunk wins) ===');
check(focusAfterChunk('\x1b[I', false) === true, 'focus-in sets focused');
check(focusAfterChunk('\x1b[O', true) === false, 'focus-out clears focused');
check(focusAfterChunk('\x1b[I\x1b[O', true) === false,
  'I then O leaves unfocused (alt-screen out)');
check(focusAfterChunk('\x1b[O\x1b[I', false) === true,
  'O then I leaves focused (tab back in / alt-screen in)');
check(focusAfterChunk('hello', true) === true, 'no report keeps the current state');
check(focusAfterChunk('hello', false) === false, 'no report keeps unfocused too');

// the old handler ran includes(I) then includes(O), so a chunk containing both
// always ended unfocused even when the last report was I.
{
  const chunk = '\x1b[O\x1b[I';
  const old = (() => {
    let focused = true;
    if (chunk.includes('\x1b[I')) focused = true;
    if (chunk.includes('\x1b[O')) focused = false;
    return focused;
  })();
  check(old === false, 'the old includes() order would leave this chunk unfocused');
  check(focusAfterChunk(chunk, true) === true, 'the new parser keeps the last report');
}

console.log(`\n${failures === 0 ? '\x1b[1;32mall checks passed\x1b[0m' : `\x1b[1;31m${failures} failure(s)\x1b[0m`}\n`);
process.exit(failures ? 1 : 0);
