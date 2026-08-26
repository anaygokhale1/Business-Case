# Upload templates

All synthetic — invented lines of business, invented processes, invented figures.

**Start here.** `simple-time-study-template.csv` and `simple-volumes-template.csv` are the
default pair. Between them they size capacity by role in both the current and the target
state, which is what most cases need.

| Template | Grain | Where it imports | What it answers |
|---|---|---|---|
| `simple-time-study-template.csv` | one row per task | Time study & volumes → Simple | how long each task takes, and who does it now and after |
| `simple-volumes-template.csv` | one row per task type | Time study & volumes → Simple | how many transactions of each type |
| `capacity-study-template.csv` | one row per process step | Time study & volumes → Detailed | the same, for a client with an existing process taxonomy |
| `capacity-volumes-template.csv` | one row per line of business × transaction type | Time study & volumes → Detailed | how much work there is, split by outcome |
| `region-volumes-template.csv` | one row per region, or region × process | Workload & demand | how much work there is, by where it happens |
| `time-study-sample.csv` | one row per task | Handle-time study | a flat study whose only job is an average handle time |

Each pair belongs together — ask for them as **two sheets in one workbook**. The client
maintains one artefact, it travels as one attachment, and the importer reads both.

## The simple format

```
Task / Action        | Task Type | Current Role | Target Role | Average Handling Time
Log the request      | New       | Analyst      | Assistant   | 10.0
Check completeness   | New       | Analyst      | Analyst     | 20.0
Price the risk       | New       | Analyst      | System      | 30.0
```

```
Task Type | Volume
New       | 10000
```

**Task Type is the join.** It is the one column that has to agree between the two files;
everything else is local to its own file. A type that appears in the study but not in the
volumes contributes nothing, so its tasks silently drop out and the capacity figure comes out
complete-looking and too low. The importer reconciles the two and names any type missing from
either side — neither file can detect this on its own, because each is internally consistent.

Then, per role: `required FTE = Σ (volume of the type × handling time) ÷ (hours × utilisation
× 60)`. Once against **Current Role** and once against **Target Role**, and the difference per
role is the surplus or deficit.

### What each column is for

- **`Task / Action`** — the row's label. It drives nothing; it is what makes the roll-up
  reviewable and lets a repeated measurement be spotted. Blank falls back to the task type.
- **`Task Type`** — the join, above. Also the grain volume is counted at.
- **`Current Role`** — who does the task today. This is the baseline the whole comparison is
  measured from, so a task with no current owner understates the as-is requirement, and the
  importer says so rather than dropping the row.
- **`Target Role`** — who does it after. **Leave it blank for a task that does not move.** A
  blank means the work stays with the current role, not that it goes nowhere, so a study only
  needs to name the roles that actually change. A role named `System`, `RPA`, `Bot` or
  `Automation` is read as an automation target: its minutes leave human capacity rather than
  being staffed at some notional productivity.
- **`Average Handling Time`** — minutes for one occurrence, per transaction of the type. The
  simple format has no frequency column, so each task is taken as happening once per
  transaction; a task that happens on only half of them should carry half the minutes, or use
  the detailed format, which has an explicit `Frequency` column.

### Volumes: one row per type, or one per task

Both shapes import. Which one you have decides how a repeated task type is read, and the
importer infers it from the columns present and then shows it as a control:

- **`Task Type, Volume` only** → one row per type. Repeated types are **added up** (a file
  split by month, say).
- **Roles or handling times also present** → one row per task, and the volume against each row
  is that type's count restated. Taken **once**, not summed. Adding them would multiply demand
  by the number of tasks in the type, and nothing in the result would look wrong.

A file of the second shape is a study in its own right, so the importer offers to use it as
both — which is the whole model from a single file.

### What is not in either file

Working hours per year and utilisation. No time study carries them, so every role arrives on
the documented default of 1,880 hours at 75%, badged as a default until changed in the **Role
capacity** step. All-in annual cost per role is not in them either, and nothing is assumed:
until a cost is entered the output shows capacity and says explicitly that there is no money in
the case yet.

## Two volume templates, because there are two models

`capacity-volumes-template.csv` is keyed on line of business and transaction type and
carries an outcome mix. It feeds the capacity model, where required FTE per role comes from
minutes per transaction. `region-volumes-template.csv` is keyed on where the work happens
and feeds the register, where each row is sized against its own productive hours. Same word,
different question — and a file shaped for one imports badly into the other, so the two
have separate importers and separate header vocabularies.

