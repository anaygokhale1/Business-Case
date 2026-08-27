"use client";

/**
 * Current-state capacity by role against target-state capacity by role.
 *
 * The card answers one question — where does the work sit now, where does it sit after,
 * and what is the difference per role — and it states the boundary of that question
 * prominently, because the number people reach for next is a different one. This compares
 * *required* capacity in both states. It says nothing about how many people are in those
 * roles today, so a role showing a surplus is releasing requirement, not necessarily
 * releasing anybody.
 *
 * Chart decisions worth recording:
 *
 *  - Two paired bars on a **shared scale across every role**, so a role's size relative to
 *    the others is readable and not just its own before/after. Per-role scaling would make
 *    a 0.6-FTE role look like an 8-FTE one.
 *  - Series colours are brand-derived steps validated for colour-vision deficiency
 *    (deutan ΔE 16.9, normal 18.2, both above the ΔE 8 floor), and identity never rests on
 *    colour alone: there is a legend, the two bars keep a fixed order, and every value is
 *    printed in its own column.
 *  - The delta is *not* drawn in either series colour. Reusing the target hue for "surplus"
 *    would give one colour two meanings inside one card. It is text with a sign and a word,
 *    and only the direction that costs money is coloured.
 */

import { isMissing } from "../lib/engine/alg";
import { compareCapacity, type RoleDelta } from "../lib/engine/capacity";
import { reconcileTaskTypes } from "../lib/import/simple-capacity";
import type { CapacityBlock } from "../lib/engine/types";
import { SERIES_CURRENT, SERIES_TARGET } from "../lib/chart-palette";
import { count, fte } from "../lib/format";

// Shared with the Analysis tab, so blue means "today" on every screen. See
// `lib/chart-palette.ts` for why these are not the brand tokens.
const CURRENT_FILL = SERIES_CURRENT;
const TARGET_FILL = SERIES_TARGET;

const isStaffed = (role: RoleDelta) => !role.automated && !role.unassigned;

/** A role's larger requirement across the two states, missing read as nothing. */
const peak = (role: RoleDelta): number =>
  Math.max(isMissing(role.fromFte) ? 0 : role.fromFte, isMissing(role.toFte) ? 0 : role.toFte);

/** The shared bar scale: the largest requirement any role has in either state. */
const scaleOf = (roles: RoleDelta[]): number => roles.reduce((max, r) => Math.max(max, peak(r)), 0);

