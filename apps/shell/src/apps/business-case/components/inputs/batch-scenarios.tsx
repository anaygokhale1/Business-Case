"use client";

import { useCaseStore } from "../../hooks/use-case-store";
import { SEVERANCE_TIMINGS } from "../../lib/case-defaults";
import type { AnswerStatus } from "../../lib/case-questions";
import { SCENARIO_KEYS, type ScenarioKey } from "../../lib/engine/types";
import { fte } from "../../lib/format";
import {
  ChoiceField,
  FieldGrid,
  ghostButtonClass,
  Note,
  NumberField,
  Panel,
  PercentField,
} from "./fields";

const SCENARIO_LABEL: Record<ScenarioKey, string> = { low: "Low", base: "Base", high: "High" };
const SCENARIO_QUESTION: Record<ScenarioKey, string> = { low: "Q23", base: "Q24", high: "Q25" };

/** Batch 8 — Q23 to Q28. */
export function BatchScenarios({
  status,
  blurb,
}: {
  status: Record<string, AnswerStatus>;
  blurb: string;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const { globals, scenarios, roles, units } = workingCase;

  const frontLineIds = roles.filter((r) => r.tier === "front-line").map((r) => r.id);
  const totalFrontLine = units.reduce((acc, u) => {
    for (const id of frontLineIds) {
      const raw = u.headcount[id];
      if (typeof raw === "number") acc += raw;
    }
    return acc;
  }, 0);

  const noSeverance = globals.implementationCosts === "None";
  const pcts = SCENARIO_KEYS.map((k) => scenarios[k].hcReductionPct);
  const nonMonotonic = !(pcts[0]! <= pcts[1]! && pcts[1]! <= pcts[2]!);

  return (
    <Panel title="Scenarios & severance" blurb={blurb}>
      <div className="space-y-6">
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
              Headcount reduction by scenario
            </p>
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() => dispatch({ type: "scenario/applySuggestedSpread" })}
              title="Sets 8% / 12% / 18% — the skill's illustrative spread, not a benchmark."
            >
              Use the 8 / 12 / 18 spread
            </button>
          </div>
          <FieldGrid cols={3}>
            {SCENARIO_KEYS.map((key) => (
              <PercentField
                key={key}
                label={`${SCENARIO_LABEL[key]} reduction`}
                questionId={SCENARIO_QUESTION[key]}
                status={status[SCENARIO_QUESTION[key]!]}
                value={scenarios[key].hcReductionPct}
                onChange={(v) =>
                  dispatch({ type: "scenario/set", scenario: key, hcReductionPct: v ?? 0 })
                }
                hint={
                  totalFrontLine > 0
                    ? `${fte(totalFrontLine * scenarios[key].hcReductionPct)} of ${fte(totalFrontLine, 0)} front-line FTE`
                    : "Add headcount to see the FTE this implies."
                }
              />
            ))}
          </FieldGrid>
        </div>

        {nonMonotonic ? (
          <Note>
            These are not in ascending order across Low, Base and High. That is allowed — a reader
            will assume the ordering, so either reorder them or label deliberately what each scenario
            represents.
          </Note>
        ) : null}

        <FieldGrid cols={3}>
          <NumberField
            label="Severance weeks per FTE"
            questionId="Q26"
            status={status["Q26"]}
            value={globals.severanceWeeks}
            onChange={(v) =>
              v !== null && dispatch({ type: "globals/setNumber", field: "severanceWeeks", value: v })
            }
            dp={2}
            suffix="wks"
            hint={
              noSeverance
                ? "Not in use — implementation costs are set to None in the next step."
                : `${(globals.severanceWeeks / 52 * 100).toFixed(1)}% of one year's all-in cost per leaver.`
            }
          />
          <NumberField
            label="Time horizon"
            questionId="Q28"
            status={status["Q28"]}
            value={globals.horizonYears}
            onChange={(v) =>
              v !== null && dispatch({ type: "globals/setNumber", field: "horizonYears", value: v })
            }
            dp={0}
            suffix="yrs"
            hint="Every multi-year figure and every multi-year label is computed from this."
          />
          <ChoiceField
            label="Severance timing"
            questionId="Q27"
            status={status["Q27"]}
            options={SEVERANCE_TIMINGS}
            value={globals.severanceTiming}
            onChange={(v) => dispatch({ type: "globals/setChoice", patch: { severanceTiming: v } })}
          />
        </FieldGrid>

        <Note>
          Severance is charged on the blended all-in cost of the roles actually leaving, including any
          managers the span removes — not on an average across everyone who stays. The horizon drives
          the labels as well as the arithmetic, so a {globals.horizonYears}-year case cannot end up
          with a heading that says three years over a different number of years of data.
        </Note>
      </div>
    </Panel>
  );
}
