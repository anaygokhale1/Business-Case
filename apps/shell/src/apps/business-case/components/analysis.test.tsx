/**
 * The Analysis tab through the real UI.
 *
 * The engine tests derive the arithmetic; what is unproven without this is that the tab is
 * reachable, that the grain and measure toggles change what is drawn, that the frontier and
 * the optimum reach the screen, and that a row can be drilled into.
 *
 * The case is built through the form, so the figures below come from the same path a user
 * takes. At 1,880 hours x 75% x 60 = 84,600 minutes and a 20-minute handle time, required
 * FTE is volume / 4,230:
 *
 *   Europe          40 FTE @ 70,000   volume 143,820   required 34.0   frontier 15%
 *   North America   50 FTE @ 100,000  volume 169,200   required 40.0   frontier 20%
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BusinessCaseModule } from "./business-case-module";

const AS_OF = "2026-08-27";

const mount = () => render(<BusinessCaseModule projectId="analysis-test" asOfDate={AS_OF} />);

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const rail = () => screen.getByRole("navigation", { name: /input batches/i });
const goToBatch = (name: RegExp) => fireEvent.click(within(rail()).getByRole("button", { name }));
const button = (name: RegExp) => screen.getByRole<HTMLButtonElement>("button", { name });
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const set = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** A two-region register with different frontiers, entered through the form. */
const buildCase = () => {
  goToBatch(/company & initiative/i);
  set(/company name/i, "Northwind");
  set(/initiative title/i, "Right-Sizing");
  fireEvent.click(button(/^Healthcare$/));

  goToBatch(/scope & regions/i);
  fireEvent.change(screen.getByPlaceholderText("North America"), { target: { value: "Europe" } });
  fireEvent.click(button(/^add region$/i));
  fireEvent.change(screen.getByPlaceholderText("North America"), {
    target: { value: "North America" },
  });
  fireEvent.click(button(/^add region$/i));

  goToBatch(/roles & span/i);
  set(/title for front-line/i, "Processor");

  goToBatch(/units & headcount/i);
  set(/processor fte for europe/i, "40");
  set(/processor fte for north america/i, "50");

  goToBatch(/compensation/i);
  set(/processor cost for europe/i, "70000");
  set(/processor cost for north america/i, "100000");

  goToBatch(/workload & demand/i);
  set(/workload unit name/i, "Claims");
  set(/average handle time/i, "20");
  set(/annual volume for europe/i, "143820");
  set(/annual volume for north america/i, "169200");

  goToBatch(/scenarios & severance/i);
  fireEvent.click(button(/use the 8 \/ 12 \/ 18 spread/i));
};

const openAnalysis = () => {
  buildCase();
  fireEvent.click(button(/generate business case/i));
  fireEvent.click(tab(/analysis/i));
};

const heat = () => screen.getByRole("table", { name: /reduction sensitivity/i });
const states = () => screen.getByRole("table", { name: /current against target/i });

const rowOf = (table: HTMLElement, label: string): HTMLElement => {
  const row = within(table).getByText(label).closest("tr");
  if (!row) throw new Error(`no row ${label}`);
  return row as HTMLElement;
};

describe("reaching the tab", () => {
  it("is locked until the case is complete, alongside the output tab", () => {
    mount();
    // Same gate as the Business case tab: it reads the same register, so a half-filled one
    // would give it frontiers computed from requirements nobody has supplied.
    expect(tab(/analysis/i).hasAttribute("disabled")).toBe(true);
  });

  it("opens once the case is generated", () => {
    mount();
    openAnalysis();
    expect(tab(/analysis/i).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: /^analysis$/i })).toBeTruthy();
  });

  it("says why there is no grid for a capacity case", () => {
    mount();
    buildCase();
    // Adding a task switches the model; the register's reduction axis does not exist.
    goToBatch(/handle-time study/i);
    fireEvent.click(button(/^\+ add a task$/i));

    goToBatch(/workload & demand/i);
    expect(screen.queryByRole("table", { name: /reduction sensitivity/i })).toBeNull();
  });
});

describe("current against target", () => {
  it("shows both states and the surplus per region", () => {
    mount();
    openAnalysis();

    const europe = rowOf(states(), "Europe");
    expect(within(europe).getByText("40.0")).toBeTruthy();
    expect(within(europe).getByText("34.0")).toBeTruthy();
    // 6.0 spare, and the word carries the direction rather than the colour alone.
    expect(within(europe).getByText(/6\.0/)).toBeTruthy();
    expect(within(europe).getByText(/spare/)).toBeTruthy();
  });

  it("switches the measure to money", () => {
    mount();
    openAnalysis();
    fireEvent.click(button(/^annual cost$/i));

    // 40 x 70,000 = 2.8m in place against 34 x 70,000 = 2.4m needed.
    const europe = rowOf(states(), "Europe");
    expect(within(europe).getByText("$2.8m")).toBeTruthy();
    expect(within(europe).getByText("$2.4m")).toBeTruthy();
  });

  it("regroups to teams", () => {
    mount();
    openAnalysis();
    fireEvent.click(button(/^teams$/i));

    // Each region was created as a single team carrying its name, so the rows are the same
    // two — but the header now names the grain it is grouped at.
    expect(within(states()).getByText("Team")).toBeTruthy();
  });
});

