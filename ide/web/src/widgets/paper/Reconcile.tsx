import { dateTime, utcInstant } from "../../lib/time";
import { useTimeZone } from "../../state/timeZone";
import { useState, type ReactNode } from "react";
import { fixed, symbolOf, type Precision } from "../../lib/paperApi";
import { marketThrough, MISSING, plural } from "../../lib/format";
import { TextButton } from "../../components/TextButton";
import { Tip } from "../../components/Tip";
import { FormButton } from "../../components/chat/Field";
import { reconcile, type Cause, type Group, type OrderRow, type Reconciliation, type RowClass, type Stage } from "../../state/reconcile";

const STAGE: Record<Stage, string> = { decision: "Order", fill: "Fill", fee: "Fee", funding: "Funding" };
const KIND: Record<RowClass, string> = { same: "same", time: "time", type: "type", quantity: "size", price: "price", amount: "amount", run_only: "only on paper", replay_only: "only in the replay" };
const CAUSE: Record<Exclude<Cause, "consequence">, string> = {
  missing_bar: "a live bar was missing", late_bar: "a live bar arrived late", bar_mismatch: "a live bar differed from the archive",
  warmup: "the warm-up differed from the archive", contract_terms: "the contract terms or fee rates differed", window_end: "at the stop", unexplained: "unexplained" };
const ROLE: Record<string, string> = { entry: "entry", stop: "stop", target: "target" };
const CELL = "h-(--form-h) whitespace-nowrap px-3 border-t border-line";
const HEAD = "sticky top-0 z-[1] h-(--form-h) whitespace-nowrap bg-island px-3 text-small font-normal text-fg-faint";

/** The head's right side on Reconciliation: the interval replayed (the last day of market data under the pointer),
 *  and "Replay again". */
export function ReconcileTools({ r, paperId }: { r: Reconciliation | null; paperId: number }) {
  const zone = useTimeZone();
  if (r?.state !== "done" || !r.result) return null;
  const { window: w, market_day: day } = r.result;
  return (
    <>
      <Tip content={<>Replayed with market {marketThrough(day)}</>}>
        <span className="whitespace-nowrap tabular-nums">{dateTime(utcInstant(w.start), zone, "minute")} → {dateTime(utcInstant(w.end), zone, "minute")}</span>
      </Tip>
      <TextButton onClick={() => void reconcile(paperId)}>Replay again</TextButton>
    </>
  );
}

