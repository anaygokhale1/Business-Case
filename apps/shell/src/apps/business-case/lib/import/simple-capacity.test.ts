/**
 * The simple two-file capacity format.
 *
 * The point of these tests is the join: five columns of study plus two of volumes have to
 * produce required FTE per role in both states, and every figure below is derived by hand
 * from the fixture rather than recorded from a run.
 *
 * Fixture arithmetic, at the documented default of 1,880 hours x 75% = 84,600 productive
 * minutes per FTE:
 *
 *   current  Analyst   (10+20+30) x 10,000 + (8+15) x 6,000 = 738,000 min -> 8.7234 FTE
 *            Assistant           5 x 10,000                 =  50,000 min -> 0.5910 FTE
 *   target   Analyst          20 x 10,000 + 15 x 6,000       = 290,000 min -> 3.4279 FTE
 *            Assistant   (10+5) x 10,000 + 8 x 6,000        = 198,000 min -> 2.3404 FTE
 *            System           30 x 10,000                    = 300,000 min -> automated
 *
 * 788,000 - 488,000 = 300,000, exactly the minutes that moved to System. Minutes are
 * conserved and the only loss is to automation, which is the check that catches a study
 * silently dropping work between the two states.
 */

import { describe, expect, it } from "vitest";

import { createBlankCase } from "../case-defaults";
import { caseReducer } from "../case-reducer";
import { compareCapacity, computeCapacity } from "../engine/capacity";
import type { Case, CapacityBlock } from "../engine/types";
import { parseCsv, type Sheet } from "./tabular";
import {
  convertSimpleStudyRows,
  convertSimpleVolumeRows,
  defaultVolumeBasis,
  detectSimpleStudyHeaderRow,
  detectSimpleVolumeHeaderRow,
  proposeSimpleStudyMapping,
  proposeSimpleVolumeMapping,
  reconcileTaskTypes,
  SIMPLE_LOB,
  type SimpleStudyMapping,
  type SimpleVolumeMapping,
} from "./simple-capacity";

const sheet = (csv: string): Sheet => ({ name: "Sheet1", rows: parseCsv(csv) });

const STUDY = `Task / Action,Task Type,Current Role,Target Role,Average Handling Time
Log the request,New,Analyst,Assistant,10
Check completeness,New,Analyst,Analyst,20
Price the risk,New,Analyst,System,30
Issue documents,New,Assistant,Assistant,5
Log the request,Renewal,Analyst,Assistant,8
Review terms,Renewal,Analyst,Analyst,15`;

const VOLUMES = `Task Type,Volume
New,10000
Renewal,6000`;

const studyMapping = (csv: string): SimpleStudyMapping => {
  const rows = parseCsv(csv);
  return proposeSimpleStudyMapping(rows[detectSimpleStudyHeaderRow(rows)] ?? []);
};

const volumeMapping = (csv: string): SimpleVolumeMapping => {
  const rows = parseCsv(csv);
  return proposeSimpleVolumeMapping(rows[detectSimpleVolumeHeaderRow(rows)] ?? []);
};

const importStudy = (csv: string = STUDY) => convertSimpleStudyRows(sheet(csv), 0, studyMapping(csv));

const importVolumes = (csv: string = VOLUMES) => {
  const mapping = volumeMapping(csv);
  return convertSimpleVolumeRows(sheet(csv), 0, mapping, defaultVolumeBasis(mapping));
};

/** Build the case the way the UI does, so the reducer path is under test too. */
const loaded = (studyCsv = STUDY, volumesCsv = VOLUMES): Case => {
  const withStudy = caseReducer(createBlankCase("2026-08-26"), {
    type: "capacity/applyStudy",
    study: importStudy(studyCsv),
    fileName: "study.csv",
  });
  return caseReducer(withStudy, {
    type: "capacity/applyVolumes",
    demand: importVolumes(volumesCsv).demand,
    fileName: "volumes.csv",
  });
};

const block = (c: Case): CapacityBlock => {
  if (!c.capacity) throw new Error("no capacity block");
  return c.capacity;
};

const byRole = <T extends { role: string }>(result: { roles: T[] }, role: string): T => {
  const found = result.roles.find((r) => r.role === role);
  if (!found) throw new Error(`no role ${role}`);
  return found;
};

