/**
 * Typing a capacity case through sections 6 and 7, with no file at all.
 *
 * Both steps show the same rows: the Time study step owns roles and handling times, the
 * Workload & demand step owns volume. A task added in one appears in the other, which is
 * the property that makes them one table rather than two that can drift.
 *
 *   Log the request    New  Analyst -> Assistant  10 min
 *   Check completeness New  Analyst -> Analyst     20 min     New = 10,000 transactions
 *
 *   current  Analyst   30 x 10,000 = 300,000 min -> 3.55 FTE
 *   target   Analyst   20 x 10,000 = 200,000 min -> 2.36 FTE
 *            Assistant 10 x 10,000 = 100,000 min -> 1.18 FTE
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BusinessCaseModule } from "./business-case-module";

const AS_OF = "2026-08-26";

const mount = () => render(<BusinessCaseModule projectId="task-entry-test" asOfDate={AS_OF} />);

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const rail = () => screen.getByRole("navigation", { name: /input batches/i });
const goToBatch = (name: RegExp) => fireEvent.click(within(rail()).getByRole("button", { name }));
const button = (name: RegExp) => screen.getByRole<HTMLButtonElement>("button", { name });
const grid = () => screen.getByRole("table", { name: /task table/i });

/** Text cells commit on blur, so a test types the way a person does. */
const type = (label: RegExp, value: string) => {
  const input = screen.getByLabelText<HTMLInputElement>(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

/** Numbers commit on change, matching NumberInput everywhere else in the form. */
const setNumber = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const addTask = () => fireEvent.click(button(/^\+ add a task$/i));

/** Two tasks and one volume, entered through the two steps that own them. */
const enterCase = () => {
  goToBatch(/handle-time study/i);
  addTask();
  type(/^task for task$/i, "Log the request");
  type(/^task type for task$/i, "New");
  type(/^current role for task$/i, "Analyst");
  type(/^target role for task$/i, "Assistant");
  setNumber(/handling time for Log the request/i, "10");

  addTask();
  type(/^task for task-2$/i, "Check completeness");
  type(/^task type for task-2$/i, "New");
  type(/^current role for task-2$/i, "Analyst");
  type(/^target role for task-2$/i, "Analyst");
  setNumber(/handling time for Check completeness/i, "20");

  // Volume belongs to the other step, on the same rows.
  goToBatch(/workload & demand/i);
  setNumber(/volume for New/i, "10000");
};

const fillCover = () => {
  goToBatch(/company & initiative/i);
  fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: "Northwind" } });
  fireEvent.change(screen.getByLabelText(/initiative title/i), { target: { value: "Right-Shift" } });
  fireEvent.click(button(/^Healthcare$/));
  goToBatch(/workload & demand/i);
  fireEvent.change(screen.getByLabelText(/workload unit name/i), { target: { value: "Requests" } });
};

