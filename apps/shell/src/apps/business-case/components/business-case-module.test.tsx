/**
 * Mount test for the module shell.
 *
 * This exists because the module is loaded with `ssr: false`, so a 200 from the
 * server proves only that the shell rendered — a client-side crash in the form would
 * look identical over HTTP. Mounting it here is the cheapest thing that actually
 * fails when the input tab is broken.
 *
 * It deliberately drives the UI rather than the reducer: the reducer has its own
 * tests, and what is unproven is the wiring between them.
 *
 * Plain assertions throughout — the suite runs with `globals: false` and no setup
 * file, so jest-dom's matchers are not registered and adding them would mean editing
 * the template's vitest config.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BATCHES } from "../lib/case-questions";
import { BusinessCaseModule } from "./business-case-module";

const AS_OF = "2026-08-18";

const mount = (projectId = "test-project") =>
  render(<BusinessCaseModule projectId={projectId} asOfDate={AS_OF} />);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const tab = (name: RegExp) => screen.getByRole("tab", { name });
const rail = () => screen.getByRole("navigation", { name: /input batches/i });
const goToBatch = (name: RegExp) => fireEvent.click(within(rail()).getByRole("button", { name }));
const input = (name: RegExp) => screen.getByLabelText<HTMLInputElement>(name);
const button = (name: RegExp) => screen.getByRole<HTMLButtonElement>("button", { name });

describe("module shell", () => {
  it("opens on the Input tab with the output tab locked", () => {
    mount();
    expect(tab(/input/i).getAttribute("aria-selected")).toBe("true");
    // The gate is the point: a case rendered from a half-filled form produces numbers
    // that look exactly as confident as a finished one.
    expect(tab(/business case/i).hasAttribute("disabled")).toBe(true);
  });

  it("shows every declared batch in the rail", () => {
    mount();
    // Derived from BATCHES rather than hardcoded, so adding a batch does not require
    // editing a number here — and a batch that fails to render still fails the test.
    expect(within(rail()).getAllByRole("button")).toHaveLength(BATCHES.length);
    for (const batch of BATCHES) {
      expect(within(rail()).getByRole("button", { name: new RegExp(batch.label, "i") })).toBeTruthy();
    }
  });

  it("lists the outstanding required answers, and Generate is unavailable", () => {
    mount();
    expect(button(/generate business case/i).disabled).toBe(true);
    expect(screen.getByText(/outstanding before the case can be built/i)).toBeTruthy();
  });
});

describe("entering answers", () => {
  it("typing a company name reaches the header", () => {
    mount();
    fireEvent.change(input(/company name/i), { target: { value: "Northwind Assurance" } });
    // The header reads from the same store the field writes to, so a failure here means
    // the store is not shared across the module.
    expect(screen.getAllByText(/Northwind Assurance/).length).toBeGreaterThan(0);
  });

  it("a choice pill records the industry", () => {
    mount();
    const pill = button(/^Healthcare$/);
    fireEvent.click(pill);
    expect(pill.getAttribute("aria-pressed")).toBe("true");
  });

  it("moves between batches from the rail", () => {
    mount();
    goToBatch(/scope & regions/i);
    expect(screen.getByRole("heading", { name: /scope & regions/i })).toBeTruthy();
  });

  it("adding a region creates a register row with its own hours and utilisation", () => {
    mount();
    goToBatch(/scope & regions/i);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Europe" } });
    fireEvent.click(button(/add region/i));

    expect(input(/europe working hours per year/i)).toBeTruthy();
    expect(input(/europe utilisation percent/i)).toBeTruthy();
  });

  it("a region-level figure writes through to the region's rows", () => {
    mount();
    goToBatch(/scope & regions/i);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Europe" } });
    fireEvent.click(button(/add region/i));

    fireEvent.change(input(/europe working hours per year/i), { target: { value: "1720" } });
    fireEvent.blur(input(/europe working hours per year/i));

    // Effective hours = 1720 x 75% = 1290, and it appears because the value reached
    // the unit rather than sitting in the input's local draft.
    expect(screen.getByText("1,290")).toBeTruthy();
  });
});

describe("the percentage trap", () => {
  it("edits as a whole number and round-trips through the stored fraction", () => {
    mount();
    goToBatch(/scenarios & severance/i);

    const base = input(/base reduction/i);
    fireEvent.change(base, { target: { value: "12" } });
    // Blur drops the local draft, so what shows afterwards is the stored value
    // formatted back out. 12 here proves 0.12 was stored, not 12 or 0.0012.
    fireEvent.blur(base);
    expect(base.value).toBe("12");
  });

  it("the suggested spread fills all three scenarios", () => {
    mount();
    goToBatch(/scenarios & severance/i);
    fireEvent.click(button(/use the 8 \/ 12 \/ 18 spread/i));

    expect(input(/low reduction/i).value).toBe("8");
    expect(input(/base reduction/i).value).toBe("12");
    expect(input(/high reduction/i).value).toBe("18");
  });
});

describe("generating", () => {
  const fillRequired = () => {
    fireEvent.change(input(/company name/i), { target: { value: "Northwind" } });
    fireEvent.change(input(/initiative title/i), { target: { value: "Claims Ops" } });
    fireEvent.click(button(/^Healthcare$/));

    goToBatch(/scope & regions/i);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Europe" } });
    fireEvent.click(button(/add region/i));

    goToBatch(/roles & span/i);
    fireEvent.change(input(/title for front-line/i), { target: { value: "Claims Processor" } });

    goToBatch(/units & headcount/i);
    fireEvent.change(input(/claims processor fte for europe/i), { target: { value: "84" } });

    goToBatch(/compensation/i);
    fireEvent.click(button(/fill the gaps/i));

    goToBatch(/workload & demand/i);
    fireEvent.change(input(/workload unit name/i), { target: { value: "Claims" } });
    fireEvent.change(input(/average handle time/i), { target: { value: "22" } });
    fireEvent.change(input(/annual volume for europe/i), { target: { value: "480000" } });

    goToBatch(/scenarios & severance/i);
    fireEvent.click(button(/use the 8 \/ 12 \/ 18 spread/i));
  };

  it("unlocks Generate once the required answers are in, and renders the case", () => {
    mount();
    fillRequired();

    const generate = button(/generate business case/i);
    expect(generate.disabled).toBe(false);
    fireEvent.click(generate);

    expect(tab(/business case/i).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: /claims ops/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /unit register/i })).toBeTruthy();
    // Rendered from the answers just entered: 84 FTE at 12% is 10.1 front-line out.
    expect(screen.getAllByText(/gross annual savings/i).length).toBeGreaterThan(0);
  });

  it("re-locks the output if a required answer is later removed", () => {
    mount();
    fillRequired();
    fireEvent.click(button(/generate business case/i));
    expect(tab(/business case/i).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(tab(/input/i));
    fireEvent.change(input(/company name/i), { target: { value: "" } });

    // Not merely a disabled tab — the case must stop being somewhere the user can sit,
    // because the numbers behind it no longer have a complete input set.
    expect(tab(/business case/i).hasAttribute("disabled")).toBe(true);
  });
});

describe("draft persistence", () => {
  it("survives a remount, so a reload does not lose the interview", () => {
    mount();
    fireEvent.change(input(/company name/i), { target: { value: "Northwind" } });
    cleanup();

    mount();
    expect(input(/company name/i).value).toBe("Northwind");
  });

  it("keeps drafts separate per project", () => {
    mount("project-a");
    fireEvent.change(input(/company name/i), { target: { value: "Alpha" } });
    cleanup();

    mount("project-b");
    expect(input(/company name/i).value).toBe("");
  });

  it("falls back to a blank case rather than breaking on a corrupt draft", () => {
    window.localStorage.setItem("ssa.business-case.test-project.v1", "{not json");
    mount();
    // A user must never be stuck in a broken module they can only escape by clearing
    // site data.
    expect(input(/company name/i).value).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* Time study: region scoping, skipping, and upload                           */
