/**
 * Volume upload: counts in, shares derived.
 *
 * The point of asking for counts rather than percentages is that the shares then cannot
 * fail to sum to 1, and the counts can be reconciled against the stated total. Both
 * properties are asserted here.
 */

import { describe, expect, it } from "vitest";

import { computeCapacity } from "../engine/capacity";
import { baseStudy } from "../engine/__fixtures__/process-study";
import { parseCsv, type Sheet } from "./tabular";
import {
  convertVolumeRows,
  detectVolumeHeaderRow,
  importVolumeSheet,
  proposeVolumeMapping,
} from "./volumes";

const sheet = (csv: string): Sheet => ({ name: "Volumes", rows: parseCsv(csv) });

const TEMPLATE = `LOB,Transaction Type,Period Start,Period End,Transactions Received,Bound,Lost,Declined
Alpha,New,2025-01-01,2025-12-31,12400,7440,2976,1984
Alpha,Renewal,2025-01-01,2025-12-31,9800,8330,980,490
Beta,New,2025-01-01,2025-12-31,4100,2050,1230,820`;

describe("mapping", () => {
  it("maps the dimensions and discovers the outcome columns", () => {
    const mapping = proposeVolumeMapping([
      "LOB",
      "Transaction Type",
      "Period Start",
      "Period End",
      "Transactions Received",
      "Bound",
      "Lost",
      "Declined",
    ]);
    expect(mapping.lob).toBe(0);
    expect(mapping.transactionType).toBe(1);
    expect(mapping.received).toBe(4);
    // Discovered from the header text, not from a fixed list — so a client's own
    // vocabulary survives instead of being silently dropped.
    expect(mapping.outcomes).toEqual({ Bound: 5, Lost: 6, Declined: 7 });
  });

  it("picks up outcome names we did not anticipate", () => {
    const mapping = proposeVolumeMapping(["Line", "Type", "Quoted", "Written", "Not Taken Up"]);
    expect(Object.keys(mapping.outcomes).sort()).toEqual(["Not Taken Up", "Written"]);
  });

  it("does not let an outcome column claim the received total", () => {
    const mapping = proposeVolumeMapping(["LOB", "Type", "Submissions", "Bound"]);
    expect(mapping.received).toBe(2);
    expect(mapping.outcomes).toEqual({ Bound: 3 });
  });

  it("finds the header under a title block", () => {
    const rows = [
      ["Volumes extract", "", "", ""],
      ["", "", "", ""],
      ["LOB", "Transaction Type", "Transactions Received", "Bound"],
      ["Alpha", "New", "100", "60"],
    ];
    expect(detectVolumeHeaderRow(rows)).toBe(2);
  });
});

