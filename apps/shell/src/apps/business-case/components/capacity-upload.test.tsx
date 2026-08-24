/**
 * Uploading a study and a volume sheet through the real UI.
 *
 * This drives an actual `File` through the actual file input, so it covers the whole path
 * the user takes: read, propose a mapping, preview, apply, populate. The unit tests cover
 * the parsers; what is unproven without this is the wiring, and a broken wiring produces
 * a page that looks fine and does nothing.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BusinessCaseModule } from "./business-case-module";

const AS_OF = "2026-08-24";

const STUDY = `Step ID,Level 1,Level 5 (Process),LOB,Region,Applies: New,Applies: Renewal,Applies: Bound,Applies: Lost,Current Role,Proposed Role,AHT (minutes),Frequency (occurrences per transaction)
S-001,1 Intake,Log submission,Alpha,Testland,Y,Y,Y,Y,Reviewer,Processor,10,1
S-002,1 Intake,Check completeness,Alpha,Testland,Y,Y,Y,Y,Reviewer,Reviewer,20,0.5
S-003,2 Assess,Produce price,Alpha,Testland,Y,N,Y,N,Reviewer,System,30,1
S-004,3 Issue,Issue documents,Alpha,Testland,Y,Y,Y,N,Processor,Processor,4,1`;

const VOLUMES = `LOB,Transaction Type,Period Start,Period End,Transactions Received,Bound,Lost
Alpha,New,2025-01-01,2025-12-31,10000,6000,4000`;

const csvFile = (name: string, content: string): File =>
  new File([content], name, { type: "text/csv" });

const mount = () => render(<BusinessCaseModule projectId="capacity-test" asOfDate={AS_OF} />);

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const rail = () => screen.getByRole("navigation", { name: /input batches/i });
const goToBatch = (name: RegExp) => fireEvent.click(within(rail()).getByRole("button", { name }));
const button = (name: RegExp) => screen.getByRole<HTMLButtonElement>("button", { name });
const input = (name: RegExp) => screen.getByLabelText<HTMLInputElement>(name);

/** Drive a file through the hidden input the upload button clicks. */
const upload = async (label: RegExp, file: File) => {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
  // readSheets is async — the staged panel appears on the microtask after the read.
  await waitFor(() => expect(screen.getByText(file.name)).toBeTruthy());
};

describe("uploading a process study", () => {
  it("stages the file, proposes a mapping and previews the rows", async () => {
    mount();
    goToBatch(/process study & volumes/i);
    await upload(/upload process time study/i, csvFile("study.csv", STUDY));

    // The discovered groups are the ones that vary in width, so they are shown for review.
    expect(screen.getByText(/^current, proposed$/)).toBeTruthy();
    expect(screen.getByText(/^New, Renewal$/)).toBeTruthy();
    expect(screen.getByText(/^Bound, Lost$/)).toBeTruthy();
    // Preview, so a wrong column is visible immediately rather than after import.
    expect(screen.getByText("Log submission")).toBeTruthy();
    expect(screen.getByRole("button", { name: /import 4 steps/i })).toBeTruthy();
  });

  it("populates the questionnaire on import", async () => {
    mount();
    goToBatch(/process study & volumes/i);
    await upload(/upload process time study/i, csvFile("study.csv", STUDY));
    fireEvent.click(button(/import 4 steps/i));

    // The card now reports what landed. Asserted on the summary rather than the word
    // "Loaded", which also matches "Nothing uploaded yet" on the other card.
    expect(screen.getByText(/4 steps · 3 roles · 2 role columns/i)).toBeTruthy();
    expect(screen.getByText(/from study\.csv/i)).toBeTruthy();

    // And the roles the study named are offered with their inferred kind.
    expect(screen.getByText(/^Reviewer$/)).toBeTruthy();
    expect(screen.getByText(/^Processor$/)).toBeTruthy();
    // "System" is read as an automation target rather than as a team.
    expect(screen.getByText(/System · automated/)).toBeTruthy();
  });

  it("fills the role list in the Roles step from the study", async () => {
    mount();
    goToBatch(/process study & volumes/i);
    await upload(/upload process time study/i, csvFile("study.csv", STUDY));
    fireEvent.click(button(/import 4 steps/i));

    // The questionnaire's own role list is populated, not asked for again.
    goToBatch(/roles & span/i);
    expect(input(/title for reviewer/i).value).toBe("Reviewer");
    expect(input(/title for processor/i).value).toBe("Processor");
  });

  it("picks the as-is and to-be columns and lets them be changed", async () => {
    mount();
    goToBatch(/process study & volumes/i);
    await upload(/upload process time study/i, csvFile("study.csv", STUDY));
    fireEvent.click(button(/import 4 steps/i));

    const asIs = screen.getByLabelText<HTMLSelectElement>(/as-is assignment/i);
    const toBe = screen.getByLabelText<HTMLSelectElement>(/to-be assignment/i);
    expect(asIs.value).toBe("current");
    expect(toBe.value).toBe("proposed");

    // Which column is the target is the case's decision, not the file's.
    fireEvent.change(toBe, { target: { value: "current" } });
    expect(screen.getByLabelText<HTMLSelectElement>(/to-be assignment/i).value).toBe("current");
  });
});

