# SSA Pro Module Template

This is a training template. Clone it, run one script, and you get the SSA Pro shell with a working example module. You build your Phase 2 module inside it.

The shell handles the platform parts already: navigation, the project switcher, per-project module gating, a Prisma/SQLite database, and a static demo user. Your job is to add one module that does real work, following the patterns the example module demonstrates.

## What Phase 2 asks you to build

Build one module, spec-driven, through the agent loop. Write a spec (see "Your module spec" below), then work with the agent to implement it as a single vertical slice: a data model, a UI, a route, and an API. The example module is the reference for how the pieces fit together.

## Setup and first run

1. On GitHub, click "Use this template" to create your own repo, then clone it.
2. Run `./scripts/run.sh`. It installs dependencies if needed, generates the Prisma client, runs migrations, seeds the database if empty, and starts the dev server.
3. Open http://localhost:3000.

The script is deterministic and safe to run twice. On Windows, run `scripts\run.ps1` instead.

![Shell screenshot](docs/screenshot-placeholder.png)

Replace the placeholder above with a real screenshot of your running shell.

## The reference vertical slice

The shipped example is Sample Tracker (module key `sampleTracker`, route key `sample-tracker`). It is a project-scoped in-shell module that lists synthetic sample items in a sortable table and lets you add one, persisted to SQLite. Read its files in this order:

1. `packages/db/prisma/schema.prisma` — the `SampleItem` model. Start with the data.
2. `apps/shell/src/apps/sample-tracker/` — the module UI: the workspace component, the sort hook, and the sort util with its unit test.
3. `apps/shell/src/app/(app)/apps/sample-tracker/projects/[projectId]/sample-tracker/page.tsx` — the route, wrapped in `<ModuleGate>`.
4. `apps/shell/src/app/api/apps/sample-tracker/projects/[projectSlug]/items/route.ts` — the API (GET and POST) using `prisma` from `@ssa/db` and `requireProjectAccess` from `@ssa/server`.
5. The registration entries, described next.

## How to add a page or module

Real SSA Pro names a module in three namespaces: `PlatformModule` (Postgres DB enum, UPPER_SNAKE), `ProjectModuleKey` (per-project toggle, camelCase), and `ModuleKey` (nav/routing, kebab-case). This template implements the last two. It has no `PlatformModule` enum because SQLite has no Prisma enums, so module enablement here is static seed data; you add that value only when the module moves to the real platform (see the next section).

Register the module (nav is data-driven, so do not hand-edit the shell chrome):

1. Route/nav key (kebab-case): add it to `ModuleKey` and a `MODULE_REGISTRY` entry in `packages/ui/src/module-registry.ts` (href, match regex, `requiresModule`).
2. Per-project key (camelCase): add it to `ProjectModuleKey` and to `createDefaultModules()` in `packages/project-context/src/project-portfolio.ts`.
3. Nav row: add one row to `PROJECT_MODULE_NAV` in `packages/ui/src/route-groups.ts` (`moduleKey`, `navKey`, `label`).

Then:

- Create the module folder under `apps/shell/src/apps/<module>/`.
- Mount a route under `apps/shell/src/app/(app)/apps/<module>/...`, wrapped in `<ModuleGate projectId moduleKey="<camelKey>">`.
- Add API handlers under `apps/shell/src/app/api/apps/<module>/...` that call `requireProjectAccess(slug, "<camelKey>")` from `@ssa/server/access-service` and use `prisma` from `@ssa/db`.
- Add the Prisma model to `packages/db/prisma/schema.prisma`.
- Run `./scripts/reset.sh` to apply the schema change and re-seed.

Copy Sample Tracker and adapt it. It exercises every one of these steps.

## Moving your module to real SSA Pro

The layout and call shapes here match the real platform, so a module carries over with two additions: add its `PlatformModule` enum value (UPPER_SNAKE) to the real Postgres schema, and convert any `String` status columns to the platform's Prisma enums. The platform provides auth, audit, and AI wiring through `@ssa/server` and `@ssa/ai-client`; follow the platform's INTEGRATION-PLAYBOOK when you land the module.

## Your module spec

Fill this in before you write code.

- Operator: who uses this module and in what role.
- Job: the task they are trying to finish.
- Screens: the views the module needs.
- Inputs/Outputs: what data goes in, what the module produces or stores.
- Acceptance criteria: how you know the module is done and correct.

## Known limits (intentionally missing)

The following are Phase 3 and deliberately absent:

- Auth. The app runs as a static "Demo User" (admin) stub. Spots where auth belongs are marked with `PHASE-3` comments. Do not add login.
- Deployment. This template runs locally only.
- Federated modules and a separate database server.

If your module seems to need any of these, flag it rather than build it.
