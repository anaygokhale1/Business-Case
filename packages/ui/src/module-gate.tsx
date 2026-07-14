"use client";

import { useProjectPortfolio } from "./project-portfolio-provider";
import { useAccess } from "./access-provider";

export function ModuleGate({
  projectId,
  moduleKey,
  children,
}: {
  projectId: string;
  moduleKey: string;
  children: React.ReactNode;
}) {
  const { projects } = useProjectPortfolio();
  const { currentUser } = useAccess();
  const project = projects.find((p) => p.slug === projectId);
  const module = project?.modules.find((m) => m.key === moduleKey);
  const isEnabled = module?.enabled ?? false;

  if (!isEnabled) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center rounded-[28px] bg-white p-10 shadow-ambient ring-1 ring-slate-200/70">
        <div className="text-center">
          <span className="material-symbols-outlined text-5xl text-slate-300">block</span>
          <p className="mt-4 text-sm font-medium text-slate-500">
            This module is not enabled. To enable, go to the{" "}
            <strong className="text-slate-700">Project Modules Overview</strong> section.
          </p>
        </div>
      </div>
    );
  }

  if (!currentUser.isInternal && !module?.externalAccess) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center rounded-[28px] bg-white p-10 shadow-ambient ring-1 ring-slate-200/70">
        <div className="text-center">
          <span className="material-symbols-outlined text-5xl text-slate-300">lock</span>
          <p className="mt-4 text-sm font-medium text-slate-500">
            External access is not enabled for this module.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
