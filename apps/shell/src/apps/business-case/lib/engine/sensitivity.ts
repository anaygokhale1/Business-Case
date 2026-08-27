/**
 * Reduction sensitivity, per team and per region.
 *
 * The portfolio KPIs apply one reduction percentage to one blended cost. That answers
 * "what is this worth" and cannot answer "where can it come from", which is the question a
 * reader asks second and the one an operations lead asks first. So this grid re-derives the
 * saving row by row, at each of several reduction steps, using each row's own cost.
 *
 * **The optimum is a capacity constraint, not a maximum.** Net saving rises with every extra
 * point of reduction, so a grid without a constraint has its best cell in the far corner and
 * says nothing. What bounds a real cut is the row's own surplus: a team can shed the FTE it
 * does not need for its measured demand, and past that point the work stops getting done. So
 * each row carries a frontier — the largest reduction that stays inside its surplus — and the
 * cell at that frontier is the optimum. Cells beyond it are marked infeasible rather than
 * being reported as bigger savings, which is what they arithmetically are and what they are
 * not operationally.
 *
 * **Rows use their own cost, not the blend.** Σ (fte_i x pct x cost_i) equals
 * pct x SUM(fte) x SUMPRODUCT(fte, cost) / SUM(fte) exactly, so at a uniform percentage the
 * rows reconcile to the portfolio figure by construction — provided every row has a cost.
 * Where one does not, the portfolio headline extends the blended rate across FTE that has no
 * cost while this grid can only cost the rows that have one, and the two diverge by exactly
 * that FTE. `uncostedFte` reports it rather than letting the reader find it.
 *
 * **Managers are absent from the grid on purpose.** Required managers come from a CEILING at
 * portfolio level (decision 12), and CEILING does not commute with addition, so there is no
 * honest per-team manager number to put in a cell. The portfolio effect is returned alongside
 * so the grid can say what it is leaving out.
 */

import { MISSING, isMissing, round6 } from "./alg";
import { buildCtx, effectiveCostInputs } from "./drivers";
import { computeUnit } from "./identity";
import { computeManagers } from "./managers";
import { SENTINEL, type Case, type Unit, type UnitResult } from "./types";

/** The reduction steps the grid is drawn at, when the caller does not say. */
export const DEFAULT_REDUCTION_STEPS: readonly number[] = [
  0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.24,
] as const;

export type Grain = "team" | "region";

export interface SensitivityCell {
  pct: number;
  /** FTE this row sheds at this percentage. */
  reducedFte: number;
  /** reducedFte x this row's own all-in front-line cost. */
  grossSaving: number;
  severance: number;
  /** grossSaving - severance. Year one, before any portfolio-level cost. */
  netYearOne: number;
  /**
   * Whether the cut stays inside the row's surplus.
   *
   * False means the row would be short of the capacity its measured demand needs. The
   * saving is still computed — it is what the money would be — but presented as a cut into
   * required capacity rather than as an opportunity.
   */
  feasible: boolean;
  /** The largest feasible step for this row: the optimum. */
  optimal: boolean;
}

export interface SensitivityRow {
  /** Unit id at team grain, region name at region grain. */
  key: string;
  label: string;
  region: string;
  currentFte: number;
  requiredFte: number;
  /** currentFte - requiredFte. Positive is surplus. */
  surplusFte: number;
  /** The row's own FTE-weighted front-line cost, MISSING when it has none. */
  costPerFte: number;
  /** FTE in this row carrying no cost, so excluded from its money. */
  uncostedFte: number;
  /**
   * The largest reduction the row can absorb: surplus / current FTE. MISSING when the
   * requirement is unknown, because "no constraint" and "unknown constraint" are different
   * claims and only one of them is safe to act on.
   */
  frontierPct: number;
  /**
   * Region rows only: true when the region is feasible at a step that one of its teams is
   * not. The region's surplus can cover a team's deficit only if the work can actually move
   * between them, which is an operational claim the model cannot make.
   */
  masksTeamDeficit: boolean;
  cells: SensitivityCell[];
}

export interface SensitivityGrid {
  grain: Grain;
  steps: number[];
  rows: SensitivityRow[];
  /** Column totals as the sum of rows. Never a recomputation from portfolio aggregates. */
  totals: SensitivityCell[];
  /** Portfolio FTE with no cost against it, so absent from every money figure here. */
  uncostedFte: number;
  /** Manager reduction at each step, from the portfolio CEILING. Not allocated to rows. */
  managerReduction: number[];
  /** The step at which the portfolio as a whole stops being feasible. MISSING if never. */
  portfolioFrontierPct: number;
  severanceWeeks: number;
}

/* -------------------------------------------------------------------------- */

/**
 * One row's FTE-weighted front-line cost, and the FTE it could not cost.
 *
 * Mirrors `flattenCostVectors`: a pair where either side is a sentinel is dropped and
 * counted, a zero-FTE role contributes nothing. Deliberately not a plain average of the
 * unit's rates — a unit with 30 processors and 2 leads does not sit halfway between them.
 */
