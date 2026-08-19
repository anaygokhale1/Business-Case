"use client";

import { useCaseStore } from "../../hooks/use-case-store";
import { EXIT_PROFILES, IMPLEMENTATION_COST_MODES } from "../../lib/case-defaults";
import type { AnswerStatus } from "../../lib/case-questions";
import type { ExitProfile } from "../../lib/engine/types";
import {
  ChoiceField,
  Field,
  FieldGrid,
  ghostButtonClass,
  Note,
  NumberField,
  NumberInput,
  Panel,
} from "./fields";

/** Batch 9 — Q29 to Q35. */
export function BatchPhasing({
  status,
  blurb,
}: {
  status: Record<string, AnswerStatus>;
  blurb: string;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const { globals } = workingCase;

  const carriesConsulting = globals.implementationCosts === "Severance + consulting";
  const weights = globals.phaseWeights[globals.exitProfile] ?? [];
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const weightsOk = Math.abs(weightSum - 1) < 1e-9;
  const lengthMismatch = weights.length !== globals.phaseCount;

  const lastExitMonth = globals.noticeMonths + globals.phaseCount * globals.monthsPerPhase;

  return (
    <Panel title="Costs & phasing" blurb={blurb}>
      <div className="space-y-6">
        <ChoiceField
          label="Implementation costs to model"
          questionId="Q29"
          status={status["Q29"]}
          options={IMPLEMENTATION_COST_MODES}
          value={globals.implementationCosts}
          onChange={(v) => dispatch({ type: "globals/setChoice", patch: { implementationCosts: v } })}
          hint="This choice wins over the figures below. Switching away from a cost keeps the number you typed but stops it reaching any total."
        />

        <FieldGrid cols={3}>
          <NumberField
            label="Consulting / transition cost"
            questionId="Q30"
            status={status["Q30"]}
            value={globals.consultingCost}
            onChange={(v) =>
              v !== null && dispatch({ type: "globals/setNumber", field: "consultingCost", value: v })
            }
            dp={0}
            suffix="$"
            hint={
              carriesConsulting
                ? "One-time. Counted in payback, so it lengthens it."
                : "Recorded but excluded — the cost mode above does not carry it."
            }
          />
          <NumberField
            label="Notice period before first exits"
            questionId="Q31"
            status={status["Q31"]}
            value={globals.noticeMonths}
            onChange={(v) =>
              v !== null && dispatch({ type: "globals/setNumber", field: "noticeMonths", value: v })
            }
            dp={0}
            suffix="mo"
          />
          <NumberField
            label="Months per phase"
            questionId="Q33"
            status={status["Q33"]}
            value={globals.monthsPerPhase}
            onChange={(v) =>
              v !== null && dispatch({ type: "globals/setNumber", field: "monthsPerPhase", value: v })
            }
            dp={0}
            suffix="mo"
          />
        </FieldGrid>

        <FieldGrid>
          <NumberField
            label="Number of exit phases"
            questionId="Q32"
            status={status["Q32"]}
            value={globals.phaseCount}
            onChange={(v) =>
              v !== null && dispatch({ type: "globals/setNumber", field: "phaseCount", value: v })
            }
            dp={0}
            hint={`Last exits land in month ${lastExitMonth}.`}
          />
          <ChoiceField
            label="Exit profile"
            questionId="Q34"
            status={status["Q34"]}
            options={EXIT_PROFILES}
            value={globals.exitProfile}
            onChange={(v) => dispatch({ type: "globals/setChoice", patch: { exitProfile: v } })}
          />
        </FieldGrid>

        <Field
          label={`Phase weights — ${globals.exitProfile}`}
          questionId="Q35"
          status={status["Q35"]}
          hint={
            weightsOk
              ? `Sums to 100% across ${weights.length} phase${weights.length === 1 ? "" : "s"}.`
              : undefined
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            {weights.map((weight, index) => (
              <div key={index} className="w-24">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-outline">
                  Phase {index + 1}
                </p>
                <NumberInput
                  ariaLabel={`${globals.exitProfile} weight for phase ${index + 1}`}
                  value={weight}
                  onChange={(v) =>
                    dispatch({
                      type: "phaseWeights/set",
                      profile: globals.exitProfile as ExitProfile,
                      index,
                      value: v ?? 0,
                    })
                  }
                  scale={100}
                  suffix="%"
                />
              </div>
            ))}
            <div className="pb-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-outline">Sum</p>
              <p
                className={
                  weightsOk
                    ? "text-lg font-extrabold tabular-nums text-teal"
                    : "text-lg font-extrabold tabular-nums text-red-600"
                }
              >
                {(weightSum * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        </Field>

        {!weightsOk || lengthMismatch ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-red-50 px-4 py-3">
            <p className="text-xs text-red-700">
              {lengthMismatch
                ? `There are ${weights.length} weights but ${globals.phaseCount} phases.`
                : `Weights sum to ${(weightSum * 100).toFixed(1)}%, not 100%.`}{" "}
              Exit totals and payback are wrong until this is fixed. The weights are never normalised
              behind your back — a case that quietly rescaled them would disagree with its own
              exported workbook.
            </p>
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() => dispatch({ type: "phaseWeights/resize", phaseCount: globals.phaseCount })}
            >
              Reset weights for {globals.phaseCount} phases
            </button>
          </div>
        ) : null}

        <Note>
          Exits begin after the notice period, so month one carries cost and no saving. That is what
          makes payback longer than gross annual savings alone would suggest, and it is the reason the
          phasing view and the annual figures have to be built from one definition rather than two.
        </Note>
      </div>
    </Panel>
  );
}
