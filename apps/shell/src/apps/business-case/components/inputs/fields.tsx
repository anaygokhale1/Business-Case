"use client";

/**
 * Form primitives, in the template's design language.
 *
 * The numeric inputs are the only subtle part. They hold a string draft while the
 * field is being typed in and fall back to the canonical formatting of the stored
 * value on blur, so "1.", "-" and "0.0" survive keystrokes without an effect that
 * fights the reducer. An external change — a benchmark fill, loading the sample —
 * shows immediately, because a field nobody is typing in has no draft.
 */

import { useId, useState, type ReactNode } from "react";

import type { AnswerStatus } from "../../lib/case-questions";

/* -------------------------------------------------------------------------- */
/* Shared class strings — taken from the template, not invented                */
/* -------------------------------------------------------------------------- */

export const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-canvas px-4 py-2.5 text-sm text-ink outline-none transition focus:border-ink/40";

export const numericInputClass = `${inputClass} text-right tabular-nums`;

export const pillClass = (active: boolean) =>
  active
    ? "rounded-full bg-ink px-4 py-2 text-sm font-bold text-white"
    : "rounded-full border border-slate-200 bg-canvas px-4 py-2 text-sm font-semibold text-muted transition hover:border-ink/40 hover:text-ink";

export const ghostButtonClass =
  "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-muted transition hover:border-ink/40 hover:text-ink";

export const primaryButtonClass =
  "rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";

/* -------------------------------------------------------------------------- */
/* Status badge                                                               */
/* -------------------------------------------------------------------------- */

const STATUS_STYLE: Record<AnswerStatus, { label: string; className: string; title: string }> = {
  answered: {
    label: "answered",
    className: "bg-teal/10 text-teal",
    title: "You supplied this figure.",
  },
  default: {
    label: "default",
    className: "bg-panel text-outline",
    title:
      "Holding a documented default you have not changed. It will be labelled as a default on the case, not as an answer.",
  },
  empty: {
    label: "needed",
    className: "bg-red-50 text-red-600",
    title: "Still outstanding.",
  },
  "n/a": {
    label: "n/a",
    className: "bg-panel text-outline",
    title: "Not applicable given another answer.",
  },
};

export function StatusBadge({ status }: { status: AnswerStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      title={style.title}
      className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.1em] ${style.className}`}
    >
      {style.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Field wrapper                                                              */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  questionId,
  status,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  /** The skill's question number, so a reviewer can trace the form to the interview. */
  questionId?: string;
  status?: AnswerStatus;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <label
          htmlFor={htmlFor}
          className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline"
        >
          {label}
        </label>
        {questionId ? <span className="text-[10px] font-semibold text-slate-300">{questionId}</span> : null}
        {status ? <StatusBadge status={status} /> : null}
      </div>
      {children}
      {hint ? <p className="text-xs text-outline">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Text                                                                      */
/* -------------------------------------------------------------------------- */

export function TextField({
  label,
  questionId,
  status,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  questionId?: string;
  status?: AnswerStatus;
  hint?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Field label={label} questionId={questionId} status={status} hint={hint} htmlFor={id}>
      <input
        id={id}
        type="text"
        className={inputClass}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

const parseNumber = (raw: string): number | null => {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface NumberInputProps {
  value: number | null;
  /** `null` means the field was cleared. What that means is the caller's decision. */
  onChange: (value: number | null) => void;
  /** Multiply for display, divide on commit. 100 turns 0.75 into 75. */
  scale?: number;
  /** Decimal places used when formatting the stored value for editing. */
  dp?: number;
  placeholder?: string;
  suffix?: string;
  className?: string;
  ariaLabel?: string;
  id?: string;
}

export function NumberInput({
  value,
  onChange,
  scale = 1,
  dp = 4,
  placeholder,
  suffix,
  className,
  ariaLabel,
  id,
}: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const canonical =
    value === null
      ? ""
      : // Trim trailing zeros so 0.75 at scale 100 edits as "75", not "75.0000".
        String(Number((value * scale).toFixed(dp)));

  const shown = draft ?? canonical;

  const commit = (raw: string) => {
    setDraft(raw);
    const parsed = parseNumber(raw);
    onChange(parsed === null ? null : parsed / scale);
  };

  return (
    <div className="relative">
      <input
        id={id}
        aria-label={ariaLabel}
        type="text"
        inputMode="decimal"
        className={`${className ?? numericInputClass}${suffix ? " pr-12" : ""}`}
        value={shown}
        placeholder={placeholder}
        onChange={(event) => commit(event.target.value)}
        // Dropping the draft on blur is what lets an external change show through.
        onBlur={() => setDraft(null)}
      />
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-semibold text-outline">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export function NumberField({
  label,
  questionId,
  status,
  hint,
  ...input
}: NumberInputProps & {
  label: string;
  questionId?: string;
  status?: AnswerStatus;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} questionId={questionId} status={status} hint={hint} htmlFor={id}>
      <NumberInput {...input} id={id} />
    </Field>
  );
}

/** A percentage stored as a fraction and edited as a whole number. */
export function PercentField(
  props: Omit<NumberInputProps, "scale" | "suffix"> & {
    label: string;
    questionId?: string;
    status?: AnswerStatus;
    hint?: ReactNode;
  },
) {
  // scale 100 in one place, so a percentage cannot be stored as 75 by one field and
  // 0.75 by another — the silent 100x error in a denominator.
  return <NumberField {...props} scale={100} dp={4} suffix="%" />;
}

/* -------------------------------------------------------------------------- */
/* Choices — the skill's tappable options                                     */
/* -------------------------------------------------------------------------- */

export function ChoiceField<T extends string>({
  label,
  questionId,
  status,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  questionId?: string;
  status?: AnswerStatus;
  hint?: ReactNode;
  options: readonly T[];
  value: T | "";
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label} questionId={questionId} status={status} hint={hint}>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={value === option}
            className={pillClass(value === option)}
          >
            {option}
          </button>
        ))}
      </div>
    </Field>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

export function Panel({
  title,
  blurb,
  children,
  aside,
}: {
  title: string;
  blurb?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-extrabold text-ink">{title}</h2>
          {blurb ? <p className="mt-1 text-sm text-muted">{blurb}</p> : null}
        </div>
        {aside}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function FieldGrid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return (
    <div className={`grid gap-5 ${cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>{children}</div>
  );
}

/** A note that explains a modelling consequence, not a decoration. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl bg-canvas px-4 py-3 text-xs leading-relaxed text-muted">{children}</p>
  );
}
