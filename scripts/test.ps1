# Verify the app (Windows). Mirrors scripts/test.sh.
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo
$RepoUrl = $Repo -replace '\\', '/'
if (-not $env:DATABASE_URL) { $env:DATABASE_URL = "file:$RepoUrl/dev.db" }

if (-not (Test-Path node_modules)) {
  Write-Host "==> Installing dependencies (first run)..."
  npm install
}

npm run generate -w '@ssa/db' | Out-Null

Write-Host "==> Typecheck"
npm run typecheck

Write-Host "==> Lint"
npm run lint

Write-Host "==> Unit tests"
npm run test

Write-Host ""
Write-Host "All checks passed: typecheck + lint + tests."
