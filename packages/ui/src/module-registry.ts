import type { ProjectModuleKey } from "@ssa/project-context/project-portfolio";

// Single source of truth for the project module link shapes. Both the nav
// (route-groups) and the project switcher derive their hrefs and active-state
// from this table so link shapes never drift. `match` recognizes a pathname and
// captures the slug in group 1; `requiresModule` gates the entry against the
// project's enabled modules (null = always available); `external` flags peer
// apps served from a separate origin that need a hard cross-zone navigation
// (none in this template — that is a PHASE-3 concern).
//
// To add a module: add its key to ModuleKey and a MODULE_REGISTRY entry here,
// then a PROJECT_MODULE_NAV row in route-groups.ts and the camelCase key in
// packages/project-context/src/project-portfolio.ts. See the README.
export type ModuleKey = "project-overview" | "sample-tracker" | "project-members";

export type ModuleEntry = {
  key: ModuleKey;
  href: (slug: string) => string;
  match: RegExp; // captures slug in group 1
  requiresModule: ProjectModuleKey | null; // gate against PortfolioProject.modules
  external: boolean; // true => hard cross-origin navigation
};

// Display order drives nav item order. The overview `match` is anchored with
// /?$ and evaluated LAST so /projects/<slug>/members classifies as
// project-members, not overview.
export const MODULE_REGISTRY: ModuleEntry[] = [
  {
    key: "project-overview",
    href: (slug) => `/projects/${slug}`,
    match: /^\/projects\/([^/]+)\/?$/,
    requiresModule: null,
    external: false
  },
  {
    key: "sample-tracker",
    // In-shell, same-origin module mounted under (app)/apps/sample-tracker/.
    // The /apps/sample-tracker prefix is kept in the URL and made OPTIONAL in
    // the matcher so both the full path and a stripped path resolve. Anchored
    // to the /sample-tracker segment so it cannot shadow overview or members.
    href: (slug) => `/apps/sample-tracker/projects/${slug}/sample-tracker`,
    match: /^(?:\/apps\/sample-tracker)?\/projects\/([^/]+)\/sample-tracker(?:\/|$)/,
    requiresModule: "sampleTracker",
    external: false
  },
  {
    key: "project-members",
    href: (slug) => `/projects/${slug}/members`,
    match: /^\/projects\/([^/]+)\/members/,
    requiresModule: null,
    external: false
  }
];

// Match-evaluation order: everything except overview first, then overview last,
// so /projects/<slug>/members is captured by the members entry.
const MATCH_ORDER: ModuleEntry[] = [
  ...MODULE_REGISTRY.filter((entry) => entry.key !== "project-overview"),
  ...MODULE_REGISTRY.filter((entry) => entry.key === "project-overview")
];

// Extract the project slug from any shape; null when the pathname is not a
// project-scoped route.
export function getCurrentSlug(pathname: string): string | null {
  for (const entry of MATCH_ORDER) {
    const captured = entry.match.exec(pathname);
    if (captured) {
      return captured[1] ?? null;
    }
  }
  return null;
}

// Classify a pathname to its module key, defaulting to project-overview.
export function getCurrentModuleKey(pathname: string): ModuleKey {
  for (const entry of MATCH_ORDER) {
    if (entry.match.test(pathname)) {
      return entry.key;
    }
  }
  return "project-overview";
}

// Build the canonical href for a module key + slug.
export function buildModuleHref(key: ModuleKey, slug: string): string {
  const entry = MODULE_REGISTRY.find((candidate) => candidate.key === key);
  if (!entry) {
    return `/projects/${slug}`;
  }
  return entry.href(slug);
}
