# Native runs through the official entry

Every native replay uses `research.records.artifacts run`, writes a trial before starting and runs
Nautilus plus its independent auditor inside a digest-pinned CI image. Complete candidate evidence
uses published source and `--hypothesis`; unregistered exploration is temporary diagnostic evidence.
An invalid or incomplete run has no economic feedback.

Research profile and read-only market profile are selected separately. `--market-profile` accepts
an explicit JSON profile path so the market profile need not share `TRADE_LEDGER_HOME` with research.
Pin `--market` to a Dolt commit. The export uses real 1m LAST bars, 1m MARK updates, stored funding
and derived daily warmup. `--symbols` states a bounded engineering universe; `--universe pool` uses
all members over the window. Pool membership is passed to source, not enforced as an economic audit.
Inspect listings, gaps and assumptions; do not backfill missing minutes or silently hand-pick winners.

```bash
uv run --frozen python -m research.records.cli --ledger RESEARCH hypothesis register \
  --id H01 --plan /tmp/RUNDIR/plan.json --runtime IMAGE@sha256:DIGEST \
  --market-profile /absolute/path/market.json --market MARKET-COMMIT -- \
  --universe pool --start START --trade-start TRADE-START --end END
uv run --frozen python -m research.records.artifacts --ledger RESEARCH run \
  --hypothesis H01 --strategy ID@2 --runtime IMAGE@sha256:DIGEST \
  --market-profile /absolute/path/market.json --market MARKET-COMMIT -- \
  --universe pool --start START --trade-start TRADE-START --end END
uv run --frozen python -m research.records.artifacts --ledger RESEARCH report RUN-ID
uv run --frozen python -m research.records.cli --ledger RESEARCH hypothesis compare --id H01 --run RUN-ID
uv run --frozen python -m research.records.cli --ledger RESEARCH candidate list
```

The registration fixes runtime, effective configuration, market commit, universe, exact exported
content and exporter identity. Each replay freshly exports and verifies the same identity; full
raw tree hashes before/after execution detect mutation. Only `export.json` elapsed seconds are
excluded from cross-export semantic hashing. Source hash, parent and change are rechecked before
atomic binding. Each registered cell is attempted once, including invalid/interrupted attempts.

Times need Z/explicit offset and one-minute alignment with `start <= trade-start < end`. Sealed
candidate research covers the goal development window. Runtime `r1-native-v7` fixes execution to
one minute and passes `execution_bar_minutes=1` to the source; signal timeframe is source-owned.
New backtest code requires a new CI digest. Main-image/fresh-checkout protections still apply to
legacy freeze/confirmation, so an unmerged test branch cannot claim independent confirmation.

Exploration uses `--explore --strategy-file FILE --strategy-class CLASS --output /tmp/NEW-DIR`,
plus the same runtime/market/window inputs. Never use it to bypass registration or claim fixed
candidate comparisons. Host API probes may inspect the pinned installed library; replays still
use artifacts. Runtime changes require native checks of orders, clocks, stops, fees, funding and
account; a 1m behavior change is not parity with 5m.

Product reports provide annual net account return, native MARK drawdown, net plan win rate,
reconciled closed economics, fees/funding/open residual, closed-by-year and input/cost identities.
Missing readings stay null with limitations. Extra statistics follow `nautilus-report-analysis`.
Read/write evidence through CLI and use fixed `--at` refs for readback, audit, export and recovery.


Original runner/auditor stdout, stderr, phase exits, source/hash and explicit structured runtime
exceptions are appended under product-owned `trial-N-execution-start` / `trial-N-execution` bundles.
Zero-byte logs have a captured-empty manifest; missing/not-started bytes have no content hash.
Constructor/callback exceptions fail the new runner even if the native actor catches them; ordinary
WARN messages are not text-matched into invalidity. Interruption remains a consumed attempt.
SIGKILL cannot execute final capture: retain the printed original work directory and start receipt,
state capture missing, and append explicitly labeled recovery evidence without replacing history.
Old missing stderr stays missing; later probes cannot prove what an earlier process emitted.

Each export receipt includes fixed-commit 1m LAST/MARK gaps/alignment, zero-volume counts, stored
funding times, member months, first/last data proxies and listing/delisting uncertainty. Review the
whole input interval: indicator warmup, entry membership and possible holdings beyond member exit.
Use `research.market.cli coverage --at COMMIT --symbols ... --start START --end END` for read-only
bounded coverage diagnosis. Review actual source indicator-ready timestamps separately; raw counts
are insufficient. Missing/zero-volume minutes and no funding are facts, not automatic economic
failure. Do not synthesize inputs, silently shrink symbols/windows, or call BTC/ETH full-pool proof.
If a full-pool replay is blocked, retain the member/warmup/holding/funding cause and ask the user
for scope selection; bounded engineering remains explicitly bounded.
