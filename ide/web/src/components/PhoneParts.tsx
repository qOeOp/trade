// The pieces a phone's pages are made of (docs/plans/ide-phone-scope-20261111.zh.md): the desktop's card, its
// equity figure (the whole part in the text colour, cents and unit faint), a change in a tinted capsule, a notice
// in a data colour, a section's heading and a held position's row.
import type { ReactNode } from "react";
import { fixed, signed } from "../lib/paperApi";
import { Icon } from "../icons/Icon";
import { pnlClass, textClass, wash, type DataRole } from "../theme/roles";
import type { Held } from "../model/phoneRuns";

/** A card that opens a page: the desktop's card surface, its chevron at the top right. */
export function PhoneCard({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
            className="relative block w-full overflow-hidden rounded-card border border-card-border bg-island-alt text-left active:bg-pressed">
      <span className="absolute right-3 top-2 text-icon"><Icon name="chevron-right" /></span>
      {children}
    </button>
  );
}

/** An amount as the equity reading shows it: the whole part large, cents and the unit faint. */
export function Amount({ value, digits = 2, unit = "USDT", size = "large" }: { value: number | null; digits?: number; unit?: string; size?: "large" | "medium" }) {
  const [whole = "–", cents = ""] = (value === null ? "" : fixed(value, digits) ?? "").split(".");
  return (
    <span className="whitespace-nowrap font-semibold tabular-nums leading-none tracking-tighter" style={{ fontSize: size === "large" ? 34 : 24 }}>
      {whole}{cents && <span className="text-fg-faint">.{cents}</span>}
      <span className="ml-1.5 align-baseline text-dense font-normal tracking-normal text-fg-faint">{unit}</span>
    </span>
  );
}

/** A change in a capsule tinted in profit's or loss's colour: the amount and the percent, or either. */
export function Change({ amount = null, ratio = null }: { amount?: number | null; ratio?: number | null }) {
  const n = ratio ?? amount, role: DataRole | null = n == null || n === 0 ? null : n > 0 ? "meets" : "fail";
  const pct = ratio == null ? null : `${ratio > 0 ? "+" : ratio < 0 ? "−" : ""}${Math.abs(ratio * 100).toFixed(2)}%`;
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-badge px-1.5 text-dense tabular-nums ${pnlClass(n)}`}
          style={{ background: role ? wash(role, 14) : undefined }}>
      {amount != null && <span>{signed(amount)}</span>}{amount != null && pct && <span className="opacity-60">·</span>}{pct}
    </span>
  );
}

/** A notice at the top of a page, in the colour of what it says, its icon first. */
export function PhoneNotice({ tone, children }: { tone: "fail" | "misses"; children: ReactNode }) {
  return (
    <p role="status" className={`flex gap-2 rounded-card border px-3 py-2 text-dense ${textClass("fg")}`}
       style={{ background: wash(tone, 8), borderColor: wash(tone, 40) }}>
      <span className={`mt-0.5 shrink-0 ${textClass(tone)}`}><Icon name="warning" /></span><span className="min-w-0">{children}</span>
    </p>
  );
}

/** A section's heading on a page: its name, and what it counts or where it is from at the right. */
export const PhoneHeading = ({ title, aside }: { title: string; aside?: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 px-3 pb-2 pt-4">
    <h2 className="text-h2 font-semibold text-fg">{title}</h2>
    {aside != null && <span className="min-w-0 truncate text-dense text-fg-faint">{aside}</span>}
  </div>
);

/** A side in its colour: Long and Buy in profit's, Short and Sell in loss's. */
export const Side = ({ long, word }: { long: boolean | null; word?: string }) => long === null ? <span className="text-fg-faint">–</span>
  : <span className={long ? "text-pnl-up" : "text-pnl-down"}>{word ?? (long ? "Long" : "Short")}</span>;

/** A held position on one line: the contract, its side, size and entry, its open profit at the right. */
export function HeldLine({ held, places = -1 }: { held: Held; places?: number }) {
  return (
    <span className="flex items-baseline gap-2 text-dense tabular-nums">
      <span className="min-w-0 truncate"><span className="font-semibold">{held.symbol}</span> <Side long={held.long} /> {fixed(held.qty)} @ {fixed(held.entry, places) ?? "–"}</span>
      {held.pnl != null && <span className={`ml-auto shrink-0 ${pnlClass(held.pnl)}`}>{signed(held.pnl)}</span>}
    </span>
  );
}

/** A plain table of a few columns at the page's edges: the first column left, the others right; a row of one cell
 *  is a note under the row above it, across the columns. */
export function PhoneTable({ head, rows }: { head: readonly string[]; rows: readonly (readonly ReactNode[])[] }) {
  return (
    <table className="w-full border-collapse text-dense tabular-nums">
      <thead><tr className="text-left text-fg-faint">{head.map((h, i) => <th key={h} className={`border-b border-line px-3 py-2 font-normal ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((row, r) => <tr key={r}>{row.length === 1
        ? <td colSpan={head.length} className="border-b border-line px-3 pb-2 pt-1.5">{row[0]}</td>
        : row.map((cell, i) => <td key={i} className={`border-b border-line px-3 py-2 ${i ? "text-right" : "font-semibold"}`}>{cell}</td>)}</tr>)}</tbody>
    </table>
  );
}

/** A list row that opens in place: its line, and under it what it holds while open. */
export function PhoneDisclosure({ open, onToggle, head, children }: { open: boolean; onToggle: () => void; head: ReactNode; children: ReactNode }) {
  return (
    <div className={`border-b border-line ${open ? "bg-island-alt" : ""}`}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left active:bg-pressed">{head}</button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
