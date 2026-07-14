"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useChromeData } from "../chrome-data";
import {
  MODULE_REGISTRY,
  buildModuleHref,
  getCurrentModuleKey,
  getCurrentSlug,
} from "../module-registry";
import { useRouterAdapter } from "../router-adapter";

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-outline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// `crossZone` is set when the shared chrome renders inside a peer app (RT/EC),
// which has a Next basePath. There, a soft navigation prepends that basePath
// and 404s on shell routes (/projects, /admin, ...). In cross-zone mode every
// destination is a hard browser navigation (navigate(href, { hard: true })),
// which resolves against the shell origin and ignores the peer basePath.
export function ProjectSwitcher({ crossZone = false }: { crossZone?: boolean }) {
  const { Link, usePathname, navigate } = useRouterAdapter();
  const pathname = usePathname();
  const { isInternal, visibleProjects, getProjectBySlug } = useChromeData();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) {
      return;
    }
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Non-archived projects only (visibleProjects already excludes the acting
  // user's archived memberships; keep the guard explicit per the design).
  const projects = useMemo(
    () => visibleProjects.filter((project) => project.archivedAt == null),
    [visibleProjects]
  );

  const currentSlug = getCurrentSlug(pathname);
  const currentProject = currentSlug ? getProjectBySlug(currentSlug) : undefined;

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) {
      return projects;
    }
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(normalized) ||
        project.account.toLowerCase().includes(normalized)
    );
  }, [projects, search]);

  // Module-preserving switch: keep the current module on the target project when
  // it has that module enabled; otherwise fall back to Overview. /apps/* targets
  // are hard navigations (a soft transition 404s the peer-zone chunk).
  function switchToProject(nextSlug: string) {
    setOpen(false);

    const targetProject = getProjectBySlug(nextSlug);
    let key = getCurrentModuleKey(pathname);
    const entry = MODULE_REGISTRY.find((candidate) => candidate.key === key);

    if (entry?.requiresModule) {
      const hasModule = !!targetProject?.modules.find(
        (module) => module.key === entry.requiresModule && module.enabled
      );
      if (!hasModule) {
        key = "project-overview";
      }
    }

    const targetEntry = MODULE_REGISTRY.find((candidate) => candidate.key === key);
    const href = buildModuleHref(key, nextSlug);

    navigate(href, { hard: crossZone || targetEntry?.external });
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label="Project switcher"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-ink transition hover:bg-panel"
      >
        <span className="truncate">{currentProject?.name ?? "Select a project"}</span>
        <ChevronDownIcon />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
        >
          <div className="border-b border-slate-100 p-2">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search projects..."
              className="w-full rounded-lg bg-panel px-3 py-2 text-sm outline-none placeholder:text-slate-400"
            />
          </div>

          <ul className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-slate-400">No matching projects.</li>
            ) : (
              filtered.map((project) => (
                <li key={project.slug}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={project.slug === currentSlug}
                    onClick={() => switchToProject(project.slug)}
                    className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition hover:bg-panel ${
                      project.slug === currentSlug ? "bg-[#EAF0FA]" : ""
                    }`}
                  >
                    <span className="truncate text-sm font-bold text-slate-800">{project.name}</span>
                    <span className="truncate text-xs text-slate-500">{project.account}</span>
                  </button>
                </li>
              ))
            )}
          </ul>

          {isInternal ? (
            <div className="border-t border-slate-100 p-1">
              {crossZone ? (
                <a
                  href="/projects/new"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-[#0038A8] transition hover:bg-blue-50"
                >
                  <span aria-hidden="true">+</span> New project
                </a>
              ) : (
                <Link
                  href="/projects/new"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-[#0038A8] transition hover:bg-blue-50"
                >
                  <span aria-hidden="true">+</span> New project
                </Link>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ProjectSwitcher;
