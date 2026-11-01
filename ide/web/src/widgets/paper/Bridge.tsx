// The Profit and loss card in Details (detail/StagePerformance.tsx): what moved equity since the start as a
// bridge (model/bridge.ts), each step a row as By contract draws one, with the return and the fees' share under it.
import { baseAsset, fixed } from "../../lib/paperApi";
import { MISSING } from "../../lib/format";
import type { Account } from "../../model/account";
import type { Bridge, Kind, Step } from "../../model/bridge";
import { pnlClass } from "../../theme/roles";
import { CoinLogo } from "../../components/CoinLogo";
import { Tip } from "../../components/Tip";
import { signed } from "./performanceParts";

// What a step is.
const NOTE: Record<Kind, (up: boolean) => string> = {
  win: () => "winning trades before fees",
  loss: () => "losing trades before fees",
  other: () => "Booked without a close in the journal",
  funding: (up) => (up ? "Funding received" : "Funding paid"),
  open: (up) => (up ? "Open positions in profit" : "Open positions at a loss"),
  fees: () => "Fees on every fill",
};

/** A row: its name after its contract's coin logo, what it is and its full amount on hover, and its bar
 *  from `from` to `to` on the bridge's scale (`at` gives a value's place, 0 to 1). Trades and the net take the profit or loss colour,
 *  the gross and the other steps the neutral bar. An end on zero is square, where a bar meets the zero line
 *  (or, without one, lines up with the bars beside it); a free end is round. */
type Row = { name: string; coin?: string; note: string; from: number; to: number; tone: "up" | "down" | "bar"; total?: boolean };
const BAR = { up: "bg-pnl-up", down: "bg-pnl-down", bar: "bg-bar" } as const;
// The amount column and the gap between columns, in px; the name column is as wide as the longest name
// (Supply is monospaced: CHAR px a character at text-dense), from 40 to 120px, after a LOGO slot and
// LOGO_GAP when any row has a contract, so every name starts in one column whether its logo loads or not.
const VALUE = 84, GAP = 10, CHAR = 7.5, LOGO = 14, LOGO_GAP = 6;

function Line({ r, at, dp, name, logos }: { r: Row; at: (x: number) => number; dp: number; name: number; logos: boolean }) {
  const lo = at(Math.min(r.from, r.to)), hi = at(Math.max(r.from, r.to)), value = r.to - r.from;
  const zero = (x: number) => Math.abs(x) < 1e-9, ends = zero(Math.min(r.from, r.to)) ? "rounded-r-full" : zero(Math.max(r.from, r.to)) ? "rounded-l-full" : "rounded-full";
  return (
    <Tip content={<span className="tabular-nums">{r.note} <span className="text-fg-muted">{signed(value)} USDT</span></span>}>
      <div className="grid h-5.5 items-center gap-2.5 tabular-nums" style={{ gridTemplateColumns: `${name}px minmax(0,1fr) ${VALUE}px` }}>
        <span className="flex min-w-0 items-center" style={{ gap: LOGO_GAP }}>
          {logos && <span className="flex shrink-0" style={{ width: LOGO }}>{r.coin && <CoinLogo coin={r.coin} />}</span>}
          <span className={`truncate ${r.total ? "text-fg" : "text-fg-muted"} ${r.name === "Net" ? "font-semibold" : ""}`}>{r.name}</span>
        </span>
        <span className="relative h-1">
          <i className={`absolute inset-y-0 ${ends} ${BAR[r.tone]}`} style={{ left: `${lo * 100}%`, width: `max(3px, ${(hi - lo) * 100}%)` }} />
        </span>
        <span className={`text-right ${pnlClass(value)} ${r.name === "Net" ? "font-semibold" : ""}`}>{signed(value, dp)}</span>
      </div>
    </Tip>
  );
}

/** The run's bridge: each step from where the last one left equity, the gross and the net from zero, all on
 *  one linear scale with a zero line when equity went below the start; under it the return and the
 *  equity, and the share of the gross the fees took. */
export function PnlBridge({ a, b }: { a: Account; b: Bridge }) {
  const steps = (list: Step[], start: number) => {
    let run = start;
    return list.map((s): Row => {
      const contract = s.kind === "win" || s.kind === "loss";
      const r: Row = {
        name: contract ? `${baseAsset(s.name)} ${s.kind === "win" ? "wins" : "losses"}` : s.name,
        ...(contract ? { coin: baseAsset(s.name) } : {}),
        note: `${contract ? `${s.name} ` : ""}${NOTE[s.kind](s.value > 0)}`,
        from: run, to: run + s.value, tone: s.kind === "win" ? "up" : s.kind === "loss" ? "down" : "bar",
      };
      run += s.value;
      return r;
    });
  };
  const sign = (x: number) => (x < 0 ? "down" : "up");
  const toGross = steps(b.trades, 0);
  const gross: Row = { name: "Gross", note: "Closed trades before fees", from: 0, to: b.gross, tone: "bar", total: true };
  const toNet = steps(b.costs, b.gross);
  const net: Row = { name: "Net", note: "Equity now less the starting balance", from: 0, to: b.net, tone: sign(b.net), total: true };
  const all = [...toGross, gross, ...toNet, net], ends = all.flatMap((r) => [r.from, r.to]);
  const lo = Math.min(0, ...ends), hi = Math.max(0, ...ends), at = (x: number) => (hi > lo ? (x - lo) / (hi - lo) : 0);
  const share = b.gross > 0 && a.fees > 0 ? `fees took ${Math.round((a.fees / b.gross) * 100)}%` : null;
  const ret = a.ret === null ? MISSING : `${a.ret > 0 ? "↑" : a.ret < 0 ? "↓" : ""}${(Math.abs(a.ret) * 100).toFixed(2)}%`;
  const rule = <i className="my-1 h-px bg-line" />, logos = all.some((r) => r.coin);
  const name = Math.min(120, Math.max(40, Math.ceil(Math.max(...all.map((r) => r.name.length)) * CHAR))) + (logos ? LOGO + LOGO_GAP : 0);
  const line = (r: Row) => <Line key={r.name} r={r} at={at} dp={b.dp} name={name} logos={logos} />;
  return (
    <div className="flex flex-col gap-1 text-dense">
      <div role="group" aria-label={`Profit and loss since the start: ${all.map((r) => `${r.name} ${signed(r.to - r.from)}`).join(", ")}`} className="relative flex flex-col">
        {lo < 0 && <i className="absolute inset-y-0 w-px bg-line-strong" style={{ left: `calc(${name + GAP}px + (100% - ${name + VALUE + 2 * GAP}px) * ${at(0)})` }} />}
        {toGross.map(line)}
        {toGross.length > 0 && rule}
        {line(gross)}
        {toNet.map(line)}
        {rule}
        {line(net)}
      </div>
      <div className="flex justify-between gap-2 border-t border-line pt-1.5 text-small text-fg-faint tabular-nums">
        <span className="truncate"><span className={`font-semibold ${pnlClass(a.ret)}`}>{ret}</span> {fixed(a.equity, 2) ?? MISSING} USDT</span>
        {share && <span className="shrink-0">{share}</span>}
      </div>
    </div>
  );
}
