# osuterminal

Unofficial osu!standard in a terminal, with mouse aim and hit circles. Not
affiliated with ppy Pty Ltd or osu!.

Maps you download land in `~/osuterminal/Songs`. Two easy beginner maps (Warmup and
First Steps) ship with the package so you can play immediately. If you already have
osu! installed, `osuterminal usesongs` will also list those maps in place — nothing
is copied, and it is off until you choose it.

## install

First thing, try
''' npm install -g osuterminal '''

Windows, one line. Installs Node.js LTS if you do not have it, then the npm package.
Nothing is cloned from GitHub.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/alexg0405/osuterminal/main/install.ps1 | iex"
```

Then:

```powershell
osuterminal.cmd
```

PowerShell's default execution policy blocks `.ps1` shims, including the `npm` and
`osuterminal` names Node installs. The bootstrap always uses `.cmd`, and so should you.

If you already have Node 20+:

```bash
npm.cmd install -g osuterminal
```

When that finishes it prints **Type osuterminal to start**. If PowerShell blocks the
name, use `osuterminal.cmd`. `npx.cmd --yes osuterminal` also works without a global
install.

To make the plain `npm` / `osuterminal` names work in PowerShell:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

From the GitHub repo instead of npm: `npm.cmd install -g alexg0405/osuterminal`.

## usage

```bash
osuterminal                       # song select
osuterminal usesongs              # include your existing osu! Songs folder
osuterminal "tower of heaven"     # skip straight to a map
osuterminal "tower" -d 4          # pick difficulty 4
osuterminal --download            # get more maps
osuterminal --calibrate           # measure audio offset
osuterminal --keys df             # rebind tap keys
osuterminal --volume 70           # master volume 70% (remembered)
osuterminal --list
```

z / x / mouse to hit, esc to pause. from the pause screen r retries and q goes back to song select. finishing a map opens a results screen with your score, accuracy, hit counts, and a giant rank letter (gold S, green A, and so on). r retries from there too; enter goes back to song select.

`-` / `=` master volume, `[` / `]` music, `,` / `.` hitsounds. they work while playing and while paused, and they save to `~/.osuterminal.json`. `--volume 70` sets master to 70% (or `--volume 0.4` for 40%).

Maps that ship a jpg/png get that picture behind the playfield, cover-cropped to the terminal and dimmed so circles still read. it is nearest-neighbour on purpose, so it looks pixelated. video and storyboards are still stripped; maps without an image stay on the dark playfield.

`\` from song select opens the downloader (the search in that screenshot). `/` filters the list you already have. in the downloader, `\` toggles the search field so w/s can move the results without typing into the query.

Rebind the tap keys with `osuterminal --keys df`. Saves and exits, nothing else needed.

## downloading maps

The legally cleaner path if you already play osu! is `osuterminal usesongs`. That only
reads `%LOCALAPPDATA%\osu!\Songs` (or the equivalent on other OSes) — it does not
copy tens of gigabytes, and it does not create an osu! folder. `--no-import-osu`
turns it back off. Both are remembered in `~/.osuterminal.json`. On first launch,
if that folder already exists, you get asked once.

You can also download `.osz` files into `~/osuterminal/Songs` (override with
`--songs <dir>`). `osuterminal --download` opens a browser, or press `\` from song
select: type a query, enter to search, `\` to leave the field, w/s to move, enter
again to download. Tab still gets you there too, and if your Songs folder is empty
it just opens automatically.

Those downloads come from third-party mirrors (osu.direct, nerinyan, sayobot), not
from osu.ppy.sh. Songs stay copyrighted by their artists and mappers; this project
does not license them. See [LEGAL.md](LEGAL.md).

A mirror that blocks us gets dropped for the rest of the session so it
does not get hammered.
Video and storyboard files get stripped since nothing here can play them and they are
usually most of the download. jpg/png backgrounds are kept and drawn pixelated in game.

Search comes from osu metadata, so it lists maps the mirrors do not actually host. The
browser checks whichever set you highlight in the background and marks it: + means you
already have it, x means no mirror has it, ? means still checking.

There's a non-interactive version too:

```bash
osuterminal --search "nekodex"    # prints ids
osuterminal --get 354366
```

## calibration

Offset defaults to 0. If hits feel early or late on your setup, `osuterminal --calibrate`
plays a metronome, you tap along to what you hear, and it saves your number to
`~/.osuterminal.json`. `--offset <ms>` overrides it for one run.

Audio latency comes from the sound device, your headphones, the terminal, and your own
reaction time. There's no way to calculate it, you have to measure it.

mpg123 strips the LAME encoder delay when it decodes mp3s but osu's decoder doesn't,
so maps would end up ~13ms early and every hit would read as late. decode.mjs adds
those samples back.

## what works

Circles and sliders, all four curve types, ticks, repeats, follow circle tracking,
note lock, stacking. Hit circles are rings rather than solid discs, so streams and
stacks stay countable; a pile also spreads up-left and the next hit shows how many
are left. Hitsounds load from the beatmap folder and fall back to synthesized
ones when a map doesn't ship them. Beatmap backgrounds (jpg/png) render pixelated and
dimmed at terminal resolution. Volume is three sliders: master, music, hitsounds.

Not done yet: spinners, HP drain, breaks, mods.

## notes on how it works

Three things I had to figure out:

**Don't busy-spin the render loop.** Spinning for exact frame timing looks fine but
wrecks input timing. It starves the event loop and keypress jitter goes from 1.6ms to
13.6ms, which is nearly half the OD8 300 window. So frames are paced loosely with
setTimeout and inputs get timestamped the moment they arrive. A few ms of frame jitter
isn't visible, input jitter is.

**Aim and clicks come from different places.** Windows Terminal only reports the mouse
position in cells, which rounds your aim to 6.4px across and 12.8px down. That's about a
third of a CS4 circle radius so you literally can't aim at the middle of a note. It also
doesn't support the kitty keyboard protocol so there's no key release event.

So aim comes from Win32 GetCursorPos (pixel accurate), clicks come from VT stdin events
(event driven, ~1.6ms jitter, and this is the part that has to be accurate), and key
release comes from GetAsyncKeyState (only used for slider holds, where the exact ms
doesn't matter).

For absolute aim I need to know where the terminal actually is on screen, and Windows
won't tell you since GetConsoleWindow returns a hidden pseudo console. So it solves for
it instead: mouse motion events give you the cell, GetCursorPos gives you the pixel, and
each pair narrows the origin to a one cell wide range. Intersect enough of those and you
get it exactly. Converges to half a pixel in about 48 mouse movements.

**The clock has to come from the audio device.** waveOutGetPosition in TIME_SAMPLES mode
gives you exactly how many samples the hardware has played. 3ppm drift, 0.04ms jitter. A
regular timer desyncs you inside a minute. If the device opens but never advances
(GetPosition stuck at 0 — this is what froze the countdown on 22050 Hz mono beginner
maps), the engine falls back to the wall clock so the song still starts.

Audio is a ring of small buffers that get refilled and mixed as they finish. That's
needed for hitsounds, since those fire when you click rather than at a fixed time, and
waveOut plays queued buffers one after another instead of mixing them. The downside is
that queue depth equals hitsound latency, currently 8 x 5ms = 40ms.

Rendering uses half block characters (U+2580) with the foreground as the top pixel and
background as the bottom, so a 120x30 terminal is really 120x60 squarish pixels. Only
redraws cells that changed. Densest map I have (1343 objects, AR9.6) costs 1.38ms a
frame at 240x60.

## make it look better

Playfield resolution is just your terminal size, so shrink your font. Default 10x20
cells give a CS4 circle about 11x11 pixels. Halve the font and it's 23x23.

## layout

```
src/core/beatmap.mjs       .osu parser, difficulty math
src/core/slider.mjs        curve eval, length fitting, ticks
src/audio/engine.mjs       streaming mixer + the clock
src/audio/hitsounds.mjs    sample loading and synthesis
src/audio/decode.mjs       mp3/wav to PCM
src/audio/waveout.mjs      simple player, only calibration uses it
src/render/framebuffer.mjs half block framebuffer
src/render/playfield.mjs   512x384 onto the terminal, HUD insets
src/render/hitcircle.mjs   rings so overlapping notes stay countable
src/render/background.mjs  beatmap jpg/png, cover-crop, dim
src/input/input.mjs        the input split described above
src/volume.mjs             master / music / hitsound sliders
src/game.mjs               judgement, scoring, drawing
src/select.mjs             song select
src/net/mirror.mjs         beatmap mirror search and download
src/net/osz.mjs            .osz extraction
src/net/browse.mjs         download browser
src/library.mjs            songs folder + optional osu! import
src/main.mjs               cli
install.ps1                Windows one-line bootstrap
LEGAL.md                   unofficial / maps / branding notes
tools/                     tests and benchmarks
```

## tools

```bash
node tools/smoke.mjs         # main test suite
node tools/slider-test.mjs   # runs every slider in your library through the path code
node tools/origin-test.mjs   # cursor origin solver
node tools/engine-spike.mjs  # audio clock
node tools/render-bench.mjs  # frame timing
node tools/select-test.mjs   # song select keys
node tools/result-test.mjs   # ranking grades + results screen
node tools/stack-test.mjs    # stacked circle offsets
node tools/hitcircle-test.mjs # overlapping rings stay countable
node tools/browse-test.mjs   # download search keys
node tools/playfield-test.mjs # notes stay on screen vertically
node tools/volume-test.mjs   # volume clamp / step / mix
node tools/background-test.mjs # beatmap bg parse + pixelate
node tools/install-test.mjs  # bootstrap script + LEGAL.md checks
node tools/library-test.mjs  # songs dir + osu! import paths
node tools/decode-test.mjs   # wav resample to 44100 stereo
node tools/probe.mjs         # what your terminal supports
node tools/mirror-test.mjs   # mirrors, needs internet
```

npm scripts exist too but PowerShell blocks npm's .ps1 shim by default, so either use
`npm.cmd run x` or just call node.

## requirements

Windows, node 20+, terminal at least 60x20. koffi, mpg123-decoder, fflate, jpeg-js and
pngjs are all prebuilt or pure js so you don't need a compiler.

Unofficial fan project. Branding, maps, and music notes are in [LEGAL.md](LEGAL.md).

Input is Windows only right now. There's a VT fallback that works anywhere but you lose
pixel accurate aim.
