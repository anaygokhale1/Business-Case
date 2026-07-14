"use client";

import { ReactNode } from "react";

import { useRouterAdapter } from "../router-adapter";

type Action = {
  href: string;
  label: string;
};

type PageShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
  actions?: Action[];
};

// Action links are rendered by a child component so useRouterAdapter() is only
// invoked when there are actions to render. PageShell is used both inside the
// (app) chrome (provider present) and on the standalone (auth) onboarding page
// (no provider); the latter passes no actions, so it never touches the adapter.
function PageShellActions({ actions }: { actions: Action[] }) {
  const { Link } = useRouterAdapter();
  return (
    <div className="flex flex-wrap gap-3">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="rounded-2xl bg-ink-gradient px-4 py-3 text-sm font-semibold text-white shadow-ambient"
        >
          {action.label}
        </Link>
      ))}
    </div>
  );
}

export function PageShell({ eyebrow, title, description, children, actions = [] }: PageShellProps) {
  return (
    <section className="space-y-6">
      <div className="rounded-[28px] bg-card/90 p-6 shadow-ambient ring-1 ring-slate-200/60 backdrop-blur sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-muted">{eyebrow}</p>
            <h1 className="mt-3 font-display text-3xl font-semibold text-ink sm:text-4xl">{title}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted sm:text-base">{description}</p>
          </div>

          {actions.length > 0 ? <PageShellActions actions={actions} /> : null}
        </div>
      </div>

      {children}
    </section>
  );
}
