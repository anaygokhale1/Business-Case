"use client";

/**
 * The Input tab: the skill's 35 questions in nine batches.
 *
 * One batch is shown at a time with a rail down the side, rather than a single long
 * scroll. The interview has a shape — scope before headcount before compensation —
 * and the rail makes it possible to see what is still outstanding without reading
 * every field.
 */

import { useState } from "react";

import { useCaseStore } from "../../hooks/use-case-store";
import { statusMapOf, type BatchId, type BatchProgress } from "../../lib/case-questions";
import { ghostButtonClass, primaryButtonClass } from "./fields";
import { BatchCapacityUpload } from "./batch-capacity-upload";
import { BatchCompany } from "./batch-company";
import { BatchCompensation } from "./batch-compensation";
import { BatchPhasing } from "./batch-phasing";
import { BatchRoleCapacity } from "./batch-role-capacity";
import { BatchRoles } from "./batch-roles";
import { BatchScenarios } from "./batch-scenarios";
import { BatchScope } from "./batch-scope";
import { BatchTimeStudy } from "./batch-time-study";
import { BatchUnits } from "./batch-units";
import { BatchWorkload } from "./batch-workload";

export function InputsWorkspace({ onGenerated }: { onGenerated: () => void }) {
  const { readiness, generate, reset, loadSample, revision, toggleSkip } = useCaseStore();
  const [active, setActive] = useState<BatchId>("company");

  const status = statusMapOf(readiness);
  const current = readiness.batches.find((b) => b.batch.id === active) ?? readiness.batches[0]!;
  const index = readiness.batches.findIndex((b) => b.batch.id === current.batch.id);

  const props = { status, blurb: current.batch.blurb };

  return (
    <div className="space-y-6">
      <ProgressHeader
        onGenerate={() => {
          generate();
          onGenerated();
        }}
        onReset={reset}
        onLoadSample={loadSample}
      />

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Input batches" className="lg:sticky lg:top-6 lg:self-start">
          <ol className="space-y-1.5">
            {readiness.batches.map((batch, i) => (
              <li key={batch.batch.id}>
                <RailItem
                  batch={batch}
                  ordinal={i + 1}
                  active={batch.batch.id === current.batch.id}
                  onClick={() => setActive(batch.batch.id)}
                />
              </li>
            ))}
          </ol>
        </nav>

        <div className="space-y-6">
          <SkipBar batch={current} onToggle={() => toggleSkip(current.batch.id)} />

          {/* Keyed on revision so replacing the case wholesale re-mounts the fields
              and their editing drafts, rather than leaving a stale string in a box. */}
          <div key={`${current.batch.id}-${revision}`} hidden={current.skipped}>
            {current.batch.id === "company" ? <BatchCompany {...props} /> : null}
            {current.batch.id === "scope" ? <BatchScope {...props} /> : null}
            {current.batch.id === "roles" ? <BatchRoles {...props} /> : null}
            {current.batch.id === "units" ? <BatchUnits {...props} /> : null}
            {current.batch.id === "compensation" ? <BatchCompensation {...props} /> : null}
            {current.batch.id === "workload" ? <BatchWorkload {...props} /> : null}
            {current.batch.id === "timeStudy" ? <BatchTimeStudy {...props} /> : null}
            {current.batch.id === "scenarios" ? <BatchScenarios {...props} /> : null}
            {current.batch.id === "capacityUpload" ? <BatchCapacityUpload blurb={props.blurb} /> : null}
            {current.batch.id === "roleCapacity" ? <BatchRoleCapacity {...props} /> : null}
            {current.batch.id === "phasing" ? <BatchPhasing {...props} /> : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className={ghostButtonClass}
              disabled={index === 0}
              onClick={() => setActive(readiness.batches[index - 1]!.batch.id)}
            >
              &larr; Previous
            </button>
            <span className="text-xs text-outline">
              Step {index + 1} of {readiness.batches.length}
            </span>
            <button
              type="button"
              className={ghostButtonClass}
              disabled={index === readiness.batches.length - 1}
              onClick={() => setActive(readiness.batches[index + 1]!.batch.id)}
            >
              Next &rarr;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ProgressHeader({
  onGenerate,
  onReset,
  onLoadSample,
}: {
  onGenerate: () => void;
  onReset: () => void;
  onLoadSample: () => void;
}) {
  const { readiness, workingCase } = useCaseStore();
  const { canGenerate, blocking, answered, applicable } = readiness;
  const pct = applicable === 0 ? 0 : Math.round((answered / applicable) * 100);

  return (
    <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-extrabold text-ink">
            {workingCase.meta.initiativeTitle || "New business case"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {workingCase.meta.company || "Unnamed company"} &middot; {answered} of {applicable}{" "}
            questions answered &middot; {workingCase.units.length}{" "}
            {workingCase.units.length === 1 ? "row" : "rows"} in the register
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={ghostButtonClass} onClick={onLoadSample}>
            Load sample case
          </button>
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => {
              if (window.confirm("Discard this case and start from blank? This cannot be undone.")) {
                onReset();
              }
            }}
          >
            Start over
          </button>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={!canGenerate}
            onClick={onGenerate}
            title={
              canGenerate
                ? "Build the case from these inputs"
                : `${blocking.length} required answer${blocking.length === 1 ? "" : "s"} outstanding`
            }
          >
            Generate business case
          </button>
        </div>
      </div>

      <div className="mt-6 h-2 overflow-hidden rounded-full bg-panel">
        <div
          className="h-full rounded-full bg-ink transition-all"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Questions answered"
        />
      </div>

      {blocking.length > 0 ? (
        <div className="mt-5 rounded-2xl bg-canvas px-4 py-3">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            Outstanding before the case can be built
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            {blocking.map((q) => (
              <li key={q.id}>
                <span className="text-[10px] font-semibold text-slate-300">{q.id}</span> {q.label}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-5 rounded-2xl bg-canvas px-4 py-3 text-sm text-muted">
          Every required answer is in. Anything still showing as a{" "}
          <span className="font-semibold text-ink">default</span> will be labelled as one on the case
          rather than presented as your figure.
        </p>
      )}
    </div>
  );
}

/**
 * The not-applicable control.
 *
 * A batch is skippable exactly when nothing in it is required, which is derived rather
 * than declared. Where it is not skippable the bar says which answers are the reason —
 * a disabled button with no explanation just leaves the user guessing why.
 */
function SkipBar({ batch, onToggle }: { batch: BatchProgress; onToggle: () => void }) {
  if (batch.skipped) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-panel px-5 py-4">
        <p className="text-sm text-muted">
          <span className="font-bold text-ink">{batch.batch.label}</span> is marked not applicable.
          Its questions are excluded from the count, and anything it would have contributed keeps its
          documented default.
        </p>
        <button type="button" className={ghostButtonClass} onClick={onToggle}>
          Include this section
        </button>
      </div>
    );
  }

  if (!batch.skippable) {
    const names = batch.questions
      .filter((q) => q.question.required)
      .map((q) => q.question.label);
    return (
      <p className="px-1 text-xs text-outline">
        This section cannot be skipped — the case needs {names.join(", ").toLowerCase()}.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-xs text-outline">
        Everything in this section is optional or has a documented default.
      </p>
      <button type="button" className={ghostButtonClass} onClick={onToggle}>
        Not applicable — skip this section
      </button>
    </div>
  );
}

function RailItem({
  batch,
  ordinal,
  active,
  onClick,
}: {
  batch: BatchProgress;
  ordinal: number;
  active: boolean;
  onClick: () => void;
}) {
  const complete = batch.applicable > 0 && batch.answered === batch.applicable;
  const blocked = batch.blocking.length > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "step" : undefined}
      className={`w-full rounded-2xl px-4 py-3 text-left transition ${
        active ? "bg-ink text-white" : "bg-white/95 ring-1 ring-slate-200/70 hover:ring-ink/30"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-sm font-bold ${active ? "text-white" : "text-ink"}`}>
          {ordinal}. {batch.batch.label}
        </span>
        {batch.skipped ? (
          <span
            className={`text-[10px] font-extrabold uppercase tracking-[0.1em] ${
              active ? "text-white/70" : "text-outline"
            }`}
          >
            skipped
          </span>
        ) : blocked ? (
          <span
            className={`text-[10px] font-extrabold uppercase tracking-[0.1em] ${
              active ? "text-red-200" : "text-red-600"
            }`}
            title={batch.blocking.map((q) => `${q.id} ${q.label}`).join(", ")}
          >
            {batch.blocking.length} needed
          </span>
        ) : complete ? (
          <span
            className={`text-[10px] font-extrabold uppercase tracking-[0.1em] ${
              active ? "text-white/80" : "text-teal"
            }`}
          >
            done
          </span>
        ) : null}
      </div>
      <p className={`mt-0.5 text-xs ${active ? "text-white/70" : "text-outline"}`}>
        {batch.skipped
          ? "not applicable"
          : batch.applicable === 0
            ? "optional"
            : `${batch.answered} / ${batch.applicable} answered`}
      </p>
    </button>
  );
}
