/**
 * Capacity by role.
 *
 * Every expected number below is derived by hand in a comment before being asserted.
 * That is the point of the fixture's round figures: a test whose expectation came from
 * running the code proves only self-consistency.
 */

import { describe, expect, it } from "vitest";

import { isMissing } from "./alg";
import { compareCapacity, computeCapacity, minutesPerFte, minutesPerTransaction } from "./capacity";
import { checkCapacityStudy, rolesWithoutParams, studyMinutes } from "./capacity-qc";
import {
  computedMinutes,
  duplicateGroups,
  effectiveMinutes,
  excessRowIds,
  statedDivergences,
  normaliseRole,
  roleCollisions,
  roleFor,
  type ProcessRow,
} from "./process-study";
import {
  baseRows,
  baseStudy,
  brokenSharesStudy,
  duplicateStudy,
  missingParamsStudy,
  ROLE_COLUMNS,
  sentinelStudy,
  statedOverrideStudy,
  trailingSpaceStudy,
  twoLobStudy,
  unassignedStudy,
} from "./__fixtures__/process-study";

/** Generic so the caller keeps the full result type, not just `{ role }`. */
const byRole = <T extends { role: string }>(result: { roles: T[] }, role: string): T => {
  const found = result.roles.find((r) => r.role === role);
  if (!found) throw new Error(`no result for role "${role}"`);
  return found;
};

describe("effective minutes per transaction", () => {
  it("multiplies frequency through the handle time", () => {
    // step-b: 50% of transactions, 20 minutes -> 10 expected minutes.
    expect(effectiveMinutes(baseRows()[1]!)).toBe(10);
  });

  it("adds rework at its own rate", () => {
    // step-d: 1 x (4 + 0.25 x 8) = 6.
    expect(effectiveMinutes(baseRows()[3]!)).toBe(6);
  });

  it("matches the expanded form the source study uses", () => {
    // A study computes (aht x freq) + (reworkFreq x reworkAht x freq). Same expression
    // factored, and it must agree to the last bit rather than approximately.
    const row = baseRows()[3]!;
    const aht = row.ahtMinutes as number;
    const freq = row.frequency as number;
    const rAht = row.reworkMinutes as number;
    const rFreq = row.reworkFrequency as number;
    expect(effectiveMinutes(row)).toBe(aht * freq + rFreq * rAht * freq);
  });

  it("treats absent rework as none, and unknown rework as unknown", () => {
    const noRework: ProcessRow = { ...baseRows()[0]! };
    expect(effectiveMinutes(noRework)).toBe(10);

    // A study that records no rework says there is none. Unknown is written explicitly.
    const unknownRework: ProcessRow = { ...noRework, reworkFrequency: "n/a" };
    expect(isMissing(effectiveMinutes(unknownRework))).toBe(true);
  });

  it("propagates a missing handle time rather than treating it as zero", () => {
    expect(isMissing(effectiveMinutes({ ...baseRows()[0]!, ahtMinutes: "n/a" }))).toBe(true);
  });

  it("accepts a frequency above 1 as a step happening more than once", () => {
    expect(effectiveMinutes({ ...baseRows()[0]!, frequency: 3 })).toBe(30);
  });
});

describe("productive minutes per FTE", () => {
  it("is per role, never blended", () => {
    // Reviewer 2000 x 0.60 x 60 = 72,000. Processor 1800 x 0.80 x 60 = 86,400.
    expect(minutesPerFte({ role: "Reviewer", workingHoursPerYear: 2000, utilisationPct: 0.6 })).toBe(72_000);
    expect(minutesPerFte({ role: "Processor", workingHoursPerYear: 1800, utilisationPct: 0.8 })).toBe(86_400);
  });

  it("is missing rather than infinite when a parameter is absent", () => {
    expect(isMissing(minutesPerFte({ role: "X", workingHoursPerYear: 0, utilisationPct: 0.8 }))).toBe(true);
  });
});

