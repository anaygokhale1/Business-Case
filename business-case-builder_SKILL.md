---
name: business-case-builder
description: >
  Build a complete, professional, fully formula-driven Excel business case workbook for workforce
  optimization, capacity management, headcount reduction, FTE right-sizing, cost reduction, or
  productivity improvement initiatives. Use this skill whenever the user asks to build a business
  case, workforce optimization model, headcount reduction workbook, capacity right-sizing model,
  FTE analysis, initiative ROI model, or severance cost model. Also trigger when the user mentions
  payback period analysis, scenario analysis for headcount, management layer optimization, span-of-
  control modeling, or phased exit scheduling — even if they don't use the phrase "business case."
  The output is always a fully formula-driven, 8-tab .xlsx workbook. NEVER build anything before
  completing all 8 input batches.
---

# Business Case Builder — Excel Workbook Skill

## Overview

This skill builds a **complete, senior-leadership-ready business case workbook** (.xlsx) for
workforce optimization and cost reduction initiatives. The workbook is:

- **Fully formula-driven** — zero hardcoded computed values outside the Assumptions tab
- **Auditable** — every output traces back to a single Assumptions source of truth
- **Scenario-aware** — Low / Base / High wired to a single dropdown driving all outputs via CHOOSE/MATCH
- **Presentation-ready** — strict color-coded cell system, charts, and KPI callouts
- **8 tabs:** Assumptions · Time Study · Calculations · Phasing · Scenario Analysis · Sensitivity · Summary · Help

---

## MASTER CELL COLOR LEGEND

This system applies to every cell in every tab without exception.
It is the single reference for all formatting decisions. Claude must never deviate from it.

### Font Colors (text color inside the cell)

| Font Color | Hex | Meaning | Who changes it |
|------------|-----|---------|---------------|
| **Blue** | `#0000FF` | Hardcoded input — a value the user types in | User |
| **Black** | `#000000` | Formula — a calculated value, never edited directly | Nobody |
| **Green** | `#375623` | Cross-sheet link — a formula that pulls from another tab | Nobody |

### Fill / Background Colors

| Fill Color | Hex | Meaning | Applied to |
|------------|-----|---------|-----------|
| **Yellow** | `#FFFF00` | Key assumption needing attention; also active scenario column and sensitivity base cell | Specific input cells, scenario column header, grid center cell |
| **Gray** | `#D9D9D9` | Read-only formula cell inside an input table — do not edit | Auto-calculated columns (e.g. Volume Weight %, Effective Hrs) |
| **Light blue** | `#DEEAF1` | Informational / reference cell — links from another tab but shown for context | Status blocks, Summary formula links |
| **White** | `#FFFFFF` | Standard — all other cells | Default |

### Section Header Colors (by tab)

| Tab | Header fill | Header font |
|-----|------------|------------|
| Assumptions | `#70AD47` Green | White, bold |
| Time Study | `#00B0B9` Teal | White, bold |
| Calculations | `#4472C4` Blue | White, bold |
| Phasing | `#7030A0` Purple | White, bold |
| Scenario Analysis | `#ED7D31` Orange | White, bold |
| Sensitivity | `#FFC000` Yellow | Black, bold |
| Summary | `#1F3864` Navy | White, bold |
| Help | `#808080` Silver | White, bold |

### Special / Conditional Colors

| Color | Hex | Applied to | Trigger |
|-------|-----|-----------|---------|
| Red fill | `#C00000` | Phase weight sum-check cell | When sum ≠ 100% |
| Green fill | `#E2EFDA` | FTE reduction rows in Calculations | When reduction > 0 |
| Red font | `#C00000` | Payback value cells | When payback > 24 months |
| Yellow fill | `#FFFF00` | Active scenario column header (Scenario tab) | Matches Assumptions dropdown |
| Yellow fill | `#FFFF00` | Center cell in both Sensitivity grids | Always (base case marker) |

### Number Formats (apply exactly — no variation)

| Data type | Format string | Example display |
|-----------|--------------|----------------|
| Currency | `$#,##0;($#,##0);-` | $85,000 / ($12,000) / - |
| Percentage | `0.0%` | 12.5% |
| FTE counts | `#,##0` | 1,250 |
| Payback months | `0.0` | 14.2 |
| Multiples | `0.0"x"` | 2.3x |
| Month axis (Phasing row 3) | `"M"0` | M1, M2 ... M36 |

---

## CRITICAL GUARDRAILS — READ BEFORE DOING ANYTHING

| # | Rule | What breaks if violated |
|---|------|------------------------|
| G1 | **Never build before all 8 input batches are answered** | Workbook contains wrong or placeholder data |
| G2 | **Never hardcode computed values** — every derived number must be an Excel formula | Workbook is a static report, not a live model |
| G3 | **Never hardcode company / role / region names outside Assumptions tab** | Model breaks when inputs change |
| G4 | **Blended salary = SUMPRODUCT(FTEs × salary) / total FTEs** — never use savings-per-FTE as a proxy | Severance and phasing cash flows are materially wrong |
| G5 | **Manager reduction = CEILING(remaining staff / span ratio, 1)** — always round up | Fractional managers; model shows impossible headcount |
| G6 | **Month axis in Phasing must be numeric integers 1–36, NOT text like "M1"** | IF comparisons silently return 0; phasing never fires |
| G7 | **Never use Excel's What-If Data Table (=TABLE()) for Sensitivity** — use direct per-cell formulas | Cannot be written by openpyxl; causes errors |
| G8 | **Scenario dropdown must drive Calculations via CHOOSE(MATCH(...))** | Dropdown changes nothing; scenarios are broken |
| G9 | **Phase weights must sum to 100%; red conditional format if not** | Exit totals are wrong; payback is wrong |
| G10 | **Sensitivity grids must have an odd number of rows and columns** — base case in exact center cell | Center cell is off; base case highlight misleads |
| G11 | **Handle time must route via IF(toggle="Time Study", 'Time Study'!weighted_avg, manual_value)** | Time Study tab has no effect; toggle is decorative |
| G12 | **Run recalc.py after building and fix ALL errors before presenting** | Formulas render as strings; #REF! and #DIV/0! survive |
| G13 | **Never skip a batch** — if user says "use defaults," populate benchmark values, show them, confirm | Missing inputs = missing model sections |
| G13a | **Ask ONE question at a time** during input collection — never present a whole batch or multiple questions in one turn | User is overwhelmed; answers get skipped or merged |
| G13b | **Use the `ask_user_input_v0` pop-up selector for every question with defined choices**; reserve plain-text asks for free-text values only | Choices typed out as prose are slower and error-prone on mobile |
| G14 | **Notes/explanation column on the far right of every tab** | Model is unauditable by a third party |
| G15 | **Freeze top 3 rows on every tab; also freeze column A on Phasing** | Headers scroll away; model is hard to navigate |
| G16 | **Apply the Master Cell Color Legend to every cell without exception** | Auditors and reviewers can't distinguish inputs from formulas |
| G17 | **Help tab must contain the complete Master Cell Color Legend as a formatted table** | Users editing the model don't know which cells are safe to change |

