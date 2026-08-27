/**
 * Typing the capacity study by hand.
 *
 * The uploads and the form write one document, so these assert the form reaches the same
 * shape the importer does — and that the three invariants hold on every edit: roles follow
 * the rows, every named task type gets a demand cell, and an unfinished row reaches no
 * demand at all.
 *
 * Fixture arithmetic at the documented default of 1,880 hours x 75% = 84,600 productive
 * minutes per FTE:
 *
 *   Log the request    New  Analyst -> Assistant  10 min
 *   Check completeness New  Analyst -> Analyst     20 min      New = 10,000 transactions
 *
 *   current  Analyst   30 x 10,000 = 300,000 min -> 3.5461 FTE
 *   target   Analyst   20 x 10,000 = 200,000 min -> 2.3641 FTE
 *            Assistant 10 x 10,000 = 100,000 min -> 1.1820 FTE
 */

import { describe, expect, it } from "vitest";

import { createBlankCase } from "./case-defaults";
import { caseReducer, type CaseAction } from "./case-reducer";
import { taskOf, typeOf, volumeOfType } from "./capacity-edit";
import { compareCapacity, computeCapacity } from "./engine/capacity";
import type { CapacityBlock, Case } from "./engine/types";
import { SENTINEL } from "./engine/types";
import { reconcileTaskTypes } from "./import/simple-capacity";

const AS_OF = "2026-08-26";
const blank = () => createBlankCase(AS_OF);

const run = (start: Case, ...actions: CaseAction[]): Case =>
  actions.reduce((c, a) => caseReducer(c, a), start);

const block = (c: Case): CapacityBlock => {
  if (!c.capacity) throw new Error("no capacity block");
  return c.capacity;
};

const byRole = <T extends { role: string }>(result: { roles: T[] }, role: string): T => {
  const found = result.roles.find((r) => r.role === role);
  if (!found) throw new Error(`no role ${role}`);
  return found;
};

/** Two tasks of one type, plus its volume — the case above, typed. */
const typed = (): Case =>
  run(
    blank(),
    { type: "capacity/addTask" },
    {
      type: "capacity/setTask",
      rowId: "task",
      patch: {
        task: "Log the request",
        taskType: "New",
        currentRole: "Analyst",
        targetRole: "Assistant",
        ahtMinutes: 10,
      },
    },
    { type: "capacity/addTask" },
    {
      type: "capacity/setTask",
      rowId: "task-2",
      patch: {
        task: "Check completeness",
        taskType: "New",
        currentRole: "Analyst",
        targetRole: "Analyst",
        ahtMinutes: 20,
      },
    },
    { type: "capacity/setTypeVolume", taskType: "New", volume: 10_000 },
  );

describe("adding a task", () => {
  it("creates the capacity block and enters the capacity model", () => {
    const c = caseReducer(blank(), { type: "capacity/addTask" });
    // Typing a task is entering the capacity model, the same as uploading a study is.
    // Otherwise the answer would live on a tab the case cannot reach.
    expect(c.model).toBe("capacity");
    expect(block(c).rows).toHaveLength(1);
    expect(block(c).roleColumns).toEqual(["current", "target"]);
    expect(block(c).baseColumn).toBe("current");
    expect(block(c).targetColumn).toBe("target");
  });

  it("starts the handling time known-missing rather than at zero", () => {
    const row = block(caseReducer(blank(), { type: "capacity/addTask" })).rows[0]!;
    // A zero would assert the task takes no time and quietly reduce the requirement; the
    // sentinel reports it as unmeasured.
    expect(row.ahtMinutes).toBe(SENTINEL);
    expect(row.frequency).toBe(1);
  });

  it("gives deterministic ids without consulting a clock", () => {
    const c = run(blank(), { type: "capacity/addTask" }, { type: "capacity/addTask" });
    expect(block(c).rows.map((r) => r.id)).toEqual(["task", "task-2"]);
    const again = run(blank(), { type: "capacity/addTask" }, { type: "capacity/addTask" });
    expect(block(again).rows.map((r) => r.id)).toEqual(block(c).rows.map((r) => r.id));
  });

  it("reaches no demand until it has a task type", () => {
    const c = run(
      typed(),
      { type: "capacity/addTask" },
      // A role and a time, but no type: the row looks finished.
      {
        type: "capacity/setTask",
        rowId: "task-3",
        patch: { task: "Unfinished", currentRole: "Analyst", ahtMinutes: 999 },
      },
    );

    // An empty transactionTypes list means "every type" to the engine, so a half-typed row
    // would silently pick up the whole book. Stored as [""] instead, which matches no
    // demand cell — 300,000 minutes, exactly as before the row was added.
    expect(byRole(computeCapacity(block(c), "current"), "Analyst").totalMinutes).toBe(300_000);
    expect(typeOf(block(c).rows[2]!)).toBe("");
  });

  it("does not report an unfinished row as a type awaiting a volume", () => {
    const c = run(typed(), { type: "capacity/addTask" });
    const capacity = block(c);
    // "" is an unfinished row, not a type with no volume. The grid flags it in place.
    expect(reconcileTaskTypes(capacity.rows, capacity.demand).withoutVolume).toEqual([]);
  });
});

