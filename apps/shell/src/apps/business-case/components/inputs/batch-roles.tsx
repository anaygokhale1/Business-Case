"use client";

import { useCaseStore } from "../../hooks/use-case-store";
import type { AnswerStatus } from "../../lib/case-questions";
import type { RoleTier } from "../../lib/engine/types";
import {
  Field,
  FieldGrid,
  ghostButtonClass,
  inputClass,
  Note,
  NumberField,
  Panel,
  pillClass,
} from "./fields";

const TIERS: readonly RoleTier[] = ["front-line", "manager", "other"];

const TIER_HELP: Record<RoleTier, string> = {
  "front-line": "Sized by the capacity identity. Volume and handle time drive how many are needed.",
  manager: "Sized from the span of control against remaining front-line staff.",
  other: "Carried in headcount and blended cost, but not sized by either mechanism.",
};

/** Batch 3 — Q9, Q10, Q13, Q14. */
export function BatchRoles({
  status,
  blurb,
}: {
  status: Record<string, AnswerStatus>;
  blurb: string;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const { roles, globals } = workingCase;

  const frontLineCount = roles.filter((r) => r.tier === "front-line").length;

  return (
    <Panel title="Roles & span" blurb={blurb}>
      <div className="space-y-6">
        <Field label="Role tiers" questionId="Q9 · Q10 · Q14" status={status["Q9"]}>
          <div className="space-y-3">
            {roles.map((role) => (
              <div key={role.id} className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  className={`${inputClass} max-w-xs`}
                  value={role.title}
                  placeholder={
                    role.tier === "front-line"
                      ? "Claims Processor"
                      : role.tier === "manager"
                        ? "Team Lead"
                        : "Senior Analyst"
                  }
                  onChange={(event) =>
                    dispatch({ type: "role/setTitle", roleId: role.id, title: event.target.value })
                  }
                  aria-label={`Title for ${role.id}`}
                />
                <div className="flex gap-1.5">
                  {TIERS.map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      title={TIER_HELP[tier]}
                      aria-pressed={role.tier === tier}
                      onClick={() => dispatch({ type: "role/setTier", roleId: role.id, tier })}
                      className={pillClass(role.tier === tier)}
                    >
                      {tier}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={ghostButtonClass}
                  disabled={role.tier === "front-line" && frontLineCount === 1}
                  title={
                    role.tier === "front-line" && frontLineCount === 1
                      ? "The last front-line role cannot be removed — the capacity identity would have nothing to size."
                      : "Remove this role, and its headcount and cost from every row"
                  }
                  onClick={() => dispatch({ type: "role/remove", roleId: role.id })}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </Field>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => dispatch({ type: "role/add", tier: "front-line" })}
          >
            + Front-line tier
          </button>
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => dispatch({ type: "role/add", tier: "manager" })}
          >
            + Manager tier
          </button>
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => dispatch({ type: "role/add", tier: "other" })}
          >
            + Other tier
          </button>
        </div>

        <FieldGrid>
          <NumberField
            label="Target span of control"
            questionId="Q13"
            status={status["Q13"]}
            value={globals.spanOfControl}
            onChange={(v) => v !== null && dispatch({ type: "globals/setNumber", field: "spanOfControl", value: v })}
            dp={2}
            suffix="staff"
            hint={`1:${globals.spanOfControl} — one manager per ${globals.spanOfControl} staff.`}
          />
        </FieldGrid>

        <Note>
          Required managers is computed once across the whole portfolio, not per row, because
          rounding up to whole managers does not survive being added together: sizing each of ten
          teams separately and summing gives a different — and always larger — answer than sizing the
          portfolio once. The case states both figures so a reviewer checking one team&rsquo;s
          arithmetic is not misled.
        </Note>
      </div>
    </Panel>
  );
}