---

## Step 1 — Input Collection (MANDATORY — All 8 Batches)

**Ask ONE question at a time — never present a batch or multiple questions in a single turn.**
Walk through the questions below in order (Q1 → Q35). After each answer, ask the next question.
The batch groupings below are for organization only; they are NOT a license to ask multiple
questions at once.

**Use the `ask_user_input_v0` pop-up selector for every question that has defined choices**
(industry, core problem, handle time source, severance timing, exit profile, yes/no toggles,
"use default vs. enter a value", etc.). Present the options as tappable buttons rather than asking
the user to type. For genuinely free-text questions (company name, role titles, region names,
specific dollar/number values), ask in plain chat — but still only one at a time. When a question
has a benchmark default, include a "Use default" option as one of the buttons.

**Build nothing until all 35 questions are answered and the full input set is confirmed.**
If the user says "use defaults," populate the benchmark values below, present them, and wait for
written confirmation before building.

---

### Batch 1 — Company & Initiative

| Q# | Question | Notes / Default |
|----|----------|-----------------|
| Q1 | Company name? | |
| Q2 | Industry / sector? | Insurance · Financial Services · Healthcare · Technology/SaaS · Retail · Manufacturing · Other |
| Q3 | Core problem being solved? | Cost Reduction · Productivity · Capacity Right-sizing · Mgmt layers too deep · Overcapacity |
| Q4 | Initiative title? | e.g., "Workforce Optimization Program" |
| Q5 | Prepared by and model date? | Goes on Assumptions cover block |

---

### Batch 2 — Geographic Scope

| Q# | Question | Default |
|----|----------|---------|
| Q6 | Regions in scope? (name each) | e.g., North America, Europe |
| Q7 | Working hours per year per region? | **1,880 hrs/yr** |
| Q8 | Utilization % per region? | **75%** |

Effective productive hours = working hours × utilization % → formula cell (black font, gray fill if inside a table).

---

### Batch 3 — Headcount & Roles

| Q# | Question | Notes |
|----|----------|-------|
| Q9 | Front-line role title? | e.g., Claims Processor |
| Q10 | Manager role title? | e.g., Team Lead |
| Q11 | Front-line FTE count per region? | One figure per region |
| Q12 | Manager FTE count per region? | One figure per region |
| Q13 | Target manager-to-staff span-of-control ratio? | e.g., 1:8 means one manager per 8 staff |
| Q14 | Additional role tiers? | e.g., Senior Analyst — add rows if yes |

---

### Batch 4 — Compensation

| Q# | Question | Notes |
|----|----------|-------|
| Q15 | All-in annual cost per front-line FTE × region (USD)? | Salary + benefits + employer taxes |
| Q16 | All-in annual cost per manager FTE × region (USD)? | Same basis |

**Industry benchmark defaults (all-in, USD):**

| Industry | Front-line | Manager |
|----------|-----------|---------|
| Insurance / Reinsurance | $85,000 | $140,000 |
| Financial Services | $95,000 | $155,000 |
| Healthcare | $75,000 | $125,000 |
| Technology / SaaS | $110,000 | $170,000 |
| Manufacturing | $65,000 | $110,000 |
| Retail / E-commerce | $55,000 | $95,000 |

---

### Batch 5 — Workload & Demand

| Q# | Question | Notes |
|----|----------|-------|
| Q17 | Primary workload unit name? | e.g., "Transactions Processed", "Claims" |
| Q18 | Annual volume per region? | |
| Q19 | Handle time source? | **Manual entry** (single value) OR **Time Study** (Tab 2 weighted avg) |
| Q20 | Average handle time per unit (minutes)? | Used when source = Manual; also the fallback |
| Q21 | If Time Study: provide task types, transaction times, and volumes | Up to 20 task rows; Claude populates Tab 2 |
| Q22 | Volume uplift % over the forecast horizon? | Demand growth; 0 if none |

---

### Batch 6 — Scenario Parameters & Reduction Targets

| Q# | Question | Default |
|----|----------|---------|
| Q23 | HC reduction % — Low scenario? | e.g., 8% |
| Q24 | HC reduction % — Base scenario? | e.g., 12% |
| Q25 | HC reduction % — High scenario? | e.g., 18% |
| Q26 | Severance weeks per FTE? | **8 weeks** |
| Q27 | Severance timing? | Lump sum at exit · Spread over notice period |
| Q28 | Time horizon (years)? | **3 years** |

---

### Batch 7 — Implementation Costs

| Q# | Question | Notes |
|----|----------|-------|
| Q29 | Implementation costs to model? | Severance only · Severance + consulting/transition · None |
| Q30 | If consulting costs included: total $ amount? | One-time; entered in Assumptions Section G |

---

### Batch 8 — Phasing & Timing

| Q# | Question | Default |
|----|----------|---------|
| Q31 | Notice period before first exits (months)? | **2 months** |
| Q32 | Number of exit phases? | **4 phases** |
| Q33 | Months per phase? | **3 months** |
| Q34 | Exit profile? | Front-loaded · Even · Back-loaded |
| Q35 | Phase weight table? | Front-loaded: 50/30/15/5 · Even: 25/25/25/25 · Back-loaded: 5/15/30/50 |

---

## Step 2 — Build the Workbook

Build **one tab at a time**. Verify formulas are error-free before moving to the next.
Use openpyxl for all construction. Run `scripts/recalc.py` after the complete build.

---

### Tab Order, Names & Colors

Build in this sequence (Summary last — it references all other tabs):

| Build order | Tab position | Tab Name | Tab color (hex) | Purpose |
|-------------|-------------|----------|-----------------|---------|
| 1 | 1 | Assumptions | `#70AD47` Green | Single source of truth — all inputs |
| 2 | 2 | Time Study | `#00B0B9` Teal | Optional handle time analysis |
| 3 | 3 | Calculations | `#4472C4` Blue | All arithmetic; no user inputs |
| 4 | 4 | Phasing | `#7030A0` Purple | 36-month cash flow; payback KPI |
| 5 | 5 | Scenario Analysis | `#ED7D31` Orange | Low / Base / High side-by-side |
| 6 | 6 | Sensitivity | `#FFC000` Yellow | Two direct-formula grids |
| 7 | 7 | Summary | `#1F3864` Navy | Executive snapshot; formula links only |
| 8 | 8 | Help | `#808080` Silver | Navigator, color legend, FAQ |

---

### TAB 1: Assumptions (Green — `#70AD47`)

Single source of truth. All 8 input batches land here. Sections A–H.

