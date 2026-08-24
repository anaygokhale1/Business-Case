"use client";

/**
 * Uploading the process study and the volume sheet.
 *
 * Both are staged before they are applied. The mapping is a proposal the user corrects,
 * because a role column read as the wrong scenario, or a taxonomy level read as an
 * applicability flag, produces a study that computes cleanly and answers a different
 * question — and nothing about the result would look wrong.
 */

import { useRef, useState } from "react";

import { useCaseStore } from "../../hooks/use-case-store";
import { classifyRole } from "../../lib/capacity-populate";
import { ImportError, readSheets, type Sheet } from "../../lib/import/tabular";
import {
  convertStudyRows,
  detectStudyHeaderRow,
  proposeStudyMapping,
  type StudyColumnMapping,
  type StudyImportResult,
} from "../../lib/import/process-study-map";
import {
  convertVolumeRows,
  detectVolumeHeaderRow,
  proposeVolumeMapping,
  type VolumeImportResult,
  type VolumeMapping,
} from "../../lib/import/volumes";
import { count, fte } from "../../lib/format";
import { ghostButtonClass, inputClass, Note, Panel, primaryButtonClass } from "./fields";

type Kind = "study" | "volumes";

interface Staged {
  kind: Kind;
  fileName: string;
  sheets: Sheet[];
  sheetIndex: number;
  headerRow: number;
  studyMapping: StudyColumnMapping | null;
  volumeMapping: VolumeMapping | null;
}

