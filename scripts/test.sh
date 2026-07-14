#!/usr/bin/env bash
# Verify the app: typecheck, lint, and run unit tests. Prints one summary line.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
export DATABASE_URL="${DATABASE_URL:-file:$REPO/dev.db}"

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (first run)..."
  npm install
fi

# The Prisma client must exist for @ssa/db types to resolve during typecheck.
npm run generate -w @ssa/db >/dev/null

echo "==> Typecheck"
npm run typecheck

echo "==> Lint"
npm run lint

echo "==> Unit tests"
npm run test

echo ""
echo "All checks passed: typecheck + lint + tests."
