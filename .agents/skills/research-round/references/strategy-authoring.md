# Strategy authoring

What a strategy file must satisfy to run in the native replay. Code is the authority:
`engine/{config,load,run,report}.py` for execution. `candidate new` writes a scaffold with the
header template, the entry class, the two hooks and a sizing helper.

## Contents

- One file, one account
- Entry class and configuration
- Required hooks
- Causal clock
- Orders and protection
- Plans, sizing and capital
- Verify Nautilus behaviour
- Publish, precheck and pilot

## One file, one account

- One independent strategy is one complete UTF-8 Python file holding every trading rule: signal,
  entries, exits, sizing and order lifecycle.
- Import only the standard library, `nautilus_trader` and other locked runtime dependencies. The
  file loads as a standalone module (no relative imports), and the image has no research or
  strategy modules. Under custody there is no network and `/reports` is the only writable host
  mount.
- The replay creates one entry-class instance per instrument; all share one fixed-capital Nautilus
  `MARGIN` account (`ACCOUNT_CONTRACT` in `run.py`). Another independent strategy is another file
  and account, not a branch inside this one.

## Entry class and configuration

- Define the entry class in this file as a subclass of `nautilus_trader.trading.Strategy`. The
  published `--entry-class` and `--strategy-class` of an exploration must agree.
- The constructor receives `instrument_id` and `daily_bar_type` positionally, then
  `trade_start_ns`, `historical_daily_bars`, `execution_bar_minutes` (1), `strategy_id` and
  `universe_membership` by keyword (`_Configured.__init__` in `run.py`). Pass
  `StrategyConfig(strategy_id=strategy_id)` to `Strategy.__init__`.
- `daily_bar_type` is `{instrument_id}-1-DAY-LAST-INTERNAL`, the type the daily bars arrive
  with: in `on_bar`, a daily bar's `bar.bar_type` equals `daily_bar_type`. Subscribe with the
  aggregation source appended, `BarType.from_str(f"{daily_bar_type}@1-MINUTE-EXTERNAL")`, and
  keep the two apart: the subscription type for `subscribe_bars`, `daily_bar_type` for matching
  bars.
- `universe_membership` is a tuple of `(start_ns, end_ns)` UTC intervals in which the instrument is
  in the monthly universe (empty when the replay names contracts the universe never held), cut at
  its listing and at its first PRE_CLOSE or termination when a lifecycle bundle is given. A
  contract out of the universe takes no new positions and only closes what it holds; apply it in
  the file, the runner and the audit do not.
- With a lifecycle bundle the engine delivers the contract's `InstrumentStatus` (PRE_CLOSE, CLOSE)
  and, when the exchange published one, its settlement `InstrumentClose`; subscribe with
  `subscribe_instrument_status`. After CLOSE the market rejects orders, and the audit refuses a
  position or a working order left at a termination without a settlement price.
- No quantity arrives: size from the account and price in the file. The runner has no signal,
  exit, warmup or sizing option: every rule and parameter is in the file, and a variant is a new
  revision of it.
- Set the class attribute `DAILY_WARMUP = True` if the file needs historical daily bars (default
  `False`). A baseline that later comparisons build on takes enough warm-up that a variant with a
  longer indicator is ready as early and needs no other `--start`, which would change the input
  identity.

## Required hooks

The runner refuses a class missing either of them.

- `replay_diagnostics()`: per instance after the replay; a dict of plain JSON source counters.
- `replay_integrity_findings(orders_denied_or_rejected)`: per instance, with one bool that is true
  if any order in the replay was denied or rejected. Return nonempty strings for violated source
  invariants, or `[]`.

Any finding or any denied or rejected order fails the run.

## Causal clock

