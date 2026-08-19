"use client";

import { CORE_PROBLEMS, INDUSTRIES } from "../../lib/case-defaults";
import type { AnswerStatus } from "../../lib/case-questions";
import { useCaseStore } from "../../hooks/use-case-store";
import { ChoiceField, FieldGrid, Note, Panel, TextField } from "./fields";

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

        <Note>
          The as-of date for this case is <strong>{meta.asOfDate}</strong>, fixed when the case was
          started. Every date calculation reads it rather than the clock, so the numbers do not move
          overnight and two people opening the case on different days see the same model.
        </Note>
      </div>
    </Panel>
  );
}
