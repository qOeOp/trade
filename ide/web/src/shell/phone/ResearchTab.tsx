import { useEffect, useState } from "react";
import { PhonePage } from "../../components/PhoneBar";
import { PhoneDisclosure } from "../../components/PhoneParts";
import { ReadingBadge } from "../../components/ReadingBadge";
import { Missing } from "../../components/Missing";
import { ResearchSyncLine } from "../../components/ResearchSync";
import { pct } from "../../lib/format";
import type { ResearchLine } from "../../lib/lines";
import { meets } from "../../model/semantics";
import { followReadings, useLineReadings, type LineReading } from "../../state/researchReadings";
import { useResearchLines } from "../../state/researchLines";
import { Track } from "../../widgets/detail/ReadingsBoard";
import { PhoneTop } from "./PhoneTop";

const short = (bundle: string) => bundle.replace(/^research-line-/, "");
const Said = ({ ok, yes, no }: { ok: boolean; yes: string; no: string }) => <span className={ok ? "text-meets" : "text-misses"}>{ok ? yes : no}</span>;

/** What a line recommends, opened in its row: the version, its max drawdown along the track to the limit, its annual
 *  return against the minimum, and how long the recommendation has stood; or that its latest research run is no
 *  longer eligible (CF-08). */
function Opened({ line, r, read }: { line: ResearchLine; r: LineReading | null | undefined; read: boolean }) {
  const tail = <>{line.closed ? "closed" : "open"} · development {line.dev_start} to {line.dev_end}</>;
  if (r === undefined) return <p className="text-dense text-fg-faint">{read ? "Not in the last reading" : "Reading the ledger…"}</p>;
  if (r === null) return <p className="text-dense text-fg-muted">No recommendation yet · {tail}</p>;
  const limit = line.targets?.max_drawdown ?? null, minimum = line.targets?.annual_return ?? null, dd = r.max_drawdown, annual = r.annual_return;
  return (
    <div className="space-y-2 text-dense">
      <p className="flex min-w-0 gap-2"><span className="shrink-0 text-fg-faint">Recommended</span><span className="truncate font-mono">{r.recommended}</span>
        {r.eligible === false && <span className="shrink-0 text-misses">Ineligible now</span>}</p>
      {r.eligible === false && <p className="text-fg-muted">Its latest research run{r.trial_id ? ` (trial ${r.trial_id})` : ""} no longer carries economic evidence.</p>}
      {limit !== null && dd !== null && <div className="space-y-1.5 tabular-nums">
        <p className="flex justify-between"><span>Max drawdown</span><span>{pct(dd)}</span></p>
        <Track used={Math.min(1, dd / limit)} now={Math.min(1, dd / limit)} />
        <p className="flex justify-between pl-3"><span><Said ok={meets(dd, limit, false) === true} yes="Within" no="Over" /> the limit</span><span>{pct(limit)}</span></p>
      </div>}
      {r.eligible !== false && minimum !== null && <p className="flex justify-between tabular-nums"><span>Annual return <span className="text-fg-faint">· at least {pct(minimum)}</span></span>
        <span>{annual === null ? <Missing /> : <Said ok={meets(annual, minimum, true) === true} yes={pct(annual)} no={pct(annual)} />}</span></p>}
      <p className="text-fg-muted">{r.runs_since ? `Unchanged for the last ${r.runs_since} of ${r.research_runs} research runs` : `Changed at the latest of ${r.research_runs} research runs`} · {tail}</p>
    </div>
  );
}

/** The Research tab: the research sync's state where this IDE follows DoltHub, then every line, open ones first and the newest first, each its recommendation read from the ledger as
 *  the desktop's badge, opening in place. The graph, versions and sources are the desktop's. */
export function ResearchTab() {
  const { lines, loaded, error } = useResearchLines(), { lines: readings, read } = useLineReadings();
  const asked = new URLSearchParams(window.location.search).get("line"), [open, setOpen] = useState<string | null>(asked);
  useEffect(() => { followReadings(true); return () => followReadings(false); }, []);
  const order = [...lines].reverse().sort((a, b) => Number(a.closed) - Number(b.closed)), closed = lines.filter((l) => l.closed).length;
  return (
    <>
      <PhoneTop title="Research" aside={loaded ? `${lines.length - closed} open · ${closed} closed` : undefined} line={open} />
      <PhonePage>
        <ResearchSyncLine />
        {!loaded && <p className="p-4 text-dense text-fg-faint">{error ?? "Reading the research lines…"}</p>}
        {loaded && <p className="flex justify-between border-b border-line px-3 py-1.5 text-small text-fg-faint"><span>Annual | max drawdown, recommended</span><span>Versions</span></p>}
        {order.map((line) => {
          const r = readings[line.name];
          return (
            <PhoneDisclosure key={line.name} open={open === line.name} onToggle={() => setOpen(open === line.name ? null : line.name)}
              head={<><ReadingBadge reading={r && r.eligible !== false ? r : null} targets={line.targets ?? null}
                                    status={r?.eligible === false ? "Ineligible" : r === null ? "None" : undefined} />
                <span className={`min-w-0 flex-1 truncate font-mono text-dense ${line.closed ? "text-fg-muted" : ""}`}>{short(line.name)}</span>
                <span className="shrink-0 text-dense tabular-nums text-fg-faint">{line.versions.length}</span></>}>
              <Opened line={line} r={r} read={read} />
            </PhoneDisclosure>
          );
        })}
      </PhonePage>
    </>
  );
}
