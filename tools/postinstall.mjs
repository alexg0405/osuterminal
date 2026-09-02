#!/usr/bin/env node
// koffi needs its install script (cnoke) to drop the native addon in place.
// npm 11.16+ / 12 skips dependency install scripts on `npm install -g` and `npx`
// unless the package is on the user allow-scripts list. this install is already
// in progress, so we both persist that config and run cnoke once ourselves.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

function npm(args, opts = {}) {
  const npmJs = process.env.npm_execpath;
  if (npmJs && existsSync(npmJs)) {
    return spawnSync(process.execPath, [npmJs, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      ...opts,
    });
  }
  return spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    encoding: 'utf8',
    windowsHide: true,
    ...opts,
  });
}

function npmVersion() {
  const r = npm(['--version']);
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(r.stdout || '');
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// allow-scripts only exists on npm 11.16+; older npm runs install scripts by default.
function supportsAllowScripts() {
  const [maj, min] = npmVersion();
  return maj > 11 || (maj === 11 && min >= 16);
}

function allowKoffi() {
  if (!supportsAllowScripts()) return;
  const got = npm(['config', 'get', 'allow-scripts']);
  const raw = (got.stdout || '').trim();
  const parts = (raw === 'undefined' || raw === 'null' ? '' : raw)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== 'undefined' && s !== 'null');
  if (parts.some((p) => p === 'koffi' || p.startsWith('koffi@'))) return;
  parts.push('koffi');
  npm(['config', 'set', `allow-scripts=${parts.join(',')}`, '--location=user'], {
    stdio: 'ignore',
  });
}

function koffiLoads() {
  try {
    require('koffi');
    return true;
  } catch {
    return false;
  }
}

function rebuildKoffi() {
  let pkgDir;
  try {
    pkgDir = path.dirname(require.resolve('koffi/package.json'));
  } catch {
    return;
  }
  const cnoke = path.join(pkgDir, 'cnoke.cjs');
  if (!existsSync(cnoke)) return;
  spawnSync(process.execPath, [cnoke, '-P', '.', '-D', 'src/koffi', '--prebuild', '--release'], {
    cwd: pkgDir,
    stdio: 'ignore',
    windowsHide: true,
  });
}

try {
  allowKoffi();
  if (!koffiLoads()) rebuildKoffi();
} catch {
  // never fail the install over this
}
