import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import type { DemoUser } from "@ssa/project-context/access-model";
import type { PortfolioProject } from "@ssa/project-context/project-portfolio";

import { ChromeDataProvider, useChromeData, type ChromeData } from "./chrome-data";

const fixtureUser: DemoUser = {
  id: "u-1",
  name: "Ada Lovelace",
  initials: "AL",
  email: "ada@example.com",
  roleLabel: "Project Member",
  isInternal: true,
  isAdmin: false,
  isLeadership: false,
};

const fixtureProjects: PortfolioProject[] = [
  {
    slug: "apollo-refresh",
    account: "Acme",
    name: "Apollo Refresh",
    endDate: "2026-12-31",
    owner: { initials: "OO", name: "Owner", type: "Owner", email: "o@example.com", access: "Project Owner" },
    modules: [],
    members: [],
    archivedAt: null,
    currentUserRole: "OWNER",
    insights: null,
  } as unknown as PortfolioProject,
];

const fixture: ChromeData = {
  currentUser: fixtureUser,
  canAdmin: true,
  canLeadership: true,
  isInternal: true,
  visibleProjects: fixtureProjects,
  getProjectBySlug: (slug) => fixtureProjects.find((project) => project.slug === slug),
};

describe("useChromeData", () => {
  it("throws when used outside a ChromeDataProvider", () => {
    expect(() => renderHook(() => useChromeData())).toThrow(/ChromeDataProvider/);
  });

  it("returns the exact data object supplied to the provider", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChromeDataProvider data={fixture}>{children}</ChromeDataProvider>
    );
    const { result } = renderHook(() => useChromeData(), { wrapper });
    expect(result.current).toBe(fixture);
    expect(result.current.currentUser.initials).toBe("AL");
    expect(result.current.currentUser.roleLabel).toBe("Project Member");
    expect(result.current.getProjectBySlug("apollo-refresh")?.name).toBe("Apollo Refresh");
  });

  it("imports no next/* specifier in the source module", () => {
    const source = readFileSync(join(__dirname, "chrome-data.tsx"), "utf8");
    expect(/from\s*["']next(?:\/[^"']*)?["']/.test(source)).toBe(false);
  });
});