describe("mapping the five study columns", () => {
  it("maps them from their documented headers", () => {
    const mapping = studyMapping(STUDY);
    expect(mapping.task).toBe(0);
    expect(mapping.taskType).toBe(1);
    expect(mapping.currentRole).toBe(2);
    expect(mapping.targetRole).toBe(3);
    expect(mapping.ahtMinutes).toBe(4);
  });

  it("does not read Task Type as the task name", () => {
    // "Task Type" starts with "task", so a scorer without an exact-match preference
    // would hand column 2 to the task label and leave the type unmapped.
    const mapping = proposeSimpleStudyMapping(["Task Type", "Task", "AHT"]);
    expect(mapping.taskType).toBe(0);
    expect(mapping.task).toBe(1);
  });

  it("does not read Target Role as the current role", () => {
    const mapping = proposeSimpleStudyMapping(["Target Role", "Current Role", "Minutes"]);
    expect(mapping.targetRole).toBe(0);
    expect(mapping.currentRole).toBe(1);
  });

  it("accepts the shorter headings people actually use", () => {
    const mapping = proposeSimpleStudyMapping(["Activity", "Type", "As-Is", "To-Be", "AHT (mins)"]);
    expect(mapping.task).toBe(0);
    expect(mapping.taskType).toBe(1);
    expect(mapping.currentRole).toBe(2);
    expect(mapping.targetRole).toBe(3);
    expect(mapping.ahtMinutes).toBe(4);
  });

  it("finds the header row under a title block", () => {
    const rows = parseCsv(
      `Capacity time study,,,,\nDraft,,,,\n,,,,\nTask,Task Type,Current Role,Target Role,AHT\nLog,New,Analyst,Assistant,10`,
    );
    expect(detectSimpleStudyHeaderRow(rows)).toBe(3);
  });
});

describe("converting the study", () => {
  it("produces one row per task, filed under the single line of business", () => {
    const result = importStudy();
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((r) => r.lob === SIMPLE_LOB)).toBe(true);
    // Task Type becomes the transaction-type dimension, which is what the volumes join on.
    expect(result.rows[0]!.transactionTypes).toEqual(["New"]);
    // One occurrence per transaction: the simple format has no frequency column, and any
    // other default would scale the whole study.
    expect(result.rows.every((r) => r.frequency === 1)).toBe(true);
    expect(result.discovered.roleColumns).toEqual(["current", "target"]);
    expect(result.discovered.roles).toEqual(["Analyst", "Assistant", "System"]);
    expect(result.discovered.transactionTypes).toEqual(["New", "Renewal"]);
  });

  it("gives rows ids from what they are, so an inserted row does not renumber them", () => {
    const ids = importStudy().rows.map((r) => r.id);
    expect(ids[0]).toBe("new-logtherequest");
    // Same task name, different type — distinct rows, not a collision.
    expect(ids).toContain("renewal-logtherequest");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves a blank target role absent rather than empty", () => {
    const result = importStudy(`Task,Task Type,Current Role,Target Role,AHT
Log the request,New,Analyst,,10`);
    // Absent, not "". That is what makes the engine carry the current owner forward
    // instead of reading the task as work that reaches nobody.
    expect("target" in result.rows[0]!.roles).toBe(false);
    expect(result.rows[0]!.roles["current"]).toBe("Analyst");
  });

  it("keeps unchanged work in the target state when only movers name a target", () => {
    const c = loaded(`Task,Task Type,Current Role,Target Role,AHT
Log the request,New,Analyst,Assistant,10
Check completeness,New,Analyst,,20`);
    const target = computeCapacity(block(c), "target");
    // 20 min x 10,000 stays with the Analyst rather than vanishing.
    expect(byRole(target, "Analyst").totalMinutes).toBe(200_000);
    expect(byRole(target, "Assistant").totalMinutes).toBe(100_000);
    expect(target.orphanedStepCount).toBe(0);
  });

  it("trims a role name before it is ever compared", () => {
    const result = importStudy(`Task,Task Type,Current Role,Target Role,AHT
Log,New,Analyst ,Assistant,10
Check,New, Analyst,Assistant,20`);
    // A single trailing space would otherwise split one team into two roles, each with
    // part of the minutes, and the totals would still add up.
    expect(result.discovered.roles).toEqual(["Analyst", "Assistant"]);
  });

  it("skips a row with no task type and says why", () => {
    const result = importStudy(`Task,Task Type,Current Role,Target Role,AHT
Log the request,,Analyst,Assistant,10
Check completeness,New,Analyst,Analyst,20`);
    expect(result.rows).toHaveLength(1);
    expect(result.issues[0]!.dropped).toBe(true);
    expect(result.issues[0]!.message).toMatch(/no task type, so no volume can reach it/);
  });

  it("skips a row with no readable handling time", () => {
    const result = importStudy(`Task,Task Type,Current Role,Target Role,AHT
Log the request,New,Analyst,Assistant,tbc`);
    expect(result.rows).toHaveLength(0);
    expect(result.issues[0]!.message).toMatch(/no readable handling time/);
  });

  it("skips a row naming neither role, because its minutes reach nobody", () => {
    const result = importStudy(`Task,Task Type,Current Role,Target Role,AHT
Orphan task,New,,,10`);
    expect(result.rows).toHaveLength(0);
    expect(result.issues[0]!.message).toMatch(/neither a current nor a target role/);
  });

  it("flags a target-only row without dropping it", () => {
    const result = importStudy(`Task,Task Type,Current Role,Target Role,AHT
New work,New,,Assistant,10`);
    expect(result.rows).toHaveLength(1);
    const issue = result.issues.find((i) => /missing from the current state/.test(i.message));
    // Kept, because new work in the target state is real, but the baseline the whole
    // comparison is measured from is understated and that has to be visible.
    expect(issue?.dropped).toBe(false);
  });

  it("flags an identical repeated measurement and counts both", () => {
    const result = importStudy(`Task,Task Type,Current Role,Target Role,AHT
Log the request,New,Analyst,Assistant,10
Log the request,New,Analyst,Assistant,10`);
    expect(result.rows).toHaveLength(2);
    expect(result.issues.some((i) => /identical to row 2/.test(i.message) && !i.dropped)).toBe(true);
  });

  it("reads a decimal comma in the time column", () => {
    const result = importStudy(`Task,Task Type,Current Role,Target Role,AHT
Log,New,Analyst,Assistant,"12,5"`);
    expect(result.rows[0]!.ahtMinutes).toBe(12.5);
  });
});