const Count = ({ n, one, many = `${one}s`, tone }: { n: number; one: string; many?: string; tone: string }) => (
  <span><span className={n ? tone : "text-fg-muted"}>{n}</span> {n === 1 ? one : many}</span>
);
const Dot = ({ tone }: { tone: string }) => <i className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${tone}`} />;

/** What a group's first difference is: one side alone, or the stage and kind of its first differing order. */
function differs(g: Group): string {
  if (g.class === "run_only") return "Paper only";
  if (g.class === "replay_only") return "Replay only";
  if (g.stage === "funding") return "Funding";
  const row = g.first == null ? null : g.orders[g.first];
  return row && g.stage ? `${STAGE[g.stage]} ${KIND[row.class]}` : "Differs";
}

/** One order of a group: its fill (or its order when it never filled) on each side. The group's result stands on its
 *  first difference's row (its first row when that is funding); its other rows are grey. */
function Row({ g, row, i, only, p }: { g: Group; row: OrderRow; i: number; only: boolean; p: Precision }) {
  const zone = useTimeZone();
  const same = g.class === "same", suspect = !!g.look_ahead_suspect, follows = g.cause === "consequence";
  const lead = i === (g.first ?? 0);
  const price = (side: OrderRow["run"]) => {
    const value = side?.fill?.px ?? side?.price ?? side?.trigger;
    return value ? <span className={side?.fill ? "" : "text-fg-faint"}>{fixed(value, p.price) ?? value}</span> : <span className="text-fg-ghost">{MISSING}</span>;
  };
  const sides = [row.run, row.replay].filter((s) => s);
  const at = sides.map((s) => s!.fill?.ts_ns ?? s!.init_ns).sort((x, y) => x - y)[0]!;
  const bps = row.price_bps ?? null, delay = row.delay_ms ?? row.decision_delay_ms ?? null;
  return (
    <tr className={`transition-colors hover:bg-row-hover ${same || follows || !lead ? "text-fg-muted" : ""}`}>
      {!only && <td className={`${CELL} text-left`}>{lead ? symbolOf(g.instrument) : ""}</td>}
      <td className={`${CELL} text-left text-fg-muted`}>{row.side === "BUY" ? "Buy" : "Sell"} {ROLE[row.role] ?? row.role}</td>
      <td className={`${CELL} text-left text-fg-muted`}>{dateTime(Math.floor(at / 1e6), zone)}</td>
      <td className={`${CELL} text-right`}>{price(row.run)}</td>
      <td className={`${CELL} text-right`}>{price(row.replay)}</td>
      <td className={`${CELL} text-right text-fg-muted`}>{delay == null ? "" : `${delay >= 0 ? "+" : "−"}${Math.abs(delay) < 1000 ? `${Math.abs(delay)} ms` : `${(Math.abs(delay) / 1000).toFixed(1)} s`}`}</td>
      <td className={`${CELL} text-right ${bps ? "" : "text-fg-faint"}`}>{bps == null ? "" : bps === 0 ? "0" : `${bps > 0 ? "+" : "−"}${Math.abs(bps).toFixed(1)}`}</td>
      <td className={`${CELL} text-left`}>
        {same || (!lead && row.class === "same") ? <span className="text-fg-faint">Same</span> : !lead ? <span className="text-fg-muted">{STAGE[row.stage ?? "decision"]} {KIND[row.class]}</span> : <>
          <Dot tone={suspect ? "bg-fail" : follows ? "bg-fg-muted" : "bg-misses"} />
          <span className={suspect ? "text-fail" : follows ? "text-fg-muted" : "text-misses-fg"}>{differs(g)}</span>
          {row.class === "quantity" && <span className="text-fg-muted"> {fixed(row.run?.fill?.qty ?? row.run?.qty, p.size) ?? MISSING} vs {fixed(row.replay?.fill?.qty ?? row.replay?.qty, p.size) ?? MISSING}</span>}
          {g.cause && <span className="text-fg-muted"> · {suspect ? "look-ahead suspect"
            : g.cause === "consequence" ? `after the difference at ${g.follows ? dateTime(utcInstant(g.follows), zone) : MISSING}` : CAUSE[g.cause]}</span>}
        </>}
      </td>
    </tr>
  );
}

function Prompt({ children, action, label }: { children: ReactNode; action?: () => void; label?: string }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-3 px-3 text-center text-dense text-fg-muted">
      <p className="max-w-[52ch] text-pretty">{children}</p>
      {action && <FormButton primary icon="run" onClick={action}>{label}</FormButton>}
    </div>
  );
}

/** A sealed run against its replay on the archive, in one line of counts and then each group: an entry order with
 *  its position's stops and exits, paired with the replay's. A group's first difference (an order, its fill, its fee
 *  or the position's funding) stands on its row with why: a live bar missing, late or unlike the archive's, the
 *  warm-up, the contract terms or fee rates, the stop, or none of these, which for something only the replay did
 *  marks a look-ahead suspect. Once a contract's paths part, its later differences follow from the first and are
 *  grey. Differences are amber, suspects red. When nothing differs, the matching groups fold into one row. */
export function Reconcile({ r, paperId, sealed, only, digits }: {
  r: Reconciliation | null; paperId: number; sealed: boolean; only: string | null; digits: ReadonlyMap<string, Precision>;
}) {
  const [open, setOpen] = useState(false);
  if (!sealed) return <Prompt>A run is compared with its replay once it is sealed: stop it, then replay it here.</Prompt>;
  if (!r || r.paper_id !== paperId) return <Prompt>Reading the run's reconciliation…</Prompt>;
  if (r.state === "none") return <Prompt action={() => void reconcile(paperId)} label="Replay and compare">Replay this run on the archived bars of the same interval, with the same source, image and warm-up, and compare every order. Nothing is recorded.</Prompt>;
  if (r.state === "reconciling") return <Prompt>Replaying on the archive… a run of an hour takes about half a minute.</Prompt>;
  if (r.state === "failed" || !r.result) {
    const uncovered = r.error?.code === "PAPER_RECONCILE_UNCOVERED";
    return <Prompt action={() => void reconcile(paperId)} label="Try again">
      <span className={uncovered ? "" : "text-fail"}>{uncovered ? "The market does not hold this run's minutes yet. " : `${r.error?.code ?? "Failed"}: `}</span>{r.error?.message}
    </Prompt>;
  }
  const { groups, inputs, replay } = r.result;
  const barsOf = (only ? [inputs[only]].filter(Boolean) : Object.values(inputs)).map((c) => c!.bars);
  const missing = barsOf.reduce((n, b) => n + b.missing_bars, 0), late = barsOf.reduce((n, b) => n + b.late_bars, 0);
  const unlike = barsOf.reduce((n, b) => n + b.differing_bars, 0);
  const barCounts = <span className="text-fg-faint">{plural(missing, "live bar")} missing, {late} late, {unlike} unlike the archive</span>;
  const invalid = replay.status === "invalid" && <p className="px-3 pb-2 text-dense text-fail">The replay is invalid: {replay.problems.map((p) => p.code ?? p.message).join(", ")}</p>;
  if (!groups) return (
    <div className="flex flex-col">
      <p className="flex flex-wrap gap-x-2 gap-y-1 px-3 py-2 text-dense tabular-nums text-fg-muted">
        <span className="text-fail">The replay wrote no order events, so its orders cannot be compared</span>
        <span className="text-fg-faint">·</span>{barCounts}
      </p>
      {invalid}
    </div>
  );
  // Newest first, what differs above what is the same.
  const mine = (only ? groups.filter((g) => symbolOf(g.instrument) === only) : groups).slice().reverse();
  const differ = mine.filter((g) => g.class !== "same"), same = mine.filter((g) => g.class === "same");
  const count = (k: Group["class"]) => mine.filter((g) => g.class === k).length;
  const suspects = mine.filter((g) => g.look_ahead_suspect).length;
  const following = mine.filter((g) => g.cause === "consequence").length;
  const shown = differ.length || open ? [...differ, ...same] : differ;
  return (
    <div className="flex flex-col">
      <p className="flex flex-wrap gap-x-2 gap-y-1 px-3 py-2 text-dense tabular-nums text-fg-muted">
        {[
          <span key="same"><span className="text-fg">{same.length}</span> of {plural(mine.length, "trade")} the same</span>,
          <Count key="differ" n={count("differs")} one="differs" many="differ" tone="text-misses-fg" />,
          <Count key="paper" n={count("run_only")} one="only on paper" many="only on paper" tone="text-misses-fg" />,
          <Count key="replay" n={count("replay_only")} one="only in the replay" many="only in the replay" tone="text-misses-fg" />,
          <Count key="suspects" n={suspects} one="look-ahead suspect" tone="text-fail" />,
          ...(following ? [<span key="following" className="text-fg-faint">{following} after an earlier difference</span>] : []),
          <span key="bars">{barCounts}</span>,
        ].flatMap((item, i) => (i ? [<span key={`sep-${i}`} className="text-fg-faint">·</span>, item] : [item]))}
      </p>
      {invalid}
      {mine.length ? (
        <table className="w-full border-collapse text-dense tabular-nums">
          {shown.length > 0 && <thead><tr>
            {!only && <th className={`${HEAD} text-left`}>Contract</th>}<th className={`${HEAD} text-left`}>Order</th><th className={`${HEAD} text-left`}>Time</th>
            <th className={`${HEAD} text-right`}>Paper</th><th className={`${HEAD} text-right`}>Replay</th>
            <th className={`${HEAD} text-right`}>Delay</th><th className={`${HEAD} text-right`}>Price, bp</th><th className={`${HEAD} text-left`}>Result</th>
          </tr></thead>}
          <tbody>
            {shown.flatMap((g, k) => g.orders.map((row, i) => <Row key={`${k}-${row.run?.order ?? ""}-${row.replay?.order ?? ""}-${i}`} g={g} row={row} i={i} only={!!only} p={digits.get(symbolOf(g.instrument)) ?? { price: -1, size: -1 }} />))}
            {!differ.length && (
              <tr><td colSpan={only ? 7 : 8} className={`${CELL} bg-island-alt text-left text-fg-faint`}>
                <TextButton className="-ml-1 text-small" onClick={() => setOpen(!open)}>{open ? "Hide the matching trades" : `Show the ${plural(same.length, "matching trade")}`}</TextButton>
              </td></tr>
            )}
          </tbody>
        </table>
      ) : <p className="px-3 py-3 text-dense text-fg-faint">Neither side sent an order{only ? ` on ${only}` : ""}</p>}
    </div>
  );
}
