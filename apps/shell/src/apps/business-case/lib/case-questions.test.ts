import { describe, expect, it } from "vitest";

import { createBlankCase } from "./case-defaults";
import { BATCHES, QUESTIONS, batchProgress, readiness } from "./case-questions";
import { caseReducer, type CaseAction } from "./case-reducer";
import { createSampleCase } from "./sample-case";
import type { Case } from "./engine/types";

const blank = () => createBlankCase("2026-08-18");

const run = (start: Case, ...actions: CaseAction[]): Case =>
  actions.reduce((c, a) => caseReducer(c, a), start);

const statusOf = (c: Case, id: string) => QUESTIONS.find((q) => q.id === id)!.status(c);

describe("question coverage", () => {
  it("carries the skill's 35 questions, each exactly once", () => {
    // The whole point of holding these as data: a question cannot quietly go missing
    // in a refactor and be noticed by a client instead.
    expect(QUESTIONS).toHaveLength(35);
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(35);
  });

  it("numbers them Q1..Q35 with no gaps", () => {
    const numbers = QUESTIONS.map((q) => Number(q.id.slice(1))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 35 }, (_, i) => i + 1));
  });

  it("assigns every question to a declared batch, and leaves no batch empty", () => {
    const batchIds = new Set(BATCHES.map((b) => b.id));
    for (const q of QUESTIONS) expect(batchIds.has(q.batch)).toBe(true);
    for (const b of BATCHES) {
      expect(QUESTIONS.filter((q) => q.batch === b.id).length).toBeGreaterThan(0);
    }
  });
});

describe("blank case readiness", () => {
  it("cannot generate, and names every outstanding requirement", () => {
    const r = readiness(blank());
    expect(r.canGenerate).toBe(false);
    expect(r.blocking.map((q) => q.id).sort()).toEqual(
      [
        "Q1", // company
        "Q11", // front-line FTE per row
        "Q15", // front-line cost per row
        "Q17", // workload unit name
        "Q18", // volume per row
        "Q2", // industry
        "Q20", // handle time
        "Q24", // base reduction %
        "Q4", // initiative title
        "Q6", // at least one region
        "Q9", // front-line role title
      ].sort(),
    );
  });

  it("reports defaults as defaults rather than as answers", () => {
    const c = blank();
    // A case built entirely from defaults must not look interviewed.
    expect(statusOf(c, "Q7")).toBe("default"); // 1,880 hours
    expect(statusOf(c, "Q8")).toBe("default"); // 75%
    expect(statusOf(c, "Q13")).toBe("default"); // span 1:8
    expect(statusOf(c, "Q28")).toBe("default"); // 3-year horizon
    // Nothing is answered on a blank case. In particular the two inputs the answer
    // is most sensitive to — handle time and the Base reduction — start empty rather
    // than holding a plausible figure nobody agreed to.
    expect(readiness(c).answered).toBe(0);
    expect(statusOf(c, "Q20")).toBe("empty");
    expect(statusOf(c, "Q24")).toBe("empty");
  });

  it("accepts a Time Study as the answer to handle time", () => {
    const c = run(
      blank(),
      { type: "globals/setChoice", patch: { handleTimeSource: "Time Study" } },
      { type: "timeStudy/add" },
      { type: "timeStudy/set", index: 0, patch: { taskType: "Intake", minutes: 31, volume: 240_000 } },
    );
    expect(statusOf(c, "Q20")).toBe("answered");
  });

  it("the suggested 8/12/18 spread is a press, not a pre-fill", () => {
    const c = caseReducer(blank(), { type: "scenario/applySuggestedSpread" });
    expect(c.scenarios.base.hcReductionPct).toBe(0.12);
    expect(statusOf(c, "Q24")).toBe("answered");
  });

  it("counts a default as answered once the user moves it", () => {
    const c = caseReducer(blank(), {
      type: "globals/setNumber",
      field: "workingHoursPerYear",
      value: 1720,
    });
    expect(statusOf(c, "Q7")).toBe("answered");
  });
});

