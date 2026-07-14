// Demo identity model for the template. There is no auth here: the shell runs
// with a static Demo User (see apps/shell/src/lib/auth/session.ts). These demo
// users only drive the user card, the access gates, and member pickers. All
// data is synthetic — PHASE-3 replaces this with real users + sessions.

const INTERNAL_DOMAIN = "example.com";

export type DemoUser = {
  id: string;
  name: string;
  initials: string;
  email: string;
  roleLabel: string;
  isInternal: boolean;
  isAdmin: boolean;
  isLeadership: boolean;
};

export const demoUsers: DemoUser[] = [
  {
    id: "demo",
    name: "Demo User",
    initials: "DU",
    email: "demo@example.com",
    roleLabel: "Admin",
    isInternal: true,
    isAdmin: true,
    isLeadership: true
  },
  {
    id: "sam",
    name: "Sam Rivera",
    initials: "SR",
    email: "srivera@example.com",
    roleLabel: "Project Member",
    isInternal: true,
    isAdmin: false,
    isLeadership: false
  },
  {
    id: "jordan",
    name: "Jordan Lee",
    initials: "JL",
    email: "jlee@example.com",
    roleLabel: "Leadership",
    isInternal: true,
    isAdmin: false,
    isLeadership: true
  }
];

export function canAccessAdmin(user: DemoUser) {
  return user.isAdmin;
}

export function canAccessLeadership(user: DemoUser) {
  return user.isAdmin || user.isLeadership;
}

export function canCreateProject(user: DemoUser) {
  return user.isInternal;
}

export function corporateEmailFromName(name: string) {
  const parts = name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  const firstInitial = parts[0][0] ?? "";
  const lastName = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return `${firstInitial}${lastName}@${INTERNAL_DOMAIN}`;
}

export function dottedCorporateEmailFromName(name: string) {
  return `${name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(".")}@${INTERNAL_DOMAIN}`;
}

export function getInternalEmailAliases(user: DemoUser) {
  if (!user.isInternal) {
    return [user.email.toLowerCase()];
  }

  return Array.from(
    new Set([
      user.email.toLowerCase(),
      corporateEmailFromName(user.name).toLowerCase(),
      dottedCorporateEmailFromName(user.name).toLowerCase()
    ])
  );
}

export function findDemoUserByIdentifier(identifier: string) {
  const normalized = identifier.trim().toLowerCase();

  return demoUsers.find(
    (user) =>
      user.id === normalized ||
      user.name.toLowerCase() === normalized ||
      getInternalEmailAliases(user).includes(normalized)
  );
}

export function isSameDemoUserIdentity(user: DemoUser, candidate: string) {
  const normalized = candidate.trim().toLowerCase();
  return (
    user.name.toLowerCase() === normalized ||
    user.id === normalized ||
    getInternalEmailAliases(user).includes(normalized)
  );
}
