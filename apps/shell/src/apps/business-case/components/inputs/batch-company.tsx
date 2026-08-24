"use client";

import { CORE_PROBLEMS, INDUSTRIES } from "../../lib/case-defaults";
import { presetForIndustry } from "../../lib/case-presets";
import type { AnswerStatus } from "../../lib/case-questions";
import { useCaseStore } from "../../hooks/use-case-store";
import { ChoiceField, FieldGrid, ghostButtonClass, Note, Panel, primaryButtonClass, TextField } from "./fields";

/**
 * Offer the industry's preset once the industry is known.
 *
 * An offer, never automatic. Switching the model changes which questions the case asks,
 * and doing that to someone mid-interview because they picked an industry would be a
 * surprising amount of consequence for one click.
 */
function PresetOffer() {
  const { workingCase, dispatch } = useCaseStore();
  const preset = presetForIndustry(workingCase.meta.industry);

  if (!preset) return null;

  const alreadyApplied = workingCase.model === preset.model && (workingCase.capacity?.roles.length ?? 0) > 0;

  if (alreadyApplied) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-canvas px-4 py-3">
        <p className="text-xs text-muted">
          <span className="font-semibold text-ink">{preset.label} template in use.</span>{" "}
          {preset.roles.length} role grades and {preset.transactionTypes.length} transaction types
          are seeded and editable.
        </p>
        <button
          type="button"
          className={ghostButtonClass}
          onClick={() => dispatch({ type: "capacity/clear" })}
          title="Return to the headcount-reduction model and discard the capacity study."
        >
          Use the reduction model instead
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl bg-canvas p-5">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
        {preset.label} template available
      </p>
      <p className="text-sm text-muted">{preset.blurb}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={primaryButtonClass}
          onClick={() => dispatch({ type: "capacity/applyPreset", preset })}
        >
          Use the {preset.label} template
        </button>
        <span className="text-xs text-outline">
          Seeds {preset.roles.map((r) => r.role).join(", ")} &middot; all editable
        </span>
      </div>
      <p className="text-xs text-outline">
        No costs are seeded. There is no defensible industry figure for an underwriter&rsquo;s
        all-in cost, and a plausible one here would be the most quietly damaging number in the
        case.
      </p>
    </div>
  );
}

/** Batch 1 — Q1 to Q5. The cover block. */
export function BatchCompany({
  status,
  blurb,
}: {
  status: Record<string, AnswerStatus>;
  blurb: string;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const { meta } = workingCase;

  const setMeta = (field: keyof typeof meta, value: string) =>
    dispatch({ type: "meta/set", field, value });

  return (
    <Panel title="Company & initiative" blurb={blurb}>
      <div className="space-y-6">
        <FieldGrid>
          <TextField
            label="Company name"
            questionId="Q1"
            status={status["Q1"]}
            value={meta.company}
            onChange={(v) => setMeta("company", v)}
            placeholder="Northwind Assurance"
          />
          <TextField
            label="Initiative title"
            questionId="Q4"
            status={status["Q4"]}
            value={meta.initiativeTitle}
            onChange={(v) => setMeta("initiativeTitle", v)}
            placeholder="Claims Operations Optimisation"
          />
          <TextField
            label="Prepared by"
            questionId="Q5"
            status={status["Q5"]}
            value={meta.preparedBy}
            onChange={(v) => setMeta("preparedBy", v)}
            placeholder="Name"
          />
          <TextField
            label="Model date"
            questionId="Q5"
            value={meta.modelDate}
            onChange={(v) => setMeta("modelDate", v)}
            placeholder="yyyy-mm-dd"
            hint="Shown on the cover block. Separate from the as-of date the arithmetic uses."
          />
        </FieldGrid>

        <ChoiceField
          label="Industry / sector"
          questionId="Q2"
          status={status["Q2"]}
          options={INDUSTRIES}
          value={meta.industry as (typeof INDUSTRIES)[number] | ""}
          onChange={(v) => setMeta("industry", v)}
          hint="Selects the benchmark compensation figures offered in the Compensation step."
        />

        <ChoiceField
          label="Core problem being solved"
          questionId="Q3"
          status={status["Q3"]}
          options={CORE_PROBLEMS}
          value={meta.coreProblem as (typeof CORE_PROBLEMS)[number] | ""}
          onChange={(v) => setMeta("coreProblem", v)}
        />

        <PresetOffer />

        <Note>
          The as-of date for this case is <strong>{meta.asOfDate}</strong>, fixed when the case was
          started. Every date calculation reads it rather than the clock, so the numbers do not move
          overnight and two people opening the case on different days see the same model.
        </Note>
      </div>
    </Panel>
  );
}
