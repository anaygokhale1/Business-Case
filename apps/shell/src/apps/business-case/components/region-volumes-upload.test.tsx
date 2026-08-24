/**
 * Uploading regional volumes through the real Workload & Demand step.
 *
 * The parsers and the planner have their own tests. What is unproven without this is the
 * wiring — that the button is where the user looks for it, that the match report reflects
 * the register they actually built, and that pressing import moves the numbers in the grid
 * behind it. A broken wiring here produces a page that reads correctly and does nothing.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BusinessCaseModule } from "./business-case-module";

const AS_OF = "2026-08-24";

/** Two regions, one of them split across two processes. */
const VOLUMES = `Region,Process,Volume,Average Handling Time (minutes)
North America,First notification,48000,10
North America,Reassessment,12000,30
Europe,First notification,31000,14`;

const csvFile = (name: string, content: string): File =>
  new File([content], name, { type: "text/csv" });

const mount = () => render(<BusinessCaseModule projectId="region-volumes-test" asOfDate={AS_OF} />);

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const rail = () => screen.getByRole("navigation", { name: /input batches/i });
const goToBatch = (name: RegExp) => fireEvent.click(within(rail()).getByRole("button", { name }));
const button = (name: RegExp) => screen.getByRole<HTMLButtonElement>("button", { name });

/** Build the register the import will match against, through the real Scope step. */
const addRegion = (name: string) => {
  goToBatch(/scope & regions/i);
  // By placeholder: the Add-a-region label is not bound to the input.
  fireEvent.change(screen.getByPlaceholderText("North America"), { target: { value: name } });
  fireEvent.click(button(/^add region$/i));
};

const openImporter = async (file: File) => {
  goToBatch(/workload & demand/i);
  fireEvent.click(button(/upload a volumes study/i));
  fireEvent.change(screen.getByLabelText(/upload a regional volumes study/i), {
    target: { files: [file] },
  });
  // readSheets is async; the staged panel lands on the microtask after the read.
  await waitFor(() => expect(screen.getByText(file.name)).toBeTruthy());
};

/**
 * The match report, addressed by its accessible name.
 *
 * Scoped rather than searched page-wide because the unit grid sits directly behind the
 * importer and carries a region select — so a bare getByText("Europe") would match an
 * option element as readily as the report row.
 */
const report = () => screen.getByRole("table", { name: /where each region lands/i });

const matchRow = (region: string): HTMLElement => {
  const row = within(report()).getByText(region).closest("tr");
  if (!row) throw new Error(`no match-report row for ${region}`);
  return row as HTMLElement;
};

describe("staging a regional volumes file", () => {
  it("proposes the mapping and reports where each region will land", async () => {
    mount();
    addRegion("North America");
    addRegion("Europe");
    await openImporter(csvFile("volumes.csv", VOLUMES));

    // Both regions matched the rows the Scope step created, so both say "updates".
    expect(within(matchRow("North America")).getByText(/updates/i)).toBeTruthy();
    expect(within(matchRow("Europe")).getByText(/updates/i)).toBeTruthy();

    // North America's two rows are rolled up; Europe's single row is not.
    expect(within(matchRow("North America")).getByText("60,000")).toBeTruthy();
    expect(within(matchRow("Europe")).getByText("31,000")).toBeTruthy();
    // Two rows behind that 60,000, so the roll-up is visible rather than implied.
    expect(within(matchRow("North America")).getByText("2")).toBeTruthy();

    expect(button(/import 2 regions/i)).toBeTruthy();
  });

  it("weights the handle time by volume rather than averaging the rows", async () => {
    mount();
    addRegion("North America");
    await openImporter(csvFile("volumes.csv", VOLUMES));

    // (48,000x10 + 12,000x30) / 60,000 = 14.0. The mean of 10 and 30 is 20, which would
    // overstate this region's required capacity by 43%.
    expect(within(matchRow("North America")).getByText("14.0")).toBeTruthy();
  });

  it("annualises when the file covers part of a year", async () => {
    mount();
    addRegion("Europe");
    await openImporter(csvFile("volumes.csv", VOLUMES));

    fireEvent.change(screen.getByLabelText(/each volume covers/i), { target: { value: "quarter" } });

    // Both figures stay on screen: what the file said, and what the case will hold.
    const row = matchRow("Europe");
    expect(within(row).getByText("31,000")).toBeTruthy();
    expect(within(row).getByText("124,000")).toBeTruthy();
  });

  it("names a region the case has never heard of as a new row", async () => {
    mount();
    addRegion("North America");
    await openImporter(csvFile("volumes.csv", VOLUMES));

    expect(within(matchRow("Europe")).getByText(/new region/i)).toBeTruthy();
    // The file covers every row the case has, so there is nothing to report as missed.
    expect(screen.queryByText(/not set to zero/i)).toBeNull();
  });

  it("says which rows the file does not cover, rather than zeroing them", async () => {
    mount();
    addRegion("North America");
    addRegion("Europe");
    addRegion("Asia Pacific");
    await openImporter(csvFile("volumes.csv", VOLUMES));

    const note = screen.getByText(/not set to zero/i);
    expect(note.textContent).toMatch(/Not in this file/);
    expect(note.textContent).toMatch(/Asia Pacific/);
  });
});