**Cell color rules on this tab:**
- Blue font — all hardcoded inputs (user-editable)
- Yellow fill — cells that need attention (key drivers like HC%, severance weeks, span ratio)
- Gray fill + black font — formula cells embedded in input tables (e.g., Effective Hours, totals)
- Green font — any cell linking from another tab (e.g., Status block mirroring Time Study)

```
SECTION A — Company & Initiative
  B5:  Company name                    [Blue font]
  B6:  Industry                        [Blue font]
  B7:  Core problem                    [Blue font]
  B8:  Initiative title                [Blue font]
  B9:  Prepared by                     [Blue font]
  B10: Model date                      [Blue font]

SECTION B — Geographic Scope
  Table columns: Region | Working Hrs/Yr | Utilization % | Effective Productive Hrs
  Region, Working Hrs/Yr, Utilization %  → Blue font (user input)
  Effective Productive Hrs               → Black font, Gray fill (formula: hrs × utilization)
  Grand total row                        → Black font, Gray fill (SUM formula)

SECTION C — Headcount
  Table columns: Region | Front-line FTEs | Manager FTEs | Total FTEs
  Front-line FTEs, Manager FTEs          → Blue font, Yellow fill (key driver)
  Total FTEs                             → Black font, Gray fill (SUM formula)
  Grand total row                        → Black font, Gray fill

SECTION D — Compensation
  Table columns: Region | Front-line All-in Cost | Manager All-in Cost
  All cost inputs                        → Blue font, Yellow fill (key driver)
  Blended weighted average row:
    Staff blended  = SUMPRODUCT(front_line_FTEs, front_line_costs) / SUM(front_line_FTEs)
    Manager blended = SUMPRODUCT(manager_FTEs, manager_costs) / SUM(manager_FTEs)
                                         → Black font, Gray fill

SECTION E — Workload & Demand
  Handle Time Source toggle              → Blue font, Yellow fill
    Dropdown: [Manual | Time Study]
  Manual handle time (minutes)           → Blue font, Yellow fill
  Active handle time (formula):
    =IF(toggle="Time Study",'Time Study'!weighted_avg_cell,manual_handle_time_cell)
                                         → Black font, Gray fill
  Table columns: Region | Annual Volume | Handle Time (active) | Uplift % | Required FTEs | Surplus/Deficit
  Annual Volume, Uplift %               → Blue font
  Handle Time (active), Required FTEs,
  Surplus/Deficit                       → Black font, Gray fill
  Required FTEs = (volume × handle_time_min × (1 + uplift)) / (effective_hrs × 60)
  Capacity surplus = current FTEs − required FTEs

SECTION F — Scenario Parameters
  Scenario selector dropdown [Low|Base|High] → Blue font, Yellow fill  ← drives all Calculations
  Low HC reduction %                     → Blue font, Yellow fill
  Base HC reduction %                    → Blue font, Yellow fill
  High HC reduction %                    → Blue font, Yellow fill
  Severance weeks                        → Blue font, Yellow fill
  Severance timing dropdown [Lump sum at exit|Spread over notice] → Blue font
  Time horizon (years)                   → Blue font, Yellow fill
  Target span-of-control ratio           → Blue font, Yellow fill

SECTION G — Implementation Costs
  Severance only toggle [Yes|No]         → Blue font
  Consulting / transition costs ($)      → Blue font (0 when toggle = Yes)

SECTION H — Phasing & Timing
  Notice period (months)                 → Blue font, Yellow fill
  Number of exit phases                  → Blue font
  Months per phase                       → Blue font
  Exit profile dropdown [Front-loaded|Even|Back-loaded] → Blue font, Yellow fill

  Phase weight lookup table:
    Header row:       Phase 1   Phase 2   Phase 3   Phase 4
    Front-loaded:     50%       30%       15%       5%
                                         → Blue font (these are hardcoded reference values)
    Even:             25%       25%       25%       25%       → Blue font
    Back-loaded:      5%        15%       30%       50%       → Blue font

  Selected profile weights row (INDEX/MATCH on exit profile dropdown):
    =INDEX(weight_table, MATCH(exit_profile, profile_labels, 0), {1,2,3,4})
                                         → Black font, Gray fill
  Sum check cell = SUM(selected_weights) → Black font
    Conditional format: RED fill (#C00000) if ≠ 100%
```

---

### TAB 2: Time Study (Teal — `#00B0B9`)

Optional tab. Activated when Assumptions Section E Handle Time Source toggle = "Time Study."
If toggle = "Manual," this tab is still visible but has no effect on the model.

**Cell color rules on this tab:**
- Blue font — user-entered task names, transaction times, and volume counts
- Gray fill + black font — Volume Weight % and Weighted Time (formula, read-only)
- Light blue fill — Status block cells that mirror Assumptions values

#### Input Table (rows 9–28, 20 data rows)

| Column | Header | Cell type | Font | Fill | Notes |
|--------|--------|-----------|------|------|-------|
| A | Task Type | User text input | Blue | White | Free text — e.g., "New Policy", "Endorsement" |
| B | Transaction Time (min) | User number input | Blue | White | Data validation: decimal number, no hover prompt |
| C | Volume | User number input | Blue | White | Data validation: whole number only, no hover prompt |
| D | Volume Weight % | Formula — read-only | Black | Gray `#D9D9D9` | `=C_this / SUM($C$9:$C$28)` — absolute denominator, auto-normalizes |
| E | Weighted Time (min) | Formula — read-only | Black | Gray `#D9D9D9` | `=B_this × D_this` |

**Key rules:**
- Users enter only **raw volume counts** in column C — never percentages
- Volume Weight % self-normalizes automatically; adding or changing any volume in column C
  updates all weights without user intervention
- Gray fill on D and E communicates "do not edit" without requiring a protection password

#### Summary Block (rows 30–35, below the table)

```excel
Task count (non-blank rows):
  =COUNTA(A9:A28)                          [Black font, White fill]

Total weight check:
  =SUM(D9:D28)                             [Black font, White fill]
  → Displays 100.0% automatically once any volume is entered
  → No manual intervention needed

Simple average handle time (min):
  =IFERROR(AVERAGEIF(B9:B28,"<>",B9:B28),0)  [Black font, White fill]

Weighted average handle time (min):
  =IFERROR(SUMPRODUCT(B9:B28,C9:C28)/SUM(C9:C28),0)
                                           [Black font, Yellow fill — key output]
  ← THIS cell is what Assumptions active handle time references when toggle = "Time Study"
```

#### Status Block (rows 37–40)

```
Handle time source (live mirror):
  =Assumptions!toggle_cell               [Green font, Light blue fill #DEEAF1]

Current model handle time (min):
  =Assumptions!active_handle_time_cell   [Green font, Light blue fill #DEEAF1]

Delta vs manual entry (min):
  =active_handle_time − manual_handle_time  [Black font, White fill]
  → Positive = Time Study avg is higher than manual; negative = lower
```

