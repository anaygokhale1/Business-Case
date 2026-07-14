# Wipe and reseed the local database (Windows). Mirrors scripts/reset.sh.
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo
$RepoUrl = $Repo -replace '\\', '/'
if (-not $env:DATABASE_URL) { $env:DATABASE_URL = "file:$RepoUrl/dev.db" }

Write-Host "==> Removing local database"
Remove-Item -Force -ErrorAction SilentlyContinue "$Repo/dev.db", "$Repo/dev.db-journal"

Write-Host "==> Generating Prisma client..."
npm run generate -w '@ssa/db' | Out-Null

Write-Host "==> Applying migrations"
npm run migrate -w '@ssa/db'

Write-Host "==> Seeding synthetic data"
npm run prisma:seed -w '@ssa/shell'

Write-Host ""
Write-Host "Reset complete. The database is back to seed state."
