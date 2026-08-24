/**
 * Costing a capacity change.
 *
 * Every figure is derived by hand in a comment before it is asserted. The fixture uses
 * round numbers so that is possible, and so a wrong answer is recognisable rather than
 * merely different.
 */

import { describe, expect, it } from "vitest";

import { isMissing } from "./alg";
import { computeCapacity } from "./capacity";
import { roleLabel, savingSources, valueCapacity, type ValuationParams } from "./capacity-value";
import type { CapacityBlock, RoleCapacity } from "./types";
import { baseRows, SHARES } from "./__fixtures__/process-study";

const PARAMS: ValuationParams = { severanceWeeks: 26, includeOneTimeCosts: true };

/**
 * Reviewer onshore at 120,000; Processor in a hub at 40,000.
 *
 * Both differ on hours AND utilisation, so no single denominator fits either, and they sit
 * in different locations so the saving decomposes into a grade part and a location part.
 *
 *   Reviewer  2,000 hrs x 60% x 60 = 72,000 productive minutes
 *   Processor 1,800 hrs x 80% x 60 = 86,400 productive minutes
 */
const ROLES: RoleCapacity[] = [
  {
    role: "Reviewer",
    workingHoursPerYear: 2000,
    utilisationPct: 0.6,
    location: "Onshore",
    annualCost: 120_000,
  },
  {
    role: "Processor",
    workingHoursPerYear: 1800,
    utilisationPct: 0.8,
    location: "Hub",
    annualCost: 40_000,
  },
  { role: "Automation", workingHoursPerYear: 0, utilisationPct: 0, automated: true },
  { role: "Unowned", workingHoursPerYear: 0, utilisationPct: 0, unassigned: true },
];

const block = (over: Partial<CapacityBlock> = {}): CapacityBlock => ({
  rows: baseRows(),
  demand: [{ lob: "Alpha", transactionType: "New", submissions: 10_000 }],
  statusShares: SHARES,
  roles: ROLES,
  roleColumns: ["current", "proposed", "target"],
  baseColumn: "current",
  targetColumn: "proposed",
  excludedRowIds: [],
  redeploymentRate: 0,
  recruitmentCostPct: 0,
  currency: "EUR",
  ...over,
});

/** Generic so the caller keeps the full result type rather than just `{ role }`. */
const byRole = <T extends { role: string }>(v: { roles: T[] }, role: string): T => {
  const found = v.roles.find((r) => r.role === role);
  if (!found) throw new Error(`no valuation for role "${role}"`);
  return found;
};

describe("labels", () => {
  it("names the location, so it is never implicit", () => {
    expect(roleLabel(ROLES[0]!)).toBe("Reviewer @ Onshore");
    expect(roleLabel(ROLES[2]!)).toBe("Automation");
  });
});

describe("the costed delta", () => {
  const value = () => valueCapacity(block(), PARAMS);

  it("costs the fractional requirement on each side", () => {
    // current : Reviewer 380,000 min -> 5.2778 FTE | Processor  60,000 -> 0.6944
    // proposed: Reviewer 100,000     -> 1.3889     | Processor 160,000 -> 1.8519
    const v = value();
    expect(byRole(v, "Reviewer").fromFte).toBeCloseTo(380_000 / 72_000, 9);
    expect(byRole(v, "Reviewer").toFte).toBeCloseTo(100_000 / 72_000, 9);
    expect(byRole(v, "Processor").toFte).toBeCloseTo(160_000 / 86_400, 9);
  });

  it("turns the delta into money at each role's own cost", () => {
    const v = value();
    // Reviewer: (1.3889 - 5.2778) x 120,000 = -466,666.67  (a saving)
    expect(byRole(v, "Reviewer").deltaCost).toBeCloseTo(-466_666.667, 2);
    // Processor: (1.8519 - 0.6944) x 40,000 = +46,296.30  (a cost)
    expect(byRole(v, "Processor").deltaCost).toBeCloseTo(46_296.296, 2);
  });

  it("reports the annual saving positive, netting the two", () => {
    // 466,666.67 - 46,296.30 = 420,370.37
    const v = value();
    expect(v.grossAnnualSaving).toBeCloseTo(420_370.37, 2);
    expect(v.annualCostFrom).toBeGreaterThan(v.annualCostTo);
  });

  it("saves money even though total minutes are unchanged", () => {
    // The whole point of a right-shift: the work is identical, only who does it changed.
    const v = value();
    expect(v.comparison.from.staffedMinutes + v.comparison.from.automatedMinutes).toBeCloseTo(
      v.comparison.to.staffedMinutes + v.comparison.to.automatedMinutes,
      6,
    );
    expect(v.grossAnnualSaving).toBeGreaterThan(0);
  });
});

