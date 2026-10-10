# Strategy authoring

What a strategy file must satisfy to run in the native replay. Code is the authority:
`backtest/r1/{strategy_loader,node_strategy,native_node,run_portfolio}.py` for execution and
`research/records/strategies.py` for publication.

## One file, one account

- One independent strategy is one complete UTF-8 Python file holding every trading rule: signal,
  entries, exits, sizing and order lifecycle. Draft it in a temporary directory, never in Git.
- Import only the standard library, `nautilus_trader` and other locked runtime dependencies. The
  file loads as a standalone module (no relative imports), and the image has no research or
  strategy modules. Under custody there is no network and `/reports` is the only writable host
  mount.
- The replay creates one entry-class instance per instrument; all share one fixed-capital Nautilus
  `MARGIN` account (`ACCOUNT_CONTRACT` in `native_node.py`). Another independent strategy is
  another file and account, not a branch inside this one.

## Entry class and configuration

- Define the entry class in this file as a subclass of `nautilus_trader.trading.Strategy`. The
  metadata `entry_class`, the exported binding and `--strategy-class` must agree. Runtime contract:
  `r1-native-v2`.
- The constructor receives `instrument_id`, `daily_bar_type`, `trade_size` positionally, then
  `trade_start_ns`, `historical_daily_bars`, `execution_bar_minutes` (5), `strategy_id`,
  `signal_variant`, `risk_budget_fraction`, `max_coin_notional_fraction` by keyword
  (`_NodeConfigured.__init__` in `node_strategy.py`). Pass `StrategyConfig(strategy_id=strategy_id)`
  to `Strategy.__init__`.
- `daily_bar_type` is `{instrument_id}-1-DAY-LAST-INTERNAL` without an aggregation source; subscribe
  to it with `@5-MINUTE-EXTERNAL` appended, or no daily bars arrive.
- Besides `historical_daily_bars`, only scalars arrive: signal label, risk budget (bps / 10000, or
  `None`), coin notional cap (percent / 100) and a fixed quantity per instrument. The exit label and
  the daily-warmup flag reach only `validate_replay_configuration`. Every other parameter is a
  constant in the file.
- Accept only the labels and values the file implements. A signal label listed in `TIER_RATIOS`
  (`backtest/r1/checks/audit_tiered_native.py`) adds that tier shape's audit gates; give a new rule
  its own label.

## Required hooks

The runner refuses a class missing any of them.

- `validate_replay_configuration(config)`: classmethod or staticmethod, called before inputs load
  with the resolved configuration. Raise `ValueError` unless `signal_variant`, `exit_variant`,
  `daily_warmup`, `risk_budget_bps` and `coin_notional_cap_pct` are values the file implements.
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
- With `--daily-warmup`, `historical_daily_bars` holds at least 200 contiguous
  `-1-DAY-LAST-EXTERNAL` bars, the last stamped 1 ms before `--start`, so `--start` must be 00:00
  UTC (otherwise the list is `[]`). The engine does not replay them; seed state from the list.
- Matching uses 5-minute bars and the order inside one bar is unknown. Do not encode an intrabar
  path.

## Orders and accounting

- Submit each entry with its protection as one native bracket (`self.order_factory.bracket(...)`:
  OTO entry, OUO stop-market and limit-target children) via `self.submit_order_list(...)`; use GTD
  with `expire_time` for an entry lifetime. The generic audit fails unless every position still open
  at the end carries a stop-market and a limit exit for its full quantity.
- The pinned Nautilus lists the stop first in the entry's `linked_order_ids` and activates children
  in that order, so an entry bar that reaches the stop gets the target rejected and fails the run.
  Rebuild the entry with the target first (edit `to_dict()`, then `type(entry).from_dict`);
  reordering the submitted list does not help. Recheck after any Nautilus change.
- Nautilus owns fills, fees, funding, positions and the account. React to order and position events
  and read `self.cache` and `self.portfolio`. Never infer a fill from a bar's range, compute fees or
  funding, or keep a private ledger.
- Size from native state: `self.portfolio.equity(venue=...)`, instrument `multiplier`,
  `make_price`, `make_qty(value, round_down=True)`, `min_quantity`, `min_notional`. The runner
  passes the budget and cap; the file implements the sizing.

## Verify Nautilus behavior

Use the pinned package (`uv run --frozen python -c "import nautilus_trader;
print(nautilus_trader.__version__)"`) and read signatures from it; upstream docs are leads until
checked locally. Test uncertain order or event behavior with a small probe in a temporary directory:
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
    "entry_class": "EntryClass", "runtime_contract": "r1-native-v2", "status": "research",
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

Run the exported revision on a pilot of two liquid instruments in `--coins`, then on the full
instrument set with the same configuration. A run a decision cites goes through
`research.records.artifacts run` ([seal.md](seal.md)), which supplies the strategy arguments
itself. A direct run is a `/tmp` diagnostic: its window counts as inspected, and the next attempt's
plan lists it under unregistered replays.

```bash
uv run --frozen python -m backtest.r1.run_portfolio \
  --strategy-file /tmp/RUNDIR/strategy.py --strategy-class ENTRY-CLASS \
  --strategy-sha256 SOURCE-SHA256 --strategy-binding /tmp/RUNDIR/binding.json \
  --catalog-root MINUTE-CATALOG --daily-root DAILY-CATALOG --quantity-csv QUANTITIES.csv \
  --coins COIN [COIN ...] --start START --trade-start TRADE-START --end END \
  --signal-variant SIGNAL --exit-variant EXIT --risk-budget-bps BPS --coin-notional-cap-pct PCT \
  --output /tmp/RUNDIR/pilot
uv run --frozen python -m backtest.r1.checks.audit_tiered_native \
  --run /tmp/RUNDIR/pilot --catalog-root MINUTE-CATALOG --output /tmp/RUNDIR/pilot-audit.json
```

Add `--daily-warmup` only if the file requires it; times need `Z` or a UTC offset on five-minute
boundaries. In the pilot, confirm every entry has its children, no order precedes trade start, none
was denied or rejected, and fills, fees, funding and account rows appear in the native reports. A
clean exit is not evidence.
