# FAQ

Back to the [operator manual](README.md).

**Is my research private?**
No. The ledger publishes complete strategy source, results and judgments to your public DoltHub repository on every
change, and that history cannot be withdrawn. There is no private mode.

**Can several people use one deployment?**
It is built for one operator. The IDE on a workstation listens on 127.0.0.1 only; a server admits the members of one
GitHub team ([`deploy/remote/README.md`](../../deploy/remote/README.md)), and they all see and drive the same research.

**Do I need an exchange account?**
Not for research or Paper: both use Binance's public data. Only Live uses an account, and only you connect it.

**Which Agent can I use?**
Claude Code or Codex, opened at the repository root. The rules it follows are in [`AGENTS.md`](../../AGENTS.md) and
`.agents/skills/`; it asks before anything that file reserves for you.

**What do I decide, and what does the Agent decide?**
You choose the research line and its two targets, maximum drawdown and minimum annual return, approve each candidate
from its report, and start any out-of-sample validation. The Agent chooses hypotheses, parameters, position size and
risk per trade, and runs the replays. Win rate is reported but is not a target.

**How much disk and memory does it need?**
It depends on the market range. Three contracts' bars since 2024 are small; aggTrades and quotes of three contracts
since 2020 took about 80 GB. The services used about 3 GiB together, plus up to 3.5 GiB for all Paper runs. See [What the
market range costs](../../deploy/README.md#what-the-market-range-costs).

**Why does the market import fail from my server?**
Binance refuses some regions and hosting providers (HTTP 451 or 403). Check with
`curl -sS -o /dev/null -w '%{http_code}\n' https://fapi.binance.com/fapi/v1/time`; anything but `200` means that host
cannot import.

**Can I run replays without Docker?**
No. Every replay runs in the runtime image built in CI, pinned by digest, so its result can be reproduced.

**I lost the market directory. Is the research lost?**
No. The market directory has no copy because market-import recomputes it from Binance's archives; sealed runs stay
readable and reproducible.

**I lost the host. Is the research lost?**
What was published is on DoltHub: start a new host with empty directories and give its first start the same
repository. Unpublished writes, Agent settings and the Live root are lost unless you backed them up ([Backups](README.md#backups)).

**Is any of this investment advice?**
No. Results are replays and simulations; Live places real orders and a loss can exceed the limits you set.

**Where are the licences?**
Code: MIT ([`LICENSE`](../../LICENSE)). Market data and what is computed from it: [Licence and data
attribution](../../README.md#licence-and-data-attribution).
