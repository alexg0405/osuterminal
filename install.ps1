# Windows bootstrap for osuterminal.
# Installs Node.js LTS if needed, then the npm package. Does not clone the repo.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/alexg0405/osuterminal/main/install.ps1 | iex"
#
# Always calls npm.cmd / osuterminal.cmd so PowerShell's execution policy cannot
# block the .ps1 shims Node ships.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$MinNode = 20
$WingetId = 'OpenJS.NodeJS.LTS'
$NpmPackage = 'osuterminal'

function Say($msg, $color = 'White') {
  Write-Host $msg -ForegroundColor $color
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$user;$machine"
}

function Add-NodeDirsToPath {
  foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $root) { continue }
    $dir = Join-Path $root 'nodejs'
    if (Test-Path (Join-Path $dir 'node.exe')) {
      $env:Path = "$dir;$env:Path"
    }
  }
}

function Get-NodeMajor {
  Add-NodeDirsToPath
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $null }
  try {
    $raw = & $node.Source -p "process.versions.node.split('.')[0]"
    return [int]$raw
  } catch { return $null }
}

function Get-NpmCmd {
  Add-NodeDirsToPath
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npm) { return $npm.Source }
  foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $root) { continue }
    $candidate = Join-Path $root 'nodejs\npm.cmd'
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

function Ensure-UserPath([string]$dir) {
  if (-not $dir -or -not (Test-Path $dir)) { return }
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @()
  if ($user) { $parts = $user.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries) }
  foreach ($p in $parts) {
    if ([string]::Equals($p.TrimEnd('\'), $dir.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
      return
    }
  }
  $next = if ($user) { "$dir;$user" } else { $dir }
  [Environment]::SetEnvironmentVariable('Path', $next, 'User')
  $env:Path = "$dir;$env:Path"
  Say "  added $dir to your user PATH" 'DarkGray'
}

if ($env:OS -ne 'Windows_NT') {
  throw 'osuterminal is Windows-only (aim and audio go through Win32).'
}

Say ''
Say 'osuterminal  (unofficial fan project, not affiliated with ppy Pty Ltd)' 'Cyan'
Say 'installing from npm — nothing is cloned from GitHub' 'DarkGray'
Say ''

$major = Get-NodeMajor
if ($null -eq $major -or $major -lt $MinNode) {
  if ($null -eq $major) { Say 'Node.js not found.' 'Yellow' }
  else { Say "Node.js $major is too old (need $MinNode+)." 'Yellow' }

  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw @"
Install Node.js $MinNode or newer from https://nodejs.org then re-run this script.
(winget is not available to install it automatically.)
"@
  }

  Say "installing Node.js LTS via winget ($WingetId)..." 'Yellow'
  & winget install -e --id $WingetId --accept-package-agreements --accept-source-agreements
  $wingetExit = $LASTEXITCODE
  Refresh-Path
  Add-NodeDirsToPath
  $major = Get-NodeMajor
  if ($null -eq $major -or $major -lt $MinNode) {
    throw @"
winget exited $wingetExit and Node.js $MinNode+ is still missing.
Install it from https://nodejs.org, open a new terminal, and re-run.
"@
  }
}

Say "Node.js $major  ok" 'Green'

$npm = Get-NpmCmd
if (-not $npm) { throw 'npm.cmd not found. Reinstall Node.js from https://nodejs.org and re-run.' }

Say "npm  $npm" 'DarkGray'
Say "installing $NpmPackage globally..." 'Yellow'
& $npm install -g $NpmPackage
if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }

$prefix = (& $npm prefix -g).Trim()
$shim = Join-Path $prefix 'osuterminal.cmd'
if (-not (Test-Path $shim)) {
  throw "installed but $shim is missing. Check that npm's global bin is writable."
}
Ensure-UserPath $prefix

Say ''
Say 'done.' 'Green'
Say ''
Say '  osuterminal.cmd' 'White'
Say ''
Say 'PowerShell blocks the osuterminal.ps1 shim by default, so use .cmd.' 'DarkGray'
Say 'Two beginner maps ship with the package. osuterminal.cmd usesongs will' 'DarkGray'
Say 'also list maps you already downloaded in osu! (read-only, nothing copied).' 'DarkGray'
Say 'Unofficial — see LEGAL.md in the repo. Not affiliated with ppy Pty Ltd.' 'DarkGray'
Say ''