#### Instruction Note

Place in a merged, bordered cell block at the top of the tab (rows 5–7):
```
"HOW TO ACTIVATE: Go to Assumptions > Section E > Handle Time Source dropdown.
 Select 'Time Study'. This tab's weighted average will then feed the model automatically.
 Enter task types in column A, transaction times in column B, and raw volume counts in column C.
 Volume weights and weighted average calculate automatically — do not edit columns D or E."
```
Format: Teal fill (`#00B0B9`), white bold font, thin border around the block.

---

### TAB 3: Calculations (Blue — `#4472C4`)

All arithmetic. **Zero user inputs.** Every cell references Assumptions or other Calculations cells.

**Cell color rules on this tab:**
- Black font — all formula cells (the entire tab, except cross-sheet links)
- Green font — cells that pull directly from Assumptions or Time Study

#### Column Structure

| Col | Header | Content |
|-----|--------|---------|
| A | Label | Row description |
| B | Unit | e.g., FTEs, $, months |
| C | Region 1 | Per-region calculation |
| D | Region 2 | Per-region (add cols for N regions) |
| E | Total | SUM across regions |
| F | Low Scenario | Low HC% applied |
| G | Base Scenario | Base HC% applied |
| H | High Scenario | High HC% applied |
| I | Active Scenario | `=CHOOSE(MATCH(...))` — the live result |
| J | Notes | Audit trail explanation |

#### Active Scenario Pattern (apply to every output row)

```excel
=CHOOSE(MATCH(Assumptions!scenario_dropdown,{"Low","Base","High"},0),
        [Low_formula], [Base_formula], [High_formula])
```

#### Section 1 — Staff Right-Sizing

```
Current front-line FTEs     → =Assumptions!Section_C_staff_total        [Green font]
Active HC reduction %       → CHOOSE formula on scenario dropdown        [Black font]
FTE reduction (staff)       → current_FTEs × active_HC_pct              [Black font]
Remaining FTEs (staff)      → current_FTEs − FTE_reduction              [Black font]
Required capacity (uplifted)→ =Assumptions!Section_E_required_FTEs      [Green font]
Capacity surplus/(deficit)  → remaining_FTEs − required_FTEs            [Black font]
```

Conditional format on FTE reduction row: Green fill `#E2EFDA` when value > 0.

#### Section 2 — Management Layer

```
Current managers            → =Assumptions!Section_C_manager_total      [Green font]
Target span-of-control      → =Assumptions!span_ratio                   [Green font]
Required managers post-cut  → =CEILING(remaining_staff / span_ratio, 1) [Black font]
                              ← MUST use CEILING — never ROUND or INT
Manager FTE reduction       → current_managers − required_managers       [Black font]
Remaining managers          → required_managers                          [Black font]
Actual post-reduction ratio → remaining_staff / remaining_managers       [Black font]
```

Conditional format on manager FTE reduction row: Green fill `#E2EFDA` when value > 0.

#### Section 3 — Annual Savings & Costs

```
Gross staff savings         → staff_FTE_reduction × blended_staff_all_in_cost   [Black font]
Gross manager savings       → mgr_FTE_reduction × blended_mgr_all_in_cost       [Black font]
Total gross savings         → staff_savings + manager_savings                    [Black font]
Total FTE reduction         → staff_reduction + manager_reduction                [Black font]

One-time severance cost:
  Blended all-in salary     → =SUMPRODUCT(all_FTEs, all_costs) / SUM(all_FTEs)  [Black font]
                              ← Uses TRUE blended salary — NOT savings/FTE
  Severance                 → total_FTE_reduction × blended_salary × (sev_weeks/52) [Black font]

Consulting / transition     → =Assumptions!Section_G_consulting_cost            [Green font]
Year 1 net benefit          → total_gross_savings − severance − consulting       [Black font]
```

#### Section 4 — ROI Summary

```
Run-rate annual savings     → total gross savings (active scenario)
Total one-time cost         → severance + consulting
Simple payback (months)     → (total_one_time_cost / run_rate_savings) × 12
3-year gross savings        → run_rate × 3
3-year net savings          → 3yr_gross − total_one_time_cost
```

Conditional format on payback cell: Red font `#C00000` when value > 24.

---

### TAB 4: Phasing (Purple — `#7030A0`)

36-month cash flow grid. One column per month.

**Cell color rules on this tab:**
- Black font — all formula cells in the grid and summary block
- Green font — helper constant cells that link from Assumptions or Calculations
- Blue font — no user inputs exist on this tab; if any cell appears editable, it is wrong

#### ⚠️ CRITICAL: Month Axis Must Be Numeric

Row 3, columns B through AK (months 1–36) **must be set as Python integers**, not strings.

```python
# CORRECT
for col_idx, month_num in enumerate(range(1, 37), start=2):
    cell = ws.cell(row=3, column=col_idx)
    cell.value = month_num        # integer — value is 1, 2, 3 ... 36
    cell.number_format = '"M"0'   # display as M1, M2 ... M36

# WRONG — breaks all IF comparisons silently
cell.value = "M1"   # never do this
cell.value = f"M{month_num}"   # never do this
```

The monthly grid formulas use `IF(month_cell <= notice_period, ...)`. If month_cell contains
a string, Excel evaluates the comparison as FALSE for every month — all rows return zero with
no error message.

#### Helper Constants Block (column A / B, rows above the grid)

These cells feed into the grid. All pull from upstream tabs.

```excel
Total FTE reduction (active scenario):
  =Calculations!active_total_FTE_reduction       [Green font]

Annual run-rate savings (active scenario):
  =Calculations!active_total_gross_savings       [Green font]

Blended all-in salary (true weighted avg):
  =SUMPRODUCT(Assumptions!all_FTE_ranges, Assumptions!all_cost_ranges)
   / SUM(Assumptions!all_FTE_ranges)             [Black font]
  ← NOT savings / FTE — this is the actual all-in salary used for severance

Notice period (months):
  =Assumptions!notice_period                     [Green font]

Months per phase:
  =Assumptions!months_per_phase                  [Green font]

Number of exit phases:
  =Assumptions!num_phases                        [Green font]

Severance weeks:
  =Assumptions!severance_weeks                   [Green font]

Total program duration (months):
  =notice_period + num_phases × months_per_phase [Black font]
```

#### Monthly Grid (rows, one formula pattern per row)

**Row: Exits this month**
```excel
=IF(month_num <= notice_period, 0,
 IF(month_num > notice_period + num_phases * months_per_phase, 0,
    total_FTE_reduction
    * INDEX(Assumptions!selected_weights, 1,
            MIN(num_phases, CEILING((month_num - notice_period) / months_per_phase, 1)))
    / months_per_phase))
```

**Row: Cumulative exits**
```excel
Month 1:  =exits_row_month_1
Month N:  =cumulative_prev_month + exits_this_month
```

