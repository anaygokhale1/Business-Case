/**
 * Scenario resolution — the single entry point (G8).
 *
 * Nothing outside this module reads `case.scenarios`. Components call `resolve()`
 * and render what comes back, so there is exactly one place where a scenario turns
 * into numbers. The skill's equivalent is a CHOOSE(MATCH(...)) wired to a dropdown;
 * the failure it guards against is a component quietly computing its own branch and
 * disagreeing with the rest of the model.
 */

import { FastAlg, MISSING, isMissing } from "./alg";
import { computeBlendedCost, portfolioTotals, type PortfolioTotals } from "./aggregate";
import { buildCtx, type Ctx } from "./drivers";
import {
  grossSavings,
  horizonGross,
  horizonNet,
  liftKpiInputs,
  oneTimeCost,
  paybackMonths,
  severance,
  staffReduction,
  totalReduction,
  year1Net,
} from "./formulas";
import { computeUnit } from "./identity";
import { computeManagers, roundingDisclosure } from "./managers";
import type { Case, ManagerResult, ScenarioKey, UnitResult } from "./types";

export interface ScenarioResult {
  scenario: ScenarioKey;
  hcReductionPct: number;

  units: UnitResult[];
  totals: PortfolioTotals;

  blendedFrontLineCost: number;
  blendedManagerCost: number;
  blendedAllIn: number;
  /** (unit, role) pairs excluded from the blend because a side was missing. */
  droppedCostPairs: number;

  staffReduction: number;
  managers: ManagerResult;
  totalReduction: number;

  grossSavings: number;
  severance: number;
  consultingCost: number;
  oneTimeCost: number;
  year1Net: number;
  /** MISSING when there are no savings to pay the cost back. */
  paybackMonths: number;

  horizonYears: number;
  horizonGross: number;
  horizonNet: number;

  /**
   * What per-unit manager rounding would have added. Portfolio rounding is the
   * chosen convention (decision 12), and this is the number the drill-down states
   * so a reviewer who checks one team's arithmetic is not misled.
   */
  managerRoundingDelta: number;
}

export const resolve = (c: Case, scenario: ScenarioKey, ctx?: Ctx): ScenarioResult => {
  const context = ctx ?? buildCtx(c);
  const units = c.units.map((u) => computeUnit(u, context));
  const totals = portfolioTotals(units);

  const frontLine = computeBlendedCost(c, context.roles.frontLine);
  const manager = computeBlendedCost(c, context.roles.managers);
  const allIn = computeBlendedCost(c, context.roles.all);

  const hcReductionPct = c.scenarios[scenario].hcReductionPct;

  // Managers resolve BEFORE the KPI formulas, because manager reduction is an
  // input to gross savings and severance. Portfolio level, per decision 12.
  const reducedFrontLine = totals.currentFrontLine * hcReductionPct;
  const managers = computeManagers(
    totals.currentFrontLine - reducedFrontLine,
    totals.currentManagers,
    c.globals.spanOfControl,
  );

  const inputs = liftKpiInputs(FastAlg, {
    currentFrontLine: totals.currentFrontLine,
    hcReductionPct,
    managerReduction: managers.managerReduction,
    blendedFrontLineCost: frontLine.value,
    blendedManagerCost: isMissing(manager.value) ? 0 : manager.value,
    blendedAllIn: allIn.value,
    severanceWeeks: c.globals.severanceWeeks,
    consultingCost: c.globals.consultingCost,
    horizonYears: c.globals.horizonYears,
  });

  const gross = grossSavings(FastAlg, inputs);

  return {
    scenario,
    hcReductionPct,
    units,
    totals,
    blendedFrontLineCost: frontLine.value,
    blendedManagerCost: manager.value,
    blendedAllIn: allIn.value,
    droppedCostPairs: allIn.dropped,
    staffReduction: staffReduction(FastAlg, inputs),
    managers,
    totalReduction: totalReduction(FastAlg, inputs),
    grossSavings: gross,
    severance: severance(FastAlg, inputs),
    consultingCost: c.globals.consultingCost,
    oneTimeCost: oneTimeCost(FastAlg, inputs),
    year1Net: year1Net(FastAlg, inputs),
    // Guarded: no savings means the cost never pays back, which must read as
    // "never", not as a division blowing up or a misleading zero.
    paybackMonths: gross === 0 ? MISSING : paybackMonths(FastAlg, inputs),
    horizonYears: c.globals.horizonYears,
    horizonGross: horizonGross(FastAlg, inputs),
    horizonNet: horizonNet(FastAlg, inputs),
    managerRoundingDelta: roundingDisclosure(
      units.map((u) => u.currentFrontLine * (1 - hcReductionPct)),
      c.globals.spanOfControl,
    ).delta,
  };
};

/** All three scenarios at once — the contrast view materialises them side by side. */
export const resolveAll = (c: Case): Record<ScenarioKey, ScenarioResult> => {
  const ctx = buildCtx(c);
  return {
    low: resolve(c, "low", ctx),
    base: resolve(c, "base", ctx),
    high: resolve(c, "high", ctx),
  };
};
