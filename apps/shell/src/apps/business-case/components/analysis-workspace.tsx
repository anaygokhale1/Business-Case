"use client";

/**
 * The Analysis tab: where the reduction can come from, rather than what it is worth.
 *
 * The Business case tab answers the portfolio question with one percentage against one
 * blended cost. This one takes both apart — team by team, region by region, at several
 * reduction steps — because "12% saves £4m" and "which teams can give up 12%" are different
 * questions and only the second one can be acted on.
 *
 * The heat map's optimum is a capacity constraint, not a maximum. Net saving rises with every
 * extra point of reduction, so a grid without a constraint has its best cell in the far corner
 * and tells you nothing. What bounds a real cut is each row's own surplus, so the frontier is
 * marked per row and cells past it are drawn as unavailable rather than as larger savings.
 */

import { useMemo, useState } from "react";

import { useCaseStore } from "../hooks/use-case-store";
import { isMissing } from "../lib/engine/alg";
import {
  currentVersusTarget,
  DEFAULT_REDUCTION_STEPS,
  reductionSensitivity,
  type Grain,
  type SensitivityCell,
  type SensitivityGrid,
  type SensitivityRow,
  type StateBar,
} from "../lib/engine/sensitivity";
import {
  rampFill,
  rampInk,
  SAVING_RAMP,
  SERIES_CURRENT,
  SERIES_TARGET,
} from "../lib/chart-palette";
import { count, currency, currencyCompact, fte, pct } from "../lib/format";

type Measure = "fte" | "cost";

const GRAIN_LABEL: Record<Grain, string> = { region: "Regions", team: "Teams" };