**Row: Monthly run-rate savings**
```excel
=cumulative_exits * (annual_run_rate_savings / total_FTE_reduction) / 12
```
This formula preserves the blended staff/manager savings rate. It does NOT recalculate from
scratch each month — it scales the total run-rate proportionally to cumulative exits.

**Row: Severance paid this month**
```excel
=exits_this_month * blended_all_in_salary * (severance_weeks / 52)
```
Uses true blended salary from the helper constants block — not savings per FTE.

**Row: Net monthly cash flow**
```excel
=monthly_run_rate_savings - severance_this_month
```

**Row: Cumulative net cash flow**
```excel
Month 1:  =net_cash_month_1
Month N:  =cumulative_prev_month + net_cash_this_month
```

#### Annual Summary Block (Y1 / Y2 / Y3 / Total)

Columns: Label | Y1 (M1–M12) | Y2 (M13–M24) | Y3 (M25–M36) | Total

| Row label | Y1 formula | Y2 formula | Y3 formula | Total formula |
|-----------|-----------|-----------|-----------|--------------|
| FTE exits | =SUM(exits_M1:M12) | =SUM(exits_M13:M24) | =SUM(exits_M25:M36) | =SUM(all) |
| Annual savings ($) | =SUM(savings_M1:M12) | =SUM(savings_M13:M24) | =SUM(savings_M25:M36) | =SUM(all) |
| Severance paid ($) | =SUM(sev_M1:M12) | =SUM(sev_M13:M24) | =SUM(sev_M25:M36) | =SUM(all) |
| Net cash flow ($) | =SUM(net_M1:M12) | =SUM(net_M13:M24) | =SUM(net_M25:M36) | =SUM(all) |
| Cumulative cash at year end | =cum_M12 | =cum_M24 | =cum_M36 | — |

All cells: Black font, currency format `$#,##0;($#,##0);-`.

#### KPI Block

```excel
Cash payback month:
  =IFERROR(
    MATCH(TRUE, INDEX(cumulative_net_cash_row > 0, 0), 0),
    ">36 months")
  [Black font — displays the first month cumulative cash turns positive]

Year 3 run-rate (annual savings):
  =Y3_annual_savings_cell_from_annual_summary    [Black font]

Year 3 cumulative cash flow:
  =Y3_cumulative_cash_cell_from_annual_summary   [Black font]
```

Conditional format on payback cell: Red font `#C00000` when numeric value > 24.

#### Chart

Line chart of the cumulative net cash flow row (all 36 months).
- Title: "Cumulative Net Cash Flow (36 months)"
- Line color: Navy `#1F3864`
- No legend
- X-axis label: "Month"
- Y-axis: currency format

#### Structural Notes

- Column A width: ~33 units (label column)
- Month columns B–AK: ~8 units each
- Freeze panes: top 3 rows AND column A (so row labels stay visible when scrolling right)

---

### TAB 5: Scenario Analysis (Orange — `#ED7D31`)

Side-by-side comparison of all three scenarios. **Every cell is a formula — no hardcoded values.**

**Cell color rules:**
- Green font — all cells (every value is a cross-sheet link from Calculations)
- Yellow fill — the column matching the active scenario (conditional format)

#### Section 1 — Parameters

| Parameter | Low | Base | High |
|-----------|-----|------|------|
| HC reduction % | =Assumptions!low_pct | =Assumptions!base_pct | =Assumptions!high_pct |
| Severance weeks | =Assumptions!sev_weeks | (same) | (same) |
| Span-of-control ratio | =Assumptions!span_ratio | (same) | (same) |

#### Section 2 — Headcount Impact

| Metric | Low | Base | High |
|--------|-----|------|------|
| Staff FTE reduction | =Calculations!F_staff_red | =Calculations!G_staff_red | =Calculations!H_staff_red |
| Manager FTE reduction | =Calculations!F_mgr_red | =Calculations!G_mgr_red | =Calculations!H_mgr_red |
| Total FTE reduction | sum of above | sum of above | sum of above |
| Remaining workforce | current − total red | current − total red | current − total red |

#### Section 3 — Financial Impact

| Metric | Low | Base | High |
|--------|-----|------|------|
| Gross staff savings ($) | | | |
| Gross manager savings ($) | | | |
| Total gross savings ($) | | | |
| One-time severance ($) | | | |
| Year 1 net benefit ($) | | | |
| 3-year gross savings ($) | | | |
| 3-year net savings ($) | | | |
| Simple payback (months) | | | |

All values = formula links to the Low / Base / High columns of Calculations tab (columns F, G, H).

**Active scenario column highlight:**
Apply conditional format yellow fill `#FFFF00` to whichever column header (Low / Base / High)
matches the value of Assumptions!scenario_dropdown.

#### Mini Comparison Table (chart source)

```
Scenario | Gross Annual Savings ($)
Low      | =Calculations!F_gross_savings
Base     | =Calculations!G_gross_savings
High     | =Calculations!H_gross_savings
```

Bar chart: Horizontal bars, orange fill. Title: "Gross Annual Savings by Scenario."

---

### TAB 6: Sensitivity (Yellow — `#FFC000`)

Two 5×5 direct-formula grids. **Never use `=TABLE()`** — write each cell as an explicit formula.

**Cell color rules:**
- Black font — all formula cells in the grids
- Yellow fill `#FFFF00` — center cell of each grid (base case marker)
- No blue font — zero user inputs on this tab; axis headers are hardcoded numeric values

#### Grid Sizing Rule

Use **an odd number of rows and columns** (5×5 minimum) so the base case values land in the
exact center cell. A 5×5 grid has center at row 3, column 3. A 7×7 has center at row 4, column 4.

---

#### Grid 1 — FTE Capacity Surplus / (Deficit)

- **Row axis:** HC Reduction % — 5 values, base case in center row
  Example: [6%, 9%, 12%, 15%, 18%] where 12% is base
- **Column axis:** Average Handle Time (minutes) — 5 values, base case in center column
  Example: [14, 17, 20, 23, 26] where 20 is base
- **Output per cell:** FTE capacity surplus = remaining FTEs − required FTEs

```excel
# Per-cell direct formula (row i = HC reduction %, col j = handle time):
= (Assumptions!total_staff_FTE × (1 - row_hc_pct[i]))
  - ((Assumptions!total_annual_volume × col_handle_time[j] × (1 + Assumptions!uplift_pct))
     / (Assumptions!effective_hrs × 60))
```

Row and column headers: formatted as `0.0%` (percentages) and `0.0` (minutes) respectively.
Center cell: Yellow fill `#FFFF00`, bold border.
Notes column (right of grid): "Positive = surplus capacity after reduction. Negative = deficit —
reduction has gone too far for the given handle time."

---

#### Grid 2 — Simple Payback (months)