describe("converting the volumes", () => {
  it("produces one demand cell per task type, joined on the study's line of business", () => {
    const result = importVolumes();
    expect(result.demand).toEqual([
      { lob: SIMPLE_LOB, transactionType: "New", submissions: 10_000 },
      { lob: SIMPLE_LOB, transactionType: "Renewal", submissions: 6_000 },
    ]);
    expect(result.studyRows).toBeNull();
  });

  it("adds up repeated types in a file of type and count alone", () => {
    const result = importVolumes(`Task Type,Volume
New,4000
New,6000`);
    expect(result.basis).toBe("additive");
    expect(result.demand[0]!.submissions).toBe(10_000);
    expect(result.issues.some((i) => /2 rows added together/.test(i.message))).toBe(true);
  });

  it("takes the count once when the file has a row per task", () => {
    // The four columns as specified, plus the count. The volume is the type's, restated
    // on every task row — adding them would triple demand and nothing would look wrong.
    const result = importVolumes(`Task Type,Current Role,Target Role,Average Handling Time,Volume
New,Analyst,Assistant,10,10000
New,Analyst,Analyst,20,10000
New,Analyst,System,30,10000`);
    expect(result.basis).toBe("repeated");
    expect(result.demand).toHaveLength(1);
    expect(result.demand[0]!.submissions).toBe(10_000);
  });

  it("takes the largest and reports it when restated counts disagree", () => {
    const result = importVolumes(`Task Type,Current Role,Target Role,AHT,Volume
New,Analyst,Assistant,10,10000
New,Analyst,Analyst,20,9000`);
    // Understating demand understates the whole case, so the larger figure is used and
    // the disagreement is named rather than averaged away.
    expect(result.demand[0]!.submissions).toBe(10_000);
    expect(result.issues.some((i) => /state 10,000, 9,000 as the same volume/.test(i.message))).toBe(
      true,
    );
  });

  it("offers itself as the study when it carries roles and times", () => {
    const result = importVolumes(`Task Type,Current Role,Target Role,Average Handling Time,Volume
New,Analyst,Assistant,10,10000
Renewal,Analyst,Analyst,20,6000`);
    expect(result.studyRows).not.toBeNull();
    expect(result.studyRows!.rows).toHaveLength(2);
    // The type doubles as the task label, since a row-per-task volumes file has no
    // separate name column.
    expect(result.studyRows!.rows[0]!.path).toEqual(["New"]);
    expect(result.studyRows!.discovered.roles).toEqual(["Analyst", "Assistant"]);
  });

  it("drops a negative volume rather than netting it off", () => {
    const result = importVolumes(`Task Type,Volume
New,10000
Adjustment,(500)`);
    expect(result.demand).toHaveLength(1);
    expect(result.issues.some((i) => i.dropped && /negative volume/.test(i.message))).toBe(true);
  });

  it("reads thousands separators", () => {
    const result = importVolumes(`Task Type,Volume
New,"12,400"`);
    expect(result.demand[0]!.submissions).toBe(12_400);
  });
});

