import { describe, expect, it } from "vitest";

import { createBlankCase, DEFAULT_GLOBALS } from "./case-defaults";
import {
  caseReducer,
  regionDriverSummary,
  regionsOf,
  slugify,
  uniqueId,
  type CaseAction,
} from "./case-reducer";
import type { Case } from "./engine/types";
import { SENTINEL } from "./engine/types";

const AS_OF = "2026-08-18";
const blank = () => createBlankCase(AS_OF);

/** Apply a sequence, so a test reads as the interaction it describes. */
const run = (start: Case, ...actions: CaseAction[]): Case =>
  actions.reduce((c, a) => caseReducer(c, a), start);

describe("slugify / uniqueId", () => {
  it("produces url-safe stems", () => {
    expect(slugify("North America")).toBe("north-america");
    expect(slugify("  Claims — East  ")).toBe("claims-east");
  });

  it("suffixes only on collision, deterministically", () => {
    expect(uniqueId("europe", [])).toBe("europe");
    expect(uniqueId("europe", ["europe"])).toBe("europe-2");
    expect(uniqueId("europe", ["europe", "europe-2"])).toBe("europe-3");
  });

  it("never returns an empty id", () => {
    // A region named only in punctuation slugs to "" — an empty id would collide
    // with the next one and silently merge two rows.
    expect(uniqueId(slugify("///"), [])).toBe("item");
  });
});

describe("regions", () => {
  it("adds a region as one unit, so a simple case needs no extra step", () => {
    const c = run(blank(), { type: "region/add", name: "North America" });
    expect(c.units).toHaveLength(1);
    expect(c.units[0]).toMatchObject({
      id: "north-america",
      name: "North America",
      region: "North America",
      volume: SENTINEL,
    });
  });

  it("ignores a blank or duplicate region", () => {
    const one = run(blank(), { type: "region/add", name: "Europe" });
    expect(run(one, { type: "region/add", name: "Europe" })).toBe(one);
    expect(run(one, { type: "region/add", name: "   " })).toBe(one);
  });

  it("renames the region and any unit that carried its name", () => {
    const c = run(
      blank(),
      { type: "region/add", name: "EMEA" },
      { type: "unit/add", region: "EMEA" },
      { type: "unit/setName", unitId: "emea-unit", name: "Claims — UK" },
      { type: "region/rename", from: "EMEA", to: "Europe" },
    );
    expect(regionsOf(c)).toEqual(["Europe"]);
    // The auto-created row follows the region; the row the user named keeps its name.
    expect(c.units.map((u) => u.name)).toEqual(["Europe", "Claims — UK"]);
  });

  it("removing a region removes its units", () => {
    const c = run(
      blank(),
      { type: "region/add", name: "Europe" },
      { type: "region/add", name: "APAC" },
      { type: "region/remove", name: "Europe" },
    );
    expect(regionsOf(c)).toEqual(["APAC"]);
  });
});

describe("driver three-state editing", () => {
  const seeded = () => run(blank(), { type: "region/add", name: "Europe" });

  it("sets an own value", () => {
    const c = run(seeded(), {
      type: "unit/setDriver",
      unitId: "europe",
      driver: "utilisationPct",
      value: 0.68,
    });
    expect(c.units[0]!.utilisationPct).toBe(0.68);
  });

  it("clearing DELETES the key rather than assigning undefined", () => {
    const c = run(
      seeded(),
      { type: "unit/setDriver", unitId: "europe", driver: "utilisationPct", value: 0.68 },
      { type: "unit/setDriver", unitId: "europe", driver: "utilisationPct", value: null },
    );
    // "absent" and "present but undefined" resolve identically today but do not
    // survive a JSON round-trip identically, so the key must actually be gone.
    expect("utilisationPct" in c.units[0]!).toBe(false);
    expect(JSON.parse(JSON.stringify(c)).units[0]).not.toHaveProperty("utilisationPct");
  });

  it("marks a driver known-missing without turning it into 0", () => {
    const c = run(seeded(), {
      type: "unit/setDriver",
      unitId: "europe",
      driver: "handleTimeMinutes",
      value: SENTINEL,
    });
    expect(c.units[0]!.handleTimeMinutes).toBe(SENTINEL);
  });
});

