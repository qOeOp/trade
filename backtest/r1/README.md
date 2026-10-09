# R1 native replay

`python -m backtest.r1.run_portfolio` is the single R1 backtest entry. It loads
one complete external Strategy file after checking its exact SHA-256. Dolt owns
published source revisions; working files can live in a temporary directory.
The first migrated strategy is `r1.broad-two-tier` (H19a), family `r1`, entry
class `R1Strategy`, runtime contract `r1-native-v1`.

R1's 37 instruments share one 100,000 USDT Nautilus `BacktestNode` margin
account. The published `nautilus_trader==2.0.0rc3` package owns data replay,
orders, fills, funding settlement, risk, portfolio accounting and reports.
No exchange trading credential is needed.

For a registered experiment, follow the [source, preregistration and artifact
guide](../../research/records/README.md). Its existing custody command exports
a fixed Dolt source revision, executes this runner and the auditor in the same
digest-pinned OCI image, and seals the result outside Git and `/tmp`.
A direct host run below is a temporary diagnostic and uses the host environment.

## Export and run H19a

Use the exact Dolt commit returned by source publication as `SOURCE_AT`.
Export refuses to overwrite an existing source or binding destination.

```bash
uv sync --frozen
SOURCE_AT=EXACT-DOLT-SOURCE-COMMIT
STRATEGY_WORKDIR=$(mktemp -d /tmp/trade-h19a.XXXXXX)
uv run --frozen python -m research.records.cli --at "$SOURCE_AT" \
  strategy export r1.broad-two-tier --revision 1 \
  --destination "$STRATEGY_WORKDIR/strategy.py" \
  --binding-output "$STRATEGY_WORKDIR/binding.json"
R1_COINS=(BTC ETH BNB ADA XRP SOL DOGE LTC TRX LINK DOT AVAX BCH ETC XLM ATOM FIL NEAR UNI AAVE ICP APT ARB SUI OP INJ TIA SEI PEPE SHIB HBAR ALGO FET WLD IMX STX LDO)
uv run --frozen python -m backtest.r1.run_portfolio \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" \
  --strategy-class R1Strategy \
  --strategy-sha256 8b708592a27732311071b0b00d237001b6e6bb96725bcc3a842cf35ae2184b4a \
  --strategy-binding "$STRATEGY_WORKDIR/binding.json" \
  --catalog-root /path/to/r1-minute-catalog \
  --daily-root /path/to/r1-daily-catalog \
  --quantity-csv /path/to/r1-minute-catalog/per_coin_stop_fix.csv \
  --coins "${R1_COINS[@]}" \
  --start 2025-10-07T00:00:00Z --trade-start 2025-10-17T00:00:00Z \
  --end 2026-10-07T08:30:00Z \
  --signal-variant support-broad-two-tier-4h --exit-variant tier-target-b \
  --risk-budget-bps 25 --coin-notional-cap-pct 5 \
  --output /tmp/r1-external-h19a-37
```

The hash above identifies the byte-preserving initial H19a migration only.
For a later revision, use that revision's binding and source hash. A current
runtime accepts H19a broad two-tier / tier-target-b with 25-bp total stop risk
and a 5% coin notional cap. It rejects other variant names explicitly. H18a,
H23a–H27a and other multi-module historical variants have not been individually
consolidated or migrated; replay them only from their exact historical source
and matching environment. Current runtime code imports no product strategy or
historical variant module.

`--mark-root` optionally selects the derived MARK Catalog cache. The default
cache is keyed by input Catalog path and interval under the temporary directory.
The downloaded source Catalog stays read-only. `BacktestNode` loads funding
directly from it. `native_node.py` turns MARK bar closes into native
`MarkPriceUpdate` data, validates LAST/MARK alignment, and verifies cached mark
events before reuse. `replay_inputs.py` checks input receipts and funding
coverage. There is no second matching or account engine.

## Fixed runtime image

The maintained build inputs live in `runtime/`; the image contains Python,
Nautilus, locked dependencies, shared replay and the native auditor. Strategy
bodies, Dolt configuration and research records are excluded from the image.
Build and publish a single-platform image, then retain its actual manifest
digest rather than its tag or Docker configuration ID:

```bash
docker build --platform linux/arm64 --provenance=false \
  --file backtest/r1/runtime/Dockerfile \
  --tag REGISTRY/trade-r1-runtime:BUILD-TAG .
docker push REGISTRY/trade-r1-runtime:BUILD-TAG
```

A runtime identity JSON contains exactly `image_ref` (registry path plus
`@sha256:` manifest digest), matching `image_digest`, `platform` (`linux/arm64`
or `linux/amd64`) and `runtime_contract: r1-native-v1`. Pull the digest reference
before custody execution. Custody verifies the locally available manifest and
platform, observes the image's actual runtime and resolved configuration, and
runs with no network, a read-only root, read-only source/input mounts and one
writable report mount. The same image performs the audit. A sandbox supplies
isolation; the retained image bytes supply a reproducible environment.

## Paired acceptance and history

```bash
uv run --frozen python -m backtest.r1.checks.compare_node \
  /path/to/frozen/native-control /tmp/r1-external-h19a-37
uv run --frozen python -m backtest.r1.checks.audit_tiered_native \
  --run /tmp/r1-external-h19a-37 --catalog-root /path/to/r1-minute-catalog \
  --output /tmp/r1-external-h19a-audit.json
```

Check orders, fills, positions, fees, funding adjustments, account rows, returns
and per-coin diagnostics, then inspect native order integrity and audit findings.
A successful process exit does not establish parity. The pinned rc3 Strategy
activates its native take-profit child before the stop child to avoid a
synchronous sibling rejection; recheck this behavior before changing Nautilus.

Receipts in `receipts/` retain their original bytes and source identities.
The `parity_receipts` paths in `receipts/evidence.json` are historical locators;
their [fixed Git archive](https://github.com/qOeOp/trade/tree/44e229331fdc7d9b78e234079673b8df71faefc4/strategies/r1) contains the original three receipts.
Their same-named current copies under `receipts/` are byte-identical.
`parity-node-migration.json` describes the historical 16-combination Node
transition, including two pre-existing order-integrity failures. The H18a/H19a
funding-loader receipts and `parity-single-file-h19a.json` describe their own
historical implementations and acceptance. Those receipts do not automatically
accept the new Dolt/OCI execution path. The earlier H23a–H27a paired reports are
[fixed historical evidence](https://github.com/qOeOp/trade/tree/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results).
Exposed-year implementation acceptance is not independent strategy qualification.

## Recovery boundaries

Seals capture exported source, exact bindings, resolved configuration, observed
runtime identity, native reports and logs. `artifacts restore` restores the
native reports; it does not provision the image or reconstruct the source Catalog.
Full replay recovery also needs native Dolt history, accessible image bytes and
canonical inputs. Retain images and database/artifact backups outside Git and
`/tmp`. The first local migration uses
`/Users/vx/.local/share/trade/strategy-migration/20261009`; a second directory on
this machine proves local copy recovery only. See the
[migration contract](../../docs/plans/dolt-strategy-oci-migration.zh.md).
