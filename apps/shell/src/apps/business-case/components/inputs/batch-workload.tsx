"use client";

import { useCaseStore } from "../../hooks/use-case-store";
import { HANDLE_TIME_SOURCES } from "../../lib/case-defaults";
import type { AnswerStatus } from "../../lib/case-questions";
import { resolveGlobals } from "../../lib/engine/drivers";
import { SENTINEL } from "../../lib/engine/types";
import {
  ChoiceField,
  FieldGrid,
  Note,
  NumberField,
  NumberInput,
  Panel,
  PercentField,
  TextField,
} from "./fields";
import { UnitGrid, type UnitColumn } from "./unit-grid";

/** Batch 6 — Q17, Q18, Q19, Q20, Q22. The demand side of the identity. */
export function BatchWorkload({
  status,
  blurb,
}: {
  status: Record<string, AnswerStatus>;
  blurb: string;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const { globals, meta } = workingCase;
  const resolved = resolveGlobals(workingCase);
  const workload = meta.workloadUnitName.trim();

  const columns: UnitColumn[] = [
    {
      key: "volume",
      label: `Annual ${workload || "volume"}`,
      questionId: "Q18",
      align: "right",
      width: "w-44",
      render: (unit) => (
        <NumberInput
          ariaLabel={`Annual volume for ${unit.name || unit.id}`}
          value={typeof unit.volume === "number" ? unit.volume : null}
          onChange={(v) =>
            dispatch({
              type: "unit/setVolume",
              unitId: unit.id,
              // Cleared means unknown. A row with unknown volume contributes no required
              // FTE and is reported as uncovered, rather than claiming zero demand.
              value: v === null ? SENTINEL : v,
            })
          }
          dp={0}
          placeholder="—"
        />
      ),
    },
    {
      key: "handleTime",
      label: "Handle time (min)",
      questionId: "Q20",
      align: "right",
      width: "w-40",
      render: (unit) => (
        <NumberInput
          ariaLabel={`Handle time for ${unit.name || unit.id}`}
          value={typeof unit.handleTimeMinutes === "number" ? unit.handleTimeMinutes : null}
          onChange={(v) =>
            dispatch({
              type: "unit/setDriver",
              unitId: unit.id,
              driver: "handleTimeMinutes",
              // Cleared goes back to inheriting the global, which is the common case:
              // most rows share one handle time and a few measure their own.
              value: v,
            })
          }
          dp={2}
          placeholder={resolved.activeHandleTimeMinutes > 0 ? resolved.activeHandleTimeMinutes.toFixed(1) : "—"}
        />
      ),
    },
    {
      key: "uplift",
      label: "Uplift",
      questionId: "Q22",
      align: "right",
      width: "w-32",
      render: (unit) => (
        <NumberInput
          ariaLabel={`Volume uplift for ${unit.name || unit.id}`}
          value={typeof unit.upliftPct === "number" ? unit.upliftPct : null}
          onChange={(v) =>
            dispatch({ type: "unit/setDriver", unitId: unit.id, driver: "upliftPct", value: v })
          }
          scale={100}
          suffix="%"
          placeholder={(globals.upliftPct * 100).toFixed(0)}
        />
      ),
    },
  ];

  return (
    <Panel title="Workload & demand" blurb={blurb}>
      <div className="space-y-6">
        <FieldGrid cols={3}>
          <TextField
            label="Workload unit name"
            questionId="Q17"
            status={status["Q17"]}
            value={meta.workloadUnitName}
            onChange={(v) => dispatch({ type: "meta/set", field: "workloadUnitName", value: v })}
            placeholder="Claims"
            hint="What one unit of work is. Every volume and handle-time label reads it."
          />
          <div className="md:col-span-1">
            <NumberField
              label="Average handle time"
              questionId="Q20"
              status={status["Q20"]}
              value={globals.handleTimeMinutes > 0 ? globals.handleTimeMinutes : null}
              onChange={(v) =>
                dispatch({ type: "globals/setNumber", field: "handleTimeMinutes", value: v ?? 0 })
              }
              dp={2}
              suffix="min"
              hint={
                globals.handleTimeSource === "Time Study"
                  ? `The Time Study is the active source (${resolved.activeHandleTimeMinutes.toFixed(1)} min). This value is the fallback if the study is emptied.`
                  : "The global figure. Any row can measure its own instead."
              }
            />
          </div>
          <PercentField
            label={`Volume uplift over ${globals.horizonYears} years`}
            questionId="Q22"
            status={status["Q22"]}
            value={globals.upliftPct}
            onChange={(v) => dispatch({ type: "globals/setNumber", field: "upliftPct", value: v ?? 0 })}
            hint="Demand growth applied to volume before sizing. Zero if none."
          />
          <div>
            <ChoiceField
              label="Handle time source"
              questionId="Q19"
              status={status["Q19"]}
              options={HANDLE_TIME_SOURCES}
              value={globals.handleTimeSource}
              onChange={(v) => dispatch({ type: "globals/setChoice", patch: { handleTimeSource: v } })}
            />
          </div>
        </FieldGrid>

        <div>
          <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            Volume per row <span className="text-slate-300">Q17 · Q18</span>
          </p>
          <UnitGrid
            columns={columns}
            emptyMessage="Add a region in the Scope step first — volume is captured per row."
          />
        </div>

        <Note>
          Required FTE for a row is <strong>volume &times; (1 + uplift) &times; handle time</strong>,
          divided by that row&rsquo;s own effective productive minutes. Handle time and uplift left
          blank inherit the global figure above; a row that measures its own overrides it. The
          portfolio figure is the sum of these rows, which is not the same number as portfolio volume
          divided by an average handle time — averaging a denominator is not the same as averaging the
          result, and the difference grows with how uneven the rows are.
        </Note>
      </div>
    </Panel>
  );
}
