import { useState, type ReactNode } from "react";
import { fixed, symbolOf, type Precision } from "../../lib/paperApi";
import { MISSING, plural } from "../../lib/format";
import { TextButton } from "../../components/TextButton";
import { Tip } from "../../components/Tip";
import { FormButton } from "../../components/chat/Field";
import { reconcile, type Cause, type FillClass, type Matched, type Reconciliation } from "../../state/reconcile";

const RESULT: Record<FillClass, string> = { same: "Same", price: "Price", quantity: "Size", time: "Time", paper_only: "Paper only", replay_only: "Replay only" };
const CAUSE: Record<Exclude<Cause, "consequence">, string> = { live_gap: "a live bar was missing", bar_mismatch: "a live bar differed from the archive", window_end: "at the stop", unexplained: "unexplained" };
const ROLE: Record<string, string> = { entry: "entry", stop: "stop", target: "target" };
const CELL = "h-9 whitespace-nowrap px-3 first:pl-5 last:pr-5 border-t border-line";
const HEAD = "sticky top-0 z-[1] h-8 whitespace-nowrap bg-island px-3 text-small font-normal text-fg-faint first:pl-5 last:pr-5";
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const clock = (ts: string) => ts.slice(11, 19);

/** The head's right side on Reconciliation: the interval replayed (the market commit under the pointer),
 *  and "Replay again". */
export function ReconcileTools({ r, paperId }: { r: Reconciliation | null; paperId: number }) {
  if (r?.state !== "done" || !r.result) return null;
  const { window: w, market_commit: commit } = r.result;
  return (
    <>
      <Tip content={<>Replayed at market commit <span className="font-mono">{commit}</span></>}>
        <span className="whitespace-nowrap tabular-nums">{DAY.format(Date.parse(w.start)).replace(",", "")}–{clock(w.end).slice(0, 5)} UTC</span>
      </Tip>
      <TextButton className="text-fg-muted underline underline-offset-3" onClick={() => void reconcile(paperId)}>Replay again</TextButton>
    </>
  );
}