describe("deriving shares from counts", () => {
  const result = () => importVolumeSheet(sheet(TEMPLATE));

  it("produces one demand cell per line and transaction type", () => {
    const { demand } = result();
    expect(demand).toHaveLength(3);
    expect(demand[0]).toMatchObject({ lob: "Alpha", transactionType: "New", submissions: 12_400 });
  });

  it("derives shares that sum to exactly 1", () => {
    // The reason to ask for counts: this cannot fail. There is no "must total 100%"
    // problem to police on an upload, only on a figure typed into the form.
    for (const cell of result().demand) {
      const total = Object.values(cell.outcomeShares!).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it("keeps each line's own outcome mix", () => {
    // Alpha New binds 7,440/12,400 = 60%. Beta New binds 2,050/4,100 = 50%. One shared
    // split would move required capacity the wrong way for both.
    const { demand } = result();
    expect(demand[0]!.outcomeShares!["Bound"]).toBeCloseTo(0.6, 12);
    expect(demand[2]!.outcomeShares!["Bound"]).toBeCloseTo(0.5, 12);
  });

  it("reports the derived rates so they can be sanity-checked", () => {
    const rates = result().bindRates.filter((r) => r.outcome === "Bound");
    expect(rates.map((r) => `${r.lob}/${r.transactionType}`)).toEqual([
      "Alpha/New",
      "Alpha/Renewal",
      "Beta/New",
    ]);
    // A bind rate is now an output, comparable across lines, rather than an assumption.
    expect(rates[1]!.share).toBeCloseTo(8330 / 9800, 12);
  });

  it("handles thousands separators and blank outcome cells", () => {
    const { demand } = importVolumeSheet(
      sheet(`LOB,Type,Transactions Received,Bound,Lost\nAlpha,New,"12,400",7440,`),
    );
    expect(demand[0]!.submissions).toBe(12_400);
    // Lost is blank, so it is absent rather than zero — 7,440 of 7,440 counted.
    expect(demand[0]!.outcomeShares).toEqual({ Bound: 1 });
  });
});

describe("G33 — outcome counts must reconcile to the total", () => {
  it("reports a gap between the outcome counts and the stated total", () => {
    // 7,440 + 2,976 + 1,000 = 11,416 against 12,400 received.
    const { issues } = importVolumeSheet(
      sheet(`LOB,Type,Transactions Received,Bound,Lost,Declined\nAlpha,New,12400,7440,2976,1000`),
    );
    const found = issues.find((i) => i.message.includes("outcomes total"))!;
    expect(found.dropped).toBe(false);
    expect(found.message).toContain("11,416");
    expect(found.message).toContain("12,400");
  });

  it("stays quiet within a rounding tolerance", () => {
    // One transaction out of 12,400 is rounding in the source, not a broken extract.
    const { issues } = importVolumeSheet(
      sheet(`LOB,Type,Transactions Received,Bound,Lost,Declined\nAlpha,New,12400,7440,2977,1984`),
    );
    expect(issues.filter((i) => i.message.includes("outcomes total"))).toEqual([]);
  });

  it("is the check a percentage-based upload cannot give you", () => {
    // Shares of 60/24/16 sum to 100% whether the underlying counts reconcile or not.
    // Counts make the discrepancy visible; percentages hide it completely.
    const broken = importVolumeSheet(
      sheet(`LOB,Type,Transactions Received,Bound,Lost,Declined\nAlpha,New,12400,7440,2976,1000`),
    );
    expect(broken.demand).toHaveLength(1);
    expect(broken.issues.some((i) => !i.dropped)).toBe(true);
  });

  it("uses the outcome counts as the basis when there is no stated total", () => {
    // The common shape when a system reports only completed transactions by outcome.
    const { demand } = importVolumeSheet(sheet(`LOB,Type,Bound,Lost\nAlpha,New,600,400`));
    expect(demand[0]!.submissions).toBe(1_000);
    expect(demand[0]!.outcomeShares).toEqual({ Bound: 0.6, Lost: 0.4 });
  });
});

describe("rows that cannot be used", () => {
  it("skips a row with no line of business or transaction type", () => {
    const { demand, issues } = importVolumeSheet(
      sheet(`LOB,Type,Transactions Received\nAlpha,New,100\n,,50\nTotal,,150`),
    );
    expect(demand).toHaveLength(1);
    // A total row has no transaction type, so it cannot be mistaken for demand.
    expect(issues.filter((i) => i.dropped)).toHaveLength(2);
  });

  it("skips a zero or negative count rather than importing an empty cell", () => {
    const { demand, issues } = importVolumeSheet(
      sheet(`LOB,Type,Transactions Received\nAlpha,New,0`),
    );
    expect(demand).toEqual([]);
    expect(issues[0]!.message).toContain("transaction count of 0");
  });

  it("flags a repeated line and type instead of silently merging them", () => {
    const { issues } = importVolumeSheet(
      sheet(`LOB,Type,Transactions Received,Bound\nAlpha,New,100,60\nAlpha,New,50,40`),
    );
    // Summing them would merge two different outcome mixes into one.
    expect(issues.some((i) => i.message.includes("appears more than once"))).toBe(true);
  });
});

describe("feeding the capacity engine", () => {
  it("an uploaded volume sheet drives required FTE directly", () => {
    const { demand } = importVolumeSheet(
      sheet(`LOB,Type,Transactions Received,Bound,Lost\nAlpha,New,10000,6000,4000`),
    );
    // Same 60/40 split as the engine fixture, arrived at from counts rather than typed.
    const result = computeCapacity(baseStudy({ demand, statusShares: {} }), "current");
    const reviewer = result.roles.find((r) => r.role === "Reviewer")!;
    // 10 + 10 + 0.6 x 30 = 38 min x 10,000 = 380,000, matching the hand-computed figure.
    expect(reviewer.totalMinutes).toBe(380_000);
  });

  it("carries a per-line split the type-level default would have flattened", () => {
    const { demand } = importVolumeSheet(
      sheet(
        `LOB,Type,Transactions Received,Bound,Lost\nAlpha,New,10000,6000,4000\nBeta,New,10000,10000,0`,
      ),
    );
    // Alpha 60% bound, Beta 100%. The engine must read each cell's own share.
    const rows = baseStudy().rows.map((r) => ({ ...r }));
    const study = baseStudy({
      rows: [...rows, ...rows.map((r) => ({ ...r, id: `${r.id}-beta`, lob: "Beta" }))],
      demand,
      statusShares: {},
    });
    const reviewer = computeCapacity(study, "current").roles.find((r) => r.role === "Reviewer")!;
    // Alpha 380,000 + Beta (10 + 10 + 1.0 x 30) x 10,000 = 500,000 -> 880,000.
    expect(reviewer.totalMinutes).toBe(880_000);
  });
});

describe("the shipped template", () => {
  it("imports cleanly with no issues at all", () => {
    const result = convertVolumeRows(
      sheet(TEMPLATE),
      0,
      proposeVolumeMapping(parseCsv(TEMPLATE)[0]!),
    );
    // The template is the contract. If it cannot import without complaint, it is the
    // wrong thing to be sending a client.
    expect(result.issues).toEqual([]);
    expect(result.demand).toHaveLength(3);
    expect(result.considered).toBe(3);
  });
});
