import { describe, expect, it } from "vitest";

import { isMissing } from "./alg";
import { horizonLabel } from "./formulas";
import { resolve, resolveAll } from "./scenario";
import { divergentBlendFixture, twoUnitUtilisationFixture } from "./__fixtures__/cases";

describe("G8 — one entry point, coherent across scenarios", () => {
  const all = resolveAll(divergentBlendFixture());

  it("reduces more headcount as the scenario escalates", () => {
    expect(all.low.staffReduction).toBeLessThan(all.base.staffReduction);
    expect(all.base.staffReduction).toBeLessThan(all.high.staffReduction);
  });

  it("increases gross savings monotonically", () => {
    expect(all.low.grossSavings).toBeLessThan(all.base.grossSavings);
    expect(all.base.grossSavings).toBeLessThan(all.high.grossSavings);
  });

  it("shortens payback as the reduction grows", () => {
    // Severance scales with the reduction but consulting cost does not, so a bigger
    // reduction pays back faster. If payback were flat across scenarios, the fixed
    // cost would have dropped out of the numerator.
    expect(all.high.paybackMonths).toBeLessThan(all.base.paybackMonths);
    expect(all.base.paybackMonths).toBeLessThan(all.low.paybackMonths);
  });

  it("reports the same register regardless of scenario", () => {
    // The register is demand-side: required FTE does not depend on how much
    // headcount the scenario removes.
    expect(all.low.totals.requiredFrontLine).toBeCloseTo(
      all.high.totals.requiredFrontLine,
      10,
    );
  });
});

describe("G4 — severance uses the blended all-in cost", () => {
  const r = resolve(divergentBlendFixture(), "base");

  it("prices severance off the all-in blend, not the front-line blend", () => {
    // Fixture: front-line blend 86,666.67, all-in blend 95,555.56. Using the wrong
    // one understates severance by about 9%.
    expect(r.blendedFrontLineCost).toBeCloseTo(86_666.6667, 3);
    expect(r.blendedAllIn).toBeCloseTo(95_555.5556, 3);

    const expected = r.totalReduction * r.blendedAllIn * (8 / 52);
    expect(r.severance).toBeCloseTo(expected, 6);
  });

  it("keeps Year 1 net as gross savings less every one-time cost", () => {
    expect(r.year1Net).toBeCloseTo(r.grossSavings - r.severance - r.consultingCost, 6);
    expect(r.oneTimeCost).toBeCloseTo(r.severance + r.consultingCost, 6);
  });
});

describe("G5 / decision 12 — managers", () => {
  const r = resolve(divergentBlendFixture(), "base");

  it("returns a whole number of managers", () => {
    expect(Number.isInteger(r.managers.requiredManagers)).toBe(true);
  });

  it("discloses what per-unit rounding would have added", () => {
    // Two units in this fixture, so the portfolio convention can differ by at most
    // one manager. The number is surfaced rather than buried either way.
    expect(r.managerRoundingDelta).toBeGreaterThanOrEqual(0);
    expect(r.managerRoundingDelta).toBeLessThanOrEqual(1);
  });
});

describe("G19 — the horizon drives values and labels together", () => {
  it("scales horizon savings by the horizon, not by a literal 3", () => {
    const three = resolve(divergentBlendFixture(), "base");
    expect(three.horizonGross).toBeCloseTo(three.grossSavings * 3, 6);

    const five = divergentBlendFixture();
    five.globals.horizonYears = 5;
    const r5 = resolve(five, "base");

    expect(r5.horizonGross).toBeCloseTo(r5.grossSavings * 5, 6);
    expect(r5.horizonNet).toBeCloseTo(r5.horizonGross - r5.oneTimeCost, 6);
    // The value moved with the horizon rather than staying pinned at three years.
    expect(r5.horizonGross).toBeGreaterThan(three.horizonGross);
  });

  it("builds multi-year labels from the horizon", () => {
    expect(horizonLabel(3, "Net Savings")).toBe("3-Year Net Savings");
    expect(horizonLabel(5, "Net Savings")).toBe("5-Year Net Savings");
  });
});

describe("payback edge cases", () => {
  it("reads as never rather than dividing by zero when there are no savings", () => {
    const c = divergentBlendFixture();
    c.scenarios.base.hcReductionPct = 0;
    const r = resolve(c, "base");

    // No reduction means no savings, but the consulting cost is still real.
    expect(r.grossSavings).toBe(0);
    expect(isMissing(r.paybackMonths)).toBe(true);
    expect(r.year1Net).toBeLessThan(0);
  });
});

describe("register totals reconcile", () => {
  it("sums front-line FTE from the rows", () => {
    const r = resolve(twoUnitUtilisationFixture(), "base");
    expect(r.totals.currentFrontLine).toBe(80);
    expect(r.staffReduction).toBeCloseTo(80 * 0.12, 10);
  });
});
