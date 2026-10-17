# Strategy authoring

What a strategy file must satisfy to run in the native replay. Code is the authority:
`backtest/{load,run,report}.py` for execution and
`research/records/strategies.py` for publication.

## One file, one account

- One independent strategy is one complete UTF-8 Python file holding every trading rule: signal,
  entries, exits, sizing and order lifecycle. Draft it in a temporary directory, never in Git.
- Import only the standard library, `nautilus_trader` and other locked runtime dependencies. The
  file loads as a standalone module (no relative imports), and the image has no research or
  strategy modules. Under custody there is no network and `/reports` is the only writable host
  mount.
- The replay creates one entry-class instance per instrument; all share one fixed-capital Nautilus
  `MARGIN` account (`ACCOUNT_CONTRACT` in `run.py`). Another independent strategy is
  another file and account, not a branch inside this one.

## Entry class and configuration

- Define the entry class in this file as a subclass of `nautilus_trader.trading.Strategy`. The
  published `--entry-class` and `--strategy-class` of an exploration must agree. Runtime contract:
  `r1-native-v5`.
- The constructor receives `instrument_id` and `daily_bar_type` positionally, then
  `trade_start_ns`, `historical_daily_bars`, `execution_bar_minutes` (5), `strategy_id` and
  `pool_membership` by keyword (`_Configured.__init__` in `run.py`). Pass
  `StrategyConfig(strategy_id=strategy_id)` to `Strategy.__init__`.
- `daily_bar_type` is `{instrument_id}-1-DAY-LAST-INTERNAL` without an aggregation source; subscribe
  to it with `@5-MINUTE-EXTERNAL` appended, or no daily bars arrive.
- `pool_membership` is a tuple of `(start_ns, end_ns)` UTC intervals in which the instrument is in
  the monthly pool (empty when the replay names contracts the pool never held). The pool rule is
  that a contract out of the pool takes no new positions and only closes what it holds; apply it in
  the file, the runner and the audit do not.
- No quantity arrives: size from the account and price in the file. The runner has no signal,
  exit, warmup or sizing option: every rule and parameter is in the file, and a variant is a new
  revision of it.
- Set the class attribute `DAILY_WARMUP = True` if the file needs historical daily bars; it
  defaults to `False`, and any other value is refused.

## Required hooks

The runner refuses a class missing either of them before any input loads.

- `replay_diagnostics()`: per instance after the replay; a dict of plain JSON source counters. The
  keys `coin`, `instrument`, `quantity`, `counts` and `positions` are refused.
- `replay_integrity_findings(orders_denied_or_rejected)`: per instance, with one bool that is true
  if any order in the replay was denied or rejected. Return nonempty strings for violated source
  invariants, or `[]`.

Any finding or any denied or rejected order fails the run: `summary.json` is written with
`integrity_passed: false` and the runner exits nonzero.

## Causal clock

- Input is 5-minute LAST bars (`{instrument_id}-5-MINUTE-LAST-EXTERNAL`), MARK updates and funding
  updates; no quotes, trades or books. Aggregate natively with
  `{instrument_id}-<N>-<UNIT>-LAST-INTERNAL@5-MINUTE-EXTERNAL`; aggregated bars are stamped on
  close.
- Decide only from completed bars on the engine clock, never host time. When a rule reads a
  prior-bar indicator, update it after the decision.
- Bars between `--start` and `--trade-start` are warm-up. Nothing blocks orders there; the file
  must not submit before `trade_start_ns`.
- With `DAILY_WARMUP = True`, `historical_daily_bars` holds the unbroken run of daily
  `-1-DAY-LAST-EXTERNAL` bars (derived from 1-minute bars, from 2020 at the earliest) that ends
  1 ms before `--start`, at least 200 of them, so `--start` must be 00:00 UTC or the replay fails;
  without it the list is `[]`. The engine does not replay them; seed state
  from the list.
- Matching uses 5-minute bars and the order inside one bar is unknown. Do not encode an intrabar
  path.

## Orders and accounting

- Submit each entry with its protection as one native bracket (`self.order_factory.bracket(...)`:
  OTO entry, OUO stop-market and limit-target children) via `self.submit_order_list(...)`; use GTD
  with `expire_time` for an entry lifetime.