- Input is 1-minute LAST bars (`{instrument_id}-1-MINUTE-LAST-EXTERNAL`), MARK updates and funding
  updates; no quotes, trades or books. Aggregate natively by subscribing to
  `{instrument_id}-<N>-<UNIT>-LAST-INTERNAL@1-MINUTE-EXTERNAL`; the aggregated bars arrive as
  `{instrument_id}-<N>-<UNIT>-LAST-INTERNAL` (the subscription type's `.standard()`), stamped on
  close.
- Every market-data price or indicator input used to decide whether, how much or at what price
  to submit (signals, quantity inputs and specification-check prices included) must come from a
  completed event strictly earlier than submission. Trace each input's timestamp; guarding the signal
  timestamp alone does not establish this. Submit on a later event so fills cannot share the
  input bar's close. When a rule reads a prior-bar indicator, update it after the decision.
  Native order/fill/account and lifecycle events follow their own event-ordering contracts;
  do not delay required protection or termination actions with a blanket bar gate.
- Bars between `--start` and `--trade-start` are warm-up. Nothing blocks orders there; the file
  must not submit before `trade_start_ns`.
- With `DAILY_WARMUP = True`, `historical_daily_bars` holds the unbroken run of daily
  `-1-DAY-LAST-EXTERNAL` bars (derived from 1-minute bars, from 2020 at the earliest) that ends
  1 ms before `--start`, at least 200 of them, so `--start` must be 00:00 UTC; without it the list
  is `[]`. The engine does not replay them; seed state from the list.
- Matching uses 1-minute bars and the order inside one bar is unknown. Do not encode an intrabar
  path.

## Orders and protection

- Submit each entry with its protection as one native bracket (`self.order_factory.bracket(...)`:
  OTO entry, OUO stop-market and limit-target children) via `self.submit_order_list(...)`; use GTD
  with `expire_time` for an entry lifetime.
- The audit refuses a run in which a position is larger than its accepted reduce-only stop orders
  on the closing side for longer than one one-minute bar. A source with no stop-loss by design sets
  the class attribute `USES_STOP_LOSS = False` (default `True`); its uncovered intervals are then
  reported, not refused.
- Two behaviours of the pinned Nautilus break protection; recheck both after any Nautilus change:
  - It lists the stop first in the entry's `linked_order_ids` and activates children in that
    order, so an entry bar that reaches the stop gets the target rejected and fails the run.
    Rebuild the entry with the target first (edit `to_dict()`, then `type(entry).from_dict`);
    reordering the submitted list does not help.
  - When a bracket entry ends (GTD expiry, `cancel_order`, a modify down to the filled quantity)
    after a partial fill, the venue cancels its stop and target and leaves the filled quantity
    unprotected. Re-protect in `on_order_expired` and `on_order_canceled` with the handler
    `cover_filled_entry` in `tests/engine/test_partial_entry_protection.py`, which that test
    replays natively, and cancel the plan's remaining orders when the position goes flat.
- Nautilus owns fills, fees, funding, positions and the account. React to order and position events
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
- Sizing, per-plan risk, notional limits and leverage use are constants in this file, fixed with
  its source hash.
- When the instances share one account, the source states the capital budget and its allocation:
  how one batch of signals shares capital, what happens to an opportunity that gets none (smaller,
  later or skipped), and that exit orders only reduce. Callback order and engine denials are not an
  allocation rule. A rule merged from another version is still allocated in the same account and
  registered as one change.
- Margin and leverage are Nautilus's: the account is `MARGIN` at the leverage in
  `ACCOUNT_CONTRACT`, and a denied order fails the run. Do not add a separate notional cap to
  imitate it.
- A cap on order size as a share of bar volume is a constant in the file. Carry the excess to
  later bars or cap on a longer volume window; dropping it makes the position a random function of
  one minute's volume.

## Verify Nautilus behaviour

Verify uncertain order or event behaviour with a small native probe before relying on it: a script
in a temporary directory, run on the host with `uv run --frozen --project REPO python
/tmp/RUNDIR/probe.py` (it imports `engine` and `market`), building a
`BacktestEngine(BacktestEngineConfig())` with one `Strategy()`, an instrument and bars.

## Publish, precheck and pilot

Publish a revision only to precheck and register it; parsing checks one top-level entry class
without executing the file, which proves nothing about rules, clock or safety. A derivation names
its parent and the difference; a root has none. A new revision of the same strategy ID states in
its description what it fixes from the previous revision and why, since the difference stays
relative to the parent.

```bash
uv run --frozen python -m cli.main candidate publish --file /tmp/RUNDIR/strategy.py \
  --strategy-id ID --entry-class ENTRY-CLASS --description "Rule, sources and non-claims." \
  [--parent ID@N --difference "What changed."]
```

It returns `ID@N`, which `replay precheck`, the registration grid and `replay run` take. Any later
source change is a new candidate. A draft can be tried before publishing with `replay explore`; it
is never evidence. In the precheck, confirm every entry has its children, every order carries one
plan tag and plans on one instrument do not overlap, no order precedes trade start, none was denied
or rejected, and fills, fees, funding and account rows appear in the native reports. Never run the
replay with `docker run` or `python -m engine...` directly.