const Count = ({ n, one, many = `${one}s`, tone }: { n: number; one: string; many?: string; tone: string }) => (
  <span><span className={n ? tone : "text-fg-muted"}>{n}</span> {n === 1 ? one : many}</span>
);
const Dot = ({ tone }: { tone: string }) => <i className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${tone}`} />;

function Row({ m, only, p }: { m: Matched; only: boolean; p: Precision }) {
  const same = m.class === "same", suspect = !!m.look_ahead_suspect, follows = m.cause === "consequence";
  const price = (fill: Matched["paper"]) => (fill ? fixed(fill.px, p.price) ?? fill.px : <span className="text-fg-ghost">{MISSING}</span>);
  // The earlier side, as the rows are ordered and a later difference names the one it follows.
  const bps = m.price_bps ?? null, at = [m.paper, m.replay].filter((f) => f).sort((x, y) => x!.ts_ns - y!.ts_ns)[0]!;
  return (
    <tr className={`transition-colors hover:bg-row-hover ${same || follows ? "text-fg-muted" : ""}`}>
      {!only && <td className={`${CELL} text-left`}>{symbolOf(m.instrument)}</td>}
      <td className={`${CELL} text-left text-fg-muted`}>{m.side === "BUY" ? "Buy" : "Sell"} {ROLE[m.role] ?? m.role}</td>
      <td className={`${CELL} text-left text-fg-muted`}>{clock(at.ts)}</td>
      <td className={`${CELL} text-right`}>{price(m.paper)}</td>
      <td className={`${CELL} text-right`}>{price(m.replay)}</td>
      <td className={`${CELL} text-right text-fg-muted`}>{m.delay_ms == null ? "" : `${m.delay_ms >= 0 ? "+" : "−"}${Math.abs(m.delay_ms) < 1000 ? `${Math.abs(m.delay_ms)} ms` : `${(Math.abs(m.delay_ms) / 1000).toFixed(1)} s`}`}</td>
      <td className={`${CELL} text-right ${bps ? "" : "text-fg-faint"}`}>{bps == null ? "" : bps === 0 ? "0" : `${bps > 0 ? "+" : "−"}${Math.abs(bps).toFixed(1)}`}</td>
      <td className={`${CELL} text-left`}>
        {same ? <span className="text-fg-faint">Same</span> : <>
          <Dot tone={suspect ? "bg-fail" : follows ? "bg-fg-muted" : "bg-misses"} />
          <span className={suspect ? "text-fail" : follows ? "text-fg-muted" : "text-misses"}>{RESULT[m.class]}</span>
          {m.class === "quantity" && <span className="text-fg-muted"> {fixed(m.paper?.qty, p.size) ?? MISSING} vs {fixed(m.replay?.qty, p.size) ?? MISSING}</span>}
          {m.cause && <span className="text-fg-muted"> · {suspect ? "look-ahead suspect"
            : m.cause === "consequence" ? `after the difference at ${m.follows ? clock(m.follows) : MISSING}` : CAUSE[m.cause]}</span>}
        </>}
      </td>
    </tr>
  );
}

function Prompt({ children, action, label }: { children: ReactNode; action?: () => void; label?: string }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2.5 px-5 text-center text-dense text-fg-muted">
      <p className="max-w-[52ch] text-pretty">{children}</p>
      {action && <FormButton primary icon="run" onClick={action}>{label}</FormButton>}
    </div>
  );
}

/** A sealed run against its replay on the archive, in one line of counts and then each order filled on
 *  either side: what differs first (price in basis points of the replay's, delay of the paper fill)
 *  with why: a live bar missing or unlike the archive's before it, or neither, which for a fill only
 *  the replay made marks a look-ahead suspect. Once a contract's paths part, its later differences follow
 *  from the first and are grey. Differences are amber, suspects red. When nothing
 *  differs, the matching fills fold into one row. */
export function Reconcile({ r, paperId, sealed, only, digits }: {
  r: Reconciliation | null; paperId: number; sealed: boolean; only: string | null; digits: ReadonlyMap<string, Precision>;
}) {
  const [open, setOpen] = useState(false);
  if (!sealed) return <Prompt>A run is compared with its replay once it is sealed: stop it, then replay it here.</Prompt>;
  if (!r || r.paper_id !== paperId) return <Prompt>Reading the run's reconciliation…</Prompt>;
  if (r.state === "none") return <Prompt action={() => void reconcile(paperId)} label="Replay and compare">Replay this run on the archived bars of the same interval, with the same source and image, and compare every fill. Nothing is recorded.</Prompt>;
  if (r.state === "reconciling") return <Prompt>Replaying on the archive… a run of an hour takes about half a minute.</Prompt>;
  if (r.state === "failed" || !r.result) {
    const uncovered = r.error?.code === "PAPER_RECONCILE_UNCOVERED";
    return <Prompt action={() => void reconcile(paperId)} label="Try again">
      <span className={uncovered ? "" : "text-fail"}>{uncovered ? "The market does not hold this run's minutes yet. " : `${r.error?.code ?? "Failed"}: `}</span>{r.error?.message}
    </Prompt>;
  }
  const { fills, bars, replay } = r.result;
  // Newest first, what differs above what is the same.
  const mine = (only ? fills.filter((m) => symbolOf(m.instrument) === only) : fills).slice().reverse();
  const differ = mine.filter((m) => m.class !== "same"), same = mine.filter((m) => m.class === "same");
  const barsOf = only ? [bars[only]].filter(Boolean) : Object.values(bars);
  const missing = barsOf.reduce((n, b) => n + b!.missing.length, 0), unlike = barsOf.reduce((n, b) => n + b!.differing.length, 0);
  const count = (k: Matched["class"]) => mine.filter((m) => m.class === k).length;
  const suspects = mine.filter((m) => m.look_ahead_suspect).length;
  const following = mine.filter((m) => m.cause === "consequence").length;
  const shown = differ.length || open ? [...differ, ...same] : differ;
  return (
    <div className="flex flex-col">
      <p className="flex flex-wrap gap-x-2 gap-y-1 px-5 pb-2.5 pt-2 text-dense tabular-nums text-fg-muted">
        {[
          <span key="same"><span className="text-fg">{same.length}</span> of {mine.length} the same</span>,
          <Count key="differ" n={count("price") + count("quantity") + count("time")} one="differs" many="differ" tone="text-misses" />,
          <Count key="paper" n={count("paper_only")} one="only on paper" many="only on paper" tone="text-misses" />,
          <Count key="replay" n={count("replay_only")} one="only in the replay" many="only in the replay" tone="text-misses" />,
          <Count key="suspects" n={suspects} one="look-ahead suspect" tone="text-fail" />,
          ...(following ? [<span key="following" className="text-fg-faint">{following} after an earlier difference</span>] : []),
          <span key="bars" className="text-fg-faint">{plural(missing, "live bar")} missing, {unlike} unlike the archive</span>,
        ].flatMap((item, i) => (i ? [<span key={`sep-${i}`} className="text-fg-faint">·</span>, item] : [item]))}
      </p>
      {replay.status === "invalid" && <p className="px-5 pb-2 text-dense text-fail">The replay is invalid: {replay.problems.map((p) => p.code ?? p.message).join(", ")}</p>}
      {mine.length ? (
        <table className="w-full border-collapse text-dense tabular-nums">
          {shown.length > 0 && <thead><tr>
            {!only && <th className={`${HEAD} text-left`}>Contract</th>}<th className={`${HEAD} text-left`}>Order</th><th className={`${HEAD} text-left`}>Filled</th>
            <th className={`${HEAD} text-right`}>Paper</th><th className={`${HEAD} text-right`}>Replay</th>
            <th className={`${HEAD} text-right`}>Delay</th><th className={`${HEAD} text-right`}>Price, bp</th><th className={`${HEAD} text-left`}>Result</th>
          </tr></thead>}
          <tbody>
            {shown.map((m, i) => <Row key={`${m.paper?.order ?? ""}-${m.replay?.order ?? ""}-${i}`} m={m} only={!!only} p={digits.get(symbolOf(m.instrument)) ?? { price: -1, size: -1 }} />)}
            {!differ.length && (
              <tr><td colSpan={only ? 7 : 8} className={`${CELL} bg-island-alt text-left text-fg-faint`}>
                <TextButton className="-ml-1 text-small" onClick={() => setOpen(!open)}>{open ? "Hide the matching fills" : `Show the ${plural(same.length, "matching fill")}`}</TextButton>
              </td></tr>
            )}
          </tbody>
        </table>
      ) : <p className="px-5 py-3 text-dense text-fg-faint">Neither side filled an order{only ? ` on ${only}` : ""}</p>}
    </div>
  );
}
