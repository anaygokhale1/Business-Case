"use client";

/**
 * Batch 7 — Q21. Task-level times and volumes, scoped by region.
 *
 * This batch answers one question that Batch 6 also asks: how long one unit of work
 * takes. It is the more defensible answer, because it shows which tasks the time is
 * going into. It does NOT add demand — the register's volume is still the demand — and
 * the panel says so, because the overlap is the thing that confuses people.
 *
 * The reconciliation is the reason it matters: Sigma(task volume x minutes) is
 * identically equal to (total volume) x (weighted average), so a study whose volumes do
 * not tie to the register is weighted by the wrong task mix.
 */

import { useState } from "react";

import { useCaseStore } from "../../hooks/use-case-store";
import type { AnswerStatus } from "../../lib/case-questions";
import { regionsOf } from "../../lib/case-reducer";
import {
  studyRowsForRegion,
  studyRowsPortfolio,
  studyVolume,
  weightedAverageHandleTime,
} from "../../lib/engine/drivers";
import type { TimeStudyRow } from "../../lib/engine/types";
import { fte } from "../../lib/format";
import {
  ghostButtonClass,
  inputClass,
  Note,
  NumberInput,
  Panel,
  pillClass,
  primaryButtonClass,
} from "./fields";
import { StudyImport } from "./study-import";

/** `null` is the portfolio-wide scope. */
type Scope = string | null;

const scopeLabel = (scope: Scope) => scope ?? "All regions";

export function BatchTimeStudy({
  status,
  blurb,
}: {
  status: Record<string, AnswerStatus>;
  blurb: string;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const { timeStudy, globals, meta } = workingCase;
  const regions = regionsOf(workingCase);

  const [scope, setScope] = useState<Scope>(null);
  const [importing, setImporting] = useState(false);

  const active = globals.handleTimeSource === "Time Study";
  const workload = meta.workloadUnitName.trim() || "unit";

  // Indices are carried alongside the rows because the reducer addresses rows by their
  // position in the full array, and this view shows a filtered subset.
  const entries = timeStudy
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => (scope === null ? row.region === undefined : row.region === scope));

  const scopeRows = entries.map((e) => e.row);
  const weighted = weightedAverageHandleTime(scopeRows);
  const studied = studyVolume(scopeRows);
  const totalStudyVolume = studyVolume(scopeRows);

  const registerVolume = workingCase.units
    .filter((u) => (scope === null ? true : u.region === scope))
    .reduce((acc, u) => acc + (typeof u.volume === "number" ? u.volume : 0), 0);

  const coverage = registerVolume > 0 && studied > 0 ? studied / registerVolume : null;
  const unitsInScope = scope === null ? [] : workingCase.units.filter((u) => u.region === scope);

  return (
    <Panel
      title="Time study"
      blurb={blurb}
      aside={
        <div className="rounded-2xl bg-canvas px-4 py-3 text-right">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            {scopeLabel(scope)} average
          </p>
          <p className="text-xl font-extrabold tabular-nums text-ink">
            {Number.isNaN(weighted) ? "n/a" : `${weighted.toFixed(1)} min`}
          </p>
        </div>
      }
    >
      <div className="space-y-6">
        {/* ---- what this batch is for, versus the previous one ---- */}
        <Note>
          <strong>This does not add demand.</strong> Annual volume in the Workload step is the
          demand the case is sized against. What a study changes is the{" "}
          <strong>handle time</strong> — instead of one figure you assert, it is a volume-weighted
          average of the tasks below. If you already have a single measured average, this whole step
          can be skipped.
        </Note>

        {/* ---- scope selector ---- */}
        <div className="space-y-2">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            Study scope <span className="text-slate-300">Q21</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setScope(null)}
              aria-pressed={scope === null}
              className={pillClass(scope === null)}
              title="Tasks that apply to every region without a study of its own"
            >
              All regions
              {studyRowsPortfolio(timeStudy).length > 0
                ? ` · ${studyRowsPortfolio(timeStudy).length}`
                : ""}
            </button>
            {regions.map((region) => {
              const count = studyRowsForRegion(timeStudy, region).length;
              return (
                <button
                  key={region}
                  type="button"
                  onClick={() => setScope(region)}
                  aria-pressed={scope === region}
                  className={pillClass(scope === region)}
                >
                  {region}
                  {count > 0 ? ` · ${count}` : ""}
                </button>
              );
            })}
          </div>
          {regions.length === 0 ? (
            <p className="text-xs text-outline">
              Add regions in the Scope step to measure tasks region by region.
            </p>
          ) : null}
        </div>

        {/* ---- upload ---- */}
        {importing ? (
          <StudyImport scope={scope} onDone={() => setImporting(false)} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={ghostButtonClass} onClick={() => setImporting(true)}>
              Upload a study for {scopeLabel(scope)}
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() =>
                dispatch(scope === null ? { type: "timeStudy/add" } : { type: "timeStudy/add", region: scope })
              }
            >
              + Add a task row
            </button>
            {!active && timeStudy.length > 0 ? (
              <button
                type="button"
                className={primaryButtonClass}
                onClick={() =>
                  dispatch({ type: "globals/setChoice", patch: { handleTimeSource: "Time Study" } })
                }
              >
                Use these studies
              </button>
            ) : null}
          </div>
        )}

        {!active && timeStudy.length > 0 ? (
          <Note>
            The handle-time source is set to <strong>Manual</strong>, so these rows are recorded but
            no figure on the case comes from them.
          </Note>
        ) : null}

        {/* ---- rows ---- */}
        {entries.length === 0 ? (
          <div className="rounded-2xl bg-canvas px-4 py-3 text-xs text-muted">
            No tasks recorded for {scopeLabel(scope)}.
            {scope !== null
              ? " Without its own study this region falls back to the portfolio-wide figure, and the case will say so."
              : ""}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left">
                  <th className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Task
                  </th>
                  <th className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Region
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Minutes
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Annual {workload}
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Share
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Minutes contributed
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {entries.map(({ row, index }) => (
                  <StudyRow
                    key={index}
                    row={row}
                    index={index}
                    regions={regions}
                    totalVolume={totalStudyVolume}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200">
                  <td className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    {scopeLabel(scope)}
                  </td>
                  <td />
                  <td className="px-4 py-3 text-right font-extrabold tabular-nums text-ink">
                    {Number.isNaN(weighted) ? "n/a" : weighted.toFixed(1)}
                  </td>
                  <td className="px-4 py-3 text-right font-extrabold tabular-nums text-ink">
                    {studied.toLocaleString("en-US")}
                  </td>
                  <td />
                  <td className="px-4 py-3 text-right font-extrabold tabular-nums text-ink">
                    {Math.round(
                      scopeRows.reduce((acc, r) => acc + r.minutes * r.volume, 0),
                    ).toLocaleString("en-US")}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ---- reconciliation ---- */}
        {coverage !== null ? (
          <div
            className={`space-y-2 rounded-2xl px-4 py-3 ${
              Math.abs(coverage - 1) > 0.02 ? "bg-red-50" : "bg-canvas"
            }`}
          >
            <p className="text-xs text-muted">
              This study covers{" "}
              <strong className={Math.abs(coverage - 1) > 0.02 ? "text-red-700" : "text-ink"}>
                {Math.round(coverage * 100)}%
              </strong>{" "}
              of the volume in the register for {scopeLabel(scope)} — {fte(studied, 0)} studied
              against {fte(registerVolume, 0)} registered.
            </p>
            {Math.abs(coverage - 1) > 0.02 ? (
              <p className="text-xs text-red-700">
                These should tie. Total volume times the weighted average is exactly the sum of
                minutes across the tasks, so if the two volumes differ the study is describing
                different work from the case — and the average is weighted by the wrong task mix.
              </p>
            ) : null}
            {scope !== null && unitsInScope.length === 1 && Math.abs(coverage - 1) > 0.02 ? (
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => dispatch({ type: "timeStudy/adoptVolume", region: scope })}
              >
                Set {scope}&rsquo;s demand to the studied {studied.toLocaleString("en-US")}
              </button>
            ) : null}
            {scope !== null && unitsInScope.length > 1 && Math.abs(coverage - 1) > 0.02 ? (
              <p className="text-xs text-outline">
                {scope} has {unitsInScope.length} rows, so there is no non-arbitrary way to split the
                studied volume between them. Adjust the volumes in the Workload step.
              </p>
            ) : null}
          </div>
        ) : null}

        {timeStudy.length > 0 ? (
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => {
              if (window.confirm("Remove every task row from every region?")) {
                dispatch({ type: "timeStudy/clear" });
              }
            }}
          >
            Clear all studies
          </button>
        ) : null}

        <Note>
          The average is weighted by volume, not a plain average of the task times: a 44-minute task
          that happens rarely and an 18-minute task that happens constantly do not contribute
          equally. A region with its own study uses its own figure. A region without one falls back
          to the portfolio-wide study, and then to the manual figure — never to another region&rsquo;s
          measurement, because how work is done in one place is not evidence about another.
        </Note>
      </div>
    </Panel>
  );
}