## Regional volumes: what each column is for

- **`Region`** — matched against the register by name, ignoring case and spacing. A region
  the case has not heard of is offered as a new row rather than dropped.
- **`Team`** — optional, and only needed when a region is split into several rows. Without
  it, a region the case splits in two cannot be resolved: the importer says so and writes
  nothing, because dividing the volume evenly would produce a register that adds up and
  describes an organisation that does not exist.
- **`Process / product`** — optional and informational. Its only job is to keep the roll-up
  inspectable, and to let identical repeated rows be spotted.
- **`Volume`** — as counted, over whatever period the file covers. **The period is chosen at
  import**, not read from the file, because nothing in a volume extract distinguishes 60,000
  a quarter from 60,000 a year and reading the first as the second understates the case
  fourfold with every number still looking ordinary.
- **`Average Handling Time`** — optional. Where present it becomes each region's own handle
  time, **volume-weighted** across that region's rows rather than averaged. Averaging
  understates capacity whenever the slower work is also the more common work, which is the
  usual shape. Rows that state no time stay out of the weighting instead of entering it as
  a zero.

Multiple rows per region are summed, because volume is additive. Identical rows — same
process, same figure — are still summed but flagged, since a double-counted extract is the
other explanation and it inflates a case by an amount nobody would think to question.

## Why volumes are a separate, differently shaped file

The study is wide — one row per process step, dozens of columns. Volumes are long — one
row per combination, a handful of columns. Forcing volumes into the study's shape means a
matrix with merged header cells, and adding a dimension later restructures the whole file.

## Ask for counts, not percentages

The volumes template asks for `Transactions Received` and a count per outcome. It does
**not** ask for a bind rate. Three reasons, in order of importance:

1. **The counts reconcile.** Bound + lost + declined either equals the received total or
   it does not, and a mismatch means the extract has lost or double-counted transactions.
   Percentages sum to 100% whether the underlying counts reconcile or not, so they hide
   exactly the error worth catching.
2. **A count is a system output.** A percentage is something someone worked out, and the
   working is usually lost by the time it reaches a model.
3. **The bind rate becomes a result.** Derived per line of business, it can be compared
   across the book and challenged. Asserted, it cannot.

Shares derived from counts sum to 1 by construction, so the "must total 100%" check
cannot fail on an upload — only on a figure typed into the form.

## Volumes: what each column is for

- **`Transactions Received`** — transactions *received*, not policies *written*. This is
  the single most consequential definition in the whole model. A submission that is lost
  or declined still consumes most of the work a bound one does, so counting only bound
  policies understates required capacity substantially, and the error grows with the share
  of business that does not bind.
- **`Period Start` / `Period End`** — so the model knows whether it is annualising. A
  part-year extract labelled as annual overstates capacity by the inverse of the period.
- **One row per line of business × transaction type.** Outcome mix differs by line: one
  book may bind 60% of what it quotes and another 50%. A single split across both moves
  required capacity the wrong way for each.

## Study: six things worth asking for

The study format is already close to what a real capacity study looks like. These are the
changes that make it machine-readable without changing what it measures.

1. **A `Step ID` column.** The important one. Without a stable id, a corrected re-upload
   can only replace the register wholesale — losing any in-app edits and any decisions
   already made about duplicates. Process names are not unique enough: in a real 2,229-row
   study, the full L1–L5 path plus line of business plus applicability flags still left 19
   rows non-unique, and 11 pairs were identical in every field that affects the arithmetic.
2. **Units in the header, not in a note.** `AHT (minutes)`, not `AHT` with a comment
   elsewhere on the sheet saying what the unit is. A parser cannot rely on prose.
3. **Explicit `Y` / `N` in the applicability columns.** A blank cell cannot be told apart
   from "not decided yet".
4. **One header row.** Grouped banner headers above the real header are readable by a
   person and ambiguous to a parser.
5. **`AHT Min` / `AHT Max` populated where they exist.** They become the sensitivity band.
   Left empty, sensitivity falls back to a percentage band on the point estimate.
6. **`Frequency` defined explicitly** — occurrences per transaction. At or below 1 it reads
   as the share of transactions where the step happens; above 1 the step happens more than
   once. Both are legal, and the model needs to know which was meant.

`Stated AHT` is optional and exists for one specific case: a step deliberately taken out
of scope without deleting its measurements. Where present it overrides the computed
`Frequency × (AHT + Rework Frequency × Rework AHT)`, and every divergence is reported.
