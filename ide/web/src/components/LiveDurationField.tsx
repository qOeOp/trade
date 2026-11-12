import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { restText, SPAN_UNITS } from "../model/liveLaunch";

type Parts = { fields: string[]; carry: number };
const LAST = SPAN_UNITS.length - 1;
/** Whole seconds as years, months, days and hours, largest first, and the seconds below an hour. */
const split = (seconds: string): Parts => {
  let rest = /^\d+$/.test(seconds) ? Number(seconds) : 0;
  const fields = SPAN_UNITS.map((unit) => {
    const n = Math.floor(rest / unit.seconds);
    rest -= n * unit.seconds;
    return String(n);
  });
  return { fields, carry: rest };
};
const total = (parts: Parts) => SPAN_UNITS.reduce((sum, unit, at) => sum + Number(parts.fields[at] || 0) * unit.seconds, parts.carry);
const FIELD = "w-[2ch] border-0 border-b border-link bg-transparent px-0 pb-px text-right tabular-nums outline-none hover:bg-hover focus:border-b-2 focus:pb-0 focus:text-fg aria-invalid:border-fail";

/** A duration typed as years, months, days and hours, each its own two-digit field on a blue underline, sent as the
 *  whole seconds the server takes (a month 30 days, a year 365). A zero part is faint, so the parts in use read
 *  first. Typing moves to the next part once no further digit fits; ↑/↓ step the part by one; Backspace in an empty
 *  part goes back one. Leaving the field writes the value in its largest units ("45 d" becomes "1 mo 15 d"). Time
 *  below an hour in a server default shows faint after it until the first edit. */
export function LiveDurationField({ label, value, invalid, onValue }: { label: string; value: string; invalid: boolean; onValue: (seconds: string) => void }) {
  const [parts, setParts] = useState(() => split(value));
  const sent = useRef(value), inputs = useRef<(HTMLInputElement | null)[]>([]);
  // A value from outside (Reset) redraws the fields; the field's own edits do not until it is left.
  useEffect(() => { if (value !== sent.current) { sent.current = value; setParts(split(value)); } }, [value]);
  const send = (next: Parts) => { setParts(next); sent.current = String(total(next)); onValue(sent.current); };
  const go = (at: number) => { const input = inputs.current[at]; input?.focus(); input?.select(); };
  const type = (at: number, raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    send({ fields: parts.fields.map((field, i) => i === at ? digits : field), carry: 0 });
    if (at < LAST && (digits.length === 2 || Number(digits) * 10 > SPAN_UNITS[at]!.max)) go(at + 1);
  };
  const key = (at: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && at > 0 && !parts.fields[at]) { event.preventDefault(); go(at - 1); return; }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const unit = SPAN_UNITS[at]!.seconds;
    send({ ...split(String(Math.max(0, total(parts) - parts.carry + unit * (event.key === "ArrowUp" ? 1 : -1)))), carry: 0 });
  };
  const leave = (event: FocusEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setParts((now) => split(String(total(now))));
  };
  return <span role="group" aria-label={label} onBlur={leave} className="flex flex-wrap items-baseline justify-end whitespace-pre tabular-nums">
    {SPAN_UNITS.map((unit, at) => <span key={unit.label} className="whitespace-pre">
      <input ref={(node) => { inputs.current[at] = node; }} value={parts.fields[at]} aria-label={`${label}, ${unit.name}`}
        inputMode="numeric" maxLength={2} spellCheck={false} aria-invalid={invalid} onFocus={(event) => event.target.select()}
        onChange={(event) => type(at, event.target.value)} onKeyDown={key(at)}
        className={`${FIELD} ${Number(parts.fields[at] || 0) ? "text-fg" : "text-fg-faint"}`} />
      <span className="text-fg-faint"> {unit.label}{at < LAST ? " " : ""}</span>
    </span>)}
    {parts.carry > 0 && <span className="text-fg-faint"> + {restText(parts.carry)}</span>}
  </span>;
}
