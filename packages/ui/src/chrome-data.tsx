import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { DemoUser } from "@ssa/project-context/access-model";
import type { PortfolioProject } from "@ssa/project-context/project-portfolio";

// The read-only data the shared chrome (AppShell, ProjectSwitcher) consumes.
// Mirrors the RouterAdapter seam: chrome reads its DATA through an injected
// context the same way it reads NAVIGATION, so any host (shell, PMO Vite, PIQ
// Vite) supplies the values it already holds without the shell-coupled
// useAccess()/useProjectPortfolio() providers. Type-only imports keep this
// module free of provider values and next/*, preserving the Vite-safe entry.
export interface ChromeData {
  // Full DemoUser: AppShell renders .initials/.name/.roleLabel; the shell's
  // useAccess().currentUser already IS a DemoUser, so its adapter passes through.
  currentUser: DemoUser;
  canAdmin: boolean;
  canLeadership: boolean;
  isInternal: boolean;
  visibleProjects: PortfolioProject[];
  getProjectBySlug: (slug: string) => PortfolioProject | undefined;
}

const ChromeDataContext = createContext<ChromeData | null>(null);

export function ChromeDataProvider({
  data,
  children,
}: {
  data: ChromeData;
  children: ReactNode;
}) {
  return (
    <ChromeDataContext.Provider value={data}>
      {children}
    </ChromeDataContext.Provider>
  );
}

export function useChromeData(): ChromeData {
  const data = useContext(ChromeDataContext);
  if (data === null) {
    throw new Error(
      "useChromeData must be used within a <ChromeDataProvider>. " +
        "Wrap the chrome root with <ChromeDataProvider data={...}> and supply " +
        "the read-only ChromeData (currentUser, canAdmin, canLeadership, " +
        "isInternal, visibleProjects, getProjectBySlug) the host already holds.",
    );
  }
  return data;
}
