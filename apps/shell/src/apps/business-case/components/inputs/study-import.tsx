"use client";

/**
 * Uploading a time study from a spreadsheet.
 *
 * The flow is deliberately two-stage: read the file and propose a mapping, then let
 * the user correct it before anything reaches the case. An import that applies its own
 * guesses immediately is the worst version of this feature, because a column read as
 * the wrong thing still produces a plausible handle time and nothing looks wrong.
 */

import { useRef, useState } from "react";

import { useCaseStore } from "../../hooks/use-case-store";
import { regionsOf } from "../../lib/case-reducer";
import { ImportError, readSheets, type Sheet } from "../../lib/import/tabular";
import {
  convertStudyRows,
  detectHeaderRow,
  proposeMapping,
  type StudyField,
  type StudyMapping,
} from "../../lib/import/time-study-map";
import { ghostButtonClass, inputClass, Note, primaryButtonClass } from "./fields";

const FIELD_LABEL: Record<StudyField, string> = {
  taskType: "Task",
  minutes: "Handle time (minutes)",
  volume: "Annual volume",
  region: "Region",
};

const REQUIRED_FIELDS: StudyField[] = ["minutes", "volume"];

interface Staged {
  fileName: string;
  sheets: Sheet[];
  sheetIndex: number;
  headerRow: number;
  mapping: StudyMapping;
  /** Region applied to rows whose region cell is blank. `null` is portfolio-wide. */
  defaultRegion: string | null;
}

