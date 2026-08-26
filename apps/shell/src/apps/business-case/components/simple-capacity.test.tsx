/**
 * The simple two-file capacity path, end to end through the real UI.
 *
 * Upload five columns of time study and two of volumes, generate, and read capacity by role
 * off the output card. The parsers and the engine have their own tests; what is unproven
 * without this is that the numbers reach the screen, and that the gate opens for a case
 * whose completeness is a study and a volumes file rather than a unit register.
 *
 * Every figure asserted below is derived by hand in `lib/import/simple-capacity.test.ts`.
 * At 1,880 hours x 75% = 84,600 productive minutes:
 *
 *   Analyst    738,000 -> 290,000 min   8.72 -> 3.43 FTE   +5.30 released
 *   Assistant   50,000 -> 198,000 min   0.59 -> 2.34 FTE   -1.75 needed
 *   System           0 -> 300,000 min   automated, no FTE
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BusinessCaseModule } from "./business-case-module";

const AS_OF = "2026-08-26";

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

const csvFile = (name: string, content: string): File =>
  new File([content], name, { type: "text/csv" });

const mount = () => render(<BusinessCaseModule projectId="simple-capacity-test" asOfDate={AS_OF} />);

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const rail = () => screen.getByRole("navigation", { name: /input batches/i });
const goToBatch = (name: RegExp) => fireEvent.click(within(rail()).getByRole("button", { name }));
const button = (name: RegExp) => screen.getByRole<HTMLButtonElement>("button", { name });
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const field = (name: RegExp) => screen.getByLabelText<HTMLInputElement>(name);

const goToUploads = () => goToBatch(/time study & volumes/i);

const upload = async (label: RegExp, file: File) => {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(file.name)).toBeTruthy());
};

const importStudy = async (csv = STUDY) => {
  goToUploads();
  await upload(/upload time study/i, csvFile("study.csv", csv));
  fireEvent.click(button(/^import \d+ tasks$/i));
};

const importVolumes = async (csv = VOLUMES) => {
  goToUploads();
  await upload(/upload volumes study/i, csvFile("volumes.csv", csv));
  fireEvent.click(button(/^import \d+ task types$/i));
};

/** The cover answers the capacity model still needs, which the files do not carry. */
const fillCover = () => {
  goToBatch(/company & initiative/i);
  fireEvent.change(field(/company name/i), { target: { value: "Northwind Assurance" } });
  fireEvent.change(field(/initiative title/i), { target: { value: "Capacity Right-Shift" } });
  // Industry is a pill, not a select. Healthcare rather than Insurance so the insurance
  // capacity template is not offered alongside — this path is about the uploaded study.
  fireEvent.click(button(/^Healthcare$/));
  goToBatch(/workload & demand/i);
  fireEvent.change(field(/workload unit name/i), { target: { value: "Transactions" } });
};

const card = () => screen.getByRole("table", { name: /capacity by role/i });

const roleRow = (role: string): HTMLElement => {
  const row = within(card()).getByText(role).closest("tr");
  if (!row) throw new Error(`no row for ${role}`);
  return row as HTMLElement;
};

