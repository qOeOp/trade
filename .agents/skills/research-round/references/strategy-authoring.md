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
- Native configuration at allocation uses the narrow `Strategy.__new__` form documented in
  [Native strategy allocation](../../../../engine/README.md#native-strategy-allocation); other allocator
  spellings and reflection remain refused.
- The replay creates one entry-class instance per instrument; all share one fixed-capital Nautilus
  `MARGIN` account (`ACCOUNT_CONTRACT` in `engine/config.py`).

## Entry class and configuration

- `daily_bar_type` is `{instrument_id}-1-DAY-LAST-INTERNAL`, the type the daily bars arrive
  with: in `on_bar`, a daily bar's `bar.bar_type` equals `daily_bar_type`. Subscribe with the
  aggregation source appended, `BarType.from_str(f"{daily_bar_type}@1-MINUTE-EXTERNAL")`.
- `universe_membership` is a tuple of `(start_ns, end_ns)` UTC intervals in which the instrument is
  in the monthly universe (empty when the replay names contracts the universe never held), cut at
  its listing and at its first PRE_CLOSE or termination when a lifecycle bundle is given. A
  contract outside these intervals takes no new positions. Use native `reduce_only=True` for every
  exit and protective order there, including an order intended only to close. End all non-reduce-only
  entry orders and their partially filled remainders by the cutoff; a canceled bracket entry keeps
  its stop and target for the part it filled. The
  independent audit checks the trusted intervals, native flags, submissions, fills and old residuals;
  any violation invalidates the run. Cancellation/expiry at the cutoff is allowed, a fill there is
  not. A GTD deadline alone is not a native expiry acknowledgement. Holding an old position does not
  require an immediate exit; membership reentry restores entry permission.
- With a lifecycle bundle the engine delivers the contract's `InstrumentStatus` (PRE_CLOSE, CLOSE)
  and, when the exchange published one, its settlement `InstrumentClose`; subscribe with
  `subscribe_instrument_status`. The pinned PRE_CLOSE does not itself reject opening orders;
  enforce the only-reduce boundary above. After CLOSE the market rejects orders, and the audit refuses a
  position or a working order left at a termination without a settlement price.
- Set the class attribute `DAILY_WARMUP = True` if the file needs historical daily bars (default
  `False`). A baseline that later comparisons build on takes enough warm-up that a variant with a
  longer indicator is ready as early and needs no other `--start`, which would change the input
  identity.

## Causal clock

- Every replay serves 1-minute LAST bars (`{instrument_id}-1-MINUTE-LAST-EXTERNAL`), MARK updates and
  funding updates, never books. Quotes need `--execution quotes` (`subscribe_quotes`, `on_quote`);
  trades and metrics need their runner arguments (below). Aggregate natively by subscribing to
  `{instrument_id}-<N>-<UNIT>-LAST-INTERNAL@1-MINUTE-EXTERNAL`; the aggregated bars arrive as
  `{instrument_id}-<N>-<UNIT>-LAST-INTERNAL` (the subscription type's `.standard()`), stamped on
  close.
- Every market-data price or indicator input used to decide whether, how much or at what price
  to submit (signals, quantity inputs and specification-check prices included) must come from a
  completed event strictly earlier than submission. Trace each input's timestamp; guarding the signal
  timestamp alone does not establish this. Submit on a later event so fills cannot share the
  input bar's close. When a rule reads a prior-bar indicator, update it after the decision.
  Do not delay required protection or termination actions with a blanket bar gate.
- Bars before the instance’s runner-supplied `trade_start_ns` are warm-up: read inputs, update
  indicators and prepare order objects, but do not submit them. The independent audit checks native
  `OrderSubmitted` / `OrderEmulated.ts_event` against the runner-owned per-strategy start; any early
  submission makes the entire run invalid, even without fills. Submission exactly at the start is
  allowed by this audit; the causal-input rule above still applies. The runner does not drop or
  reschedule orders. An instance delayed by listing or daily warm-up uses its own later start.
- Decide only on converged indicators. A recursive average with smoothing α keeps (1−α)^k of its
  seed after k inputs; at one period, when Nautilus sets `initialized`, that is about 14% for an
  EMA (α = 2/(n+1)) and 37% for a Wilder average (α = 1/n; Nautilus's default ATR). Gate decisions
  on the source's own input count until the seed weighs under 1% (about 2.5 periods for an EMA,
  5 for a Wilder average), counted from the instance's first input, so a short or absent
  `--start` warm-up and a cold paper start are covered too. Indicators with a fixed window
  (SMA, highest high) are exact once the window is full.
- With `DAILY_WARMUP = True`, `historical_daily_bars` holds the unbroken run of daily
  `-1-DAY-LAST-EXTERNAL` bars (derived from 1-minute bars, from 2020 at the earliest) that ends
  1 ms before the instance’s input start, at least 200 of them; an instance can be delayed until
  its history is ready, and the input start must be 00:00 UTC; without it the list
  is `[]`. The engine does not replay them; seed state from the list.

## Trades and metrics

Trade-level inputs (trade imbalance, trade VWAP) need the runner argument `--trade-ticks`, only with
`--execution quotes`, decided and passed like `--execution`; the pinned commit must hold trades for
every month of the trading window (`market coverage`, `trades`). The source subscribes with
`subscribe_data(DataType("TradeTick", metadata={"instrument_id": str(instrument_id)}))` and reads the
tick as `data.data` in `on_data`. Trades are signal input only: they match no order and move no book.
A trade subscription the run does not serve (no flag, native `subscribe_trades`, paper trading) is
`TRADES_NOT_SERVED`; report the number of trades received in `replay_diagnostics`.

Open interest and long/short ratios need the runner argument `--metrics`, in either execution
environment, decided and passed like `--execution`; the pinned commit must hold them for every
month of the trading window (`market coverage`, `metrics`). The source subscribes with
`subscribe_data(DataType("Metrics", metadata={"instrument_id": str(instrument_id)}))` and reads
`data.data` in `on_data`: `sum_open_interest` (base asset) and the three ratios as `Decimal`, a ratio
the archive left empty as `None`. Each row describes `ts_event` and arrives at `ts_init`, 10 minutes
after the archive's `create_time`, on a whole minute; it is signal input only. A subscription the run
does not serve (no flag, paper trading) is `METRICS_NOT_SERVED`; report the rows received and the
empty ratios read in `replay_diagnostics`.

## Orders and protection

- Protection answers to the stop-coverage audit in the next bullet; the orders are the source's.
  When the source has both a stop and a target and an entry type the pinned `bracket` factory
  builds (it refuses a STOP_MARKET entry and requires a target price), submit one native bracket
  (`self.order_factory.bracket(...)`: OTO entry, OUO stop-market and limit-target children) via
  `self.submit_order_list(...)`, with GTD `expire_time` for an entry lifetime. Otherwise submit the
  source's own native orders, for example STOP_MARKET entries (OCO when a fill cancels the other
  side) with a reduce-only stop submitted on the fill event. Honor a declared entry lifetime with
  native expiry or a cancellation Nautilus acknowledges. Under `bars`, native expiry fires at the
  first bar stamp at or after the deadline, before that bar can fill; stamps sit 1 ms before the
  minute, so a whole-minute deadline reports one bar late. Never add a stop or target the source
  lacks to fit a bracket, and never call protection submitted apart from its entry atomic.
- The audit refuses a run in which a position is larger than its accepted reduce-only stop orders
  on the closing side for longer than one one-minute bar. A source with no stop-loss by design sets
  the class attribute `USES_STOP_LOSS = False` (default `True`); its uncovered intervals are then
  reported, not refused.
  Shortfalls lasting at most one minute are neither refused nor listed as uncovered intervals;
  a passing audit does not prove continuous protection. This tolerance applies only to stop
  coverage; the entry cutoff above has no such grace period.
- When a bracket entry ends after a partial fill (GTD expiry, `cancel_order`, a modify down to the
  filled quantity), Nautilus keeps its stop and target, resized to the filled quantity; a second
  protection for that part doubles the exit orders. When the entry's fill bar also reaches the stop,
  the stop fills and the target is canceled. An OTO child follows its entry's fill: a child built
  smaller than the entry (a partial target) is resized to the whole fill, so submit a partial exit as
  its own reduce-only order after the entry fills; Nautilus then trims the open reduce-only stop to
  the remaining position.
- Nautilus can reject a modify or cancel (`OrderModifyRejected`, `OrderCancelRejected`; a stop
  moved past the market is one case) and the old order keeps working. Handle both events and return
  any rejection left unhandled from `replay_integrity_findings`; its flag does not count them.
- React to order and position events
  and read `self.cache` and `self.portfolio`. Never infer a fill from a bar's range, compute fees or
  funding, or keep a private ledger. Size from native state: portfolio equity, the instrument's
  multiplier, `make_price`, `make_qty`, `min_quantity` and `min_notional`.

## Plans, sizing and capital

- A plan is everything one signal submits: every entry tier with its shared stops and targets, and
  any later order that changes or closes that position. Give every order exactly one tag
  `plan:PLAN-ID` (`entry_tags`, `sl_tags` and `tp_tags` on a bracket, `tags` otherwise), unique
  within the run. Other tags may sit beside it. Without a plan tag on every order the report's plan
  win rate is null.
- One instrument has at most one active plan at a time: from its first submitted order until its
  position is flat and none of its orders is open. A plan holds at most one position: when it goes
  flat, cancel its remaining orders rather than let a leftover tier reopen it.
- When the instances share one account, the source states the capital budget and its allocation:
  how one batch of signals shares capital, what happens to an opportunity that gets none (smaller,
  later or skipped), and that exit orders only reduce. Callback order and engine denials are not an
  allocation rule. A rule merged from another version is still allocated in the same account and
  registered as one change.
- A cap on order size as a share of bar volume is a constant in the file. Carry the excess to
  later bars or cap on a longer volume window; dropping it makes the position a random function of
  one minute's volume.

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
it, every order carries one plan tag and plans on one instrument do not overlap, no order precedes
trade start, none was denied or rejected, and fills, fees, funding and account rows appear in the
native reports. Never run the replay with `docker run` or `python -m engine...` directly.

## Live

A candidate written to the rules below runs in Live as it is: replay, Paper and Live run the one file
and its validations cover it. Write a candidate that may go to Live this way when it is created, as a
candidate version replayed like any other; do not plan a Live rewrite. Only a candidate written
otherwise needs a separate file the operator passes to `live preflight` with `--strategy-file`, which
its validations do not cover (`review.rewritten`). What Live enforces during a run is in
`engine/README.md`.

- Allocate with exactly this method (`OmsType` from `nautilus_trader.model`), keep `__init__` calling
  `super().__init__()`, and leave `manage_stop` off and `market_exit_reduce_only` on, their defaults.
  Preflight does not build the source: a mistake here fails at `start` and uses up the run-id
  (`LIVE_SOURCE_CONFIG`, `LIVE_SOURCE_STOP`).

  ```python
  def __new__(cls, instrument_id, bar_type, **kwargs):
      return Strategy.__new__(cls, StrategyConfig(strategy_id=kwargs["strategy_id"],
          oms_type=OmsType.NETTING, use_uuid_client_order_ids=True))
  ```
- No attribute named `bracket`, `submit_order_list`, `add_exec_algorithm` or `close_all_positions`
  anywhere in the file, unused code included (`LIVE_SOURCE_UNSUPPORTED`). Keep `USES_STOP_LOSS = True`
  and `DAILY_WARMUP = False`; Live delivers no history, so indicators warm up within the run.
- One entry at a time: a base-quantity LIMIT from a flat account, the next only once the last one's
  position and orders are gone (`LIVE_ENTRY_STOPPED`, which stops the run). A GTD expiry under 600 s ahead is rejected by Binance, which ends the run;
  for a shorter lifetime submit GTC and cancel it on a timer. Binance keeps the expiry to the second,
  may end it early or late and report `CANCELED`: handle the end as a cancel.
- Size from native equity with the entry's notional at most 1x equity. Live caps each entry's
  notional at the limit price by `--max-notional-per-order` and `--budget-usdt`, at most 100 and no
  more than the account's USDT cash (`LIVE_BUDGET`); on an account holding the budget, with the cap
  equal to it, the same rule stays inside.
- No order is modified, emulated, linked or given params (`LIVE_ORDER_UNSUPPORTED`); to move a stop,
  submit the new one, then cancel the old.
- On each fill, submit a reduce-only STOP_MARKET and the candidate's reduce-only target, if any, for
  the filled quantity with `position_id=` the owned position; cancel the other when one fills.
- Live replaces `on_stop`: STOP cancels and closes what the source owns.
