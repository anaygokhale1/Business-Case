"use client";

import { useRouterAdapter } from "../router-adapter";

export function InvalidProjectState() {
  const { Link } = useRouterAdapter();
  return (
    <section className="rounded-[28px] bg-white p-8 shadow-ambient ring-1 ring-slate-200/70">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
        Select a project first
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">
        This view needs an active project selection. Go to your My Projects Portfolio page and
        choose a project to continue.
      </p>
      <div className="mt-6">
        <Link
          href="/projects"
          className="inline-flex items-center rounded-2xl bg-ink-gradient px-5 py-3 text-sm font-semibold text-white shadow-ambient"
        >
          Go to My Projects Portfolio
        </Link>
      </div>
    </section>
  );
}