- **Row axis:** HC Reduction % — same 5 values as Grid 1
- **Column axis:** Severance Weeks — 5 values, base case in center column
  Example: [4, 6, 8, 10, 12] where 8 is base
- **Output per cell:** Simple payback in months

```excel
# Per-cell direct formula (row i = HC reduction %, col j = severance weeks):
= IFERROR(
    (Assumptions!total_staff_FTE × row_hc_pct[i]
      × Assumptions!blended_all_in_salary × (col_sev_weeks[j] / 52))
    / (Assumptions!total_staff_FTE × row_hc_pct[i] × Assumptions!blended_all_in_cost)
    × 12,
  "n/a")
```

Row and column headers: formatted as `0.0%` and `0` (whole weeks) respectively.
Center cell: Yellow fill `#FFFF00`, bold border.
Notes column (right of grid): "Lower-left = fastest payback (high HC reduction, low severance).
Upper-right = slowest payback. Red font when > 24 months."

Conditional format both grids: Red font `#C00000` on any cell where numeric value > 24.

---

### TAB 7: Summary (Navy — `#1F3864`)

Built last (references all other tabs). Appears first in tab bar for the executive audience.
**No calculations.** Every data cell is a formula link — green font throughout.

**Cell color rules:**
- Green font — every formula link pulling from another tab
- Black font — static labels only (section headers, row titles)
- Navy fill + white bold font — section header rows

#### Section 1 — Initiative Overview

| Label | Value |
|-------|-------|
| Company | =Assumptions!B5 |
| Industry | =Assumptions!B6 |
| Initiative title | =Assumptions!B8 |
| Core problem | =Assumptions!B7 |
| Regions in scope | =Assumptions!region_list (concatenated) |
| Total current FTEs | =Calculations!total_current_FTE |
| Target span-of-control | =Assumptions!span_ratio |
| Active scenario | =Assumptions!scenario_dropdown |

#### Section 2 — Headcount Impact

| Label | Value |
|-------|-------|
| Current front-line FTEs | =Calculations!current_staff |
| Current manager FTEs | =Calculations!current_managers |
| Staff FTE reduction | =Calculations!active_staff_reduction |
| Manager FTE reduction | =Calculations!active_mgr_reduction |
| Total FTE reduction | =Calculations!active_total_reduction |
| Post-reduction workforce | =Calculations!active_remaining_total |
| HC reduction % | =Assumptions!active_hc_pct |

#### Section 3 — Financial Summary

| Metric | Value |
|--------|-------|
| Annual run-rate savings | =Calculations!active_gross_savings |
| One-time severance cost | =Calculations!severance_cost |
| Consulting / transition | =Calculations!consulting_cost |
| Year 1 net benefit | =Calculations!Y1_net |
| 3-year gross savings | =Calculations!3yr_gross |
| 3-year net savings | =Calculations!3yr_net |
| Simple payback (months) | =Calculations!payback_months |

#### Section 4 — Phasing & Cash Realization

| Metric | Y1 | Y2 | Y3 | Total |
|--------|----|----|-----|-------|
| Annual cash savings ($) | =Phasing!Y1_savings | =Phasing!Y2_savings | =Phasing!Y3_savings | =Phasing!total_savings |
| Severance paid ($) | =Phasing!Y1_sev | =Phasing!Y2_sev | =Phasing!Y3_sev | =Phasing!total_sev |
| Net cash flow ($) | =Phasing!Y1_net | =Phasing!Y2_net | =Phasing!Y3_net | =Phasing!total_net |
| Cumulative cash ($) | =Phasing!cum_M12 | =Phasing!cum_M24 | =Phasing!cum_M36 | — |

#### Headline KPIs Block

```
Cash Payback Month:       =Phasing!payback_kpi_cell
Year 3 Run-Rate Annual:   =Phasing!Y3_runrate_cell
Year 3 Cumulative Cash:   =Phasing!Y3_cumulative_cell
```

#### Implementation Timeline Block

```
Notice period:            =Assumptions!notice_period & " months"
Exit profile:             =Assumptions!exit_profile_dropdown
Total program duration:   =Phasing!total_duration_cell & " months"
Number of phases:         =Assumptions!num_phases
Months per phase:         =Assumptions!months_per_phase
```

Embedded line chart: Cumulative net cash flow over 36 months (source: Phasing cumulative row).
Navy line. No legend. Title: "Cumulative Net Cash Flow (36 months)."

---

### TAB 8: Help (Silver — `#808080`)

Documentation tab. No model formulas. Every entry is static text or a formula link for reference.
This tab must include the **full Master Cell Color Legend** so any user can understand what they
are allowed to edit without needing to ask.

---

#### Section 1 — Tab Navigator

| Tab | Tab color | Purpose | User edits? | What to edit |
|-----|-----------|---------|-------------|-------------|
| Assumptions | Green | All model inputs — single source of truth | **Yes** | Blue font cells only |
| Time Study | Teal | Optional handle time analysis | **Yes, if using Time Study** | Columns A, B, C only (rows 9–28) |
| Calculations | Blue | All arithmetic — no inputs | No | Do not edit any cell |
| Phasing | Purple | 36-month cash flow grid and payback KPI | No | Do not edit any cell |
| Scenario Analysis | Orange | Low / Base / High side-by-side comparison | No | Do not edit any cell |
| Sensitivity | Yellow | Two what-if sensitivity grids | No | Do not edit any cell |
| Summary | Navy | Executive snapshot — formula links only | No | Do not edit any cell |
| Help | Silver | This page — navigator, color guide, FAQ | No | Do not edit any cell |

---

#### Section 2 — Cell Color Legend (MANDATORY — must appear in full)

This section must be formatted as a table in the Help tab with actual cell samples where possible.

**What each font color means:**

| Font color | Example | Meaning | Can I edit this? |
|------------|---------|---------|-----------------|
| **Blue** `#0000FF` | 1,880 | Hardcoded input — a value you type | **Yes — this is your input** |
| **Black** `#000000` | =B5×C5 | Formula — calculated automatically | **No — formula will break** |
| **Green** `#375623` | =Assumptions!B5 | Cross-sheet link — pulls from another tab | **No — formula will break** |

**What each background / fill color means:**

| Fill color | Example | Meaning | Can I edit this? |
|------------|---------|---------|-----------------|
| **Yellow** `#FFFF00` | HC reduction % | Key assumption — pay attention here | Yes (if blue font); No (if black font) |
| **Gray** `#D9D9D9` | Volume Weight % | Read-only formula inside an input table | **No — auto-calculated** |
| **Light blue** `#DEEAF1` | Status block values | Informational reference — linked from another tab | No |
| **White** `#FFFFFF` | Most cells | Standard cell | Depends on font color |

**What special colors mean:**

