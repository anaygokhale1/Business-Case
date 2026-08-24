"use client";

/**
 * Uploading a volumes study broken down by region.
 *
 * Staged like every other import here: read, propose, review, apply. What this one adds
 * is a **match report** — which row of the register each region will land on, and what it
 * is replacing. Volume is the largest single driver in the model, so an import that put a
 * region's volume on the wrong row would move every downstream number without looking
 * wrong anywhere.
 *
 * The period control is the other thing worth its space. Nothing in a volume file says
 * whether it covers a month or a year, so it is asked rather than guessed.
 */

import { useRef, useState } from "react";

import { useCaseStore } from "../../hooks/use-case-store";
import { regionsOf, type VolumeApplyEntry } from "../../lib/case-reducer";
import { count, minutes } from "../../lib/format";
import { SENTINEL } from "../../lib/engine/types";
import { ImportError, readSheets, type Sheet } from "../../lib/import/tabular";
import {
  applicableEntries,
  convertRegionVolumeRows,
  detectRegionVolumeHeaderRow,
  planRegionVolumes,
  proposeRegionVolumeMapping,
  REGION_VOLUME_FIELDS,
  VOLUME_PERIODS,
  type RegionVolumeField,
  type RegionVolumeMapping,
  type RegionVolumeMatch,
  type RegionVolumePlanEntry,
} from "../../lib/import/region-volumes";
import { ghostButtonClass, inputClass, Note, primaryButtonClass } from "./fields";

const FIELD_LABEL: Record<RegionVolumeField, string> = {
  region: "Region",
  unitName: "Team",
  label: "Process / product",
  volume: "Volume",
  handleTimeMinutes: "Handle time (minutes)",
};

const OPTIONAL: RegionVolumeField[] = ["unitName", "label", "handleTimeMinutes"];

const MATCH_LABEL: Record<RegionVolumeMatch, string> = {
  update: "updates",
  "new-unit": "new row",
  "new-region": "new region",
  ambiguous: "needs a decision",
};

interface Staged {
  fileName: string;
  sheets: Sheet[];
  sheetIndex: number;
  headerRow: number;
  mapping: RegionVolumeMapping;
  periodKey: string;
  /** Region applied to rows whose region cell is blank. */
  defaultRegion: string | null;
  applyHandleTime: boolean;
}

