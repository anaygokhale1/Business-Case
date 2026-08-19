/**
 * Perf budget.
 *
 * WHAT THIS TEST IS FOR, AND WHAT IT IS NOT FOR
 *
 * The design decision it protects is that the engine runs synchronously on the
 * main thread, recomputing on every keystroke, with no web worker and no debounce.
 * That holds only while a full recompute stays inside one animation frame. A worker
 * would cost a structured clone of the case (~0.5-1 MB at 500 units) in and results
 * out per keystroke, which is more expensive than the computation it offloads.
 *
 * So this test exists to catch an ORDER-OF-MAGNITUDE regression — someone adding a
 * loop over all units inside a per-unit computation, turning O(n) into O(n^2). It is
 * deliberately not a 20%-drift detector: a tight threshold on a shared CI runner is
 * a flaky gate, and a flaky gate gets disabled. The measured figure is logged so a
 * gradual drift is still visible to a human reading the output.
 */

import { describe, expect, it } from "vitest";

import { portfolioTotals, rollup } from "./aggregate";
import { buildCtx } from "./drivers";
import { computeUnit } from "./identity";
import { computeManagers } from "./managers";
import { SCENARIO_KEYS } from "./types";
import { makeCase } from "./__fixtures__/cases";
import type { Unit } from "./types";

const UNIT_COUNT = 500;
const REGIONS = ["North America", "Europe", "APAC", "LATAM"];

const buildLargeCase = () => {
  const units: Unit[] = Array.from({ length: UNIT_COUNT }, (_, i) => ({
    id: `u-${i}`,
    name: `Operations Team ${i + 1}`,
    region: REGIONS[i % REGIONS.length]!,
    volume: 40_000 + (i % 37) * 1_500,
    // Roughly a third of units override each driver, which is the realistic mixed
    // state after a partly-populated register import.
    ...(i % 3 === 0 ? { utilisationPct: 0.6 + (i % 7) * 0.04 } : {}),
    ...(i % 5 === 0 ? { handleTimeMinutes: 12 + (i % 11) } : {}),
    headcount: { processor: 8 + (i % 23), lead: 1 + (i % 4) },
    cost: { processor: 72_000 + (i % 19) * 1_000, lead: 130_000 + (i % 13) * 2_000 },
  }));
  return makeCase(units);
};

const fullRecompute = (c: ReturnType<typeof buildLargeCase>) => {
  const ctx = buildCtx(c);
  let sink = 0;
  for (const scenario of SCENARIO_KEYS) {
    const results = c.units.map((u) => computeUnit(u, ctx));
    const totals = portfolioTotals(results);
    const byRegion = rollup(results, (r) => r.region);
    const reduction = totals.currentFrontLine * c.scenarios[scenario].hcReductionPct;
    const managers = computeManagers(
      totals.currentFrontLine - reduction,
      totals.currentManagers,
      c.globals.spanOfControl,
    );
    sink += totals.requiredFrontLine + managers.requiredManagers + byRegion.size;
  }
  return sink;
};

describe(`perf budget — ${UNIT_COUNT} units x ${SCENARIO_KEYS.length} scenarios`, () => {
  it("completes a full recompute well inside one animation frame", () => {
    const c = buildLargeCase();

    // Warm up so the measurement reflects optimised code, not the first-call path.
    for (let i = 0; i < 5; i += 1) fullRecompute(c);

    const samples: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const t0 = performance.now();
      fullRecompute(c);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;

    // eslint-disable-next-line no-console
    console.log(
      `  full recompute: median ${median.toFixed(2)}ms, best ${samples[0]!.toFixed(2)}ms, worst ${samples.at(-1)!.toFixed(2)}ms`,
    );

    // Generous against runner noise, tight enough that O(n^2) cannot pass: a nested
    // loop over 500 units would land in the hundreds of milliseconds.
    expect(median).toBeLessThan(25);
  });

  it("scales linearly, not quadratically, in unit count", () => {
    const all = buildLargeCase().units;
    const small = makeCase(all.slice(0, 100));
    const large = makeCase(all.slice(0, 400));

    // Take the MINIMUM across many runs, not the mean. Minimum is the standard
    // robust estimator for a microbenchmark: every source of noise here — GC
    // pauses, the OS scheduler, a CI runner's neighbours — only ever makes a run
    // slower, never faster, so the fastest run is the closest estimate of the real
    // cost. A mean of sub-millisecond timings is dominated by whichever GC pause
    // happened to land inside the window, which is what made an earlier version of
    // this assertion flaky.
    const perUnitCost = (c: ReturnType<typeof buildLargeCase>) => {
      for (let i = 0; i < 5; i += 1) fullRecompute(c);
      let best = Infinity;
      for (let i = 0; i < 15; i += 1) {
        const t0 = performance.now();
        fullRecompute(c);
        best = Math.min(best, performance.now() - t0);
      }
      return best / c.units.length;
    };

    const smallCost = perUnitCost(small);
    const largeCost = perUnitCost(large);
    const ratio = largeCost / smallCost;

    // eslint-disable-next-line no-console
    console.log(
      `  per-unit cost: 100 units ${(smallCost * 1000).toFixed(2)}us, 400 units ${(largeCost * 1000).toFixed(2)}us, ratio ${ratio.toFixed(2)}x`,
    );

    // Asserting on cost PER UNIT makes the expected value independent of size:
    // linear work gives a ratio near 1, quadratic work at 4x the rows gives 4.
    // A threshold of 3 sits well clear of both. Some rise above 1 is legitimate —
    // a larger working set spills out of cache — so this is not a drift detector,
    // it is a guard against someone adding a loop over all units inside a per-unit
    // computation.
    expect(ratio).toBeLessThan(3);
  });
});