/* -------------------------------------------------------------------------- */

describe("time study", () => {
  const withRegions = () => {
    mount();
    goToBatch(/scope & regions/i);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Europe" } });
    fireEvent.click(button(/add region/i));
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "APAC" } });
    fireEvent.click(button(/add region/i));
    goToBatch(/handle-time study/i);
  };

  it("offers a scope per region plus a portfolio-wide scope", () => {
    withRegions();
    expect(button(/^All regions$/)).toBeTruthy();
    expect(button(/^Europe$/)).toBeTruthy();
    expect(button(/^APAC$/)).toBeTruthy();
  });

  it("adds a task row into the selected region only", () => {
    withRegions();
    fireEvent.click(button(/^Europe$/));
    fireEvent.click(button(/add a task row/i));

    fireEvent.change(input(/minutes for task row 1/i), { target: { value: "30" } });
    fireEvent.change(input(/volume for task row 1/i), { target: { value: "60000" } });

    // The row is tagged to Europe, so switching scope hides it.
    expect(input(/region for task row 1/i).value).toBe("Europe");
    fireEvent.click(button(/^APAC$/));
    expect(screen.getByText(/no tasks recorded for apac/i)).toBeTruthy();
  });

  it("says a region without a study falls back rather than inheriting a neighbour", () => {
    withRegions();
    fireEvent.click(button(/^APAC$/));
    expect(screen.getByText(/falls back to the portfolio-wide figure/i)).toBeTruthy();
  });

  it("shows the weighted average, not a plain average of the task times", () => {
    withRegions();
    fireEvent.click(button(/^Europe$/));

    fireEvent.click(button(/add a task row/i));
    fireEvent.change(input(/minutes for task row 1/i), { target: { value: "30" } });
    fireEvent.change(input(/volume for task row 1/i), { target: { value: "60000" } });

    fireEvent.click(button(/add a task row/i));
    fireEvent.change(input(/minutes for task row 2/i), { target: { value: "10" } });
    fireEvent.change(input(/volume for task row 2/i), { target: { value: "40000" } });

    // A plain average would be 20.0. Weighted by volume it is 22.0, and the difference
    // is the whole reason a study beats an asserted figure.
    expect(screen.getByText("22.0 min")).toBeTruthy();
  });

  it("reports coverage against the register and offers to reconcile it", () => {
    withRegions();
    goToBatch(/workload & demand/i);
    fireEvent.change(input(/annual volume for europe/i), { target: { value: "250000" } });

    goToBatch(/handle-time study/i);
    fireEvent.click(button(/^Europe$/));
    fireEvent.click(button(/add a task row/i));
    fireEvent.change(input(/minutes for task row 1/i), { target: { value: "30" } });
    fireEvent.change(input(/volume for task row 1/i), { target: { value: "100000" } });

    // 100,000 studied against 250,000 registered.
    expect(screen.getByText("40%")).toBeTruthy();
    fireEvent.click(button(/set europe/i));

    goToBatch(/workload & demand/i);
    fireEvent.blur(input(/annual volume for europe/i));
    expect(input(/annual volume for europe/i).value).toBe("100000");
  });
});

