import { useEffect, useState } from "react";
import { PhonePage } from "../../components/PhoneBar";
import { PhoneDisclosure } from "../../components/PhoneParts";
import { ReadingBadge } from "../../components/ReadingBadge";
import { Missing } from "../../components/Missing";
import { pct } from "../../lib/format";
import type { ResearchLine } from "../../lib/lines";
import { meets } from "../../model/semantics";
import { askReading, followReadings, useLineReadings, type LineReading } from "../../state/researchReadings";
import { useResearchLines } from "../../state/researchLines";
import { Track } from "../../widgets/detail/ReadingsBoard";
import { PhoneTop } from "./PhoneTop";

const short = (bundle: string) => bundle.replace(/^research-line-/, "");
const Said = ({ ok, yes, no }: { ok: boolean; yes: string; no: string }) => <span className={ok ? "text-meets" : "text-misses"}>{ok ? yes : no}</span>;

/** What a line recommends, opened in its row: the version, its max drawdown along the track to the limit, its annual
 *  return against the minimum, and how long the recommendation has stood. */
function Opened({ line, r }: { line: ResearchLine; r: LineReading | undefined }) {
  if (!r) return <p className="text-dense text-fg-faint">Not drawn yet. The server is drawing this line's graph; its readings show here in about 20 s.</p>;
  const limit = r.targets?.max_drawdown ?? null, minimum = r.targets?.annual_return ?? null, dd = r.reading?.max_drawdown ?? null, annual = r.reading?.annual_return ?? null;
  return (
    <div className="space-y-2 text-dense">
      <p className="flex min-w-0 gap-2"><span className="shrink-0 text-fg-faint">Recommended</span><span className="truncate font-mono">{r.recommended ?? "None yet"}</span></p>
      {r.recommended && limit !== null && dd !== null && <div className="space-y-1.5 tabular-nums">
        <p className="flex justify-between"><span>Max drawdown</span><span>{pct(dd)}</span></p>
        <Track used={Math.min(1, dd / limit)} now={Math.min(1, dd / limit)} />
        <p className="flex justify-between pl-3"><span><Said ok={meets(dd, limit, false) === true} yes="Within" no="Over" /> the limit</span><span>{pct(limit)}</span></p>
      </div>}
      {r.recommended && minimum !== null && <p className="flex justify-between tabular-nums"><span>Annual return <span className="text-fg-faint">· at least {pct(minimum)}</span></span>
        <span>{annual === null ? <Missing /> : <Said ok={meets(annual, minimum, true) === true} yes={pct(annual)} no={pct(annual)} />}</span></p>}
      <p className="text-fg-muted">{r.recommended ? (r.runs_since_recommendation_changed ? `Unchanged for the last ${r.runs_since_recommendation_changed} of ${r.research_runs} research runs` : `Changed at the latest of ${r.research_runs} research runs`) : `${r.research_runs} research runs`} · {line.closed ? "closed" : "open"} · {line.window_start} to {line.window_end}</p>
    </div>
  );
}

/** The Research tab: every line, open ones first and the newest first, each its recommended version's readings as
 *  the desktop's badge, opening in place. The graph, versions and sources are the desktop's. */
export function ResearchTab() {
  const { lines, loaded, error } = useResearchLines(), readings = useLineReadings().lines;
  const asked = new URLSearchParams(window.location.search).get("line"), [open, setOpen] = useState<string | null>(asked);
  useEffect(() => { followReadings(true); return () => followReadings(false); }, []);
  useEffect(() => { if (open) askReading(open); }, [open]);
  const order = [...lines].reverse().sort((a, b) => Number(a.closed) - Number(b.closed)), closed = lines.filter((l) => l.closed).length;
  return (
    <>
      <PhoneTop title="Research" aside={loaded ? `${lines.length - closed} open · ${closed} closed` : undefined} line={open} />
      <PhonePage>
        {!loaded && <p className="p-4 text-dense text-fg-faint">{error ?? "Reading the research lines…"}</p>}
        {loaded && <p className="flex justify-between border-b border-line px-3 py-1.5 text-small text-fg-faint"><span>Annual | max drawdown, recommended</span><span>Versions</span></p>}
        {order.map((line) => {
          const r = readings[line.bundle];
          return (
            <PhoneDisclosure key={line.bundle} open={open === line.bundle} onToggle={() => setOpen(open === line.bundle ? null : line.bundle)}
              head={<><ReadingBadge reading={r?.recommended ? r.reading : null} targets={r?.targets ?? line.targets ?? null} />
                <span className={`min-w-0 flex-1 truncate font-mono text-dense ${line.closed ? "text-fg-muted" : ""}`}>{short(line.bundle)}</span>
                <span className="shrink-0 text-dense tabular-nums text-fg-faint">{line.versions.length}</span></>}>
              <Opened line={line} r={r} />
            </PhoneDisclosure>
          );
        })}
      </PhonePage>
    </>
  );
}
