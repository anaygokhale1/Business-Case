import { buildModuleHref, type ModuleKey } from "./module-registry";

export type NavItem = {
  href: string;
  label: string;
  key: string;
};

export type NavSection = {
  title: string;
  key: string;
  items: NavItem[];
};

// Map each project-modules nav item to (a) the registry module key that owns
// its link shape and (b) the sidebar label + nav key the chrome uses for icons
// and active-state. Hrefs are derived from the registry (single source of
// truth) so the nav links never drift from the switch targets.
//
// To add a module to the nav, add one row here. Do NOT edit the chrome
// components in packages/ui/src/chrome — the nav is data-driven from this list.
const PROJECT_MODULE_NAV: Array<{
  moduleKey: ModuleKey;
  navKey: string;
  label: string;
}> = [
  { moduleKey: "project-overview", navKey: "project-overview", label: "Overview" },
  { moduleKey: "sample-tracker", navKey: "sample-tracker", label: "Sample Tracker" },
  { moduleKey: "project-members", navKey: "project-members-users", label: "Project Setup" }
];

// Second-arg targets kept for signature compatibility with the shell chrome
// (real SSA Pro routes some peer apps by a platform id). Unused in this
// template; PHASE-3 restores it.
export type NavTargets = {
  pmoPlatformProjectId?: string | null;
};

// The sidebar sections. This template has one section: the project modules,
// shown once a project is selected. Leadership/Admin sections from real SSA Pro
// are PHASE-3 and intentionally omitted.
export function getNavSections(projectId?: string | null, _targets: NavTargets = {}): NavSection[] {
  const sections: NavSection[] = [];

  if (projectId) {
    sections.push({
      key: "project-modules",
      title: "Modules",
      items: PROJECT_MODULE_NAV.map((entry) => ({
        key: entry.navKey,
        href: buildModuleHref(entry.moduleKey, projectId),
        label: entry.label
      }))
    });
  }

  return sections;
}
