#!/usr/bin/env node
// printed after `npm install -g osuterminal`. local `npm install` in the repo
// is not a global install, so it stays quiet. the Windows bootstrap sets
// OSUTERMINAL_QUIET_HELLO so it can print the same line itself (npm 12 may
// skip this script unless allow-scripts includes osuterminal).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const START_HINT = 'Type  osuterminal  to start';

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const quiet = process.env.OSUTERMINAL_QUIET_HELLO === '1'
    || process.env.OSUTERMINAL_QUIET_HELLO === 'true';
  const global = String(process.env.npm_config_global || '').toLowerCase();
  const isGlobal = global === 'true' || global === '1';
  if (!quiet && isGlobal) {
    console.log(`
osuterminal is installed.

  ${START_HINT}

If PowerShell blocks that name, type  osuterminal.cmd
`);
  }
}