describe("uploading the five-column time study", () => {
  it("opens on the simple format and proposes the mapping", async () => {
    mount();
    goToUploads();
    await upload(/upload time study/i, csvFile("study.csv", STUDY));

    // Previewed, so a column read as the wrong thing is visible before it is applied.
    const preview = screen.getByRole("table", { name: /what the study will import/i });
    // Twice: the same task is measured under both task types, which are distinct rows.
    expect(within(preview).getAllByText("Log the request")).toHaveLength(2);
    expect(within(preview).getByText("Price the risk")).toBeTruthy();
    expect(button(/import 6 tasks/i)).toBeTruthy();
  });

  it("shows a task with no stated target as unchanged rather than blank", async () => {
    mount();
    goToUploads();
    await upload(
      /upload time study/i,
      csvFile("study.csv", `Task,Task Type,Current Role,Target Role,AHT\nLog,New,Analyst,,10`),
    );

    const preview = screen.getByRole("table", { name: /what the study will import/i });
    // The engine carries the current owner forward, so the preview says so instead of
    // leaving the reader to guess what an empty target cell means.
    expect(within(preview).getByText(/Analyst \(unchanged\)/)).toBeTruthy();
  });

  it("reports the roles it found and how they were read", async () => {
    mount();
    await importStudy();

    expect(screen.getByText(/6 tasks · 3 roles/)).toBeTruthy();
    expect(screen.getByText(/^Analyst$/)).toBeTruthy();
    expect(screen.getByText(/^Assistant$/)).toBeTruthy();
    // "System" is read as an automation target rather than as a team.
    expect(screen.getByText(/System · automated/)).toBeTruthy();
  });

  it("says which task types have no volume yet", async () => {
    mount();
    await importStudy();
    await importVolumes(`Task Type,Volume\nNew,10000`);

    // Each file is internally consistent, so this can only be caught at the join — and it
    // is the direction that quietly costs capacity.
    const note = screen.getByText(/complete-looking and too low/i);
    expect(note.textContent).toMatch(/Renewal/);
  });

  it("confirms the join once both files cover the same types", async () => {
    mount();
    await importStudy();
    await importVolumes();

    expect(screen.getByText(/Every task type is matched/i)).toBeTruthy();
    expect(screen.getByText(/2 task types · 16,000 transactions/)).toBeTruthy();
  });
});

describe("uploading the volumes study", () => {
  it("takes the count once when the file has a row per task", async () => {
    mount();
    goToUploads();
    await upload(
      /upload volumes study/i,
      csvFile(
        "volumes.csv",
        `Task Type,Current Role,Target Role,Average Handling Time,Volume
New,Analyst,Assistant,10,10000
New,Analyst,Analyst,20,10000`,
      ),
    );

    // Adding these would double demand and nothing in the result would look wrong.
    const preview = screen.getByRole("table", { name: /what the volumes will import/i });
    expect(within(preview).getByText("10,000")).toBeTruthy();
    expect(button(/import 1 task types/i)).toBeTruthy();
  });

  it("offers itself as the study when it carries roles and times", async () => {
    mount();
    goToUploads();
    await upload(
      /upload volumes study/i,
      csvFile(
        "volumes.csv",
        `Task Type,Current Role,Target Role,Average Handling Time,Volume
New,Analyst,Assistant,10,10000
Renewal,Analyst,Analyst,20,6000`,
      ),
    );

    const offer = screen.getByRole("checkbox", { name: /also carries roles and handling times/i });
    // Offered by default only because there is no study loaded to contradict it.
    expect((offer as HTMLInputElement).checked).toBe(true);
    fireEvent.click(button(/import 2 task types/i));

    expect(screen.getByText(/2 tasks · 2 roles/)).toBeTruthy();
    expect(screen.getByText(/Every task type is matched/i)).toBeTruthy();
  });

  it("can add up separate counts instead when told to", async () => {
    mount();
    goToUploads();
    await upload(/upload volumes study/i, csvFile("volumes.csv", `Task Type,Volume\nNew,4000\nNew,6000`));

    const preview = () => screen.getByRole("table", { name: /what the volumes will import/i });
    // A file of type and count alone reads as separate counts by default.
    expect(within(preview()).getByText("10,000")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/repeated task types/i), { target: { value: "repeated" } });
    // Read as one count restated, the two rows disagree. Understating demand understates
    // the whole case, so the larger figure is taken and the disagreement is named.
    expect(within(preview()).getByText("6,000")).toBeTruthy();
    expect(screen.getByText(/state 4,000, 6,000 as the same volume/)).toBeTruthy();
  });
});

