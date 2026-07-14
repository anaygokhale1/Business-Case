"use client";

import { useRouterAdapter } from "../router-adapter";

// Generic per-project sub-nav. This component is not mounted by the shell in
// the template (the sidebar nav is data-driven from route-groups); it is kept
// as part of the chrome package for parity. Links point at the example module.
const buildProjectLinks = (projectId: string) => [
  { href: `/projects/${projectId}`, label: "Overview" },
  { href: `/apps/sample-tracker/projects/${projectId}/sample-tracker`, label: "Sample Tracker" },
  { href: `/projects/${projectId}/members`, label: "Members" },
  { href: `/projects/${projectId}/settings`, label: "Settings" }
];

export function ProjectNav({ projectId }: { projectId: string }) {
  const { Link } = useRouterAdapter();
  return (
    <div className="rounded-[24px] bg-panel/95 p-3 ring-1 ring-slate-200/60">
      <div className="flex flex-wrap gap-2">
        {buildProjectLinks(projectId).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-2xl bg-card px-4 py-2 text-sm font-medium text-muted shadow-sm transition hover:text-ink"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