describe("fractional versus whole FTE", () => {
  it("rounds each side independently, so the whole-FTE delta is not the rounded delta", () => {
    const v = valueCapacity(block(), PARAMS);
    const reviewer = byRole(v, "Reviewer");
    // 5.2778 -> 6 whole, 1.3889 -> 2 whole, so the whole delta is -4.
    expect(reviewer.fromWholeFte).toBe(6);
    expect(reviewer.toWholeFte).toBe(2);
    expect(reviewer.deltaWholeFte).toBe(-4);
    // Rounding the fractional delta of -3.8889 would give -4 too, but Processor shows the
    // divergence: 0.6944 -> 1 and 1.8519 -> 2, a whole delta of +1 against +1.157 rounding
    // to +2. The two conventions genuinely differ.
    expect(byRole(v, "Processor").deltaWholeFte).toBe(1);
    expect(Math.ceil(byRole(v, "Processor").deltaFte)).toBe(2);
  });

  it("reports both savings and does not present one as the other", () => {
    const v = valueCapacity(block(), PARAMS);
    // Whole: -(-4 x 120,000) - (1 x 40,000) = 480,000 - 40,000 = 440,000.
    expect(v.grossAnnualSavingWhole).toBeCloseTo(440_000, 6);
    expect(v.grossAnnualSaving).not.toBeCloseTo(v.grossAnnualSavingWhole, 0);
  });
});

describe("redeployment, severance and recruitment", () => {
  it("charges severance on everyone displaced when nothing is redeployed", () => {
    const v = valueCapacity(block({ redeploymentRate: 0 }), PARAMS);
    // Reviewer sheds 3.8889 FTE; Processor takes on 1.1574.
    expect(v.fteOut).toBeCloseTo(3.888889, 5);
    expect(v.fteIn).toBeCloseTo(1.157407, 5);
    expect(v.redeployedFte).toBe(0);
    expect(v.exitingFte).toBeCloseTo(3.888889, 5);
    // Charged at the SHRINKING role's cost — Reviewer at 120,000 — for 26 of 52 weeks.
    // Written as the exact fraction: Reviewer sheds (380,000 - 100,000) / 72,000 FTE.
    const shed = 280_000 / 72_000;
    expect(v.severanceCost).toBeCloseTo(shed * 120_000 * 0.5, 6);
  });

  it("caps redeployment at the growth there is to redeploy into", () => {
    // A rate of 100% cannot absorb 3.89 FTE into 1.16 FTE of growth. Without the cap this
    // would claim everyone was placed and zero the severance.
    const v = valueCapacity(block({ redeploymentRate: 1 }), PARAMS);
    expect(v.redeployedFte).toBeCloseTo(1.157407, 5);
    expect(v.exitingFte).toBeCloseTo(3.888889 - 1.157407, 5);
    expect(v.unfilledFte).toBeCloseTo(0, 9);
  });

  it("charges recruitment only on growth redeployment does not fill", () => {
    const v = valueCapacity(
      block({ redeploymentRate: 0, recruitmentCostPct: 0.2 }),
      PARAMS,
    );
    // Nothing redeployed, so all 1.1574 FTE of growth is recruited, at 20% of the
    // GROWING role's cost — Processor at 40,000.
    expect(v.unfilledFte).toBeCloseTo(1.157407, 5);
    expect(v.recruitmentCost).toBeCloseTo(1.157407 * 40_000 * 0.2, 2);
  });

  it("drops both one-time costs when they are not being modelled", () => {
    const v = valueCapacity(block({ redeploymentRate: 0, recruitmentCostPct: 0.2 }), {
      severanceWeeks: 26,
      includeOneTimeCosts: false,
    });
    expect(v.oneTimeCost).toBe(0);
    expect(v.severanceCost).toBe(0);
    expect(v.recruitmentCost).toBe(0);
  });

  it("clamps a nonsensical redeployment rate rather than inverting the arithmetic", () => {
    const over = valueCapacity(block({ redeploymentRate: 5 }), PARAMS);
    const under = valueCapacity(block({ redeploymentRate: -2 }), PARAMS);
    expect(over.redeployedFte).toBeCloseTo(1.157407, 5);
    expect(under.redeployedFte).toBe(0);
    expect(under.exitingFte).toBeCloseTo(3.888889, 5);
  });
});