- Throughout the replay, the audit refuses a run in which a position is larger than its accepted
  reduce-only stop orders on the closing side (stop-market, stop-limit or trailing stop) for longer
  than one five-minute bar, and names the time, instrument, quantity and order IDs. A source with no
  stop-loss by design sets the class attribute `USES_STOP_LOSS = False` (default `True`, any other
  value is refused); its uncovered intervals are then reported, not refused.
- The pinned Nautilus lists the stop first in the entry's `linked_order_ids` and activates children
  in that order, so an entry bar that reaches the stop gets the target rejected and fails the run.
  Rebuild the entry with the target first (edit `to_dict()`, then `type(entry).from_dict`);
  reordering the submitted list does not help. Recheck after any Nautilus change.
- Nautilus owns fills, fees, funding, positions and the account. React to order and position events
  and read `self.cache` and `self.portfolio`. Never infer a fill from a bar's range, compute fees or
  funding, or keep a private ledger.
- Size from native state: `self.portfolio.equity(venue=...)`, instrument `multiplier`,
  `make_price`, `make_qty(value, round_down=True)`, `min_quantity`, `min_notional`.

## Partial entries and expiry

- Bar execution caps a fill at the bar's volume, so a limit entry can fill partly. The stop and
  target activate at the first fill with the entry's full quantity; reduce-only caps them at the
  position.
- When a bracket entry ends, the pinned Nautilus venue cancels its stop and target even after a
  partial fill, and the filled quantity is left unprotected. This holds for GTD expiry, for
  `cancel_order` and for a modify down to the filled quantity, and neither `manage_contingent_orders`
  nor `manage_gtd_expiry` changes it.
- Re-protect in `on_order_expired` and `on_order_canceled`, as below. When an ended entry has fills
  and the position is open, submit a reduce-only stop at the stop child's trigger and a reduce-only
  limit at the target child's price, with the children's tags, for the shortfall. The shortfall is
  the position minus the unfilled reduce-only stops that remain alive. A child is alive while its
  entry is filled, or still working with a fill: children of an unfilled entry are dormant, and
  children of an ended entry are being canceled.
- The new orders are accepted at the same timestamp, so no bar passes uncovered. Tiers that end
  together get one pair.
- The pair is not linked, so cancel the plan's remaining orders when the position goes flat (for
  example `self.cancel_all_orders(instrument_id)` in `on_position_closed`).
- `tests/backtest/test_partial_entry_protection.py` replays this code natively: one tier filled 0.25
  of 16.339 before its GTD expiry, and two tiers ending together. The bare bracket fails the audit;
  this handler passes. Recheck after any Nautilus change.

```python
# from decimal import Decimal; from nautilus_trader.model import OrderSide, OrderStatus, OrderType
def on_order_expired(self, event):
    self.cover_filled_entry(event.client_order_id)

def on_order_canceled(self, event):
    self.cover_filled_entry(event.client_order_id)

def cover_filled_entry(self, client_order_id):
    entry = self.cache.order(client_order_id)
    if entry.parent_order_id is not None or not entry.linked_order_ids or entry.filled_qty.as_decimal() == 0:
        return
    position = next(iter(self.cache.positions_open(instrument_id=entry.instrument_id, strategy_id=self.strategy_id)), None)
    if position is None:
        return
    closing = OrderSide.SELL if position.is_long else OrderSide.BUY

    def lives(order):
        parent = self.cache.order(order.parent_order_id) if order.parent_order_id else None
        return parent is None or (parent.filled_qty.as_decimal() > 0
                                  and (parent.is_open or parent.status == OrderStatus.FILLED))

    covered = sum((order.leaves_qty.as_decimal() for order in self.cache.orders_open(
        instrument_id=entry.instrument_id, strategy_id=self.strategy_id)
        if order.is_reduce_only and order.order_type == OrderType.STOP_MARKET and order.side == closing
        and lives(order)), Decimal(0))
    shortfall = position.quantity.as_decimal() - covered
    if shortfall <= 0:
        return
    children = [self.cache.order(identity) for identity in entry.linked_order_ids]
    stop = next(order for order in children if order.order_type == OrderType.STOP_MARKET)
    target = next(order for order in children if order.order_type == OrderType.LIMIT)
    quantity = self.cache.instrument(entry.instrument_id).make_qty(shortfall)
    self.submit_order(self.order_factory.stop_market(
        entry.instrument_id, closing, quantity, stop.trigger_price, reduce_only=True, tags=list(stop.tags)))
    self.submit_order(self.order_factory.limit(
        entry.instrument_id, closing, quantity, target.price, reduce_only=True, tags=list(target.tags)))
```

