"use client";

import { useState } from "react";

import { useCaseStore } from "../../hooks/use-case-store";
import type { AnswerStatus } from "../../lib/case-questions";
import { regionDriverSummary, regionsOf, type RegionDriverSummary } from "../../lib/case-reducer";
import type { InheritableDriver } from "../../lib/engine/drivers";
import { SENTINEL } from "../../lib/engine/types";
import { Field, ghostButtonClass, inputClass, Note, NumberInput, Panel, primaryButtonClass } from "./fields";

/**
 * Batch 2 — Q6 to Q8. Regions, and the productive-hours denominator per region.
 *
 * A region-level box writes through to every unit in that region. When two units in
 * one region disagree the box reads "mixed" rather than picking one, because the
 * alternative is a user flattening two teams' distinct figures with one keystroke
 * and never being told.
 */
export function BatchScope({
  status,
  blurb,
}: {
  status: Record<string, AnswerStatus>;
  blurb: string;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const [draft, setDraft] = useState("");
  const regions = regionsOf(workingCase);

  const add = () => {
    const name = draft.trim();
    if (name === "") return;
    dispatch({ type: "region/add", name });
    setDraft("");
  };

  return (
    <Panel title="Scope & regions" blurb={blurb}>
      <div className="space-y-6">
        <Field label="Add a region" questionId="Q6" status={status["Q6"]}>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              className={`${inputClass} max-w-xs`}
              value={draft}
              placeholder="North America"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className={primaryButtonClass} onClick={add} disabled={draft.trim() === ""}>
              Add region
            </button>
          </div>
        </Field>

        {regions.length === 0 ? (
          <Note>
            No regions yet. Each region you add starts as one row of the register carrying its own
            volume, headcount and cost. You can split a region into individual teams in the Units
            step — nothing here forces one row per region.
          </Note>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left">
                  <th className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Region
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Working hrs / yr <span className="text-slate-300">Q7</span>
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Utilisation <span className="text-slate-300">Q8</span>
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Effective hrs
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Rows
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {regions.map((region) => (
                  <RegionRow key={region} region={region} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Note>
          Effective productive hours = working hours &times; utilisation. This is the denominator of
          every required-FTE figure, so a region on a 1,720-hour year is sized against 1,720 hours
          and not against a portfolio average. Leave a box empty to inherit the global assumption of{" "}
          {workingCase.globals.workingHoursPerYear.toLocaleString("en-US")} hours at{" "}
          {(workingCase.globals.utilisationPct * 100).toFixed(0)}%.
        </Note>
      </div>
    </Panel>
  );
}

const summaryPlaceholder = (summary: RegionDriverSummary, globalValue: string): string => {
  switch (summary.kind) {
    case "mixed":
      return "mixed";
    case "missing":
      return SENTINEL;
    case "inherited":
      return globalValue;
    case "uniform":
      return "";
  }
};

function RegionRow({ region }: { region: string }) {
  const { workingCase, dispatch } = useCaseStore();
  const [renaming, setRenaming] = useState<string | null>(null);

  const units = workingCase.units.filter((u) => u.region === region);
  const hours = regionDriverSummary(workingCase, region, "workingHoursPerYear");
  const util = regionDriverSummary(workingCase, region, "utilisationPct");

  const set = (driver: InheritableDriver, value: number | null) =>
    dispatch({ type: "region/setDriver", region, driver, value });

  // Shown only when the whole region agrees. "mixed" deliberately shows nothing, so
  // the effective-hours column below reads n/a rather than a made-up product.
  const hoursValue = hours.kind === "uniform" ? hours.value : workingCase.globals.workingHoursPerYear;
  const utilValue = util.kind === "uniform" ? util.value : workingCase.globals.utilisationPct;
  const effective =
    hours.kind === "mixed" || util.kind === "mixed" || hours.kind === "missing" || util.kind === "missing"
      ? null
      : Math.round(hoursValue * utilValue);

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-3">
        {renaming === null ? (
          <button
            type="button"
            className="font-semibold text-ink transition hover:text-teal"
            onClick={() => setRenaming(region)}
            title="Rename"
          >
            {region}
          </button>
        ) : (
          <input
            autoFocus
            type="text"
            className={`${inputClass} max-w-[14rem]`}
            value={renaming}
            onChange={(event) => setRenaming(event.target.value)}
            onBlur={() => {
              dispatch({ type: "region/rename", from: region, to: renaming });
              setRenaming(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setRenaming(null);
            }}
          />
        )}
      </td>
      <td className="px-4 py-3">
        <NumberInput
          ariaLabel={`${region} working hours per year`}
          value={hours.kind === "uniform" ? hours.value : null}
          onChange={(v) => set("workingHoursPerYear", v)}
          dp={0}
          placeholder={summaryPlaceholder(hours, String(workingCase.globals.workingHoursPerYear))}
        />
      </td>
      <td className="px-4 py-3">
        <NumberInput
          ariaLabel={`${region} utilisation percent`}
          value={util.kind === "uniform" ? util.value : null}
          onChange={(v) => set("utilisationPct", v)}
          scale={100}
          suffix="%"
          placeholder={summaryPlaceholder(util, (workingCase.globals.utilisationPct * 100).toFixed(0))}
        />
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted">
        {effective === null ? "n/a" : effective.toLocaleString("en-US")}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted">{units.length}</td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          className={ghostButtonClass}
          onClick={() => dispatch({ type: "region/remove", name: region })}
          title={`Remove ${region} and its ${units.length} row(s)`}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}