describe("payback", () => {
  it("recovers the one-time cost out of the annual saving", () => {
    const v = valueCapacity(block({ redeploymentRate: 0 }), PARAMS);
    // 233,333 severance against 420,370 a year is a little under 7 months.
    expect(v.paybackMonths).toBeCloseTo((v.oneTimeCost / v.grossAnnualSaving) * 12, 9);
    expect(v.paybackMonths).toBeGreaterThan(6);
    expect(v.paybackMonths).toBeLessThan(7);
  });

  it("reads as never when the change costs money rather than saving it", () => {
    // Reversing the direction makes the cheap role shed work to the expensive one.
    const v = valueCapacity(block({ baseColumn: "proposed", targetColumn: "current" }), PARAMS);
    expect(v.grossAnnualSaving).toBeLessThan(0);
    expect(isMissing(v.paybackMonths)).toBe(true);
  });
});

describe("roles with no cost", () => {
  const uncosted = () => {
    const roles = ROLES.map((r) => (r.role === "Processor" ? { ...r, annualCost: undefined } : r));
    return valueCapacity(block({ roles }), PARAMS);
  };

  it("excludes them from the money and names them", () => {
    const v = uncosted();
    expect(isMissing(byRole(v, "Processor").deltaCost)).toBe(true);
    expect(v.rolesWithoutCost).toEqual(["Processor @ Hub"]);
    // The saving now counts only Reviewer's reduction, so it is LARGER — which is exactly
    // why the gap has to be stated rather than left implicit.
    expect(v.grossAnnualSaving).toBeCloseTo(466_666.667, 2);
  });

  it("states the FTE change the money is missing", () => {
    expect(uncosted().uncostedFteChange).toBeCloseTo(1.157407, 5);
  });

  it("treats a known-missing cost the same as an absent one, never as zero", () => {
    const roles = ROLES.map((r) => (r.role === "Processor" ? { ...r, annualCost: "n/a" as const } : r));
    const v = valueCapacity(block({ roles }), PARAMS);
    // A zero cost would read as a role that is free, which flatters the case.
    expect(v.rolesWithoutCost).toEqual(["Processor @ Hub"]);
  });

  it("never costs an automated or placeholder role", () => {
    const v = valueCapacity(block({ targetColumn: "target" }), PARAMS);
    const automation = byRole(v, "Automation");
    expect(isMissing(automation.deltaCost)).toBe(true);
    expect(v.rolesWithoutCost).not.toContain("Automation");
  });
});

describe("where the saving comes from", () => {
  it("separates a location shift from a grade shift", () => {
    const v = valueCapacity(block(), PARAMS);
    const sources = savingSources(block(), v);
    // Reviewer @ Onshore -> Processor @ Hub is both cheaper AND elsewhere, so the whole
    // saving is attributed to the location move.
    expect(sources.locationShift).toBeGreaterThan(0);
    expect(sources.gradeShift).toBe(0);
  });

  it("attributes to grade when the move stays in one place", () => {
    const sameSite = ROLES.map((r) => ({ ...r, location: "Onshore" }));
    const b = block({ roles: sameSite });
    const sources = savingSources(b, valueCapacity(b, PARAMS));
    expect(sources.gradeShift).toBeGreaterThan(0);
    expect(sources.locationShift).toBe(0);
  });

  it("always ties back to the total", () => {
    // A decomposition that silently loses a residual is worse than none, so whatever the
    // split cannot attribute is reported rather than dropped.
    const b = block({ targetColumn: "target" });
    const v = valueCapacity(b, PARAMS);
    const s = savingSources(b, v);
    expect(s.gradeShift + s.locationShift + s.automation + s.unattributed).toBeCloseTo(
      v.grossAnnualSaving,
      6,
    );
  });

  it("values automation at the cost of whoever gave the work up", () => {
    const b = block({ targetColumn: "target" });
    const s = savingSources(b, valueCapacity(b, PARAMS));
    // Under `target` step-c moves to Automation, so some saving must land there.
    expect(s.automation).toBeGreaterThan(0);
  });
});

describe("what this valuation does not claim", () => {
  it("compares required against required, never against actual headcount", () => {
    // Both sides come from the same study and the same volumes, so this is the
    // reallocation benefit only. It says nothing about whether the operation is
    // overstaffed today — that needs actual headcount, which no uploaded file carries.
    const v = valueCapacity(block(), PARAMS);
    const asIs = computeCapacity(block(), "current");
    expect(v.annualCostFrom).toBeCloseTo(
      asIs.roles
        .filter((r) => !r.automated && !r.unassigned)
        .reduce((total, r) => {
          const cost = ROLES.find((x) => x.role === r.role)?.annualCost;
          return total + (typeof cost === "number" && !isMissing(r.requiredFte) ? r.requiredFte * cost : 0);
        }, 0),
      6,
    );
  });
});
