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

Real SSA Pro names a module in three namespaces: `PlatformModule` (Postgres DB enum, UPPER_SNAKE), `ProjectModuleKey` (per-project toggle, camelCase), and `ModuleKey` (nav/routing, kebab-case). This template implements the last two. It has no `PlatformModule` enum because SQLite has no Prisma enums, so module enablement here is static seed data — you add the `PlatformModule` value only when the module lands on the real platform (see "Moving a module").

Steps (nav is data-driven, so never hand-edit chrome):

1. `ModuleKey` (kebab-case): add it plus a `MODULE_REGISTRY` entry (href, match, `requiresModule`) in `packages/ui/src/module-registry.ts`.
2. `ProjectModuleKey` (camelCase): add it plus a `createDefaultModules()` entry in `packages/project-context/src/project-portfolio.ts`.
3. Nav row: add one `PROJECT_MODULE_NAV` row (`moduleKey`, `navKey`, `label`) in `packages/ui/src/route-groups.ts`.
4. Create `apps/shell/src/apps/<module>/` (components, hooks, lib).
5. Mount a route at `apps/shell/src/app/(app)/apps/<module>/...` wrapped in `<ModuleGate projectId moduleKey="<camelKey>">`.
6. Add API handlers at `apps/shell/src/app/api/apps/<module>/...` that call `requireProjectAccess(slug, "<camelKey>")` from `@ssa/server/access-service` and use `prisma` from `@ssa/db`.
7. Add the Prisma model to `packages/db/prisma/schema.prisma`, then run `./scripts/reset.sh`.

Sample Tracker exercises every step — copy and adapt it. See README.md for the full walkthrough.

## Conventions

- Surgical edits. Change what the task needs; no whole-file rewrites or opportunistic refactors.
- Modules never run their own login. Identity and access come from `@ssa/server` (`requireProjectAccess`, `requireCurrentUser`).
- Files under `apps/shell/src/components` that read `export * from "@ssa/…"` are re-export shims. Edit the package, not the shim.
- SQLite has no enums or scalar lists. Use `String` columns (see `SampleItem.category`), not Prisma `enum` types.

## Moving a module to real SSA Pro

The folder layout, registry, nav, `ModuleGate`, `@ssa/db`, and `@ssa/server/access-service` call shapes match the real platform, so a module built here carries over with two additions: add its `PlatformModule` enum value (UPPER_SNAKE) to the real Postgres schema, and map any `String` status columns to the platform's Prisma enums. Auth, audit, and AI wiring are provided by the platform — see its INTEGRATION-PLAYBOOK.

## Skills

- `/run-app` — start, stop, or restart the app through the scripts. Never improvise server commands.

## Phase 3 (not yet)

Auth, user management, deployment, a separate database server, and federated modules are out of scope. The app runs as a static "Demo User" (admin) stub; spots where auth belongs are marked with `PHASE-3` comments. If a task seems to need any of these, flag it instead of building it.
