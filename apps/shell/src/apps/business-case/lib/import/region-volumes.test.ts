/**
 * Regional volumes upload.
 *
 * Four properties are what this feature is for, and each is asserted against a fixture
 * built so the wrong answer is a different number rather than a rounding difference:
 *
 *  - The stated period scales to a year, and the two totals stay distinguishable.
 *  - Rows roll up into their region without losing the constituents.
 *  - Handle time is volume-weighted, which is not the plain mean.
 *  - A region the case has split into several rows is reported, never divided.
 */

import { describe, expect, it } from "vitest";

import { makeCase } from "../engine/__fixtures__/cases";
import { SENTINEL } from "../engine/types";
import { parseCsv, type Sheet } from "./tabular";
import {
  applicableEntries,
  convertRegionVolumeRows,
  detectRegionVolumeHeaderRow,
  planRegionVolumes,
  proposeRegionVolumeMapping,
  type RegionVolumeMapping,
} from "./region-volumes";

const sheet = (csv: string): Sheet => ({ name: "Volumes", rows: parseCsv(csv) });

const TEMPLATE = `Region,Team,Process,Annual Volume,Average Handling Time (minutes)
North America,Claims Intake,First notification,48000,12.5
North America,Claims Intake,Reassessment,12000,26
Europe,Claims Intake,First notification,31000,14
Asia Pacific,,First notification,9600,11`;

/** Read the file's own header, so a mapping change breaks the test rather than passing. */
const mappingFor = (csv: string): RegionVolumeMapping => {
  const rows = parseCsv(csv);
  return proposeRegionVolumeMapping(rows[detectRegionVolumeHeaderRow(rows)] ?? []);
};

const annual = { defaultRegion: null, periodsPerYear: 1 };

describe("mapping", () => {
  it("maps the region, team, label, volume and handle-time columns", () => {
    const mapping = mappingFor(TEMPLATE);
    expect(mapping.region).toBe(0);
    expect(mapping.unitName).toBe(1);
    expect(mapping.label).toBe(2);
    expect(mapping.volume).toBe(3);
    expect(mapping.handleTimeMinutes).toBe(4);
  });

  it("reads a parenthesised qualifier as the same column", () => {
    const mapping = proposeRegionVolumeMapping(["Country", "Volume (FY25 actual)", "AHT (mins)"]);
    expect(mapping.region).toBe(0);
    expect(mapping.volume).toBe(1);
    expect(mapping.handleTimeMinutes).toBe(2);
  });

  it("does not claim a column for a field the file does not have", () => {
    const mapping = proposeRegionVolumeMapping(["Region", "Cases"]);
    expect(mapping.volume).toBe(1);
    // Nothing here is a handle time, and inventing one would silently override the
    // global figure for every row in the file.
    expect(mapping.handleTimeMinutes).toBeNull();
    expect(mapping.unitName).toBeNull();
  });

  it("finds the header row under a title block", () => {
    const rows = parseCsv(
      `Regional volume extract,,,\nGenerated 2026-03-01,,,\n,,,\nRegion,Process,Annual Volume,AHT\nEurope,Intake,31000,14`,
    );
    expect(detectRegionVolumeHeaderRow(rows)).toBe(3);
  });
});

describe("annualising the period", () => {
  it("leaves an annual file alone", () => {
    const result = convertRegionVolumeRows(sheet(TEMPLATE), 0, mappingFor(TEMPLATE), annual);
    const na = result.targets[0]!;
    expect(na.periodVolume).toBe(60_000);
    expect(na.annualVolume).toBe(60_000);
  });

  it("scales a quarterly file by four and keeps both totals", () => {
    const result = convertRegionVolumeRows(sheet(TEMPLATE), 0, mappingFor(TEMPLATE), {
      defaultRegion: null,
      periodsPerYear: 4,
    });
    const na = result.targets[0]!;
    // The distinction the file itself cannot make. 60,000 a quarter is 240,000 a year,
    // and reading the first as the second understates the case fourfold.
    expect(na.periodVolume).toBe(60_000);
    expect(na.annualVolume).toBe(240_000);
    expect(result.periodsPerYear).toBe(4);
  });

  it("scales a monthly file by twelve", () => {
    const result = convertRegionVolumeRows(sheet(TEMPLATE), 0, mappingFor(TEMPLATE), {
      defaultRegion: null,
      periodsPerYear: 12,
    });
    expect(result.targets[1]!.annualVolume).toBe(31_000 * 12);
  });
});

