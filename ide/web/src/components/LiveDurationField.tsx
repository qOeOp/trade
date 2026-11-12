import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MAX_SPAN } from "../model/liveLaunch";

type Parts = { h: string; m: string; carry: number };
/** Whole seconds as hours, two-digit minutes, and the seconds below a minute a server default may carry. */
const split = (seconds: string): Parts => {
  const n = /^\d+$/.test(seconds) ? Number(seconds) : 0;
  return { h: String(Math.floor(n / 3600)), m: String(Math.floor((n % 3600) / 60)).padStart(2, "0"), carry: n % 60 };
};
const FIELD = "w-[2ch] border-0 border-b border-link bg-transparent px-0 pb-px text-right tabular-nums text-fg outline-none hover:bg-hover focus:border-b-2 focus:pb-0 aria-invalid:border-fail";

/** A duration as hours and minutes, each its own field on a blue underline as long as its two digits, so the value
 *  reads as it is meant ("24 h 00 min") and is still exactly the whole seconds the server takes. Typing moves from
 *  hours to minutes on its own; ↑/↓ step an hour, or 5 minutes (15 with Shift); Backspace in empty minutes goes back
 *  to hours. Seconds a server default carries below a minute show faint after it and are kept until the first edit. */
export function LiveDurationField({ label, value, invalid, onValue }: { label: string; value: string; invalid: boolean; onValue: (seconds: string) => void }) {
  const [parts, setParts] = useState(() => split(value));
  const sent = useRef(value), minutes = useRef<HTMLInputElement>(null), hours = useRef<HTMLInputElement>(null);
  // A value from outside (a preset, Reset) redraws the fields; the field's own edits do not.
  useEffect(() => { if (value !== sent.current) { sent.current = value; setParts(split(value)); } }, [value]);
  const send = (next: Parts) => {
    setParts(next);
    sent.current = String(Number(next.h || 0) * 3600 + Number(next.m || 0) * 60 + next.carry);
    onValue(sent.current);
  };
  const type = (part: "h" | "m", raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    send({ ...parts, [part]: digits, carry: 0 });
    if (part === "h" && (digits.length === 2 || Number(digits) >= 3)) { minutes.current?.focus(); minutes.current?.select(); }
  };
  const key = (part: "h" | "m") => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && part === "m" && !parts.m) { event.preventDefault(); hours.current?.focus(); return; }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const step = (part === "h" ? 3600 : event.shiftKey ? 900 : 300) * (event.key === "ArrowUp" ? 1 : -1);
    const total = Math.min(MAX_SPAN, Math.max(0, Number(sent.current) - parts.carry + step));
    send({ ...split(String(total)), carry: 0 });
  };
  const field = (part: "h" | "m", name: string) => <input ref={part === "h" ? hours : minutes} value={parts[part]} aria-label={`${label}, ${name}`}
    inputMode="numeric" maxLength={2} spellCheck={false} aria-invalid={invalid} className={FIELD}
    onFocus={(event) => event.target.select()} onChange={(event) => type(part, event.target.value)} onKeyDown={key(part)}
    onBlur={() => setParts((now) => ({ ...now, m: now.m.padStart(2, "0"), h: now.h || "0" }))} />;
  return <span role="group" aria-label={label} className="flex items-baseline whitespace-pre tabular-nums">
    {field("h", "hours")}<span className="text-fg-faint"> h </span>{field("m", "minutes")}<span className="text-fg-faint"> min</span>
    {parts.carry > 0 && <span className="text-fg-faint"> + {parts.carry} s</span>}
  </span>;
}