describe("capacity on the current assignment", () => {
  const result = () => computeCapacity(baseStudy(), "current");

  it("weights each step by the share of transactions that reach it", () => {
    // Per new transaction, Reviewer:
    //   step-a  1.0 x 10           = 10
    //   step-b  0.5 x 20           = 10
    //   step-c  bound only, 60%    = 0.6 x 30 = 18
    //   total                      = 38 min
    // x 10,000 submissions          = 380,000 min
    expect(byRole(result(), "Reviewer").totalMinutes).toBe(380_000);
  });

  it("does not apply a bound-only step to transactions that do not bind", () => {
    // A lost submission still consumes step-a and step-b, but not step-c.
    //   bound  : 10 + 10 + 30 = 50 min
    //   lost   : 10 + 10      = 20 min
    // Weighted at 60/40: 0.6 x 50 + 0.4 x 20 = 38, which is the 380,000 above.
    const bound = minutesPerTransaction(baseStudy(), "current", "Alpha", "New", "Bound");
    const lost = minutesPerTransaction(baseStudy(), "current", "Alpha", "New", "Lost");
    expect(bound.get("Reviewer")).toBe(50);
    expect(lost.get("Reviewer")).toBe(20);
    expect(0.6 * 50 + 0.4 * 20).toBe(38);
  });

  it("understates badly if driven by policies written instead of transactions received", () => {
    // The mistake this guards against: take only the 6,000 submissions that bound, and
    // charge them only the bound minutes.
    //   wrong   : 6,000 x 50  = 300,000
    //   correct : 10,000 x 38 = 380,000
    // A 21% understatement of the requirement, from a definition rather than a formula
    // — and it grows with the share of business that does not bind.
    const correct = byRole(result(), "Reviewer").totalMinutes;
    const wrong = computeCapacity(
      baseStudy({
        demand: [{ lob: "Alpha", transactionType: "New", submissions: 6_000 }],
        statusShares: { New: { Bound: 1 } },
      }),
      "current",
    );
    expect(correct).toBe(380_000);
    expect(byRole(wrong, "Reviewer").totalMinutes).toBe(300_000);
    expect(byRole(wrong, "Reviewer").totalMinutes / correct).toBeCloseTo(0.789, 3);
  });

  it("divides each role by its own productive minutes", () => {
    // Reviewer  380,000 / 72,000 = 5.2777... -> 6 whole
    // Processor  60,000 / 86,400 = 0.6944... -> 1 whole
    const r = result();
    expect(byRole(r, "Reviewer").requiredFte).toBeCloseTo(380_000 / 72_000, 10);
    expect(byRole(r, "Reviewer").wholeFte).toBe(6);
    expect(byRole(r, "Processor").totalMinutes).toBe(60_000);
    expect(byRole(r, "Processor").requiredFte).toBeCloseTo(60_000 / 86_400, 10);
    expect(byRole(r, "Processor").wholeFte).toBe(1);
  });

  it("would give a different answer against one blended denominator", () => {
    // 440,000 total minutes over an average of (72,000 + 86,400)/2 = 79,200 gives
    // 5.5556 FTE, against the correct 5.2778 + 0.6944 = 5.9722. Averaging a denominator
    // is not averaging the quotient, and the gap is a whole person here.
    const r = result();
    const blended = 440_000 / ((72_000 + 86_400) / 2);
    expect(r.requiredFte).toBeCloseTo(5.972222, 5);
    expect(blended).toBeCloseTo(5.555556, 5);
    expect(r.requiredFte).not.toBeCloseTo(blended, 2);
  });

  it("rounds up per role, and says so in the total", () => {
    const r = result();
    // 6 + 1 = 7 whole people against 5.97 fractional. Rounding per role is the honest
    // reading when work cannot be split across role boundaries.
    expect(r.wholeFte).toBe(7);
    expect(r.requiredFte).toBeLessThan(r.wholeFte);
  });

  it("keeps a role with no work visible at zero", () => {
    // "0 FTE" and "not in the model" read identically once the row disappears.
    const r = result();
    expect(byRole(r, "Automation").totalMinutes).toBe(0);
  });
});

describe("automation", () => {
  it("removes minutes from human capacity but still reports them", () => {
    // Under `target`, step-c (18 min per transaction, 180,000 total) moves to Automation.
    const r = computeCapacity(baseStudy(), "target");
    expect(r.automatedMinutes).toBe(180_000);
    // Reviewer keeps nothing under target: a -> Processor, b -> Processor, c -> Automation.
    expect(byRole(r, "Reviewer").totalMinutes).toBe(0);
    expect(isMissing(byRole(r, "Automation").requiredFte)).toBe(true);
    expect(r.requiredFte).toBeCloseTo(260_000 / 86_400, 10);
  });
});

