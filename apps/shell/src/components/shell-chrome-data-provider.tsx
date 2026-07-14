"use client";

import { ReactNode, useMemo } from "react";

import { AppShell } from "@ssa/ui/app-shell";
import { ChromeDataProvider, type ChromeData } from "@ssa/ui/chrome-data";
import SettingsModal from "@ssa/ui/settings-modal";

import { useAccess } from "@/components/access-provider";
import { useProjectPortfolio } from "@/components/project-portfolio-provider";

// Shell adapter: maps the shell's useAccess() + useProjectPortfolio() providers
// to the read-only ChromeData the shared chrome consumes, and renders the
// SettingsModal through AppShell's settings render-prop slot.
export function ShellChromeDataProvider({ children }: { children: ReactNode }) {
  const { currentUser, canAdmin, canLeadership, isInternal } = useAccess();
  const { visibleProjects, getProjectBySlug } = useProjectPortfolio();

  const data = useMemo<ChromeData>(
    () => ({
      currentUser,
      canAdmin,
      canLeadership,
      isInternal,
      visibleProjects,
      getProjectBySlug
    }),
    [currentUser, canAdmin, canLeadership, isInternal, visibleProjects, getProjectBySlug]
  );

  return (
    <ChromeDataProvider data={data}>
      <AppShell settings={({ open, onClose }) => <SettingsModal open={open} onClose={onClose} />}>
        {children}
      </AppShell>
    </ChromeDataProvider>
  );
}
