#!/usr/bin/env bash
# Wipe the local database and rebuild it from migrations + synthetic seed.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
export DATABASE_URL="${DATABASE_URL:-file:$REPO/dev.db}"

echo "==> Removing local database"
rm -f "$REPO/dev.db" "$REPO/dev.db-journal"

echo "==> Generating Prisma client..."
npm run generate -w @ssa/db >/dev/null

echo "==> Applying migrations"
npm run migrate -w @ssa/db

echo "==> Seeding synthetic data"
npm run prisma:seed -w @ssa/shell

echo ""
echo "Reset complete. The database is back to seed state."
