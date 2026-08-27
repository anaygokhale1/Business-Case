"use client";

import { useState } from "react";

import { useCaseStore } from "../../hooks/use-case-store";
import { HANDLE_TIME_SOURCES } from "../../lib/case-defaults";
import { count } from "../../lib/format";
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
import { RoleMoveSummary } from "./role-move-summary";
import { TaskGrid } from "./task-grid";
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

  // The register questions belong to the reduction model. Once a case is a capacity case
  // they are not unanswered, they are not asked — so showing them would invite someone to
  // fill in a register nothing reads.
  const capacityModel = workingCase.model === "capacity";
  const capacity = workingCase.capacity;
  const totalTransactions = (capacity?.demand ?? []).reduce(
    (total, cell) => total + (typeof cell.submissions === "number" ? cell.submissions : 0),
    0,
  );
  const typesWithoutVolume = (capacity?.demand ?? []).filter(
    (cell) => typeof cell.submissions !== "number",
  );

  // Capacity right-sizing is the one core problem whose whole question is which work moves
  // where, so the future-role column belongs beside the volume rather than a step away. On
  // any other core problem it is a column of decisions nobody is being asked to make.
  const rightSizing = meta.coreProblem === "Capacity Right-sizing";

  const columns: UnitColumn[] = [
    {
      key: "volume",
      label: "Annual volume",
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
        {/* ---- the task table: the same rows the uploads produce ---- */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
              Volume by task <span className="text-slate-300">C2</span>
            </p>
            <span className="text-xs text-outline">
              Same rows as the Time study step &middot; one volume per task type
            </span>
          </div>

          {rightSizing ? (
            <p className="rounded-2xl bg-canvas px-4 py-3 text-xs text-muted">
              <strong className="text-ink">Which work stays and which moves.</strong> Set a future
              role on a task to move it; leave it blank and the work stays with the current role.
              A future role named System, RPA, Bot or Automation takes the work out of human
              capacity altogether. The comparison beneath the table follows every change.
            </p>
          ) : null}

          <TaskGrid
            // Right-sizing gets the handling time too. The two steps otherwise own different
            // columns of one table, but a screen whose whole job is the stay-or-move analysis
            // cannot compute it without the minutes, and sending the user to another step for
            // them means the comparison below sits empty while the decision is being made.
            columns={
              rightSizing
                ? ["task", "taskType", "currentRole", "targetRole", "aht", "volume", "minutes"]
                : ["task", "taskType", "currentRole", "volume", "minutes"]
            }
            addLabel="+ Add a task"
            emptyMessage="No tasks yet. Add them here or upload a time study and a volumes study in the Time study & volumes step — it is the same table either way."
          />

          {capacity && capacity.rows.length > 0 ? (
            <p className="text-xs text-muted">
              <span className="font-semibold text-ink">
                {count(totalTransactions)} {workload || "transactions"}
              </span>{" "}
              across {capacity.demand.length} task type
              {capacity.demand.length === 1 ? "" : "s"}
              {typesWithoutVolume.length > 0 ? (
                <>
                  , with{" "}
                  <span className="font-semibold text-red-600">
                    {typesWithoutVolume.map((c) => c.transactionType).join(", ")} carrying no volume
                  </span>{" "}
                  — those tasks contribute nothing to either capacity state
                </>
              ) : null}
              .
            </p>
          ) : null}

          {rightSizing && capacity && capacity.rows.length > 0 ? (
            <RoleMoveSummary capacity={capacity} globals={globals} />
          ) : null}
        </div>

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
          {capacityModel ? null : (
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
          )}
          {capacityModel ? null : (
          <PercentField
            label={`Volume uplift over ${globals.horizonYears} years`}
            questionId="Q22"
            status={status["Q22"]}
            value={globals.upliftPct}
            onChange={(v) => dispatch({ type: "globals/setNumber", field: "upliftPct", value: v ?? 0 })}
            hint="Demand growth applied to volume before sizing. Zero if none."
          />
          )}
          {capacityModel ? null : (
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
          )}
        </FieldGrid>

        {capacityModel ? null : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
              Volume per region <span className="text-slate-300">Q17 · Q18</span>
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
            emptyMessage="No teams yet — add a region in the Scope step, or upload a volumes study and let it create them."
          />

          {totalVolume > 0 ? (
            <p className="text-xs text-muted">
              <span className="font-semibold text-ink">
                {totalVolume.toLocaleString("en-US")} {workload || "units"}
              </span>{" "}
              across {workingCase.units.length} team{workingCase.units.length === 1 ? "" : "s"}
              {uncovered > 0 ? (
                <>
                  , with{" "}
                  <span className="font-semibold text-red-600">
                    {uncovered} team{uncovered === 1 ? "" : "s"} carrying no volume
                  </span>{" "}
                  and contributing no required capacity
                </>
              ) : null}
              .
            </p>
          ) : null}
        </div>
        )}

        {capacityModel ? (
          <Note>
            <strong>Handling time lives on the task, not here.</strong> Each task carries its
            own, entered in the Time study step or read from an uploaded study, and required
            FTE per role is the sum over tasks of{" "}
            <strong>volume &times; handling time</strong> divided by that role&rsquo;s own
            productive minutes. There is no single average to assert, and no blended figure is
            computed — a portfolio average handle time divided into a portfolio volume is not
            the same number as the sum of the tasks, and the gap grows with how uneven they are.
          </Note>
        ) : (
        <Note>
          <strong>Handle time can come from three places.</strong> You assert one average here; the
          Time Study step derives it from task-level times and volumes; or the volumes study above
          carries a handle time per row and each region takes its own, volume-weighted. A row&rsquo;s
          own figure always wins over the global. The Time Study adds no demand of its own — annual
          volume is still what the case is sized against — so if you already have a measured
          average, that step can be marked not applicable.
        </Note>
        )}

        {capacityModel ? null : (
        <Note>
          Required FTE for a row is <strong>volume &times; (1 + uplift) &times; handle time</strong>,
          divided by that row&rsquo;s own effective productive minutes. Handle time and uplift left
          blank inherit the global figure above; a row that measures its own overrides it. The
          portfolio figure is the sum of these rows, which is not the same number as portfolio volume
          divided by an average handle time — averaging a denominator is not the same as averaging the
          result, and the difference grows with how uneven the rows are.
        </Note>
        )}
      </div>
    </Panel>
  );
}