const rowCost = (
  units: Unit[],
  roleIds: readonly string[],
): { costPerFte: number; costedFte: number; uncostedFte: number } => {
  let weighted = 0;
  let costedFte = 0;
  let uncostedFte = 0;

  for (const unit of units) {
    for (const id of roleIds) {
      const fte = unit.headcount[id];
      const cost = unit.cost[id];
      if (fte === undefined || fte === SENTINEL || fte === 0) continue;
      if (cost === undefined || cost === SENTINEL) {
        uncostedFte += fte;
        continue;
      }
      weighted += fte * cost;
      costedFte += fte;
    }
  }

  return {
    costPerFte: costedFte > 0 ? weighted / costedFte : MISSING,
    costedFte,
    uncostedFte,
  };
};

/** Largest reduction a row can absorb before cutting into required capacity. */
const frontier = (currentFte: number, requiredFte: number): number => {
  if (isMissing(requiredFte) || currentFte <= 0) return MISSING;
  // Clamped at zero: a row already short of capacity has no room to cut at all, and a
  // negative frontier would read as though it did.
  return Math.max(0, (currentFte - requiredFte) / currentFte);
};

const buildCells = (
  steps: number[],
  currentFte: number,
  costPerFte: number,
  frontierPct: number,
  severanceWeeks: number,
): SensitivityCell[] => {
  const feasibleAt = (pct: number) =>
    // Pre-rounded before the comparison: a frontier of 0.12 computed from floats can land
    // at 0.11999999999999998, and the step exactly at the frontier is the one cell that
    // most needs to read as feasible.
    isMissing(frontierPct) ? false : round6(pct) <= round6(frontierPct);

  const lastFeasible = steps.reduce(
    (best, pct) => (feasibleAt(pct) ? pct : best),
    Number.NEGATIVE_INFINITY,
  );

  return steps.map((pct) => {
    const reducedFte = currentFte * pct;
    const grossSaving = isMissing(costPerFte) ? MISSING : reducedFte * costPerFte;
    const severance = isMissing(grossSaving) ? MISSING : grossSaving * (severanceWeeks / 52);
    return {
      pct,
      reducedFte,
      grossSaving,
      severance,
      netYearOne: isMissing(grossSaving) ? MISSING : grossSaving - severance,
      feasible: feasibleAt(pct),
      // The zero step is not an optimum — it is doing nothing. A row with no room to cut
      // therefore has no optimal cell, which is the honest answer.
      optimal: pct === lastFeasible && pct > 0,
    };
  });
};

const sumCells = (rows: SensitivityRow[], steps: number[]): SensitivityCell[] =>
  steps.map((pct, i) => {
    let reducedFte = 0;
    let grossSaving = 0;
    let severance = 0;
    let anyMoney = false;

    for (const row of rows) {
      const cell = row.cells[i]!;
      reducedFte += cell.reducedFte;
      if (isMissing(cell.grossSaving)) continue;
      anyMoney = true;
      grossSaving += cell.grossSaving;
      severance += cell.severance;
    }

    return {
      pct,
      reducedFte,
      grossSaving: anyMoney ? grossSaving : MISSING,
      severance: anyMoney ? severance : MISSING,
      netYearOne: anyMoney ? grossSaving - severance : MISSING,
      // A column is feasible only if every row in it is. One team over its frontier makes
      // the portfolio cut undeliverable as stated, whatever the total surplus says.
      feasible: rows.length > 0 && rows.every((r) => r.cells[i]!.feasible),
      optimal: false,
    };
  });

/* -------------------------------------------------------------------------- */