export function CapacityByRole({ capacity }: { capacity: CapacityBlock }) {
  const comparison = compareCapacity(capacity, capacity.baseColumn, capacity.targetColumn, {
    excludeRowIds: new Set(capacity.excludedRowIds),
  });

  const staffed = comparison.roles
    .filter(isStaffed)
    .sort((a, b) => peak(b) - peak(a) || a.role.localeCompare(b.role));
  const other = comparison.roles.filter((r) => !isStaffed(r));
  const scale = scaleOf(staffed);

  const sameColumn = capacity.baseColumn === capacity.targetColumn;
  const { withoutVolume } = reconcileTaskTypes(capacity.rows, capacity.demand);

  return (
    <section className="space-y-6 rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
      <header className="space-y-1">
        <h2 className="text-2xl font-extrabold text-ink">Capacity by role</h2>
        <p className="text-sm text-muted">
          Required FTE to carry the same work, as it is assigned today
          {sameColumn ? null : (
            <>
              {" "}
              (<span className="font-semibold text-ink">{capacity.baseColumn}</span>) and as
              assigned in the target state (
              <span className="font-semibold text-ink">{capacity.targetColumn}</span>)
            </>
          )}
          .
        </p>
      </header>

      {sameColumn ? (
        <p className="rounded-2xl bg-canvas px-4 py-3 text-xs text-muted">
          The as-is and to-be assignments are both{" "}
          <strong className="text-ink">{capacity.baseColumn}</strong>, so the two states are the
          same by construction and every delta below is zero. Choose a to-be assignment in the
          Role capacity step.
        </p>
      ) : null}

      <KpiStrip comparison={comparison} />

      <Legend />

      {staffed.length === 0 ? (
        <p className="rounded-2xl bg-canvas px-4 py-3 text-xs text-muted">
          No staffed role has any work against it yet. Upload a time study and a volumes study,
          then set working hours and utilisation per role.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" aria-label="Capacity by role">
            <thead>
              <tr className="text-left">
                {[
                  { label: "Role", align: "" },
                  { label: "Current vs target", align: "" },
                  { label: "Current", align: "text-right" },
                  { label: "Target", align: "text-right" },
                  { label: "Surplus / (deficit)", align: "text-right" },
                ].map(({ label, align }) => (
                  <th
                    key={label}
                    className={`px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline ${align}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staffed.map((role) => (
                <RoleRow key={role.role} role={role} scale={scale} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200">
                <td className="px-4 py-3 font-bold text-ink">Total</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right font-bold tabular-nums text-ink">
                  {fte(comparison.from.requiredFte, 2)}
                </td>
                <td className="px-4 py-3 text-right font-bold tabular-nums text-ink">
                  {fte(comparison.to.requiredFte, 2)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Delta value={-comparison.netFteChange} bold />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {other.length > 0 ? <NonStaffed roles={other} /> : null}

      <Coverage comparison={comparison} withoutVolume={withoutVolume} />

      <p className="rounded-2xl bg-canvas px-4 py-3 text-xs text-muted">
        <strong className="text-ink">This is required capacity against required capacity.</strong>{" "}
        Both columns are what the measured work needs, one under today&rsquo;s assignment and one
        under the target. Neither is actual headcount, so a surplus here is requirement released
        rather than people released — whether the operation is over- or under-staffed today is a
        separate question, and answering it needs actual FTE by role, which no time study carries.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function KpiStrip({ comparison }: { comparison: ReturnType<typeof compareCapacity> }) {
  const items = [
    { label: "Current state required", value: `${fte(comparison.from.requiredFte, 2)} FTE` },
    { label: "Target state required", value: `${fte(comparison.to.requiredFte, 2)} FTE` },
    {
      label: comparison.netFteChange <= 0 ? "Net capacity released" : "Net capacity needed",
      value: `${fte(Math.abs(comparison.netFteChange), 2)} FTE`,
    },
    {
      // The gross movement, reported next to the net because they answer different
      // questions and the net alone understates the size of the transition.
      label: "Moving between roles",
      value: `${fte(comparison.fteOut, 2)} out / ${fte(comparison.fteIn, 2)} in`,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl bg-canvas px-4 py-3">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            {item.label}
          </p>
          <p className="mt-1 text-xl font-extrabold tabular-nums text-ink">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-5 text-xs">
      {[
        { label: "Current state", fill: CURRENT_FILL },
        { label: "Target state", fill: TARGET_FILL },
      ].map((entry) => (
        <span key={entry.label} className="flex items-center gap-2 font-semibold text-muted">
          <span
            aria-hidden
            className="h-2.5 w-6 rounded-[2px]"
            style={{ backgroundColor: entry.fill }}
          />
          {entry.label}
        </span>
      ))}
    </div>
  );
}

function RoleRow({ role, scale }: { role: RoleDelta; scale: number }) {
  const surplus = isMissing(role.fromFte) || isMissing(role.toFte) ? NaN : role.fromFte - role.toFte;

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-3">
        <span className="font-semibold text-ink">{role.role}</span>
      </td>
      <td className="px-4 py-3">
        {/* Two thin bars, fixed order, 2px of surface between them doing the separating. */}
        <div className="flex min-w-[8rem] flex-col gap-[2px]">
          <Bar
            value={role.fromFte}
            scale={scale}
            fill={CURRENT_FILL}
            title={`${role.role} — current state: ${fte(role.fromFte, 2)} FTE from ${count(
              role.fromMinutes,
            )} minutes`}
          />
          <Bar
            value={role.toFte}
            scale={scale}
            fill={TARGET_FILL}
            title={`${role.role} — target state: ${fte(role.toFte, 2)} FTE from ${count(
              role.toMinutes,
            )} minutes`}
          />
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-ink">{fte(role.fromFte, 2)}</td>
      <td className="px-4 py-3 text-right tabular-nums text-ink">{fte(role.toFte, 2)}</td>
      <td className="px-4 py-3 text-right">
        <Delta value={surplus} />
      </td>
    </tr>
  );
}

/**
 * One bar.
 *
 * Square at the baseline, 4px rounded at the data end, capped well under the 24px
 * thickness limit because two of them share a table row.
 */
function Bar({
  value,
  scale,
  fill,
  title,
}: {
  value: number;
  scale: number;
  fill: string;
  title: string;
}) {
  if (isMissing(value) || scale <= 0) {
    return <span className="block h-2.5 text-[10px] leading-none text-outline">n/a</span>;
  }
  // A minimum sliver so a genuinely tiny requirement is still visibly present rather
  // than reading as nothing at all.
  const width = value <= 0 ? 0 : Math.max(1.5, (value / scale) * 100);

  return (
    <span className="block h-2.5 w-full rounded-[2px] bg-panel" title={title}>
      <span
        className="block h-2.5 rounded-r-[4px]"
        style={{ width: `${width}%`, backgroundColor: fill }}
      />
    </span>
  );
}

/**
 * The per-role difference.
 *
 * A signed number and a word, so the direction never depends on the colour. Only the
 * direction that costs money is coloured; the one that releases requirement stays in the
 * text token, because colouring both would put a third and fourth hue in the card and
 * collide with the series colours.
 */
function Delta({ value, bold = false }: { value: number; bold?: boolean }) {
  if (isMissing(value)) return <span className="text-xs text-outline">n/a</span>;

  const weight = bold ? "font-bold" : "font-semibold";
  if (Math.abs(value) < 0.005) {
    return <span className={`text-xs ${weight} text-outline`}>no change</span>;
  }

  const deficit = value < 0;
  return (
    <span className={`tabular-nums text-sm ${weight} ${deficit ? "text-red-600" : "text-ink"}`}>
      {deficit ? "−" : "+"}
      {fte(Math.abs(value), 2)}{" "}
      <span className="text-xs font-semibold">{deficit ? "needed" : "released"}</span>
    </span>
  );
}

function NonStaffed({ roles }: { roles: RoleDelta[] }) {
  return (
    <div className="space-y-2 rounded-2xl bg-canvas px-4 py-3">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
        Not staffed
      </p>
      <ul className="space-y-1 text-xs text-muted">
        {roles.map((role) => (
          <li key={role.role}>
            <span className="font-semibold text-ink">{role.role}</span>{" "}
            {role.automated ? "automation target" : "placeholder, not a team"} &middot; carries{" "}
            {count(role.toMinutes)} minutes in the target state against {count(role.fromMinutes)}{" "}
            today
            {role.automated
              ? " — those minutes leave human capacity, which is why no FTE is shown"
              : " — those minutes are undecided scope and are never staffed"}
            .
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the figures above do not cover. Stated, because a silent omission reads as zero. */
function Coverage({
  comparison,
  withoutVolume,
}: {
  comparison: ReturnType<typeof compareCapacity>;
  withoutVolume: string[];
}) {
  const notes: string[] = [];

  if (comparison.automatedMinutesGained > 0) {
    notes.push(
      `${count(comparison.automatedMinutesGained)} minutes leave human capacity between the two states.`,
    );
  }
  if (comparison.from.incompleteStepCount > 0) {
    notes.push(
      `${comparison.from.incompleteStepCount} task${comparison.from.incompleteStepCount === 1 ? "" : "s"} could not be computed because a handling time is missing, and contribute nothing to either column.`,
    );
  }
  if (comparison.from.orphanedStepCount > 0) {
    notes.push(
      `${comparison.from.orphanedStepCount} task${comparison.from.orphanedStepCount === 1 ? "" : "s"} reach no role at all in the current state, worth ${count(comparison.from.orphanedMinutes)} minutes.`,
    );
  }
  if (withoutVolume.length > 0) {
    notes.push(
      `${withoutVolume.join(", ")} ${withoutVolume.length === 1 ? "is measured" : "are measured"} in the study but ${withoutVolume.length === 1 ? "has" : "have"} no volume, so ${withoutVolume.length === 1 ? "its" : "their"} tasks add nothing to either column.`,
    );
  }

  if (notes.length === 0) return null;

  return (
    <ul className="space-y-1 text-xs text-muted">
      {notes.map((note, i) => (
        <li key={i}>
          <span className="font-semibold text-outline">Note</span> {note}
        </li>
      ))}
    </ul>
  );
}
