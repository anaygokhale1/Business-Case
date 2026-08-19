import { describe, expect, it } from "vitest";

import { MISSING } from "./engine/alg";
import { nextSortDir, sortRows, type RegisterRow } from "./register-sort";

const row = (
  name: string,
  region: string,
  currentFrontLine: number,
  requiredFrontLine: number,
): RegisterRow => ({
  unitId: name.toLowerCase(),
  name,
  region,
  effectiveHours: { value: 1410, origin: "inherited" },
  handleTimeMinutes: { value: 22, origin: "inherited" },
  upliftPct: { value: 0, origin: "inherited" },
  volume: { value: 100_000, origin: "own" },
  currentFrontLine,
  currentManagers: 4,
  requiredFrontLine,
  surplus: currentFrontLine - requiredFrontLine,
});

const rows: RegisterRow[] = [
  row("Charlie", "Europe", 40, 31.5),
  row("alpha", "APAC", 22, 25.1),
  row("Bravo", "North America", 61, 48.9),
];

describe("sortRows", () => {
  it("sorts text ascending, case-insensitively", () => {
    expect(sortRows(rows, "name", "asc").map((r) => r.name)).toEqual([
      "alpha",
      "Bravo",
      "Charlie",
    ]);
  });

  it("sorts numerically rather than lexically", () => {
    // A string sort would put 22 before 40 before 61 by luck here, so use a
    // deliberately awkward set where lexical and numeric order differ.
    const awkward = [row("a", "NA", 9, 1), row("b", "NA", 100, 2), row("c", "NA", 20, 3)];
    expect(sortRows(awkward, "currentFrontLine", "asc").map((r) => r.currentFrontLine)).toEqual([
      9, 20, 100,
    ]);
  });

  it("sorts descending", () => {
    expect(sortRows(rows, "requiredFrontLine", "desc").map((r) => r.name)).toEqual([
      "Bravo",
      "Charlie",
      "alpha",
    ]);
  });

  it("does not mutate the input", () => {
    const before = rows.map((r) => r.name);
    sortRows(rows, "surplus", "desc");
    expect(rows.map((r) => r.name)).toEqual(before);
  });

  it("keeps missing values last in BOTH directions", () => {
    const withMissing = [
      row("has value", "NA", 10, 5),
      { ...row("no volume", "NA", 10, MISSING) },
      row("also has value", "NA", 10, 2),
    ];

    expect(sortRows(withMissing, "requiredFrontLine", "asc").map((r) => r.name)).toEqual([
      "also has value",
      "has value",
      "no volume",
    ]);
    // The point of the rule: a unit with nothing to say never occupies the top row,
    // whichever way the reader sorts.
    expect(sortRows(withMissing, "requiredFrontLine", "desc").map((r) => r.name)).toEqual([
      "has value",
      "also has value",
      "no volume",
    ]);
  });
});

describe("nextSortDir", () => {
  it("toggles direction", () => {
    expect(nextSortDir("asc")).toBe("desc");
    expect(nextSortDir("desc")).toBe("asc");
  });
});
