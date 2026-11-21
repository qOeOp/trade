import type { LiveEvidence, LiveFact } from "../../model/liveTrading";
import { duration } from "../../lib/format";
import { dateTime, nsMilliseconds } from "../../lib/time";
import { useTimeZone } from "../../state/timeZone";
import { textClass } from "../../theme/roles";
import { Missing } from "../../ui/Missing";
import { Section } from "../../ui/Section";

const LONG = 24;  // a value longer than this (a hash, a digest, an ID) takes its own line under its name

/** Recorded facts as a ledger: each a line, its name at the left and its value at the right edge, rules
 *  between them; a long value stands under its name across the line, so it never squeezes the name. */
export function LiveFacts({ title, facts }: { title: string; facts: readonly LiveFact[] }) {
  const zone = useTimeZone();
  return (
    <Section title={title}>
      {facts.length ? <dl className="-my-1 divide-y divide-line">{facts.map(({ label, value, format, attention }) => {
        const at = format && value !== null ? nsMilliseconds(value) : null;
        const shown = at === null ? value : format === "since" ? `${duration(Date.now() - at)} · ${dateTime(at, zone, "minute")}` : dateTime(at, zone);
        const long = (shown?.length ?? 0) > LONG && !shown?.includes(" ");
        return <div key={label} className={`py-1 ${long ? "" : "flex items-baseline justify-between gap-x-4"}`}>
          <dt className="shrink-0 text-fg-faint">{label}</dt>
          <dd title={format && value !== null ? `${value} ns` : undefined} className={`min-w-0 wrap-anywhere tabular-nums ${long ? "mt-0.5" : "text-right"} ${attention ? textClass("misses") : ""}`}>{shown ?? <Missing />}</dd>
        </div>;
      })}</dl> : <p className="text-dense text-fg-faint">No observation received.</p>}
    </Section>
  );
}

export function LiveEvidenceList({ evidence }: { evidence: readonly LiveEvidence[] }) {
  const zone = useTimeZone();
  return (
    <Section title="Observation sources" open={false}>
      {!evidence.length ? <p className="text-dense text-fg-faint">No evidence references received.</p> : <ul className="space-y-3">{evidence.map((item, index) => (
        <li key={`${item.source}:${index}`} className="space-y-1 text-small">
          <p className="font-semibold">{item.source} · {item.complete === null ? "Completeness unknown" : item.complete ? "Complete at this cursor" : "Incomplete"}</p>
          <p className="break-all text-fg-faint">Cursor · {item.cursor ?? "Unknown"}</p>
          <p title={item.observedNs ? `${item.observedNs} ns` : undefined} className="break-all text-fg-faint">Observed · {dateTime(nsMilliseconds(item.observedNs), zone)}</p>
          {item.readNs && <p title={`${item.readNs} ns`} className="break-all text-fg-faint">Read · {dateTime(nsMilliseconds(item.readNs), zone)} · {item.state}</p>}
        </li>
      ))}</ul>}
    </Section>
  );
}
