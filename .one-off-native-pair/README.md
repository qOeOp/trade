# Native packaging pairing harness v5

Prepared offline only; no v5 native replay or CI dispatch has occurred. This is a six-pair AMD64 engineering check of packaging behavior, **not complete ledger research metrics, profitability, real-venue behavior or deployment acceptance**. The parent explicitly chose a Protection input-unit repair after the second actual CI run. v1/v2/v3/v4 and both actual native evidence sets are retained unchanged.

Only these six execution files belong on the disposable CI branch: `generator.py`, `run_pair.py`, `verify_pair.py`, `test_offline.py`, `baseline.json`, `README.md`. They transform existing repository fixtures; they do not embed complete strategy bodies. Generated sources, seed/run outputs, receipts and verification artifacts stay in `/tmp` or `RUNNER_TEMP`, never Git.

## Exact v5 change and its limits

Second actual CI run 42387594427 completed all 12 CLI runs and native audits successfully. Three Probe pairs passed the full verifier. Three Protection pairs failed the required partial-fill/GTD scenario: both images filled the entire 16.339 at 07:33:59.999, then stopped the entire quantity at 08:48:59.999. Read-only comparison of all six pairs' actual reports and eight fingerprints matched, but the missed partial/GTD path remains a failure.

The cause was v4 Protection seed encoding: it multiplied OHLC and volume by `10**8`, while owning `market.series` defines `PRICE_SCALE=8` and `VOLUME_SCALE=4`. Actual Native fill-volume reports therefore showed entry volume 10000 instead of 1, and stop volume 10000000 instead of 1000. Pinned Native divides bar liquidity among OHLC ticks; entry low tick volume 2500 could fill the whole order. Test and CLI use the same venue and FillModel. The diagnosis is `/tmp/trade-hedge-goal-20261106/native-pairing-ci/second-diagnosis/REPORT.md`, SHA256 `8bdf56e4be0f7b8cb090bffdb33e18c1d588820bd70a5840c2dcf168806e8471`.

v5 changes only Protection input encoding to use those owning price and volume constants separately. Its source bytes, Probe source/input bytes, prices, timestamps, strategy rules, windows, tags, account terms and all verifier acceptance remain unchanged. Protection market input hashes change. No product FillModel, audit, refusal or tolerance is altered. The required actual partial-fill/GTD path is still pending a new independently reviewed native run.

Offline tests now inspect actual Native Catalog Bars after the product exporter. For BTC and ETH, all 96 timestamps, OHLC values and volumes are decoded with the public Native decimal APIs: entry volume is exactly 1; ordinary and stop volumes are exactly 1000. The frozen v4 wrong volume encoding is exported through the same path and rejected by the same semantic assertion for both symbols. These reads do not start an engine.

## Retained v4 observational repair

First actual CI run 42385320977 failed on Probe/BTC/reference with native exit 1 and 151 `Already mutably borrowed` exceptions from the newly added order diagnostic's `self.clock` getter. The native audit passed, but the independent runtime-failure gate correctly made the run invalid. All missing diagnostic events were Initialized; Submitted/Filled remained recorded. See the retained diagnosis at `/tmp/trade-hedge-goal-20261106/native-pairing-ci/first-diagnosis/REPORT.md` (SHA-256 `b0e26f70bef152a2a1595984376db94cd420f07170304270f1e44a070f023bae`).

Each generated source retains exactly two observation changes relative to v3:

1. The first `on_start` statement stores `self.observation_clock = self.clock`, after native Strategy registration.
2. The existing `on_order_event` diagnostic reads `self.observation_clock.timestamp_ns()` instead of fetching `self.clock` again.

This caches the public **GuardedClock wrapper**, not a numeric timestamp or an unwrapped native/private object. Existing trading and timer registration calls continue through their previous guarded interfaces. No event is skipped, exception suppressed, callback clock substituted, plan tag added, trading rule changed, or input/window changed by that source repair. The diagnostic format remains `pairing-clock-v2`.

Pinned rc7 source supports this proposal: `crates/trading/src/python/strategy.rs:1999–2019` holds a mutable Strategy borrow while submitting; native `strategy/mod.rs:2406` synchronously publishes Initialized before queueing risk execution. The clock getter at `python/strategy.rs:1718–1728` clones the registered Clock handle; `crates/common/src/python/clock.rs:49–64` stores that handle as `Rc<RefCell<dyn Clock>>` and reads its current timestamp directly. The sdist SHA is `4e4ec408fb4860d75685e6d071cdf27aed3c5a22ca303110872b764a8a3e768c`. The proposed cache removes the reentrant Strategy getter. The second actual CI confirmed all 12 executions have zero runtime failures and complete order-event multisets; all three Probe pairs passed their full verification. The list path also requires all child observations: `strategy/mod.rs:273–285` caches every child, `288–290` publishes Initialized for each child synchronously, and `298–323` only then assembles and sends the execution command. No child Initialized event is exempt from multiset equality.

