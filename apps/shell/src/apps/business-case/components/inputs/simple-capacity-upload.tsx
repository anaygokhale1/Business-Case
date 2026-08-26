"use client";

/**
 * The simple two-file capacity upload.
 *
 * Five columns of time study, two of volumes, and the join between them is Task Type. Both
 * files are staged before they are applied, for the same reason as everywhere else here: a
 * column read as the wrong thing produces a model that computes cleanly and answers a
 * different question, and nothing about the result looks wrong.
 *
 * The reconciliation panel is the part worth reading. Each file is internally consistent, so
 * neither can tell you that a studied task type has no volume against it — and that is the
 * failure that matters, because those tasks contribute nothing and the capacity figure comes
 * out complete-looking and too low.
 */

import { useRef, useState } from "react";

import { useCaseStore } from "../../hooks/use-case-store";
import { count, minutes as fmtMinutes } from "../../lib/format";
import { ImportError, readSheets, type Sheet } from "../../lib/import/tabular";
import type { StudyImportResult, StudyRowIssue } from "../../lib/import/process-study-map";
import {
  convertSimpleStudyRows,
  convertSimpleVolumeRows,
  defaultVolumeBasis,
  detectSimpleStudyHeaderRow,
  detectSimpleVolumeHeaderRow,
  proposeSimpleStudyMapping,
  proposeSimpleVolumeMapping,
  reconcileTaskTypes,
  SIMPLE_STUDY_FIELDS,
  SIMPLE_STUDY_LABEL,
  SIMPLE_VOLUME_FIELDS,
  SIMPLE_VOLUME_LABEL,
  type SimpleStudyMapping,
  type SimpleVolumeMapping,
  type SimpleVolumeResult,
  type VolumeBasis,
} from "../../lib/import/simple-capacity";
import { ghostButtonClass, inputClass, Note, primaryButtonClass } from "./fields";

type Kind = "study" | "volumes";

interface Staged {
  kind: Kind;
  fileName: string;
  sheets: Sheet[];
  sheetIndex: number;
  headerRow: number;
  studyMapping: SimpleStudyMapping | null;
  volumeMapping: SimpleVolumeMapping | null;
  basis: VolumeBasis;
  /** Whether a volumes file carrying roles and times should also become the study. */
  alsoStudy: boolean;
}

