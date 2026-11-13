import { useTimeZone } from "../state/timeZone";
import { useMemo } from "react";
import { Icon } from "../icons/Icon";
import { when, MISSING } from "../lib/format";
import { position, rows, summary, type Entry, type Refusal, type Reply, type Row } from "../model/marketImport";
import { readMarketImport, useMarketImport } from "../state/marketImport";
import { textClass } from "../theme/roles";
import { columns, DataTable } from "./DataTable";
import { Spinner } from "./Spinner";
import { StatusPopover, StatusTable } from "./StatusPopover";
import { Tip } from "./Tip";

// Only the states the healthcheck fails on are coloured; the refusal beside them keeps the text colour.
const STATE: Record<Entry["state"], { label: string; tone: "fail" | "misses" | "fg" }> = {
  caught_up: { label: "caught up", tone: "fg" }, waiting: { label: "waiting", tone: "fg" },
  lagging: { label: "lagging", tone: "misses" }, stopped: { label: "stopped", tone: "fail" }, unknown: { label: "unknown", tone: "fail" },
};

const col = columns<Row>();
const TABLE = [
  col.accessor("kind", { header: "Kind" }),
  col.accessor("contract", { header: "Contract" }),
  col.accessor((r) => r.entry.state, { id: "state", header: "State", cell: (c) => <span className={textClass(STATE[c.getValue<Entry["state"]>()]?.tone ?? "fg")}>{STATE[c.getValue<Entry["state"]>()]?.label ?? c.getValue()}</span> }),
  col.accessor((r) => position(r.entry), { id: "position", header: "Next / through", cell: (c) => c.getValue() || MISSING }),
  col.accessor((r) => (r.entry.skipped ?? []).join(", "), { id: "skipped", header: "Skipped", cell: (c) => c.getValue() || MISSING }),
  col.accessor((r) => r.entry.refusal?.code ?? r.entry.retry?.code ?? "", { id: "refusal", header: "Refusal", cell: (c) => <Refused entry={c.row.original.entry} /> }),
];

function Refused({ entry }: { entry: Entry }) {
  const refusal = entry.refusal ?? entry.retry;
  if (!refusal) return <>{MISSING}</>;
  return (
    <Tip content={refusal.message}>
      <span className={entry.refusal ? "" : "text-fg-muted"}>{refusal.code}{!entry.refusal && " · retrying"}</span>
    </Tip>
  );
}

function Line({ label, refusal }: { label: string; refusal?: Refusal | null }) {
  if (!refusal) return null;
  return <p className="text-fail-fg">{label} {refusal.code}{refusal.message && <span className="text-fg-muted"> · {refusal.message}</span>}</p>;
}

function Details({ reply }: { reply: Reply }) {
  const zone = useTimeZone(), at = (v?: string | null) => v ? when(v, zone) : MISSING;
  const { status } = reply, data = useMemo(() => rows(status), [status]);
  return (
    <>
      <div className="flex flex-col gap-0.5 px-2 pt-1 pb-2 text-fg-muted">
        <p>Last round {at(status.at)}{status.running_since ? ` · running since ${at(status.running_since)}` : ` · next ${at(status.next_round)}`}</p>
        <Line label="Round refused:" refusal={status.round_refusal} />
      </div>
      <StatusTable><DataTable data={data} columns={TABLE} rowId={(r) => `${r.kind}/${r.contract}`} sticky={false} /></StatusTable>
    </>
  );
}

/** The status bar's item for the unattended market import (`market follow`): its state in one line, the
 *  icon in the failure or misses colour when the service is stopped, stuck or behind; clicking it lists
 *  each kind and contract as the service's status file has them. Nothing when the server has no status. */
export function MarketImportStatus() {
  const service = useMarketImport();
  if (service.kind === "checking" || service.kind === "absent") return null;
  const said = service.kind === "ready" ? summary(service.reply) : { text: "Market: no status", tone: "fail" as const, running: false };
  const icon = said.tone ? <Icon name="warning" size={12} tone={said.tone} />
    : said.running ? <Spinner />
      : null;
  return (
    <StatusPopover label={`${said.text}${said.running ? ", importing" : ""}. Show the market import's status`} onOpen={() => void readMarketImport()}
      className="flex min-w-0 items-center gap-1.5 text-fg-muted" trigger={<>{icon}<span className="truncate">{said.text}{said.running && " · importing"}</span></>}>
      {service.kind === "ready" ? <Details reply={service.reply} />
        : <p className="px-2 py-1 text-fail-fg">{service.error.code}{service.error.message && <span className="text-fg-muted"> · {service.error.message}</span>}</p>}
    </StatusPopover>
  );
}
