"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { buildModuleHref, type ModuleKey } from "@ssa/ui/module-registry";

import { useProjectPortfolio } from "@/components/project-portfolio-provider";

// Maps a per-project module key (camelCase) to its registry route key so the
// Overview can link to enabled modules. Extend this when you add a module.
const MODULE_ROUTE_KEY: Record<string, ModuleKey> = {
  sampleTracker: "sample-tracker"
};

export default function ProjectOverviewPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const { getProjectBySlug } = useProjectPortfolio();
  const project = getProjectBySlug(projectId);

  if (!project) {
    return (
      <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <p className="text-sm text-muted">Project not found.</p>
      </div>
    );
  }

  const enabledModules = project.modules.filter((module) => module.enabled);

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-outline">
          {project.account}
        </p>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">{project.name}</h1>
        {project.insights?.summary?.length ? (
          <ul className="mt-4 space-y-1.5 text-sm text-muted">
            {project.insights.summary.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <h2 className="text-lg font-bold text-ink">Modules</h2>
        {enabledModules.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            No modules enabled. Enable one from{" "}
            <Link className="font-semibold text-ink underline" href={`/projects/${projectId}/members`}>
              Project Setup
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {enabledModules.map((module) => {
              const routeKey = MODULE_ROUTE_KEY[module.key];
              const href = routeKey ? buildModuleHref(routeKey, projectId) : `/projects/${projectId}`;
              return (
                <li key={module.key}>
                  <Link
                    href={href}
                    className="block rounded-[20px] border border-slate-200/70 bg-canvas p-4 transition hover:border-ink/30"
                  >
                    <p className="font-bold text-ink">{module.label}</p>
                    <p className="mt-1 text-xs text-muted">Open module</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