describe("region-level driver editing", () => {
  const twoUnitRegion = () =>
    run(
      blank(),
      { type: "region/add", name: "Europe" },
      { type: "unit/add", region: "Europe" },
      { type: "region/add", name: "APAC" },
    );

  it("writes through to every unit in the region and no others", () => {
    const c = run(twoUnitRegion(), {
      type: "region/setDriver",
      region: "Europe",
      driver: "utilisationPct",
      value: 0.71,
    });
    const europe = c.units.filter((u) => u.region === "Europe");
    expect(europe.map((u) => u.utilisationPct)).toEqual([0.71, 0.71]);
    expect(c.units.find((u) => u.region === "APAC")!.utilisationPct).toBeUndefined();
  });

  it("reports uniform, inherited, missing and mixed distinctly", () => {
    const base = twoUnitRegion();
    expect(regionDriverSummary(base, "Europe", "utilisationPct")).toEqual({ kind: "inherited" });

    const uniform = run(base, {
      type: "region/setDriver",
      region: "Europe",
      driver: "utilisationPct",
      value: 0.71,
    });
    expect(regionDriverSummary(uniform, "Europe", "utilisationPct")).toEqual({
      kind: "uniform",
      value: 0.71,
    });

    const mixed = run(uniform, {
      type: "unit/setDriver",
      unitId: "europe-unit",
      driver: "utilisationPct",
      value: 0.6,
    });
    // Must not collapse to one of the two values — that is how a user overwrites a
    // distinct figure without being told.
    expect(regionDriverSummary(mixed, "Europe", "utilisationPct")).toEqual({ kind: "mixed" });

    const missing = run(base, {
      type: "region/setDriver",
      region: "Europe",
      driver: "utilisationPct",
      value: SENTINEL,
    });
    expect(regionDriverSummary(missing, "Europe", "utilisationPct")).toEqual({ kind: "missing" });
  });

  it("is a no-op for a region with no units", () => {
    const before = twoUnitRegion();
    expect(
      caseReducer(before, {
        type: "region/setDriver",
        region: "Nowhere",
        driver: "upliftPct",
        value: 0.1,
      }),
    ).toBe(before);
  });
});

describe("identity preservation", () => {
  const threeRegions = () =>
    run(
      blank(),
      { type: "region/add", name: "North America" },
      { type: "region/add", name: "Europe" },
      { type: "region/add", name: "APAC" },
    );

  it("editing one unit leaves the other unit objects referentially identical", () => {
    // This is what keeps the engine's WeakMap memoisation useful. If this breaks,
    // every keystroke recomputes every row instead of one.
    const before = threeRegions();
    const after = caseReducer(before, {
      type: "unit/setVolume",
      unitId: "europe",
      value: 120_000,
    });

    expect(after.units[1]).not.toBe(before.units[1]);
    expect(after.units[0]).toBe(before.units[0]);
    expect(after.units[2]).toBe(before.units[2]);
  });

  it("an edit to an unknown unit id returns the same case object", () => {
    const before = threeRegions();
    expect(caseReducer(before, { type: "unit/setVolume", unitId: "nope", value: 1 })).toBe(before);
  });

  it("editing globals leaves every unit identical", () => {
    const before = threeRegions();
    const after = caseReducer(before, {
      type: "globals/setNumber",
      field: "spanOfControl",
      value: 12,
    });
    expect(after.units).toBe(before.units);
  });
});