describe("comparing two assignments", () => {
  it("reports gross movement alongside the net", () => {
    // current : Reviewer 380,000 | Processor  60,000
    // proposed: Reviewer  10 x 0.5 x 20 x 10,000 = 100,000
    //           Processor 60,000 + 100,000 = 160,000, Automation 180,000
    const c = compareCapacity(baseStudy(), "current", "proposed");
    expect(byRole(c.from, "Reviewer").totalMinutes).toBe(380_000);
    expect(byRole(c.to, "Reviewer").totalMinutes).toBe(100_000);
    expect(byRole(c.to, "Processor").totalMinutes).toBe(160_000);

    // Reviewer 5.2778 -> 1.3889 = -3.8889 out. Processor 0.6944 -> 1.8519 = +1.1574 in.
    expect(c.fteOut).toBeCloseTo(3.888889, 5);
    expect(c.fteIn).toBeCloseTo(1.157407, 5);
    // Net -2.73 hides a transition affecting 5.05 people's worth of work.
    expect(c.netFteChange).toBeCloseTo(1.157407 - 3.888889, 5);
    expect(c.fteOut + c.fteIn).toBeGreaterThan(Math.abs(c.netFteChange));
  });

  it("reports the minutes that left human capacity", () => {
    const c = compareCapacity(baseStudy(), "current", "proposed");
    expect(c.automatedMinutesGained).toBe(180_000);
  });
});

describe("minutes per transaction", () => {
  it("gives the per-transaction figure a client recognises from their own workbook", () => {
    // Bound new transaction, current: Reviewer 10 + 10 + 30 = 50, Processor 6.
    const bound = minutesPerTransaction(baseStudy(), "current", "Alpha", "New", "Bound");
    expect(bound.get("Reviewer")).toBe(50);
    expect(bound.get("Processor")).toBe(6);

    // A lost one skips step-c entirely: 20 minutes, not 50.
    const lost = minutesPerTransaction(baseStudy(), "current", "Alpha", "New", "Lost");
    expect(lost.get("Reviewer")).toBe(20);
    expect(lost.get("Processor")).toBe(6);
  });
});

describe("several lines of business", () => {
  it("keeps each line's own handle times", () => {
    // alpha-step is tagged New only: 1,000 x 10 = 10,000.
    // beta-step  is tagged New only: 2,000 x 20 = 40,000.  Reviewer = 50,000.
    // alpha-renewal is Renewal only: 500 x 5 = 2,500 -> Processor.
    const r = computeCapacity(twoLobStudy(), "current");
    expect(byRole(r, "Reviewer").totalMinutes).toBe(50_000);
    expect(byRole(r, "Processor").totalMinutes).toBe(2_500);
  });

  it("does not apply a renewal-only step to new business", () => {
    const r = computeCapacity(twoLobStudy(), "current");
    // 2,500 and not 2,500 + (1,000 x 5).
    expect(byRole(r, "Processor").totalMinutes).toBe(2_500);
  });

  it("treats an empty transaction-type list as applying to every type", () => {
    // A study that leaves the flags blank means the step is universal, not that it never
    // happens. Untagging alpha-step adds Alpha's 500 renewals to it: +5,000.
    const study = twoLobStudy();
    const rows = study.rows.map((row) =>
      row.id === "alpha-step" ? { ...row, transactionTypes: [] } : row,
    );
    const r = computeCapacity({ ...study, rows }, "current");
    expect(byRole(r, "Reviewer").totalMinutes).toBe(55_000);
  });
});

/* -------------------------------------------------------------------------- */
/* The five defects                                                           */
/* -------------------------------------------------------------------------- */

describe("G27 — role spellings", () => {
  it("normalises whitespace so a trailing space cannot drop a role's work", () => {
    expect(normaliseRole("  UA ")).toBe("UA");
    expect(normaliseRole("Shared  Service")).toBe("Shared Service");
  });

  it("matches 'Processor ' to Processor, so no minutes go missing", () => {
    const spaced = computeCapacity(trailingSpaceStudy(), "proposed");
    const clean = computeCapacity(baseStudy(), "proposed");
    // Without normalisation this row's 100,000 minutes would land in a phantom role
    // called "Processor " and vanish from any total keyed on "Processor".
    expect(byRole(spaced, "Processor").totalMinutes).toBe(byRole(clean, "Processor").totalMinutes);
    expect(spaced.roles.some((r) => r.role === "Processor ")).toBe(false);
  });

  it("still reports the raw spellings so the source file can be fixed", () => {
    const found = roleCollisions(trailingSpaceStudy().rows, ROLE_COLUMNS);
    expect(found).toHaveLength(1);
    expect(found[0]!.spellings.sort()).toEqual(["Processor", "Processor "]);

    const v = checkCapacityStudy(trailingSpaceStudy(), { toColumn: "proposed" });
    expect(v.some((x) => x.id === "G27" && x.severity === "warn")).toBe(true);
  });

  it("keeps the time-neutrality check passing where a naive match would fail it", () => {
    // This is the exact failure the source workbook's own check reported without being
    // able to explain: one space, one role's work missing from the to-be total.
    const v = checkCapacityStudy(trailingSpaceStudy(), { fromColumn: "current", toColumn: "proposed" });
    expect(v.some((x) => x.id === "G26")).toBe(false);
  });
});