describe("editing a task", () => {
  it("computes capacity in both states from what was typed", () => {
    const capacity = block(typed());

    const current = computeCapacity(capacity, "current");
    expect(byRole(current, "Analyst").totalMinutes).toBe(300_000);
    expect(byRole(current, "Analyst").requiredFte).toBeCloseTo(3.5460992908, 8);

    const target = computeCapacity(capacity, "target");
    expect(byRole(target, "Analyst").requiredFte).toBeCloseTo(2.3640661939, 8);
    expect(byRole(target, "Assistant").requiredFte).toBeCloseTo(1.1820330969, 8);
  });

  it("reports the surplus and the deficit per role", () => {
    const comparison = compareCapacity(block(typed()), "current", "target");
    expect(byRole(comparison, "Analyst").deltaFte).toBeCloseTo(-1.1820330969, 8);
    expect(byRole(comparison, "Assistant").deltaFte).toBeCloseTo(1.1820330969, 8);
    // No automation here, so the two states need the same total: work moved, none left.
    expect(comparison.netFteChange).toBeCloseTo(0, 10);
  });

  it("creates capacity parameters for a role as soon as it is named", () => {
    const c = typed();
    const analyst = block(c).roles.find((r) => r.role === "Analyst")!;
    expect(analyst.workingHoursPerYear).toBe(1880);
    expect(analyst.utilisationPct).toBe(0.75);
    expect(block(c).roles.map((r) => r.role)).toEqual(["Analyst", "Assistant"]);
  });

  it("reads an automation name as an automation target", () => {
    const c = caseReducer(typed(), {
      type: "capacity/setTask",
      rowId: "task",
      patch: { targetRole: "System" },
    });
    expect(block(c).roles.find((r) => r.role === "System")!.automated).toBe(true);
    // Its minutes leave human capacity rather than being staffed at some notional rate.
    expect(computeCapacity(block(c), "target").automatedMinutes).toBe(100_000);
  });

  it("keeps parameters the user already changed when a task is corrected", () => {
    const c = run(
      typed(),
      { type: "capacity/setRoleParam", role: "Analyst", patch: { utilisationPct: 0.6 } },
      // Fixing a typo in the task name must not reset the role behind it.
      { type: "capacity/setTask", rowId: "task", patch: { task: "Log the request in full" } },
    );
    expect(block(c).roles.find((r) => r.role === "Analyst")!.utilisationPct).toBe(0.6);
    expect(taskOf(block(c).rows[0]!)).toBe("Log the request in full");
  });

  it("drops a role nothing names any more", () => {
    const c = caseReducer(typed(), {
      type: "capacity/setTask",
      rowId: "task",
      patch: { targetRole: "Analyst" },
    });
    // Assistant is no longer named by any row, so it stops appearing. Left behind it would
    // sit in the role table at zero, inviting hours and a cost against work nobody does.
    expect(block(c).roles.map((r) => r.role)).toEqual(["Analyst"]);
  });

  it("clears a target role to absent, so the work stays where it is", () => {
    const c = caseReducer(typed(), {
      type: "capacity/setTask",
      rowId: "task",
      patch: { targetRole: "" },
    });
    // Absent, not "": that is what makes the engine carry the current owner forward rather
    // than reading the task as work that reaches nobody.
    expect("target" in block(c).rows[0]!.roles).toBe(false);
    expect(byRole(computeCapacity(block(c), "target"), "Analyst").totalMinutes).toBe(300_000);
  });

  it("normalises a role name on the way in", () => {
    const c = caseReducer(typed(), {
      type: "capacity/setTask",
      rowId: "task-2",
      patch: { currentRole: "  Senior   Analyst " },
    });
    // A trailing space makes a role a different role and drops its minutes from the rollup,
    // so it is trimmed and internal runs collapsed before the value is stored.
    expect(block(c).rows[1]!.roles["current"]).toBe("Senior Analyst");
  });

  it("removes a task and any exclusion decision about it", () => {
    const c = run(
      typed(),
      { type: "capacity/setExcludedRowIds", rowIds: ["task-2"] },
      { type: "capacity/removeTask", rowId: "task-2" },
    );
    expect(block(c).rows).toHaveLength(1);
    expect(block(c).excludedRowIds).toEqual([]);
    expect(byRole(computeCapacity(block(c), "current"), "Analyst").totalMinutes).toBe(100_000);
  });
});