describe("roles", () => {
  it("removing a role strips it from every unit's headcount and cost", () => {
    const c = run(
      blank(),
      { type: "region/add", name: "Europe" },
      { type: "unit/setHeadcount", unitId: "europe", roleId: "manager", value: 4 },
      { type: "unit/setCost", unitId: "europe", roleId: "manager", value: 140_000 },
      { type: "role/remove", roleId: "manager" },
    );
    // A leftover cost entry for a deleted role keeps weighting the blended-cost
    // SUMPRODUCT against a role that no longer exists.
    expect(c.roles.map((r) => r.id)).toEqual(["front-line"]);
    expect(c.units[0]!.headcount).not.toHaveProperty("manager");
    expect(c.units[0]!.cost).not.toHaveProperty("manager");
  });

  it("added roles get distinct ids", () => {
    const c = run(blank(), { type: "role/add", tier: "other" }, { type: "role/add", tier: "other" });
    const ids = c.roles.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("phase weights", () => {
  it("resize keeps a standard profile when the length still matches", () => {
    const c = caseReducer(blank(), { type: "phaseWeights/resize", phaseCount: 4 });
    expect(c.globals.phaseWeights["Front-loaded"]).toEqual([0.5, 0.3, 0.15, 0.05]);
  });

  it("resize to a non-standard count produces an even split that sums to 1", () => {
    const c = caseReducer(blank(), { type: "phaseWeights/resize", phaseCount: 5 });
    expect(c.globals.phaseCount).toBe(5);
    for (const weights of Object.values(c.globals.phaseWeights)) {
      expect(weights).toHaveLength(5);
      expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
  });

  it("does not silently reshape weights when phaseCount alone changes", () => {
    // G9 should surface the mismatch instead. Reshaping here would overwrite a
    // front-loaded profile the user chose on purpose.
    const c = caseReducer(blank(), { type: "globals/setNumber", field: "phaseCount", value: 6 });
    expect(c.globals.phaseWeights["Front-loaded"]).toHaveLength(4);
  });
});

describe("benchmark fill", () => {
  const withIndustry = () =>
    run(
      blank(),
      { type: "meta/set", field: "industry", value: "Healthcare" },
      { type: "region/add", name: "North America" },
      { type: "region/add", name: "Europe" },
    );

  it("fills only the gaps, never overwriting a typed figure", () => {
    const c = run(
      withIndustry(),
      { type: "unit/setCost", unitId: "europe", roleId: "front-line", value: 61_000 },
      { type: "benchmark/applyCompensation" },
    );
    expect(c.units[0]!.cost["front-line"]).toBe(75_000); // benchmark filled the gap
    expect(c.units[1]!.cost["front-line"]).toBe(61_000); // the answer survived
    expect(c.units[0]!.cost["manager"]).toBe(125_000);
  });

  it("is a no-op for an industry with no benchmark", () => {
    const before = run(blank(), { type: "meta/set", field: "industry", value: "Other" }, { type: "region/add", name: "Europe" });
    expect(caseReducer(before, { type: "benchmark/applyCompensation" })).toBe(before);
  });
});

describe("blank case", () => {
  it("starts numeric globals at their documented defaults and text at empty", () => {
    const c = blank();
    expect(c.globals).toEqual(DEFAULT_GLOBALS);
    expect(c.meta.company).toBe("");
    expect(c.units).toEqual([]);
  });

  it("takes asOfDate from the caller rather than the clock", () => {
    // G20: the engine bans reading the clock, and the ban is worthless if the
    // factory does it instead.
    expect(blank().meta.asOfDate).toBe(AS_OF);
  });

  it("does not share mutable globals between two blank cases", () => {
    const a = blank();
    const b = blank();
    a.globals.phaseWeights["Even"]![0] = 0.99;
    expect(b.globals.phaseWeights["Even"]![0]).toBe(0.25);
  });
});

describe("applying a regional volume import", () => {
  const seeded = () =>
    run(
      blank(),
      { type: "region/add", name: "Europe" },
      { type: "region/add", name: "North America" },
    );

  it("writes the annual volume onto the matched row", () => {
    const c = run(seeded(), {
      type: "volumes/apply",
      entries: [{ unitId: "europe", region: "Europe", unitName: "", annualVolume: 124_000 }],
      applyHandleTime: false,
    });
    expect(c.units.find((u) => u.id === "europe")!.volume).toBe(124_000);
  });

  it("leaves rows the file did not mention by reference, not merely equal", () => {
    const before = seeded();
    const after = run(before, {
      type: "volumes/apply",
      entries: [{ unitId: "europe", region: "Europe", unitName: "", annualVolume: 124_000 }],
      applyHandleTime: false,
    });

    const na = (c: Case) => c.units.find((u) => u.id === "north-america")!;
    // Identity, not equality. The engine memoises per-unit results in a WeakMap keyed on
    // the object, so a rebuilt row is a silently recomputed row.
    expect(na(after)).toBe(na(before));
    expect(na(after).volume).toBe(SENTINEL);
  });

  it("creates a row for a region the case did not have", () => {
    const c = run(seeded(), {
      type: "volumes/apply",
      entries: [{ unitId: null, region: "Asia Pacific", unitName: "", annualVolume: 9_600 }],
      applyHandleTime: false,
    });
    expect(regionsOf(c)).toEqual(["Europe", "North America", "Asia Pacific"]);
    const created = c.units.find((u) => u.region === "Asia Pacific")!;
    expect(created.id).toBe("asia-pacific");
    // Named after the region, as `region/add` does, so the two paths produce the same shape.
    expect(created.name).toBe("Asia Pacific");
    expect(created.volume).toBe(9_600);
  });

  it("creates a named row inside an existing region", () => {
    const c = run(seeded(), {
      type: "volumes/apply",
      entries: [
        { unitId: null, region: "Europe", unitName: "Recoveries", annualVolume: 3_000 },
      ],
      applyHandleTime: false,
    });
    const created = c.units.find((u) => u.name === "Recoveries")!;
    expect(created.id).toBe("europe-recoveries");
    expect(created.region).toBe("Europe");
    expect(c.units.filter((u) => u.region === "Europe")).toHaveLength(2);
  });

  it("gives two new rows distinct ids without consulting a clock", () => {
    const entries = [
      { unitId: null, region: "Europe", unitName: "Intake", annualVolume: 1_000 },
      { unitId: null, region: "Europe", unitName: "Intake", annualVolume: 2_000 },
    ];
    const first = run(seeded(), { type: "volumes/apply", entries, applyHandleTime: false });
    const second = run(seeded(), { type: "volumes/apply", entries, applyHandleTime: false });
    expect(first.units.map((u) => u.id)).toEqual([
      "europe",
      "north-america",
      "europe-intake",
      "europe-intake-2",
    ]);
    // Deterministic, so a saved case diffs cleanly and a test replays identically.
    expect(second.units.map((u) => u.id)).toEqual(first.units.map((u) => u.id));
  });

  it("writes handle time only when asked to", () => {
    const entries = [
      {
        unitId: "europe",
        region: "Europe",
        unitName: "",
        annualVolume: 124_000,
        handleTimeMinutes: 14.5,
      },
    ];

    const without = run(seeded(), { type: "volumes/apply", entries, applyHandleTime: false });
    // Still inheriting: the key is absent rather than undefined, or a JSON round-trip
    // would turn "inherits the global" into "has no value".
    expect("handleTimeMinutes" in without.units[0]!).toBe(false);

    const with_ = run(seeded(), { type: "volumes/apply", entries, applyHandleTime: true });
    expect(with_.units[0]!.handleTimeMinutes).toBe(14.5);
  });

  it("leaves an existing handle time alone when the file carried none", () => {
    const c = run(
      seeded(),
      { type: "unit/setDriver", unitId: "europe", driver: "handleTimeMinutes", value: 22 },
      {
        type: "volumes/apply",
        entries: [{ unitId: "europe", region: "Europe", unitName: "", annualVolume: 124_000 }],
        applyHandleTime: true,
      },
    );
    // A volumes file with no time column must not overwrite a measured figure, and must
    // not clear it either — it simply has nothing to say about handle time.
    expect(c.units[0]!.handleTimeMinutes).toBe(22);
  });

  it("is idempotent, so re-importing a corrected file does not double the volume", () => {
    const action: CaseAction = {
      type: "volumes/apply",
      entries: [{ unitId: "europe", region: "Europe", unitName: "", annualVolume: 124_000 }],
      applyHandleTime: false,
    };
    const once = run(seeded(), action);
    const twice = run(once, action);
    expect(twice.units.find((u) => u.id === "europe")!.volume).toBe(124_000);
  });

  it("returns the same case when there is nothing to apply", () => {
    const before = seeded();
    expect(caseReducer(before, { type: "volumes/apply", entries: [], applyHandleTime: true })).toBe(
      before,
    );
  });
});
