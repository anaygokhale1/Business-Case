"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { useAccess } from "./access-provider";
import { isSameDemoUserIdentity } from "@ssa/project-context/access-model";
import { PortfolioProject } from "@ssa/project-context/project-portfolio";

// Slim portfolio provider for the template. It loads the synthetic project list
// from /api/portfolio and exposes only what the shell chrome (project switcher,
// module gate, settings "My Projects" tab) reads. The real SSA Pro provider
// also owns per-module domain state; modules in this template own their own
// data through their own API routes instead (see the Sample Tracker module).
type ProjectPortfolioContextValue = {
  projects: PortfolioProject[];
  // visibleProjects drops the acting user's archived memberships from the
  // switcher; allProjects keeps them so the "My Projects" tab can unarchive.
  visibleProjects: PortfolioProject[];
  allProjects: PortfolioProject[];
  getProjectBySlug: (slug: string) => PortfolioProject | undefined;
  isArchived: (slug: string) => boolean;
  archive: (slug: string) => Promise<void>;
  unarchive: (slug: string) => Promise<void>;
};

const ProjectPortfolioContext = createContext<ProjectPortfolioContextValue | null>(null);

export function ProjectPortfolioProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAccess();
  const [projects, setProjects] = useState<PortfolioProject[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadPortfolio() {
      try {
        const response = await fetch("/api/portfolio", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { projects: PortfolioProject[] };
        if (!cancelled) {
          setProjects(Array.isArray(payload.projects) ? payload.projects : []);
        }
      } catch {
        // No portfolio endpoint or a transient failure: keep an empty list so
        // the shell still renders. PHASE-3 wires this to the real portfolio.
      }
    }

    loadPortfolio();

    return () => {
      cancelled = true;
    };
  }, []);

  // Optimistically flip archivedAt locally, then best-effort persist. The
  // template's membership route is a synthetic stub; the UI stays responsive
  // whether or not it succeeds.
  const setArchivedAt = (slug: string, archivedAt: string | null) => {
    setProjects((current) =>
      current.map((project) => (project.slug === slug ? { ...project, archivedAt } : project))
    );
  };

  const patchArchived = async (slug: string, archived: boolean) => {
    setArchivedAt(slug, archived ? new Date().toISOString() : null);
    try {
      await fetch(`/api/projects/${encodeURIComponent(slug)}/membership`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived })
      });
    } catch {
      // Optimistic update already applied; the stub route is best-effort.
    }
  };

  const value = useMemo<ProjectPortfolioContextValue>(() => {
    const mine = projects.filter(
      (project) =>
        isSameDemoUserIdentity(currentUser, project.owner.email) ||
        project.members.some((member) => isSameDemoUserIdentity(currentUser, member.email))
    );

    return {
      projects,
      allProjects: mine,
      visibleProjects: mine.filter((project) => project.archivedAt == null),
      getProjectBySlug: (slug) => projects.find((project) => project.slug === slug),
      isArchived: (slug) => mine.find((project) => project.slug === slug)?.archivedAt != null,
      archive: async (slug) => {
        await patchArchived(slug, true);
      },
      unarchive: async (slug) => {
        await patchArchived(slug, false);
      }
    };
  }, [currentUser, projects]);

  return (
    <ProjectPortfolioContext.Provider value={value}>{children}</ProjectPortfolioContext.Provider>
  );
}

export function useProjectPortfolio() {
  const context = useContext(ProjectPortfolioContext);
  if (!context) {
    throw new Error("useProjectPortfolio must be used within ProjectPortfolioProvider.");
  }
  return context;
}
