import { useEffect } from "react";
import { useView } from "../../model/view";
import { meets } from "../../model/semantics";
import type { Targets } from "../../model/types";
import { pct } from "../../lib/format";
import { lineHref, type ResearchLine } from "../../lib/lines";
import { readResearchLines, type LineIndex } from "../../state/researchLines";
import { followReadings, useLineReadings, type LineReading } from "../../state/researchReadings";
import { DropdownGrid, DropdownGridLabel, DropdownGridLink, DropdownGridSeparator, DropdownItem, DropdownLabel } from "../../components/Dropdown";
import { Missing } from "../../components/Missing";

// Check, name, development, recommended version, annual return, max drawdown; the two numbers share one width.
const COLS = "grid-cols-[1.5rem_repeat(3,max-content)_repeat(2,minmax(5rem,max-content))]";
const NAME = "pl-2", DEV = "pl-4 tabular-nums", VERSION = "pl-4", NUMBER = "pl-3 text-right tabular-nums";

/** The targets every line shares, or null when they differ. */
function shared(lines: readonly ResearchLine[]): Targets | null {
  const key = (l: ResearchLine) => `${l.targets?.annual_return ?? ""}|${l.targets?.max_drawdown ?? ""}`, first = lines[0];
  return first && lines.every((l) => key(l) === key(first)) ? first.targets ?? null : null;
}

/** A development window by months when every window is whole months, else by days on every row. */
const monthly = (lines: readonly ResearchLine[]) => lines.every((l) => {
  const [y = 0, m = 0, d = 0] = l.dev_end.split("-").map(Number);
  return l.dev_start.endsWith("-01") && new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
});

/** One reading against its target: plain when it meets it or has none, the misses colour when it does not. */
function Value({ value, target, higher, name }: { value: number | null; target: number | null | undefined; higher: boolean; name: string }) {
  if (value === null) return <span className={NUMBER}><Missing /></span>;
  const missed = meets(value, target, higher) === false;
  return <span className={`${NUMBER} ${missed ? "text-misses" : ""}`}
               title={`${name} ${pct(value)}${target == null ? "" : ` · ${higher ? "at least" : "limit"} ${pct(target)}`}`}>{pct(value)}</span>;
}

/** The recommendation's cells: version, annual return, max drawdown; the wording of the phone's Research tab. */
function Recommendation({ r, targets }: { r: LineReading | null | undefined; targets: Targets | null }) {
  if (r === undefined) return <><span className={VERSION}><Missing /></span><span className={NUMBER}><Missing /></span><span className={NUMBER}><Missing /></span></>;
  if (r === null) return <span className={`${VERSION} col-span-3 text-fg-faint`}>No recommendation yet</span>;
  const [name, revision] = r.recommended.split("@");
  const version = <span className={`${VERSION} font-mono text-fg-muted`}>{name}{revision !== undefined && <span className="text-fg-faint">@{revision}</span>}</span>;
  if (r.eligible === false) return <>{version}<span className={`${NUMBER} col-span-2 text-misses`}
    title={`Its latest research run${r.trial_id ? ` (trial ${r.trial_id})` : ""} no longer carries economic evidence.`}>Ineligible now</span></>;
  return <>{version}
    <Value value={r.annual_return} target={targets?.annual_return} higher name="Annual return" />
    <Value value={r.max_drawdown} target={targets?.max_drawdown} higher={false} name="Max drawdown" /></>;
}

/** The preloaded index remains visible while a newer ledger head refreshes it: open lines then closed ones, newest
 *  first, one row each with its development window and its recommendation (GET /api/readings), read only while the
 *  menu is open, since Radix mounts the menu's content only then. */
export function ResearchLines({ index }: { index: LineIndex }) {
  const { line } = useView();
  const { lines, loaded, loading, error } = index;
  const { lines: readings } = useLineReadings();
  useEffect(() => { followReadings(true); return () => followReadings(false); }, []);
  const newest = [...lines].reverse(), common = shared(lines), byMonth = monthly(lines);
  const sections = [["Open", newest.filter((l) => !l.closed)], ["Closed", newest.filter((l) => l.closed)]] as const;
  const when = (l: ResearchLine) => byMonth ? `${l.dev_start.slice(0, 7)} → ${l.dev_end.slice(0, 7)}` : `${l.dev_start} → ${l.dev_end}`;
  const goal = (label: string, target: number | null | undefined, sign: string) =>
    <span className={NUMBER}>{label}{common && target != null && <span className="block">{sign}{pct(target)}</span>}</span>;
  return <>
    {!loaded && !error && <DropdownLabel>Reading research lines…</DropdownLabel>}
    {loaded && !error && lines.length === 0 && <DropdownLabel>No research lines yet</DropdownLabel>}
    {loaded && <DropdownGrid cols={COLS}>
      {sections.filter(([, rows]) => rows.length).map(([title, rows], i) => <div key={title} className="contents">
        {i > 0 && <DropdownGridSeparator />}
        <DropdownGridLabel sticky={i === 0}>
          <span className={NAME}>{title} · {rows.length}{i === 0 && loading ? " · Updating…" : ""}</span>
          {i === 0 && <>
            <span className={DEV}>Development</span><span className={VERSION}>Recommended</span>
            {goal("Annual", common?.annual_return, "≥")}{goal("Max DD", common?.max_drawdown, "≤")}
          </>}
        </DropdownGridLabel>
        {rows.map((item) => <DropdownGridLink key={item.name} href={lineHref(window.location.href, item.name)} current={item.name === line.bundle}>
          <span title={item.name} className={`${NAME} block max-w-[22ch] truncate font-mono ${item.closed ? "text-fg-muted" : ""}`}>{item.name.replace(/^research-line-/, "")}</span>
          <span className={`${DEV} text-fg-faint`} title={byMonth ? `${item.dev_start} → ${item.dev_end}` : undefined}>{when(item)}</span>
          <Recommendation r={readings[item.name]} targets={item.targets ?? null} />
        </DropdownGridLink>)}
      </div>)}
    </DropdownGrid>}
    {error && <DropdownItem onSelect={() => void readResearchLines(new URLSearchParams(window.location.search).get("at"), true)} hint="Retry">
      {error}
    </DropdownItem>}
  </>;
}