export function VolumeImport({ onDone }: { onDone: () => void }) {
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
      const usable = (await readSheets(file)).filter((s) => s.rows.length > 1);
      if (usable.length === 0) {
        setError("That file has no usable rows.");
        setStaged(null);
        return;
      }
      const headerRow = detectRegionVolumeHeaderRow(usable[0]!.rows);
      setStaged({
        fileName: file.name,
        sheets: usable,
        sheetIndex: 0,
        headerRow,
        mapping: proposeRegionVolumeMapping(usable[0]!.rows[headerRow] ?? []),
        periodKey: "annual",
        // Only meaningful when there is exactly one region to fall back to; with several
        // the user has to say which, and with none the rows carry their own.
        defaultRegion: regions.length === 1 ? regions[0]! : null,
        applyHandleTime: true,
      });
    } catch (caught) {
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
            aria-label="Upload a regional volumes study"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pick(file);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {busy ? "Reading…" : "Upload a volumes study"}
          </button>
          <span className="text-xs text-outline">
            .xlsx or .csv &middot; one row per region, or per region and process
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
  const period = VOLUME_PERIODS.find((p) => p.key === staged.periodKey) ?? VOLUME_PERIODS[0]!;

  const result = convertRegionVolumeRows(sheet, staged.headerRow, staged.mapping, {
    defaultRegion: staged.defaultRegion,
    periodsPerYear: period.periodsPerYear,
  });
  const plan = planRegionVolumes(workingCase, result);
  const applicable = applicableEntries(plan);
  const ambiguous = plan.entries.filter((e) => e.match === "ambiguous");
  const hasTimes = result.targets.some((t) => t.handleTimeMinutes !== null);

  const dropped = result.issues.filter((i) => i.dropped);
  const flagged = result.issues.filter((i) => !i.dropped);

  const set = (patch: Partial<Staged>) => setStaged({ ...staged, ...patch });

  const chooseSheet = (index: number) => {
    const next = staged.sheets[index]!;
    const headerRow = detectRegionVolumeHeaderRow(next.rows);
    // Re-proposed for the new sheet. Carrying the previous sheet's column indices over
    // would map whichever columns happened to sit at those positions.
    set({ sheetIndex: index, headerRow, mapping: proposeRegionVolumeMapping(next.rows[headerRow] ?? []) });
  };

  const totalAnnual = applicable.reduce((t, e) => t + e.target.annualVolume, 0);

  return (
    <div className="space-y-5 rounded-2xl bg-canvas p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-bold text-ink">
          {staged.fileName}
          <span className="ml-2 font-normal text-muted">regional volumes</span>
        </p>
        <button type="button" className={ghostButtonClass} onClick={onDone}>
          Cancel
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {staged.sheets.length > 1 ? (
          <Select label="Sheet" value={staged.sheetIndex} onChange={(v) => chooseSheet(Number(v))}>
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
            set({ headerRow, mapping: proposeRegionVolumeMapping(sheet.rows[headerRow] ?? []) });
          }}
        >
          {sheet.rows.slice(0, 30).map((row, i) => (
            <option key={i} value={i}>
              Row {i + 1}: {row.filter((c) => c.trim() !== "").slice(0, 4).join(" · ") || "(blank)"}
            </option>
          ))}
        </Select>

        {REGION_VOLUME_FIELDS.map((field) => (
          <Select
            key={field}
            label={`${FIELD_LABEL[field]}${OPTIONAL.includes(field) ? " (optional)" : ""}`}
            value={staged.mapping[field] ?? ""}
            onChange={(v) =>
              set({ mapping: { ...staged.mapping, [field]: v === "" ? null : Number(v) } })
            }
          >
            <option value="">— not in this file —</option>
            {header.map((cell, i) => (
              <option key={i} value={i}>
                {cell.trim() === "" ? `Column ${i + 1}` : cell}
              </option>
            ))}
          </Select>
        ))}

        {/* The question the file cannot answer about itself. */}
        <Select
          label="Each volume covers"
          value={staged.periodKey}
          onChange={(v) => set({ periodKey: v })}
        >
          {VOLUME_PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
              {p.periodsPerYear === 1 ? "" : ` (×${p.periodsPerYear})`}
            </option>
          ))}
        </Select>

        <Select
          label="Rows with no region"
          value={staged.defaultRegion ?? ""}
          onChange={(v) => set({ defaultRegion: v === "" ? null : v })}
        >
          <option value="">Skip them</option>
          {regions.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </Select>
      </div>

      {staged.mapping.volume === null ? (
        <p className="text-xs font-semibold text-red-600">
          Choose the volume column before importing.
        </p>
      ) : null}

      {/* The match report. Which row each region lands on, and what it replaces. */}
      {plan.entries.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" aria-label="Where each region lands">
            <thead>
              <tr className="text-left">
                {[
                  "Region",
                  "Rows",
                  period.periodsPerYear === 1 ? "Volume" : `Per ${period.label.toLowerCase()}`,
                  "Annual",
                  "Handle time",
                  "Lands on",
                ].map((label) => (
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
              {plan.entries.map((entry) => (
                <MatchRow
                  key={`${entry.target.region}|${entry.target.unitName}`}
                  entry={entry}
                  showPeriod={period.periodsPerYear !== 1}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {hasTimes ? (
        <label className="flex items-start gap-2 text-xs text-muted">
          <input
            type="checkbox"
            className="mt-0.5 accent-ink"
            checked={staged.applyHandleTime}
            onChange={(event) => set({ applyHandleTime: event.target.checked })}
          />
          <span>
            <span className="font-semibold text-ink">
              Use the file&rsquo;s handle times as each row&rsquo;s own figure.
            </span>{" "}
            Volume-weighted within the region, not averaged across its rows. Untick to keep
            handle time coming from the global figure or the Time Study step.
          </span>
        </label>
      ) : null}

      <div className="space-y-2 text-xs">
        <p className="font-semibold text-ink">
          {applicable.length} of {plan.entries.length} region
          {plan.entries.length === 1 ? "" : "s"} will import
          {totalAnnual > 0 ? `, ${count(totalAnnual)} annual ${workingCase.meta.workloadUnitName.trim() || "units"} in total` : ""}
          . {result.targets.length} of {result.considered} rows were read.
        </p>

        {ambiguous.length > 0 ? (
          <p className="text-muted">
            <span className="font-semibold text-red-600">Needs a decision</span>{" "}
            {ambiguous.map((e) => e.target.region).join(", ")} — the case splits{" "}
            {ambiguous.length === 1 ? "this region" : "these regions"} into several rows and the
            file does not say which. Add a team column to the file, or import the rest and enter
            these by hand. Nothing is written for them.
          </p>
        ) : null}

        {plan.untouched.length > 0 ? (
          <p className="text-muted">
            <span className="font-semibold text-outline">Not in this file:</span>{" "}
            {plan.untouched.map((u) => u.name || u.id).join(", ")} — left exactly as{" "}
            {plan.untouched.length === 1 ? "it is" : "they are"}, not set to zero.
          </p>
        ) : null}

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

      <Note>
        Importing <strong>replaces</strong> the volume on each row it matches rather than adding
        to it, so a corrected file can be re-imported without doubling anything. The volume
        recorded is the annual figure — {period.label.toLowerCase()} multiplied by{" "}
        {period.periodsPerYear}.
      </Note>

      <button
        type="button"
        className={primaryButtonClass}
        disabled={staged.mapping.volume === null || applicable.length === 0}
        onClick={() => {
          const entries: VolumeApplyEntry[] = applicable.map((entry) => {
            const built: VolumeApplyEntry = {
              unitId: entry.unitId,
              region: entry.target.region,
              unitName: entry.target.unitName,
              annualVolume: entry.target.annualVolume,
            };
            // Set only when the file stated one, so "no times in this file" and "a time of
            // zero" stay distinguishable all the way to the reducer.
            if (entry.target.handleTimeMinutes !== null) {
              built.handleTimeMinutes = entry.target.handleTimeMinutes;
            }
            if (entry.renameTo !== undefined) built.renameTo = entry.renameTo;
            return built;
          });
          dispatch({ type: "volumes/apply", entries, applyHandleTime: staged.applyHandleTime });
          onDone();
        }}
      >
        Import {applicable.length} region{applicable.length === 1 ? "" : "s"}
      </button>
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

function MatchRow({
  entry,
  showPeriod,
}: {
  entry: RegionVolumePlanEntry;
  showPeriod: boolean;
}) {
  const { target, match } = entry;
  const ambiguous = match === "ambiguous";

  return (
    <tr className={`border-t border-slate-200/70 ${ambiguous ? "text-outline" : ""}`}>
      <td className="px-3 py-2">
        <span className={ambiguous ? "font-semibold" : "font-semibold text-ink"}>
          {target.region}
        </span>
        {target.unitName ? <span className="text-muted"> &middot; {target.unitName}</span> : null}
      </td>
      <td className="px-3 py-2 tabular-nums text-muted">{target.rows.length}</td>
      <td className="px-3 py-2 tabular-nums text-muted">
        {showPeriod ? count(target.periodVolume) : "—"}
      </td>
      <td className="px-3 py-2 tabular-nums text-ink">{count(target.annualVolume)}</td>
      <td className="px-3 py-2 tabular-nums text-muted">
        {target.handleTimeMinutes === null ? "—" : minutes(target.handleTimeMinutes)}
      </td>
      <td className="px-3 py-2 text-xs">
        <span
          className={
            match === "update"
              ? "font-semibold text-teal"
              : ambiguous
                ? "font-semibold text-red-600"
                : "font-semibold text-ink"
          }
        >
          {MATCH_LABEL[match]}
        </span>
        {match === "update" && entry.currentVolume !== null ? (
          <span className="text-muted">
            {" "}
            {entry.currentVolume === SENTINEL ? "a blank row" : `${count(entry.currentVolume)} today`}
            {/* The region's own row is being adopted as this team, so say so before it happens. */}
            {entry.renameTo ? `, renamed ${entry.renameTo}` : ""}
          </span>
        ) : null}
        {ambiguous ? <span className="text-muted"> {entry.candidates.join(" / ")}</span> : null}
      </td>
    </tr>
  );
}
