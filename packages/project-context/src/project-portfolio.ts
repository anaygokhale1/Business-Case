// Generic project + module model for the template. In real SSA Pro this file
// carries the platform's module catalog; here it is stripped to ONE example
// module ("Sample Tracker") so the shape and the registration pattern are
// visible without any business logic. All projects/members below are synthetic.
//
// To add a module you extend ProjectModuleKey + createDefaultModules() here,
// then MODULE_REGISTRY (packages/ui/src/module-registry.ts) and
// PROJECT_MODULE_NAV (packages/ui/src/route-groups.ts). See the README.

// camelCase per-project module key (the "enabled?" toggle namespace).
export type ProjectModuleKey = "sampleTracker";

export type ProjectMember = {
  userId?: string;
  initials: string;
  name: string;
  type: "Owner" | "Internal" | "External";
  email: string;
  access: string;
  inviteStatus?: "Active" | "Pending Invite";
};

export type ProjectModuleState = {
  key: ProjectModuleKey;
  label: string;
  enabled: boolean;
  externalAccess: boolean;
  completion: string;
  progressLabel: string;
  href: string;
};

export type PortfolioProject = {
  id: string;
  slug: string;
  account: string;
  name: string;
  endDate: string;
  startDate?: string;
  owner: ProjectMember;
  ownerUserId?: string;
  modules: ProjectModuleState[];
  members: ProjectMember[];
  // Acting user's own membership state. UX-only hints; every write re-checks
  // authorization server-side (PHASE-3 makes these real).
  archivedAt: string | null;
  currentUserRole: string;
  insights: { summary: string[] } | null;
};

export function createDefaultModules(): ProjectModuleState[] {
  return [
    {
      key: "sampleTracker",
      label: "Sample Tracker",
      enabled: false,
      externalAccess: false,
      completion: "",
      progressLabel: "",
      href: "sample-tracker"
    }
  ];
}

// Two synthetic projects. The Sample Tracker module is enabled on the first so
// the reference slice is reachable from a fresh clone.
export const defaultProjects: PortfolioProject[] = [
  {
    id: "northwind-rollout",
    slug: "northwind-rollout",
    account: "Northwind Trading",
    name: "Northwind Rollout",
    endDate: "Dec 15, 2026",
    startDate: "Jan 6, 2026",
    ownerUserId: "demo",
    owner: {
      userId: "demo",
      initials: "DU",
      name: "Demo User",
      type: "Owner",
      email: "demo@example.com",
      access: "All Modules"
    },
    modules: [
      {
        key: "sampleTracker",
        label: "Sample Tracker",
        enabled: true,
        externalAccess: false,
        completion: "",
        progressLabel: "",
        href: "sample-tracker"
      }
    ],
    members: [
      {
        userId: "demo",
        initials: "DU",
        name: "Demo User",
        type: "Owner",
        email: "demo@example.com",
        access: "All Modules"
      },
      {
        userId: "sam",
        initials: "SR",
        name: "Sam Rivera",
        type: "Internal",
        email: "srivera@example.com",
        access: "All Modules"
      }
    ],
    archivedAt: null,
    currentUserRole: "OWNER",
    insights: {
      summary: [
        "Sample Tracker is enabled for this project.",
        "Open it from the Modules nav to see the reference vertical slice."
      ]
    }
  },
  {
    id: "globex-migration",
    slug: "globex-migration",
    account: "Globex",
    name: "Globex Migration",
    endDate: "Mar 30, 2027",
    startDate: "Feb 2, 2026",
    ownerUserId: "jordan",
    owner: {
      userId: "jordan",
      initials: "JL",
      name: "Jordan Lee",
      type: "Owner",
      email: "jlee@example.com",
      access: "All Modules"
    },
    modules: [
      {
        key: "sampleTracker",
        label: "Sample Tracker",
        enabled: false,
        externalAccess: false,
        completion: "",
        progressLabel: "",
        href: "sample-tracker"
      }
    ],
    members: [
      {
        userId: "jordan",
        initials: "JL",
        name: "Jordan Lee",
        type: "Owner",
        email: "jlee@example.com",
        access: "All Modules"
      },
      {
        userId: "demo",
        initials: "DU",
        name: "Demo User",
        type: "Internal",
        email: "demo@example.com",
        access: "All Modules"
      }
    ],
    archivedAt: null,
    currentUserRole: "MEMBER",
    insights: {
      summary: [
        "Sample Tracker is disabled for this project.",
        "Enable it from Project Setup to try the module toggle."
      ]
    }
  }
];

export function slugifyProjectName(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function initialsFromName(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "NA";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isInternalEmail(value: string) {
  return value.trim().toLowerCase().endsWith("@example.com");
}
