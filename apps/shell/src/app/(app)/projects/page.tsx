"use client";

import Link from "next/link";

import { useProjectPortfolio } from "@/components/project-portfolio-provider";

// Landing page: the acting user's projects. Selecting one opens its Overview,
// where the enabled modules (including the Sample Tracker example) are reachable
// from the left-nav.
export default function ProjectsPage() {
  const { visibleProjects } = useProjectPortfolio();

  return (
    <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Projects</h1>
          <p className="mt-1 text-sm text-muted">Pick a project to open its modules.</p>
        </div>
        <Link
          href="/projects/new"
          className="rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90"
        >
          + New project
        </Link>
      </div>

      {visibleProjects.length === 0 ? (
        <p className="text-sm text-muted">No projects yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {visibleProjects.map((project) => (
            <li key={project.slug}>
              <Link
                href={`/projects/${project.slug}`}
                className="block rounded-[24px] border border-slate-200/70 bg-canvas p-5 transition hover:border-ink/30 hover:shadow-ambient"
              >
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-outline">
                  {project.account}
                </p>
                <p className="mt-1 text-lg font-bold text-ink">{project.name}</p>
                <p className="mt-3 text-xs text-muted">
                  {project.modules.filter((module) => module.enabled).length} module(s) enabled ·
                  ends {project.endDate}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
