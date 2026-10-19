# Every native replay

Every native replay goes through `artifacts run`, and each writes one trial row in the open round
before it starts (strategy source hash, window, contracts, image); without an open round it is refused.
Never start a replay or a probe with `docker run` or a direct runner command.

- **Explore** a draft file into a new `/tmp` directory: reports stay there, nothing else is stored.
- **Seal** a published revision: it replays in a temporary directory, is audited, and is then
  stored whole in the ledger in one write (reports as typed rows, product readings as columns); the
  directory is deleted. A run whose audit fails is stored with its reasons only, as `invalid`.
  Seal only what a freeze or a confirmation will cite.

## Runtime and inputs

- CI builds every image (`ghcr.io/qoeop/trade-runtime`). Without `--runtime`, `run` pulls the
  current main image (tag `main`) and records its digest; `--runtime` takes another CI reference,
  such as a pull request's `pr-N` tag, for exploration or engineering. A freeze or confirmation
  accepts only a run on an image built from a commit on origin/main: merge a missing product
  capability first, then rerun on the main image.
- The image's contract label must equal the revision's `runtime_contract`.
- Inputs are one commit of the market database: `--market REF` (branch, tag or commit; default
  `main`), and after `--` the contracts, `--symbols SYMBOL ...` (Binance symbols such as `BTCUSDT`)
  or `--universe pool` (every contract in the monthly pool during the trade window). USDT
  perpetuals from 2020-01; `uv run --frozen python -m market.cli status` gives the newest
  covered day and the latest complete month, `... pool --month YYYY-MM` the pool. `run` exports the
  commit for the window (an exploration reuses a cache under the temp directory, a seal exports
  afresh) and stores the market database, commit, pool rule and contracts with the run.

## Explore

```bash
uv run --frozen python -m research.records.artifacts run --explore \
  --strategy-file /tmp/RUNDIR/strategy.py --strategy-class ENTRY-CLASS --output /tmp/RUNDIR/pilot -- \
  --symbols BTCUSDT ETHUSDT --start START --trade-start TRADE-START --end END
```

`--output` receives `reports/`, the logs and `runtime-inspection.json`. The result carries
`readings`: the same readings as `report` below, read from the unverified temporary reports. Use
them to steer and to judge a coarse replay ([hypotheses.md](hypotheses.md)), citing the trial ID;
never cite them in a freeze or a confirmation. They are null with the reason when the replay did
not pass or its reports are incomplete. For a Nautilus behavior
probe, run a script from `/tmp` on the host with
`uv run --frozen --project REPO python /tmp/RUNDIR/probe.py`; it imports `engine`, `market` and `research`.

## Seal

```bash
uv run --frozen python -m research.records.artifacts run --strategy ID@N [--market COMMIT] -- \
  --universe pool --start START --trade-start TRADE-START --end END
```

- Arguments after `--` go to the runner; `run` supplies the strategy file, class, hash, bindings,
  market inputs and output itself and refuses those flags.
- Times carry `Z` or an explicit UTC offset and fall on whole-minute boundaries with
  `start <= trade-start < end`; `start` to `trade-start` is warmup. A freeze needs
  `trade-start`/`end` equal to the goal window.
- `passed` means the native integrity checks and the audit passed, not that the strategy meets the
  goal. The audit checks report identities, links, stop protection throughout the replay (from
  `order_events.jsonl.gz`) and reported economics ([strategy-authoring.md](strategy-authoring.md));
  it does not prove a signal clock, staged-exit races or source-specific rules.
- It prints the `run_id`; a failure while storing keeps the directory and prints its path.

## Read a run

```bash
uv run --frozen python -m research.records.artifacts report RUN-ID [--at closed/GOAL-ID]
uv run --frozen python -m research.records.artifacts report --dir /tmp/RUNDIR/pilot
```

`--dir` reads an exploration's reports the same way and adds the open goal's gates; nothing is
stored, so it is a reading for your next step, never for a freeze.

- The readings: `plans_closed`, `plans_won`, `plans_open`, `plan_win_rate` (the goal's plan win
  rate; null with the reason in `reading_limitations` when an order lacks a plan tag or carries
  two, plans on one instrument overlap, or a position and a plan do not map one to one),
  `annual_return`, `max_drawdown` (native MARK equity on the trade window) and `return_drawdown`;
  the closed-position split (fill price, commissions, funding) only when it reconciles to the
  audited native economics; `closed_by_year`, that split and the closed count by the UTC year each
  position closed in (a whole cycle, funding included, counts in its closing year; open positions
  are left out; `{}` without closes; null with the reason when a close time is missing); and
  `cost_basis`: the account terms and the fee rates observed in fills.
- Any other statistic follows the `nautilus-report-analysis` skill, which loads a stored run with
  `research.records.analysis.tables(run_id)`.
