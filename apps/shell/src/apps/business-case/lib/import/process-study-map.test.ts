/**
 * Reading a process study out of a sheet.
 *
 * Two header shapes are exercised: the template this repo ships, and the shape a real
 * client study arrives in — grouped banner row above the header, text flags that repeat
 * the column name, two AHT columns, and role columns with prose in their titles.
 */

import { describe, expect, it } from "vitest";

import { computeCapacity } from "../engine/capacity";
import { effectiveMinutes } from "../engine/process-study";
import { parseCsv, type Sheet } from "./tabular";
import {
  convertStudyRows,
  detectStudyHeaderRow,
  flagApplies,
  importStudySheet,
  proposeStudyMapping,
  roleColumnKey,
} from "./process-study-map";

const sheet = (csv: string): Sheet => ({ name: "Study", rows: parseCsv(csv) });

/** The shape this repo's template ships. */
const TEMPLATE = `Step ID,Level 1,Level 2,Level 5 (Process),LOB,Region,Applies: New,Applies: Renewal,Applies: Bound,Applies: Lost,Current Role,Proposed Role,Target Role,AHT (minutes),Frequency (occurrences per transaction),Rework AHT (minutes),Rework Frequency (share of occurrences),Stated AHT (minutes)
S-001,1 Intake,1.1 Receive,Log submission,Alpha,Testland,Y,Y,Y,Y,Reviewer,Processor,Processor,10,1,,,
S-002,2 Assess,2.1 Price,Produce price,Alpha,Testland,Y,N,Y,N,Reviewer,Automation,Automation,30,1,,,
S-003,3 Issue,3.1 Produce,Issue documents,Alpha,Testland,Y,Y,Y,N,Processor,Processor,Processor,4,1,8,0.25,`;

/**
 * The shape a real study arrives in. Note what differs from the template:
 * a banner row above the header, flags whose value repeats the column name, "Level4"
 * with no space, both "AHT Original" and "AHT", and comparison columns that must NOT be
 * read as role assignments.
 */
const CLIENT_SHAPE = `Business Type,,,Business Final Status,,,,,,,,,,,,All AHTs are in minutes per task,,,
Level 1 (Business Process),Level 2 (Business Process),Level4,L5 (Process),New,Renewal,Endorsement,Bound,Lost,Declined,Target Role,Current Role,Proposed Role (Post Madrid Meeting),Target Role/Proposed Role Match,LOB,Region,AHT Original,Frequency,AHT
1 Client Strategy,1.1 Planning,1.1.1.1 Provide input,Provide input to underwriting,New,Renewal,,Bound,,,UA,UW,UA,No Match,Property,DACH,1,1,1
2 Renewal,2.5 Review,2.5.1.1 Clear blocks,Clear blocks,New,,,Bound,Lost,Declined,UW,UW,UW,Match,Property,DACH,6.9,0.37,2.553
3 Underwriting,3.2 Assess,3.2.2.1 Review FAC,Review FAC RI,New,Renewal,,Bound,,,UA,UW,UA,No Match,Property,DACH,2.5,0.372,0.93`;

describe("role column keys", () => {
  it("derives a scenario key from the header text", () => {
    expect(roleColumnKey("Current Role")).toBe("current");
    expect(roleColumnKey("Target Role")).toBe("target");
    // Parenthesised prose is stripped, so a long client header still yields a clean key.
    expect(roleColumnKey("Proposed Role (Post Madrid Meeting)")).toBe("proposed");
    expect(roleColumnKey("Madrid outcome role")).toBe("madridoutcome");
  });
});

describe("applicability flags", () => {
  it("treats a blank as not applicable and anything else as applicable", () => {
    // Handles both conventions: explicit Y/N, and a value that repeats the column name.
    expect(flagApplies("Y")).toBe(true);
    expect(flagApplies("New")).toBe(true);
    expect(flagApplies("X")).toBe(true);
    expect(flagApplies("1")).toBe(true);
    expect(flagApplies("")).toBe(false);
    expect(flagApplies("   ")).toBe(false);
    expect(flagApplies("N")).toBe(false);
    expect(flagApplies("No")).toBe(false);
    expect(flagApplies("0")).toBe(false);
  });
});