describe("importing", () => {
  it("writes the annual volume and the weighted handle time into the grid", async () => {
    mount();
    addRegion("North America");
    await openImporter(csvFile("volumes.csv", VOLUMES));
    fireEvent.click(button(/import 2 regions/i));

    // The grid behind the importer now holds what the report promised.
    expect(screen.getByLabelText<HTMLInputElement>(/annual volume for North America/i).value).toBe(
      "60000",
    );
    expect(screen.getByLabelText<HTMLInputElement>(/handle time for North America/i).value).toBe(
      "14",
    );

    // Europe arrived as a new row, created by the import rather than by the Scope step.
    expect(screen.getByLabelText(/annual volume for Europe/i)).toBeTruthy();
  });

  it("reports the portfolio total once volume is in", async () => {
    mount();
    addRegion("North America");
    await openImporter(csvFile("volumes.csv", VOLUMES));
    fireEvent.click(button(/import 2 regions/i));

    expect(screen.getByText(/91,000/)).toBeTruthy();
  });

  it("leaves handle time inheriting when the box is unticked", async () => {
    mount();
    addRegion("North America");
    await openImporter(csvFile("volumes.csv", VOLUMES));
    fireEvent.click(screen.getByRole("checkbox", { name: /handle times as each row/i }));
    fireEvent.click(button(/import 2 regions/i));

    expect(screen.getByLabelText<HTMLInputElement>(/annual volume for North America/i).value).toBe(
      "60000",
    );
    // Empty, not 14 — the row is inheriting again, and the input shows the global as a
    // placeholder rather than adopting it as an own value.
    expect(screen.getByLabelText<HTMLInputElement>(/handle time for North America/i).value).toBe("");
  });

  it("re-importing the same file does not double the volume", async () => {
    mount();
    addRegion("North America");
    await openImporter(csvFile("volumes.csv", VOLUMES));
    fireEvent.click(button(/import 2 regions/i));
    await openImporter(csvFile("volumes.csv", VOLUMES));
    fireEvent.click(button(/import 2 regions/i));

    expect(screen.getByLabelText<HTMLInputElement>(/annual volume for North America/i).value).toBe(
      "60000",
    );
  });
});

describe("a file that names teams", () => {
  it("adopts the region's own row rather than leaving it empty beside a new one", async () => {
    mount();
    addRegion("Europe");
    await openImporter(
      csvFile("volumes.csv", `Region,Team,Volume
Europe,Claims Intake,31000`),
    );

    // Announced before it happens: the row being written to is the region's placeholder,
    // and it will carry the team's name afterwards.
    expect(within(matchRow("Europe")).getByText(/renamed Claims Intake/i)).toBeTruthy();
    fireEvent.click(button(/import 1 region/i));

    expect(screen.getByLabelText<HTMLInputElement>(/annual volume for Claims Intake/i).value).toBe(
      "31000",
    );
    // One row, not two. A second would sit at no volume and be reported as uncovered.
    expect(screen.queryByLabelText(/annual volume for Europe/i)).toBeNull();
  });
});

describe("a region the case has split in two", () => {
  /** One region, two rows, and a file that names neither of them. */
  const split = () => {
    addRegion("North America");
    goToBatch(/units & headcount/i);
    fireEvent.click(button(/^\+ North America$/));
  };

  it("refuses to divide it and says what would fix the file", async () => {
    mount();
    split();
    await openImporter(
      csvFile("volumes.csv", `Region,Process,Volume\nNorth America,First notification,60000`),
    );

    expect(within(matchRow("North America")).getByText(/needs a decision/i)).toBeTruthy();
    expect(screen.getByText(/does not say which/i)).toBeTruthy();
    // Nothing applicable, so there is nothing to press.
    expect(button(/import 0 regions/i).disabled).toBe(true);
  });

  it("resolves once the file names the team", async () => {
    mount();
    split();
    // Name the row the import will target. Ids are deterministic, so the second row of
    // the region is addressable without depending on render order.
    fireEvent.change(screen.getByLabelText(/name for north-america-unit/i), {
      target: { value: "Adjusting" },
    });

    await openImporter(csvFile("volumes.csv", `Region,Team,Volume\nNorth America,Adjusting,4000`));

    expect(within(matchRow("North America")).getByText(/updates/i)).toBeTruthy();
    fireEvent.click(button(/import 1 region/i));

    expect(screen.getByLabelText<HTMLInputElement>(/annual volume for Adjusting/i).value).toBe(
      "4000",
    );
    // And the other row is untouched — the import wrote one figure, not a split.
    expect(
      screen.getByLabelText<HTMLInputElement>(/annual volume for North America$/i).value,
    ).toBe("");
  });
});
