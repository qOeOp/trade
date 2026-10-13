# Research architecture

External Agents conduct continuous research within a route the user selects. Every complete
single-file strategy revision is a candidate with exact source identity, development parent,
actual rule change and replay evidence. Neither statistical significance nor target attainment
creates a candidate or grants derivation rights. The user chooses a new route, recognition,
independent validation and deployment; Agent recommendations and experiment priorities remain
separate append-only reasoning.

## Boundaries

| Owner | Responsibility |
|---|---|
| Agent / skills | Hypothesis, one actual rule change, mechanism diagnosis, conditional priority, recommendation over all comparable candidates, attempt/progress review cadence |
| Records contracts | Immutable identities, preregistration before replay, atomic one-attempt grid binding, comparability, integrity, retained facts and counts |
| Published Nautilus | Matching, orders, fills, fees, funding, risk, portfolio and account |
| User | Selected research route, three targets, route changes, recognition/validation/deployment |

Product code owns facts and trust/concurrency/permission boundaries. It has no optimizer, parallel
engine, ledger, scheduler or binary development-adoption mechanism. Economic failure updates
research priorities; low-priority actions remain reassessable. Research continues by default;
optional user run limits pause execution and retain recovery state. Ten attempts is a fixture
length, not a product stopping rule.

## Production entry

`research.records.cli` publishes complete strategy bytes in `strategy_revision`, including parent
and difference. `hypothesis register` validates and stores an immutable evidence contract with
rationale/prediction, retained sources, one dimension, fixed grid and applicability conditions.
Its comparison control is independent of its development parent. `artifacts run --hypothesis`
checks the locked source, runtime, market/export identity and full execution configuration, then
atomically inserts a trial and `research_execution` relation before invoking the native replay.
Every registered grid point is consumed once, including invalid or interrupted attempts.

Sealed runs retain native reports and audited account readings in Dolt. Invalid attempts have
reasons and no economic feedback. `candidate list` reads lineage and custody. `hypothesis compare`
refuses incomparable/invalid runs and computes paired daily-log evidence in circular weekly
blocks, a separate CAGR-difference interval, nested studentization and block sensitivity. Its p
value is a null-model tail reading, not probability of strategy validity. Grid Bonferroni does not
control the entire adaptive search; development improvement is not independent validation.
Non-return inference is not defined by the present design. Agent diagnostic, priority and
recommendation reasons are added through existing evidence bundles; they are not product scores.

## Data and runtime

Research and market profiles are selected separately. WS8b market tables supply real 1m LAST/MARK
and funding at a fixed Dolt commit through read-only access. `r1-native-v6` loads 1m execution bars,
passes `execution_bar_minutes=1` to source and values capital at 1m MARK timestamps. A source's
signal period can differ. Monthly pool membership is an input for the source to apply; historical
terms, missing buckets and bar-order ambiguity remain reported limitations. New runner/auditor
bytes require a new CI-built image digest. A 1m change is not parity with old 5m economics.

Source, input, runtime and exporter implementation identities are retained. Export content hashing
includes Catalog bytes, pool content and semantic receipts excluding elapsed seconds; raw before/
after hashing detects mutation during execution. Runtime Docker uses a read-only root, no network,
read-only inputs and only a writable reports mount. Python/Nautilus versions remain pinned by
`uv.lock`; native trading facts are never reconstructed by a host research script.

## Custody and validation

Persistent research facts live only in Dolt and its backup. Working copies live in `/tmp`; Git
holds product code, skills and engineering findings, no strategy bodies or research receipts.
Schema-v2 is initialized in new isolated research ledgers. Existing schema-v1 ledgers and old
records are not migrated; their legacy read interfaces remain available. The writer can insert,
update only `ledger_head`, and execute only `dolt_commit`; branch grants and one transaction prevent
accidental concurrent merges. `ledger audit` checks append-only history, readings, registration
bindings, legacy verdicts and witnesses. Same-system-user access cannot prevent deliberate
root tampering, but changes leave traces.

Legacy freeze/confirmation interfaces retain their target gates, freshness, main-image and future-
data timestamp protections. They are separate target snapshots and independent-validation paths,
not qualifications for continuous candidate development. This unmerged test branch cannot use its
image as a main-image confirmation. Validation remains user-initiated, preregistered, single-use;
never relabel development or exposed historical data as independent.

See the [ledger guide](../research/records/README.md), [research-round skill](../.agents/skills/research-round/SKILL.md),
[native contract](../backtest/README.md) and [implementation mapping](plans/rd-proposals-implementation.zh.md).