describe("G28 — identical rows", () => {
  it("finds them and prices the double-count", () => {
    const groups = duplicateGroups(duplicateStudy().rows, ROLE_COLUMNS);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rowIds.sort()).toEqual(["step-a", "step-a-copy"]);
    // One extra copy of a 10-minute step.
    expect(groups[0]!.excessMinutes).toBe(10);
  });

  it("counts both copies by default rather than guessing", () => {
    // A step CAN genuinely happen twice, and nothing in the data distinguishes that
    // from a copy-paste. Silently de-duplicating is a decision disguised as a default.
    const kept = computeCapacity(duplicateStudy(), "current");
    expect(byRole(kept, "Reviewer").totalMinutes).toBe(480_000);
  });

  it("excludes the surplus copies when the user decides they are duplicates", () => {
    const study = duplicateStudy();
    const exclude = excessRowIds(duplicateGroups(study.rows, ROLE_COLUMNS));
    const deduped = computeCapacity(study, "current", { excludeRowIds: exclude });
    expect(byRole(deduped, "Reviewer").totalMinutes).toBe(380_000);
  });

  it("warns rather than blocking", () => {
    const v = checkCapacityStudy(duplicateStudy());
    const found = v.find((x) => x.id === "G28")!;
    expect(found.severity).toBe("warn");
    expect(found.message).toContain("minutes per transaction more than once");
  });
});

describe("G29 — outcome shares", () => {
  it("blocks when they do not sum to 100%", () => {
    const v = checkCapacityStudy(brokenSharesStudy());
    const found = v.find((x) => x.id === "G29")!;
    // An error, not a warning: required capacity scales directly with these.
    expect(found.severity).toBe("error");
    expect(found.message).toContain("90.0%");
  });

  it("does not silently rescale them", () => {
    // Reviewer at 90% coverage: 10 + 10 + 0.6 x 30 = 38 is unchanged, but Lost dropping
    // to 0.3 means step-a and step-b apply to only 90% of transactions.
    const r = computeCapacity(brokenSharesStudy(), "current");
    expect(byRole(r, "Reviewer").totalMinutes).toBe(10_000 * (0.9 * 10 + 0.9 * 10 + 0.6 * 30));
  });
});

describe("G30 — work with no owner", () => {
  it("carries an unassigned step at its current owner rather than dropping it", () => {
    // step-b has no `target` owner. Under target it must stay with Reviewer, not vanish.
    const r = computeCapacity(unassignedStudy(), "target");
    expect(byRole(r, "Reviewer").totalMinutes).toBe(100_000);
    expect(byRole(r, "Reviewer").carriedStepCount).toBe(1);
  });

  it("reports a step with no owner anywhere instead of quietly excluding it", () => {
    const r = computeCapacity(unassignedStudy(), "target");
    expect(r.orphanedStepCount).toBe(1);
    expect(r.orphanedMinutes).toBe(120_000);

    const v = checkCapacityStudy(unassignedStudy(), { toColumn: "target" });
    expect(v.some((x) => x.id === "G30" && x.message.includes("no owner in any column"))).toBe(true);
    expect(v.some((x) => x.id === "G30" && x.message.includes("carried at their current owner"))).toBe(true);
  });

  it("resolves the fallback explicitly", () => {
    const row = unassignedStudy().rows[1]!;
    expect(roleFor(row, "target")).toEqual({ role: "Reviewer", carried: true });
    expect(roleFor(row, "current")).toEqual({ role: "Reviewer", carried: false });
    expect(roleFor(unassignedStudy().rows[4]!, "target")).toBeNull();
  });
});

