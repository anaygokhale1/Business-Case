"use client";

import { useParams } from "next/navigation";

import { useProjectPortfolio } from "@/components/project-portfolio-provider";

// "Project Setup": project members and module enablement. In this template the
// project + module data is synthetic and read-only. PHASE-3 makes membership and
// the module toggles writable (persisted via /api/projects/[slug]/modules).
export default function ProjectMembersPage() {
  const params = useParams<{ projectId: string }>();
  const { getProjectBySlug } = useProjectPortfolio();
  const project = getProjectBySlug(params.projectId);

  if (!project) {
    return (
      <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <p className="text-sm text-muted">Project not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <h1 className="text-2xl font-extrabold text-ink">Project Setup</h1>
        <p className="mt-1 text-sm text-muted">{project.name}</p>

        <h2 className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-outline">Members</h2>
        <ul className="mt-3 divide-y divide-slate-200/70">
          {project.members.map((member) => (
            <li key={member.email} className="flex items-center gap-3 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#DDE6FF] text-xs font-extrabold text-ink">
                {member.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{member.name}</span>
                <span className="block truncate text-xs text-muted">{member.email}</span>
              </span>
              <span className="text-xs font-semibold text-outline">{member.type}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-outline">Modules</h2>
        <ul className="mt-3 divide-y divide-slate-200/70">
          {project.modules.map((module) => (
            <li key={module.key} className="flex items-center justify-between py-3">
              <span className="text-sm font-semibold text-ink">{module.label}</span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  module.enabled ? "bg-[#E4F5EF] text-teal" : "bg-panel text-outline"
                }`}
              >
                {module.enabled ? "Enabled" : "Disabled"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          Module toggles are read-only in this template (PHASE-3 persists them).
        </p>
      </div>
    </div>
  );
}
