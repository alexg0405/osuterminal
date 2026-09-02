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

// the edge-warp is an FPS-style mouse lock. it must not run in absolute aim,
// including the period before the terminal origin is solved — that is when
// tabbing back in used to pin the OS cursor to the screen centre.
export function mouseWarpEnabled(mode, originKnown) {
  // originKnown is part of the call so poll() cannot "forget" that unsolved
  // absolute aim used to take the relative warp path. it does not enable it.
  void originKnown;
  return mode === 'relative';
}