Offline AST proof removes exactly the added startup assignment and changes exactly one order-diagnostic attribute back to `clock`, then reserializes. Both resulting SHA values exactly equal v3's generated files. This proves the remaining source AST is unchanged, including all trading statements. `offline-source-delta.json` records the proof.

| Source | v4 = v5 SHA-256 |
| --- | --- |
| Probe | `cf1cc1cca43b2e4ac1d582ca3d3b37155cc938b40a183a4decbc7d5961718d00` |
| Protection | `b2ae74744d9338acb30a65aed2e3b9fa0da47dd40ea978f997bbbb1e558b9fb3` |

## CI interface and isolation

Use a native Linux AMD64 ephemeral runner, checkout the actual candidate CI build revision, install the frozen dependencies and checksum-pinned Dolt 2.7.2 as in `quality.yml`, and set `RESEARCH_DOLT_BINARY` explicitly. The output directory must not already exist. Both images must already be repository CI builds; the harness does not build or substitute images.

```bash
uv run --frozen --project "$REPO" python "$HARNESS/run_pair.py" \
  --repo "$REPO" \
  --output "$RUNNER_TEMP/native-pairing" \
  --old-runtime ghcr.io/qoeop/trade-runtime@sha256:b8cb82c263db0ac0d117378d610f2c7551d5d46d9664c2d379767cd479f6bd8f \
  --new-runtime ghcr.io/qoeop/trade-runtime@sha256:5cf802c1e7f7f7eae0c81fa2ea7f78a53b2aedb2db848866abc4355c47052b93 \
  --old-revision eb695059c855be44ccb41c8de05ac033350b1580 \
  --new-revision e81fd3ad17f80eb584927f54c0c608d7247b9e39
```

These digest/revision identities were independently verified by the parent; this preparation does not authenticate the registry. `baseline.json` continues to pin unchanged engine/lock/existing fixture inputs read at e03. The actual host checkout must equal the candidate's full CI revision and be tracked-clean. Before creating workspaces or services, pure value/version checks verify pinned rc7 Standard/Composite BarType behavior.

All 12 runs use `python -m cli.main replay explore` with explicit temporary ledger and isolated market profiles. Ledger writes, trial-start export and own-service cleanup use only the product CLI. The child environment is allowlisted, with a new empty `work/docker-config`, fixed `DOCKER_HOST=unix:///var/run/docker.sock`, and explicit `TRADE_LEDGER_HOME`; it reads no default profile, Docker config, `.env` or trading keys. `TMPDIR` is the whole new output root so product temporary-path rules admit both work and evidence. Only the service created by this invocation is stopped; failure evidence is retained.

Upload **only `native-pairing/evidence/`**, with `if: always()`. Do not upload `work/`, private profiles/service metadata, databases, Docker config, sibling Catalog caches or process environments. Evidence includes complete temporary engineering sources, hashes, native reports, complete audits, fingerprints, CLI results, start receipts and comparison results.

When CLI replay returns an invalid result with a valid trial ID, v4 saves the result and attempted side identity, then still exports that trial's start receipt via CLI before failing. A successful receipt identity check is explicitly marked. If diagnostic export/read/identity checking fails, its error is retained separately and cannot replace the original native-invalid error. An otherwise passed run with failed receipt export still fails. Incomplete suites are never treated as paired success.

## Frozen scenarios and acceptance

The six pairs are Probe and Protection × BTC, ETH, BTC+ETH, on identical source/input/window/account on each side.

- Probe retains start Jan 1 00:00, trade start 00:05, end Jan 3 00:00 and `USES_STOP_LOSS=False`. rc7 emits standard internal BarTypes, which do not equal its stored composite `self.quarter`; its bracket branch is not exercised. It covers minute/internal clocks, native timers, timer-driven market fills, fees, funding and account economics. Native uncovered intervals remain visible; this source does not prove stop protection.
- Protection retains Jan 1 07:30–09:06 and requires the original 96-bar geometry: entry submission 07:31:59.999; 0.250 of 16.339 fills 07:33:59.999; requested and actual GTD expiry 08:43:59.999; resized reduce-only stop closes 0.250 at 08:48:59.999. Holding crosses 08:00 funding without a fill at that timestamp, target cancels and the final state is flat. The second actual CI ran the erroneous-volume version through a full-size stop; this corrected partial-fill/GTD input has not yet run natively.

