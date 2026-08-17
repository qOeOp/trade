# Design evidence

External evidence challenges this process. It does not prove that VibeTrader is profitable, production-ready, or
equivalent to another platform. Owner names, the permit-bound command protocol, the single Recovery Case closure
writer, and the 14-group plus one channel / 5-module overview limit remain project design choices.

## Engine boundaries and one trading path

[NautilusTrader architecture](https://nautilustrader.io/docs/latest/concepts/architecture/) separates market-data,
risk, execution, cache, and portfolio responsibilities. Its order path validates risk before venue routing and
returns execution facts to strategies and portfolio state. [QuantConnect LEAN Algorithm Framework](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/overview)
separates universe selection, signal production, portfolio construction, risk management, and execution through
typed handoffs. These mature designs support explicit ownership and one observable trading path; they do not prove
VibeTrader's exact Owner split or permit protocol.

## Research claims and protected qualification

[The Probability of Backtest Overfitting](https://escholarship.org/uc/item/4w1110bb) treats repeated strategy
selection on historical data as a multiple-testing problem and proposes estimating overfitting probability.
[The Deflated Sharpe Ratio](https://papers.ssrn.com/sol3/Delivery.cfm/SSRN_ID2460551_code87814.pdf?abstractid=2460551)
adjusts reported performance for selection bias and non-normal returns. Together they support recording the trial
family, freezing eligibility rules before protected evaluation, and preventing protected results from feeding the
same research loop. One holdout or one metric is not sufficient evidence of economic validity.

## Backtest paper and live progression

[Freqtrade strategy testing](https://www.freqtrade.io/en/stable/strategy-101/) distinguishes historical backtests
from real-time dry runs and documents why their results differ. [NautilusTrader environments](https://nautilustrader.io/docs/latest/concepts/architecture/)
use historical simulated, real-time simulated, and live contexts around shared trading components. These practices
support keeping Runtime, Risk, and Execution semantics stable while adapters and evidence strength change across
backtest, paper, and live scenarios.

## Recovery and external truth

[NautilusTrader live reconciliation](https://nautilustrader.io/docs/latest/concepts/live/) aligns internal order and
position state with venue readback and persists execution events for recovery. This supports making Execution the
owner of external effects and reconciliation, keeping uncertainty explicit, and requiring venue-derived evidence
before recovery closure. VibeTrader's Recovery Case join and `KNOWN_CLOSED` remain its own fail-closed design.

## What future implementation must prove

- Research receipts bind source identity, trial family, point-in-time inputs, costs, and capacity assumptions.
- Qualification stays independent of research and may reject, revoke, or require more evidence.
- Paper and live share intent, risk, execution, and accounting semantics; only the effect adapter changes.
- Every normal add-risk effect binds one current terminal Risk Decision and one-use Reservation. A normal
  decrease-only effect binds an explicit decrease-only Risk Decision and adapter admission/outcome but creates no
  Reservation or claim. Recovery remains a separate fenced path.
- Profitability, live risk control, and venue correctness require project tests and operating evidence; citations cannot supply them. Exposure limits and controls do not guarantee a maximum realized loss because gaps, liquidity, slippage, and unknown external effects remain possible.
