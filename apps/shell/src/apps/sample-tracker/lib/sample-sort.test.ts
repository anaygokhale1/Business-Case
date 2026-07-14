import { describe, expect, it } from "vitest";

import { nextSortDir, sortItems, type SampleItemRow } from "./sample-sort";

const rows: SampleItemRow[] = [
  { id: "1", title: "Charlie", category: "Ops", owner: "Sam", createdAt: "2026-01-03" },
  { id: "2", title: "alpha", category: "Data", owner: "Jordan", createdAt: "2026-01-01" },
  { id: "3", title: "Bravo", category: "Ops", owner: "Demo", createdAt: "2026-01-02" }
];

describe("sortItems", () => {
  it("sorts ascending, case-insensitively", () => {
    const sorted = sortItems(rows, "title", "asc").map((row) => row.title);
    expect(sorted).toEqual(["alpha", "Bravo", "Charlie"]);
  });

  it("sorts descending", () => {
    const sorted = sortItems(rows, "title", "desc").map((row) => row.title);
    expect(sorted).toEqual(["Charlie", "Bravo", "alpha"]);
  });

  it("does not mutate the input array", () => {
    const before = rows.map((row) => row.id);
    sortItems(rows, "owner", "asc");
    expect(rows.map((row) => row.id)).toEqual(before);
  });
});

describe("nextSortDir", () => {
  it("toggles direction", () => {
    expect(nextSortDir("asc")).toBe("desc");
    expect(nextSortDir("desc")).toBe("asc");
  });
});