export function SimpleCapacityUpload() {
  const { workingCase, dispatch } = useCaseStore();
  const capacity = workingCase.capacity;

  const [staged, setStaged] = useState<Staged | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const studyInput = useRef<HTMLInputElement>(null);
  const volumeInput = useRef<HTMLInputElement>(null);

  const hasStudy = (capacity?.rows.length ?? 0) > 0;

  const stage = (kind: Kind, fileName: string, sheets: Sheet[], sheetIndex: number) => {
    const rows = sheets[sheetIndex]!.rows;
    const headerRow =
      kind === "study" ? detectSimpleStudyHeaderRow(rows) : detectSimpleVolumeHeaderRow(rows);
    const header = rows[headerRow] ?? [];
    const volumeMapping = kind === "volumes" ? proposeSimpleVolumeMapping(header) : null;
    setStaged({
      kind,
      fileName,
      sheets,
      sheetIndex,
      headerRow,
      studyMapping: kind === "study" ? proposeSimpleStudyMapping(header) : null,
      volumeMapping,
      basis: volumeMapping ? defaultVolumeBasis(volumeMapping) : "additive",
      // Offered by default only when there is no study to contradict. With one loaded,
      // the study is the authority on handle times and this file must not quietly
      // become a second source for them.
      alsoStudy: !hasStudy,
    });
  };

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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <UploadCard
          label="Time study"
          columns="Task / Action · Task Type · Current Role · Target Role · Average Handling Time"
          fileName={capacity?.source?.studyFile}
          summary={
            capacity && capacity.rows.length > 0
              ? `${count(capacity.rows.length)} tasks · ${capacity.roles.length} roles`
              : null
          }
          busy={busy === "study"}
          inputRef={studyInput}
          onPick={(file) => void pick("study", file)}
        />
        <UploadCard
          label="Volumes study"
          columns="Task Type · Volume"
          fileName={capacity?.source?.volumesFile}
          summary={
            capacity && capacity.demand.length > 0
              ? `${capacity.demand.length} task types · ${count(
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
          onChange={setStaged}
          onSheet={(index) => stage(staged.kind, staged.fileName, staged.sheets, index)}
          onCancel={() => setStaged(null)}
          onApply={(study, volumes) => {
            // Study first: `capacity/applyVolumes` reads the block the study created, so
            // the other order would file the volumes against an empty study.
            if (study) {
              dispatch({
                type: "capacity/applyStudy",
                study,
                fileName: staged.fileName,
                at: workingCase.meta.asOfDate,
              });
            }
            if (volumes) {
              dispatch({
                type: "capacity/applyVolumes",
                demand: volumes,
                fileName: staged.fileName,
                at: workingCase.meta.asOfDate,
              });
            }
            setStaged(null);
          }}
        />
      ) : null}

      {capacity && (capacity.rows.length > 0 || capacity.demand.length > 0) ? (
        <Reconciliation />
      ) : null}

      <Note>
        <strong>Task Type is the join.</strong> The study says how long each task takes and who
        does it now and in the target state; the volumes say how many transactions of each type
        there are. Required FTE per role follows in both states. Neither file carries working
        hours or utilisation, so every role arrives on the documented default of {count(1880)}{" "}
        hours at 75% and is badged as a default until you change it in the next step.
      </Note>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function UploadCard({
  label,
  columns,
  fileName,
  summary,
  busy,
  inputRef,
  onPick,
}: {
  label: string;
  columns: string;
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
        <p className="mt-1 text-xs text-muted">{columns}</p>
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
          <span className="font-semibold text-teal">In use</span>
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
  onChange,
  onSheet,
  onCancel,
  onApply,
}: {
  staged: Staged;
  onChange: (next: Staged) => void;
  onSheet: (index: number) => void;
  onCancel: () => void;
  onApply: (study: StudyImportResult | null, volumes: SimpleVolumeResult["demand"] | null) => void;
}) {
  const sheet = staged.sheets[staged.sheetIndex]!;
  const header = sheet.rows[staged.headerRow] ?? [];

  const studyResult =
    staged.kind === "study" && staged.studyMapping
      ? convertSimpleStudyRows(sheet, staged.headerRow, staged.studyMapping)
      : null;
  const volumeResult =
    staged.kind === "volumes" && staged.volumeMapping
      ? convertSimpleVolumeRows(sheet, staged.headerRow, staged.volumeMapping, staged.basis)
      : null;

  const issues: StudyRowIssue[] = studyResult?.issues ?? volumeResult?.issues ?? [];
  const dropped = issues.filter((i) => i.dropped);
  const flagged = issues.filter((i) => !i.dropped);

  const blocked = studyResult ? studyResult.rows.length === 0 : volumeResult!.demand.length === 0;

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

  const set = (patch: Partial<Staged>) => onChange({ ...staged, ...patch });

  return (
    <div className="space-y-5 rounded-2xl bg-panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-bold text-ink">
          {staged.fileName}
          <span className="ml-2 font-normal text-muted">
            {staged.kind === "study" ? "time study" : "volumes"}
          </span>
        </p>
        <button type="button" className={ghostButtonClass} onClick={onCancel}>
          Cancel
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {staged.sheets.length > 1 ? (
          <Select label="Sheet" value={staged.sheetIndex} onChange={(v) => onSheet(Number(v))}>
            {staged.sheets.map((s, i) => (
              <option key={s.name} value={i}>
                {s.name} ({s.rows.length} rows)
              </option>
            ))}
          </Select>
        ) : null}

        <Select
          label="Header row"
          value={staged.headerRow}
          onChange={(v) => {
            const headerRow = Number(v);
            const next = sheet.rows[headerRow] ?? [];
            // Re-proposed for the new header. Keeping the old column indices would map
            // whichever columns happen to sit at those positions.
            set({
              headerRow,
              studyMapping: staged.kind === "study" ? proposeSimpleStudyMapping(next) : null,
              volumeMapping: staged.kind === "volumes" ? proposeSimpleVolumeMapping(next) : null,
            });
          }}
        >
          {sheet.rows.slice(0, 30).map((row, i) => (
            <option key={i} value={i}>
              Row {i + 1}: {row.filter((c) => c.trim() !== "").slice(0, 4).join(" · ") || "(blank)"}
            </option>
          ))}
        </Select>

        {staged.kind === "study" && staged.studyMapping
          ? SIMPLE_STUDY_FIELDS.map((field) => (
              <Select
                key={field}
                label={SIMPLE_STUDY_LABEL[field]}
                value={staged.studyMapping![field] ?? ""}
                onChange={(v) =>
                  set({
                    studyMapping: {
                      ...staged.studyMapping!,
                      [field]: v === "" ? null : Number(v),
                    },
                  })
                }
              >
                {columnOptions}
              </Select>
            ))
          : null}

        {staged.kind === "volumes" && staged.volumeMapping
          ? SIMPLE_VOLUME_FIELDS.map((field) => (
              <Select
                key={field}
                label={SIMPLE_VOLUME_LABEL[field]}
                value={staged.volumeMapping![field] ?? ""}
                onChange={(v) => {
                  const volumeMapping = {
                    ...staged.volumeMapping!,
                    [field]: v === "" ? null : Number(v),
                  };
                  set({ volumeMapping, basis: defaultVolumeBasis(volumeMapping) });
                }}
              >
                {columnOptions}
              </Select>
            ))
          : null}

        {/* The reading the file cannot state about itself. */}
        {volumeResult ? (
          <Select
            label="Repeated task types"
            value={staged.basis}
            onChange={(v) => set({ basis: v as VolumeBasis })}
          >
            <option value="repeated">The same count, stated once per type</option>
            <option value="additive">Separate counts, to be added up</option>
          </Select>
        ) : null}
      </div>

      {volumeResult?.studyRows && volumeResult.studyRows.rows.length > 0 ? (
        <label className="flex items-start gap-2 text-xs text-muted">
          <input
            type="checkbox"
            className="mt-0.5 accent-ink"
            checked={staged.alsoStudy}
            onChange={(event) => set({ alsoStudy: event.target.checked })}
          />
          <span>
            <span className="font-semibold text-ink">
              This file also carries roles and handling times.
            </span>{" "}
            Use it as the time study as well, {volumeResult.studyRows.rows.length} tasks. Untick to
            take only the volumes from it and leave the study as it is.
          </span>
        </label>
      ) : null}

      {studyResult && studyResult.rows.length > 0 ? (
        <PreviewTable
          caption="What the study will import"
          head={["Task", "Type", "Current", "Target", "Minutes"]}
          rows={studyResult.rows.slice(0, 6).map((row) => [
            row.path[row.path.length - 1] ?? "",
            row.transactionTypes.join(", "),
            row.roles["current"] ?? "—",
            // Shown as the carry-forward it is, rather than as a blank the reader has to
            // interpret. A task with no stated target stays where it is.
            row.roles["target"] ?? `${row.roles["current"] ?? "—"} (unchanged)`,
            typeof row.ahtMinutes === "number" ? row.ahtMinutes.toFixed(2) : "n/a",
          ])}
          more={studyResult.rows.length - 6}
        />
      ) : null}

      {volumeResult && volumeResult.demand.length > 0 ? (
        <PreviewTable
          caption="What the volumes will import"
          head={["Task type", "Transactions"]}
          rows={volumeResult.demand.map((cell) => [
            cell.transactionType,
            typeof cell.submissions === "number" ? count(cell.submissions) : "n/a",
          ])}
          more={0}
        />
      ) : null}

      <div className="space-y-2 text-xs">
        <p className="font-semibold text-ink">
          {studyResult
            ? `${studyResult.rows.length} of ${studyResult.considered} rows will import.`
            : `${volumeResult!.demand.length} task types from ${volumeResult!.considered} rows.`}
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
            ? "Nothing usable yet — the study needs a task type, a handling time and at least one role column."
            : "Nothing usable yet — check the task type and volume columns."}
        </p>
      ) : null}

      <button
        type="button"
        className={primaryButtonClass}
        disabled={blocked}
        onClick={() =>
          onApply(
            studyResult ?? (staged.alsoStudy ? (volumeResult?.studyRows ?? null) : null),
            volumeResult?.demand ?? null,
          )
        }
      >
        {studyResult
          ? `Import ${studyResult.rows.length} tasks`
          : `Import ${volumeResult!.demand.length} task types`}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Where the two files disagree.
 *
 * Each file is internally consistent, so this can only be checked at the join — and the
 * first direction is the one that quietly costs capacity.
 */
function Reconciliation() {
  const { workingCase } = useCaseStore();
  const capacity = workingCase.capacity!;
  const { withoutVolume, withoutTasks } = reconcileTaskTypes(capacity.rows, capacity.demand);

  const taskTypes = new Set(capacity.rows.flatMap((r) => r.transactionTypes));
  const totalMinutes = capacity.rows.reduce(
    (total, r) => total + (typeof r.ahtMinutes === "number" ? r.ahtMinutes : 0),
    0,
  );

  return (
    <div className="space-y-3 rounded-2xl bg-canvas p-5">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
        How the two files line up
      </p>

      <div className="flex flex-wrap gap-2 text-xs">
        {capacity.roles.map((role) => (
          <span
            key={role.role}
            title={
              role.automated
                ? "Read as an automation target — its work leaves human capacity."
                : role.unassigned
                  ? "Read as a placeholder rather than a team — its work is reported as undecided."
                  : "A staffed role."
            }
            className={
              role.automated || role.unassigned
                ? "rounded-full bg-panel px-3 py-1 font-semibold text-outline"
                : "rounded-full bg-white px-3 py-1 font-semibold text-ink ring-1 ring-slate-200"
            }
          >
            {role.role}
            {role.automated ? " · automated" : role.unassigned ? " · placeholder" : ""}
          </span>
        ))}
      </div>

      <p className="text-xs text-muted">
        {count(capacity.rows.length)} tasks across {taskTypes.size} task type
        {taskTypes.size === 1 ? "" : "s"} &middot; {fmtMinutes(totalMinutes)} minutes measured in
        total, before any volume weighting
      </p>

      {withoutVolume.length > 0 ? (
        <p className="text-xs text-muted">
          <span className="font-semibold text-red-600">No volume:</span>{" "}
          {withoutVolume.join(", ")} — measured in the study but absent from the volumes file, so
          {withoutVolume.length === 1 ? " its" : " their"} tasks contribute nothing and the
          capacity figure is complete-looking and too low.
        </p>
      ) : null}

      {withoutTasks.length > 0 ? (
        <p className="text-xs text-muted">
          <span className="font-semibold text-outline">No tasks measured:</span>{" "}
          {withoutTasks.join(", ")} — {withoutTasks.length === 1 ? "this type has" : "these types have"}{" "}
          volume but nothing in the study, so the work is not sized at all.
        </p>
      ) : null}

      {withoutVolume.length === 0 && withoutTasks.length === 0 && capacity.demand.length > 0 ? (
        <p className="text-xs text-muted">
          <span className="font-semibold text-teal">Every task type is matched.</span> Each type in
          the study has a volume against it, and every volume has tasks measured against it.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5">
      <span className="block text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
        {label}
      </span>
      <select
        className={inputClass}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function PreviewTable({
  caption,
  head,
  rows,
  more,
}: {
  caption: string;
  head: string[];
  rows: string[][];
  more: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" aria-label={caption}>
        <thead>
          <tr className="text-left">
            {head.map((label) => (
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
          {rows.map((cells, i) => (
            <tr key={i} className="border-t border-slate-200/70">
              {cells.map((cell, j) => (
                <td
                  key={j}
                  className={
                    j === 0
                      ? "px-3 py-2 text-ink"
                      : j === cells.length - 1
                        ? "px-3 py-2 tabular-nums text-ink"
                        : "px-3 py-2 text-muted"
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 ? <p className="mt-2 text-xs text-outline">and {more} more</p> : null}
    </div>
  );
}