describe("the shipped template", () => {
  const result = () => importStudySheet(sheet(TEMPLATE));

  it("maps every group", () => {
    const { mapping } = result();
    expect(mapping.stepId).toBe(0);
    expect(mapping.pathLevels).toEqual([1, 2, 3]);
    expect(mapping.lob).toBe(4);
    expect(mapping.region).toBe(5);
    expect(Object.keys(mapping.transactionTypes)).toEqual(["New", "Renewal"]);
    expect(Object.keys(mapping.statuses)).toEqual(["Bound", "Lost"]);
    expect(mapping.roles).toEqual({ current: 10, proposed: 11, target: 12 });
    expect(mapping.ahtMinutes).toBe(13);
    expect(mapping.frequency).toBe(14);
    expect(mapping.reworkMinutes).toBe(15);
    expect(mapping.reworkFrequency).toBe(16);
    expect(mapping.statedMinutes).toBe(17);
  });

  it("imports without a single issue", () => {
    // The template is the contract. If it cannot import cleanly it is the wrong thing to
    // be sending a client.
    const { rows, issues, considered } = result();
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(considered).toBe(3);
  });

  it("carries the taxonomy, applicability and roles onto each row", () => {
    const row = result().rows[1]!;
    expect(row.id).toBe("S-002");
    expect(row.path).toEqual(["2 Assess", "2.1 Price", "Produce price"]);
    expect(row.transactionTypes).toEqual(["New"]);
    expect(row.statuses).toEqual(["Bound"]);
    expect(row.roles).toEqual({ current: "Reviewer", proposed: "Automation", target: "Automation" });
  });

  it("reads rework and leaves it absent where the sheet is blank", () => {
    const rows = result().rows;
    expect(rows[2]).toMatchObject({ reworkMinutes: 8, reworkFrequency: 0.25 });
    // 1 x (4 + 0.25 x 8) = 6.
    expect(effectiveMinutes(rows[2]!)).toBe(6);
    expect("reworkMinutes" in rows[0]!).toBe(false);
  });

  it("does not turn a blank stated column into a stated zero", () => {
    // A stated zero takes the step out of the model entirely, so it must only ever come
    // from a figure the sheet actually carries.
    for (const row of result().rows) expect("statedMinutes" in row).toBe(false);
    expect(effectiveMinutes(result().rows[0]!)).toBe(10);
  });

  it("reports what it found, for populating the form", () => {
    const { discovered } = result();
    expect(discovered.lobs).toEqual(["Alpha"]);
    expect(discovered.regions).toEqual(["Testland"]);
    expect(discovered.roleColumns).toEqual(["current", "proposed", "target"]);
    expect(discovered.roles.sort()).toEqual(["Automation", "Processor", "Reviewer"]);
  });
});

describe("a real study's shape", () => {
  const result = () => importStudySheet(sheet(CLIENT_SHAPE));

  it("finds the header under a grouped banner row", () => {
    expect(detectStudyHeaderRow(parseCsv(CLIENT_SHAPE))).toBe(1);
  });

  it("orders taxonomy levels by their number, not their position", () => {
    // "Level4" has no space and sits before "L5 (Process)".
    const { mapping } = result();
    expect(mapping.pathLevels).toEqual([0, 1, 2, 3]);
  });

  it("reads flags whose value repeats the column name", () => {
    const rows = result().rows;
    expect(rows[0]!.transactionTypes).toEqual(["New", "Renewal"]);
    expect(rows[0]!.statuses).toEqual(["Bound"]);
    expect(rows[1]!.statuses).toEqual(["Bound", "Lost", "Declined"]);
  });

  it("treats AHT Original as the input and AHT as the stated figure", () => {
    // Getting this backwards would push an already-frequency-weighted number through the
    // frequency multiplication a second time — 6.9 x 0.37 x 0.37 rather than 6.9 x 0.37.
    const { mapping } = result();
    expect(mapping.ahtMinutes).toBe(16);
    expect(mapping.statedMinutes).toBe(18);

    const row = result().rows[1]!;
    expect(row.ahtMinutes).toBe(6.9);
    expect(row.frequency).toBe(0.37);
    expect(row.statedMinutes).toBe(2.553);
    // 6.9 x 0.37 = 2.553, so stated and computed agree here.
    expect(effectiveMinutes(row)).toBeCloseTo(2.553, 9);
  });

  it("does not read a comparison column as a role assignment", () => {
    // "Target Role/Proposed Role Match" holds "Match" / "No Match". Read as a scenario it
    // would produce a to-be state staffed by a role called "No Match".
    const { mapping } = result();
    expect(Object.keys(mapping.roles).sort()).toEqual(["current", "proposed", "target"]);
    for (const row of result().rows) {
      expect(Object.values(row.roles)).not.toContain("Match");
      expect(Object.values(row.roles)).not.toContain("No Match");
    }
  });

  it("discovers the roles and the scenario columns", () => {
    const { discovered } = result();
    expect(discovered.roles.sort()).toEqual(["UA", "UW"]);
    expect(discovered.lobs).toEqual(["Property"]);
    expect(discovered.regions).toEqual(["DACH"]);
  });

  it("feeds straight into the capacity engine", () => {
    const { rows, discovered } = result();
    const study = {
      rows,
      demand: [{ lob: "Property", transactionType: "New", submissions: 1_000 }],
      statusShares: { New: { Bound: 1 } },
      roles: discovered.roles.map((role) => ({
        role,
        workingHoursPerYear: 1_800,
        utilisationPct: 0.8,
      })),
      roleColumns: discovered.roleColumns,
    };
    // Current owner is UW on all three rows. Per bound new transaction:
    //   1 x 1 = 1.000  +  6.9 x 0.37 = 2.553  +  2.5 x 0.372 = 0.930  =  4.483
    const result2 = computeCapacity(study, "current");
    const uw = result2.roles.find((r) => r.role === "UW")!;
    expect(uw.totalMinutes).toBeCloseTo(4_483, 6);
  });
});