describe("G26 — reallocation is time-neutral", () => {
  it("passes when every minute is accounted for", () => {
    const v = checkCapacityStudy(baseStudy(), { fromColumn: "current", toColumn: "proposed" });
    expect(v.some((x) => x.id === "G26")).toBe(false);
  });

  it("catches minutes disappearing between the two states", () => {
    // A step present in the current state but assigned to nothing at all in the target,
    // with no current owner to carry it back to.
    const study = baseStudy();
    const rows = [...study.rows, { ...study.rows[0]!, id: "vanishing", roles: { proposed: "Reviewer" } }];
    const v = checkCapacityStudy({ ...study, rows }, { fromColumn: "proposed", toColumn: "current" });
    const found = v.find((x) => x.id === "G26");
    expect(found?.severity).toBe("error");
    expect(found?.message).toContain("minutes have been lost");
  });

  it("accepts a change explained entirely by automation", () => {
    // 180,000 minutes move to Automation between current and target. Conserved overall,
    // so no violation — the automation is the explanation.
    const v = checkCapacityStudy(baseStudy(), { fromColumn: "current", toColumn: "target" });
    expect(v.some((x) => x.id === "G26")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Completeness                                                               */
/* -------------------------------------------------------------------------- */

describe("missing inputs", () => {
  it("states coverage when a step has no handle time", () => {
    const r = computeCapacity(sentinelStudy(), "current");
    expect(r.incompleteStepCount).toBe(1);
    const v = checkCapacityStudy(sentinelStudy());
    expect(v.some((x) => x.id === "G21" && x.message.includes("3 of 4 steps"))).toBe(true);
  });

  it("blocks when a role carries work but has no productive-hours basis", () => {
    const v = checkCapacityStudy(missingParamsStudy());
    const found = v.find((x) => x.id === "G21" && x.message.includes("Processor"))!;
    // Error: that role's people would silently be missing from the total.
    expect(found.severity).toBe("error");
    // Named in the register, absent from the parameter list.
    expect(rolesWithoutParams(missingParamsStudy())).toEqual(["Processor"]);
  });

  it("says the study yields minutes but no FTE when there are no volumes", () => {
    const v = checkCapacityStudy(baseStudy({ demand: [] }));
    expect(v.some((x) => x.message.includes("no FTE"))).toBe(true);
  });

  it("flags a step that occurs but takes exactly zero minutes", () => {
    const rows = baseRows();
    rows[0] = { ...rows[0]!, ahtMinutes: 0 };
    const v = checkCapacityStudy(baseStudy({ rows }));
    expect(v.some((x) => x.id === "G31" && x.message.includes("handle time of exactly 0"))).toBe(true);
  });

  it("does not flag a zero frequency, which is a real answer", () => {
    const rows = baseRows();
    rows[0] = { ...rows[0]!, frequency: 0 };
    const v = checkCapacityStudy(baseStudy({ rows }));
    expect(v.some((x) => x.id === "G31" && x.message.includes("handle time of exactly 0"))).toBe(false);
  });
});

describe("G32 — a stated figure typed over the formula", () => {
  it("uses the stated figure, because that is what the source totals use", () => {
    // step-a's components say 10 minutes; the study says 0. Reproducing the client's own
    // number is what makes the model checkable against their workbook.
    const row = statedOverrideStudy().rows[0]!;
    expect(computedMinutes(row)).toBe(10);
    expect(effectiveMinutes(row)).toBe(0);

    const r = computeCapacity(statedOverrideStudy(), "current");
    // Reviewer loses step-a's 100,000: 380,000 - 100,000 = 280,000.
    expect(byRole(r, "Reviewer").totalMinutes).toBe(280_000);
  });

  it("reports the divergence with its direction and size", () => {
    const found = statedDivergences(statedOverrideStudy().rows);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rowId: "step-a", stated: 0, computed: 10, delta: -10 });
  });

  it("warns rather than blocking, since an override is often deliberate", () => {
    const v = checkCapacityStudy(statedOverrideStudy());
    const found = v.find((x) => x.id === "G32")!;
    expect(found.severity).toBe("warn");
    expect(found.message).toContain("suppressing minutes the inputs imply");
  });

  it("says nothing when the stated figure agrees with the components", () => {
    const rows = baseRows().map((row) => ({ ...row, statedMinutes: computedMinutes(row) }));
    expect(statedDivergences(rows)).toEqual([]);
    expect(checkCapacityStudy(baseStudy({ rows })).some((x) => x.id === "G32")).toBe(false);
  });
});

describe("reconciliation helper", () => {
  it("totals expected minutes per transaction across the study", () => {
    // 10 + 10 + 30 + 6 = 56, ignoring applicability — the figure to tie to a source
    // workbook's own column total before any weighting is applied.
    expect(studyMinutes(baseStudy())).toBe(56);
  });

  it("skips steps whose minutes cannot be computed", () => {
    expect(studyMinutes(sentinelStudy())).toBe(50);
  });
});