describe("rolling rows up into a region", () => {
  it("sums the rows and keeps them", () => {
    const result = convertRegionVolumeRows(sheet(TEMPLATE), 0, mappingFor(TEMPLATE), annual);
    expect(result.targets).toHaveLength(3);

    const na = result.targets[0]!;
    expect(na.region).toBe("North America");
    expect(na.unitName).toBe("Claims Intake");
    expect(na.periodVolume).toBe(48_000 + 12_000);
    // Kept, so the roll-up can be inspected rather than taken on trust.
    expect(na.rows.map((r) => r.label)).toEqual(["First notification", "Reassessment"]);
    expect(na.rows.map((r) => r.sheetRow)).toEqual([2, 3]);
  });

  it("keeps two teams in the same region apart", () => {
    const csv = `Region,Team,Annual Volume
Europe,Intake,20000
Europe,Adjusting,5000`;
    const result = convertRegionVolumeRows(sheet(csv), 0, mappingFor(csv), annual);
    expect(result.targets).toHaveLength(2);
    expect(result.targets.map((t) => t.unitName)).toEqual(["Intake", "Adjusting"]);
  });

  it("treats a region named with different spacing or case as one region", () => {
    const csv = `Region,Process,Annual Volume
Europe,Intake,20000
 europe ,Adjusting,5000`;
    const result = convertRegionVolumeRows(sheet(csv), 0, mappingFor(csv), annual);
    expect(result.targets).toHaveLength(1);
    // The first spelling wins as the label; the trailing-space variant is the exact
    // defect that split a role in two in the real study.
    expect(result.targets[0]!.region).toBe("Europe");
    expect(result.targets[0]!.periodVolume).toBe(25_000);
  });

  it("counts every row it considered, including the ones it dropped", () => {
    const csv = `Region,Process,Annual Volume
Europe,Intake,20000
Europe,Broken,not a number`;
    const result = convertRegionVolumeRows(sheet(csv), 0, mappingFor(csv), annual);
    expect(result.considered).toBe(2);
    expect(result.targets).toHaveLength(1);
    expect(result.issues.filter((i) => i.dropped)).toHaveLength(1);
  });
});

describe("handle time", () => {
  it("weights by volume rather than averaging the rows", () => {
    const csv = `Region,Process,Annual Volume,AHT
Testland,Quick,1000,5
Testland,Slow,9000,15`;
    const result = convertRegionVolumeRows(sheet(csv), 0, mappingFor(csv), annual);
    const target = result.targets[0]!;

    // (1000x5 + 9000x15) / 10000 = 14.0. The plain mean of the two rows is 10.0 — a 29%
    // understatement of required capacity, because the slow work is also the common work.
    expect(target.handleTimeMinutes).toBeCloseTo(14, 10);
    expect(target.handleTimeCoverage).toBe(1);
  });

  it("weights over the rows that stated a time and reports the coverage", () => {
    const csv = `Region,Process,Annual Volume,AHT
Testland,Timed,1000,5
Testland,Untimed,3000,`;
    const result = convertRegionVolumeRows(sheet(csv), 0, mappingFor(csv), annual);
    const target = result.targets[0]!;

    // 5, not 1.25. A blank time is not a zero-minute task, so it stays out of the
    // denominator — otherwise three untimed rows would quarter the region's handle time.
    expect(target.handleTimeMinutes).toBe(5);
    expect(target.handleTimeCoverage).toBe(0.25);
    expect(result.issues.some((i) => /only 25% of the volume states a handle time/.test(i.message))).toBe(
      true,
    );
  });

  it("is null when the file carries no times at all", () => {
    const csv = `Region,Process,Annual Volume
Testland,Intake,1000`;
    const result = convertRegionVolumeRows(sheet(csv), 0, mappingFor(csv), annual);
    expect(result.targets[0]!.handleTimeMinutes).toBeNull();
    // No spurious coverage warning when there was nothing to cover.
    expect(result.issues).toHaveLength(0);
  });

  it("reads a decimal comma in the time column and thousands in the volume column", () => {
    const csv = `Region,Process,Annual Volume,AHT
Testland,Intake,"12,400","1,5"`;
    const result = convertRegionVolumeRows(sheet(csv), 0, mappingFor(csv), annual);
    expect(result.targets[0]!.periodVolume).toBe(12_400);
    // The same text, read two ways, because the column says which is plausible.
    expect(result.targets[0]!.handleTimeMinutes).toBe(1.5);
  });
});

