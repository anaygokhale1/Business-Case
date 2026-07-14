"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";

import { useChromeData } from "../chrome-data";
import { getCurrentModuleKey, getCurrentSlug } from "../module-registry";
import { getNavSections, NavItem } from "../route-groups";
import { useRouterAdapter } from "../router-adapter";
import { NavigationProgress } from "./navigation-progress";
import { ProjectSwitcher } from "./project-switcher";

const SIDEBAR_STORAGE_KEY = "ssa-sidebar-collapsed";

function GridIcon() {
  return (
    <svg aria-hidden="true" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg aria-hidden="true" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="8" y="3" width="8" height="4" rx="1.5" />
      <path d="M8 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg aria-hidden="true" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="3.5" />
      <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a3.5 3.5 0 0 1 0 6.74" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function getItemIcon(key: string) {
  switch (key) {
    case "my-projects":
      return <GridIcon />;
    case "project-overview":
      return <EyeIcon />;
    case "sample-tracker":
      return <ClipboardIcon />;
    case "project-members-users":
      return <UsersIcon />;
    default:
      return <GridIcon />;
  }
}

// Maps a module-registry ModuleKey to the nav item key used for icon + active
// state. The members entry keeps its historical nav key. Add a row when you
// register a new module so its nav item highlights on its routes.
const MODULE_KEY_TO_NAV_KEY: Record<string, string> = {
  "project-overview": "project-overview",
  "sample-tracker": "sample-tracker",
  "project-members": "project-members-users"
};

function getCurrentKey(pathname: string) {
  if (pathname === "/projects" || pathname === "/projects/new") return "my-projects";
  if (pathname.startsWith("/leadership-dashboard")) return "leadership-dashboard";
  if (pathname.startsWith("/admin")) return "admin-console";

  // Project-scoped pages (including the /apps/* peer zones) resolve through the
  // registry so the active nav item matches the switch target.
  if (getCurrentSlug(pathname)) {
    return MODULE_KEY_TO_NAV_KEY[getCurrentModuleKey(pathname)] ?? "my-projects";
  }

  return "my-projects";
}

function NavLink({
  item,
  active,
  collapsed,
  crossZone
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  crossZone: boolean;
}) {
  const { Link } = useRouterAdapter();
  const base =
    "group flex items-center rounded-[22px] px-4 py-3 text-[14px] font-bold transition-all";
  const classes = active
    ? `${base} bg-[#EAF0FA] text-ink`
    : `${base} text-ink hover:bg-panel`;
  const className = `${classes} ${collapsed ? "justify-center px-0" : "gap-4"}`;
  const inner = (
    <>
      <span className={collapsed ? "" : "shrink-0"}>{getItemIcon(item.key)}</span>
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </>
  );

  // Cross-zone links (peer apps mounted at /apps/* via Multi-Zones) MUST be hard
  // navigations: a soft transition makes the shell's router try to load the peer
  // zone's route chunk from the shell origin, which 404s (ChunkLoadError).
  // Same-app shell routes use the adapter Link for fast client nav. When the
  // chrome itself runs INSIDE a peer app (crossZone), even shell routes must be
  // hard navigations — a soft link would prepend the peer basePath and 404.
  if (crossZone || item.href.startsWith("/apps/")) {
    return (
      <a
        aria-current={active ? "page" : undefined}
        className={className}
        href={item.href}
        title={collapsed ? item.label : undefined}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={className}
      href={item.href}
      title={collapsed ? item.label : undefined}
    >
      {inner}
    </Link>
  );
}

export function AppShell({
  children,
  settings,
  crossZone = false
}: {
  children: ReactNode;
  // Optional render-prop slot for the host's settings surface. AppShell still
  // owns the cog button + open/close state; the host renders its own modal (the
  // shell's SettingsModal) wired to the provided open/onClose. Omitting it keeps
  // the cog visible but opening shows nothing. This keeps the mutation-coupled
  // SettingsModal out of the Vite-safe @ssa/ui/chrome entry.
  settings?: (ctx: { open: boolean; onClose: () => void }) => ReactNode;
  // Set by peer apps (RT/EC) that mount this chrome under a Next basePath. It
  // forces every nav link + project switch to a hard browser navigation so shell
  // routes resolve against the shell origin instead of the peer basePath.
  crossZone?: boolean;
}) {
  const { usePathname } = useRouterAdapter();
  const pathname = usePathname();
  const { currentUser, canLeadership, canAdmin, getProjectBySlug } = useChromeData();
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored === "true") {
      setCollapsed(true);
    }
  }, []);

  const toggleCollapsed = () => {
    const nextValue = !collapsed;
    setCollapsed(nextValue);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextValue));
  };

  const projectId = getCurrentSlug(pathname);
  const platformProjectId = projectId ? getProjectBySlug(projectId)?.id ?? null : null;
  const currentKey = getCurrentKey(pathname);

  const navSections = useMemo(() => {
    const sections = getNavSections(projectId, { pmoPlatformProjectId: platformProjectId });

    // Section visibility gates (UX-only): Leadership is gated to leadership
    // users, and the top-level Admin section is gated to platform admins. The
    // /api/admin/* routes behind the Admin console still enforce
    // requireAdminUser() server-side — this filter is an affordance, not the
    // security boundary.
    return sections.filter((section) => {
      if (section.key === "leadership") return canLeadership;
      if (section.key === "admin") return canAdmin;
      return true;
    });
  }, [canAdmin, canLeadership, platformProjectId, projectId]);

  return (
    <div className="min-h-screen bg-transparent">
      <NavigationProgress />
      <div className="mx-auto flex min-h-screen w-full max-w-[1800px] gap-6 px-4 py-6 sm:px-6 lg:px-8 2xl:px-10">
        <aside
          aria-label="SSAPro project navigation"
          className={`relative sticky top-6 flex h-[calc(100vh-3rem)] shrink-0 flex-col rounded-[32px] border border-slate-200/70 bg-white/95 p-0 shadow-ambient transition-[width] duration-300 ${
            collapsed ? "w-[96px]" : "w-[304px]"
          }`}
        >
          <button
            type="button"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            className="absolute right-[-14px] top-8 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-ink shadow-md transition hover:bg-panel"
            onClick={toggleCollapsed}
          >
            <ChevronIcon collapsed={collapsed} />
          </button>

          <div className={`${collapsed ? "px-4 pb-3 pt-8" : "px-6 pb-4 pt-8"}`}>
            {collapsed ? (
              <div className="flex justify-center">
                <img src="/ssa-logo.png" alt="SSA & Company" className="h-10 w-auto" />
              </div>
            ) : (
              // SSA & Company logo + "SSA & Company" wordmark (serif, navy). The
              // PROJECT DELIVERY tagline (sans) is spread with flex justify-between
              // over its glyphs so it spans exactly the wordmark width. Kept
              // identical to PMO's PlatformShell header so all zones share one
              // chrome style.
              <div className="flex items-center gap-3">
                <img src="/ssa-logo.png" alt="SSA & Company" className="h-10 w-auto shrink-0" />
                <div className="inline-block leading-none">
                  <div
                    className="text-[40px] tracking-tight"
                    style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                  >
                    <span className="font-bold text-[#0E2A4E]">SSA &amp; Company</span>
                  </div>
                  <div
                    className="mt-1.5 flex justify-between font-display text-[9px] font-bold text-[#0E2A4E]"
                    aria-label="Project Delivery"
                  >
                    {Array.from("PROJECT DELIVERY").map((ch, i) => (
                      <span key={i} aria-hidden>
                        {ch === " " ? " " : ch}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <hr className="border-slate-200 mx-4" />

          <nav className={`min-h-0 flex-1 overflow-y-auto ${collapsed ? "space-y-8 px-3 pb-8 pt-6" : "space-y-12 px-4 pb-8 pt-6"}`}>
            {!collapsed ? (
              <div className="mb-2">
                <ProjectSwitcher crossZone={crossZone} />
              </div>
            ) : null}
            {navSections.map((section) => (
              <section key={section.key}>
                {!collapsed ? (
                  <p className="mb-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.22em] text-[#B7C7FF]">
                    {section.title}
                  </p>
                ) : null}
                <div className="space-y-2">
                  {section.items.map((item) => (
                    <NavLink
                      key={item.key}
                      active={currentKey === item.key}
                      collapsed={collapsed}
                      item={item}
                      crossZone={crossZone}
                    />
                  ))}
                </div>
              </section>
            ))}
          </nav>

          <div className={`${collapsed ? "px-3 py-5" : "px-4 py-5"} border-t border-slate-200/70`}>
            <div className={`flex items-center ${collapsed ? "justify-center" : "gap-4 px-2"}`}>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#DDE6FF] text-[14px] font-extrabold text-ink">
                <span>{currentUser.initials}</span>
              </div>
              {!collapsed ? (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold text-slate-900">{currentUser.name}</p>
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-outline">
                      {currentUser.roleLabel}
                    </p>
                  </div>
                  <button
                    className="rounded-full p-2 text-outline transition hover:bg-panel hover:text-ink"
                    onClick={() => setSettingsOpen(true)}
                    type="button"
                    aria-label="Open settings"
                  >
                    <SettingsIcon />
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {settings?.({ open: settingsOpen, onClose: () => setSettingsOpen(false) })}
    </div>
  );
}