function StudyRow({
  row,
  index,
  regions,
  totalVolume,
}: {
  row: TimeStudyRow;
  index: number;
  regions: string[];
  totalVolume: number;
}) {
  const { dispatch } = useCaseStore();

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-3">
        <input
          type="text"
          className={`${inputClass} min-w-[12rem]`}
          value={row.taskType}
          placeholder="New claim intake"
          aria-label={`Task type for row ${index + 1}`}
          onChange={(event) =>
            dispatch({ type: "timeStudy/set", index, patch: { taskType: event.target.value } })
          }
        />
      </td>
      <td className="px-4 py-3">
        <select
          className={`${inputClass} min-w-[9rem]`}
          value={row.region ?? ""}
          aria-label={`Region for task row ${index + 1}`}
          onChange={(event) =>
            dispatch({
              type: "timeStudy/setRegion",
              index,
              region: event.target.value === "" ? null : event.target.value,
            })
          }
        >
          <option value="">All regions</option>
          {/* A region the row carries but which no longer exists in the register would
              otherwise silently rebind the row to the first option. */}
          {row.region !== undefined && !regions.includes(row.region) ? (
            <option value={row.region}>{row.region} (not in the register)</option>
          ) : null}
          {regions.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <NumberInput
          ariaLabel={`Minutes for task row ${index + 1}`}
          value={row.minutes}
          onChange={(v) => dispatch({ type: "timeStudy/set", index, patch: { minutes: v ?? 0 } })}
          dp={2}
        />
      </td>
      <td className="px-4 py-3">
        <NumberInput
          ariaLabel={`Volume for task row ${index + 1}`}
          value={row.volume}
          onChange={(v) => dispatch({ type: "timeStudy/set", index, patch: { volume: v ?? 0 } })}
          dp={0}
        />
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted">
        {totalVolume === 0 ? "—" : `${((row.volume / totalVolume) * 100).toFixed(1)}%`}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted">
        {Math.round(row.minutes * row.volume).toLocaleString("en-US")}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          className={ghostButtonClass}
          onClick={() => dispatch({ type: "timeStudy/remove", index })}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}
