"use client";

import { useState } from "react";

import { useCaseStore } from "../../hooks/use-case-store";
import { HANDLE_TIME_SOURCES } from "../../lib/case-defaults";
import type { AnswerStatus } from "../../lib/case-questions";
import { resolveGlobals } from "../../lib/engine/drivers";
import { SENTINEL } from "../../lib/engine/types";
import {
  ChoiceField,
  FieldGrid,
  ghostButtonClass,
  Note,
  NumberField,
  NumberInput,
  Panel,
  PercentField,
  TextField,
} from "./fields";
import { UnitGrid, type UnitColumn } from "./unit-grid";
import { VolumeImport } from "./volume-import";

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
  const [importing, setImporting] = useState(false);

  // Reported together on purpose: a total that silently excluded the blank rows would
  // read as the portfolio's demand while describing only part of it.
  const totalVolume = workingCase.units.reduce(
    (total, u) => total + (typeof u.volume === "number" ? u.volume : 0),
    0,
  );
  const uncovered = workingCase.units.filter((u) => typeof u.volume !== "number").length;

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

        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
              Volume per row <span className="text-slate-300">Q17 · Q18</span>
            </p>
            {importing ? null : (
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => setImporting(true)}
              >
                Upload a volumes study
              </button>
            )}
          </div>

          {importing ? <VolumeImport onDone={() => setImporting(false)} /> : null}

          <UnitGrid
            columns={columns}
            emptyMessage="No rows yet — add a region in the Scope step, or upload a volumes study and let it create them."
          />

          {totalVolume > 0 ? (
            <p className="text-xs text-muted">
              <span className="font-semibold text-ink">
                {totalVolume.toLocaleString("en-US")} {workload || "units"}
              </span>{" "}
              across {workingCase.units.length} row{workingCase.units.length === 1 ? "" : "s"}
              {uncovered > 0 ? (
                <>
                  , with{" "}
                  <span className="font-semibold text-red-600">
                    {uncovered} row{uncovered === 1 ? "" : "s"} carrying no volume
                  </span>{" "}
                  and contributing no required capacity
                </>
              ) : null}
              .
            </p>
          ) : null}
        </div>

        <Note>
          <strong>Handle time can come from three places.</strong> You assert one average here; the
          Time Study step derives it from task-level times and volumes; or the volumes study above
          carries a handle time per row and each region takes its own, volume-weighted. A row&rsquo;s
          own figure always wins over the global. The Time Study adds no demand of its own — annual
          volume is still what the case is sized against — so if you already have a measured
          average, that step can be marked not applicable.
        </Note>

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
