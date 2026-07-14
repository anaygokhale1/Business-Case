import Link from "next/link";

// PHASE-3: project creation writes a real Project row and membership. The
// template ships a fixed synthetic project list (see @ssa/project-context), so
// this is an informational stub rather than a working form.
export default function NewProjectPage() {
  return (
    <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
      <h1 className="text-2xl font-extrabold text-ink">New project</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">
        Creating projects is out of scope for this template (PHASE-3). The project
        list is synthetic and defined in{" "}
        <code className="rounded bg-panel px-1.5 py-0.5 text-xs">
          packages/project-context/src/project-portfolio.ts
        </code>
        . Edit that file to add or change the demo projects.
      </p>
      <Link
        href="/projects"
        className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90"
      >
        Back to projects
      </Link>
    </div>
  );
}