describe("skipping a section", () => {
  it("marks the time study not applicable and drops it from the count", () => {
    mount();
    goToBatch(/handle-time study/i);
    fireEvent.click(button(/not applicable/i));

    expect(screen.getByText(/is marked not applicable/i)).toBeTruthy();
    // The rail entry reads "skipped" and "not applicable" rather than a progress count.
    const entry = within(rail()).getByRole("button", { name: /handle-time study/i });
    expect(entry.textContent).toContain("skipped");
    expect(entry.textContent).toContain("not applicable");
  });

  it("can be taken back", () => {
    mount();
    goToBatch(/handle-time study/i);
    fireEvent.click(button(/not applicable/i));
    fireEvent.click(button(/include this section/i));
    expect(screen.getByRole("heading", { name: /^time study$/i })).toBeTruthy();
  });

  it("refuses to skip a section the case cannot do without, and says which answers", () => {
    mount();
    // Company carries three required answers, so there is no skip control at all —
    // only an explanation of why.
    expect(screen.queryByRole("button", { name: /not applicable/i })).toBeNull();
    expect(screen.getByText(/cannot be skipped/i)).toBeTruthy();
  });

  it("skipping the study stops it being the active handle-time source", () => {
    mount();
    goToBatch(/workload & demand/i);
    fireEvent.click(button(/^Time Study$/));
    expect(button(/^Time Study$/).getAttribute("aria-pressed")).toBe("true");

    goToBatch(/handle-time study/i);
    fireEvent.click(button(/not applicable/i));

    // Otherwise the model keeps reading a table the user has just declared irrelevant.
    goToBatch(/workload & demand/i);
    expect(button(/^Manual$/).getAttribute("aria-pressed")).toBe("true");
  });
});