## Plans and sizing

- A plan is everything one signal submits: every entry tier with its shared stops and targets, and
  any later order that changes or closes that position. Give every order exactly one tag
  `plan:PLAN-ID` (`entry_tags`, `sl_tags` and `tp_tags` on a bracket, `tags` otherwise), unique
  within the run, for example the instrument and the signal's bar timestamp. Other tags may sit
  beside it. The product's plan reading refuses a run with any order lacking a plan tag.
- One instrument has at most one active plan at a time: from its first submitted order until its
  position is flat and none of its orders is open. A plan holds at most one position: when it goes
  flat, cancel its remaining orders rather than let a leftover tier reopen it. Do not submit a new
  plan for that instrument before then. The plan reading refuses overlapping plans, a position
  holding fills of two plans and a plan with fills in two positions.
- Sizing, per-plan risk, notional limits and leverage use are constants in this file, fixed with
  its source hash. They are your design variables ([feasibility.md](feasibility.md)): change them
  as a new revision, never record them as user constraints.
- Margin and leverage are Nautilus's: the account is `MARGIN` at the leverage in
  `ACCOUNT_CONTRACT`, Nautilus denies an order the account cannot margin, and a denied order fails
  the run. Do not add a separate notional cap to imitate it.
- Set the largest order notional as a share of its bar's traded volume as a constant in the file,
  and report that limit and the largest observed share in the decision.

## Verify Nautilus behavior

Use the pinned package (`uv run --frozen python -c "import nautilus_trader;
print(nautilus_trader.__version__)"`) and read signatures from it; upstream docs are leads until
checked locally. Test uncertain order or event behavior with a small probe script in a temporary
directory, run on the host with `uv run --frozen --project REPO python /tmp/RUNDIR/probe.py` (it
imports `backtest` and `research`; no `PYTHONPATH`, no `docker run`):
`BacktestEngine(BacktestEngineConfig())` plus one added `Strategy()` builds and inspects orders; add
an instrument and bars to observe fills.

## Publish

Publish a revision only to seal it; drafts are explored from their file. Parsing checks one
top-level entry class without executing the file, which proves nothing about rules, clock or
safety. A derivation names its parent revision and the difference; a fresh strategy has none.
IDs use 1 to 100 letters, digits, `.`, `_` or `-`.

```bash
uv run --frozen python -m research.records.cli strategy publish --source /tmp/RUNDIR/strategy.py \
  --strategy-id ID --entry-class ENTRY-CLASS --description "Rule, claims it uses (C<n>) and non-claims." \
  [--parent ID@N --difference "What changed."]
```

It returns `ID@N`, which `artifacts run --strategy` takes ([runs.md](runs.md)). Any later source
change is a new revision. `strategy show ID@N` and `strategy export ID@N --destination FILE` read it
back ([records.md](records.md)).

## Pilot, then full replay

Run the draft on a pilot of two liquid instruments in `--symbols`, then on the full instrument set
(`--universe pool`)
with the same configuration, through `artifacts run --explore` ([runs.md](runs.md)); it runs the
current main image and writes a trial. A run a freeze or confirmation cites is sealed by
`artifacts run --strategy ID@N`, which supplies the strategy arguments itself. Never run the replay
with `docker run` or `python -m backtest...` directly.

```bash
uv run --frozen python -m research.records.artifacts run --explore \
  --strategy-file /tmp/RUNDIR/strategy.py --strategy-class ENTRY-CLASS --output /tmp/RUNDIR/pilot -- \
  --symbols BTCUSDT ETHUSDT --start START --trade-start TRADE-START --end END
```

Times need `Z` or a UTC offset on five-minute
boundaries. In the pilot, confirm every entry has its children, every order carries one plan tag
and plans on one instrument do not overlap, no order precedes trade start, none was denied or
rejected, and fills, fees, funding and account rows appear in the native reports. A
clean exit is not evidence.
