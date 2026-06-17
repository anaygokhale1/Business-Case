# Business Case Builder — Claude Skill

A Claude Code skill that builds a **complete, senior-leadership-ready business case workbook** (.xlsx) for workforce optimization, headcount reduction, and cost reduction initiatives.

---

## What It Does

When invoked, this skill guides you through a structured input collection process and then generates a fully formula-driven, 8-tab Excel workbook. Every output traces back to a single Assumptions tab — no hardcoded computed values, no static reports.

## When to Use It

Trigger this skill when you need to:

- Build a workforce optimization or headcount reduction business case
- Model FTE right-sizing, capacity management, or management layer optimization
- Run scenario analysis (Low / Base / High) for cost reduction initiatives
- Produce a payback period analysis or phased exit schedule
- Model severance costs and implementation ROI

## How to Invoke

In Claude Code, type:

```
/business-case-builder
```

The skill will ask you **one question at a time** across 8 input batches before building anything. It never builds from incomplete inputs.

---

## The Workbook

### 8 Tabs

| Tab | Color | Purpose |
|-----|-------|---------|
| Assumptions | Green | Single source of truth — all inputs live here |
| Time Study | Teal | Optional volume-weighted handle time analysis |
| Calculations | Blue | All arithmetic; zero user inputs |
| Phasing | Purple | 36-month cash flow grid and payback KPI |
| Scenario Analysis | Orange | Low / Base / High side-by-side comparison |
| Sensitivity | Yellow | Two what-if grids (capacity surplus and payback) |
| Summary | Navy | Executive snapshot — formula links only |
| Help | Silver | Tab navigator, cell color legend, FAQ |

### Key Features

- **Scenario-aware** — a single dropdown (Low / Base / High) on the Assumptions tab drives every output across all tabs via `CHOOSE(MATCH(...))` formulas
- **Handle time toggle** — choose between a manual entry or a volume-weighted average calculated in the Time Study tab
- **Phased exits** — 36-month cash flow grid with configurable notice period, number of phases, and exit profiles (Front-loaded / Even / Back-loaded)
- **Sensitivity grids** — 5×5 direct-formula grids for FTE capacity surplus and payback months; base case highlighted in the exact center cell
- **Color-coded audit system** — every cell follows a strict color legend so reviewers instantly know what is an input, a formula, or a cross-sheet link

### Cell Color System

| Font color | Meaning |
|------------|---------|
| Blue | Hardcoded input — safe to edit |
| Black | Formula — do not edit |
| Green | Cross-sheet link — do not edit |

| Fill color | Meaning |
|------------|---------|
| Yellow | Key assumption requiring attention |
| Gray | Read-only formula inside an input table |
| Light blue | Informational reference linked from another tab |

---

## Input Collection (35 Questions, 8 Batches)

The skill asks one question at a time and will not build until all 35 inputs are confirmed.

| Batch | Topic | Questions |
|-------|-------|-----------|
| 1 | Company & Initiative | Company name, industry, core problem, initiative title, prepared by |
| 2 | Geographic Scope | Regions, working hours/year, utilization % |
| 3 | Headcount & Roles | Role titles, FTE counts per region, span-of-control target |
| 4 | Compensation | All-in annual cost per role per region |
| 5 | Workload & Demand | Volume unit, annual volume, handle time source and value, demand growth |
| 6 | Scenario Parameters | HC reduction % for Low/Base/High, severance weeks, time horizon |
| 7 | Implementation Costs | Severance only vs. severance + consulting |
| 8 | Phasing & Timing | Notice period, number of phases, months per phase, exit profile |

Industry benchmark defaults are available for compensation if you don't have exact figures.

---

## Output

A single `.xlsx` file named:

```
{CompanyName}_{InitiativeTitle}_BusinessCase_{YYYYMMDD}.xlsx
```

Delivered with a 4-bullet post-delivery summary:
- Total FTE reduction (Base scenario)
- Net Year 1 benefit
- Cash payback month
- 3-year cumulative net cash flow

---

## File

| File | Description |
|------|-------------|
| `business-case-builder_SKILL.md` | Full skill definition — input collection logic, tab-by-tab build spec, quality checks, formatting standards, and anti-hallucination checklist |
