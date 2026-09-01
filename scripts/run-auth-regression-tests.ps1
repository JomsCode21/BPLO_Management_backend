$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$tsxPath = Join-Path $workspace "node_modules\.bin\tsx.cmd"

if (-not (Test-Path -LiteralPath $tsxPath)) {
  throw "tsx executable not found at $tsxPath"
}

Set-Location $workspace

& $tsxPath --env-file .env src/tests/auth-regression.test.ts
exit $LASTEXITCODE
