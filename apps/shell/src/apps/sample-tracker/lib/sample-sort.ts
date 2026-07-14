// Pure sorting helpers for the Sample Tracker table. Kept free of React so they
// are trivially unit-testable (see sample-sort.test.ts).

export type SortDir = "asc" | "desc";
export type SortableColumn = "title" | "category" | "owner" | "createdAt";

export type SampleItemRow = {
  id: string;
  title: string;
  category: string;
  owner: string;
  createdAt: string;
};

export function sortItems(
  items: SampleItemRow[],
  column: SortableColumn,
  dir: SortDir
): SampleItemRow[] {
  const sorted = [...items].sort((a, b) =>
    String(a[column] ?? "").localeCompare(String(b[column] ?? ""), undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
  return dir === "asc" ? sorted : sorted.reverse();
}

export function nextSortDir(current: SortDir): SortDir {
  return current === "asc" ? "desc" : "asc";
}
