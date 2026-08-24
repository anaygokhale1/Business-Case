# Upload templates

Two files, one workbook. Both are synthetic — invented lines of business, invented
processes, invented figures.

| Template | Grain | What it answers |
|---|---|---|
| `capacity-study-template.csv` | one row per process step | how long the work takes, and who does it |
| `capacity-volumes-template.csv` | one row per line of business × transaction type | how much work there is |
| `time-study-sample.csv` | one row per task | the simpler flat study, for a case with no role dimension |

Ask for both as **two sheets in one workbook**. The client maintains one artefact, it
travels as one attachment, and the importer reads both.

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
