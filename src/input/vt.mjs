// VT mouse / focus parsing, kept free of Win32 so tests can run on Linux.

// leftover key bytes after stripping SGR mouse and focus reports, so a motion
// event in the same chunk as ctrl+c / esc / z still gets through.
export function leftoverKeys(s) {
  return String(s)
    .replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, '')
    .replace(/\x1b\[[IO]/g, '');
}

// last focus report in the chunk wins. a combined I+O (alt-screen switch) used
// to leave us stuck unfocused because both includes() checks ran.
export function focusAfterChunk(s, currentlyFocused) {
  let focused = currentlyFocused;
  const re = /\x1b\[([IO])/g;
  let m;
  while ((m = re.exec(s))) focused = m[1] === 'I';
  return focused;
}

// mouse reports and leftover keys only arrive while the terminal has keyboard
// focus. a missed I, or an O that was really the pointer leaving the text
// area, used to leave poll() frozen: aim stuck, GetAsyncKeyState skipped,
// and with stdin in mark mode esc/z/x looked dead too.
export function focusedAfterInput(currentlyFocused, chunk, { sawMouse = false, sawKeys = false, pixelInside = false } = {}) {
  let focused = focusAfterChunk(chunk, currentlyFocused);
  if (sawMouse || sawKeys) return true;
  if (!focused && pixelInside) return true;
  return focused;
}

// button / key edges so VT stdin and GetAsyncKeyState can share one state
// without double-firing hit/release.
export function applyButton(state, name, down) {
  if (state[name] === down) return null;
  state[name] = down;
  return down ? 'hit' : 'release';
}

export function vkEdge(prevHeld, nowDown) {
  if (nowDown && !prevHeld) return { held: true, edge: 'down' };
  if (!nowDown && prevHeld) return { held: false, edge: 'up' };
  return { held: !!nowDown, edge: null };
}

// can poll() do anything this frame, or should it bail?
//
// pixelInTerminal can only answer once the origin is solved. before that it returns
// false, which means "no idea", not "the pointer is elsewhere". poll() treated the two
// the same and bailed, which is the countdown bug: lose focus before the first motion
// event lands and aim freezes where it was AND the GetAsyncKeyState fallback never
// runs, so z, x and esc are all dead with no way back. the origin can only be solved
// from motion events, which need focus, so nothing ever un-wedges it.
//
// with no origin we cannot rule out that we still have the window, so keep going.
// once the origin is solved pixelInside is trustworthy and normal gating resumes.
export function canPoll(focused, pixelInside, originKnown) {
  if (focused) return true;
  if (pixelInside) return true;
  return !originKnown;
}

// the edge-warp is an FPS-style mouse lock. it must not run in absolute aim,
// including the period before the terminal origin is solved — that is when
// tabbing back in used to pin the OS cursor to the screen centre.
export function mouseWarpEnabled(mode, originKnown) {
  // originKnown is part of the call so poll() cannot "forget" that unsolved
  // absolute aim used to take the relative warp path. it does not enable it.
  void originKnown;
  return mode === 'relative';
}
