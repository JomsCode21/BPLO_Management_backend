$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$tmpPath = Join-Path $workspace ".tmp-tests"
$compiledTestPath = Join-Path $tmpPath "tests/main-treasurer-payment-confirmation.test.js"
$exitCode = 0

Set-Location $workspace

if (Test-Path -LiteralPath $tmpPath) {
  Remove-Item -LiteralPath $tmpPath -Recurse -Force
}

try {
  & tsc `
    --module commonjs `
    --target es2020 `
    --esModuleInterop `
    --skipLibCheck `
    --rootDir src `
    --outDir $tmpPath `
    src/tests/main-treasurer-payment-confirmation.test.ts

  if ($LASTEXITCODE -ne 0) {
    $exitCode = $LASTEXITCODE
  } else {
    & node $compiledTestPath
    $exitCode = $LASTEXITCODE
  }
} finally {
  if (Test-Path -LiteralPath $tmpPath) {
    Remove-Item -LiteralPath $tmpPath -Recurse -Force
  }
}

exit $exitCode
