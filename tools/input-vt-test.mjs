// VT mouse / focus helpers. imports only src/input/vt.mjs — never input.mjs —
// because the Win32 bindings cannot load on Linux.

import { leftoverKeys, focusAfterChunk, focusedAfterInput, applyButton, vkEdge, mouseWarpEnabled, canPoll } from '../src/input/vt.mjs';

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

console.log('\n=== focus resume (mouse leave must not freeze input) ===');
check(focusedAfterInput(true, '\x1b[O', { pixelInside: true }) === true,
  'focus-out with the pointer still over the terminal stays focused');
check(focusedAfterInput(true, '\x1b[O', { pixelInside: false }) === false,
  'focus-out with the pointer outside really unfocuses');
check(focusedAfterInput(false, '\x1b[<32;10;5M', { sawMouse: true }) === true,
  'a mouse report after a missed I restores focus');
check(focusedAfterInput(false, 'z', { sawKeys: true }) === true,
  'a leftover key after a missed I restores focus');
check(focusedAfterInput(false, '', { pixelInside: true }) === true,
  'pointer over the text area restores focus with no stdin');
check(focusedAfterInput(false, '', {}) === false,
  'no evidence of focus stays unfocused');

console.log('\n=== button edges (VT + Win32 must not double-fire) ===');
{
  const s = { m1: false };
  check(applyButton(s, 'm1', true) === 'hit' && s.m1 === true, 'press is a hit');
  check(applyButton(s, 'm1', true) === null, 'held press is not a second hit');
  check(applyButton(s, 'm1', false) === 'release' && s.m1 === false, 'up is a release');
  check(applyButton(s, 'm1', false) === null, 'held release is not a second release');
}
check(vkEdge(false, true).edge === 'down', 'vk down edge');
check(vkEdge(true, true).edge === null, 'vk held has no edge');
check(vkEdge(true, false).edge === 'up', 'vk up edge');
check(vkEdge(false, false).edge === null, 'vk idle has no edge');


console.log('\n=== poll gate (countdown freeze) ===');
// the friend's bug: focus lost during the 3-2-1 before any motion event landed.
// origin unsolved -> pixelInTerminal false -> poll() bailed -> aim frozen and the
// GetAsyncKeyState fallback never ran, so z/x/esc were dead with no way back.
check(canPoll(false, false, false) === true,
  'unfocused with an unsolved origin still polls, otherwise the countdown wedges');
check(canPoll(false, false, true) === false,
  'unfocused with a solved origin and the pointer elsewhere does stop');
check(canPoll(false, true, true) === true,
  'pointer over the text area polls even when 1004 said we lost focus');
check(canPoll(false, true, false) === true,
  'pointer inside polls regardless of the origin');
check(canPoll(true, false, false) === true, 'focused always polls, unsolved origin');
check(canPoll(true, false, true) === true, 'focused always polls, solved origin');
check(canPoll(true, true, true) === true, 'focused and inside polls');

// the whole point is that it cannot get permanently stuck before the origin exists
{
  let wedged = false;
  for (let frame = 0; frame < 200; frame++) {
    if (!canPoll(false, false, false)) { wedged = true; break; }
  }
  check(!wedged, 'never wedges across a whole countdown of frames');
}


console.log(`\n${failures === 0 ? '\x1b[1;32mall checks passed\x1b[0m' : `\x1b[1;31m${failures} failure(s)\x1b[0m`}\n`);
process.exit(failures ? 1 : 0);
