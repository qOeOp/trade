# Market Data Intake Playbook

This playbook turns a credential or public endpoint into a bounded, testable Market Data integration. It is an
operator and development guide, not a second Data Engine, source registry, scheduler, or business authority.
Market Data remains the sole owner of normalized observations, instrument meaning, point-in-time availability,
correction lineage, and data-rights disposition.

## Boundary with research sources

The [Source Intake Playbook](./source-intake/) admits papers, documentation, commentary, and datasets as inert
R&D source material. This playbook admits observations that a research replay, protected evaluation, Scanner,
Runtime, or Portfolio consumer will actually use.

- API documentation and a series description are Research Source Intake material.
- A dated price, macro vintage, filing fact, calendar event, or instrument state is a Market Data fact.
- A credential proves only that a principal may attempt authentication. It does not prove connector support,
  license or retention rights, point-in-time correctness, coverage, or suitability for backtesting.

## TARGET - External historical file imports

Users or external agents may submit external historical files for Market Data validation and custody, then consume
validated references through Backtest. An R&D attachment is inert research material; upload success, readable bytes
or a strategy opening CSV never admits market facts. This is a product target, not an existing import API.
Reuse this repository's Nautilus conversion, canonical types and catalog storage before adding product extensions.

Register immutable byte digest, provenance and rights, dataset type, instrument mapping, columns/units and time
semantics. Validate actual strategy dependencies, including prices, quantities, funding, lifecycle, coverage and gaps.
Missing fields retain unknown/not-applicable dispositions; never fabricate zero funding, placeholder volume or
historical availability. Provider feeds and files use the same Source Binding, semantics, PIT, revision and admission.

Only admitted imports materialize canonical observations and custody references. Backtest neither reads caller file
paths nor bypasses data permissions. Repeating the same identity/meaning joins its receipt; corrected content creates
a successor version with provenance/revision lineage, never overwriting prior run inputs. Import admission is not
qualification: protected partitions, independence and required economic fields retain their respective contracts.

Acceptance covers valid files reaching the same native backtest path, precise column/unit/time refusal, no invented
missing values, upload retry recovery, revisions preserving old replay, and no R&D/Backtest bypass for unadmitted files.

## Admission sequence

Use one fail-closed sequence for every provider:

`Credential/config → Source Binding → rights decision → semantics profile → read-only probe → PIT fixture → canonical snapshot → consumer receipt`

1. Resolve the provider and dataset to one immutable Market Data Source Binding. Bind implementation and
   configuration digests, endpoint, vendor tenant or data entitlement, opaque credential handle and audience,
   trust policy, license and redistribution scope, and Time Evidence. A vendor tenant is not an Execution account.
2. Decide acquisition, local cache, archive, derived-data, backtest, model-use, display, and redistribution rights
   before retaining bytes. Unknown rights produce Market Data `RIGHTS_EVIDENCE_UNRESOLVED` and Source Binding
   `UNAVAILABLE`, not best-effort ingestion. `TERMS_OR_LICENSE_BLOCKED` remains an R&D Source Intake terminal and
   is never copied across the Owner boundary.
3. Freeze one Market Semantics Compatibility identity covering normalization, adjustment, timestamp meaning,
   instrument mapping, calendar and session rules, correction behavior, and historical/live equivalence.
4. Run the smallest read-only metadata or entitlement probe. Do not call private trading, account, order, or
   effect methods from a Market Data credential capability, even when one provider SDK exposes both surfaces.
5. Verify a bounded fixture containing known timestamps, missingness, corrections, instrument lifecycle, and
   license metadata. Reachability alone never admits a source.
6. Materialize a request-correlated PIT Market Snapshot or live fact only after all prior gates pass. Submission,
   transport acknowledgement, silence, or an earlier snapshot is not an observation.
7. Record health separately from facts. Authentication, quota, staleness, and outage state may explain
   unavailability but may not manufacture an empty or zero-valued dataset.

## Required source profile

Every admitted provider or dataset profile records at least:

| Area        | Required binding                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Identity    | provider, endpoint, dataset or feed, configuration digest, vendor tenant or entitlement, connector version                     |
| Capability  | public market/reference methods only; explicit rejection of account, order, trading, and private‑effect methods                |
| Rights      | acquisition, cache, archive, derived output, backtest, model use, display, redistribution, retention and deletion basis        |
| Time        | event, provider‑available, retrieval, and correction‑publication time plus clock epoch, decision cut and uncertainty           |
| Meaning     | raw/adjusted basis, price and size units, timestamp interpretation, bar construction, corporate actions and revision policy    |
| Instruments | canonical identity, venue mapping, currency, tick and contract terms, sessions, time zone, lifecycle and historical membership |
| Quality     | coverage, gaps, duplicates, ordering, sequence/checksum where applicable, latency, stale threshold and terminal disposition    |
| Lineage     | raw digest, normalized digest, source frontier, transformation version, correction predecessor and successor identity          |

Profiles are dataset-specific. One provider may have different rights, clocks, coverage, and terminals for different
series or feeds; do not collapse them into a provider-wide promise.

## Credentials and capability isolation

Read the [credential configuration](./install/) before configuring a client.
Secrets remain in the ignored local environment and enter bindings only as opaque handles. They never appear in
logs, prompts, snapshots, artifacts, screenshots, documentation, or audit packets.