Every existing acceptance requirement remains: distinct exact old/new identity bound through suite, receipt, runner binding/summary and actual stage argv; unique trial/directory facts; source/config/input hashes; baseline native code/lock; complete original native audits and empty findings; native successful exits, zero runtime failures and zero unexpected denied/rejected events; source declaration/integrity; exact causal event/init/consumption clocks; complete input and internal/timer coverage; unchanged native comparator/default tolerance and eight semantic fingerprints; nonzero fees/funding, independent funding account delta, realized/account reconciliation and final MARK equity; and Protection's full timing/topology/quantity checks.

v4 additionally requires **multiset equality** between observed order callbacks and native order history for each instrument using `(event type, client order ID, event time, init time)`, including Initialized. Missing or duplicated observations fail even if every surviving observation matches a native event. It directly rejects any nonempty native runtime-failure file. Both complete audit documents and refusal counts/reasons remain in verification output.

The independent full Probe clock expectations remain 2,880 external minutes, 191 internal bars from start+15m through end−15m, source mixed counter 3,066, 77 periodic events and 74 actual mixed-counter alerts. Exact timestamps are checked, including omitted head/tail/internal events even if dependent counters/alerts are rewritten. Native first-run artifacts confirmed these ranges; none was reduced to accommodate its failure. v3's pinned source proof remains retained in its README and `schema-source-evidence.json`.

## Explicit ledger report limitations

This round intentionally tests packaging/native behavior parity, not full ledger research metric eligibility. Verification and retained side metadata explicitly include each CLI report's `availability`, `limitations`, `plans` and `populations`, with `full_ledger_metrics_claimed=false`. Reporting those facts does not waive any native acceptance predicate above.

Known unchanged limitations:

- Probe's Jan 1 00:05 trade boundary causes current report code to discard the native Jan 1 midnight daily-return label. In the first invalid run the complete two-row native series compounded to final MARK equity within 7.5e-12 USDT, but filtering out Jan 1 produced `RETURN_COMPOUNDING_MISMATCH` / `RETURN_SERIES_UNUSABLE`. This is not evidence of a fee/funding/account mismatch. The shorter Protection window may likewise have unavailable trade-window daily-return metrics.
- Probe's original market orders have no plan tags, so `PLAN_TAG_MISSING` remains expected in the ledger metrics. Protection preserves its original `plan:AAA-1`; combined symbols can produce `PLAN_MULTI_INSTRUMENT` in plan reporting. Neither source's tags are changed in this causal repair.
- No complete ledger metric success, research eligibility or profitability is claimed. The native audit's existing one-minute stop grace and reported-funding basis are unchanged. Protection's dedicated checks still require no uncovered intervals and exact GTD/stop behavior. Probe's optional protection remains a limitation, not an audit override.

## Offline validation and review handoff

```bash
PAIRING_TEST_REPO="$REPO" "$REPO/.venv/bin/python" "$HARNESS/test_offline.py"
"$REPO/.venv/bin/python" "$HARNESS/generator.py" --repo "$REPO" --output /tmp/new-v5-sources
"$REPO/.venv/bin/python" "$HARNESS/verify_pair.py" --root /tmp/downloaded-evidence
```

Ten offline tests cover original source admission/constructor contract, deterministic bytes, exact observation-only AST delta, pure native value schema, isolated synthetic market seed/Catalog export, economics checks, native identity arguments, failure-receipt preservation, and six-pair fabricated positive evidence plus **36** negative mutations. The original 33 negatives remain; new cases reject missing Initialized, duplicate order callbacks and runtime failure records despite otherwise successful synthetic stage metadata. Receipt tests use a fake CLI callback, including invalid+export-success and invalid+export-failure. The new Catalog semantic regression separately rejects the old volume encoding for BTC and ETH; no service or native engine is started. Tests also demonstrate that explicit unavailable ledger metrics stay visible in a packaging acceptance report.

Synthetic positives are validator test data, not actual receipts or a replacement simulator for the fixture. `handoff-manifest.json` hashes the six execution files and retained preparation records. v5 needs independent incremental review before execution; the first native run remains invalid and the second suite remains failed for its three missed Protection scenarios. Any new native failure must be retained and diagnosed without changing product audits, refusals, comparison tolerances, source stop declarations or account terms.