| Color | Applied to | Meaning |
|-------|-----------|---------|
| Red fill `#C00000` | Phase weight sum-check | Weights do not sum to 100% — fix before using model |
| Green fill `#E2EFDA` | FTE reduction rows | Reduction is positive — expected result |
| Red font `#C00000` | Payback value | Payback exceeds 24 months — flag for leadership |
| Yellow fill `#FFFF00` on column header | Scenario Analysis | This is the currently active scenario |
| Yellow fill `#FFFF00` on grid center | Sensitivity | This cell = your base case assumptions |

**Number format guide:**

| Format | Displays as | Applied to |
|--------|------------|-----------|
| `$#,##0;($#,##0);-` | $85,000 / ($12,000) / - | All currency cells |
| `0.0%` | 12.5% | All percentage cells |
| `#,##0` | 1,250 | FTE counts |
| `0.0` | 14.2 | Payback in months |
| `0.0"x"` | 2.3x | Multiples |
| `"M"0` | M1, M12 | Phasing month axis |

---

#### Section 3 — How the Model Works

**Handle time toggle (Assumptions Section E)**
The "Handle Time Source" dropdown has two settings:
- **Manual** — uses the minutes value you type directly into Section E
- **Time Study** — uses the volume-weighted average calculated in the Time Study tab

When set to "Time Study," go to the Time Study tab and enter task names (column A),
transaction times in minutes (column B), and raw volume counts (column C). The weights
and weighted average calculate automatically.

**Scenario switcher (Assumptions Section F)**
The "Scenario" dropdown (Low / Base / High) is the single control that switches the entire
model. Change it and every output in Calculations, Phasing, Scenario Analysis, and Summary
updates instantly. The dropdown drives a MATCH index consumed by CHOOSE formulas throughout
the Calculations tab.

**Phasing logic (Phasing tab)**
The model distributes FTE exits across phases based on:
1. Notice period — no exits until this many months have passed
2. Number of phases and months per phase — defines the exit window
3. Exit profile (Front-loaded / Even / Back-loaded) — weights exits toward the start, middle, or end

The phase weight table on Assumptions stores three profiles. INDEX/MATCH selects the right row
based on the exit profile dropdown. Monthly savings accrue as FTEs exit — cumulative savings
vs. front-loaded severance cost determines the payback month.

---

#### Section 4 — FAQ

**Q: How do I add a region?**
A: On Assumptions tab, add a row in Sections B, C, D, and E. Then extend the regional columns
in Calculations (add a new Region column between the last region and the Total column).
Update all SUM and SUMPRODUCT formulas to include the new column.

**Q: How do I change the handle time source?**
A: Assumptions tab > Section E > Handle Time Source dropdown. Select "Manual" or "Time Study."
If "Time Study," populate the Time Study tab and verify the weighted average appears in the
Status block before relying on outputs.

**Q: How do I read the sensitivity grids?**
A: The center cell (yellow) = your current base case inputs. Moving left/right changes the column
axis variable. Moving up/down changes the row axis variable. Values further from center show how
outputs change as you stress-test assumptions. Red font = payback > 24 months.

**Q: Why is payback showing ">36 months"?**
A: The cumulative net cash flow never turns positive within the 36-month window. This usually
means severance is too high relative to annual savings. Try: (1) increasing HC reduction %, 
(2) reducing severance weeks, or (3) switching to a back-loaded exit profile to delay severance
cash outflows.

**Q: How do I change the active scenario?**
A: Assumptions tab > Section F > Scenario dropdown. Select Low, Base, or High. All outputs
update automatically.

**Q: Why is the phase weight sum check red?**
A: The four phase weights in the selected row do not add to 100%. Go to Assumptions Section H
and correct the weight table for the active exit profile. The sum-check cell turns white when
weights are correct.

**Q: Which cells can I safely edit?**
A: Only **blue font cells** on the **Assumptions tab** and columns A, B, C in the **Time Study tab**
(rows 9–28). All other cells are formulas — editing them breaks the model. Use the color legend
in Section 2 of this tab as your guide.

---

## Step 3 — Formatting Standards

### Applying the Master Cell Color Legend

The color system defined at the top of this skill is the **single authoritative reference**.
Apply it without exception. The checklist below maps each cell type to its exact format:

```
Input cell (user edits):          Font Blue #0000FF  |  Fill White
Formula cell:                      Font Black #000000  |  Fill White
Cross-sheet link:                  Font Green #375623  |  Fill White
Read-only in input table:          Font Black #000000  |  Fill Gray #D9D9D9
Key assumption (needs attention):  Font Blue #0000FF   |  Fill Yellow #FFFF00
Status / reference block:          Font Green #375623  |  Fill Light blue #DEEAF1
Section header:                    Font White, bold    |  Fill = tab color
Sensitivity base case cell:        Font Black #000000  |  Fill Yellow #FFFF00, bold border
Active scenario column header:     Conditional → Yellow fill #FFFF00
Phase weight sum error:            Conditional → Red fill #C00000
FTE reduction > 0:                 Conditional → Green fill #E2EFDA
Payback > 24 months:               Conditional → Red font #C00000
```

### Structural Rules

- **Freeze top 3 rows on every tab**
- **Also freeze column A on Phasing tab** (so row labels stay visible when scrolling across 36 months)
- **Autofit all columns** after content is written
- **Thin borders** on all data cells
- **Notes / explanation column** on the far right of every tab

### Conditional Formatting Summary

| Condition | Cell(s) | Format applied |
|-----------|---------|---------------|
| Phase weights ≠ 100% | Sum-check cell on Assumptions | Red fill `#C00000` |
| FTE reduction > 0 | Reduction rows in Calculations | Green fill `#E2EFDA` |
| Payback > 24 months | Payback cells in Calculations, Sensitivity, Summary | Red font `#C00000` |
| Active scenario = Low/Base/High | Column header in Scenario Analysis | Yellow fill `#FFFF00` |

---

## Step 4 — Quality Checks (All Must Pass Before Delivery)

Run in order. **Do not present the file if any check fails.**