describe("rows it refuses", () => {
  it("drops a negative volume rather than netting it off", () => {
    const csv = `Region,Process,Annual Volume
Testland,Intake,20000
Testland,Reversal,(500)`;
    const result = convertRegionVolumeRows(sheet(csv), 0, mappingFor(csv), annual);
    expect(result.targets[0]!.periodVolume).toBe(20_000);
    expect(result.issues.some((i) => i.dropped && /negative volume/.test(i.message))).toBe(true);
  });

  it("applies the chosen region to rows that leave it blank", () => {
    const csv = `Region,Process,Annual Volume
,Intake,20000`;
    const result = convertRegionVolumeRows(sheet(csv), 0, mappingFor(csv), {
      defaultRegion: "Europe",
      periodsPerYear: 1,
    });
    expect(result.targets[0]!.region).toBe("Europe");
  });

  it("drops a row with no region when none was chosen", () => {
    const csv = `Region,Process,Annual Volume
,Intake,20000`;
    const result = convertRegionVolumeRows(sheet(csv), 0, mappingFor(csv), annual);
    expect(result.targets).toHaveLength(0);
    expect(result.issues[0]!.dropped).toBe(true);
  });

  it("flags identical rows and still adds them, naming the first", () => {
    const csv = `Region,Process,Annual Volume
Testland,Intake,20000
Testland,Intake,20000`;
    const result = convertRegionVolumeRows(sheet(csv), 0, mappingFor(csv), annual);
    // Both are kept — volume is additive and a genuine repeat is common — but the user
    // is told, because a double-counted extract is the other explanation and it inflates
    // the case by exactly the amount nobody would question.
    expect(result.targets[0]!.periodVolume).toBe(40_000);
    const flagged = result.issues.find((i) => /identical to row 2/.test(i.message));
    expect(flagged).toBeTruthy();
    expect(flagged!.dropped).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

const register = () =>
  makeCase([
    {
      id: "eu",
      name: "Europe",
      region: "Europe",
      volume: 25_000,
      headcount: { processor: 10 },
      cost: { processor: 70_000 },
    },
    {
      id: "na-intake",
      name: "Claims Intake",
      region: "North America",
      volume: SENTINEL,
      headcount: { processor: 12 },
      cost: { processor: 90_000 },
    },
    {
      id: "na-adjust",
      name: "Adjusting",
      region: "North America",
      volume: SENTINEL,
      headcount: { processor: 8 },
      cost: { processor: 95_000 },
    },
  ]);

const planFor = (csv: string) =>
  planRegionVolumes(
    register(),
    convertRegionVolumeRows(sheet(csv), 0, mappingFor(csv), annual),
  );

describe("matching against the register", () => {
  it("updates the only row in a region and shows what it replaces", () => {
    const plan = planFor(`Region,Annual Volume\nEurope,31000`);
    const entry = plan.entries[0]!;
    expect(entry.match).toBe("update");
    expect(entry.unitId).toBe("eu");
    // The current figure travels with the entry so the change is reviewable before it
    // is applied, rather than discovered afterwards in the register.
    expect(entry.currentVolume).toBe(25_000);
  });

  it("matches a named team inside a region that has several", () => {
    const plan = planFor(`Region,Team,Annual Volume\nNorth America,Adjusting,4000`);
    const entry = plan.entries[0]!;
    expect(entry.match).toBe("update");
    expect(entry.unitId).toBe("na-adjust");
    expect(entry.currentVolume).toBe(SENTINEL);
  });

  it("refuses to split a multi-row region the file does not break down", () => {
    const plan = planFor(`Region,Annual Volume\nNorth America,60000`);
    const entry = plan.entries[0]!;
    expect(entry.match).toBe("ambiguous");
    expect(entry.unitId).toBeNull();
    // Named, so the user knows what to add to the file or which row to pick.
    expect(entry.candidates).toEqual(["Claims Intake", "Adjusting"]);
    // And it writes nothing: an even split would balance and describe a fiction.
    expect(applicableEntries(plan)).toHaveLength(0);
  });

  it("plans a new region for one the case has never heard of", () => {
    const plan = planFor(`Region,Annual Volume\nAsia Pacific,9600`);
    expect(plan.entries[0]!.match).toBe("new-region");
    expect(plan.entries[0]!.unitId).toBeNull();
  });

  it("plans a new row for an unknown team inside a known region", () => {
    const plan = planFor(`Region,Team,Annual Volume\nNorth America,Recoveries,3000`);
    expect(plan.entries[0]!.match).toBe("new-unit");
  });

  it("names the rows the file says nothing about", () => {
    const plan = planFor(`Region,Annual Volume\nEurope,31000`);
    // Their volume is left alone rather than zeroed, so the user has to be told which
    // rows the file did not cover — silence here reads as "everything was updated".
    expect(plan.untouched.map((u) => u.id)).toEqual(["na-intake", "na-adjust"]);
  });

  it("matches a region whose spelling differs only in case and spacing", () => {
    const plan = planFor(`Region,Annual Volume\n europe ,31000`);
    expect(plan.entries[0]!.unitId).toBe("eu");
  });
});