describe("uploading volumes", () => {
  it("derives the outcome mix from the counts and shows it", async () => {
    mount();
    goToBatch(/process study & volumes/i);
    await upload(/upload transaction volumes/i, csvFile("volumes.csv", VOLUMES));

    // 6,000 of 10,000 bound. Derived, not asserted.
    expect(screen.getByText(/Bound 60% · Lost 40%/)).toBeTruthy();
    fireEvent.click(button(/import 1 volume cell/i));
    expect(screen.getByText(/1 cells · 10,000 transactions/i)).toBeTruthy();
  });
});

describe("both files together", () => {
  const uploadBoth = async () => {
    goToBatch(/process study & volumes/i);
    await upload(/upload process time study/i, csvFile("study.csv", STUDY));
    fireEvent.click(button(/import 4 steps/i));
    await upload(/upload transaction volumes/i, csvFile("volumes.csv", VOLUMES));
    fireEvent.click(button(/import 1 volume cell/i));
  };

  it("computes required FTE per role, using each role's own denominator", async () => {
    mount();
    await uploadBoth();
    goToBatch(/role capacity/i);

    // Reviewer per new transaction: 10 (S-001) + 0.5 x 20 (S-002) + 0.6 x 30 (S-003)
    //   = 10 + 10 + 18 = 38 min, x 10,000 = 380,000 min.
    // At the default 1,880 hours x 75% x 60 = 84,600 productive minutes: 4.49 FTE.
    expect(input(/reviewer working hours per year/i).value).toBe("1880");
    expect(input(/reviewer utilisation percent/i).value).toBe("75");
    await waitFor(() => expect(screen.getByText("4.5")).toBeTruthy());
  });

  it("moves the answer when a role's utilisation changes", async () => {
    mount();
    await uploadBoth();
    goToBatch(/role capacity/i);

    const utilisation = input(/reviewer utilisation percent/i);
    fireEvent.change(utilisation, { target: { value: "60" } });
    fireEvent.blur(utilisation);

    // 380,000 / (1,880 x 0.60 x 60 = 67,680) = 5.62. The whole reason the FTE figure sits
    // in the same view as the assumption.
    await waitFor(() => expect(screen.getByText("5.6")).toBeTruthy());
  });

  it("reports the gross movement, not only the net", async () => {
    mount();
    await uploadBoth();
    goToBatch(/role capacity/i);

    // Under `proposed`: S-001 moves Reviewer -> Processor, S-003 moves to System, which is
    // automated and so leaves human capacity entirely.
    expect(screen.getByText(/moving out of shrinking roles/i)).toBeTruthy();
    expect(screen.getByText(/moving into growing roles/i)).toBeTruthy();
    expect(screen.getByText(/the gross movement is larger than the net/i)).toBeTruthy();
  });

  it("treats an automated role as having no FTE at all", async () => {
    mount();
    await uploadBoth();
    goToBatch(/role capacity/i);

    const row = screen.getByText(/^System$/).closest("tr")!;
    expect(within(row).getByText(/automated/i)).toBeTruthy();
    // Its work is visible in the study but consumes nobody.
    expect(within(row).getByLabelText<HTMLSelectElement>(/system kind/i).value).toBe("automated");
  });

  it("lets a misread role be corrected back to staffed", async () => {
    mount();
    await uploadBoth();
    goToBatch(/role capacity/i);

    // Classification is a guess from the name; calling a real team "automation" would
    // delete its people from the model, so it has to be reversible.
    const kind = screen.getByLabelText<HTMLSelectElement>(/system kind/i);
    fireEvent.change(kind, { target: { value: "staffed" } });
    await waitFor(() =>
      expect(input(/system working hours per year/i).value).toBe("1880"),
    );
  });

  it("survives a reload with the study and volumes intact", async () => {
    mount();
    await uploadBoth();
    cleanup();

    mount();
    goToBatch(/process study & volumes/i);
    expect(screen.getByText(/4 steps · 3 roles · 2 role columns/i)).toBeTruthy();
    expect(screen.getByText(/1 cells · 10,000 transactions/i)).toBeTruthy();
  });
});

describe("a file that cannot be used", () => {
  it("says what is wrong rather than importing nothing quietly", async () => {
    mount();
    goToBatch(/process study & volumes/i);
    await upload(
      /upload process time study/i,
      csvFile("wrong.csv", `Name,Address\nAlice,1 High St\nBob,2 Low St`),
    );

    // No handle time and no role column, so there is nothing to import — and the button
    // is disabled rather than importing an empty study.
    expect(screen.getByText(/needs a handle-time column and at least one role column/i)).toBeTruthy();
    expect(button(/import 0 steps/i).disabled).toBe(true);
  });

  it("rejects the old .xls format by name", async () => {
    mount();
    goToBatch(/process study & volumes/i);
    const xls = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], "old.xls");
    fireEvent.change(screen.getByLabelText(/upload process time study/i), {
      target: { files: [xls] },
    });
    await waitFor(() => expect(screen.getByText(/older \.xls format/i)).toBeTruthy());
  });
});
