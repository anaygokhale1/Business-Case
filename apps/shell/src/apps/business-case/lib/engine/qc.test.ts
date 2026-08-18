import { describe, expect, it } from "vitest";

import { assertNoErrors, blocksExport, checkInvariants } from "./qc";
import {
  divergentBlendFixture,
  makeCase,
  sentinelFixture,
  twoUnitUtilisationFixture,
} from "./__fixtures__/cases";

const idsOf = (c: Parameters<typeof checkInvariants>[0]) =>
  checkInvariants(c).map((v) => `${v.severity}:${v.id}`);

describe("a well-formed case is clean", () => {
  it("raises nothing on the aggregation fixture", () => {
    expect(checkInvariants(twoUnitUtilisationFixture())).toEqual([]);
  });

  it("raises nothing on the divergent-blend fixture", () => {
    expect(() => assertNoErrors(divergentBlendFixture())).not.toThrow();
  });
});

describe("G9 — phase weights", () => {
  it("errors when the ACTIVE profile does not sum to 100%", () => {
    const c = twoUnitUtilisationFixture();
    c.globals.exitProfile = "Front-loaded";
    c.globals.phaseWeights["Front-loaded"] = [0.5, 0.3, 0.15, 0.0];

    const found = checkInvariants(c).find((v) => v.id === "G9")!;
    expect(found.severity).toBe("error");
    expect(found.message).toContain("95.0%");
    expect(blocksExport(checkInvariants(c))).toBe(true);
  });

  it("only warns when an INACTIVE profile is malformed", () => {
    const c = twoUnitUtilisationFixture();
    c.globals.exitProfile = "Even";
    c.globals.phaseWeights["Back-loaded"] = [0.1, 0.1, 0.1, 0.1];

    expect(idsOf(c)).toContain("warn:G9");
    expect(blocksExport(checkInvariants(c))).toBe(false);
  });

  it("does not silently normalise the weights it complains about", () => {
    const c = twoUnitUtilisationFixture();
    c.globals.phaseWeights.Even = [0.3, 0.3, 0.3, 0.3];
    checkInvariants(c);
    // Normalising here would make the app disagree with the workbook's red
    // sum-check cell. The numbers are left exactly as the user entered them.
    expect(c.globals.phaseWeights.Even).toEqual([0.3, 0.3, 0.3, 0.3]);
  });
});

describe("G21 — the SUMPRODUCT trap blocks the export", () => {
  it("errors on a missing cost, because Excel would silently read it as zero", () => {
    const found = checkInvariants(sentinelFixture()).find(
      (v) => v.id === "G21" && v.severity === "error",
    );
    expect(found).toBeDefined();
    expect(found!.message).toContain("SUMPRODUCT");
    expect(blocksExport(checkInvariants(sentinelFixture()))).toBe(true);
  });

  it("warns rather than errors on a missing volume, and states the coverage", () => {
    const violations = checkInvariants(sentinelFixture());
    const coverage = violations.find((v) => v.id === "G24")!;
    expect(coverage.severity).toBe("warn");
    // Two of three units still produce a figure: the third has no volume.
    expect(coverage.actual).toBe("2/3");
  });
});

describe("G19 / G20 / G5 — input sanity", () => {
  it("rejects a non-integer horizon", () => {
    const c = twoUnitUtilisationFixture();
    c.globals.horizonYears = 3.5;
    expect(idsOf(c)).toContain("error:G19");
  });

  it("rejects a non-ISO as-of date", () => {
    const c = twoUnitUtilisationFixture();
    c.meta.asOfDate = "today";
    expect(idsOf(c)).toContain("error:G20");
  });

  it("rejects a zero span of control", () => {
    const c = twoUnitUtilisationFixture();
    c.globals.spanOfControl = 0;
    expect(idsOf(c)).toContain("error:G5");
  });
});

describe("G8 — scenario coherence", () => {
  it("errors on a reduction of 100% or more", () => {
    const c = twoUnitUtilisationFixture();
    c.scenarios.high.hcReductionPct = 1;
    expect(idsOf(c)).toContain("error:G8");
  });

  it("warns, but does not block, on non-monotonic scenarios", () => {
    const c = twoUnitUtilisationFixture();
    c.scenarios.low.hcReductionPct = 0.3;
    expect(idsOf(c)).toContain("warn:G8");
    expect(blocksExport(checkInvariants(c))).toBe(false);
  });
});

describe("structural integrity", () => {
  it("errors on duplicate unit ids", () => {
    const unit = {
      id: "dupe",
      name: "A",
      region: "NA",
      volume: 1000,
      headcount: { processor: 10 },
      cost: { processor: 90_000 },
    } as const;
    const c = makeCase([{ ...unit }, { ...unit, name: "B" }]);

    const found = checkInvariants(c).find((v) => v.id === "STRUCT")!;
    expect(found.severity).toBe("error");
    expect(found.message).toContain("Duplicate unit id");
  });

  it("errors when no front-line role is defined", () => {
    const c = makeCase([
      {
        id: "a",
        name: "A",
        region: "NA",
        volume: 1000,
        headcount: { lead: 4 },
        cost: { lead: 160_000 },
      },
    ]);
    c.roles = [{ id: "lead", title: "Team Lead", tier: "manager" }];
    expect(idsOf(c)).toContain("error:STRUCT");
  });
});
