#requires -Version 5.1
<#
.SYNOPSIS
  Install Better-skills-manager Antigravity plugin on Windows.
.DESCRIPTION
  Builds dist/server.mjs, dist/app.html, and dist/cli.mjs if needed (or when requested),
  then runs the Node installer to write the plugin and Windows mcp_config.json into
  $env:USERPROFILE\.gemini\config\plugins\skill-docs.
#>
[CmdletBinding()]
param(
  [string]$TargetDir = $(Join-Path $env:USERPROFILE ".gemini\config\plugins\skill-docs"),
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")

$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
  Write-Error "Node.js >= 20 is required. Install Node.js from https://nodejs.org/ and reopen PowerShell."
  exit 1
}

$NodeVersionRaw = (& node -v).Trim()
$Major = [int](($NodeVersionRaw -replace '^v', '').Split('.')[0])
if ($Major -lt 20) {
  Write-Error "Node.js >= 20 is required (found $NodeVersionRaw)."
  exit 1
}

Push-Location $RepoRoot
try {
  $CliPath = Join-Path $RepoRoot "dist\cli.mjs"
  $ServerPath = Join-Path $RepoRoot "dist\server.mjs"
  $AppPath = Join-Path $RepoRoot "dist\app.html"

  if (-not $SkipBuild) {
    if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
      Write-Host "Installing npm dependencies..."
      & npm ci
      if ($LASTEXITCODE -ne 0) {
        & npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
      }
    }
    Write-Host "Building Better-skills-manager..."
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
  } elseif (-not ((Test-Path $CliPath) -and (Test-Path $ServerPath) -and (Test-Path $AppPath))) {
    throw "Build artifacts are missing in dist\. Re-run without -SkipBuild."
  }

  Write-Host "Installing plugin to $TargetDir ..."
  & node $CliPath install --target $TargetDir
  if ($LASTEXITCODE -ne 0) { throw "Plugin install failed." }
}
finally {
  Pop-Location
}