```
QC1.  No hardcoded computed values
      → Grep openpyxl script: no raw numeric literals assigned as cell.value
        outside Assumptions tab (sensitivity axis headers are the only exception)

QC2.  Master Cell Color Legend applied correctly
      → Spot-check 5 input cells: confirm Blue #0000FF font
      → Spot-check 5 formula cells: confirm Black #000000 font
      → Spot-check 5 cross-sheet links: confirm Green #375623 font
      → Spot-check 3 read-only table cells: confirm Gray #D9D9D9 fill

QC3.  Blended salary formula check
      → Confirm blended salary = SUMPRODUCT(FTEs, costs) / SUM(FTEs)
        NOT total_savings / total_FTE_reduction

QC4.  CEILING on manager reduction
      → Confirm manager formula uses CEILING(..., 1) — not ROUND or INT

QC5.  Scenario dropdown smoke test
      → Flip scenario Low → Base → High
      → Confirm Calculations active column changes at each flip
      → Confirm Scenario Analysis active column yellow highlight moves

QC6.  Handle time toggle test
      → Set toggle = "Time Study"; confirm Assumptions active handle time
        = Time Study weighted_avg cell
      → Set toggle = "Manual"; confirm active handle time = manual input cell
      → Confirm Time Study status block shows correct mirror values

QC7.  Time Study self-normalization test
      → Enter volumes 100, 200, 300 in column C rows 9–11
      → Confirm Volume Weight % = 16.7%, 33.3%, 50.0%
      → Confirm SUM(D9:D28) = 100.0%
      → Clear test data and restore

QC8.  Month axis numeric check
      → Confirm Phasing row 3 cells are Python int values 1–36 (not strings)
      → Verify: ws.cell(row=3, column=2).value == 1 (integer, not "M1" or "1")

QC9.  Phasing math smoke test
      → Temporarily set helper constant total_FTE_reduction = 50, blended_salary = 75000
      → Run recalc.py
      → Front-loaded: confirm Y1 exits > Y2 exits > Y3 exits (weights = 50/30/15/5)
      → Confirm Y3 savings ≈ Y2 savings if all exits complete by month 14
      → Restore originals

QC10. Phase weights sum check
      → Confirm sum-check cell = 100% for all three profile rows in the lookup table
      → Confirm selected weights row also sums to 100%
      → Confirm conditional format fires red when a weight is manually set to 0

QC11. Sensitivity grid checks
      → Confirm both grids have odd row and column counts
      → Confirm all 25 cells in each grid have numeric values (no blanks, no errors)
      → Confirm center cell in each grid has Yellow fill #FFFF00 and bold border
      → Confirm red font fires on cells > 24 in Grid 2

QC12. Help tab color legend completeness
      → Confirm Help tab Section 2 contains all 5 font/fill categories
      → Confirm all 5 conditional formatting rules are documented
      → Confirm number format table is present

QC13. Zero formula errors
      → Run scripts/recalc.py; JSON status must be "success"; error_count = 0
      → Any #REF!, #VALUE!, #NAME?, #DIV/0! must be fixed before proceeding

QC14. Summary cross-references
      → Confirm all Section 3 and Section 4 cells resolve to numbers (not errors)
      → Confirm payback KPI in Summary matches Phasing!payback_kpi_cell value
```

---

## Step 5 — Output & Delivery

```python
import subprocess, json

company_clean = company_name.replace(" ", "")
initiative_clean = initiative_title.replace(" ", "")
output_path = (
    f"/mnt/user-data/outputs/"
    f"{company_clean}_{initiative_clean}_BusinessCase_{model_date}.xlsx"
)
wb.save(output_path)

result = subprocess.run(
    ["python", "scripts/recalc.py", output_path],
    capture_output=True, text=True
)
recalc_json = json.loads(result.stdout)

if recalc_json["status"] == "success":
    # present_files([output_path])
    pass
else:
    # Read recalc_json["error_summary"] — fix each identified cell — re-save — re-run
    # DO NOT present until status == "success" and error_count == 0
    pass
```

**Post-delivery summary (4 bullets):**
- Total FTE reduction — Base scenario
- Net Year 1 benefit ($)
- Cash payback month
- 3-year cumulative net cash flow ($)

---

## Anti-Hallucination Checklist

Complete every item before writing a single line of openpyxl code:

- [ ] All 8 input batches received and confirmed in writing by user
- [ ] Company name, initiative title, region names stored as Python variables — not hardcoded into formula strings
- [ ] Handle time source confirmed (Manual or Time Study) — do not assume Manual
- [ ] If Time Study: task data received; Time Study tab will be populated before Assumptions references it
- [ ] HC reduction % for Low / Base / High all explicitly confirmed — do not guess or interpolate
- [ ] Severance weeks explicitly confirmed — do not default to 8 without asking
- [ ] Time horizon explicitly confirmed — do not default to 3 years without asking
- [ ] Blended salary formula will use SUMPRODUCT(FTEs × costs) / SUM(FTEs)
- [ ] Manager reduction formula will use CEILING(..., 1)
- [ ] Month axis will be Python integers 1–36 with `"M"0` custom number format
- [ ] Sensitivity grids will have odd row and column counts (5×5 minimum)
- [ ] Sensitivity grids will use direct per-cell formulas — not =TABLE()
- [ ] Master Cell Color Legend applied to every cell on every tab
- [ ] Help tab Section 2 contains the full color legend table
- [ ] Notes column included on the far right of every tab
- [ ] recalc.py will be run; all errors resolved before presenting

---

## Common Failure Modes & Fixes

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| Phasing rows all zero | Month axis contains text strings | Set row 3 cells as `int` with `"M"0` number format |
| Scenario dropdown does nothing | Calculations use hardcoded HC % | Replace with `CHOOSE(MATCH(scenario_dropdown,...))` |
| Severance cost wildly wrong | Blended salary = savings/FTE proxy | Rewrite as `SUMPRODUCT(FTEs, costs) / SUM(FTEs)` |
| Manager count goes negative | Used ROUND or INT instead of CEILING | Replace with `CEILING(remaining_staff / span, 1)` |
| Handle time toggle has no effect | Active handle time cell not using IF formula | Wire: `=IF(toggle="Time Study",'Time Study'!wt_avg,manual_cell)` |
| Time Study weights don't sum to 100% | Volume Weight % uses relative (not absolute) denominator | Change to `=C9/SUM($C$9:$C$28)` — absolute range |
| Sensitivity grid has blank cells | Formula references go out of range | Ensure axis step values stay within plausible model ranges |
| Phase weights show 95% | Only 3 of 4 phase columns populated | Confirm all 4 columns have weights for all 3 profile rows |
| Summary shows #REF! | Phasing annual summary rows shifted during build | Lock Phasing row numbers before referencing from Summary |
| recalc.py returns errors_found | Cross-sheet reference tab name mismatch | Check `'Tab Name'!CellRef` matches exact tab name including spaces |
| #DIV/0! in blended salary | No FTEs entered yet | Wrap with `IFERROR(..., 0)` |
| Payback always ">36 months" | Severance exceeds savings throughout horizon | Check severance weeks vs HC reduction %; flag to user |
| Input cells appear black not blue | Color legend not applied during build | Apply `Font(color="0000FF")` to all hardcoded input cells on Assumptions |
| Gray fill missing on formula table cells | Default white fill left in place | Apply `PatternFill("solid","D9D9D9")` to all read-only table formula cells |
| Help tab has no color legend | Section 2 skipped | Always build Help tab last; include full color legend table as documented |

---

## File Naming Convention

```
{CompanyName}_{InitiativeTitle}_BusinessCase_{YYYYMMDD}.xlsx

Example: Acme_WorkforceOptimization_BusinessCase_20260527.xlsx
```