describe("not-applicable questions", () => {
  it("excludes consulting cost when the mode does not carry it", () => {
    const c = caseReducer(blank(), {
      type: "globals/setChoice",
      patch: { implementationCosts: "Severance only" },
    });
    expect(statusOf(c, "Q30")).toBe("n/a");
  });

  it("excludes severance entirely when no implementation costs are modelled", () => {
    const c = caseReducer(blank(), {
      type: "globals/setChoice",
      patch: { implementationCosts: "None" },
    });
    expect(statusOf(c, "Q26")).toBe("n/a");
    expect(statusOf(c, "Q27")).toBe("n/a");
  });

  it("excludes the time study while the handle-time source is Manual", () => {
    expect(statusOf(blank(), "Q21")).toBe("n/a");
    const study = caseReducer(blank(), {
      type: "globals/setChoice",
      patch: { handleTimeSource: "Time Study" },
    });
    expect(statusOf(study, "Q21")).toBe("empty");
  });

  it("keeps n/a questions out of the progress denominator", () => {
    const manual = batchProgress(blank()).find((b) => b.batch.id === "timeStudy")!;
    expect(manual.applicable).toBe(0);
  });
});

describe("all-rows requirements", () => {
  const twoRegions = () =>
    run(
      blank(),
      { type: "region/add", name: "North America" },
      { type: "region/add", name: "Europe" },
    );

  it("front-line cost is answered only when EVERY row has one", () => {
    const partial = run(twoRegions(), {
      type: "unit/setCost",
      unitId: "north-america",
      roleId: "front-line",
      value: 85_000,
    });
    // Nine of ten rows costed is exactly the case that yields a confident blended
    // figure covering 90% of the population. G21 blocks the export on it, so the
    // form must not call it answered.
    expect(statusOf(partial, "Q15")).toBe("empty");

    const complete = caseReducer(partial, {
      type: "unit/setCost",
      unitId: "europe",
      roleId: "front-line",
      value: 88_000,
    });
    expect(statusOf(complete, "Q15")).toBe("answered");
  });

  it("volume is answered only when no row is still sentinel", () => {
    const partial = run(twoRegions(), { type: "unit/setVolume", unitId: "europe", value: 120_000 });
    expect(statusOf(partial, "Q18")).toBe("empty");
  });
});

describe("a fully answered case", () => {
  it("the sample case can generate", () => {
    const r = readiness(createSampleCase());
    expect(r.blocking).toEqual([]);
    expect(r.canGenerate).toBe(true);
  });

  it("a case entered from blank can reach generatable", () => {
    const c = run(
      blank(),
      { type: "meta/set", field: "company", value: "Northwind Assurance" },
      { type: "meta/set", field: "industry", value: "Insurance / Reinsurance" },
      { type: "meta/set", field: "initiativeTitle", value: "Claims Optimisation" },
      { type: "meta/set", field: "workloadUnitName", value: "Claims" },
      { type: "role/setTitle", roleId: "front-line", title: "Claims Processor" },
      { type: "role/setTitle", roleId: "manager", title: "Team Lead" },
      { type: "region/add", name: "North America" },
      { type: "unit/setVolume", unitId: "north-america", value: 480_000 },
      { type: "unit/setHeadcount", unitId: "north-america", roleId: "front-line", value: 84 },
      { type: "unit/setHeadcount", unitId: "north-america", roleId: "manager", value: 11 },
      { type: "benchmark/applyCompensation" },
      { type: "globals/setNumber", field: "handleTimeMinutes", value: 22 },
      { type: "scenario/set", scenario: "base", hcReductionPct: 0.12 },
    );

    const r = readiness(c);
    expect(r.blocking).toEqual([]);
    expect(r.canGenerate).toBe(true);
  });
});