describe("adding a task by hand", () => {
  it("offers the same five columns as the time study upload", () => {
    mount();
    goToBatch(/handle-time study/i);
    addTask();

    const head = within(grid()).getAllByRole("columnheader").map((h) => h.textContent);
    expect(head.slice(0, 5)).toEqual([
      "Task / action",
      "Task type",
      "Current role",
      "Target role",
      "Handling time (min)",
    ]);
  });

  it("offers task, type, role and volume in the workload step", () => {
    mount();
    goToBatch(/workload & demand/i);
    addTask();

    const head = within(grid()).getAllByRole("columnheader").map((h) => h.textContent);
    expect(head.slice(0, 5)).toEqual([
      "Task / action",
      "Task type",
      "Current role",
      "Volume",
      "Minutes of work",
    ]);
  });

  it("shows a task added in one step in the other", () => {
    mount();
    goToBatch(/handle-time study/i);
    addTask();
    type(/^task for task$/i, "Log the request");
    type(/^task type for task$/i, "New");

    goToBatch(/workload & demand/i);
    // The same row, not a copy: one table, two sets of columns.
    expect(screen.getByLabelText<HTMLInputElement>(/^task for task$/i).value).toBe(
      "Log the request",
    );
  });

  it("lets a two-word role be typed", () => {
    mount();
    goToBatch(/handle-time study/i);
    addTask();
    const input = screen.getByLabelText<HTMLInputElement>(/^current role for task$/i);

    // Normalising on each keystroke would strip the trailing space the moment it was
    // typed, so the second word could never be started.
    fireEvent.change(input, { target: { value: "Senior " } });
    expect(input.value).toBe("Senior ");
    fireEvent.change(input, { target: { value: "Senior Analyst" } });
    fireEvent.blur(input);
    expect(screen.getByLabelText<HTMLInputElement>(/^current role for task$/i).value).toBe(
      "Senior Analyst",
    );
  });

  it("says a row with no task type reaches no volume", () => {
    mount();
    goToBatch(/handle-time study/i);
    addTask();

    // The row looks finished otherwise, and an empty type would silently join nothing.
    expect(screen.getByText(/no task type, so no volume reaches this task/i)).toBeTruthy();
  });

  it("says a task with no target role stays where it is", () => {
    mount();
    goToBatch(/handle-time study/i);
    addTask();
    type(/^current role for task$/i, "Analyst");

    expect(within(grid()).getByText(/stays with Analyst/i)).toBeTruthy();
  });

  it("shares one volume across the tasks of a type", () => {
    mount();
    enterCase();

    // One volume cell for the type, not one per task — and both tasks' minutes come from it.
    expect(screen.getAllByLabelText(/volume for New/i)).toHaveLength(1);
    const minutes = within(grid()).getAllByTitle(/min across 10,000 transactions/i);
    expect(minutes.map((m) => m.textContent)).toEqual(["100,000", "200,000"]);
  });

  it("reports the demand entered, and any type still missing a volume", () => {
    mount();
    enterCase();
    expect(screen.getByText(/10,000 Requests|10,000 transactions/)).toBeTruthy();

    goToBatch(/handle-time study/i);
    addTask();
    type(/^task type for task-3$/i, "Renewal");

    goToBatch(/workload & demand/i);
    // Said plainly: those tasks contribute nothing, so the answer would be too low.
    expect(screen.getByText(/Renewal carrying no volume/)).toBeTruthy();
  });

  it("removes a task", () => {
    mount();
    enterCase();
    goToBatch(/handle-time study/i);
    const rows = within(grid()).getAllByRole("row");
    fireEvent.click(within(rows[1]!).getByRole("button", { name: /remove/i }));

    expect(screen.queryByLabelText(/^task for task$/i)).toBeNull();
    expect(screen.getByLabelText(/^task for task-2$/i)).toBeTruthy();
  });
});

describe("the case it produces", () => {
  it("computes capacity by role from typed input alone", () => {
    mount();
    enterCase();
    fillCover();

    fireEvent.click(button(/generate business case/i));

    const card = screen.getByRole("table", { name: /capacity by role/i });
    const row = (role: string) => within(card).getByText(role).closest("tr")!;

    expect(within(row("Analyst")).getByText("3.55")).toBeTruthy();
    expect(within(row("Analyst")).getByText("2.36")).toBeTruthy();
    expect(within(row("Analyst")).getByText(/released/)).toBeTruthy();
    expect(within(row("Assistant")).getByText("1.18")).toBeTruthy();
    expect(within(row("Assistant")).getByText(/needed/)).toBeTruthy();
  });

  it("shows no net change when work moves and none is automated", () => {
    mount();
    enterCase();
    fillCover();
    fireEvent.click(button(/generate business case/i));

    // The same total either way: 1.18 out of one role and 1.18 into another. The gross
    // movement is what the transition costs, and it is reported next to the net.
    expect(screen.getByText(/1\.18 out \/ 1\.18 in/)).toBeTruthy();
  });

  it("takes the work out of human capacity when the target role is a system", () => {
    mount();
    enterCase();
    goToBatch(/handle-time study/i);
    type(/^target role for task$/i, "System");
    fillCover();
    fireEvent.click(button(/generate business case/i));

    const card = screen.getByRole("table", { name: /capacity by role/i });
    expect(within(card).queryByText("System")).toBeNull();
    expect(screen.getByText(/100,000 minutes leave human capacity/i)).toBeTruthy();
  });

  it("hides the register questions once the case is a capacity case", () => {
    mount();
    goToBatch(/workload & demand/i);
    // Present before: a blank case is still a register case.
    expect(screen.getByLabelText(/average handle time/i)).toBeTruthy();

    addTask();
    // Gone after: they are not unanswered, they are not asked — and filling them in would
    // populate a register nothing reads.
    expect(screen.queryByLabelText(/average handle time/i)).toBeNull();
    expect(screen.queryByText(/volume per region/i)).toBeNull();
    expect(screen.getByText(/handling time lives on the task/i)).toBeTruthy();
  });
});