describe("volume by task type", () => {
  it("creates a demand cell the moment a type is named, holding no volume yet", () => {
    const c = run(
      blank(),
      { type: "capacity/addTask" },
      { type: "capacity/setTask", rowId: "task", patch: { taskType: "Renewal" } },
    );
    const cell = block(c).demand[0]!;
    expect(cell.transactionType).toBe("Renewal");
    // Known-missing rather than zero: a type named but not counted has an unknown volume,
    // where a zero would claim it has no work at all.
    expect(cell.submissions).toBe(SENTINEL);
  });

  it("is shared by every task of the type", () => {
    const capacity = block(typed());
    expect(capacity.demand).toHaveLength(1);
    // One count of transactions behind both tasks, which is why the grid shows it once.
    expect(volumeOfType(capacity, "New")).toBe(10_000);
  });

  it("moves every task of the type when it changes", () => {
    const c = caseReducer(typed(), {
      type: "capacity/setTypeVolume",
      taskType: "New",
      volume: 20_000,
    });
    expect(byRole(computeCapacity(block(c), "current"), "Analyst").totalMinutes).toBe(600_000);
  });

  it("clears to known-missing, not to zero", () => {
    const c = caseReducer(typed(), { type: "capacity/setTypeVolume", taskType: "New", volume: null });
    expect(block(c).demand[0]!.submissions).toBe(SENTINEL);
    expect(volumeOfType(block(c), "New")).toBeNull();
  });

  it("ignores a volume for no type at all", () => {
    const before = typed();
    expect(caseReducer(before, { type: "capacity/setTypeVolume", taskType: "", volume: 5 })).toBe(
      before,
    );
  });

  it("keeps a volume behind when a type is renamed away, and says it is orphaned", () => {
    const c = run(
      typed(),
      { type: "capacity/setTask", rowId: "task", patch: { taskType: "Renewal" } },
      { type: "capacity/setTask", rowId: "task-2", patch: { taskType: "Renewal" } },
    );
    const capacity = block(c);

    // Both cells survive: the rename could be a typo fix, and throwing away a typed-in
    // volume to tidy up would be the worse mistake.
    expect(capacity.demand.map((d) => d.transactionType).sort()).toEqual(["New", "Renewal"]);
    expect(volumeOfType(capacity, "New")).toBe(10_000);
    // New now has a volume nothing is measured against, which is how the user finds the
    // figure they typed and can move it.
    expect(reconcileTaskTypes(capacity.rows, capacity.demand).withoutTasks).toEqual(["New"]);
  });

  it("makes the role read n/a rather than understated when a type has no volume", () => {
    const c = caseReducer(typed(), {
      type: "capacity/setTask",
      rowId: "task-2",
      // A second type, measured, with no volume against it.
      patch: { taskType: "Renewal" },
    });
    const analyst = byRole(computeCapacity(block(c), "current"), "Analyst");

    // The sentinel propagates: the Analyst requirement is unknown, not 100,000 minutes.
    // Reporting the part that happens to be countable is the failure mode this prevents —
    // a confident figure covering some of the work.
    expect(Number.isNaN(analyst.totalMinutes)).toBe(true);
    expect(Number.isNaN(analyst.requiredFte)).toBe(true);
  });
});

describe("guards", () => {
  it("ignores every task edit on a case with no capacity block", () => {
    const before = blank();
    for (const action of [
      { type: "capacity/setTask", rowId: "task", patch: { task: "x" } },
      { type: "capacity/removeTask", rowId: "task" },
      { type: "capacity/setTypeVolume", taskType: "New", volume: 1 },
    ] as CaseAction[]) {
      expect(caseReducer(before, action)).toBe(before);
    }
  });

  it("ignores an edit to a row that is not there", () => {
    const before = typed();
    expect(
      caseReducer(before, { type: "capacity/setTask", rowId: "nope", patch: { task: "x" } }),
    ).toBe(before);
  });
});
