"use client";

import { ReactNode, useMemo, useState, type ReactElement } from "react";

import { useAccess } from "./access-provider";
import { Dialog, DialogBody, DialogTitle } from "./dialog";
import { useProjectPortfolio } from "./project-portfolio-provider";

// The personal cog modal hosts ONLY personal tabs (Profile + My Projects).
// Platform-global admin surfaces moved OUT to the top-level /admin area
// (gated nav section + full-page tabbed console), so the modal no longer
// receives or renders any admin workspace nodes.
type TabKey = "profile" | "myProjects";

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  // Optional override for the sign-out action; defaults to the NextAuth route.
  onSignOut?: () => void;
  // Optional starting tab (defaults to "profile").
  initialTab?: TabKey;
}

type TabDef = {
  key: TabKey;
  label: string;
};

const TAB_ORDER: TabDef[] = [
  { key: "profile", label: "Profile" },
  { key: "myProjects", label: "My Projects" },
];

const TITLE_ID = "settings-modal-title";

function defaultSignOut() {
  if (typeof window !== "undefined") {
    window.location.href = "/api/auth/signout";
  }
}

function ProfileTab({ onSignOut }: { onSignOut: () => void }) {
  const { currentUser } = useAccess();
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#DCE1FF] text-lg font-bold text-[#002576]">
          {currentUser.initials}
        </span>
        <div className="space-y-1">
          <p className="text-base font-bold text-slate-900">{currentUser.name}</p>
          <p className="text-sm text-slate-500">{currentUser.email}</p>
          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-tight text-slate-600">
            {currentUser.roleLabel}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
      >
        Sign out
      </button>
    </div>
  );
}

function MyProjectsTab() {
  const { allProjects, isArchived, archive, unarchive } = useProjectPortfolio();

  const { active, archived } = useMemo(() => {
    const activeProjects = allProjects.filter((project) => !isArchived(project.slug));
    const archivedProjects = allProjects.filter((project) => isArchived(project.slug));
    return { active: activeProjects, archived: archivedProjects };
  }, [allProjects, isArchived]);

  const renderRow = (slug: string, name: string, account: string, isArchivedRow: boolean) => (
    <li
      key={slug}
      className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-4 py-3"
    >
      <div>
        <p className="text-sm font-bold text-slate-800">{name}</p>
        <p className="text-xs text-slate-500">{account}</p>
      </div>
      <button
        type="button"
        onClick={() => (isArchivedRow ? unarchive(slug) : archive(slug))}
        className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
      >
        {isArchivedRow ? "Unarchive" : "Archive"}
      </button>
    </li>
  );

  return (
    <div className="space-y-6 p-6">
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Active</h3>
        {active.length === 0 ? (
          <p className="text-sm text-slate-400">No active projects.</p>
        ) : (
          <ul className="space-y-2">
            {active.map((project) => renderRow(project.slug, project.name, project.account, false))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Archived</h3>
        {archived.length === 0 ? (
          <p className="text-sm text-slate-400">No archived projects.</p>
        ) : (
          <ul className="space-y-2">
            {archived.map((project) => renderRow(project.slug, project.name, project.account, true))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SettingsModal({
  open,
  onClose,
  onSignOut,
  initialTab = "profile",
}: SettingsModalProps): ReactElement | null {
  const visibleTabs = useMemo(() => TAB_ORDER, []);

  const clampedInitial = visibleTabs.some((tab) => tab.key === initialTab) ? initialTab : "profile";
  const [activeTab, setActiveTab] = useState<TabKey>(clampedInitial);

  // Defensive fallback in case the active tab ever leaves the visible set.
  const effectiveTab = visibleTabs.some((tab) => tab.key === activeTab) ? activeTab : "profile";

  if (!open) {
    return null;
  }

  const panelBody: ReactNode =
    effectiveTab === "profile" ? (
      <ProfileTab onSignOut={onSignOut ?? defaultSignOut} />
    ) : (
      <MyProjectsTab />
    );

  return (
    <Dialog open={open} onClose={onClose} labelledBy={TITLE_ID} size="xl" closeOnOverlayClick>
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <DialogTitle id={TITLE_ID}>Settings</DialogTitle>
        <button
          type="button"
          aria-label="Close settings"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          role="tablist"
          aria-orientation="vertical"
          className="w-56 shrink-0 space-y-1 border-r border-slate-100 p-3"
        >
          {visibleTabs.map((tab) => {
            const selected = tab.key === effectiveTab;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.key)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm font-bold transition-colors ${
                  selected ? "bg-blue-50 text-[#0038A8]" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Internal scroll region: tab content scrolls within this bounded
            panel instead of growing the modal past the viewport (the Dialog
            panel is capped at 90vh). */}
        <DialogBody className="min-h-0 flex-1">
          <div
            role="tabpanel"
            data-testid="settings-tab-panel"
            className="h-full min-h-0 overflow-y-auto"
          >
            {panelBody}
          </div>
        </DialogBody>
      </div>
    </Dialog>
  );
}

export { SettingsModal };
export default SettingsModal;
