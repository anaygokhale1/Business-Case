# Start the app (Windows). Mirrors scripts/run.sh.
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo
$RepoUrl = $Repo -replace '\\', '/'
if (-not $env:DATABASE_URL) { $env:DATABASE_URL = "file:$RepoUrl/dev.db" }

if (-not (Test-Path node_modules)) {
  Write-Host "==> Installing dependencies (first run)..."
  npm install
}

Write-Host "==> Generating Prisma client..."
npm run generate -w '@ssa/db' | Out-Null

Write-Host "==> Applying database migrations..."
npm run migrate -w '@ssa/db'

Write-Host "==> Seeding synthetic data (idempotent)..."
npm run prisma:seed -w '@ssa/shell'

Write-Host ""
Write-Host "==> Starting dev server on http://localhost:3000 (Ctrl-C to stop)"
npm run dev -w '@ssa/shell'