describe("capacity from the two files", () => {
  it("computes required FTE per role in the current state", () => {
    const current = computeCapacity(block(loaded()), "current");
    expect(byRole(current, "Analyst").totalMinutes).toBe(738_000);
    expect(byRole(current, "Assistant").totalMinutes).toBe(50_000);
    expect(byRole(current, "Analyst").requiredFte).toBeCloseTo(8.7234042553, 8);
    expect(byRole(current, "Assistant").requiredFte).toBeCloseTo(0.5910165485, 8);
    expect(current.requiredFte).toBeCloseTo(9.3144208038, 8);
  });

  it("computes required FTE per role in the target state, with automation removed", () => {
    const target = computeCapacity(block(loaded()), "target");
    expect(byRole(target, "Analyst").totalMinutes).toBe(290_000);
    expect(byRole(target, "Assistant").totalMinutes).toBe(198_000);
    // System is read as an automation target, so its work leaves human capacity entirely
    // rather than being staffed at some notional productivity.
    expect(byRole(target, "System").automated).toBe(true);
    expect(byRole(target, "System").totalMinutes).toBe(300_000);
    expect(target.requiredFte).toBeCloseTo(5.7683215130, 8);
    expect(target.automatedMinutes).toBe(300_000);
  });

  it("conserves minutes between the two states, losing only what was automated", () => {
    const comparison = compareCapacity(block(loaded()), "current", "target");
    // 788,000 -> 488,000. The gap is exactly the automated 300,000, which is the check
    // that catches a study quietly dropping work on the way to the target.
    expect(comparison.from.staffedMinutes).toBe(788_000);
    expect(comparison.to.staffedMinutes).toBe(488_000);
    expect(comparison.from.staffedMinutes - comparison.to.staffedMinutes).toBe(
      comparison.automatedMinutesGained,
    );
  });

  it("reports the surplus and deficit per role", () => {
    const comparison = compareCapacity(block(loaded()), "current", "target");
    expect(byRole(comparison, "Analyst").deltaFte).toBeCloseTo(-5.2955082742, 8);
    expect(byRole(comparison, "Assistant").deltaFte).toBeCloseTo(1.7494089835, 8);
    expect(comparison.netFteChange).toBeCloseTo(-3.5460992908, 8);
    // The gross movement, which the net hides: 5.3 out of one role and 1.7 into another
    // is a net of 3.5 and a transition touching seven people.
    expect(comparison.fteOut).toBeCloseTo(5.2955082742, 8);
    expect(comparison.fteIn).toBeCloseTo(1.7494089835, 8);
  });

  it("moves the answer when a role's own utilisation changes", () => {
    const c = caseReducer(loaded(), {
      type: "capacity/setRoleParam",
      role: "Analyst",
      patch: { utilisationPct: 0.6 },
    });
    // 738,000 / (1,880 x 0.6 x 60) = 10.9042. Per role, never blended: the Assistant's
    // requirement is unchanged.
    expect(byRole(computeCapacity(block(c), "current"), "Analyst").requiredFte).toBeCloseTo(
      10.9042553191,
      8,
    );
    expect(byRole(computeCapacity(block(c), "current"), "Assistant").requiredFte).toBeCloseTo(
      0.5910165485,
      8,
    );
  });

  it("picks current as the as-is column and target as the to-be", () => {
    const capacity = block(loaded());
    expect(capacity.baseColumn).toBe("current");
    expect(capacity.targetColumn).toBe("target");
  });
});

describe("reconciling the two files", () => {
  it("names a studied task type with no volume", () => {
    const c = loaded(STUDY, `Task Type,Volume\nNew,10000`);
    const capacity = block(c);
    const { withoutVolume, withoutTasks } = reconcileTaskTypes(capacity.rows, capacity.demand);
    // The consequential direction: those tasks contribute nothing, so the capacity figure
    // is complete-looking and too low. Neither file can detect this on its own.
    expect(withoutVolume).toEqual(["Renewal"]);
    expect(withoutTasks).toEqual([]);

    const current = computeCapacity(capacity, "current");
    expect(byRole(current, "Analyst").totalMinutes).toBe(600_000);
  });

  it("names a volume with no tasks measured against it", () => {
    const c = loaded(STUDY, `Task Type,Volume\nNew,10000\nRenewal,6000\nEndorsement,2000`);
    const capacity = block(c);
    expect(reconcileTaskTypes(capacity.rows, capacity.demand).withoutTasks).toEqual(["Endorsement"]);
  });

  it("matches task types across a difference in case and spacing", () => {
    const c = loaded(STUDY, `Task Type,Volume\n new ,10000\nRENEWAL,6000`);
    const capacity = block(c);
    expect(reconcileTaskTypes(capacity.rows, capacity.demand)).toEqual({
      withoutVolume: [],
      withoutTasks: [],
    });
  });
});
