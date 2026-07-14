"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { useSampleSort } from "../hooks/use-sample-sort";
import type { SampleItemRow, SortableColumn } from "../lib/sample-sort";

const COLUMNS: Array<{ key: SortableColumn; label: string }> = [
  { key: "title", label: "Title" },
  { key: "category", label: "Category" },
  { key: "owner", label: "Owner" },
  { key: "createdAt", label: "Added" }
];

const EMPTY_FORM = { title: "", category: "", owner: "" };

// The Sample Tracker workspace: lists SampleItem rows for a project in a
// sortable table and adds new ones. Data comes from the module's own API route
// (/api/apps/sample-tracker/...), persisted to SQLite. This is the reference
// vertical slice — copy its shape for your own module.
export function SampleTrackerWorkspace({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<SampleItemRow[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const basePath = `/api/apps/sample-tracker/projects/${encodeURIComponent(projectId)}/items`;
  const { sorted, column, dir, toggle } = useSampleSort(items);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(basePath, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Could not load items.");
      }
      const payload = (await response.json()) as { items: SampleItemRow[] };
      setItems(payload.items);
      setError(null);
    } catch {
      setError("Could not load items.");
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Could not add item.");
      }
      setForm(EMPTY_FORM);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add item.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <h1 className="text-2xl font-extrabold text-ink">Sample Tracker</h1>
        <p className="mt-1 text-sm text-muted">
          A synthetic example module. Add items and click a column header to sort.
        </p>

        <form onSubmit={submit} className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input
            aria-label="Title"
            placeholder="Title"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            className="rounded-2xl border border-slate-200 bg-canvas px-4 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
          />
          <input
            aria-label="Category"
            placeholder="Category"
            value={form.category}
            onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
            className="rounded-2xl border border-slate-200 bg-canvas px-4 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
          />
          <input
            aria-label="Owner"
            placeholder="Owner"
            value={form.owner}
            onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))}
            className="rounded-2xl border border-slate-200 bg-canvas px-4 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Adding..." : "Add item"}
          </button>
        </form>

        {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
      </div>

      <div className="rounded-[32px] bg-white/95 p-2 shadow-ambient ring-1 ring-slate-200/70">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left">
              {COLUMNS.map((col) => (
                <th key={col.key} className="px-5 py-3">
                  <button
                    type="button"
                    onClick={() => toggle(col.key)}
                    className="flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline transition hover:text-ink"
                  >
                    {col.label}
                    <span aria-hidden className="text-[10px]">
                      {column === col.key ? (dir === "asc" ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-5 py-8 text-center text-muted">
                  Loading...
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-5 py-8 text-center text-muted">
                  No items yet. Add one above.
                </td>
              </tr>
            ) : (
              sorted.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-semibold text-ink">{item.title}</td>
                  <td className="px-5 py-3 text-muted">{item.category}</td>
                  <td className="px-5 py-3 text-muted">{item.owner}</td>
                  <td className="px-5 py-3 text-muted">{item.createdAt.slice(0, 10)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
