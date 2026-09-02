// removes the powershell shim npm generates for the global install.
//
// npm writes three launchers: osuterminal (sh), osuterminal.cmd and osuterminal.ps1.
// powershell picks the .ps1, and the default execution policy on windows is Restricted,
// which refuses to run any script. so typing `osuterminal` fails with a security error
// even though the .cmd sitting right next to it would have worked fine.
//
// deleting the .ps1 makes powershell fall through to the .cmd via PATHEXT. cmd.exe and
// git bash were already using their own launchers and are unaffected.
//
// this never fails the install. worst case you type osuterminal.cmd instead.

import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

if (process.platform !== 'win32') process.exit(0);
if (process.env.npm_config_global !== 'true') process.exit(0);   // local install, no shims

try {
  // npm puts binaries in the prefix root on windows, not a bin subfolder
  const prefix = process.env.npm_config_prefix
    || path.dirname(path.dirname(process.execPath));
  const candidates = [
    path.join(prefix, 'osuterminal.ps1'),
    path.join(prefix, 'bin', 'osuterminal.ps1'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'osuterminal.ps1'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      rmSync(p, { force: true });
      console.log('removed the powershell shim so `osuterminal` works under the default execution policy');
      break;
    }
  }
} catch {
  // not worth failing an install over
}
