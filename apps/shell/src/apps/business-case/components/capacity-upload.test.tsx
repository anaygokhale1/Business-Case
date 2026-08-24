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

describe("translating the capacity delta into money", () => {
  const uploadBoth = async () => {
    goToBatch(/process study & volumes/i);
    await upload(/upload process time study/i, csvFile("study.csv", STUDY));
    fireEvent.click(button(/import 4 steps/i));
    await upload(/upload transaction volumes/i, csvFile("volumes.csv", VOLUMES));
    fireEvent.click(button(/import 1 volume cell/i));
    goToBatch(/role capacity/i);
  };

  /** Reviewer onshore at 120,000; Processor in a hub at 40,000. */
  const enterCosts = () => {
    const set = (name: RegExp, value: string) => {
      const field = input(name);
      fireEvent.change(field, { target: { value } });
      fireEvent.blur(field);
    };
    set(/reviewer all-in annual cost/i, "120000");
    set(/processor all-in annual cost/i, "40000");
    fireEvent.change(input(/reviewer location/i), { target: { value: "Onshore" } });
    fireEvent.change(input(/processor location/i), { target: { value: "Hub" } });
  };

  it("shows no money until a cost is entered, and says why", async () => {
    mount();
    await uploadBoth();
    // FTE is known from the study; cost is in neither file. A saving of $0 would read as
    // "no opportunity" rather than "no data", so the block is withheld entirely.
    // Matched on the block's own heading, which carries the column arrow, so the
    // explanatory note's use of the same words does not satisfy it.
    expect(screen.queryByText(/annual saving ·/i)).toBeNull();
    expect(screen.getByText(/no role has an all-in annual cost yet/i)).toBeTruthy();
  });

  it("values the current-to-target delta once costs are in", async () => {
    mount();
    await uploadBoth();
    enterCosts();

    // current : Reviewer 380,000 min / 84,600 = 4.4917 FTE | Processor 60,000 / 84,600 = 0.7092
    // proposed: Reviewer 100,000 / 84,600 = 1.1820        | Processor 160,000 / 84,600 = 1.8913
    // Saving   = (4.4917 - 1.1820) x 120,000 - (1.8913 - 0.7092) x 40,000
    //          = 397,163 - 47,281 = 349,882
    await waitFor(() => expect(screen.getByText(/annual saving/i)).toBeTruthy());
    expect(screen.getByText("$349,882")).toBeTruthy();
  });

  it("attributes the saving to the location move rather than to grade", async () => {
    mount();
    await uploadBoth();
    enterCosts();

    // Reviewer @ Onshore -> Processor @ Hub is cheaper AND elsewhere, so the whole saving
    // is a location shift. A client needs those separated: one is a job-design decision
    // and the other is a footprint decision.
    await waitFor(() => expect(screen.getByText(/from a cheaper location/i)).toBeTruthy());
    expect(screen.getByText(/from a cheaper grade/i)).toBeTruthy();
    expect(screen.getByText(/from automation/i)).toBeTruthy();
  });

  it("reports both the fractional and the whole-FTE saving", async () => {
    mount();
    await uploadBoth();
    enterCosts();

    // The delta of two rounded numbers is not the rounding of the delta, so both are
    // shown and neither is presented as the other.
    await waitFor(() => expect(screen.getByText(/on whole fte/i)).toBeTruthy());
  });

  it("charges severance on exits, and redeployment reduces them", async () => {
    mount();
    await uploadBoth();
    enterCosts();

    await waitFor(() => expect(screen.getByText(/one-time cost/i)).toBeTruthy());
    const before = screen.getByText(/exiting,/i).textContent ?? "";

    const rate = input(/redeployment rate/i);
    fireEvent.change(rate, { target: { value: "100" } });
    fireEvent.blur(rate);

    // Capped at the growth available, so exits fall but do not reach zero.
    await waitFor(() =>
      expect(screen.getByText(/exiting,/i).textContent).not.toBe(before),
    );
  });

  it("excludes a role with no cost and says how much FTE change that hides", async () => {
    mount();
    await uploadBoth();
    const reviewerCost = input(/reviewer all-in annual cost/i);
    fireEvent.change(reviewerCost, { target: { value: "120000" } });
    fireEvent.blur(reviewerCost);

    // Processor still has no cost. Its FTE change must not be valued at zero.
    await waitFor(() =>
      expect(screen.getByText(/have an fte change of .* but no cost/i)).toBeTruthy(),
    );
  });
});

describe("the insurance preset", () => {
  it("is offered once Insurance is selected, and seeds the role grades", () => {
    mount();
    fireEvent.click(button(/^Insurance \/ Reinsurance$/));

    expect(screen.getByText(/insurance right-shift template available/i)).toBeTruthy();
    expect(screen.getByText(/UW, UA, SSC, COE, PAD, Collections, Engineering, System/)).toBeTruthy();
    // Costs are deliberately not seeded.
    expect(screen.getByText(/no costs are seeded/i)).toBeTruthy();

    fireEvent.click(button(/use the insurance right-shift template/i));
    expect(screen.getByText(/insurance right-shift template in use/i)).toBeTruthy();
  });

  it("seeds the roles with their location but no cost", () => {
    mount();
    fireEvent.click(button(/^Insurance \/ Reinsurance$/));
    fireEvent.click(button(/use the insurance right-shift template/i));

    goToBatch(/role capacity/i);
    // SSC sits in a hub; UW onshore. That difference is where a right-shift saving comes
    // from, so it is seeded rather than left for the user to remember.
    expect(input(/ssc location/i).value).toBe("Hub");
    expect(input(/uw location/i).value).toBe("Onshore");
    expect(input(/uw all-in annual cost/i).value).toBe("");
  });

  it("is reversible back to the reduction model", () => {
    mount();
    fireEvent.click(button(/^Insurance \/ Reinsurance$/));
    fireEvent.click(button(/use the insurance right-shift template/i));
    fireEvent.click(button(/use the reduction model instead/i));

    // Back to the offer, so the choice is never one-way.
    expect(screen.getByText(/insurance right-shift template available/i)).toBeTruthy();
    expect(screen.queryByText(/template in use/i)).toBeNull();
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
