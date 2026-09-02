// sanity checks for the Windows bootstrap script and LEGAL.md (text only).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { START_HINT } from './postinstall.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'install.ps1'), 'utf8');
const legal = readFileSync(path.join(root, 'LEGAL.md'), 'utf8');

const ok = (c, m) => console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

console.log('\n=== install.ps1 ===');

check(src.includes('Windows_NT'), 'refuses to run off Windows');
check(src.includes('$MinNode = 20'), 'requires Node 20+');
check(src.includes('OpenJS.NodeJS.LTS'), 'installs Node LTS via winget');
check(src.includes('npm.cmd'), 'uses npm.cmd');
check(!/&\s+npm\s+install/.test(src), 'does not invoke the PowerShell npm shim');
check(src.includes('Type  osuterminal  to start'), 'tells the user to type osuterminal to start');
check(src.includes('osuterminal.cmd'), 'mentions osuterminal.cmd if PowerShell blocks the name');
check(!/Set-ExecutionPolicy/i.test(src), 'does not change execution policy');
check(!/git clone/i.test(src), 'does not clone the git repo');
check(src.includes('OSUTERMINAL_QUIET_HELLO'), 'lets the bootstrap print the hint itself');
check(src.includes('install -g'), 'installs the npm package globally');
check(src.includes('unofficial'), 'says it is unofficial');
check(src.includes('ppy Pty Ltd'), 'names ppy so it is not implied official');

console.log('\n=== LEGAL.md ===');
check(/not legal advice/i.test(legal), 'does not pretend to be legal advice');
check(/not affiliated/i.test(legal), 'states it is not affiliated with ppy/osu!');
check(legal.includes('contact@ppy.sh'), 'points trademark questions at ppy');
check(legal.includes('Brand_identity_guidelines'), 'links osu! brand guidelines');
check(/cookie logo/i.test(legal), 'says we do not ship the cookie logo');
check(/synthesized/i.test(legal), 'says default hitsounds are synthesized');
check(/Warmup/.test(legal) && /original audio/i.test(legal), 'bundled maps are original audio');
check(/usesongs/.test(legal) && /reads/i.test(legal), 'usesongs is read-only');
check(/third-party mirrors/i.test(legal), 'download is from mirrors, not osu.ppy.sh');
check(/no online play/i.test(legal), 'no online play / ranking');
check(legal.includes('osu.ppy.sh/legal/en/Copyright'), 'links osu! copyright policy');
check(legal.includes('osu.ppy.sh/legal/en/Terms'), 'links osu! terms of service');

console.log('\n=== postinstall hint ===');
check(START_HINT === 'Type  osuterminal  to start', 'shared hint wording');
check(src.includes(START_HINT), 'bootstrap uses the same hint');

function runHello(env) {
  return spawnSync(process.execPath, [path.join(root, 'tools', 'postinstall.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

const silent = runHello({ npm_config_global: 'false' });
check(silent.status === 0 && !(silent.stdout || '').includes(START_HINT),
  'local npm install stays quiet');

const quiet = runHello({ npm_config_global: 'true', OSUTERMINAL_QUIET_HELLO: '1' });
check(quiet.status === 0 && !(quiet.stdout || '').includes(START_HINT),
  'bootstrap can suppress the npm copy of the hint');

const hello = runHello({ npm_config_global: 'true' });
check(hello.status === 0 && (hello.stdout || '').includes(START_HINT),
  'npm install -g prints Type osuterminal to start');
check((hello.stdout || '').includes('osuterminal.cmd'),
  'and mentions osuterminal.cmd for PowerShell');

if (failures) {
  console.log(`\n${failures} failed\n`);
  process.exit(1);
}
console.log('\nall good\n');