describe("rows that cannot be used", () => {
  it("skips a row with no handle time at all", () => {
    const { rows, issues } = importStudySheet(
      sheet(`Level 1,Current Role,AHT,Frequency\nIntake,Reviewer,10,1\nSubtotal,,,`),
    );
    expect(rows).toHaveLength(1);
    expect(issues.filter((i) => i.dropped)).toHaveLength(1);
  });

  it("skips a row whose frequency is not a number, naming the process", () => {
    const { issues } = importStudySheet(
      sheet(`Level 1,Current Role,AHT,Frequency\nClear blocks,Reviewer,10,often`),
    );
    expect(issues[0]!.dropped).toBe(true);
    expect(issues[0]!.message).toContain("Clear blocks");
    expect(issues[0]!.message).toContain('"often"');
  });

  it("assumes one occurrence when the study has no frequency column", () => {
    // A study with no frequency column is one where every step happens once, not one
    // where nothing is known about how often steps happen.
    const { rows, issues } = importStudySheet(sheet(`Level 1,Current Role,AHT\nIntake,Reviewer,10`));
    expect(issues).toEqual([]);
    expect(rows[0]!.frequency).toBe(1);
    expect(effectiveMinutes(rows[0]!)).toBe(10);
  });

  it("keeps a repeated step id distinguishable rather than overwriting", () => {
    const { rows, issues } = importStudySheet(
      sheet(`Step ID,Level 1,Current Role,AHT,Frequency\nS-1,A,Reviewer,10,1\nS-1,B,Reviewer,20,1`),
    );
    expect(rows.map((r) => r.id)).toEqual(["S-1", "S-1#3"]);
    expect(issues.some((i) => i.message.includes("repeated"))).toBe(true);
  });

  it("falls back to the sheet row when there is no id column", () => {
    const { rows } = importStudySheet(sheet(`Level 1,Current Role,AHT\nIntake,Reviewer,10`));
    // Stable for this import but not across a re-upload, which is why the template asks
    // for a Step ID.
    expect(rows[0]!.id).toBe("row-2");
  });

  it("defaults a missing LOB or region rather than dropping the row", () => {
    const { rows } = importStudySheet(sheet(`Level 1,Current Role,AHT\nIntake,Reviewer,10`));
    expect(rows[0]).toMatchObject({ lob: "All", region: "All" });
  });
});

describe("correcting the mapping by hand", () => {
  it("respects an override the user makes", () => {
    const s = sheet(TEMPLATE);
    const mapping = proposeStudyMapping(s.rows[0]!);
    // The user decides the Target column is the one to treat as current.
    const corrected = { ...mapping, roles: { current: mapping.roles["target"]! } };
    const { rows } = convertStudyRows(s, 0, corrected);
    expect(rows[0]!.roles).toEqual({ current: "Processor" });
  });
});