export function StudyImport({
  scope,
  onDone,
}: {
  /** The scope being imported into. `null` is portfolio-wide. */
  scope: string | null;
  onDone: () => void;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const [staged, setStaged] = useState<Staged | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const regions = regionsOf(workingCase);

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const sheets = await readSheets(file);
      const usable = sheets.filter((s) => s.rows.length > 0);
      if (usable.length === 0) {
        setError("That file has no rows in it.");
        setStaged(null);
        return;
      }
      const headerRow = detectHeaderRow(usable[0]!.rows);
      setStaged({
        fileName: file.name,
        sheets: usable,
        sheetIndex: 0,
        headerRow,
        mapping: proposeMapping(usable[0]!.rows[headerRow] ?? []),
        defaultRegion: scope,
      });
    } catch (caught) {
      // The reader's messages are written for the user — they name the format problem
      // and say what to do about it — so they are shown rather than replaced.
      setError(caught instanceof ImportError ? caught.message : "Could not read that file.");
      setStaged(null);
    } finally {
      setBusy(false);
    }
  };

  if (!staged) {
    return (
      <div className="space-y-3 rounded-2xl bg-canvas p-5">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,.txt,.tsv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pick(file);
              // Cleared so choosing the same file twice fires a change event again.
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {busy ? "Reading…" : "Upload a time study"}
          </button>
          <span className="text-xs text-outline">
            .xlsx or .csv &middot; needs a handle-time column and a volume column
          </span>
          <button type="button" className={ghostButtonClass} onClick={onDone}>
            Cancel
          </button>
        </div>
        {error ? <p className="text-xs font-semibold text-red-600">{error}</p> : null}
      </div>
    );
  }

  const sheet = staged.sheets[staged.sheetIndex]!;
  const header = sheet.rows[staged.headerRow] ?? [];
  const result = convertStudyRows(sheet, staged.headerRow, staged.mapping, staged.defaultRegion);
  const missing = REQUIRED_FIELDS.filter((f) => staged.mapping[f] === null);
  const dropped = result.issues.filter((i) => i.dropped);
  const flagged = result.issues.filter((i) => !i.dropped);

  const set = (patch: Partial<Staged>) => setStaged({ ...staged, ...patch });

  const chooseSheet = (index: number) => {
    const next = staged.sheets[index]!;
    const headerRow = detectHeaderRow(next.rows);
    // Re-detect on a sheet change: the proposal belongs to the sheet, and carrying the
    // previous sheet's column indices over would map the wrong columns silently.
    set({
      sheetIndex: index,
      headerRow,
      mapping: proposeMapping(next.rows[headerRow] ?? []),
    });
  };

  return (
    <div className="space-y-5 rounded-2xl bg-canvas p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-bold text-ink">{staged.fileName}</p>
        <button type="button" className={ghostButtonClass} onClick={onDone}>
          Cancel
        </button>
      </div>

      {staged.sheets.length > 1 ? (
        <label className="block space-y-1.5">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            Sheet
          </span>
          <select
            className={`${inputClass} max-w-xs`}
            value={staged.sheetIndex}
            onChange={(event) => chooseSheet(Number(event.target.value))}
          >
            {staged.sheets.map((s, i) => (
              <option key={s.name} value={i}>
                {s.name} ({s.rows.length} rows)
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1.5">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            Header row
          </span>
          <select
            className={inputClass}
            value={staged.headerRow}
            onChange={(event) => {
              const headerRow = Number(event.target.value);
              set({ headerRow, mapping: proposeMapping(sheet.rows[headerRow] ?? []) });
            }}
          >
            {sheet.rows.slice(0, 30).map((row, i) => (
              <option key={i} value={i}>
                Row {i + 1}: {row.filter((c) => c.trim() !== "").slice(0, 4).join(" · ") || "(blank)"}
              </option>
            ))}
          </select>
        </label>

        {(Object.keys(FIELD_LABEL) as StudyField[]).map((field) => (
          <label key={field} className="space-y-1.5">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
              {FIELD_LABEL[field]}
              {REQUIRED_FIELDS.includes(field) ? "" : " (optional)"}
            </span>
            <select
              className={inputClass}
              value={staged.mapping[field] ?? ""}
              onChange={(event) =>
                set({
                  mapping: {
                    ...staged.mapping,
                    [field]: event.target.value === "" ? null : Number(event.target.value),
                  },
                })
              }
            >
              <option value="">— not in this file —</option>
              {header.map((cell, i) => (
                <option key={i} value={i}>
                  {cell.trim() === "" ? `Column ${i + 1}` : cell}
                </option>
              ))}
            </select>
          </label>
        ))}

        <label className="space-y-1.5">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            Rows with no region
          </span>
          <select
            className={inputClass}
            value={staged.defaultRegion ?? ""}
            onChange={(event) => set({ defaultRegion: event.target.value === "" ? null : event.target.value })}
          >
            <option value="">All regions (portfolio-wide)</option>
            {regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>
      </div>

      {missing.length > 0 ? (
        <p className="text-xs font-semibold text-red-600">
          Choose a column for {missing.map((f) => FIELD_LABEL[f]).join(" and ")} before importing.
        </p>
      ) : null}

      {/* Preview. Showing what the mapping produces is the whole point of staging — a
          user can see a wrong column immediately, whereas a row count tells them nothing. */}
      {result.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left">
                {["Task", "Region", "Minutes", "Volume"].map((label) => (
                  <th
                    key={label}
                    className="px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.slice(0, 5).map((row, i) => (
                <tr key={i} className="border-t border-slate-200/70">
                  <td className="px-3 py-2 text-ink">{row.taskType}</td>
                  <td className="px-3 py-2 text-muted">{row.region ?? "all regions"}</td>
                  <td className="px-3 py-2 tabular-nums text-ink">{row.minutes}</td>
                  <td className="px-3 py-2 tabular-nums text-ink">
                    {row.volume.toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.rows.length > 5 ? (
            <p className="mt-2 text-xs text-outline">and {result.rows.length - 5} more</p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2 text-xs">
        <p className="font-semibold text-ink">
          {result.rows.length} of {result.considered} rows will import
          {result.regions.length > 0 ? ` across ${result.regions.length} region(s)` : ""}.
        </p>
        {dropped.length > 0 ? (
          <ul className="space-y-1 text-muted">
            {dropped.slice(0, 8).map((issue, i) => (
              <li key={i}>
                <span className="font-semibold text-red-600">Row {issue.sheetRow}</span>{" "}
                {issue.message}
              </li>
            ))}
            {dropped.length > 8 ? <li>and {dropped.length - 8} more skipped rows</li> : null}
          </ul>
        ) : null}
        {flagged.length > 0 ? (
          <ul className="space-y-1 text-muted">
            {flagged.slice(0, 5).map((issue, i) => (
              <li key={i}>
                <span className="font-semibold text-outline">Row {issue.sheetRow}</span>{" "}
                {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <Note>
        Importing <strong>replaces</strong> the rows already in{" "}
        {scope === null ? "the portfolio-wide study" : scope}, rather than adding to them. That way
        re-importing a corrected file cannot silently double your volumes.
      </Note>

      <button
        type="button"
        className={primaryButtonClass}
        disabled={missing.length > 0 || result.rows.length === 0}
        onClick={() => {
          dispatch({ type: "timeStudy/replaceScope", region: scope, rows: result.rows });
          // A study is only worth importing if it is going to be used.
          dispatch({ type: "globals/setChoice", patch: { handleTimeSource: "Time Study" } });
          onDone();
        }}
      >
        Import {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
      </button>
    </div>
  );
}
