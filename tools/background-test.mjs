// beatmap background events, image decode, cover-crop, framebuffer blit.
// does not import game.mjs (that loads Win32 via koffi).
import path from 'node:path';
import { Beatmap, parseBackgroundEvent } from '../src/core/beatmap.mjs';
import {
  decodeImage, coverScale, rgbaToRgb, BG_DIM, loadBackground,
  parseBackgroundFlag, backgroundVisible, backgroundLabel,
} from '../src/render/background.mjs';
import { Framebuffer } from '../src/render/framebuffer.mjs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

console.log('\n=== background events ===');

check(parseBackgroundEvent('0,0,"bg.jpg",0,0') === 'bg.jpg', 'quoted 0-event');
check(parseBackgroundEvent('0,0,bg.jpg,0,0') === 'bg.jpg', 'unquoted 0-event');
check(parseBackgroundEvent('Background,0,"art/foo.png"') === 'art/foo.png', 'Background,0,file form');
check(parseBackgroundEvent('0,0,"foo bar.jpg",0,0') === 'foo bar.jpg', 'spaces inside quotes');
check(parseBackgroundEvent('Video,0,"clip.mp4"') === null, 'video events ignored');
check(parseBackgroundEvent('1,0,"clip.mp4"') === null, 'numeric video events ignored');
check(parseBackgroundEvent('Sprite,Background,Centre,"sb.png"') === null, 'storyboard sprites ignored');
check(parseBackgroundEvent('//0,0,"no.jpg"') === null, 'comments ignored');
check(parseBackgroundEvent('') === null, 'empty line ignored');

const HEADER = [
  'osu file format v14', '',
  '[General]', 'Mode: 0', 'AudioFilename: a.mp3', '',
  '[Metadata]', 'Title:Test', 'Artist:A', 'Creator:c', 'Version:Easy', '',
  '[Difficulty]', 'CircleSize:4', 'OverallDifficulty:5', 'ApproachRate:5', '',
  '[TimingPoints]', '0,500,4,2,0,100,1,0', '',
];

const withEvents = (...events) => Beatmap.parse([
  ...HEADER,
  '[Events]',
  '//Background and Video events',
  ...events,
  '',
  '[HitObjects]',
  '256,192,1000,1,0,0:0:0:0:',
].join('\n'), path.join('maps', 'set', 'diff.osu'));

const map = withEvents('Video,0,"clip.mp4"', '0,0,"folder/bg.jpg",0,0', '0,0,"second.png",0,0');
check(map.backgroundFile === 'folder/bg.jpg', 'first background wins, video skipped');
check(map.backgroundPath === path.resolve('maps', 'set', 'folder', 'bg.jpg'),
  'backgroundPath joins under the map folder');

const noBg = withEvents('Video,0,"clip.mp4"');
check(noBg.backgroundFile === '' && noBg.backgroundPath === null, 'video-only maps have no background');

const escaped = Beatmap.parse([
  ...HEADER, '[Events]', '0,0,"../secret.jpg",0,0', '',
  '[HitObjects]', '256,192,1000,1,0,0:0:0:0:',
].join('\n'), path.join('maps', 'set', 'diff.osu'));
check(escaped.backgroundFile === '../secret.jpg', 'parser still records the authored filename');
check(escaped.backgroundPath === null, 'path traversal is not loaded');

console.log('\n=== cover-crop ===');

const rgb = (...px) => Uint8Array.from(px);
// 4×1: R G B Y. cover into 2×1 should keep the centre two (G, B).
const wide = rgb(255, 0, 0,  0, 255, 0,  0, 0, 255,  255, 255, 0);
const cropped = coverScale(wide, 4, 1, 2, 1, 1);
check(cropped.length === 6, 'dest buffer is dw*dh*3');
check(cropped[0] === 0 && cropped[1] === 255 && cropped[2] === 0, 'left dest pixel is green');
check(cropped[3] === 0 && cropped[4] === 0 && cropped[5] === 255, 'right dest pixel is blue');

const dimmed = coverScale(rgb(255, 0, 0), 1, 1, 2, 2, BG_DIM);
check(dimmed.length === 12, '1×1 covers 2×2');
check(dimmed[0] === Math.floor(255 * BG_DIM) && dimmed[1] === 0 && dimmed[2] === 0, 'dim applied');
check(dimmed[9] === dimmed[0], 'every dest pixel samples the same source');

const empty = coverScale(rgb(), 0, 0, 3, 3, 1);
check(empty.length === 27 && empty.every((v) => v === 0), 'zero-size source yields black');

console.log('\n=== decode png/jpeg ===');

const png = new PNG({ width: 2, height: 2 });
const pngPx = [
  255, 0, 0, 255,   0, 255, 0, 255,
  0, 0, 255, 255,   255, 255, 0, 255,
];
png.data.set(pngPx);
const pngBuf = PNG.sync.write(png);
const pngImg = decodeImage(pngBuf, 'bg.png');
check(!!pngImg && pngImg.width === 2 && pngImg.height === 2, 'png decodes to 2×2');
check(pngImg.data[0] === 255 && pngImg.data[1] === 0 && pngImg.data[2] === 0, 'png top-left is red');
check(pngImg.data[3] === 0 && pngImg.data[4] === 255 && pngImg.data[5] === 0, 'png top-right is green');

const jpgBuf = jpeg.encode({ width: 2, height: 2, data: Buffer.from(pngPx) }, 100).data;
const jpgImg = decodeImage(jpgBuf, 'bg.jpg');
check(!!jpgImg && jpgImg.width === 2 && jpgImg.height === 2, 'jpeg decodes to 2×2');
check(jpgImg.data[0] > 200 && jpgImg.data[1] < 40 && jpgImg.data[2] < 40, 'jpeg top-left is still red-ish');

check(decodeImage(Buffer.from('not an image'), 'bg.jpg') === null, 'garbage bytes fail soft');
check(await loadBackground(null) === null, 'missing path fails soft');
check(await loadBackground('/no/such/bg.jpg') === null, 'missing file fails soft');

console.log('\n=== framebuffer blit ===');
const fb = new Framebuffer(4, 2); // 4×4 pixels
const src = new Uint8Array(fb.px.length);
src[0] = 10; src[1] = 20; src[2] = 30;
fb.text(0, 0, 'hi', 0xffffff);
check(fb.blit(src) === true, 'blit accepts a matching buffer');
check(fb.px[0] === 10 && fb.px[1] === 20 && fb.px[2] === 30, 'blit copies pixels');
check(fb.txtChar[0] === 0, 'blit clears overlay text');
check(fb.blit(new Uint8Array(3)) === false, 'blit rejects a size mismatch');

console.log('\n=== background toggle ===');
check(parseBackgroundFlag('--no-bg') === false, '--no-bg hides');
check(parseBackgroundFlag('--no-background') === false, '--no-background hides');
check(parseBackgroundFlag('--hide-background') === false, '--hide-background hides');
check(parseBackgroundFlag('--bg') === true, '--bg shows');
check(parseBackgroundFlag('--background') === true, '--background shows');
check(parseBackgroundFlag('--volume') === null, 'other flags are left alone');
check(backgroundVisible(undefined) === true, 'missing config means the picture is on');
check(backgroundVisible(true) === true, 'true is on');
check(backgroundVisible(false) === false, 'false is off');
check(backgroundLabel(true) === 'on' && backgroundLabel(false) === 'off', 'pause-menu labels');

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall ok');