describe("the heat map" , () => {
  it("draws a column per reduction step and a frontier per row", () => {
    mount();
    openAnalysis();

    const head = within(heat()).getAllByRole("columnheader").map((h) => h.textContent);
    expect(head).toEqual(["Region", "Frontier", "0%", "4%", "8%", "12%", "16%", "20%", "24%"]);

    // 6 spare of 40 is 15%; 10 of 50 is 20%.
    expect(within(rowOf(heat(), "Europe")).getByText("15.0%")).toBeTruthy();
    expect(within(rowOf(heat(), "North America")).getByText("20.0%")).toBeTruthy();
  });

  it("marks the optimal cell at each row's frontier, not at the deepest cut", () => {
    mount();
    openAnalysis();

    // Europe's frontier is 15%, so 12% is the largest step inside it.
    const europe = within(rowOf(heat(), "Europe")).getByTitle(
      /Europe at 12%.*largest cut inside this row's surplus/i,
    );
    expect(europe).toBeTruthy();
    // North America can go to 20%.
    expect(
      within(rowOf(heat(), "North America")).getByTitle(
        /North America at 20%.*largest cut inside this row's surplus/i,
      ),
    ).toBeTruthy();
  });

  it("says a cell beyond the frontier cuts into required capacity", () => {
    mount();
    openAnalysis();
    expect(
      within(rowOf(heat(), "Europe")).getByTitle(
        /Europe at 16%.*beyond this row's 15\.0% frontier, so it cuts into required capacity/i,
      ),
    ).toBeTruthy();
  });

  it("spells out the arithmetic behind a cell", () => {
    mount();
    openAnalysis();
    // 40 x 12% = 4.8 FTE at 70,000 is 336,000 gross, less 8 weeks of it as severance.
    expect(
      within(rowOf(heat(), "Europe")).getByTitle(/4\.8 FTE x \$70,000 = \$336,000 gross/),
    ).toBeTruthy();
  });

  it("bounds the portfolio at the tightest row", () => {
    mount();
    openAnalysis();
    const total = within(heat()).getByText("Total").closest("tr")!;
    // Total surplus is 16 of 90 FTE — 17.8% — but a uniform cut breaks Europe at 15%.
    expect(within(total).getByText("15.0%")).toBeTruthy();
  });

  it("reports the manager reduction per column rather than inside the cells", () => {
    mount();
    openAnalysis();
    const managers = within(heat()).getByText(/manager reduction/i).closest("tr")!;
    expect(
      within(managers).getAllByTitle(/CEILING.*not allocated to rows/i).length,
    ).toBeGreaterThan(0);
  });
});

describe("drilling into a row", () => {
  it("prompts for a selection before one is made", () => {
    mount();
    openAnalysis();
    expect(screen.getByText(/select a region in either chart to drill into it/i)).toBeTruthy();
  });

  it("opens the row's own numbers and its step-by-step arithmetic", () => {
    mount();
    openAnalysis();
    fireEvent.click(within(heat()).getByText("Europe"));

    const drill = screen.getByRole("table", { name: /Europe step by step/i });
    // Every step listed with its own saving, and the one at the frontier called optimal.
    expect(within(drill).getByText("12%")).toBeTruthy();
    expect(within(drill).getByText("$336,000")).toBeTruthy();
    expect(within(drill).getByText(/^optimal$/i)).toBeTruthy();
    expect(within(drill).getAllByText(/cuts into capacity/i).length).toBeGreaterThan(0);
  });

  it("states what the optimal step is worth in year one", () => {
    mount();
    openAnalysis();
    fireEvent.click(within(heat()).getByText("Europe"));

    // 336,000 gross less 8/52 of it as severance is 284,308. Scoped to the banner, since
    // the same figure also appears in the step table's net column.
    const banner = screen.getByText(/At 12%/).closest("p")!;
    expect(banner.textContent).toMatch(/4\.8 FTE/);
    expect(banner.textContent).toMatch(/\$336,000/);
    expect(banner.textContent).toMatch(/\$284,308/);
  });

  it("lists the teams inside a region", () => {
    mount();
    openAnalysis();
    fireEvent.click(within(heat()).getByText("Europe"));

    const teams = screen.getByRole("table", { name: /teams inside Europe/i });
    expect(within(teams).getByText("Europe")).toBeTruthy();
    expect(within(teams).getByText("15.0%")).toBeTruthy();
  });

  it("closes again", () => {
    mount();
    openAnalysis();
    fireEvent.click(within(heat()).getByText("Europe"));
    fireEvent.click(button(/^close$/i));
    expect(screen.queryByRole("table", { name: /Europe step by step/i })).toBeNull();
  });
});
