# Strategy authoring

What a strategy file must satisfy to run in the native replay. Code is the authority:
`engine/{config,load,run,report}.py` for execution. `candidate new` writes a scaffold with the
header template, the entry class, the two hooks and a sizing helper.

## Contents

- One file, one account
- Entry class and configuration
- Causal clock
- Trades and metrics
- Orders and protection
- Plans, sizing and capital
- Verify Nautilus behaviour
- Publish and precheck
- Live

## One file, one account

- One independent strategy is one complete UTF-8 Python file holding every trading rule: signal,
  entries, exits, sizing and order lifecycle.
- Import only computation modules of the standard library (`math`, `decimal`, `collections`,
  `statistics`, `datetime` and the rest of `SOURCE_STDLIB` in `engine/load.py`) and the strategy API
  of `nautilus_trader` (`common`, `config`, `core`, `indicators`, `model`, `trading`); no relative
  imports. The source runs in the runner's process, so the loader refuses (`SOURCE_REACH`, with
  each finding's line) anything reaching past what the engine delivers.
  `self.cache` is read-only: a write fails the run (`CACHE_WRITE`).
- The runner allocates and configures the strategy
  ([Native strategy allocation](../../../../engine/README.md#native-strategy-allocation)): `__init__`
  calls `super().__init__()`; never define `__new__` or `on_stop`, nor name `StrategyConfig`.
- The replay creates one entry-class instance per instrument; all share one fixed-capital Nautilus
  `MARGIN` account (`ACCOUNT_CONTRACT` in `engine/config.py`).

## Entry class and configuration

- Declare the history the file needs before its first decision as `WARMUP = {period: bars}`, per
  Binance kline period (`1-MINUTE` and the periods below); a period it only aggregates to has 0
  bars. Each instance starts once every declared history holds. `on_historical_bars` then receives
  each history once, every bar stamped 1 ms before its bucket ends, and only after that `on_start`
  runs, where the file subscribes; it sees nothing earlier and cannot order before. Seed indicators
  there and never call `request_*`. Histories other than `1-DAY` are derived from the window's
  minutes, so they hold only once `--start` is that far back; `--start` is part of the input
  identity, so a baseline that later comparisons build on declares and starts early enough for a
  variant with a longer indicator.
- `universe_membership` is a sequence of `(start_ns, end_ns)` UTC intervals in which the instrument is
  in the monthly universe (empty when the replay names contracts the universe never held), cut at
  its listing and at its first PRE_CLOSE or termination when a lifecycle bundle is given. In Paper
  it grows by each month the instrument stays a member, so read it when deciding: a copy keeps
  only the months it held. A
  contract outside these intervals takes no new positions. Use native `reduce_only=True` for every
  exit and protective order there, including an order intended only to close. End all non-reduce-only
  entry orders and their partially filled remainders by the cutoff. The
  independent audit checks the trusted intervals, native flags, submissions, fills and old residuals;
  any violation invalidates the run. Cancellation/expiry at the cutoff is allowed, a fill there is
  not. A GTD deadline alone is not a native expiry acknowledgement. Holding an old position does not
  require an immediate exit; membership reentry restores entry permission.
- With a lifecycle bundle the engine delivers the contract's `InstrumentStatus` (PRE_CLOSE, CLOSE)
  and, when the exchange published one, its settlement `InstrumentClose`; subscribe with
  `subscribe_instrument_status`. The pinned PRE_CLOSE does not itself reject opening orders;
  enforce the only-reduce boundary above. After CLOSE the market rejects orders, and the audit refuses a
  position or a working order left at a termination without a settlement price.

## Causal clock

- Replay, Paper and Live serve 1-minute LAST bars (`{instrument_id}-1-MINUTE-LAST-EXTERNAL`), MARK
  updates and funding updates, never quotes, books or index prices (`SUBSCRIPTION_OUTSIDE_CONTRACT`);
  trades and metrics need their runner arguments (below). Aggregate natively by subscribing to
  `{instrument_id}-<N>-<UNIT>-LAST-INTERNAL@1-MINUTE-EXTERNAL` for a period `WARMUP` declares (3, 5,
  15, 30 MINUTE; 1, 2, 4, 6, 8, 12 HOUR; 1 DAY); the aggregated bars arrive as
  `{instrument_id}-<N>-<UNIT>-LAST-INTERNAL` (the subscription type's `.standard()`), stamped on
  close (Paper and Live: 5 s later, once the last minute is in), the first one whole. The warm-up
  history of the same period arrives as `{instrument_id}-<N>-<UNIT>-LAST-EXTERNAL`, a different bar
  type with the same `bar_type.spec`: route bars by instrument and `spec`, so that neither is dropped.
- Every market-data price or indicator input used to decide whether, how much or at what price
  to submit (signals, quantity inputs and specification-check prices included) must come from a
  completed event strictly earlier than submission. Trace each input's timestamp; guarding the signal
  timestamp alone does not establish this. Submit on a later event so fills cannot share the
  input bar's close. When a rule reads a prior-bar indicator, update it after the decision.
  Do not delay required protection or termination actions with a blanket bar gate.
- `on_start` runs at the instance's `trade_start_ns`, later when its listing or history is. The
  independent audit also checks native `OrderSubmitted` / `OrderEmulated.ts_event` against that
  runner-owned start; an early submission makes the entire run invalid, even without fills.
- Decide only on converged indicators. A recursive average with smoothing α keeps (1−α)^k of its
  seed after k inputs; at one period, when Nautilus sets `initialized`, that is about 14% for an
  EMA (α = 2/(n+1)) and 37% for a Wilder average (α = 1/n; Nautilus's default ATR). Gate decisions
  on the source's own input count until the seed weighs under 1% (about 2.5 periods for an EMA,
  5 for a Wilder average), counted from the instance's first input, so a short history and a
  cold Live start are covered too. Indicators with a fixed window
  (SMA, highest high) are exact once the window is full.

## Trades and metrics

Trade-level inputs (trade imbalance, trade VWAP) need the runner argument `--trade-ticks`, only with
`--execution quotes`, decided and passed like `--execution`; the pinned market day must hold trades for
every month of the trading window (`market coverage`, `trades`). The source subscribes with
`subscribe_data(DataType("TradeTick", metadata={"instrument_id": str(instrument_id)}))` and reads the
tick as `data.data` in `on_data`. Trades are signal input only: they match no order and move no book.
A trade subscription the run does not serve (no flag, native `subscribe_trades`, paper trading) is
`TRADES_NOT_SERVED`; report the number of trades received in `replay_diagnostics`.

Open interest and long/short ratios need the runner argument `--metrics`, in either execution
environment, decided and passed like `--execution`; the pinned market day must hold them for every
month of the trading window (`market coverage`, `metrics`). The source subscribes with
`subscribe_data(DataType("Metrics", metadata={"instrument_id": str(instrument_id)}))` and reads
`data.data` in `on_data`: `sum_open_interest` (base asset) and the three ratios as `Decimal`, a ratio
the archive left empty as `None`. Each row describes `ts_event` and arrives at `ts_init`, 10 minutes
after the archive's `create_time`, on a whole minute; it is signal input only. A subscription the run
does not serve (no flag, paper trading) is `METRICS_NOT_SERVED`; report the rows received and the
empty ratios read in `replay_diagnostics`.

## Orders and protection

- Replay, Paper and Live hold orders to one set of rules (`ORDER_RULE`; `engine/README.md`,
  Subscriptions, orders and stop coverage). An entry is a base-quantity LIMIT or STOP_MARKET order (no
  MARKET: use a marketable limit). Each entry order opens its own position, so long and short
  positions and entries may be open together on one contract; the instance's open positions (at
  their average open price) and entries (at their limit or trigger price), both sides added, stay
  within 3 times USDT equity. An exit is reduce-only and names its position (`position_id`); one
  position's working stops hold at most its quantity. Nothing is modified, listed, bracketed,
  emulated or given params, and a GTD expiry lies at least 600 s ahead. A breach is not sent and
  the run is refused; naming `bracket`, `submit_order_list`, `add_exec_algorithm` or
  `close_all_positions` anywhere in the file is refused at load.
- Keep one stop per position, submitted on the entry's first fill, and a target or partial exit as
  its own reduce-only order. Nautilus's simulated venue (replay, Paper) resizes every accepted
  reduce-only order of a position to its quantity whenever a fill changes it; Binance does not, so a
  stop per fill breaches the rule above and a later fill can outgrow the stop in Live. To move a
  stop, or replace one smaller than its position, cancel it and submit the new one for the position
  on its `OrderCanceled`: submitted first, the new one would hold more than the position. A rejected
  cancel leaves the old stop working; close with a reduce-only order when the new one is rejected or
  its trigger is already passed. Honor a declared entry lifetime with native expiry or a
  cancellation Nautilus acknowledges; under 600 s, submit GTC and cancel on a timer. Under `bars`,
  native expiry fires at the first bar stamp at or after the deadline, before that bar can fill;
  stamps sit 1 ms before the minute, so a whole-minute deadline reports one bar late. Never add a
  stop or target the source lacks.
- The audit refuses a run in which a position is larger than its resting stops (reduce-only, closing
  side, accepted and neither triggered nor filled) for longer than one one-minute bar. Every source
  has a stop loss: `USES_STOP_LOSS = False` is refused.
  Shortfalls lasting at most one minute are neither refused nor listed as uncovered intervals;
  a passing audit does not prove continuous protection. This tolerance applies only to stop
  coverage; the entry cutoff above has no such grace period.
- An entry can end partly filled (GTD expiry, `cancel_order`): size its stop and exits from the
  native position, and once it is flat cancel the plan's remaining orders.
- Nautilus can reject a cancel (`OrderCancelRejected`) and the old order keeps working. Handle the
  event and return any rejection left unhandled from `replay_integrity_findings`; its flag does not
  count them.
- React to order and position events
  and read `self.cache` and `self.portfolio`. Never infer a fill from a bar's range, compute fees or
  funding, or keep a private ledger. Size from native state: portfolio equity, the instrument's
  multiplier, `make_price`, `make_qty`, `min_quantity` and `min_notional`.

## Plans, sizing and capital

- A plan is everything one signal submits: its entry, the stops and targets on its position, and
  any later order that reduces or closes it. Give every order exactly one tag
  `plan:PLAN-ID` (`tags`), unique
  within the run. Other tags may sit beside it. Without a plan tag on every order the report's plan
  win rate is null.
- A plan holds the one position its entry opens: name it in every stop and exit
  (`self.cache.position_id(entry.client_order_id)`), and when it goes flat cancel its remaining
  orders rather than let the rest of a partly filled entry reopen it. Plans on one instrument may
  overlap; state what a signal does when the 3-times limit leaves no room and when several arrive
  on one bar.
- When the instances share one account, the source states the capital budget and its allocation:
  how one batch of signals shares capital, what happens to an opportunity that gets none (smaller,
  later or skipped), and that exit orders only reduce. Callback order and engine denials are not an
  allocation rule. A rule merged from another version is still allocated in the same account and
  registered as one change.
- A cap on order size as a share of bar volume is a constant in the file. An entry is one order,
  so cap it on a volume window longer than one minute; a one-minute cap makes the position a random
  function of one minute's volume.

## Verify Nautilus behaviour

Verify uncertain order or event behaviour with a small native probe before relying on it: a script
in a temporary directory, run on the host with `uv run --frozen --project REPO python
/tmp/RUNDIR/probe.py` (it imports `engine` and `market`), building a
`BacktestEngine(BacktestEngineConfig())` with one `Strategy()`, an instrument and bars.

## Publish and precheck

Publish a revision only to precheck and register it; parsing checks one top-level entry class
without executing the file, which proves nothing about rules, clock or safety. A derivation names
its parent and the difference; a root has none. A new revision of the same strategy ID states in
its description what it fixes from the previous revision and why, since the difference stays
relative to the parent. A description gives the rule, its sources and its non-claims.

Any later source change is a new candidate. A draft can be tried before publishing with `replay explore`; it
is never evidence. In the precheck, confirm every filled entry has the protection its source gives
it, every order carries one plan tag and every stop and exit names its plan's position, no order precedes
trade start, none was denied or rejected, and fills, fees, funding and account rows appear in the
native reports. Never run the replay with `docker run` or `python -m engine...` directly.

## Live

A candidate written to the rules below runs in Live as it is: replay, Paper and Live run the one file
and its validations cover it. Write a candidate that may go to Live this way when it is created, as a
candidate version replayed like any other; do not plan a Live rewrite. Only a candidate written
otherwise needs a separate file the operator passes to `live preflight` with `--strategy-file`, which
its validations do not cover (`review.rewritten`). What Live enforces during a run is in
`engine/README.md`.

- Live needs the account flat when the run starts; entries arriving together each wait, in order,
  for their own account check. Binance keeps a GTD expiry to the second, may end it early or late and report `CANCELED`:
  handle the end as a cancel.
- Size from USDT equity, never a fixed USDT amount; each multiple (x1, x2) is its own version,
  scaling only the notional limit. Live measures the 3-times limit also against the account's USDT
  wallet and available balance, and each entry needs USDT cash of at least `--budget-usdt`
  (`LIVE_BUDGET`, `LIVE_FUNDS`).
- Keep the stop and the candidate's reduce-only target, if any, at the position's quantity as
  above, each with `position_id=` the owned position; cancel the other once one is completely
  filled, since a partial fill leaves the position open.
