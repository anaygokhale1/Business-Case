---
name: run-app
description: Use when starting, stopping, or restarting this app's dev server. Always use the repo scripts, never ad-hoc next/npm commands.
---

# run-app

Run the SSA Pro shell through the repo scripts. The scripts guarantee the database is migrated, seeded, and the client rebuilt, so "I changed code and nothing happened" bugs do not occur. Never run `next dev` or `npm run dev` directly.

## Start

Run `./scripts/run.sh`. It installs dependencies if needed, generates the Prisma client, runs migrations, seeds the database if empty, starts the dev server, and prints http://localhost:3000. It is deterministic and safe to run twice.

Windows: `scripts\run.ps1`.

## Stop

Press Ctrl-C in the terminal running the server. If it is running in the background, kill the dev process.

## Restart

Stop the server, then run `./scripts/run.sh` again.

## Reset data

Run `./scripts/reset.sh` to delete the local SQLite db, re-migrate, and re-seed back to synthetic seed state. Windows: `scripts\reset.ps1`.