describe("the capacity output", () => {
  const ready = async () => {
    mount();
    await importStudy();
    await importVolumes();
    fillCover();
  };

  it("unlocks once both files are in and the cover is answered", async () => {
    await ready();
    const generate = button(/generate business case/i);
    // The reduction model's register questions do not apply, so they must not block a
    // capacity case that is complete.
    expect(generate.disabled).toBe(false);
    fireEvent.click(generate);
    expect(tab(/business case/i).getAttribute("aria-selected")).toBe("true");
  });

  it("shows current against target required FTE for every role", async () => {
    await ready();
    fireEvent.click(button(/generate business case/i));

    expect(within(roleRow("Analyst")).getByText("8.72")).toBeTruthy();
    expect(within(roleRow("Analyst")).getByText("3.43")).toBeTruthy();
    expect(within(roleRow("Assistant")).getByText("0.59")).toBeTruthy();
    expect(within(roleRow("Assistant")).getByText("2.34")).toBeTruthy();
  });

  it("shows the surplus and the deficit with a word, not only a colour", async () => {
    await ready();
    fireEvent.click(button(/generate business case/i));

    // Identity of the direction never rests on colour: the sign and the word carry it.
    expect(within(roleRow("Analyst")).getByText(/released/)).toBeTruthy();
    expect(within(roleRow("Analyst")).getByText(/5\.30/)).toBeTruthy();
    expect(within(roleRow("Assistant")).getByText(/needed/)).toBeTruthy();
    expect(within(roleRow("Assistant")).getByText(/1\.75/)).toBeTruthy();
  });

  it("totals both states and the net change", async () => {
    await ready();
    fireEvent.click(button(/generate business case/i));

    const total = within(card()).getByText("Total").closest("tr")!;
    expect(within(total).getByText("9.31")).toBeTruthy();
    expect(within(total).getByText("5.77")).toBeTruthy();
    expect(screen.getByText(/net capacity released/i)).toBeTruthy();
  });

  it("reports the gross movement alongside the net", async () => {
    await ready();
    fireEvent.click(button(/generate business case/i));

    // 5.30 out and 1.75 in is a net of 3.55 and a transition touching seven people.
    expect(screen.getByText(/5\.30 out \/ 1\.75 in/)).toBeTruthy();
  });

  it("keeps the automated role out of the FTE table and explains where its work went", async () => {
    await ready();
    fireEvent.click(button(/generate business case/i));

    expect(within(card()).queryByText("System")).toBeNull();
    const notStaffed = screen.getByText(/automation target/i).closest("li")!;
    expect(notStaffed.textContent).toMatch(/System/);
    expect(notStaffed.textContent).toMatch(/300,000 minutes/);
    // The conservation check, stated on the card: the only work that left is what a
    // system now does.
    expect(screen.getByText(/300,000 minutes leave human capacity/i)).toBeTruthy();
  });

  it("states that this is required against required, not against headcount", async () => {
    await ready();
    fireEvent.click(button(/generate business case/i));

    expect(screen.getByText(/required capacity against required capacity/i)).toBeTruthy();
    expect(screen.getByText(/requirement released\s+rather than people released/i)).toBeTruthy();
  });

  it("shows no money until a cost is entered, and says why", async () => {
    await ready();
    fireEvent.click(button(/generate business case/i));

    // A $0 saving would read as "no opportunity" rather than "no data".
    expect(screen.getByText(/no cost has been entered against any role/i)).toBeTruthy();
    expect(screen.queryByText(/gross annual saving/i)).toBeNull();
  });

  it("values the move once costs are in", async () => {
    await ready();

    goToBatch(/role capacity/i);
    fireEvent.change(screen.getByLabelText(/Analyst all-in annual cost/i), {
      target: { value: "120000" },
    });
    fireEvent.change(screen.getByLabelText(/Assistant all-in annual cost/i), {
      target: { value: "60000" },
    });

    fireEvent.click(button(/generate business case/i));

    // 738,000/84,600 x 120,000 + 50,000/84,600 x 60,000 = 1,082,269.50
    // 290,000/84,600 x 120,000 + 198,000/84,600 x 60,000 =   551,773.05
    expect(screen.getByText(/gross annual saving/i)).toBeTruthy();
    expect(screen.getByText("$530,496")).toBeTruthy();
  });
});
