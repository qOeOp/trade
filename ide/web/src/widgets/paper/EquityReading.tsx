import { amount, fixed } from "../../lib/paperApi";
import { chainEquity, chainReturn } from "../../model/chain";
import { signedPct } from "../../components/RunTile";
import { useShown } from "../../state/shown";
import { useStream } from "../../state/paperStream";
import { pnlClass } from "../../theme/roles";

export type Equity = { whole: string; cents: string; ret: number | null };

/** The shown run's equity, split at the point, and return. A chain of runs reads as one account: its equity
 *  and return carry on from run to run. The run's own stream is read first (the shown stream is joined with
 *  the earlier runs of its chain), then the run's seal or its last live reading. */
export function useEquity(): Equity | null {
  const { stage, run, chain } = useShown(), stream = useStream();
  if (stage !== "paper" || !run) return null;
  const own = stream?.paperId === run.paper_id ? stream : null;
  const [whole = "", cents = ""] = (fixed(chainEquity(chain, amount(own?.seal?.final_equity_usdt ?? own?.readings?.final_equity_usdt
    ?? run.seal?.final_equity_usdt ?? run.live?.final_equity_usdt)), 2) ?? "").split(".");
  return { whole, cents, ret: chainReturn(chain) };
}

/** The equity and return beside the Equity switch's label: the whole part in the text colour, cents and
 *  unit faint, the return in its gain or loss colour. */
export function EquityReading({ equity: { whole, cents, ret } }: { equity: Equity }) {
  return (
    <span className="ml-1 inline-flex items-center gap-2 tabular-nums">
      <span><span className="text-fg">{whole || "-"}</span>{cents && <span className="text-fg-faint">.{cents}</span>}<span className="text-fg-faint">&nbsp;USDT</span></span>
      <span><span className="text-fg-faint">Return&nbsp;</span><span className={pnlClass(ret)}>{signedPct(ret)}</span></span>
    </span>
  );
}
