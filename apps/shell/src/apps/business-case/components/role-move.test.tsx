/**
 * Choosing which work stays and which moves, in the Workload & demand step.
 *
 * The columns only appear for the one core problem whose question they are, and the
 * comparison beneath them has to follow every change — otherwise the decision and its
 * consequence sit two tabs apart and the user is guessing while they work.
 *
 *   Log the request    New  Analyst -> Assistant  10 min
 *   Check completeness New  Analyst -> Analyst     20 min    New = 10,000 transactions
 *
 * At 84,600 productive minutes per FTE:
 *   current  Analyst   300,000 min -> 3.55 FTE
 *   future   Analyst   200,000 min -> 2.36 FTE     Assistant 100,000 min -> 1.18 FTE
 *
 * With Analyst at 120,000 and Assistant at 60,000 the requirement does not move at all —
 * 3.55 FTE either way — and the cost falls by 100,000 minutes' worth of the rate difference:
 * 100,000 / 84,600 x (120,000 - 60,000) = $70,922.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BusinessCaseModule } from "./business-case-module";

const AS_OF = "2026-08-27";

const mount = () => render(<BusinessCaseModule projectId="role-move-test" asOfDate={AS_OF} />);

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const rail = () => screen.getByRole("navigation", { name: /input batches/i });
const goToBatch = (name: RegExp) => fireEvent.click(within(rail()).getByRole("button", { name }));
const button = (name: RegExp) => screen.getByRole<HTMLButtonElement>("button", { name });

/** Text cells commit on blur. */
const type = (label: RegExp, value: string) => {
  const input = screen.getByLabelText<HTMLInputElement>(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

const setNumber = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const chooseRightSizing = () => {
  goToBatch(/company & initiative/i);
  fireEvent.click(button(/^Capacity Right-sizing$/));
};

const summary = () => screen.getByRole("table", { name: /current against future by role/i });

const roleRow = (role: string): HTMLElement => {
  const row = within(summary()).getByText(role).closest("tr");
  if (!row) throw new Error(`no row for ${role}`);
  return row as HTMLElement;
};

/** Two tasks and a volume, with the first one moving. */
const enterTasks = ({ move = true }: { move?: boolean } = {}) => {
  goToBatch(/workload & demand/i);
  fireEvent.click(button(/^\+ add a task$/i));
  type(/^task for task$/i, "Log the request");
  type(/^task type for task$/i, "New");
  type(/^current role for task$/i, "Analyst");
  if (move) type(/^target role for task$/i, "Assistant");
  setNumber(/handling time for Log the request/i, "10");

  fireEvent.click(button(/^\+ add a task$/i));
  type(/^task for task-2$/i, "Check completeness");
  type(/^task type for task-2$/i, "New");
  type(/^current role for task-2$/i, "Analyst");
  setNumber(/handling time for Check completeness/i, "20");

  setNumber(/volume for New/i, "10000");
};

const enterCosts = () => {
  goToBatch(/role capacity/i);
  setNumber(/Analyst all-in annual cost/i, "120000");
  setNumber(/Assistant all-in annual cost/i, "60000");
  goToBatch(/workload & demand/i);
};

describe("the columns appear for the right core problem", () => {
  it("offers current and future role once Capacity Right-sizing is chosen", () => {
    mount();
    chooseRightSizing();
    goToBatch(/workload & demand/i);
    fireEvent.click(button(/^\+ add a task$/i));

    const head = within(screen.getByRole("table", { name: /task table/i }))
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    // Handling time is here too: the comparison beneath cannot be computed without it, and
    // sending the user to another step for it leaves this screen showing nothing.
    expect(head.slice(0, 7)).toEqual([
      "Task / action",
      "Task type",
      "Current role",
      "Target role",
      "Handling time (min)",
      "Volume",
      "Minutes of work",
    ]);
  });

  it("explains that a blank future role means the work stays", () => {
    mount();
    chooseRightSizing();
    goToBatch(/workload & demand/i);
    expect(screen.getByText(/which work stays and which moves/i)).toBeTruthy();
  });

  it("leaves the column out for a core problem it is not the question of", () => {
    mount();
    goToBatch(/company & initiative/i);
    fireEvent.click(button(/^Cost Reduction$/));
    goToBatch(/workload & demand/i);
    fireEvent.click(button(/^\+ add a task$/i));

    // A column of decisions nobody is being asked to make.
    const head = within(screen.getByRole("table", { name: /task table/i }))
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(head).not.toContain("Target role");
    expect(screen.queryByText(/which work stays and which moves/i)).toBeNull();
  });
});

describe("current against future", () => {
  it("shows required FTE under each assignment, per role", () => {
    mount();
    chooseRightSizing();
    enterTasks();

    expect(within(roleRow("Analyst")).getByText("3.55")).toBeTruthy();
    expect(within(roleRow("Analyst")).getByText("2.36")).toBeTruthy();
    expect(within(roleRow("Analyst")).getByText(/1\.18/)).toBeTruthy();
    expect(within(roleRow("Analyst")).getByText(/released/)).toBeTruthy();

    expect(within(roleRow("Assistant")).getByText("1.18")).toBeTruthy();
    expect(within(roleRow("Assistant")).getByText(/needed/)).toBeTruthy();
  });

  it("reports no net change when the work only moves", () => {
    mount();
    chooseRightSizing();
    enterTasks();

    // 3.55 either way: the same work, reassigned. The saving comes from the mix, not from
    // needing fewer people, which is the point of a right-shift.
    const total = within(summary()).getByText("Total").closest("tr")!;
    expect(within(total).getAllByText("3.55")).toHaveLength(2);
    expect(within(total).getByText(/no change/i)).toBeTruthy();
  });

  it("says nothing is moving while every future role is blank", () => {
    mount();
    chooseRightSizing();
    enterTasks({ move: false });

    expect(screen.getByText(/nothing is moving yet/i)).toBeTruthy();
  });

  it("follows a change to a future role", () => {
    mount();
    chooseRightSizing();
    enterTasks({ move: false });
    expect(screen.getByText(/nothing is moving yet/i)).toBeTruthy();

    type(/^target role for task$/i, "Assistant");
    expect(screen.queryByText(/nothing is moving yet/i)).toBeNull();
    expect(within(roleRow("Assistant")).getByText("1.18")).toBeTruthy();
  });

  it("takes the work out of human capacity when the future role is a system", () => {
    mount();
    chooseRightSizing();
    enterTasks();
    type(/^target role for task$/i, "System");

    // Analyst keeps only the 200,000 minutes it was not going to give up, and no staffed
    // role picks up the rest — so the requirement genuinely falls.
    expect(within(roleRow("Analyst")).getByText("2.36")).toBeTruthy();
    expect(within(summary()).queryByText("System")).toBeNull();
    const total = within(summary()).getByText("Total").closest("tr")!;
    expect(within(total).getByText("2.36")).toBeTruthy();
  });
});

describe("the money", () => {
  it("shows only the FTE shift until a cost is entered, and says why", () => {
    mount();
    chooseRightSizing();
    enterTasks();

    // A $0 delta would read as "this move is worth nothing" rather than "we cannot say".
    expect(screen.getByText(/no cost against any role yet/i)).toBeTruthy();
    const head = within(summary()).getAllByRole("columnheader").map((h) => h.textContent);
    expect(head).toEqual(["Role", "Current FTE", "Future FTE", "Delta"]);
  });

  it("adds the current and future cost columns once rates are in", () => {
    mount();
    chooseRightSizing();
    enterTasks();
    enterCosts();

    const head = within(summary()).getAllByRole("columnheader").map((h) => h.textContent);
    expect(head).toEqual([
      "Role",
      "Current FTE",
      "Future FTE",
      "Delta",
      "Current cost",
      "Future cost",
    ]);

    // 3.5461 x 120,000 = 425,532 today; 2.3641 x 120,000 = 283,688 under the future.
    expect(within(roleRow("Analyst")).getByText("$425,532")).toBeTruthy();
    expect(within(roleRow("Analyst")).getByText("$283,688")).toBeTruthy();
    // The Assistant does not exist today, so its current cost is nothing, not unknown.
    expect(within(roleRow("Assistant")).getByText("$70,922")).toBeTruthy();
  });

  it("gives the delta between the two scenarios", () => {
    mount();
    chooseRightSizing();
    enterTasks();
    enterCosts();

    const total = within(summary()).getByText("Total").closest("tr")!;
    expect(within(total).getByText("$425,532")).toBeTruthy();
    expect(within(total).getByText("$354,610")).toBeTruthy();

    // 100,000 minutes moving from a 120,000 role to a 60,000 one, on the same total FTE.
    const banner = screen.getByText(/Annual saving \$70,922/i);
    expect(banner).toBeTruthy();
    expect(banner.closest("p")!.textContent).toMatch(/\$425,532 today against \$354,610/);
  });

  it("names a role with no cost and how much change that hides", () => {
    mount();
    chooseRightSizing();
    enterTasks();
    goToBatch(/role capacity/i);
    // Only one side costed.
    setNumber(/Analyst all-in annual cost/i, "120000");
    goToBatch(/workload & demand/i);

    const banner = screen.getByText(/Annual saving/i).closest("p")!;
    expect(banner.textContent).toMatch(/Assistant carries no cost and is excluded/);
    expect(banner.textContent).toMatch(/hiding 1\.18 FTE of change/);
  });

  it("states that both columns are requirement, not headcount", () => {
    mount();
    chooseRightSizing();
    enterTasks();
    expect(screen.getByText(/releasing requirement rather than releasing people/i)).toBeTruthy();
  });
});