export function BatchCapacityUpload({ blurb }: { blurb: string }) {
  const { workingCase, dispatch } = useCaseStore();
  const capacity = workingCase.capacity;

  const [staged, setStaged] = useState<Staged | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const studyInput = useRef<HTMLInputElement>(null);
  const volumeInput = useRef<HTMLInputElement>(null);

  const pick = async (kind: Kind, file: File) => {
    setBusy(kind);
    setError(null);
    try {
      const sheets = (await readSheets(file)).filter((s) => s.rows.length > 1);
      if (sheets.length === 0) {
        setError("That file has no usable rows.");
        return;
      }
      stage(kind, file.name, sheets, 0);
    } catch (caught) {
      setError(caught instanceof ImportError ? caught.message : "Could not read that file.");
    } finally {
      setBusy(null);
    }
  };

  const stage = (kind: Kind, fileName: string, sheets: Sheet[], sheetIndex: number) => {
    const rows = sheets[sheetIndex]!.rows;
    const headerRow = kind === "study" ? detectStudyHeaderRow(rows) : detectVolumeHeaderRow(rows);
    const header = rows[headerRow] ?? [];
    setStaged({
      kind,
      fileName,
      sheets,
      sheetIndex,
      headerRow,
      studyMapping: kind === "study" ? proposeStudyMapping(header) : null,
      volumeMapping: kind === "volumes" ? proposeVolumeMapping(header) : null,
    });
  };

  return (
    <Panel title="Process study & volumes" blurb={blurb}>
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <UploadCard
            label="Process time study"
            hint="One row per process step: taxonomy, who does it, handle time, frequency, rework."
            fileName={capacity?.source?.studyFile}
            summary={
              capacity && capacity.rows.length > 0
                ? `${count(capacity.rows.length)} steps · ${capacity.roles.length} roles · ${capacity.roleColumns.length} role columns`
                : null
            }
            busy={busy === "study"}
            inputRef={studyInput}
            onPick={(file) => void pick("study", file)}
          />
          <UploadCard
            label="Transaction volumes"
            hint="One row per line of business and transaction type, with a count per outcome."
            fileName={capacity?.source?.volumesFile}
            summary={
              capacity && capacity.demand.length > 0
                ? `${capacity.demand.length} cells · ${count(
                    capacity.demand.reduce(
                      (t, d) => t + (typeof d.submissions === "number" ? d.submissions : 0),
                      0,
                    ),
                  )} transactions`
                : null
            }
            busy={busy === "volumes"}
            inputRef={volumeInput}
            onPick={(file) => void pick("volumes", file)}
          />
        </div>

        {error ? <p className="text-xs font-semibold text-red-600">{error}</p> : null}

        {staged ? (
          <StagedPanel
            staged={staged}
            onSheet={(index) => stage(staged.kind, staged.fileName, staged.sheets, index)}
            onHeaderRow={(headerRow) => {
              const header = staged.sheets[staged.sheetIndex]!.rows[headerRow] ?? [];
              setStaged({
                ...staged,
                headerRow,
                // Re-proposed for the new header: carrying the old column indices over
                // would map the wrong columns without saying so.
                studyMapping: staged.kind === "study" ? proposeStudyMapping(header) : null,
                volumeMapping: staged.kind === "volumes" ? proposeVolumeMapping(header) : null,
              });
            }}
            onStudyMapping={(studyMapping) => setStaged({ ...staged, studyMapping })}
            onVolumeMapping={(volumeMapping) => setStaged({ ...staged, volumeMapping })}
            onCancel={() => setStaged(null)}
            onApply={(result) => {
              if (staged.kind === "study") {
                dispatch({
                  type: "capacity/applyStudy",
                  study: result as StudyImportResult,
                  fileName: staged.fileName,
                  at: workingCase.meta.asOfDate,
                });
              } else {
                dispatch({
                  type: "capacity/applyVolumes",
                  demand: (result as VolumeImportResult).demand,
                  fileName: staged.fileName,
                  at: workingCase.meta.asOfDate,
                });
              }
              setStaged(null);
            }}
          />
        ) : null}

        {capacity && capacity.rows.length > 0 ? <WhatWasFound /> : null}

        <Note>
          The study says how long the work takes and who does it. The volume sheet says how
          much work there is. Neither carries working hours or utilisation, so roles arrive
          holding the documented default of{" "}
          {count(1880)} hours at 75% and are badged as defaults until you change them.
        </Note>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function UploadCard({
  label,
  hint,
  fileName,
  summary,
  busy,
  inputRef,
  onPick,
}: {
  label: string;
  hint: string;
  fileName?: string;
  summary: string | null;
  busy: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl bg-canvas p-5">
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">{label}</p>
        <p className="mt-1 text-xs text-muted">{hint}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv,.txt,.tsv"
        className="hidden"
        aria-label={`Upload ${label}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        className={primaryButtonClass}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Reading…" : summary ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
      </button>
      {summary ? (
        <p className="text-xs text-muted">
          <span className="font-semibold text-teal">Loaded</span>
          {fileName ? ` from ${fileName}` : ""} &middot; {summary}
        </p>
      ) : (
        <p className="text-xs text-outline">Nothing uploaded yet.</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function StagedPanel({
  staged,
  onSheet,
  onHeaderRow,
  onStudyMapping,
  onVolumeMapping,
  onCancel,
  onApply,
}: {
  staged: Staged;
  onSheet: (index: number) => void;
  onHeaderRow: (row: number) => void;
  onStudyMapping: (mapping: StudyColumnMapping) => void;
  onVolumeMapping: (mapping: VolumeMapping) => void;
  onCancel: () => void;
  onApply: (result: StudyImportResult | VolumeImportResult) => void;
}) {
  const sheet = staged.sheets[staged.sheetIndex]!;
  const header = sheet.rows[staged.headerRow] ?? [];

  const studyResult =
    staged.kind === "study" && staged.studyMapping
      ? convertStudyRows(sheet, staged.headerRow, staged.studyMapping)
      : null;
  const volumeResult =
    staged.kind === "volumes" && staged.volumeMapping
      ? convertVolumeRows(sheet, staged.headerRow, staged.volumeMapping)
      : null;

  const result = studyResult ?? volumeResult!;
  const dropped = result.issues.filter((i) => i.dropped);
  const flagged = result.issues.filter((i) => !i.dropped);

  const blocked =
    staged.kind === "study"
      ? studyResult!.rows.length === 0 || Object.keys(staged.studyMapping!.roles).length === 0
      : volumeResult!.demand.length === 0;

  const columnOptions = (
    <>
      <option value="">— not in this file —</option>
      {header.map((cell, i) => (
        <option key={i} value={i}>
          {cell.trim() === "" ? `Column ${i + 1}` : cell}
        </option>
      ))}
    </>
  );

  return (
    <div className="space-y-5 rounded-2xl bg-panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-bold text-ink">
          {staged.fileName}
          <span className="ml-2 font-normal text-muted">
            {staged.kind === "study" ? "process study" : "volumes"}
          </span>
        </p>
        <button type="button" className={ghostButtonClass} onClick={onCancel}>
          Cancel
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {staged.sheets.length > 1 ? (
          <label className="space-y-1.5">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
              Sheet
            </span>
            <select
              className={inputClass}
              value={staged.sheetIndex}
              onChange={(event) => onSheet(Number(event.target.value))}
            >
              {staged.sheets.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name} ({s.rows.length} rows)
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="space-y-1.5">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            Header row
          </span>
          <select
            className={inputClass}
            value={staged.headerRow}
            onChange={(event) => onHeaderRow(Number(event.target.value))}
          >
            {sheet.rows.slice(0, 30).map((row, i) => (
              <option key={i} value={i}>
                Row {i + 1}: {row.filter((c) => c.trim() !== "").slice(0, 3).join(" · ") || "(blank)"}
              </option>
            ))}
          </select>
        </label>

        {staged.kind === "study" && staged.studyMapping
          ? (
              [
                ["Handle time", "ahtMinutes"],
                ["Frequency", "frequency"],
                ["Stated minutes", "statedMinutes"],
                ["Rework minutes", "reworkMinutes"],
                ["Rework frequency", "reworkFrequency"],
                ["Line of business", "lob"],
                ["Region", "region"],
                ["Step ID", "stepId"],
              ] as const
            ).map(([label, field]) => (
              <label key={field} className="space-y-1.5">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  {label}
                </span>
                <select
                  className={inputClass}
                  value={staged.studyMapping![field] ?? ""}
                  onChange={(event) =>
                    onStudyMapping({
                      ...staged.studyMapping!,
                      [field]: event.target.value === "" ? null : Number(event.target.value),
                    })
                  }
                >
                  {columnOptions}
                </select>
              </label>
            ))
          : null}

        {staged.kind === "volumes" && staged.volumeMapping
          ? (
              [
                ["Line of business", "lob"],
                ["Transaction type", "transactionType"],
                ["Transactions received", "received"],
              ] as const
            ).map(([label, field]) => (
              <label key={field} className="space-y-1.5">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  {label}
                </span>
                <select
                  className={inputClass}
                  value={staged.volumeMapping![field] ?? ""}
                  onChange={(event) =>
                    onVolumeMapping({
                      ...staged.volumeMapping!,
                      [field]: event.target.value === "" ? null : Number(event.target.value),
                    })
                  }
                >
                  {columnOptions}
                </select>
              </label>
            ))
          : null}
      </div>

      {/* Discovered groups, read-only: these are the ones that vary in width. */}
      {studyResult ? (
        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <Discovered label="Taxonomy levels" values={staged.studyMapping!.pathLevels.map((c) => header[c] ?? `col ${c}`)} />
          <Discovered label="Role columns" values={Object.keys(staged.studyMapping!.roles)} />
          <Discovered label="Transaction types" values={Object.keys(staged.studyMapping!.transactionTypes)} />
          <Discovered label="Outcomes" values={Object.keys(staged.studyMapping!.statuses)} />
        </div>
      ) : null}

      {volumeResult ? (
        <Discovered label="Outcome columns" values={volumeResult.outcomes} />
      ) : null}

      {/* Preview — a wrong column shows here immediately; a row count would not. */}
      {studyResult && studyResult.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left">
                {["Step", "LOB", "Applies to", staged.studyMapping!.roles["current"] !== undefined ? "Current" : "Role", "Minutes / txn"].map(
                  (label) => (
                    <th
                      key={label}
                      className="px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline"
                    >
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {studyResult.rows.slice(0, 5).map((row) => (
                <tr key={row.id} className="border-t border-slate-200/70">
                  <td className="px-3 py-2 text-ink">{row.path[row.path.length - 1]}</td>
                  <td className="px-3 py-2 text-muted">{row.lob}</td>
                  <td className="px-3 py-2 text-muted">
                    {[...row.transactionTypes, ...row.statuses].join(", ") || "everything"}
                  </td>
                  <td className="px-3 py-2 text-muted">{Object.values(row.roles)[0] ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-ink">
                    {typeof row.ahtMinutes === "number" && typeof row.frequency === "number"
                      ? (row.frequency * row.ahtMinutes).toFixed(2)
                      : "n/a"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {studyResult.rows.length > 5 ? (
            <p className="mt-2 text-xs text-outline">and {studyResult.rows.length - 5} more</p>
          ) : null}
        </div>
      ) : null}

      {volumeResult && volumeResult.demand.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left">
                {["Line", "Type", "Received", "Outcome mix"].map((label) => (
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
              {volumeResult.demand.slice(0, 6).map((cell) => (
                <tr key={`${cell.lob}-${cell.transactionType}`} className="border-t border-slate-200/70">
                  <td className="px-3 py-2 text-ink">{cell.lob}</td>
                  <td className="px-3 py-2 text-muted">{cell.transactionType}</td>
                  <td className="px-3 py-2 tabular-nums text-ink">
                    {typeof cell.submissions === "number" ? count(cell.submissions) : "n/a"}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {cell.outcomeShares
                      ? Object.entries(cell.outcomeShares)
                          .map(([outcome, share]) => `${outcome} ${(share * 100).toFixed(0)}%`)
                          .join(" · ")
                      : "not split"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="space-y-2 text-xs">
        <p className="font-semibold text-ink">
          {studyResult
            ? `${studyResult.rows.length} of ${studyResult.considered} rows will import`
            : `${volumeResult!.demand.length} of ${volumeResult!.considered} rows will import`}
          .
        </p>
        {dropped.length > 0 ? (
          <ul className="space-y-1 text-muted">
            {dropped.slice(0, 6).map((issue, i) => (
              <li key={i}>
                <span className="font-semibold text-red-600">
                  {issue.sheetRow > 0 ? `Row ${issue.sheetRow}` : "Note"}
                </span>{" "}
                {issue.message}
              </li>
            ))}
            {dropped.length > 6 ? <li>and {dropped.length - 6} more skipped rows</li> : null}
          </ul>
        ) : null}
        {flagged.length > 0 ? (
          <ul className="space-y-1 text-muted">
            {flagged.slice(0, 6).map((issue, i) => (
              <li key={i}>
                <span className="font-semibold text-outline">
                  {issue.sheetRow > 0 ? `Row ${issue.sheetRow}` : "Note"}
                </span>{" "}
                {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {blocked ? (
        <p className="text-xs font-semibold text-red-600">
          {staged.kind === "study"
            ? "Nothing usable yet — the study needs a handle-time column and at least one role column."
            : "Nothing usable yet — check the line of business, transaction type and received columns."}
        </p>
      ) : null}

      <button type="button" className={primaryButtonClass} disabled={blocked} onClick={() => onApply(result)}>
        {staged.kind === "study"
          ? `Import ${studyResult!.rows.length} steps`
          : `Import ${volumeResult!.demand.length} volume cells`}
      </button>
    </div>
  );
}

function Discovered({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="rounded-2xl bg-white/70 px-3 py-2">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-outline">{label}</p>
      <p className="mt-0.5 text-ink">{values.length > 0 ? values.join(", ") : "none found"}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** What the import filled in, so the user can see the questionnaire was populated. */
function WhatWasFound() {
  const { workingCase, dispatch } = useCaseStore();
  const capacity = workingCase.capacity!;

  const kinds = capacity.roles.map((r) => ({
    role: r.role,
    kind: r.automated ? "automated" : r.unassigned ? "placeholder" : "staffed",
  }));

  return (
    <div className="space-y-4 rounded-2xl bg-canvas p-5">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
        Filled in from the upload
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            As-is assignment
          </span>
          <select
            className={inputClass}
            value={capacity.baseColumn}
            onChange={(event) =>
              dispatch({ type: "capacity/setColumn", which: "base", column: event.target.value })
            }
          >
            {capacity.roleColumns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            To-be assignment
          </span>
          <select
            className={inputClass}
            value={capacity.targetColumn}
            onChange={(event) =>
              dispatch({ type: "capacity/setColumn", which: "target", column: event.target.value })
            }
          >
            {capacity.roleColumns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {kinds.map(({ role, kind }) => (
          <span
            key={role}
            title={
              kind === "automated"
                ? "Read as an automation target — its work leaves human capacity. Change the role's hours if that is wrong."
                : kind === "placeholder"
                  ? "Read as a placeholder rather than a team — its work is reported as undecided scope and never staffed."
                  : "A staffed role."
            }
            className={
              kind === "staffed"
                ? "rounded-full bg-white px-3 py-1 font-semibold text-ink ring-1 ring-slate-200"
                : "rounded-full bg-panel px-3 py-1 font-semibold text-outline"
            }
          >
            {role}
            {kind !== "staffed" ? ` · ${kind}` : ""}
          </span>
        ))}
      </div>

      <p className="text-xs text-muted">
        {count(capacity.rows.length)} process steps &middot;{" "}
        {new Set(capacity.rows.map((r) => r.lob)).size} lines of business &middot;{" "}
        {new Set(capacity.rows.map((r) => r.region)).size} regions &middot;{" "}
        {fte(
          capacity.rows.reduce(
            (total, r) =>
              total +
              (typeof r.ahtMinutes === "number" && typeof r.frequency === "number"
                ? r.frequency * r.ahtMinutes
                : 0),
            0,
          ),
          1,
        )}{" "}
        minutes across the whole study, before any weighting
      </p>
    </div>
  );
}