Market Data and Execution credential audiences never alias. A combined exchange SDK must expose separate typed
ports: the Market Data port is read-only and cannot invoke balances, orders, fills, account mutation, or private
trading streams; the Execution port cannot become a source of historical market truth. Rotation or audience change
creates a successor binding rather than mutating prior receipts.

## Point-in-time and correction proof

A historical value is admissible only when the consumer can prove it was observable at the requested decision cut.
Event time alone is insufficient. The snapshot must bind all four time coordinates, the shared clock and uncertainty,
calendar and session versions, Instrument Master and Universe Selection Record versions, source and license frontier,
and correction lineage.

Later revisions create successor facts. They never rewrite an earlier Research Intent, replay, Qualification result,
or deployed generation. A later correction may enter R&D only through the explicit successor-feedback path and can
seed a new bounded lineage; it cannot retroactively repair the old decision.

## Initial provider disposition

These are bounded candidates, not an implementation commitment:

| Candidate                                     | Initial disposition                                 | Required proof before admission                                                                                           |
| --------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Existing native data adapters and Data Engine | prefer and adapt through Market Data                | typed read‑only port, semantics parity, PIT and correction fixture, source‑specific rights                                |
| Databento                                     | optional current adapter                            | entitlement, dataset‑specific license/retention, timestamp and symbology mapping, PIT fixture                             |
| Binance public data                           | optional current adapter                            | public‑data‑only capability, venue clock and symbol lifecycle, sequence/gap handling, archive rights                      |
| FRED/ALFRED                                   | `LEGAL_REVIEW_REQUIRED` for archive or backtest use | series‑specific rights, vintage availability, retention/software‑use decision, no substitution of current values          |
| Kaggle dataset                                | candidate only                                      | immutable dataset version, upstream provenance, license compatibility, survivorship and PIT proof                         |
| OpenBB                                        | selective external candidate                        | provider fetcher only behind Data Clients; no second router, Data Engine, registry, or business cache                     |
| CCXT or CCXT Pro                              | default do not adopt for covered venues             | only a proven missing public‑data endpoint; seal private APIs, scheduler, cache and reconnect behavior inside the adapter |
| Cryptofeed                                    | default do not adopt for covered feeds              | only a superior missing public feed; exclude its storage, message backends and authenticated trading capabilities         |

An authentication-only metadata probe establishes neither a current product connector nor permission
to archive, train on, or backtest every FRED series. Until the rights and
vintage gates above pass, the Market Data Source Binding remains `UNAVAILABLE` with
`RIGHTS_EVIDENCE_UNRESOLVED`; definitive denial is required for `UNLICENSED`.

## Deterministic admission disposition

One source evaluation retains every independently supported rights, identity/configuration, semantics,
availability, and evidence-freshness failure. A frozen precedence chooses one primary category and state, so
arrival order cannot change the result. `ADMITTED` is possible only with an empty failure set and complete current
evidence. A changed rights decision, endpoint, configuration, semantics profile, or evidence frontier creates a
successor Source Binding rather than rewriting the predecessor.

Snapshot disposition is a separate deterministic mapping. `REVOKED` or `UNLICENSED` source bindings yield
snapshot `UNLICENSED`; `INCOMPATIBLE` yields `AMBIGUOUS`; source `UNAVAILABLE` yields snapshot `UNAVAILABLE`.
When snapshot-local blockers coexist, retain the complete blocker set and choose the primary in this order:
`UNLICENSED`, `AMBIGUOUS`, `STALE`, `INSUFFICIENT`, `UNAVAILABLE`. A source `ADMITTED` state merely permits
snapshot evaluation and never guarantees `AVAILABLE`.

## Request and terminal behavior

Authorized Agents and admitted consumers choose what they request; Market Data owns the returned data meaning. Backtest consumes the frozen
snapshot and records actual use but never selects a provider. Portfolio consumes valuation facts, while Execution
alone owns private account, order, fill, and readback facts.

An ordinary snapshot terminates as `AVAILABLE`, `INSUFFICIENT`, `STALE`, `UNLICENSED`, `AMBIGUOUS`, or
`UNAVAILABLE`. The compatibility repair request additionally binds the exact predecessor decision, request proof and stable
correlation. Wrong scope, changed cut, stale license, missing Time Evidence, silence, rate limit, or transport success
cannot become `AVAILABLE`. Exact replay joins the same terminal; changed meaning requires a successor request.

## Development acceptance

- A connector can be disabled or removed without changing Data Engine, PIT Catalog, Instrument Master, or Owner authority.
- Every credential capability is least-privilege, audience-bound, opaque, and non-aliasing with Execution.
- Rights tests cover cache, archive, backtest, derived output, display, redistribution, retention drift, and deletion.
- PIT tests reject current-value substitution, event-time-only evidence, future corrections, mixed clocks, and missing historical membership.
- Semantics fixtures prove historical and live normalization, adjustment, instrument mapping, and timestamp meaning match exactly.
- Quality tests distinguish empty, missing, stale, rate-limited, malformed, unlicensed, and unavailable outcomes.
- Request tests prove admitted consumer responses repeat the exact requester-owned request and stable correlation.
- Correction tests preserve prior receipts and create only a successor fact and successor-only R&D provenance.
- No Market Data path can call an account, order, private-effect, Governance, Qualification, or trading-authority port.
