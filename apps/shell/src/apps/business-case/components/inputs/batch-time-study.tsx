"use client";

import { useCaseStore } from "../../hooks/use-case-store";
import type { AnswerStatus } from "../../lib/case-questions";
import { weightedAverageHandleTime } from "../../lib/engine/drivers";
import { ghostButtonClass, Note, NumberInput, Panel, primaryButtonClass, inputClass } from "./fields";

/** Batch 7 — Q21. Optional task-level study, from which handle time is derived. */
export function BatchTimeStudy({
  status,
  blurb,
}: {
  status: Record<string, AnswerStatus>;
  blurb: string;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const { timeStudy, globals } = workingCase;

  const weighted = weightedAverageHandleTime(timeStudy);
  const totalVolume = timeStudy.reduce((a, r) => a + r.volume, 0);
  const active = globals.handleTimeSource === "Time Study";

  return (
    <Panel
      title="Time study"
      blurb={blurb}
      aside={
        <div className="rounded-2xl bg-canvas px-4 py-3 text-right">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            Weighted average
          </p>
          <p className="text-xl font-extrabold tabular-nums text-ink">
            {Number.isNaN(weighted) ? "n/a" : `${weighted.toFixed(1)} min`}
          </p>
        </div>
      }
    >
      <div className="space-y-5">
        {!active ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-canvas px-4 py-3">
            <p className="text-xs text-muted">
              The handle-time source is set to <strong>Manual</strong>, so this study is recorded but
              not used.
            </p>
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() =>
                dispatch({ type: "globals/setChoice", patch: { handleTimeSource: "Time Study" } })
              }
            >
              Use the study instead
            </button>
          </div>
        ) : null}

        {timeStudy.length === 0 ? (
          <div className="rounded-2xl bg-canvas px-4 py-3 text-xs text-muted">
            No task rows yet. A study is optional — a single measured average works too — but it is
            the more defensible answer, because it shows which tasks the time is actually going into.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left">
                  <th className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Task type
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Minutes
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Annual volume
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Share of volume
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {timeStudy.map((row, index) => (
                  <tr key={index} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        className={`${inputClass} min-w-[12rem]`}
                        value={row.taskType}
                        placeholder="New claim intake"
                        aria-label={`Task type for row ${index + 1}`}
                        onChange={(event) =>
                          dispatch({
                            type: "timeStudy/set",
                            index,
                            patch: { taskType: event.target.value },
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <NumberInput
                        ariaLabel={`Minutes for row ${index + 1}`}
                        value={row.minutes}
                        onChange={(v) =>
                          dispatch({ type: "timeStudy/set", index, patch: { minutes: v ?? 0 } })
                        }
                        dp={2}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <NumberInput
                        ariaLabel={`Volume for row ${index + 1}`}
                        value={row.volume}
                        onChange={(v) =>
                          dispatch({ type: "timeStudy/set", index, patch: { volume: v ?? 0 } })
                        }
                        dp={0}
                      />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">
                      {totalVolume === 0 ? "—" : `${((row.volume / totalVolume) * 100).toFixed(1)}%`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className={ghostButtonClass}
                        onClick={() => dispatch({ type: "timeStudy/remove", index })}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => dispatch({ type: "timeStudy/add" })}
            disabled={timeStudy.length >= 20}
          >
            Add task row
          </button>
          <span className="text-xs text-outline">
            {timeStudy.length} of 20 rows{status["Q21"] === "n/a" ? " · not currently in use" : ""}
          </span>
        </div>

        <Note>
          The average is weighted by volume, not a plain average of the task times. A 44-minute task
          that happens rarely and an 18-minute task that happens constantly do not contribute equally,
          and a plain average would overstate the time the work actually takes. An empty study falls
          back to the manual figure rather than to zero, so switching the source cannot break a model
          that already had a number.
        </Note>
      </div>
    </Panel>
  );
}
