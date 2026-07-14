# SSA Pro Module Template

A runnable SSA Pro shell for building one module at a time. No business logic ships here; you add it.

## Stack — do not substitute

- Language: TypeScript, end to end.
- UI: Next.js 15 (App Router) + React 19.
- API: Next.js route handlers under `apps/shell/src/app/api`. There is no tRPC.
- Styling: Tailwind CSS 3.
- Storage: Prisma 6 + SQLite.
- Monorepo: Turborepo with npm workspaces. Package manager is npm.

Do not introduce other frameworks, UI kits, ORMs, CSS approaches, or state libraries. If a task seems to need a new dependency, stop and ask. Do not install it. Python belongs only in `/scripts` for data or analysis work, never in app logic. This is a single service. Do not add extra servers.

## Architecture map

- `apps/shell/` — the Next.js app. Dev server runs on http://localhost:3000.
- `apps/shell/src/app/` — routes. `(app)/` group is the authenticated shell; `api/` holds route handlers.
- `apps/shell/src/apps/<module>/` — in-shell modules. You add modules here. The shipped example is `sample-tracker/`.
- `apps/shell/prisma/seed.ts` — the seed script.
- `packages/ui/` — shell chrome (sidebar, header, nav, project switcher, gates). Vendored platform code.
- `packages/project-context/` — shared types, demo users, and the project/module registry data.
- `packages/db/` — Prisma client (`@ssa/db`), `schema.prisma`, and migrations.
- `packages/server/` — server-side access helpers (`@ssa/server`): `requireProjectAccess`, `requireCurrentUser`.
- `scripts/` — `run.sh`, `test.sh`, `reset.sh` (plus `.ps1` Windows equivalents).

## Commands

- Start: `./scripts/run.sh` — installs if needed, generates the Prisma client, runs migrations, seeds if empty, starts the dev server, prints http://localhost:3000. Deterministic and safe to run twice.
- Test: `./scripts/test.sh` — typecheck, lint, and unit tests in one summary line.
- Reset: `./scripts/reset.sh` — deletes the local SQLite db, re-migrates, re-seeds back to synthetic seed state.

Windows: `scripts\run.ps1`, `scripts\test.ps1`, `scripts\reset.ps1`.

Always use the scripts. Never run ad-hoc server commands.

## Working rules

- Plan before non-trivial work and wait for approval.
- Build one vertical slice at a time.
- Run `./scripts/test.sh` after changes and report the result.
- Never mark work done if tests fail or the app does not start.
- Write commit messages in the imperative mood.

## Files not to touch

- `packages/ui/**` is the shell chrome. Add nav through the module registry pattern; never edit chrome components by hand.
- `scripts/run.sh` and `scripts/reset.sh` — ask first before changing them.

## Data rules

- Synthetic data only. No client data, no real names, no real financials, ever.
- No secrets in the repo. Env values go in `.env` (gitignored) and are documented in `.env.example`.
- `DATABASE_URL="file:./dev.db"`.

## Adding a module

Register the module in three namespaces. Nav is data-driven, so do not hand-edit chrome.

1. Route/nav key (kebab-case): add to `ModuleKey` and a `MODULE_REGISTRY` entry in `packages/ui/src/module-registry.ts`.
2. Per-project key (camelCase): add to `ProjectModuleKey` and `createDefaultModules()` in `packages/project-context/src/project-portfolio.ts`.
3. Nav row: add one row to `PROJECT_MODULE_NAV` in `packages/ui/src/route-groups.ts`.

Then create the module folder under `apps/shell/src/apps/<module>/`, mount a route wrapped in `<ModuleGate>`, add API handlers that call `requireProjectAccess` from `@ssa/server` and `prisma` from `@ssa/db`, add the Prisma model, and run `./scripts/reset.sh`. Sample Tracker is the copy-and-adapt reference. See README.md for the full recipe.

## Skills

- `/run-app` — start, stop, or restart the app through the scripts. Never improvise server commands.

## Phase 3 (not yet)

Auth, user management, deployment, a separate database server, and federated modules are out of scope. The app runs as a static "Demo User" (admin) stub; spots where auth belongs are marked with `PHASE-3` comments. If a task seems to need any of these, flag it instead of building it.
