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
  metadata `entry_class`, the exported binding and `--strategy-class` must agree. Runtime contract:
  `r1-native-v4`.
- The constructor receives `instrument_id`, `daily_bar_type`, `trade_size` positionally, then
  `trade_start_ns`, `historical_daily_bars`, `execution_bar_minutes` (5) and `strategy_id` by
  keyword (`_Configured.__init__` in `run.py`). Pass `StrategyConfig(strategy_id=strategy_id)` to
  `Strategy.__init__`.
- `daily_bar_type` is `{instrument_id}-1-DAY-LAST-INTERNAL` without an aggregation source; subscribe
  to it with `@5-MINUTE-EXTERNAL` appended, or no daily bars arrive.
- Besides `historical_daily_bars`, only a fixed quantity per instrument arrives. The runner has no
  signal, exit, warmup or sizing option: every rule and parameter is in the file, and a variant is
  a new revision of it.
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
- With `DAILY_WARMUP = True`, `historical_daily_bars` holds at least 200 contiguous
  `-1-DAY-LAST-EXTERNAL` bars, the last stamped 1 ms before `--start`, so `--start` must be 00:00
  UTC or the replay fails; without it the list is `[]`. The engine does not replay them; seed state
  from the list.
- Matching uses 5-minute bars and the order inside one bar is unknown. Do not encode an intrabar
  path.

## Orders and accounting

- Submit each entry with its protection as one native bracket (`self.order_factory.bracket(...)`:
  OTO entry, OUO stop-market and limit-target children) via `self.submit_order_list(...)`; use GTD
  with `expire_time` for an entry lifetime. The generic audit fails unless every position still open
  at the end carries a stop-market and a limit exit for its full quantity.
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
  beside it. The plan reading of `artifacts report` refuses a run with any order lacking a plan tag.
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

## Publish and bind

1. `uv run --frozen python -m research.records.cli ledger status`: `dirty` must be false; `version`
   is the expected version.
2. Write metadata next to the draft: `strategy_id`, `family_id`, `description`, `entry_class`,
   `runtime_contract`, `status` (`research`, `retired` or `archived`), and optional `parents` and
   `attempt_refs`. IDs use 1 to 100 letters, digits, `.`, `_` or `-`, starting with a letter or
   digit. A new revision keeps its ID and family. A derivation takes a new ID in the same family
   with fixed parent revisions, each stating its `difference`; a fresh strategy has no parents.
   Nothing is inferred from names, Git or code similarity. `attempt_refs` may cite only published
   attempts.

   ```json
   {"strategy_id": "NEW-ID", "family_id": "FAMILY-ID", "description": "Rule and non-claims.",
    "entry_class": "EntryClass", "runtime_contract": "r1-native-v4", "status": "research",
    "parents": [{"strategy_id": "PARENT-ID", "revision": 1, "difference": "What changed."}],
    "attempt_refs": []}
   ```

3. Publish. There is no dry run; a refusal writes nothing. It parses the file and checks one
   top-level entry class without executing it, which proves nothing about rules, clock or safety.
   The same operation ID and content return the original result; different content under that ID
   is refused.

   ```bash
   uv run --frozen python -m research.records.cli strategy publish \
     --file /tmp/WORKDIR/metadata.json --source /tmp/WORKDIR/strategy.py \
     --expected-version VERSION --operation-id UNIQUE-OPERATION-ID
   ```

4. The returned `binding` (`database`, `commit`, `strategy_id`, `revision`, `source_sha256`,
   `entry_class`, `runtime_contract`) goes unchanged into the pending attempt's `strategy_binding`,
   and it fixes `artifacts run --strategy-revision` and `--source-at` ([seal.md](seal.md)). A later
   source change is a new revision and a new attempt.

```bash
uv run --frozen python -m research.records.cli strategy list [--family-id F] [--status S] [--all-revisions]
uv run --frozen python -m research.records.cli --at COMMIT strategy show STRATEGY-ID --revision N --brief
uv run --frozen python -m research.records.cli --at COMMIT strategy lineage STRATEGY-ID --revision N
uv run --frozen python -m research.records.cli --at COMMIT strategy export STRATEGY-ID --revision N \
  --destination /tmp/RUNDIR/strategy.py --binding-output /tmp/RUNDIR/binding.json
```

`export` refuses an existing destination and verifies the bytes. Its binding carries the `--at`
commit; the attempt and `--source-at` must use the same commit.

## Pilot, then full replay

Run the draft on a pilot of two liquid instruments in `--coins`, then on the full instrument set
with the same configuration, through `artifacts run --explore` ([seal.md](seal.md)); it runs the
current main image and reports the trial. A run a decision cites is sealed by `artifacts run`
without `--explore`, which supplies the strategy arguments itself. Never run the replay with
`docker run` or `python -m backtest...` directly.

```bash
uv run --frozen python -m research.records.artifacts run --explore \
  --strategy-file /tmp/RUNDIR/strategy.py --strategy-class ENTRY-CLASS --output /tmp/RUNDIR/pilot -- \
  --catalog-root MINUTE-CATALOG --daily-root DAILY-CATALOG --quantity-csv QUANTITIES.csv \
  --coins COIN [COIN ...] --start START --trade-start TRADE-START --end END
```

Times need `Z` or a UTC offset on five-minute
boundaries. In the pilot, confirm every entry has its children, every order carries one plan tag
and plans on one instrument do not overlap, no order precedes trade start, none was denied or
rejected, and fills, fees, funding and account rows appear in the native reports. A
clean exit is not evidence.
