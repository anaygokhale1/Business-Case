/**
 * Reduction sensitivity, per team and per region.
 *
 * The fixture is built so every figure below is exact, and so the frontiers differ from
 * each other — a grid where every row breaks at the same percentage would pass a test that
 * ignored the row dimension entirely.
 *
 * At 1,880 hours x 75% x 60 = 84,600 productive minutes and a 20-minute handle time,
 * required FTE is volume / 4,230.
 *
 *   region  team        current  volume    required  surplus  frontier  cost
 *   Europe  Intake      40       143,820   34.0      6.0      15%       70,000
 *   Europe  Adjusting   10        40,185    9.5      0.5       5%       90,000
 *   NA      Claims      50       169,200   40.0     10.0      20%      100,000
 *
 * Blended front-line cost is 8,700,000 / 100 = 87,000, which is what makes the
 * reconciliation test below exact rather than approximate.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_GLOBALS, ROLES } from "./__fixtures__/cases";
import { isMissing } from "./alg";
import { resolve } from "./scenario";
import {
  currentVersusTarget,
  DEFAULT_REDUCTION_STEPS,
  reductionSensitivity,
  type SensitivityRow,
} from "./sensitivity";
import type { Case, Unit } from "./types";
import { SENTINEL } from "./types";

const unit = (
  id: string,
  name: string,
  region: string,
  volume: number | typeof SENTINEL,
  processors: number,
  cost: number | typeof SENTINEL,
  leads = 2,
): Unit => ({
  id,
  name,
  region,
  volume,
  headcount: { processor: processors, lead: leads },
  cost: { processor: cost, lead: 140_000 },
});

const register = (units: Unit[]): Case => ({
  schema: "case.workforce.v2",
  meta: {
    company: "Northwind Assurance",
    industry: "Insurance / Reinsurance",
    coreProblem: "Capacity Right-sizing",
    initiativeTitle: "Operations Optimisation",
    preparedBy: "Test Fixture",
    modelDate: "2026-01-15",
    asOfDate: "2026-01-15",
    workloadUnitName: "Claims",
  },
  globals: { ...structuredClone(DEFAULT_GLOBALS), implementationCosts: "Severance only" },
  scenarios: {
    low: { hcReductionPct: 0.08 },
    base: { hcReductionPct: 0.12 },
    high: { hcReductionPct: 0.18 },
  },
  roles: ROLES,
  units,
  timeStudy: [],
  overrides: [],
  provenance: {},
});

const threeTeams = (): Case =>
  register([
    unit("intake", "Intake", "Europe", 143_820, 40, 70_000, 5),
    unit("adjusting", "Adjusting", "Europe", 40_185, 10, 90_000, 2),
    // 5 + 2 + 6 = 13 leads, which is exactly ceil(100 / 8) — so the register is neither
    // over- nor under-managed at 0%, and the manager column starts from a real zero.
    unit("claims", "Claims", "North America", 50 * 4230 - 42_300, 50, 100_000, 6),
  ]);

const row = (grid: { rows: SensitivityRow[] }, key: string): SensitivityRow => {
  const found = grid.rows.find((r) => r.key === key);
  if (!found) throw new Error(`no row ${key}`);
  return found;
};

const at = (r: SensitivityRow, pct: number) => {
  const cell = r.cells.find((c) => c.pct === pct);
  if (!cell) throw new Error(`no cell at ${pct}`);
  return cell;
};

describe("the rows", () => {
  it("reports each row's own surplus and the reduction it bounds", () => {
    const grid = reductionSensitivity(threeTeams());

    expect(row(grid, "intake").requiredFte).toBeCloseTo(34, 10);
    expect(row(grid, "intake").surplusFte).toBeCloseTo(6, 10);
    expect(row(grid, "intake").frontierPct).toBeCloseTo(0.15, 10);

    expect(row(grid, "adjusting").requiredFte).toBeCloseTo(9.5, 10);
    expect(row(grid, "adjusting").frontierPct).toBeCloseTo(0.05, 10);

    expect(row(grid, "claims").requiredFte).toBeCloseTo(40, 10);
    expect(row(grid, "claims").frontierPct).toBeCloseTo(0.2, 10);
  });

  it("costs a row at its own rate, FTE-weighted, not at the portfolio blend", () => {
    const grid = reductionSensitivity(threeTeams(), { grain: "region" });
    // Europe is 40 at 70,000 and 10 at 90,000: 74,000, not the midpoint 80,000. A plain
    // average would overstate Europe's saving by 8%.
    expect(row(grid, "Europe").costPerFte).toBeCloseTo(74_000, 10);
    expect(row(grid, "North America").costPerFte).toBeCloseTo(100_000, 10);
  });

  it("computes the saving and the severance at each step", () => {
    const cell = at(row(reductionSensitivity(threeTeams()), "intake"), 0.12);
    expect(cell.reducedFte).toBeCloseTo(4.8, 10);
    expect(cell.grossSaving).toBeCloseTo(336_000, 6);
    // Eight weeks of the same rate: 336,000 x 8/52.
    expect(cell.severance).toBeCloseTo((336_000 * 8) / 52, 6);
    expect(cell.netYearOne).toBeCloseTo(336_000 - (336_000 * 8) / 52, 6);
  });
});

describe("feasibility and the optimum", () => {
  it("marks a step beyond a row's surplus infeasible, and still says what it is worth", () => {
    const adjusting = row(reductionSensitivity(threeTeams()), "adjusting");
    const cell = at(adjusting, 0.12);

    expect(cell.feasible).toBe(false);
    // The money is still computed. It is what the saving would be; what it is not is an
    // opportunity, because the team would be short of the capacity its demand needs.
    expect(cell.grossSaving).toBeCloseTo(108_000, 6);
  });

  it("puts the optimum at the largest step inside the surplus, per row", () => {
    const grid = reductionSensitivity(threeTeams());
    const optimalOf = (key: string) => row(grid, key).cells.find((c) => c.optimal)?.pct;

    // Steps are 0, 4, 8, 12, 16, 20, 24%. Each row stops where its own surplus does.
    expect(optimalOf("intake")).toBe(0.12);
    expect(optimalOf("adjusting")).toBe(0.04);
    expect(optimalOf("claims")).toBe(0.2);
  });

  it("gives a row with no room to cut no optimum at all", () => {
    // Required exactly equals current: nothing to shed.
    const grid = reductionSensitivity(register([unit("tight", "Tight", "Europe", 40 * 4230, 40, 70_000)]));
    expect(row(grid, "tight").frontierPct).toBe(0);
    // Doing nothing is not an optimum, so no cell is marked rather than the 0% cell being
    // dressed up as the answer.
    expect(row(grid, "tight").cells.some((c) => c.optimal)).toBe(false);
    expect(at(row(grid, "tight"), 0.04).feasible).toBe(false);
  });

  it("reads a row already short of capacity as having no room, not negative room", () => {
    const grid = reductionSensitivity(
      register([unit("short", "Short", "Europe", 50 * 4230, 40, 70_000)]),
    );
    expect(row(grid, "short").surplusFte).toBeCloseTo(-10, 10);
    // Clamped: a negative frontier would read as though there were room to cut.
    expect(row(grid, "short").frontierPct).toBe(0);
  });

  it("counts a step exactly at the frontier as feasible", () => {
    // 0.15 is a step and is exactly Intake's frontier. Computed from floats the frontier
    // can land a hair below it, and this is the one cell that most needs to read as
    // feasible — so the comparison is pre-rounded.
    const grid = reductionSensitivity(threeTeams(), { steps: [0.15] });
    expect(at(row(grid, "intake"), 0.15).feasible).toBe(true);
    expect(at(row(grid, "intake"), 0.15).optimal).toBe(true);
  });

  it("bounds the portfolio at the first team it breaks, not at the total surplus", () => {
    const grid = reductionSensitivity(threeTeams());
    // Total surplus is 16.5 of 100 FTE, so a naive portfolio frontier would read 16.5%.
    // A uniform cut is bounded by Adjusting at 5%.
    expect(grid.portfolioFrontierPct).toBeCloseTo(0.05, 10);
  });

  it("marks a column infeasible when any single row is over its frontier", () => {
    const grid = reductionSensitivity(threeTeams());
    const column = (pct: number) => grid.totals.find((c) => c.pct === pct)!;
    expect(column(0.04).feasible).toBe(true);
    // One team over the line makes the uniform cut undeliverable as stated, whatever the
    // portfolio surplus says.
    expect(column(0.08).feasible).toBe(false);
  });
});

describe("reconciling to the portfolio", () => {
  it("sums to the portfolio front-line saving at a uniform percentage", () => {
    const c = threeTeams();
    const grid = reductionSensitivity(c, { steps: [0.12] });
    const scenario = resolve(c, "base");

    // 100 FTE x 12% x the blended 87,000 = 1,044,000, and the rows add to the same figure
    // because sum(fte x cost) / sum(fte) x sum(fte) is sum(fte x cost). Exact, not close:
    // if this drifts, one of the two is weighting differently from the other.
    const frontLineOnly =
      scenario.staffReduction * scenario.blendedFrontLineCost;
    expect(grid.totals[0]!.grossSaving).toBeCloseTo(1_044_000, 6);
    expect(grid.totals[0]!.grossSaving).toBeCloseTo(frontLineOnly, 6);
  });

  it("keeps the same total whichever grain it is grouped at", () => {
    const c = threeTeams();
    const teams = reductionSensitivity(c, { steps: [0.12], grain: "team" });
    const regions = reductionSensitivity(c, { steps: [0.12], grain: "region" });
    // Regrouping must not move the money. It would if a region's blended rate were applied
    // to the region's FTE incorrectly, which is the easy mistake here.
    expect(regions.totals[0]!.grossSaving).toBeCloseTo(teams.totals[0]!.grossSaving, 6);
    expect(regions.totals[0]!.reducedFte).toBeCloseTo(teams.totals[0]!.reducedFte, 10);
  });

  it("reports the manager reduction per column without allocating it to rows", () => {
    const grid = reductionSensitivity(threeTeams());
    // Required managers come from a portfolio CEILING, and CEILING does not commute with
    // addition, so there is no honest per-team manager number. It is reported per column.
    expect(grid.managerReduction).toHaveLength(DEFAULT_REDUCTION_STEPS.length);
    // 13 in place; 100 FTE at a span of 8 needs 13, so nothing changes at 0%. At 12% the
    // remaining 88 need 11, a reduction of 2. Integers throughout — a manager is a person.
    expect(grid.managerReduction[0]).toBe(0);
    expect(grid.managerReduction[3]).toBe(2);
    expect(grid.managerReduction.every((m) => Number.isInteger(m))).toBe(true);
  });

  it("reports a negative manager reduction when the span says more are needed", () => {
    // Six leads for 100 front-line at a span of 8 is under-managed by seven. Reported as
    // a negative reduction rather than clamped to zero: the case would otherwise show a
    // saving on managers while the target state needs to hire them.
    const grid = reductionSensitivity(threeTeams(), { steps: [0] });
    const under = reductionSensitivity(
      register([
        unit("intake", "Intake", "Europe", 143_820, 40, 70_000, 2),
        unit("adjusting", "Adjusting", "Europe", 40_185, 10, 90_000, 2),
        unit("claims", "Claims", "North America", 169_200, 50, 100_000, 2),
      ]),
      { steps: [0] },
    );
    expect(grid.managerReduction[0]).toBe(0);
    expect(under.managerReduction[0]).toBe(-7);
  });
});

describe("what it cannot cost or bound", () => {
  it("excludes a row with no cost and reports the FTE that hides", () => {
    const c = register([
      unit("intake", "Intake", "Europe", 143_820, 40, 70_000),
      unit("nocost", "No cost", "Europe", 40_185, 10, SENTINEL),
    ]);
    const grid = reductionSensitivity(c, { steps: [0.12] });

    expect(isMissing(row(grid, "nocost").costPerFte)).toBe(true);
    expect(isMissing(at(row(grid, "nocost"), 0.12).grossSaving)).toBe(true);
    expect(row(grid, "nocost").uncostedFte).toBe(10);
    expect(grid.uncostedFte).toBe(10);

    // The total is the costed rows only, so it is smaller than the portfolio headline —
    // which extends the blended rate across FTE that has no cost at all.
    expect(grid.totals[0]!.grossSaving).toBeCloseTo(336_000, 6);
  });

  it("still bounds a row it cannot cost", () => {
    const grid = reductionSensitivity(
      register([unit("nocost", "No cost", "Europe", 40_185, 10, SENTINEL)]),
      { steps: [0.04] },
    );
    // Capacity and money are separate questions: not knowing the rate does not stop the
    // surplus from being known.
    expect(row(grid, "nocost").frontierPct).toBeCloseTo(0.05, 10);
    expect(at(row(grid, "nocost"), 0.04).feasible).toBe(true);
  });

  it("refuses to bound a row whose requirement is unknown", () => {
    const grid = reductionSensitivity(
      register([unit("unknown", "Unknown", "Europe", SENTINEL, 40, 70_000)]),
    );
    expect(isMissing(row(grid, "unknown").requiredFte)).toBe(true);
    // "No constraint" and "unknown constraint" are different claims, and only one is safe
    // to act on — so no cell is feasible and none is optimal.
    expect(isMissing(row(grid, "unknown").frontierPct)).toBe(true);
    expect(row(grid, "unknown").cells.every((c) => !c.feasible)).toBe(true);
    expect(row(grid, "unknown").cells.some((c) => c.optimal)).toBe(false);
  });
});

describe("region rows", () => {
  it("rolls the teams up", () => {
    const grid = reductionSensitivity(threeTeams(), { grain: "region" });
    expect(grid.rows.map((r) => r.key)).toEqual(["Europe", "North America"]);
    expect(row(grid, "Europe").currentFte).toBe(50);
    expect(row(grid, "Europe").requiredFte).toBeCloseTo(43.5, 10);
    expect(row(grid, "Europe").frontierPct).toBeCloseTo(0.13, 10);
  });

  it("says when a region's surplus is covering one of its teams' deficits", () => {
    const grid = reductionSensitivity(threeTeams(), { grain: "region" });
    // Europe looks good to 13%, but Adjusting breaks at 5%. The roll-up is only
    // deliverable if the work can actually move between the two teams, which the register
    // cannot establish — so it is flagged rather than presented as headroom.
    expect(row(grid, "Europe").masksTeamDeficit).toBe(true);
    expect(row(grid, "North America").masksTeamDeficit).toBe(false);
  });

  it("does not flag a region whose only team is the region", () => {
    const grid = reductionSensitivity(
      register([unit("claims", "Claims", "North America", 169_200, 50, 100_000)]),
      { grain: "region" },
    );
    expect(row(grid, "North America").masksTeamDeficit).toBe(false);
  });
});

describe("current against target", () => {
  it("compares FTE in place with FTE the demand needs, per region", () => {
    const bars = currentVersusTarget(threeTeams(), "region");
    expect(bars.map((b) => b.label)).toEqual(["Europe", "North America"]);

    const europe = bars[0]!;
    expect(europe.currentFte).toBe(50);
    expect(europe.requiredFte).toBeCloseTo(43.5, 10);
    expect(europe.surplusFte).toBeCloseTo(6.5, 10);
    // Costed at Europe's own 74,000 on both sides, so the bars are comparable.
    expect(europe.currentCost).toBeCloseTo(3_700_000, 6);
    expect(europe.requiredCost).toBeCloseTo(43.5 * 74_000, 6);
    expect(europe.teamKeys).toEqual(["intake", "adjusting"]);
  });

  it("drills to the teams inside a region", () => {
    const bars = currentVersusTarget(threeTeams(), "team");
    expect(bars.map((b) => b.label)).toEqual(["Intake", "Adjusting", "Claims"]);
    expect(bars[1]!.requiredFte).toBeCloseTo(9.5, 10);
    expect(bars[1]!.surplusFte).toBeCloseTo(0.5, 10);
    // No teams beneath a team, so nothing to drill into.
    expect(bars[1]!.teamKeys).toEqual([]);
  });

  it("carries the volume behind each bar", () => {
    const bars = currentVersusTarget(threeTeams(), "region");
    expect(bars[0]!.volume).toBe(143_820 + 40_185);
  });

  it("leaves the target unknown rather than guessing when a volume is missing", () => {
    const bars = currentVersusTarget(
      register([unit("unknown", "Unknown", "Europe", SENTINEL, 40, 70_000)]),
      "team",
    );
    expect(isMissing(bars[0]!.requiredFte)).toBe(true);
    expect(isMissing(bars[0]!.requiredCost)).toBe(true);
    // The current side is still known, so it is still reported.
    expect(bars[0]!.currentCost).toBeCloseTo(2_800_000, 6);
  });
});