export const reductionSensitivity = (
  c: Case,
  { steps = [...DEFAULT_REDUCTION_STEPS], grain = "team" as Grain } = {},
): SensitivityGrid => {
  const ctx = buildCtx(c);
  const results = new Map<string, UnitResult>();
  for (const unit of c.units) results.set(unit.id, computeUnit(unit, ctx));

  const costs = effectiveCostInputs(c.globals);
  const frontLine = ctx.roles.frontLine;

  /** Group the register at the requested grain, keeping first-seen order. */
  const groups: Array<{ key: string; label: string; region: string; units: Unit[] }> = [];
  const index = new Map<string, number>();
  for (const unit of c.units) {
    const key = grain === "team" ? unit.id : unit.region;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, groups.length);
      groups.push({
        key,
        label: grain === "team" ? unit.name || unit.id : unit.region,
        region: unit.region,
        units: [unit],
      });
    } else {
      groups[at]!.units.push(unit);
    }
  }

  const rowFor = (group: (typeof groups)[number]): SensitivityRow => {
    let currentFte = 0;
    let requiredFte = 0;
    let requirementKnown = true;
    for (const unit of group.units) {
      const result = results.get(unit.id)!;
      currentFte += result.currentFrontLine;
      if (isMissing(result.requiredFrontLine)) requirementKnown = false;
      else requiredFte += result.requiredFrontLine;
    }
    const required = requirementKnown ? requiredFte : MISSING;

    const { costPerFte, uncostedFte } = rowCost(group.units, frontLine);
    const frontierPct = frontier(currentFte, required);

    return {
      key: group.key,
      label: group.label,
      region: group.region,
      currentFte,
      requiredFte: required,
      surplusFte: isMissing(required) ? MISSING : currentFte - required,
      costPerFte,
      uncostedFte,
      frontierPct,
      masksTeamDeficit: false,
      cells: buildCells(steps, currentFte, costPerFte, frontierPct, costs.severanceWeeks),
    };
  };

  const rows = groups.map(rowFor);

  // At region grain, say where the region's own surplus is covering a team's deficit. The
  // roll-up is only deliverable if work can move between the teams inside it, and that is
  // an operational claim rather than something the register can establish.
  if (grain === "region") {
    const teams = c.units.map((unit) => {
      const result = results.get(unit.id)!;
      return {
        region: unit.region,
        frontierPct: frontier(result.currentFrontLine, result.requiredFrontLine),
      };
    });
    for (const row of rows) {
      const inRegion = teams.filter((t) => t.region === row.key);
      row.masksTeamDeficit = row.cells.some(
        (cell) =>
          cell.feasible &&
          inRegion.some(
            (team) => isMissing(team.frontierPct) || round6(cell.pct) > round6(team.frontierPct),
          ),
      );
    }
  }

  const totalCurrent = rows.reduce((t, r) => t + r.currentFte, 0);
  const totalCurrentManagers = c.units.reduce(
    (t, u) => t + (results.get(u.id)!.currentManagers ?? 0),
    0,
  );

  return {
    grain,
    steps,
    rows,
    totals: sumCells(rows, steps),
    uncostedFte: rows.reduce((t, r) => t + r.uncostedFte, 0),
    managerReduction: steps.map(
      (pct) =>
        computeManagers(
          totalCurrent - totalCurrent * pct,
          totalCurrentManagers,
          c.globals.spanOfControl,
        ).managerReduction,
    ),
    // The portfolio frontier is the tightest row's, not the total surplus over the total
    // FTE: a uniform cut is bounded by the first team it breaks.
    portfolioFrontierPct: rows.length === 0
      ? MISSING
      : rows.reduce(
          (min, r) => (isMissing(r.frontierPct) ? MISSING : isMissing(min) ? MISSING : Math.min(min, r.frontierPct)),
          Number.POSITIVE_INFINITY,
        ),
    severanceWeeks: costs.severanceWeeks,
  };
};

/* -------------------------------------------------------------------------- */
/* Current state against target state, for the bar charts                     */
/* -------------------------------------------------------------------------- */

export interface StateBar {
  key: string;
  label: string;
  region: string;
  /** Front-line FTE in place today. */
  currentFte: number;
  /** Front-line FTE the measured demand needs. */
  requiredFte: number;
  surplusFte: number;
  /** Annual cost of the FTE in place, at this row's own rate. */
  currentCost: number;
  /** Annual cost of the requirement, at the same rate. */
  requiredCost: number;
  volume: number;
  /** Teams inside this bar, at region grain. Empty at team grain. */
  teamKeys: string[];
}

/**
 * Current against required, per team or per region.
 *
 * The target state here is the *requirement*, not a chosen reduction: it is what the
 * measured demand needs, so the gap is evidence rather than an assumption. A chart of
 * current against a reduction target would just be the reduction percentage drawn twice.
 */
export const currentVersusTarget = (c: Case, grain: Grain = "region"): StateBar[] => {
  const ctx = buildCtx(c);
  const frontLine = ctx.roles.frontLine;

  const order: string[] = [];
  const groups = new Map<string, Unit[]>();
  for (const unit of c.units) {
    const key = grain === "team" ? unit.id : unit.region;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(unit);
  }

  return order.map((key) => {
    const units = groups.get(key)!;
    const results = units.map((u) => computeUnit(u, ctx));

    let currentFte = 0;
    let requiredFte = 0;
    let volume = 0;
    let known = true;
    for (const result of results) {
      currentFte += result.currentFrontLine;
      if (isMissing(result.requiredFrontLine)) known = false;
      else requiredFte += result.requiredFrontLine;
      if (!isMissing(result.volume.value)) volume += result.volume.value;
    }
    const required = known ? requiredFte : MISSING;
    const { costPerFte } = rowCost(units, frontLine);

    return {
      key,
      label: grain === "team" ? units[0]!.name || units[0]!.id : units[0]!.region,
      region: units[0]!.region,
      currentFte,
      requiredFte: required,
      surplusFte: isMissing(required) ? MISSING : currentFte - required,
      currentCost: isMissing(costPerFte) ? MISSING : currentFte * costPerFte,
      requiredCost:
        isMissing(costPerFte) || isMissing(required) ? MISSING : required * costPerFte,
      volume,
      teamKeys: grain === "region" ? units.map((u) => u.id) : [],
    };
  });
};
