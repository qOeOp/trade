import { useMemo } from "react";
import { Popover } from "radix-ui";
import { Icon } from "../icons/Icon";
import { when, MISSING } from "../lib/format";
import { position, publishOverdue, rows, summary, type Entry, type Refusal, type Reply, type Row } from "../model/marketImport";
import { readMarketImport, useMarketImport } from "../state/marketImport";
import { textClass } from "../theme/roles";
import { columns, DataTable } from "./DataTable";
import { Tip } from "./Tip";

// Only the states the healthcheck fails on are coloured; the refusal beside them keeps the text colour.
const STATE: Record<Entry["state"], { label: string; tone: "fail" | "misses" | "fg" }> = {
  caught_up: { label: "caught up", tone: "fg" }, waiting: { label: "waiting", tone: "fg" },
  lagging: { label: "lagging", tone: "misses" }, stopped: { label: "stopped", tone: "fail" }, unknown: { label: "unknown", tone: "fail" },
};
const utc = (v?: string | null) => (v ? `${when(new Date(Date.parse(v)).toISOString())} UTC` : MISSING);

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

function Line({ label, refusal, tone = "fail" }: { label: string; refusal?: Refusal | null; tone?: "fail" | "misses" }) {
  if (!refusal) return null;
  return <p className={textClass(tone)}>{label} {refusal.code}{refusal.message && <span className="text-fg-muted"> · {refusal.message}</span>}</p>;
}

function Details({ reply }: { reply: Reply }) {
  const { status } = reply, data = useMemo(() => rows(status), [status]);
  return (
    <>
      <div className="flex flex-col gap-0.5 px-2 pt-1 pb-2 text-fg-muted">
        <p>Last round {utc(status.at)}{status.running_since ? ` · running since ${utc(status.running_since)}` : ` · next ${utc(status.next_round)}`}</p>
        <Line label="Round refused:" refusal={status.round_refusal} />
        <Line label={`Publish refused${status.publish_failing_since ? ` since ${utc(status.publish_failing_since)}` : ""}:`} refusal={status.publish_refusal}
              tone={publishOverdue(reply) ? "fail" : "misses"} />
      </div>
      <div className="[&_tbody_tr:last-child_td]:border-b-0">
        <DataTable data={data} columns={TABLE} rowId={(r) => `${r.kind}/${r.contract}`} sticky={false} />
      </div>
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
    : said.running ? <><Icon name="loading" size={12} className="motion-safe:animate-spin motion-reduce:hidden" /><Icon name="history" size={12} className="motion-safe:hidden" /></>
      : null;
  return (
    <Popover.Root onOpenChange={(open) => { if (open) void readMarketImport(); }}>
      <Popover.Trigger aria-label={`${said.text}${said.running ? ", importing" : ""}. Show the market import's status`}
        className="-mx-1.5 flex min-w-0 items-center gap-1.5 rounded-control px-1.5 text-fg-muted transition-colors hover:bg-hover active:bg-pressed data-[state=open]:bg-pressed">
        {icon}<span className="truncate">{said.text}{said.running && " · importing"}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="end" sideOffset={4} collisionPadding={8}
          className="z-50 max-h-[min(440px,var(--radix-popover-content-available-height))] w-max max-w-[min(720px,var(--radix-popover-content-available-width))] overflow-auto rounded-popup border border-popup-border bg-popup p-1 text-dense shadow-popup outline-none">
          {service.kind === "ready" ? <Details reply={service.reply} />
            : <p className="px-2 py-1 text-fail">{service.error.code}{service.error.message && <span className="text-fg-muted"> · {service.error.message}</span>}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