export function AnalysisWorkspace() {
  const { workingCase } = useCaseStore();
  const [grain, setGrain] = useState<Grain>("region");
  const [measure, setMeasure] = useState<Measure>("fte");
  const [selected, setSelected] = useState<string | null>(null);

  const bars = useMemo(() => currentVersusTarget(workingCase, grain), [workingCase, grain]);
  const grid = useMemo(
    () => reductionSensitivity(workingCase, { grain, steps: [...DEFAULT_REDUCTION_STEPS] }),
    [workingCase, grain],
  );
  const teamGrid = useMemo(
    () => reductionSensitivity(workingCase, { grain: "team", steps: [...DEFAULT_REDUCTION_STEPS] }),
    [workingCase],
  );

  if (workingCase.model === "capacity") {
    return <CapacityNotice />;
  }

  if (workingCase.units.length === 0) {
    return (
      <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <h1 className="text-2xl font-extrabold text-ink">Analysis</h1>
        <p className="mt-2 text-sm text-muted">
          Nothing to analyse yet. Add regions and teams in the Input tab, with headcount, cost
          and volume against each, and this tab fills in.
        </p>
      </div>
    );
  }

  const selectedRow = grid.rows.find((r) => r.key === selected) ?? null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-6 rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Analysis</h1>
          <p className="mt-1 text-sm text-muted">
            {workingCase.units.length} team{workingCase.units.length === 1 ? "" : "s"} across{" "}
            {new Set(workingCase.units.map((u) => u.region)).size} region
            {new Set(workingCase.units.map((u) => u.region)).size === 1 ? "" : "s"} &middot; where
            the reduction can come from, and what each step is worth
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            Group by
          </span>
          {(["region", "team"] as Grain[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={grain === option}
              onClick={() => {
                setGrain(option);
                setSelected(null);
              }}
              className={
                grain === option
                  ? "rounded-full bg-ink px-4 py-2 text-sm font-bold text-white"
                  : "rounded-full border border-slate-200 bg-canvas px-4 py-2 text-sm font-semibold text-muted transition hover:border-ink/40 hover:text-ink"
              }
            >
              {GRAIN_LABEL[option]}
            </button>
          ))}
        </div>
      </header>

      <StateChart
        bars={bars}
        grain={grain}
        measure={measure}
        onMeasure={setMeasure}
        selected={selected}
        onSelect={setSelected}
      />

      <HeatMap grid={grid} selected={selected} onSelect={setSelected} />

      {selectedRow ? (
        <DrillDown
          row={selectedRow}
          grid={grid}
          bar={bars.find((b) => b.key === selectedRow.key) ?? null}
          teamRows={
            grain === "region"
              ? teamGrid.rows.filter((r) => r.region === selectedRow.key)
              : []
          }
          onClose={() => setSelected(null)}
        />
      ) : (
        <p className="px-2 text-xs text-outline">
          Select a {grain === "region" ? "region" : "team"} in either chart to drill into it.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Current against target                                                     */
/* -------------------------------------------------------------------------- */

function StateChart({
  bars,
  grain,
  measure,
  onMeasure,
  selected,
  onSelect,
}: {
  bars: StateBar[];
  grain: Grain;
  measure: Measure;
  onMeasure: (m: Measure) => void;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const valueOf = (bar: StateBar, side: "current" | "required") =>
    measure === "fte"
      ? side === "current"
        ? bar.currentFte
        : bar.requiredFte
      : side === "current"
        ? bar.currentCost
        : bar.requiredCost;

  // One scale across every bar, so a small team reads as small rather than being stretched
  // to the width of the panel.
  const scale = bars.reduce((max, bar) => {
    const a = valueOf(bar, "current");
    const b = valueOf(bar, "required");
    return Math.max(max, isMissing(a) ? 0 : a, isMissing(b) ? 0 : b);
  }, 0);

  const show = (value: number) =>
    isMissing(value) ? "n/a" : measure === "fte" ? fte(value, 1) : currencyCompact(value);

  return (
    <section className="space-y-5 rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-ink">Current state against target state</h2>
          <p className="mt-1 text-sm text-muted">
            In place today against what the measured demand needs. The target is the{" "}
            <strong className="text-ink">requirement</strong>, not a chosen reduction — so the
            gap is evidence rather than an assumption.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(["fte", "cost"] as Measure[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={measure === option}
              onClick={() => onMeasure(option)}
              className={
                measure === option
                  ? "rounded-full bg-ink px-4 py-2 text-xs font-bold text-white"
                  : "rounded-full border border-slate-200 bg-canvas px-4 py-2 text-xs font-semibold text-muted transition hover:border-ink/40 hover:text-ink"
              }
            >
              {option === "fte" ? "FTE" : "Annual cost"}
            </button>
          ))}
        </div>
      </div>

      <Legend
        items={[
          { label: "Current state", fill: SERIES_CURRENT },
          { label: "Target state", fill: SERIES_TARGET },
        ]}
      />

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" aria-label="Current against target">
          <thead>
            <tr className="text-left">
              {[
                { label: GRAIN_LABEL[grain].replace(/s$/, ""), align: "" },
                { label: "Current vs target", align: "" },
                { label: "Current", align: "text-right" },
                { label: "Target", align: "text-right" },
                { label: "Surplus / (deficit)", align: "text-right" },
              ].map(({ label, align }) => (
                <th
                  key={label}
                  className={`px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline ${align}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bars.map((bar) => {
              const current = valueOf(bar, "current");
              const required = valueOf(bar, "required");
              return (
                <tr
                  key={bar.key}
                  className={`cursor-pointer border-t border-slate-100 transition ${
                    selected === bar.key ? "bg-canvas" : "hover:bg-canvas/60"
                  }`}
                  onClick={() => onSelect(selected === bar.key ? null : bar.key)}
                >
                  <td className="px-4 py-3">
                    <span className="font-semibold text-ink">{bar.label}</span>
                    {grain === "team" && bar.region !== bar.label ? (
                      <span className="text-muted"> &middot; {bar.region}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex min-w-[8rem] flex-col gap-[2px]">
                      <Bar
                        value={current}
                        scale={scale}
                        fill={SERIES_CURRENT}
                        title={`${bar.label} — current: ${show(current)}`}
                      />
                      <Bar
                        value={required}
                        scale={scale}
                        fill={SERIES_TARGET}
                        title={`${bar.label} — target: ${show(required)}`}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{show(current)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{show(required)}</td>
                  <td className="px-4 py-3 text-right">
                    <Surplus
                      value={
                        isMissing(current) || isMissing(required) ? NaN : current - required
                      }
                      measure={measure}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The heat map                                                               */
/* -------------------------------------------------------------------------- */

function HeatMap({
  grid,
  selected,
  onSelect,
}: {
  grid: SensitivityGrid;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  // The ramp is scaled to the largest FEASIBLE saving in view. Scaling to the largest
  // arithmetic saving would put the darkest colour on a cell nobody can act on and wash
  // out every cell that is actually available.
  const peak = grid.rows.reduce(
    (max, row) =>
      row.cells.reduce(
        (m, cell) => (cell.feasible && !isMissing(cell.netYearOne) ? Math.max(m, cell.netYearOne) : m),
        max,
      ),
    0,
  );

  return (
    <section className="space-y-5 rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
      <div>
        <h2 className="text-xl font-extrabold text-ink">Reduction sensitivity</h2>
        <p className="mt-1 text-sm text-muted">
          Year-one net saving at each reduction step, per{" "}
          {grid.grain === "region" ? "region" : "team"}, at that row&rsquo;s own cost and after
          its own severance. The marked cell is the largest cut that stays inside the row&rsquo;s
          surplus.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-5 text-xs">
        <span className="flex items-center gap-2 font-semibold text-muted">
          Smaller
          {SAVING_RAMP.map((fill) => (
            <span
              key={fill}
              aria-hidden
              className="h-3 w-6 rounded-[2px]"
              style={{ backgroundColor: fill }}
            />
          ))}
          Larger saving
        </span>
        <span className="flex items-center gap-2 font-semibold text-muted">
          <span
            aria-hidden
            className="h-3 w-6 rounded-[2px] ring-2 ring-ink"
            style={{ backgroundColor: SAVING_RAMP[3] }}
          />
          Optimal — at the row&rsquo;s frontier
        </span>
        <span className="flex items-center gap-2 font-semibold text-muted">
          <span aria-hidden className="h-3 w-6 rounded-[2px]" style={{ background: STRIPES }} />
          Cuts into required capacity
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" aria-label="Reduction sensitivity">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                {GRAIN_LABEL[grid.grain].replace(/s$/, "")}
              </th>
              <th className="px-3 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                Frontier
              </th>
              {grid.steps.map((step) => (
                <th
                  key={step}
                  className="px-3 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline"
                >
                  {pct(step, 0)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr
                key={row.key}
                className={`cursor-pointer border-t border-slate-100 ${
                  selected === row.key ? "bg-canvas" : ""
                }`}
                onClick={() => onSelect(selected === row.key ? null : row.key)}
              >
                <td className="px-4 py-2">
                  <span className="font-semibold text-ink">{row.label}</span>
                  {row.masksTeamDeficit ? (
                    <span
                      className="ml-1 font-bold text-red-600"
                      title="This region is feasible at a step one of its teams is not. The roll-up only holds if the work can move between them."
                    >
                      *
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {isMissing(row.frontierPct) ? (
                    <span className="text-outline" title="Requirement unknown, so no bound">
                      n/a
                    </span>
                  ) : (
                    pct(row.frontierPct, 1)
                  )}
                </td>
                {row.cells.map((cell) => (
                  <HeatCell key={cell.pct} cell={cell} row={row} peak={peak} />
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200">
              <td className="px-4 py-3 font-bold text-ink">Total</td>
              <td className="px-3 py-3 text-right tabular-nums text-muted">
                {isMissing(grid.portfolioFrontierPct) ? "n/a" : pct(grid.portfolioFrontierPct, 1)}
              </td>
              {grid.totals.map((cell) => (
                <td
                  key={cell.pct}
                  className="px-3 py-3 text-right tabular-nums text-ink"
                  title={
                    cell.feasible
                      ? `${fte(cell.reducedFte, 1)} FTE out`
                      : `${fte(cell.reducedFte, 1)} FTE out — at least one row is over its frontier here`
                  }
                >
                  <span className={cell.feasible ? "font-bold" : "font-bold text-outline"}>
                    {isMissing(cell.netYearOne) ? "n/a" : currencyCompact(cell.netYearOne)}
                  </span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-slate-100">
              <td className="px-4 py-2 text-xs font-semibold text-outline" colSpan={2}>
                Manager reduction
              </td>
              {grid.managerReduction.map((managers, i) => (
                <td
                  key={i}
                  className="px-3 py-2 text-right text-xs tabular-nums text-muted"
                  title="From the portfolio CEILING against the target span. Not allocated to rows, because CEILING does not commute with addition."
                >
                  {managers === 0 ? "—" : fte(managers, 0)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <ul className="space-y-1 text-xs text-muted">
        <li>
          <span className="font-semibold text-outline">Frontier</span> is that row&rsquo;s surplus
          over its current FTE — the largest cut that leaves enough capacity for its measured
          demand. The portfolio frontier is the{" "}
          <strong className="text-ink">tightest row&rsquo;s</strong>, not the total surplus over
          total FTE: a uniform cut is bounded by the first team it breaks.
        </li>
        <li>
          <span className="font-semibold text-outline">Managers</span> are not in the cells.
          Required managers come from a CEILING at portfolio level, and CEILING does not commute
          with addition, so there is no honest per-row figure. The row above the notes carries
          the portfolio effect instead.
        </li>
        {grid.uncostedFte > 0 ? (
          <li>
            <span className="font-semibold text-red-600">
              {fte(grid.uncostedFte, 1)} FTE carries no cost
            </span>{" "}
            and is absent from every money figure here. The portfolio headline on the Business
            case tab extends the blended rate across it, so the two differ by exactly that FTE.
          </li>
        ) : null}
        {grid.rows.some((r) => r.masksTeamDeficit) ? (
          <li>
            <span className="font-semibold text-red-600">*</span> marks a region whose own surplus
            covers a deficit in one of its teams. Deliverable only if the work can actually move
            between those teams — group by Teams to see which one.
          </li>
        ) : null}
        <li>
          Severance is {grid.severanceWeeks} week
          {grid.severanceWeeks === 1 ? "" : "s"} of the row&rsquo;s own rate. Consulting cost is a
          portfolio figure and is not allocated to rows, so these cells are gross of it.
        </li>
      </ul>
    </section>
  );
}

/** A 45° hatch in the surface colour, marking a cell that is arithmetic rather than an option. */
const STRIPES =
  "repeating-linear-gradient(45deg, #eef1f4 0 3px, #ffffff 3px 6px)";

function HeatCell({
  cell,
  row,
  peak,
}: {
  cell: SensitivityCell;
  row: SensitivityRow;
  peak: number;
}) {
  const share = peak > 0 && !isMissing(cell.netYearOne) ? cell.netYearOne / peak : 0;

  const title = isMissing(cell.netYearOne)
    ? `${row.label} at ${pct(cell.pct, 0)}: ${fte(cell.reducedFte, 1)} FTE out, but this row has no cost so the saving is unknown`
    : `${row.label} at ${pct(cell.pct, 0)}: ${fte(cell.reducedFte, 1)} FTE x ${currency(
        row.costPerFte,
      )} = ${currency(cell.grossSaving)} gross, less ${currency(cell.severance)} severance` +
      (cell.feasible
        ? cell.optimal
          ? " — the largest cut inside this row's surplus"
          : ""
        : ` — beyond this row's ${isMissing(row.frontierPct) ? "unknown" : pct(row.frontierPct, 1)} frontier, so it cuts into required capacity`);

  if (cell.pct === 0) {
    return (
      <td className="px-3 py-2 text-right text-xs tabular-nums text-outline" title="No change">
        —
      </td>
    );
  }

  if (!cell.feasible) {
    return (
      <td className="p-1" title={title}>
        <div
          className="rounded-[4px] px-2 py-1.5 text-right text-xs tabular-nums text-outline"
          style={{ background: STRIPES }}
        >
          {isMissing(cell.netYearOne) ? "n/a" : currencyCompact(cell.netYearOne)}
        </div>
      </td>
    );
  }

  return (
    <td className="p-1" title={title}>
      <div
        className={`rounded-[4px] px-2 py-1.5 text-right text-xs font-semibold tabular-nums ${
          cell.optimal ? "ring-2 ring-ink" : ""
        }`}
        style={{
          backgroundColor: isMissing(cell.netYearOne) ? "#eef1f4" : rampFill(share),
          color: isMissing(cell.netYearOne) ? "#6b7280" : rampInk(share),
        }}
      >
        {isMissing(cell.netYearOne) ? "n/a" : currencyCompact(cell.netYearOne)}
      </div>
    </td>
  );
}

/* -------------------------------------------------------------------------- */
/* Drill-down                                                                 */
/* -------------------------------------------------------------------------- */

function DrillDown({
  row,
  grid,
  bar,
  teamRows,
  onClose,
}: {
  row: SensitivityRow;
  grid: SensitivityGrid;
  bar: StateBar | null;
  teamRows: SensitivityRow[];
  onClose: () => void;
}) {
  const optimal = row.cells.find((c) => c.optimal) ?? null;

  return (
    <section className="space-y-5 rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-ink">{row.label}</h2>
          <p className="mt-1 text-sm text-muted">
            {grid.grain === "region"
              ? `${teamRows.length} team${teamRows.length === 1 ? "" : "s"} in this region`
              : `In ${row.region}`}
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-canvas px-4 py-2 text-xs font-semibold text-muted transition hover:border-ink/40 hover:text-ink"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Current FTE", value: fte(row.currentFte, 1) },
          { label: "Required FTE", value: fte(row.requiredFte, 1) },
          {
            label: row.surplusFte >= 0 ? "Surplus" : "Deficit",
            value: fte(Math.abs(row.surplusFte), 1),
          },
          {
            label: "Cost per FTE",
            value: isMissing(row.costPerFte) ? "n/a" : currency(row.costPerFte),
          },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl bg-canvas px-4 py-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
              {item.label}
            </p>
            <p className="mt-1 text-xl font-extrabold tabular-nums text-ink">{item.value}</p>
          </div>
        ))}
      </div>

      {optimal ? (
        <p className="rounded-2xl bg-ink px-5 py-4 text-sm text-white">
          <strong>At {pct(optimal.pct, 0)}</strong> this{" "}
          {grid.grain === "region" ? "region" : "team"} sheds{" "}
          {fte(optimal.reducedFte, 1)} FTE for{" "}
          {isMissing(optimal.grossSaving) ? "an unknown saving" : currency(optimal.grossSaving)}{" "}
          gross, less {isMissing(optimal.severance) ? "n/a" : currency(optimal.severance)}{" "}
          severance &mdash;{" "}
          <strong>
            {isMissing(optimal.netYearOne) ? "n/a" : currency(optimal.netYearOne)}
          </strong>{" "}
          in year one. That is the largest cut that leaves enough capacity for{" "}
          {bar && bar.volume > 0 ? `${count(bar.volume)} units of` : "its"} measured demand.
        </p>
      ) : (
        <p className="rounded-2xl bg-canvas px-5 py-4 text-sm text-muted">
          {isMissing(row.frontierPct)
            ? "No bound can be put on this row: its required FTE is unknown, so there is no way to say how much of its headcount is surplus. Enter its volume in the Workload & demand step."
            : "There is no room to cut here — this row's requirement already meets or exceeds its headcount, so every step in the grid would leave it short."}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" aria-label={`${row.label} step by step`}>
          <thead>
            <tr className="text-left">
              {["Reduction", "FTE out", "Gross saving", "Severance", "Net year one", ""].map(
                (label, i) => (
                  <th
                    key={i}
                    className={`px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline ${
                      i > 0 && i < 5 ? "text-right" : ""
                    }`}
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {row.cells
              .filter((cell) => cell.pct > 0)
              .map((cell) => (
                <tr key={cell.pct} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-semibold text-ink">{pct(cell.pct, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">
                    {fte(cell.reducedFte, 2)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink">
                    {isMissing(cell.grossSaving) ? "n/a" : currency(cell.grossSaving)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">
                    {isMissing(cell.severance) ? "n/a" : currency(cell.severance)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink">
                    {isMissing(cell.netYearOne) ? "n/a" : currency(cell.netYearOne)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {cell.optimal ? (
                      <span className="font-bold text-teal">optimal</span>
                    ) : cell.feasible ? (
                      <span className="text-outline">within surplus</span>
                    ) : (
                      <span className="font-semibold text-red-600">cuts into capacity</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {teamRows.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            Teams inside {row.label}
          </p>
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse text-sm"
              aria-label={`Teams inside ${row.label}`}
            >
              <thead>
                <tr className="text-left">
                  {["Team", "Current", "Required", "Surplus", "Frontier", "Optimal step"].map(
                    (label, i) => (
                      <th
                        key={label}
                        className={`px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline ${
                          i > 0 ? "text-right" : ""
                        }`}
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {teamRows.map((team) => {
                  const teamOptimal = team.cells.find((c) => c.optimal) ?? null;
                  const tighter =
                    !isMissing(team.frontierPct) &&
                    !isMissing(row.frontierPct) &&
                    team.frontierPct < row.frontierPct;
                  return (
                    <tr key={team.key} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-semibold text-ink">
                        {team.label}
                        {tighter ? (
                          <span
                            className="ml-1 text-red-600"
                            title="Tighter than the region as a whole — this is the team that bounds a uniform cut."
                          >
                            *
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">
                        {fte(team.currentFte, 1)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">
                        {fte(team.requiredFte, 1)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">
                        {fte(team.surplusFte, 1)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink">
                        {isMissing(team.frontierPct) ? "n/a" : pct(team.frontierPct, 1)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink">
                        {teamOptimal ? pct(teamOptimal.pct, 0) : "none"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            A region can look feasible at a step one of its teams is not, because its surplus
            covers the other&rsquo;s deficit. That only holds if the work can actually move
            between them.
          </p>
        </div>
      ) : null}

    </section>
  );
}

/* -------------------------------------------------------------------------- */

function CapacityNotice() {
  return (
    <div className="space-y-4 rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
      <h1 className="text-2xl font-extrabold text-ink">Analysis</h1>
      <p className="text-sm text-muted">
        This case is a <strong className="text-ink">capacity</strong> case: its target state is a
        reallocation of tasks between roles, not a percentage cut, so there is no reduction axis
        to draw a sensitivity grid against — and it has no team-and-region register to draw one
        for. Current state against target state, by role, is on the{" "}
        <strong className="text-ink">Business case</strong> tab.
      </p>
      <p className="text-xs text-outline">
        The grid here belongs to the register model, where each team carries its own headcount,
        cost and volume and a reduction percentage is the lever.
      </p>
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; fill: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-5 text-xs">
      {items.map((entry) => (
        <span key={entry.label} className="flex items-center gap-2 font-semibold text-muted">
          <span
            aria-hidden
            className="h-2.5 w-6 rounded-[2px]"
            style={{ backgroundColor: entry.fill }}
          />
          {entry.label}
        </span>
      ))}
    </div>
  );
}

function Bar({
  value,
  scale,
  fill,
  title,
}: {
  value: number;
  scale: number;
  fill: string;
  title: string;
}) {
  if (isMissing(value) || scale <= 0) {
    return <span className="block h-2.5 text-[10px] leading-none text-outline">n/a</span>;
  }
  const width = value <= 0 ? 0 : Math.max(1.5, (value / scale) * 100);
  return (
    <span className="block h-2.5 w-full rounded-[2px] bg-panel" title={title}>
      <span
        className="block h-2.5 rounded-r-[4px]"
        style={{ width: `${width}%`, backgroundColor: fill }}
      />
    </span>
  );
}

function Surplus({ value, measure }: { value: number; measure: Measure }) {
  if (isMissing(value)) return <span className="text-xs text-outline">n/a</span>;
  const deficit = value < 0;
  const shown = measure === "fte" ? fte(Math.abs(value), 1) : currencyCompact(Math.abs(value));
  if (Math.abs(value) < 0.005) {
    return <span className="text-xs font-semibold text-outline">none</span>;
  }
  return (
    <span className={`text-sm font-semibold tabular-nums ${deficit ? "text-red-600" : "text-ink"}`}>
      {deficit ? "−" : "+"}
      {shown}
      <span className="ml-1 text-xs">{deficit ? "short" : "spare"}</span>
    </span>
  );
}
