# Market Data

## Responsibility

Provide canonical, time-correct market, reference, and instrument facts to every analytical and trading consumer. Market Data owns data meaning and observability, not the strategy-specific selection of what a run should consume.

### How to read this page

The Owner contract is the standard Owner skeleton: Responsibility, Authoritative facts owned, Modules, Input
handoffs, Output handoffs, Rejections and prohibitions, Failure and recovery, Decision contract, and Subsequent
implementation acceptance. Read those to learn what Market Data owns, what crosses its boundary, and what it
refuses. They are the part another Owner, or an agent planning work, has to reason from.

Between Modules and Input handoffs sit the native sub-authority contracts: Calendar and Time Zone, Market
Semantics, Correction Policy, Corporate Action, Replay Market Facts V2, Instrument Master, and Strategy input-role
binding. Each carries its own status marker and states one sub-authority.

Inside those, every subsection whose heading names a canonical codec, canonical identity, or canonical census
fixes byte layouts, field order, integer widths, and digest domains. They are normative, because a differing
encoding is a different fact, but they answer only how a value is spelled, never who may write it or what it
means. Skip them unless you are implementing or verifying an encoding.

## Implementation admission ledger

This ledger is the greppable index of what the contract below has actually reached. It grants no permission by
itself: what is `IMPLEMENTATION_ADMITTED` is whatever the Status column below says is, and nothing more, so this
sentence names no slice and does not go stale when one moves. Widening that set requires changing this document
first under the Architecture authority rule in `AGENTS.md`. A merged crate, a named type, a
green job, or a row here is not implementation authority, never proves a production consumer, and never authorizes
a production effect, a deployment cutover, or real trading.

Every `CURRENT / PARTIAL` row below except Data Clients rests on one piece of dynamic evidence and no other: the
isolated disposable-PostgreSQL Owner chain that `make cargo-test-market-data-owner-postgres-isolated` runs through
`crates/data/tests/run_market_data_owner_postgres.bash`, which executes the single `#[ignore]` scenario
`owner::postgres::tests::postgres_owner_is_atomic_restart_safe_acl_sealed_and_fail_closed` and reaches CI only as
the `market-data` matrix entry of `.github/workflows/build.yml`. That chain proves atomicity, restart, byte
idempotency, correction topology, and per-role ACL denial. It proves no provider authenticity, no production
composition, and no consumer behavior. The Data Clients row instead rests on the explicitly invoked `#[ignore]`
live probe in `crates/adapters/databento/src/historical.rs`, which requires a local `DATABENTO_API_KEY` and
never runs in CI.

### Ledger status vocabulary

- **`CURRENT`** means the capability is merged on current main, owns a production composition root, and a real
  consumer reaches it inside a deployed binary. No row below holds it.
- **`CURRENT / PARTIAL`** means the Owner-local authority and its durable custody are merged and dynamically
  accepted, while production composition, a reachable consumer, or both remain absent.
- **`TARGET`** means this document expects the capability and the repository does not yet own it. The expectation
  stays revisable until its real consumer flow is terminal.
- **`IMPLEMENTATION_ADMITTED`** means the user has admitted one exact slice of this document as bounded,
  separately reviewable repository work. It is permission to build and verify only, never evidence of merge,
  deployment, Owner acceptance, or effect authority.
- **`NOT_ADMITTED`** means that neither this document, a green job, a retained module, nor a named type authorizes
  the capability or any related business transition.

### Production blockers

- **`B1` no production composition root for the mint.** `commit_pit_initial_from_owner_custody_v1` in
  `crates/data/src/owner/postgres.rs` resolves its own canonical basis from Owner custody and carries no test
  dependency, and the isolated PostgreSQL chain accepts its `AVAILABLE`, `AMBIGUOUS` and `INSUFFICIENT` outcomes.
  What remains is reach: it is crate-private, no deployed binary constructs it, and no request intake exists, so
  the acceptance mint in `crates/data/src/owner/postgres/bar_joined_cut_acceptance_v1.rs` is still the only caller
  outside the chain. Cleared by an Owner composition root and the request intake named in `B3` and `B4`.
  **163 entries on this path are compiled but unreachable in a default build, and every one of them
  is reached only from the sealed acceptance module.** Measured at `877781213` with
  `RUSTFLAGS="--force-warn dead_code"` and `--message-format=json`, keying every `dead_code` primary
  span by file and line. A default `cargo check --workspace` reports all 163 dead; adding
  `--features vibe-data/sealed-strategy-input-acceptance` brings all 163 back to life; and
  `cargo clippy -p vibe-data --all-targets` without that feature wakes none of them, so not one
  entry has a `cfg(test)` caller. They sit in eleven files, and the `validate_*`, `insert_*` and
  `lock_*` entries in `postgres.rs` are consecutive steps of one write path rather than scattered
  leftovers. **Two earlier readings of this figure were wrong, both in the reassuring direction.**
  It read 92 because `--message-format=short` folds one implementation's dead members into a single
  `multiple associated items are never used` line and drops their names, and because that line's
  anchor moves between builds, which admitted five entries that are dead on both sides. It read
  "six behind a non-default feature" because the two builds compared differed in two variables at
  once: `crates/qualification` and `crates/backtest_owner` take
  `sealed-strategy-input-acceptance` in `[dev-dependencies]`, so `--all-targets` turns it on while
  plain `cargo check` leaves it off. **When the figure stops matching, rerun those builds rather
  than trusting it** - it moves the moment a caller lands, which is what clearing `B1` means.
- **`B2` no production writer for the declaration store.** `register_strategy_input_binding_declaration_v1` has the
  same single non-test caller as `B1`, so `resolve_pit_request_for_strategy_design_v1` returns `UnknownDeclaration`
  for every production Design and the Composer seam in
  `crates/strategy_factory/src/source_research_composer_postgres_v2.rs` always fails closed. Cleared with `B1`,
  once that writer is reachable from the R&D transaction.
- **`B3` Deployment Store Admission disabled.** `DEPLOYMENT_STORE_ADMISSION_MODE` is `disabled` in
  `product/rd-workbench/.env.example` and `product/rd-workbench/docker-compose.yml`, so every sealed read port
  resolves to `None`, and `crates/strategy_factory_rd_owner_api/src/server.rs` retains the resolver in the unread
  field `_market_data_research_pit`. The production ports `docs/guide/architecture-rules.md` names now exist and
  compose the `required` seam. Cleared when a deployment turns `required` on by the procedure in
  `product/rd-workbench/README.md`, plus one consumer that reads the port.
  The acceptance chain covers the segment after Store Admission, and not Admission itself. In a build that enables
  `sealed-strategy-input-acceptance`, which no deployed binary does,
  `native_replay_scheduling_resolver_for_sealed_acceptance_v1` runs the native Replay scheduling read path with the
  admitted resolver's raw reads, verification and selection, but with no admission before a read and no revalidation
  after one. It connects as a least-privilege test principal that the disposable database grants exactly
  `NATIVE_REPLAY_SCHEDULING_ACCEPTANCE_GRANTS_V1`, and its evidence carries the marker
  `SEALED_ACCEPTANCE_NO_STORE_ADMISSION_V1` where an admitted read carries a receipt; only a build that carries that
  port accepts the marker. Admission itself is still `B3`: nothing leases its principal yet. That principal is
  `market_data_admitted_reader`. `database/postgres-init/25-market-data-admitted-reader.sh` provisions it as
  a login role that inherits nothing, has no role membership in either direction, and holds `CONNECT` on the database;
  the compose file does not run that script yet. The deployed ACL cutover revokes every privilege on
  `market_data_private` and `market_data_admitted_read` from every role it names, and the admitted reader is not among
  them. The cutover runs after the Owner has materialized, so the Owner migration's grant to the reader survives it only
  because the reader is absent from those lists; `product/rd-workbench/scripts/check/authority.bash` refuses a cutover
  that names it. Every admitted read, and the
  measurement's read of the Owner's migration ledger, reaches the Owner only through `market_data_admitted_read`. Each
  function there is a `SECURITY DEFINER` pass-through of the private function of its name, with the same parameters and
  result, or one of four fixed reads of Owner rows; each is `STABLE` and pins `search_path`. The Owner migration grants
  them to one role only: when `market_data_admitted_reader` exists, it gains `USAGE` on the schema and `EXECUTE` on
  every function in it, and nothing on `market_data_private`, whose time-zone custody check requires that it have no
  grantee but its owner. The measurement still names private functions and relations, and finds each by its schema and
  stored name in the catalog rows every role can read, never through `to_regclass` or `to_regprocedure`, which refuse a
  qualified name in a schema the role cannot use. A reader provisioned after the migration last ran gains that grant the
  next time the Owner migrates. Every wrapper is on the floor of an admitted read, except the ledger read the measurement itself makes, so
  the grant is exactly what the admitted reads and the measurement call. A unit test holds the wrapper list to the
  floors and the measurement's one other call, and a Market Data PostgreSQL proof holds the provisioned reader's
  privilege census to that grant: it measures and admits every floor as that reader, calls every wrapper, and is
  refused `market_data_private`. Each port opens
  only on a measurement that covers the floors of the reads it serves, the native Replay scheduling port's PIT
  evaluation reads included, and each read checks its own floor again on every admission it reads under.
  Reading a BAR schedule has **two custody strategies**, one per build, and this document has until now described
  neither. A test build opens its own `REPEATABLE READ READ ONLY` transaction and validates the schedule's history
  itself; a production build takes its snapshot from the admitted port's evidence and revalidates before returning.
  Both run the same `verify_bar_schedule_storage_evidence`. The difference is where the consistency guarantee comes
  from, not how strong it is: the test path carries a history check the production path does not, and the production
  path carries an admission the test path cannot obtain.
  The consequence worth stating plainly is that **the production strategy has no coverage of any kind**. The unit
  tests exercise the test-build body, and no integration test under `crates/data/tests` touches a BAR schedule at
  all. So `B3` does not only gate a deployment - the first code behind that gate has never executed. What stops a
  test from reaching it is visibility rather than permission: `Custodian::new` is private to the store-admission
  module and `AdmittedCapability` leaves it by one exit, so no consumer outside that module can construct the port
  a production read requires.
  One further fact about that gate, which a reader of the code gets backwards by default:
  **the production form of `MarketDataReadPostgres` is constructed only in `required` mode.** Its only production
  constructor is `from_admitted`, gated `cfg(not(test))`, and its seven callers all sit behind
  `RdOwnerStoreAdmissionBootstrap::Required`; with no environment configuration that branch is `Disabled` and
  returns `Ok(None)`. The composition root behind `Required` builds its custodian from the five production ports the
  deployment's configuration names (`store_admission/composition.rs`), and refuses under the first one it cannot
  build. The Market Data proof `the_production_seam_admits_what_the_administrator_measured_sealed_and_published`
  drives that root end to end on a disposable PostgreSQL - measured, authored, sealed, published, admitted, and read
  through the scheduling port - so **a seam that declares its own incompleteness** no longer describes it. The BAR
  schedule census it reads there is empty; the production strategy over real schedule rows has still never run.
  The two resolvers Native Replay execution needs open the same way: the integration test
  `the_native_replay_resolvers_open_and_read_in_required_mode` opens
  `native_replay_scheduling_resolver_v1_from_store_admission_lookup` and
  `shared_time_evidence_resolver_from_store_admission_lookup_v1` over a file configuration in `required` mode, as
  `rd-owner-api` opens their environment variants, and reads the store through the same admission.
  Whether a real deployment sets `Required` is a question about deployment configuration that the code cannot
  answer.
  **Clearing `B3` proves which store `rd-owner-api` reached; it does not keep credentials out of that process.**
  The same process starts with two raw DSNs: `MARKET_DATA_OWNER_DATABASE_URL`, the Owner's write principal
  `market_data_owner`, which `product/rd-workbench/docker-compose.yml` requires, and
  `MARKET_DATA_RD_ROLE_SET_DATABASE_URL`, the reader `market_data_reader`. Six Market Data admissions in its default
  build connect with them directly instead of through the store-admission custodian - PIT intake, Source Binding,
  universe selection, strategy-input binding (both DSNs), Instrument Master and Market Semantics, composed by the
  `bootstrap_market_data_*` functions in `main.rs`. Their only gate is the role and topology check
  `MarketDataOwnerPostgres::ADMISSION_SQL_V1`. A build with `composer-replay-issuance` holds a third:
  `INSTRUMENT_OWNER_DATABASE_URL`, the principal `instrument_owner`, from which
  `instrument_economic_terms_postgres_owner_from_environment_v1` opens the economic-terms Owner directly as well. The
  compose file requires it of every image, because a build with that feature cannot start without it. Until those DSNs move
  behind the custodian as leased handles, `B3` adds anti-substitution - a signed, current, directly measured store - and
  no credential isolation.
  Two statements of `ISOLATED_EVENT_REPLAY_ACCEPTANCE_V1` below do not yet match the code; neither blocks the
  production route. That profile has the target measured by a separately executed principal, while `DirectMeasurer`
  measures inside the custodian with the leased credential. It also has the admission receipt cross-bind the trust
  bundle, while `SealedDeploymentStoreAdmissionReceipt` carries the witness identity but no signer key fingerprint
  or bundle identity.
  Five production adapters exist, and `store_admission/composition.rs` composes them from the files the deployment's
  configuration names: the pinned Ed25519 signature verifier (`store_admission/signature.rs`), the PostgreSQL custody
  store (`store_admission/custody_postgres.rs`, its schema and its two principals in
  `database/postgres-init/20-deployment-store-custody.sh`, which the compose file's
  `deployment-store-provision` service runs), and the secret-file credential resolver
  (`store_admission/credential_files.rs`). A secret file has no version or expiry of its own: its version is the
  SHA-256 of its exact bytes, which the signed manifest names, and its lease lapses at the end of the fixed-length lease
  period the admission's store-clock cut falls in, so every admission and revalidation within one period seals or
  rejoins one receipt. An admitted port compares each re-admission with the receipt it opened on by the store and its
  custody, not by that window, so it outlives the period it opened in; only the admissions before and after one read
  must be the same receipt, and a read that straddles a period boundary is refused. The fourth is the single-machine
  anti-rollback mode `SingleTrustDomainNoRollbackWitness` (`store_admission/witness.rs`): on one machine the
  anti-rollback property does not hold, the mode says so in every receipt, and the architecture rules carry the
  user's 2026-09-27 authorization. The fifth is the direct measurer for a deployment's store,
  `PinnedTlsPostgresDirectMeasurer` (`store_admission/postgres.rs`, with its TLS leg in
  `crates/postgres_connect/src/pinned_tls.rs`). sqlx cannot report which certificate a session's server presented, and its verified
  modes trust the public web PKI beside any root they are given, so the measurer connects on its own: it sends
  PostgreSQL's `SSLRequest`, completes TLS 1.3 trusting only the root one PEM file pins, and carries sqlx's session to
  the server through a private Unix socket. Its TLS identity names the certificate that server presented and the pinned
  root, and the server's `pg_stat_ssl` must agree on TLS, protocol and cipher. Every admitted read reaches the store
  the same way: the admission records the measurer's transport, bound to the certificate it measured, and each read
  opens its session over it and is refused unless its server presents that certificate. The socket between the two legs
  exists only between the handshake and the one session it accepts, in a directory only this process's user can
  enter; the relay carries nothing for any process but this one, and a server under another root or with another
  certificate is refused before the socket exists, so no byte of a session reaches it. The
  deployment's PostgreSQL serves TLS once the compose file's `postgres-tls-install` service has run.
  The administrator measures the store and completes a draft with `deployment-store-publication-author`, from where
  the deployment reaches the store, then seals and publishes the history with `deployment-store-publication-seal` and
  `deployment-store-publication-publish`; `product/rd-workbench/README.md` gives the procedure. A receipt's slot
  carries its lapse: under the single-machine mode, whose observation never changes, a slot named only by head and
  observation made every admission after the first a conflict. The admission reads time from the custody store's clock alone: every history read carries
  the store's `clock_timestamp()` cut, and the commit judges the receipt's window on that clock.
  The direct measurer's role identity covers what the leased role can do, not only the listed surface's ACLs,
  which cannot show a grant on anything else. It carries a privilege census (`PRIVILEGE_CENSUS_V1`): every
  privilege the session role or any role in its membership closure holds, from a direct grant, `PUBLIC` or
  ownership. It asks about the current database only, and about every schema except `pg_catalog`, objects only in
  a schema the role can use, and not about a relation's row type or an implicit array type, which grant nothing.
  In `pg_catalog` it lists each privilege of the role, its closure or `PUBLIC` that differs from what initdb
  recorded. So a grant the role gains or loses anywhere it can reach changes the identity admission compares; a
  grant to another role, a privilege on another database, or an object in a schema the role cannot use does not.
  A schema the role can use that others create in is within its reach: in the deployed database `PUBLIC` may use
  `public` and `product_edge_owner` may create there, so a new function in `public`, which `PUBLIC` may execute by
  default, changes the census and admission needs a new manifest. The census names PostgreSQL 16's privileges,
  and a server of another major is refused rather than measured short.
- **`B4` consumer partly compiled into the deployed image.** `product/rd-workbench/Dockerfile.owner` builds
  `strategy-factory-rd-owner-api` with `composer-v3-replay`, which includes `composer-replay-issuance`, so the
  native Replay scheduling consumer is in the image; with no admitted store (`B3`) it has no resolver, and issuance
  answers `MARKET_DATA_SCHEDULING_NOT_ADMITTED`. The repair loop's shared time-evidence consumer is behind
  `native-replay-execution`, which the image does not build. Cleared by the deployed image enabling that production
  feature, a deployment decision that follows `B3`.
- **`B5` no cross-Owner consumer.** The module's only consumers are the same crate's Replay V2 composition and
  PostgreSQL writers, and most such modules are additionally `pub(crate)` inside `crates/data`. Cleared by one
  fixed consumer named by this document.
- **`B6` no deployment has admitted a provider yet.** The whole chain is verified end to end: on 2026-09-17 an
  isolated PostgreSQL run admitted a Databento Source Binding, admitted its membership, evaluated a selection rule,
  read the Owner's decision cut, submitted one frozen request and committed an `AVAILABLE` snapshot from a real
  `AAPL` quote, and a keyless Binance Spot client answers the same seam for free. What remains is operational
  rather than structural: no running deployment has posted a binding to `/v1/market-data/source-bindings`, and the
  intake stays absent until one names a Data Client through `MARKET_DATA_OBSERVATION_SOURCE`.
- **`B7` the three Owner facts a declaration resolves now have production writers.** Registration through
  `POST /v1/market-data/strategy-input-bindings/from-design-intent` re-resolves, from this Owner's custody, one
  Market Semantics fact in scope at the batch's instants and an Instrument Master V1 readback whose digest equals the
  batch's `instrument_master_digest`, and the Market Semantics fact cross-binds one R0 record. Each of those three
  is written by the production path described in its own section below, none of them by an acceptance feature or a
  test fixture, and the PIT request's `instrument_master_digest` is now the Owner's own resolution rather than a
  caller's claim. What remains is not a writer but a run: no deployment has used them, which is the operational
  gap `B6` already names.
- **`B8` no live fact reaches Runtime.** The headline is unchanged because it is still true, and what changed is
  the clearing condition this entry used to name. It said the first live channel would clear it. The first live
  channel now exists: it streams for one bounded scope, with its durable head and its Owner-issued subscription
  proven by the ordered chain, and every other retrieval seam here is still as-of. That did not clear this entry,
  because producing a fact and delivering it to a consumer are different things, and the slice admitting the
  channel excluded the consumer half in its own words: no Runtime custody. Nothing in Runtime consumes the intake,
  so a Strategy Instance still has no live input and neither Paper nor Live can begin. What clears this entry is a
  Runtime-side consumer and a read surface on this side for it to consume. The second is now
  admitted and not built, and the first is neither: no outward function serves a live fact. The
  twelve this Owner does expose no longer name `session_user` inside their own bodies, so a grant
  to another caller now refuses instead of returning empty results, which is what makes a
  per-consumer read surface expressible at all. Its admitted shape is under the Runtime handoff.

### Per-slice ledger

| Slice                                                     | Status                                                                                              | Implementation                                                                                                                                                                                                                           | Blocker    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| PIT Market Snapshot authority and custody                 | `CURRENT / PARTIAL`                                                                                 | `crates/data/src/owner/pit_snapshot.rs`, `pit_snapshot/authority.rs`, `owner/postgres.rs` `pit_*` relations                                                                                                                              | `B1`       |
| Source Binding and Owner‑local clock head                 | `CURRENT / PARTIAL`                                                                                 | `crates/data/src/owner/source_binding.rs`, `owner/postgres.rs`                                                                                                                                                                           | `B1`       |
| `ResearchPitTerminal` output handoff to R&D               | `CURRENT / PARTIAL`                                                                                 | `crates/data/src/owner/research_pit_terminal.rs`                                                                                                                                                                                         | `B3`       |
| Deployment Store Admission private seam                   | `CURRENT / PARTIAL`                                                                                 | `crates/data/src/owner/store_admission`                                                                                                                                                                                                  | `B3`       |
| R0 observation evidence and reference‑fact catalog        | `CURRENT / PARTIAL`, including the R0 write                                                         | `owner/reference_fact_coordinates`, `owner/reference_fact_catalog.rs`                                                                                                                                                                    | `B5`, `B7` |
| Calendar, Time Zone and Session native authorities        | `CURRENT / PARTIAL`                                                                                 | `owner/calendar`, `owner/time_zone`, `owner/session`                                                                                                                                                                                     | `B5`       |
| Market Semantics Owner contract                           | `CURRENT / PARTIAL`, including the fact intake                                                      | `owner/market_semantics`                                                                                                                                                                                                                 | `B5`, `B7` |
| Correction Policy private Replay projection               | `CURRENT / PARTIAL`                                                                                 | `owner/correction_policy_projection`                                                                                                                                                                                                     | `B5`       |
| Corporate Action Instrument Master sub‑authority          | `CURRENT / PARTIAL`                                                                                 | `owner/corporate_action`                                                                                                                                                                                                                 | `B5`       |
| Universe Selection Record                                 | `CURRENT / PARTIAL`                                                                                 | `owner/universe_selection.rs` with durable custody and in‑transaction rule evaluation in `owner/postgres/universe_selection.rs` (`universe_selection_records_v1`, receipts, outbox, historical‑membership frontier/facts/heads/manifest) | `B1`       |
| Replay Market Facts V2 foundation                         | `CURRENT / PARTIAL`                                                                                 | `owner/replay_market_facts_v2`                                                                                                                                                                                                           | `B4`       |
| Instrument Master V1 and V2 with economic terms           | `CURRENT / PARTIAL`, including the V1 intake and the V2 baseline, status delta and snapshot intakes | `owner/instrument_master.rs`, `owner/instrument_master_v2*.rs`, `owner/instrument_economic_terms*_v1.rs`                                                                                                                                 | `B4`, `B7` |
| Strategy input‑role binding and a Design's PIT coordinate | `CURRENT / PARTIAL`                                                                                 | `owner/postgres/strategy_input_binding_registry.rs`                                                                                                                                                                                      | `B2`, `B4` |
| EVENT and BAR Owner custody                               | `CURRENT / PARTIAL`                                                                                 | `owner/sample_fact.rs`, `owner/sample_projection*.rs`, `owner/bar_schedule.rs`                                                                                                                                                           | `B4`       |
| Shared Time clock‑head handoff                            | `TARGET`                                                                                            | `owner/shared_time_evidence.rs`                                                                                                                                                                                                          | `B3`       |
| Vendor Data Clients                                       | `CURRENT / PARTIAL`                                                                                 | `crates/adapters/databento/src/pit_observation_source_v1.rs` and `crates/adapters/binance/src/pit_observation_source_v1.rs`, both live‑verified                                                                                          | `B6`       |
| Live market fact channel to Runtime                       | `CURRENT / PARTIAL`, one channel                                                                    | `owner/live_market_fact_v1.rs`, `owner/live_market_stream_v1.rs`, `owner/postgres/live_market_stream_v1.rs`, `crates/adapters/bybit/src/live_market_fact_source_v1.rs`                                                                   | `B8`       |
| Binance perpetual settled funding rows                    | `CURRENT / PARTIAL`                                                                                 | `crates/adapters/binance/src/futures_pit_observation_source_v1.rs`                                                                                                                                                                       | `B6`       |
| Binance bar volume and taker buy volume                   | `CURRENT / PARTIAL`                                                                                 | `crates/adapters/binance/src/pit_observation_source_v1.rs`, `futures_pit_observation_source_v1.rs`                                                                                                                                       | `B6`       |
| Owner clock follows PIT intake                            | `TARGET`, after U1                                                                                  | none; PIT intake commits at the current clock head (`owner/postgres.rs`)                                                                                                                                                                 | none       |
| Fill‑bar quote cut for a bar‑only source                  | `TARGET`, on U1's path                                                                              | none; a quote cut holds observed Quote rows only (`owner/native_replay_quote_cut_v2.rs`)                                                                                                                                                 | none       |
| Companion quote lineage                                   | `TARGET`, after U1                                                                                  | none                                                                                                                                                                                                                                     | none       |
| Source Binding successor admission                        | `TARGET`, after U1                                                                                  | `commit_source_successor`, test callers only                                                                                                                                                                                             | none       |
| Custody window schedule fact                              | `CURRENT / PARTIAL` (T0-4b)                                                                         | `owner/pit_window_custody_v1/schedule.rs`, `owner/postgres/pit_window_custody_v1.rs` (`pit_window_schedule_facts_v1`)                                                                                                                    | `B5`       |
| Custody derived view and frames port                      | `CURRENT / PARTIAL` (T0-5)                                                                          | `owner/pit_window_custody_v1/view.rs`, `owner/pit_snapshot/custody_view.rs`, `owner/postgres/native_replay_custody_frame_v1.rs`                                                                                                          | `B5`       |
| Custody admitted reads                                    | `CURRENT / PARTIAL` (T0-5)                                                                          | `owner/store_admission/postgres.rs` (`PIT_WINDOW_CUSTODY_FLOOR_V1`), `owner/postgres/admitted_read_api_v1.rs`                                                                                                                            | `B5`       |

The snapshot path's per-instrument BAR schedule chain (`bar_schedule_*`) and a custody's window schedule facts coexist,
each with its own consumers: snapshot Replay reads the first, a custody view the second. They must not be merged: a
custody's commit never writes or advances an instrument's BAR schedule chain, and a snapshot never reads a window
schedule.

## Authoritative facts owned

- Normalized market records with distinct event time, provider-available time, retrieval time, and correction
  publication time. An observed value means available to this system at the bound decision cut, not merely that
  the underlying event had already happened.
- Dataset versions, point-in-time availability, coverage, lineage, corrections, and license constraints.
- Canonical instrument identity, venue mapping, tick size, contract lifecycle, currency, and valuation terms,
  including effective-dated trading calendar, session and time-zone rules, corporate actions, symbol changes,
  expiry/roll facts, and historical membership.
- Universe Selection Record binding the requester-owned selection rule, eligible-instrument frontier, effective and
  observed times, historical membership cut, exclusions, and result identity. Market Data evaluates a supplied
  rule but does not choose a strategy universe.
- PIT Market Snapshot identity bound to source and dataset versions, the four time coordinates, shared clock and
  decision-cut availability frontier, Instrument
  Master and Universe Selection Record versions, calendar/session/time-zone and corporate-action cuts, coverage,
  license, correction lineage, and one Market Semantics Compatibility identity.
- Every ordinary Research snapshot disposition additionally repeats the exact PIT Market Snapshot Request identity
  and content digest, requested instrument and universe scope, decision cut, provenance, license, correction,
  stable correlation, and Time Evidence. `PREPARED` or `SUBMITTED_OR_UNKNOWN` on the Research side proves no data
  availability.
- Market Semantics Compatibility identity shared by historical snapshots and live streams: normalization,
  adjustment, timestamp interpretation, instrument/reference mapping, and input-meaning versions.
- **TARGET:** typed Strategy Input Binding Receipt resolving one Research-declared market/reference role to exact
  instrument/universe, field, timeframe, units, PIT/live cut, source and Market Semantics identities.
- Immutable Market Data Source Binding binding source implementation and configuration digests, authenticated
  endpoint and dataset/account mapping, trust and normalization policies, license and redistribution scope,
  and an opaque least-privilege credential handle.
- Each Source Binding retains the complete supported failure-category set. A versioned stable precedence selects
  one primary category and canonical state independent of evidence arrival order: revoked rights are `REVOKED`,
  definitive denial is `UNLICENSED`, unresolved rights evidence or source unavailability is `UNAVAILABLE`, and
  identity/configuration or semantics mismatch is `INCOMPATIBLE`. `ADMITTED` is exclusive and requires no failure.
- **CURRENT:** one private canonical clock head is atomically persisted with Owner-local Source Binding and PIT facts.
  Exact replay and same-epoch advancement are supported; epoch change, a sealed cross-Owner handoff, and an Epoch
  Successor Proof are not current. Every instant a handoff, an Epoch Successor Proof or a `MarketDataDecisionCutV1`
  carries is Unix-epoch nanoseconds, and the unit travels in the type, `EpochNanosV1`; uncertainty and skew bounds are
  `NanosV1`. Neither has an accessor that returns the number without naming its unit, and both serialize as the bare
  number, so no wire form or digest changed when the unit moved into the type. A comparison with a millisecond clock
  goes through `may_be_reached_within_epoch_ms`, `is_reached_throughout_epoch_ms` or
  `is_not_passed_throughout_epoch_ms`, each of which answers for the whole commit millisecond and so rounds toward
  refusing. The Backtest and Qualification wire mirrors it with `MarketDataEpochNanosV1`, whose only millisecond
  comparison is `is_expired_at_epoch_ms`. The type carries the unit because the names did not: Backtest, Qualification,
  the R&D repair request and Source Intake read these instants as epoch milliseconds, so an expiry check against a
  nanosecond bound never fired and an ordering check never passed, and the one clock their tests had, the sealed
  protected-evaluation clock, was itself in milliseconds.
- **TARGET:** an immutable, content-addressed, exactly resolvable sealed clock-head handoff binds head identity/digest,
  clock identity/epoch, monotonic sequence, wall observation, decision cut, exclusive valid-through,
  restart-continuity digest, uncertainty/skew bounds, and comparison rule. Same-epoch successors strictly advance the
  required cuts. A new epoch additionally requires one direct immutable Epoch Successor Proof atomically committed
  with the new head and binding exact predecessor/successor head digests, prior/successor epoch identities, successor
  continuity digest, proof identity, commit cut, and comparison rule.

## Modules

- **Data Clients** - connect official vendors and venues and retrieve raw trades, quotes, bars, and reference files without defining their business identity.
- **Data Engine** - normalize records and time semantics, serve subscriptions and queries, and materialize reproducible snapshots.
- **PIT Catalog** - record when data, calendars, sessions, actions, membership, and corrections became observable;
  evaluate supplied universe-selection rules without admitting future information.
- **Instrument Master** - own effective-dated instrument identities, venue mappings, contract terms, sessions,
  time zones, lifecycle and corporate-action facts; it does not choose a run universe.

## Calendar and Time Zone native Owner contracts

### Durable R0 observation-evidence foundation

**CURRENT:** `ReferenceFactR0RecordV1` is the one durable R0 observation-evidence aggregate used by
standalone native reference authorities. R0 is not a business fact, coordinate selector, or second clock. Its
private PostgreSQL resolver accepts only an untrusted request and exact locator
`{request_identity, request_meaning_digest}`. It canonical-decodes the exact PIT Snapshot and Source Binding
locators, resolves and byte-matches their native Owner custody, resolves the complete co-committed PIT observation
batch and exact historical Shared Time head, and only then creates a record. No head, latest, history scan,
caller-carried authenticated input, or structurally valid locator can produce positive R0 custody.

The record cross-binds the exact PIT request identity/digest, snapshot identity/fact digest and verified PIT
outbox digest; complete observation-batch digest; Source Binding identity/fact digest/outbox digest, lineage root
and version; exact source and correction frontier stream/cut-identity bytes, sequence and digest; exact clock/epoch bytes,
monotonic sequence, wall observation, decision cut, exclusive valid-through, head identity/digest, restart
continuity, uncertainty and skew; replay/effective bounds; provider-available, retrieval,
correction-publication and Owner-observation coordinates; optional predecessor; and stable correlation. Every
repeated time and frontier field byte-matches the exact PIT observation batch, Source Binding locator, PIT time
evidence and resolved Shared Time head. R0 preserves the PIT Owner's existing outbox digest; it does not mint a
digest over locator bytes or reinterpret the older shared helper's SHA-256/little-endian identities.

All R0 version-1 integers are big-endian, optional tags are exactly `0x00`/`0x01`, reserved is `u16BE = 0`, and
identities are BLAKE3-256 over the listed NUL-terminated domain plus exact canonical bytes.

- Request-meaning domain `vibe.market-data.reference-fact-r0-request.v1\0`; bytes are schema, reserved, canonical
  PIT and Source Binding locator bytes as `u32BE length || bytes`, replay start/exclusive end, effective-from,
  optional effective-until, the four observation coordinates, decision cut, optional predecessor and stable
  correlation. Request identity is the separate idempotency key.
- Record domain `vibe.market-data.reference-fact-r0-record.v1\0`; bytes are schema, reserved, request
  identity/meaning, the exact PIT, observation, Source Binding, frontier and Shared Time fields above in that order,
  followed by replay/effective bounds, the four observation coordinates, decision cut, optional predecessor and
  stable correlation. Variable clock, epoch and frontier stream/cut identities are `u32BE length || bytes`.
- Cut domain `vibe.market-data.reference-fact-r0-cut.v1\0`; bytes are schema, reserved, request identity/meaning,
  exact member count `u32BE = 1`, record identity/digest, and gap count `u32BE = 0`. No inferred empty or
  multi-record cut is positive.
- Receipt domain `vibe.market-data.reference-fact-r0-receipt.v1\0`; bytes are schema, reserved, request
  identity/meaning, cut identity/digest, store-generation identity, positive append sequence and stable
  correlation. Outbox identity equals receipt identity and payload equals exact receipt bytes.
- Readback domain `vibe.market-data.reference-fact-r0-readback.v1\0`; bytes are schema, reserved, record
  identity/length/bytes, cut identity/length/bytes, receipt identity/length/bytes and outbox identity.

One transaction stores record, one-record complete cut, generation/append state, receipt and outbox in private
tables. Exact identity/meaning replay re-decodes, rehashes and cross-validates every row and returns byte-identical
move-only readback. Changed meaning, missing/tampered locator, partial row, scalar/frontier splice, canonical drift
or response-loss retry mismatch appends nothing. **CURRENT / PARTIAL, production R0 write:** the Owner
appends the R0 record for every PIT snapshot it commits as `AVAILABLE`, inside the same Owner transaction as the
snapshot, derived only from the co-committed PIT and Source Binding custody and the current clock head; no route, no
caller field and no test code takes part, and a replayed commit rejoins the same record. Its claim runs from the
snapshot's event instant for the longest fixed interval the Source Binding declares for any BAR row label of the
snapshot, and for one nanosecond when none is declared - a binding that declares no bars, or rows of an exchange session
day only. A longer claim is a broader statement about how long the reference facts hold, not a more cautious one: it is
bounded by the longest bar the snapshot itself contains, and each Replay's window is derived separately from its own
execution label, so no execution window widens because of it. The resolver re-derives the end from the stored batch and
binding; the composition-basis read, which holds no batch, takes it from the record the resolver wrote. The isolated PostgreSQL
chain proves it on both production intake paths: the record's coordinates are the snapshot's, a replay appends no
second record, and a snapshot that is not `AVAILABLE` carries none. Nothing beyond this write is claimed. **NOT_ADMITTED:** R0 grants no provider authenticity, deployment, runtime, Dashboard or trading authority.

### ReferenceFactCatalogV1 business-value authority

**TARGET:** `ReferenceFactCatalogV1` is the single Market Data Owner catalog for Calendar, Time Zone and Session
business values. It is a different authority axis from R0: the catalog owns the typed value, business scope,
business-effective half-open interval, revision, correction lineage and direct predecessor; R0 owns only the exact
PIT/Source/Shared-Time observation evidence used when resolving that value. An R0 replay/effective bound never
widens, truncates or creates a catalog business interval.

The closed value tags are `1 CALENDAR`, `2 TIME_ZONE` and `3 SESSION`. Calendar entries bind one exact civil-day
open/closed value. Time Zone entries bind one exact time-zone/ruleset/UTC-offset value and the UTC interval on
which that offset is constant. Session entries bind one exact trading day, contiguous interval ordinal and local
open/close boundaries with explicit fold resolution; they never store authoritative UTC endpoints. Session alone
recomputes those endpoints from the exact Time Zone cut and requires coverage of both open and close instants.

Only an admitted bootstrap/admin source may append an immutable catalog entry. Runtime receives an untrusted exact
entry locator and can only resolve and byte-verify it; caller-carried typed proposals, latest/head selection and
structurally valid bytes do not mint positive custody. The entry binds exact Source Binding identity/fact/lineage
and source/correction frontiers. Native Calendar, Time Zone and Session facts repeat the resolved catalog identity
and preserve independent R0 observation coordinates. Missing entry, changed meaning, source splice, predecessor
branch, non-canonical ordering, interval overlap/gap or a Session boundary outside Time Zone coverage writes zero
native facts, cuts, receipts and outbox rows.

Catalog key and entry identities are BLAKE3-256 over respectively
`vibe.market-data.reference-fact-catalog-key.v1\0` and
`vibe.market-data.reference-fact-catalog-entry.v1\0` plus canonical big-endian bytes. The key binds closed kind,
business scope, positive revision, source lineage root and the complete typed value. The stable catalog-head scope is
exactly the stable business-scope identity plus that source lineage root; neither revision nor typed value may select
a different head. Business-scope identity is BLAKE3-256 over
`vibe.market-data.reference-fact-business-scope.v1\0` plus schema `u16BE = 1`, reserved zero `u16BE`, closed kind
`u8`, and exactly one native key: Calendar identity `u32BE length || bytes` plus civil day `i32BE`; Time Zone
identity `u32BE length || bytes` plus ruleset identity `[u8; 32]`; or Session identity `u32BE length || bytes`,
trading day `i32BE` and interval ordinal `u32BE`. The entry additionally binds command identity, optional catalog
predecessor, positive correction sequence, business-effective interval, exact Source provenance, administrator
admission identity and stable correlation, in that order after the complete catalog-key bytes; it does not repeat
the typed value already bound by that key. A catalog predecessor is always the prior catalog
entry identity in that same head scope, never a native fact identity. Genesis has correction sequence `1` and no
catalog predecessor; every later entry has the immediately prior catalog entry and sequence increased by exactly
one. A Time Zone successor either corrects the same constant-offset regime and retains byte-identical effective
bounds, or describes the immediately adjacent regime whose lower bound equals the predecessor's upper bound.
Calendar and Session successors correct one stable native key and therefore retain byte-identical effective bounds.
Exact stored bytes are decoded, rehashed and matched before use. **NOT_ADMITTED:** isolated acceptance catalog
data does not prove vendor authenticity and grants
no default/production database, deployment, provider, Dashboard, runtime or trading effect.

### Shared native boundary and custody

**CURRENT:** Replay V2 has typed Calendar and Time Zone values, while PIT and Instrument Master still carry
calendar, time-zone or ruleset identities without native Calendar/Time Zone readback. Shared Time authenticates
when Market Data observed a fact; it never supplies a calendar day, open disposition, time-zone rule or UTC offset.

**TARGET:** Calendar and Time Zone are independent Market Data native authorities. Their fixed consumers are PIT,
which preserves the direct native cut identity/digest; Instrument Master, which binds native cut identities/digests
rather than strings; Replay V2, which receives deterministic projections; and later BAR resolution. Session is the
sole join of exact Calendar and Time Zone cuts. Neither native authority depends on Session or copies the other's
facts. An untrusted private proposal cannot reinterpret an existing Replay V2 value or mint positive custody.

Each Calendar, Time Zone and Session authority accepts only an untrusted exact catalog-entry locator for catalog
selection and re-resolves the exact stored `ReferenceFactCatalogV1` entry inside the caller's Owner transaction,
together with the exact admitted Source Binding. Latest/current-head lookup is verification of the resolved entry's
lineage position only and is never selection. The native typed business value is derived from and byte-matched to
that catalog entry; a caller proposal cannot supply or override it. One verified `ReferenceFactCoordinatesV1` is
observation evidence only and never business-value or lineage authority.

Every native fact has its own lineage root, positive native correction sequence, optional native predecessor and
current native head. The native lineage root is exactly the catalog scope identity, and that scope identifies one
native fact key: `(calendar identity, civil day)`, `(time-zone identity, ruleset identity)`, or `(session identity,
trading day, interval ordinal)`. It is neither derived from nor compared with Source Binding lineage coordinates.
The native predecessor is always the immediately prior fact identity for the same native fact key and domain,
never a catalog entry identity. Catalog and native correction sequences correspond one-to-one. At
genesis both sequences are `1` and neither predecessor is present. For every correction with sequence greater than
`1`, both predecessors are required, the native fact's catalog entry names the catalog predecessor, and the prior
native fact must bind that exact catalog predecessor; catalog entry and native fact hashes remain distinct even for
the same revision. A missing predecessor, branch, cycle, sequence gap or regression, cross-source splice, effective
overlap/gap, incomplete requested coverage, clock mismatch or expired observation fails before any write. Positive
facts, complete cuts, receipts and move-only readbacks have no public constructor/deserializer. Public callers
receive only an untrusted sealed locator; the resolver is crate-sealed.

Version-1 integers are big-endian, optional tags are exactly `0x00`/`0x01`, booleans are `0x00`/`0x01`, and
identities/digests are 32 bytes. Every artifact identity is BLAKE3-256 over its listed NUL-terminated domain plus
exact bytes. For each authority, receipt bytes are schema `u16BE = 1`, reserved `u16BE = 0`, request identity,
request-meaning digest, cut identity/digest, store-generation identity, positive append sequence `u64BE`, stable
correlation. Receipt identity is therefore generation-bound and hashes its receipt domain plus those exact bytes.
Outbox identity is exactly that receipt identity; it has no separate domain or hash, and its payload is the exact
receipt bytes. Readback bytes are schema, reserved, positive fact count `u32BE`, each fact identity,
`u32BE` length and exact bytes in cut order, then cut identity/length/bytes, receipt identity/length/bytes and
outbox identity. Unknown tags, zero required identities, duplicate or non-canonical order, malformed lengths and
trailing bytes are unsupported.

One caller-owned transaction appends immutable fact/head rows, the complete cut, receipt, outbox and generation/
append state. Exact identity/meaning replay rejoins and re-verifies the entire stored aggregate; changed meaning
conflicts. Partial custody, canonical/scalar drift or dependency splice is untrusted. Response loss is recovered by
the exact sealed locator and returns byte-identical readback without another append. Tables and schema grant no
runtime access; `PUBLIC` has no privilege; only the fixed non-grantable Owner/writer and exact non-grantable reader
`EXECUTE` manifests are admitted. Every validation, ACL or recovery failure writes zero rows.

**NOT_ADMITTED:** these contracts do not claim implementation, migration, store admission, registered product
composition, provider authenticity, production/default writes, deployment, Dashboard work, runtime or trading.

### Calendar V1: complete day/open authority

`CalendarFactV1` value is exact calendar identity `u32BE length || bytes`, signed UTC civil-day ordinal `i32BE`
from `1970-01-01`, and `is_open` `u8`. Fact domain is `vibe.market-data.calendar-fact.v1\0`; after schema and
reserved its bytes are that complete catalog-derived value, exact catalog entry identity `[u8; 32]`, native lineage
root, native correction sequence `u64BE`, optional native predecessor, effective-from and optional effective-until
`i128BE`, provider-available, retrieval, correction-publication and Owner-observation `i128BE`, decision cut
`u64BE`, R0 coordinate identity/digest, Source Binding identity/fact digest/lineage root/`u64BE` version, and
source/correction frontier digests.

Request-meaning domain is `vibe.market-data.calendar-request.v1\0`; bytes are schema, reserved, closed consumer tag
(`1 PIT`, `2 INSTRUMENT_MASTER`, `3 REPLAY_V2`, `4 BAR`), calendar identity, inclusive first and exclusive last
day `i32BE`, Owner-observation, decision cut, Source Binding and R0 locator bytes as `u32BE length || bytes`, and
stable correlation. Cut domain is `vibe.market-data.calendar-cut.v1\0`; bytes are schema, reserved, request
identity/meaning, consumer tag, calendar identity, day bounds, Owner-observation, decision cut, R0 cut identity/
digest, expected-day count `u32BE`, then exactly one day-sorted fact identity/digest for every requested civil day,
followed by gap count and sorted missing day ordinals. Positive means zero gaps, no duplicate day and complete
open/closed disposition; an empty range is invalid. Receipt and readback domains respectively replace
`calendar-cut` with `calendar-receipt` and `calendar-readback`, both version `v1\0`; the outbox identity equals the
receipt identity under the shared native rule and has no domain.

### Time Zone V1: complete UTC-offset transition authority

`TimeZoneFactV1` value is exact time-zone identity and ruleset identity (`u32BE length || bytes`, then `[u8; 32]`)
plus signed UTC offset seconds `i32BE`. Its half-open effective interval is the UTC interval on which that offset is
constant. A ruleset transition is an immutable successor; the adjacent before/after intervals determine the local
fold when offset decreases and gap when it increases, so neither condition is guessed or normalized away.

Fact domain is `vibe.market-data.time-zone-fact.v1\0`; bytes are schema, reserved, that complete catalog-derived
value, exact catalog entry identity `[u8; 32]`, native lineage root, native correction sequence, optional native
predecessor, then the effective and observation fields and exact R0/Source Binding/frontier tail defined for
Calendar, in the same order. Request-meaning domain is
`vibe.market-data.time-zone-request.v1\0`; bytes are schema, reserved, consumer tag, time-zone identity, ruleset
identity, replay-window start and exclusive end `i128BE`, Owner-observation, decision cut, length-prefixed Source
Binding and R0 locator bytes, and stable correlation. Cut domain is `vibe.market-data.time-zone-cut.v1\0`; bytes
are schema, reserved, request identity/meaning, consumer tag, time-zone/ruleset identities, window bounds,
Owner-observation, decision cut, R0 cut identity/digest, transition count `u32BE`, interval-start-sorted fact
identity/digest entries, then gap count and sorted half-open gap bounds. Positive coverage starts at or before the
window start, ends at or after its end, and has exactly adjacent intervals with one offset for every instant,
including folds and gaps. Receipt and readback domains are respectively
`vibe.market-data.time-zone-receipt.v1\0` and `vibe.market-data.time-zone-readback.v1\0`; the outbox identity equals
the receipt identity under the shared native rule and has no domain.

### Session V1: sole native Calendar and Time Zone join

**CURRENT:** Replay V2 has typed Session values and BAR V1 has its existing structural bytes, but neither is a
native Session join or authority. **TARGET:** Session is the sole native join of exact positive independent
`CalendarCutV1` and `TimeZoneCutV1` in one Market Data transaction, together with admitted Source Binding, exact
Instrument Master reference tuple and
verified Shared Time observation. Its only raw resolver consumer is `MARKET_DATA_OWNER_V1`; internal PIT, Replay
and additive BAR composition may consume it, while Backtest and R&D receive sealed projections only.
Caller strings, UTC endpoints, a nearest transition or a private proposal never mint a session fact. Gap local
time has no positive fact and is never shifted. **NOT_ADMITTED:** no Session implementation, native store,
registered composition, product reachability, production write, deployment, runtime or trading is claimed.

`SessionFactV1` binds stable non-empty session identity, trading day as signed `i32BE` days since `1970-01-01` in
the proleptic Gregorian calendar, and contiguous interval ordinal `u32BE` starting at zero. Each local boundary is
local day `i32BE`, nanoseconds-of-day `u64BE < 86_400_000_000_000`, and resolution tag `u8`: `1 EXACT`,
`2 EARLIER_INSTANT` or `3 LATER_INSTANT`. A unique local time requires `EXACT`; a fold requires the authenticated
earlier/later choice and recomputation against the exact Time Zone transition. Leap-second spelling and every gap
boundary are unsupported. The fact repeats recomputed UTC open/close `i128BE`, requires `open < close`, and binds
exact Calendar fact/cut identities/digests, Time Zone open- and close-boundary fact identities/digests plus cut
identity/digest, Instrument Master reference tuple, Source Binding identity/lineage, source/correction frontiers,
correction identity and complete R0 observation coordinates. The catalog-derived typed business value byte-matches
the exact entry; every derived UTC and dependency scalar is recomputed from the joined native facts.

Fact domain is `vibe.market-data.session-fact.v1\0`; bytes are schema `u16BE = 1`, reserved, session identity
`u32BE length || bytes`, trading day, interval ordinal, local-open tuple and local-close tuple as the complete
catalog-derived typed business value, then exact catalog entry identity `[u8; 32]`, native lineage root, recomputed
UTC open, UTC close, Calendar fact identity/digest and cut identity/digest, Time Zone open fact identity/digest,
close fact identity/digest and cut identity/digest, Instrument Master readback/fact/cut digests, optional native
predecessor, native correction sequence `u64BE`, provider-available, retrieval, correction-publication and
Owner-observation `i128BE`,
decision cut `u64BE`, R0 coordinate identity/digest, Source Binding identity/fact digest/lineage root/`u64BE`
version, source frontier, correction frontier and correction identity. A correction is an immutable current-head
direct successor for the exact `(session identity, trading day, interval ordinal)` native key.

Request-meaning domain is `vibe.market-data.session-request.v1\0`; bytes are schema, reserved, fixed raw consumer
tag `1 MARKET_DATA_OWNER_V1`, session identity, inclusive first/exclusive last trading day, exact Calendar and Time
Zone cut locators, Instrument Master reference locator, Source Binding and R0 locators as length-prefixed bytes,
Owner-observation, decision cut and stable correlation. Cut domain is `vibe.market-data.session-cut.v1\0`; bytes
are schema, reserved, request identity/meaning, consumer tag, session/day scope, Calendar and Time Zone cut
identities/digests, Instrument Master reference tuple, Owner-observation, decision cut, R0 cut identity/digest,
day count `u32BE`, then every day in order with its open/closed tag, interval count and interval-ordinal/fact-
identity/fact-digest entries, followed by gap count and missing-day ordinals. Open days contain the full contiguous
ordinal set from zero; closed days have an explicit zero-member census. An all-closed window may therefore have a
positive explicit empty-fact cut. Duplicate key, ordinal gap, overlapping UTC interval, missing requested day or
an interval gap inside the declared open schedule yields no positive cut.

Receipt and readback domains are `vibe.market-data.session-receipt.v1\0` and
`vibe.market-data.session-readback.v1\0`; the outbox identity equals the receipt identity, has no domain, and uses
the shared native write-once, sealed rejoin/recovery, ACL and zero-write rules. Replay V2 preserves its existing Session bytes and BAR
V1 preserves its existing bytes: native Session adoption requires additive dependency/aggregate fields and an
additive BAR successor contract, never reinterpretation of stored Replay V2 or BAR V1 custody.

## Market Semantics Owner contract

### Status, boundary and fixed consumers

**CURRENT:** the Market Data architecture owns Market Semantics Compatibility, and `ReplayMarketFactsV2`
already has the closed typed Market Semantics value described below. Source Binding still carries free-form
normalization and meaning strings only as untrusted source claims; a Source Binding admission, string equality or
digest carried by PIT or Instrument Master does not by itself authenticate typed Market Semantics.

**A fact's granularity is the Source Binding, not the instrument and not the market.**
`MarketSemanticsFactSubmissionV1` carries exactly a Source Binding locator, a PIT snapshot locator and the typed
value; it carries no coordinate, and the compatibility scope a submission resolves against is one the Owner
derives from the binding. One binding therefore states one price adjustment. A vendor that covers several
markets under different adjustment rules - one market published with adjustment factors and another published
raw because the vendor issues no factor series for it - has two ways to be stated and only two: it is admitted
as one Source Binding per market, each with its own fact, or it declares for one of those markets an adjustment
rule it does not hold. **The second is the same unheld assertion `UNKNOWN` exists to remove, relocated from the
value to the binding.** Nothing in this document requires the split today, and requiring it would constrain
every future source, so it is recorded here as a known limit rather than decided by the admission of any one
source.

**Each PIT snapshot has its own chain of facts under the scope.** A fact is proven by one PIT snapshot's
evidence: it binds that snapshot's identity and fact digest, and a Strategy Input declaration accepts only a fact
that binds its own snapshot. The chain of facts, the head that answers a read and the overlap rule are therefore kept
per compatibility scope and PIT snapshot, and a second snapshot under the same binding starts its own chain with its
own genesis fact. That one binding states one price adjustment is kept by an explicit rule rather than by the scope
having a single head: after every Owner commit, every head of a scope carries the same five typed values. A fact whose
value differs from any head of its scope other than the one it succeeds is refused by name as `ScopeValueConflict`,
with no write. A second genesis for the same scope and snapshot is still a branch and is refused as
`InvalidCorrection`.

A submitter reads the value a scope states rather than restating it. `resolve_market_semantics_scope_value_v1` takes
a Source Binding locator and returns the compatibility scope the Owner derives from that binding's semantics,
together with the value every head of the scope carries, in the words a submission states it; it returns no value
while the scope has no head, when any value may be the first. It runs in the caller's transaction, reads only and
takes no row locks. Heads of one scope that state different values are the store's fault, so the read refuses them as
`StoreUnavailable` rather than picking one, and a binding Market Data does not hold is `SourceBindingUnavailable`.

**CURRENT:** Market Data has one standalone `MarketSemanticsFactV1` authority foundation. Its first fixed consumer is the
Strategy Input Binding Registry; `ReplayMarketFactsV2` later consumes the same Owner readback as a deterministic
projection. An untrusted proposal may carry only its request identity and meaning, stable correlation, claimed
typed value, claimed predecessor and dependency locators. It cannot supply a positive fact, coordinate, cut,
canonical bytes, digest or receipt. Market Data privately resolves an admitted native Source Binding readback,
the exact native PIT Snapshot and Instrument Master readbacks, and the exact Owner-authenticated
`ReferenceFactR0ReadbackV1`. It then resolves a Market Data-owned closed registry entry that maps those
exact dependency identities to the typed semantic value. Free-form Source Binding strings, adapter labels,
provider fields, caller mappings and naming similarity never select or authenticate a registry entry.

The positive resolver accepts only the untrusted proposal. It canonical-decodes the exact PIT, Source Binding,
Instrument Master and R0 locators, resolves all four Owner readbacks in its caller transaction, derives the closed
registry key, and resolves exactly one immutable registry record by that key. The registry-key domain is
`vibe.market-data.market-semantics-registry-key.v1\0`; bytes are schema, reserved, compatibility-scope identity,
R0 record identity/digest and cut identity/digest, PIT snapshot identity/fact digest, Source Binding identity/fact
digest/lineage root/`u64BE` version, Instrument Master readback/fact/cut digests, source frontier and correction
frontier. Registry-record domain is `vibe.market-data.market-semantics-registry-record.v1\0`; bytes are schema,
reserved, key identity, `u32BE` key length plus exact key bytes, the five typed value fields, and correction
identity. Key identity is the private table primary key and record identity is the BLAKE3 digest of exact record
bytes. Zero, many, missing, canonical drift, dependency splice, or value mismatch is unavailable/untrusted; no
name, value, scope, latest or history lookup is admitted. A test-only seal is not a production positive path.

**CURRENT / PARTIAL, production Market Semantics intake:** one Owner-sealed admission port and one route,
`POST /v1/market-data/market-semantics`, through which Operations submits the untrusted proposal above beside an
already admitted Source Binding. The Owner alone resolves the four dependency readbacks, derives the closed registry
key, registers the registry entry for that key with the proposed typed value once (a later proposal with a different
value for the same key is refused as `SnapshotValueConflict`, never an overwrite), and appends the fact, complete cut, receipt and outbox in
one transaction. The submission names the binding, the snapshot and the typed value and nothing else: the scope is
the binding's own compatibility identity, and the effective regime and correlation are the snapshot's own R0
observation evidence, so neither is the submitter's to state. The isolated PostgreSQL chain proves the scope, the
replay rejoin and the conflict. Nothing beyond this intake is claimed. **NOT_ADMITTED:** this contract does not claim provider ingestion or
authenticity, Strategy Input Registry or Replay V2 product composition, deployment, runtime execution, Dashboard work
or trading authority. A fixture, caller-carried identity, structurally valid bytes or existing Replay V2 fact is not
standalone Owner readback.

### Typed fact, time and correction topology

The closed version-1 value is exactly: non-zero normalization identity `[u8; 32]`; price adjustment `u16BE` with
`1 RAW`, `2 SPLIT_ADJUSTED`, `3 TOTAL_RETURN_ADJUSTED` or `4 UNKNOWN`; timestamp basis `u16BE` with
`1 EVENT_EFFECTIVE`, `2 INTERVAL_OPEN` or `3 INTERVAL_CLOSE`; non-zero price-unit identity `[u8; 32]`; and non-zero
size-unit identity `[u8; 32]`. Zero and every unlisted tag are unsupported.

`4 UNKNOWN` is the submitter stating that the source's adjustment rule is not known to it. It is a declaration,
never a fallback: an adjustment string this Owner does not recognise is an invalid submission and is refused,
exactly as before. A source whose rule is unknown must say so; it must not be recorded as `RAW` because `RAW` was
the only available answer. A fact carrying `4 UNKNOWN` has no replay representation and is refused there, because a
replay compares prices and cannot do so across an undeclared caliber. Unit identities name Owner-registry meanings; they are
not unit strings, currency defaults, scale guesses or Instrument Master increment fields.

Each immutable fact binds one Owner-registry compatibility-scope identity, an optional exact predecessor, one
half-open effective interval `[effective_from, effective_until)`, provider-available, retrieval,
correction-publication and Owner-observation coordinates, and a positive decision cut. It also binds the exact R0
coordinate identity/digest and the exact admitted PIT Snapshot, Source Binding and Instrument Master
identities/digests, Source Binding lineage, source and correction frontiers and correction identity. All repeated
coordinate scalars must byte-match the resolved `ReferenceFactR0ReadbackV1`; the standalone authority creates no
second clock or coordinate authority. Effective containment and observation availability are independent
predicates. Every availability coordinate must be observable under the same authenticated clock and decision cut.

A correction is an immutable direct successor in the same compatibility scope and PIT snapshot. It names that
chain's current head, advances authenticated correction/observation evidence and may retain the corrected effective
interval; it never rewrites or makes its predecessor unavailable at an earlier cut. Within one chain different
effective regimes cannot overlap. Missing predecessors, branches, cycles, ambiguous overlap, regressed
coordinates/frontiers or a later correction selected at an earlier observation cut produce no positive fact or cut.

**NOT_CONSTRUCTIBLE today: no correction can be appended.** One proposal field serves as both the R0 record's
predecessor and the Market Semantics predecessor. `validate_proposal` in `market_semantics/authority.rs` requires it
to equal the R0 record's predecessor, an R0 identity, while `validate_successor_v1` requires it to equal the prior
fact's identity; the two are BLAKE3 digests under different domains. The Owner's R0 record for a snapshot is also
always a genesis (`append_owner_r0_for_available_pit_v1`). Every fact today is therefore a genesis. When this path is
repaired it must keep the rule above: a correction that keeps the typed value may advance one snapshot's chain alone,
and one that changes the value must append a successor to every head of the scope in one Owner transaction, because a
single-chain change would leave the heads disagreeing and is refused as `ScopeValueConflict`. That scope-wide
correction is defined here and not built, because nothing consumes it. It cannot be built by appending each successor
through today's per-append check, which refuses the first successor while the other heads still carry the old value:
the rule holds after every Owner commit, so that transaction writes every successor first and checks the scope once,
at its end.

### Canonical codec, complete cut and custody

Every version-1 integer is big-endian. Optional absence/presence is exactly `0x00`/`0x01`; every identity/digest is
32 bytes; reserved is `u16BE = 0`; malformed length, zero required identity, alternate tag, duplicate, non-canonical
order or trailing byte is unsupported. Identities are BLAKE3-256 over the listed NUL-terminated domain followed by
the exact canonical bytes.

- Request-meaning domain `vibe.market-data.market-semantics-request.v1\0`; bytes are, in order: schema
  `u16BE = 1`, reserved, consumer tag, compatibility-scope identity, optional predecessor, the five typed value
  fields in fact order, effective-from, optional effective-until, Owner-observation, decision cut, then the PIT
  Snapshot, Source Binding, Instrument Master and R0 untrusted locator bytes, each as `u32BE length || bytes`, and
  stable correlation. Request identity is the separate idempotency key and is not part of request meaning.
- Fact domain `vibe.market-data.market-semantics-fact.v1\0`; bytes are, in order: schema `u16BE = 1`, reserved,
  compatibility-scope identity, optional predecessor, normalization identity, price-adjustment tag,
  timestamp-basis tag, price-unit identity, size-unit identity, effective-from `i128BE`, optional effective-until,
  provider-available `i128BE`, retrieval `i128BE`, correction-publication `i128BE`, Owner-observation `i128BE`,
  decision cut `u64BE`, R0 coordinate identity and digest, PIT Snapshot identity and fact digest, Source Binding
  identity, fact digest, lineage root and `u64BE` lineage version, Instrument Master readback, fact and cut digests,
  source frontier, correction frontier and correction identity.
- Cut domain `vibe.market-data.market-semantics-cut.v1\0`; bytes are schema, reserved, request identity, request
  meaning digest, closed consumer tag (`1 STRATEGY_INPUT_BINDING_REGISTRY_V1`, `2 REPLAY_MARKET_FACTS_V2`),
  compatibility-scope identity, effective instant `i128BE`, Owner-observation `i128BE`, decision cut `u64BE`, R0
  cut identity and digest, expected-member count `u32BE`, strictly scope-sorted entries of scope identity plus fact
  identity/digest, then gap count `u32BE` and strictly sorted gap-scope identities. A positive cut has the complete
  expected manifest and zero gaps; an explicit empty manifest is not an inferred success.
- Receipt domain `vibe.market-data.market-semantics-receipt.v1\0`; bytes are schema, reserved, request identity,
  request meaning digest, consumer tag, cut identity/digest, store-generation identity, positive append sequence
  `u64BE` and stable correlation. Receipt identity is the generation-bound BLAKE3-256 over that domain and exact
  receipt bytes. Outbox identity is exactly the receipt identity, has no separate domain or hash, and its payload is
  the exact receipt bytes.
- Readback domain `vibe.market-data.market-semantics-readback.v1\0`; bytes are schema, reserved, positive fact count
  `u32BE`, each fact identity followed by `u32BE` byte length and exact fact bytes in cut order, then cut identity,
  length and bytes, receipt identity, length and bytes, and outbox identity. Positive fact, cut, receipt and
  move-only readback have no public constructor or deserializer; the resolver is crate-sealed.

Heads are kept per compatibility scope and PIT snapshot in `market_semantics_heads_v2`. A store that still holds
the one-head-per-scope `market_semantics_heads_v1` is migrated once, each head keyed by the snapshot its fact binds,
and the migration stops rather than guesses at an old table of any other shape. The old table is then retired, not
dropped: it is kept with a trigger that refuses every write, so an earlier binary finds it present and fails on its
first append instead of recreating it empty and admitting any genesis. A fresh store carries it retired too. One
Owner transaction appends immutable facts/heads, the complete cut, receipt, outbox and store
generation/append state. Exact request identity plus exact meaning is idempotent. Changed meaning conflicts;
partial rows, scalar/canonical drift, a dependency splice or digest mismatch make custody untrusted. Response loss
never authorizes another append: recovery accepts only the exact identity/meaning locator, re-verifies the complete
stored aggregate and returns byte-identical move-only readback.

The existing `ReplayReferenceFactValueV2::MarketSemantics` is the deterministic projection of the five typed value
fields from a verified standalone readback. Replay V2 keeps its own aggregate fact/cut identities and repeats its
time, scope, source and correction projection only after byte-equality checks against that readback. It neither
replaces the standalone fact nor becomes a second Market Semantics authority.

## Correction Policy private Replay projection

**CURRENT:** Source Binding owns correction lineage/frontiers and Replay V2 has the typed `CorrectionPolicy`
value. **TARGET:** Market Data deterministically derives that value for Replay from exact admitted Source Binding
lineage plus verified `ReferenceFactCoordinatesV1`; there is no standalone Correction Policy receipt, outbox,
state, locator or resolver. **NOT_ADMITTED:** caller strings, a generic policy label, a frontier digest alone or
Replay storage cannot mint policy authority, and this projection claims no implementation, provider authenticity,
production write, deployment or trading authority.

The private version-1 value is exact non-empty correction-stream identity, positive `u64BE` sequence and
`successor_only = 0x01`; false and every alternate tag are unsupported. It additionally binds exact Source Binding
identity/fact/lineage, correction-frontier digest identity, one half-open effective interval between distinct
frontier changes, and the first admitted version's provider-available, retrieval, correction-publication,
Owner-observation, decision cut, clock and R0 coordinate identity/digest. The first lineage version establishes
availability and remains open even when its R0 record used a bounded replay/evidence interval; only a distinct
successor frontier closes the correction regime. Later versions carrying the byte-identical source, stream,
sequence, successor-only value and
frontier are coalesced into the same interval and cannot move availability earlier. The next distinct frontier
closes the prior interval and must be a direct, sequence-advancing successor. Gap, regression, branch, cross-source
splice, changed stream without a new lineage, or clock/coordinate mismatch yields no projection.

The deterministic private projection domain is `vibe.market-data.correction-policy-projection.v1\0`. Canonical
bytes are schema `u16BE = 1`, reserved, stream `u32BE length || bytes`, sequence, successor-only tag, Source Binding
identity/fact digest/lineage root/`u64BE` version, correction-frontier digest, effective-from and optional
effective-until `i128BE`, the four availability/observation coordinates `i128BE`, decision cut `u64BE`, clock-head
identity/digest and R0 coordinate identity/digest. Replay V2 projects only stream, sequence and successor-only into
its existing typed value and repeats time/source/correction fields only after exact equality; its aggregate custody
does not create a second policy authority.

## Corporate Action native Instrument Master sub-authority

### Status, inputs and typed actions

**CURRENT:** Instrument Master owns corporate-action terms/frontiers and Replay V2 has closed Split,
CashDividend, SymbolChange, Expiry and Roll variants, but no standalone native Corporate Action readback exists.
**TARGET:** Instrument Master is the sole writer of `CorporateActionFactV1`; fixed consumers are Replay V2 and
Backtest. Issuance resolves, in one Owner transaction, exact positive Instrument Master cut/facts, admitted Source
Binding, PIT Snapshot, shared-clock observation, correction frontier and `ReferenceFactCoordinatesV1`. None may be
replaced by a caller digest, symbol, latest row or Replay fact. **NOT_ADMITTED:** this contract claims no
implementation, provider ingestion/authenticity, production/default migration/write, product composition,
deployment, runtime, Dashboard or trading authority.

Every fact binds a non-zero action identity, exact canonical instrument bytes and one closed term:

- `1 SPLIT`: positive numerator and denominator `u64BE`. Direction is fixed: post-action quantity equals
  pre-action quantity multiplied by numerator/denominator, and post-action price equals pre-action price multiplied
  by denominator/numerator; reversal or an implicit vendor convention is unsupported.
- `2 CASH_DIVIDEND`: signed `i128BE` mantissa, `u8` decimal scale and non-empty canonical currency identity.
- `3 SYMBOL_CHANGE`: non-empty successor canonical instrument; the predecessor instrument remains historical.
- `4 EXPIRY`: no payload.
- `5 ROLL`: non-empty successor canonical instrument; it records the reference transition and grants no order.

The fact also binds optional direct predecessor, one half-open effective interval, four availability/observation
coordinates, decision cut, R0 coordinate identity/digest, exact Instrument Master readback/fact/cut digests, PIT
Snapshot identity/fact digest, Source Binding identity/fact/lineage/version, source and correction frontiers and
correction identity. Corrections are immutable current-head successors in the same action/instrument lineage and
cannot rewrite earlier observability. Missing predecessor, branch, cycle, sequence/frontier regression, action or
instrument splice, invalid ratio/currency/successor, effective ambiguity or clock mismatch fails before writing.

### Canonical complete census and custody

Fact domain is `vibe.market-data.corporate-action-fact.v1\0`. Bytes are schema `u16BE = 1`, reserved, action
identity, instrument `u32BE length || bytes`, term tag and payload in the order above, optional predecessor,
effective-from and optional effective-until `i128BE`, provider-available, retrieval, correction-publication and
Owner-observation `i128BE`, decision cut `u64BE`, R0 coordinate identity/digest, Instrument Master readback/fact/
cut digests, PIT Snapshot identity/fact digest, Source Binding identity/fact digest/lineage root/`u64BE` version,
source frontier, correction frontier and correction identity.

Request-meaning domain is `vibe.market-data.corporate-action-request.v1\0`; bytes are schema, reserved, closed
consumer tag (`1 REPLAY_V2`, `2 BACKTEST`), inclusive/exclusive replay-window bounds `i128BE`, positive instrument
count `u32BE`, strictly sorted length-prefixed canonical instruments, Owner-observation, decision cut,
length-prefixed Instrument Master, PIT, Source Binding and R0 locator bytes, and stable correlation. Cut domain is
`vibe.market-data.corporate-action-cut.v1\0`; bytes are schema, reserved, request identity/meaning, consumer tag,
window bounds, Owner-observation, decision cut, R0 cut identity/digest, Instrument Master and PIT cut digests,
instrument count, then each sorted instrument followed by action count and action-identity/fact-digest entries
sorted by effective start and action identity, then gap count and sorted gap instruments. Every requested
instrument appears exactly once. Zero actions is the canonical `u32BE = 0` census for that instrument, not a
missing row or `NO_ACTIONS`; a positive cut has zero gaps.

Receipt and readback domains are `vibe.market-data.corporate-action-receipt.v1\0` and
`vibe.market-data.corporate-action-readback.v1\0`; the outbox identity equals the receipt identity and has no
domain. Their exact layout, write-once caller-transaction custody, sealed resolution, rejoin, response-loss recovery, ACL and zero-write
failure rules are the shared native rules above. Replay V2 projects one fact one-to-one into its existing action
identity, instrument and term variant and repeats time/source/correction only after exact equality. Backtest
preserves the same native fact and cut identities/digests; neither consumer can normalize or synthesize terms.

## Replay Market Facts V2 foundation

**CURRENT / PARTIAL:** Market Data defines the additive, dependency-neutral `ReplayMarketFactsV2`
contract and canonical codec. One complete first-corpus cut contains typed, content-addressed calendar-day,
session-interval, time-zone ruleset, Market Semantics, successor-only correction-policy,
corporate-action and historical-membership facts; a universe-member cut contains the Market Semantics,
correction-policy and historical-membership facts, and the universe-member composition section below states where
the other four are proven. Every fact binds its half-open effective interval,
provider-available, retrieval, correction-publication and Owner-observation coordinates, decision cut,
Source identity and correction identity. Corporate actions carry their actual split, cash-dividend,
symbol-change, expiry or roll terms. Historical membership carries the exact selection, member,
instrument and inclusion disposition. A complete corporate-action or membership cut may contain zero
members, but that empty census is an explicit content-addressed cut over an exact scope and decision
cut; a string such as `NO_ACTIONS` is never equivalent.

A fact enters a Replay only while its effective interval overlaps the Replay window, only when its
provider-available, retrieval, correction-publication and Owner-observation coordinates are all at or before the
snapshot's observation instant, and only when its decision cut is at or before the snapshot's. A session meets one
more rule, and no stricter one: it shares at least one instant with the window, and one that does not is refused by
name as `SessionOutsideReplayWindow` (HTTP 422 `SESSION_OUTSIDE_REPLAY_WINDOW`). A session may open before the window
and close after it. Its boundaries are calendar facts scheduled in advance, not market observations, and a session
encloses the bars inside it, so reading where it closes before the window reaches that instant is not look-ahead. A
session fact carries four values - `session_identity`, `calendar_identity`, `opens_at_ns` and `closes_at_ns` - and
each is a schedule boundary known before the session opens. A revised session is a new fact version under its own
correction identity, and it meets the two checks every fact meets: availability by the snapshot's observation instant,
and a decision cut no later than the snapshot's. Those two checks, not the window, keep out a revision decided after
the snapshot.

The V2 frontier references the existing PIT Snapshot, Source Binding, Instrument Master cut, Universe
Selection, normalized observation census, V1 joined-cut receipt and V2 sample projection only by each
producer's exact identity and digest. It does not copy or reinterpret their canonical bytes and does
not create a second authority. The public request accepts only one untrusted PIT locator and a half-open
replay event-time interval. Facts, dependency references, censuses, canonical bytes and aggregate
digests enter only through Market Data-private authority. The resulting receipt and readback have no
public constructor or deserializer; the read port is crate-sealed. Verification recomputes every fact,
cut, frontier, aggregate and receipt encoding, then byte-compares all duplicated scalar projections so
canonical-byte, scalar-only and cross-splice drift fail closed.

**CURRENT/PARTIAL, W0/U/C custody seams:** the canonical DTOs/codecs, private issuance authority and sealed
readbacks are implemented. The Replay storage leaf also has candidate-private PostgreSQL schema and caller-transaction storage that
mechanically persists an already verified readback, rejects identity/meaning conflicts and corruption, and exposes
only the negative half of resolution; stored bytes cannot mint a positive readback. U adds caller-transaction
historical-membership and native Universe Selection custody. C adds caller-transaction custody for the complete
observation census and its exact, unchanged V1 joined-cut receipt. These leaves do not open or commit their own
pool, are not registered as a positive product composition, and do not turn an opaque dependency locator into
Owner authority.

**CURRENT/PARTIAL, W3 positive composition binding:** Market Data defines the additive sealed
`ReplayCompositionBindingV1` record, receipt and exact receipt-payload outbox plus one untrusted content-addressed
locator. Its canonical identity cross-binds the exact PIT request/snapshot and replay window, one authenticated
`StrategyDesignV2` identity, the sorted complete typed-role set, every durable-registry declaration and binding,
the complete observation census, the unchanged V1 joined cut, the V4 JOINED_CUT sample projection, and exact native
PIT, Source Binding, Universe Selection, Instrument Master and Market Semantics locators. W3 never accepts V2 or V3
in place of V4 JOINED_CUT. The additive
`UntrustedReplayMarketFactsCompositionRequestV1` contains only the existing Replay V2 request and that exact
binding locator. Positive issuance starts at that locator, authenticates and byte-verifies the complete binding,
requires every native and role/binding projection to match exactly, then reuses the existing Replay V2 issuer and
its unchanged canonical bytes, readback and seven-kind frontier. Replay storage meaning is additionally scoped by
the binding identity. Existing unbound rows remain negative-only: they are never backfilled, inferred, selected as
latest or discovered by a full scan.

**CURRENT/PARTIAL, universe-member composition binding:** the W3 binding above admits one shape
only, the exact-instrument first corpus, and a Design whose roles are universe members (scope `UniverseSelection`)
cannot be bound by it, so its Replay V3 request has no binding to carry. Market Data adds a second binding shape for
that Design and keeps the first byte for byte. The shape is carried by the record and never inferred: the first
corpus keeps schema `u16 = 1` and domain `vibe.market-data.replay-composition-binding.v1\0`; the universe-member
shape is schema `u16 = 2` under `vibe.market-data.replay-composition-binding.v2\0`, and the decoded record states its
shape. A record, claim or Replay frontier whose parts disagree with its shape is refused as a composition shape
mismatch. The universe-member shape binds the exact PIT request/snapshot and replay window, the authenticated
`StrategyDesignV2`, its complete sorted role set of universe-member roles with every durable-registry declaration
and binding, the exact native PIT, Source Binding, Universe Selection and Market Semantics locators, and the
universe frame Market Data derives from the request's PIT batch and that role set. It binds no observation census,
joined cut, V4 projection or native-join attestation: those exist to seal a joined cut, and the universe frame is
what shows that each (member, role) has exactly one value at the cut. It binds no Instrument Master either, for the
reason below, so neither the record, its Replay frontier nor the resolved composition cut carries an Instrument
Master for this shape. Issuance branches on the claim's shape before the native-join read. Replay V2 facts for this
shape carry the four-kind frontier PIT, Source Binding, Universe Selection and `StrategyInputUniverseFrameV1`; the
first corpus keeps its seven-kind frontier.

The durable declaration registry admits `UniverseSelection`-scoped declarations. Each is checked against the PIT
batch, its Source Binding and frontiers, the Owner-verified Universe Selection the batch names, the batch-level
Instrument Master coordinate and every Market Semantics field except the single-instrument Instrument Master
coordinate, and its Owner binding digest is the digest of that role's universe frame over the batch, which Market Data
derives itself. That per-role digest is not the universe frame the Replay frontier carries, which Market Data derives
over the Design's complete role set: the declaration's digest names what one role was bound to, the frontier's frame
is what R&D reads as `resolved_owner_inputs`, and nothing compares the two. A universe Design has no Instrument Master
authority to bind at composition time: its Instrument Master is the request-keyed V2 cut Market Data issues when R&D
first binds the sealed request for native execution. Instrument Master verification for universe roles therefore moves
to that cut's issuance, `issue_cut_for_bound_replay_v1`. It takes the members from the recovered selection's own
included membership, so the member set is the selection's by construction, and resolves each member's Instrument
Master V2 fact chain at the selection's owner observation time; a member with no fact at that time (`MissingFact`) or
a chain that does not verify (`ChainMismatch`) refuses the issuance by name with zero writes, and so does a member whose
V2 fact disagrees with the V1 readback the binding's PIT snapshot cites (`GenerationMismatch`, under the V1/V2
generation consistency rule below). Strategy Factory's
initial Owner inputs (`resolve_native_replay_initial_owner_inputs_v1`) then refuse a cut whose members disagree with
the Plan's selection. Between the two checkpoints no binding, fact or reader may claim or pass on an Instrument Master
field as verified. That a selection member without a verifiable Instrument Master fact refuses the issuance by name
with zero writes is asserted by the composition binding's Postgres proof that drives that issuance from a
universe-member binding.

What R&D reads from a binding and its Replay facts, and where each comes from in the universe-member shape:

| Read by R&D                                | First corpus                                         | Universe‑member shape                                                                       |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `resolved_owner_inputs`                    | observation census identity and digest               | universe frame receipt digest over the complete role set (BLAKE3, identity equal to digest) |
| `universe_selection`                       | Universe Selection dependency                        | the same Universe Selection dependency                                                      |
| binding locator                            | binding record                                       | the same binding record                                                                     |
| market data scope digest (`pit_scope`)     | resolved composition cut, from the PIT request scope | the same                                                                                    |
| PIT snapshot, window, request identity     | Replay facts header                                  | the same header                                                                             |
| Replay facts identity and receipt identity | Replay facts                                         | the same                                                                                    |
| Design identity, non‑empty role set        | binding record                                       | binding record; the role set is never empty                                                 |
| Instrument Master verification             | registry, per exact instrument                       | not bound at composition; each member's V2 fact chain when the request‑keyed cut is issued  |
| every dependency, exactly once             | the seven‑kind frontier                              | the four‑kind frontier: PIT, Source Binding, Universe Selection, universe frame             |

The `universe_selection` R&D reads is the Universe Selection Record's identity, which is also its digest. It is not the
strategy-input universe selection a Plan is bound under, which is derived from a frame batch's rows, and the two are
never equal. When Market Data issues a Replay's initial market readback it checks each against the frame's verified
batch. The strategy-input selection must be the universe derived from the batch's rows. The Record must be the batch's
`universe_selection_digest`, because intake admits a snapshot only for the Record its submission names. A Record that
differs is refused as `UniverseSelectionRecordMismatch`. No Record is read for this: the one batch already joins the
two keys.

The first corpus's Replay facts also carry seven reference cuts. A universe-member aggregate carries the three whose
authority it binds; each of the other four is proven where each member is resolved, not dropped:

| Reference cut         | First corpus, scoped by  | Universe‑member shape                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calendar              | Instrument Master V1 cut | relocated to each member's `BarScheduleFactV1`, which binds its calendar identity and which native Replay scheduling reads for every Master V2 member                                                                                                                     |
| Session               | Instrument Master V1 cut | relocated to the same `BarScheduleFactV1`, which binds its session identity                                                                                                                                                                                               |
| Time zone             | Instrument Master V1 cut | relocated to the same `BarScheduleFactV1`, which binds its time‑zone identity                                                                                                                                                                                             |
| Market Semantics      | Source Binding           | the same cut, scoped by the same Source Binding                                                                                                                                                                                                                           |
| Correction policy     | Source Binding           | the same cut, scoped by the same Source Binding                                                                                                                                                                                                                           |
| Corporate action      | Instrument Master V1 cut | relocated to the request‑keyed Instrument Master V2 cut: its only class is a closed crypto perpetual, which has no split, dividend, expiry or roll, and its issuance refuses a member of any other class by name as `MemberClassCarriesCorporateActions`, writing nothing |
| Historical membership | Universe Selection       | the same cut, scoped by the same Universe Selection; it also proves a rename, which Instrument Master V2 records as a new canonical instrument rather than a correction                                                                                                   |

The class refusal has no runtime input today, deliberately: it matches every class without a wildcard, so a class
added to Instrument Master V2 does not compile until someone decides there whether it carries corporate actions.

A stored Replay facts row states its shape in a `shape` column, and the named check `replay_market_facts_shape_v2`
keeps each row's columns to it: a first-corpus row has its joined cut and sample projection and no universe frame, and
a universe-member row the reverse and always a binding. The table reached that shape by a migration that reads the
catalog, changes only the exact legacy shape, backfills existing rows as the first corpus, and stops on any other
shape. `market_data_rd_api.lock_replay_market_facts_for_replay_v2` returns the shape and the frame; the `_v1` function
keeps its text byte for byte, because an R&D binary built before this shape compares every rd-api function's source
with its own before it reads anything. Such a binary cannot reach a universe-member row through `_v1`: it reads facts
only under a binding it has decoded, a universe-member row exists only under a schema 2 binding, and it refuses a
schema 2 binding as unknown before it reads any facts. Removing `_v1` waits until every deployed R&D binary reads
`_v2`.

The exact-instrument first corpus resolves its instrument through Instrument Master V1, whose projection cannot
construct a native crypto perpetual (`require_complete_native_crypto_perpetual_construction` always refuses), so no
exact-instrument shape can run the crypto perpetuals the user admitted; the universe-member shape is their route.
Built so far: the durable declaration registry admits a universe-member declaration as the paragraph above states,
binding it to its role's universe frame, and refuses a Design whose roles mix the two scopes or name more than one
selection. The paths that join single rows refuse such a declaration by name. Registration composes a universe-member
role against exactly the initial PIT request its Design's role intent names, and refuses by name, writing nothing, a
Design that names none, an unknown request, one whose digest differs, one whose head is not `AVAILABLE`, and one
requested for another Research request. Role-intent registration takes the reference from a schema 2 role intent, and
an attestation from its Design's published schema 2 role intent; a schema 1 intent, or a Design with no published
intent, names none, and its universe-member roles are refused as unnamed. A universe-member Design's custody is
re-read by `reread_persisted_strategy_input_universe_custody_for_update_v1`, which takes the exact re-read's claim and
locks, re-derives every role against its stored digest, and seals the universe frame of the complete role set;
`resolve_pit_request_for_strategy_design_v1` states the Design's declared scope, and each re-read refuses the other
scope's declarations by name. The ordered chain re-reads it as `rd_owner` and registers the Design before that
transaction opens, because registration writes through the Market Data pool while the re-reads hold locks it would
wait on. Replay facts of this shape are built: their four-kind frontier and three reference cuts, their storage
beside the first corpus's, the re-derivation of their universe frame from the PIT batch and a role set, the refusal of
facts whose shape is not their binding's, and the class refusal at the Instrument Master V2 cut. The binding of this
shape is built and issued. A locator-only `ReplayCompositionUniverseBindingIssuanceRequestV1`, on its own route
`POST /v1/replay-compositions/universe-member-issuances` and hashed under its own meaning domain
`market-data.replay-composition-universe-issuance-meaning.v1\0`, names the Composer attestation, the PIT request, the
Source Binding, the Universe Selection, the Reference Fact R0 record, Market Semantics and the correction policy, and
nothing else. Neither issuance body names a replay window, and one that does is refused at parse by
`deny_unknown_fields`. The Owner derives the window: from the event instant the snapshot's R0 record starts at, for one
execution bar - the bar the Source Binding declares for the label of the Design's execution role - and never past the
R0 claim. The execution role is the role the Design's joins trigger on, or, for a Design that declares no join, the one
role reading the BAR close; so the first corpus's joined `1M`, `1H` and session-day roles execute on the `1M` trigger.
This is Strategy Factory's rule (`derive_execution_role_v2`), read from the same Composer role-set projection, and
Strategy Factory is its authority: for every universe Design, where Strategy Factory defines the role, a Strategy
Factory test holds the two to the same role for the same Design. The joined first corpus - one exact instrument, a join
and three close roles - is outside that definition today, so this rule is its only definition; this is a coverage gap
that Strategy Factory slice T2 closes. **Decision point, owned by T2:** once T2 generalizes the execution role to joined
and multi-timeframe Designs, the role-set projection carries the execution role's identity, and Market Data reads that
role's label instead of deriving the role. A Design whose joins trigger on different roles, or that has no join and
several close roles, is refused as `EXECUTION_ROLE_AMBIGUOUS`; a label the binding declares no bar for as
`EXECUTION_TIMEFRAME_NOT_DECLARED`; and an
execution bar with no fixed length, or longer than the R0 claim, as `EXECUTION_BAR_EXCEEDS_R0_WINDOW`; each is
HTTP 422. A binding that declares no bars, or a Design with no BAR role, gets the event instant alone. The window rests on
the order PIT with R0, Market Semantics, the role declarations, then the schedule. It runs in the first corpus's two transactions and challenges without the
native-join read, and stores the schema 2 binding, its Replay facts and the issuance atomically. A retry returns the
stored bytes; an issuance identity is one namespace across both shapes and is recovered through the same resolve
route; and a Design with an exact-instrument declaration is refused by name as a composition shape mismatch, writing
nothing. Replay facts of this shape are stored only under the universe-member binding issued for exactly their
request, their native authorities and their frame. The resolved composition cut of this shape carries no Instrument
Master, and each Strategy Factory reader that needs one refuses it by name as `InstrumentMasterAbsentForUniverseShape`
(HTTP 422 `INSTRUMENT_MASTER_ABSENT_FOR_UNIVERSE_SHAPE`). A schema 2 binding keys the request's Instrument Master V2
cut exactly as a first-corpus binding does.

Each of the four locators the command names besides the PIT request and its Source Binding is fixed by the snapshot,
so a caller reads them rather than rebuilds them. `resolve_universe_member_composition_basis_v1` takes the snapshot
locator and the Source Binding locator and returns the Universe Selection the snapshot was minted over, the R0 record
the snapshot's own commit appended, the head of the snapshot's Market Semantics chain in the binding's compatibility
scope, and the correction policy projected from the binding and that R0 record. It checks each record as the issuance
does, runs in the caller's transaction, reads only and takes no row locks. It refuses by name a snapshot Market Data
does not hold as `AVAILABLE` (`PitUnavailable`), a snapshot minted under another binding (`SourceBindingMismatch`), a
binding it does not hold admitted (`SourceBindingUnavailable`), and a snapshot for which no Market Semantics fact has
been admitted yet (`MarketSemanticsNotAdmitted`); the issuance still re-derives and checks everything it is given.
Both this read and the scope-value read are Market Data code over six `STABLE` `SECURITY DEFINER` functions of
`market_data_rd_api`, granted to `rd_owner`, that only return stored rows: one snapshot, one Source Binding, one
Universe Selection, one R0 record, one Market Semantics readback, and a scope's heads.

**TARGET, durable R&D attestation seam:** the positive R&D Develop Composer transaction canonically persists one
immutable complete `StrategyDesignRoleSetReceiptV1` attestation together with the Composer aggregate, receipt and
outbox. It binds the
exact Research request, Composer aggregate and `StrategyDesignV2`, canonically ordered typed roles, every semantic
coordinate and complete role coverage. Its content-addressed exact locator is known before send. Replay Policy V2
composition is coordinated by the R&D-owned A1 across two Owner-isolated transactions. The fixed
`market_data_reader` opens a read-only transaction, acquires the Composer request's shared writer-key cut lock, calls
only the Composer Owner's locator-only `SECURITY DEFINER` lock/read functions, validates the complete canonical
evidence, and holds the transaction through the Market terminal decision. The Market Data Owner then opens one
SERIALIZABLE transaction, proves both connections share the same live primary, database, postmaster incarnation and
advisory lock manager, and the fixed `market_data_owner` login principal acquires the same shared Composer cut lock
before any Market lock or write. That principal retains raw authority only over its own `market_data_private`
relations and receives no raw Composer or R&D access. The Composer
writer must hold the matching exclusive lock before every mutation; therefore reader loss cannot reopen a mutation
window while the Market transaction retains the handoff lock. Neither principal receives the other Owner's raw-table
`SELECT` or DML, role membership, generic query surface, public positive constructor/deserializer, receipt/readback
input, bearer token, cryptographic-key authority, latest/history/full scan or cross-Owner parser. This boundary
guarantees stable Composer evidence during the guarded window and atomic Market writes; it does not claim a shared
XID, MVCC snapshot or cross-Owner atomic commit.

**TARGET / NOT_ADMITTED, sealed R&D Replay-request read:** before selecting an EVENT, the existing
`market_data_owner` SERIALIZABLE transaction resolves one exact request/meaning/receipt/seal locator through the
fixed R&D `lock_sealed_exploratory_replay_request_for_market_data_v1` facade. The facade and its V2/V1 verifier
chain are owned by the isolated `NOLOGIN`
`rd_exploratory_replay_api_owner`; Market Data receives only facade execution, no raw R&D relation grant or role
membership, while the routine owner has no table- or column-level mutation privilege. The caller retains a
request-scoped transaction advisory shared fence paired with the R&D
writer-exclusive fence, and SERIALIZABLE supplies the stable read snapshot. The returned request remains R&D
authority and supplies no event selector. Isolated PostgreSQL acceptance must still prove exact positive bytes,
request-fence retention, wrong-role/isolation/locator rejection, runtime replacement denial, controlled owner-drift
rejection and zero writes.

W3 issuance accepts only that untrusted R&D attestation locator plus exact Market dependency locators. Market Data
validates the recovered attestation internally, then independently re-resolves every durable registry declaration, the
complete observation census, unchanged V1 joined cut, V4 BAR JOINED_CUT sample projection, R0 and standalone Market Semantics record,
and requires the Market Semantics cut to name the exact recovered R0 cut. It never consumes `StrategyPlanV2` and has no
dependency on R&D. Binding record, receipt and receipt-payload outbox are persisted atomically with the
unchanged Replay V2 fact, receipt and outbox rows. Exact binding-locator recovery decodes, rehashes and cross-checks both
custody aggregates and returns their byte-identical payloads. Exact attestation-locator recovery after response loss
rejoins the pre-existing R&D attestation without append. No public boundary accepts a resolver, authoritative receipt or
readback, role list, count or token, and no caller representation can mint a positive role set.

**NOT_ADMITTED:** this target does not establish the R&D persistence/read function, its database ACL, registered W3
composition, disposable PostgreSQL Owner readback, deployment, production write, runtime or trading authority.

**TARGET:** admitted deployment and the isolated
disposable PostgreSQL acceptance must then prove exact replay, response-loss recovery, successor-only correction,
and the move-only R&D and Backtest consumer path.

**NOT_ADMITTED:** the implemented storage, custody and fixed API composition are not an admitted store,
isolated PostgreSQL acceptance, provider ingestion or authenticity proof, default product composition,
R&D or Backtest consumer, runtime execution, production write, deployment or trading authority. They
do not make the existing exactly-two-member Universe receipt a general Universe Selection Record, do not replace
the V1 joined-cut codec with a V2 codec, and do not permit Source Binding rule strings or a generic
`version = "v2"` label to stand in for a canonical fact cut.

## Instrument Master Owner contract

### Public Fact V2 native-projection foundation

**CURRENT/PARTIAL:** `InstrumentMasterFactV2` is an additive, effect-free public-fact kernel for the
first crypto-perpetual native projection. It does not reinterpret or alter any V1 fact, cut, receipt,
readback, database grammar, or stored byte. The fact carries canonical instrument/venue/raw-symbol
identity, a closed crypto-perpetual class, exact public contract terms, direct predecessor and positive
correction sequence, the original raw-snapshot provenance, the latest raw-delta provenance, canonical
bytes, and a domain-separated content identity.

V2 identity is `BLAKE3-256("VIBE_INSTRUMENT_MASTER_PUBLIC_FACT_V2" || 0x00 || bytes)`. Bytes are
big-endian and begin with schema `u16 = 2`, reserved `u16 = 0`, canonical identity, venue identity,
raw symbol, closed class, optional predecessor fact digest, correction sequence, baseline provenance,
optional latest delta, then the complete materialized term set in declared struct order. Text is
`u32 length || UTF-8`; digests are 32 bytes; optional tags are `0`/`1`; `FactValue` tags are respectively
`1 VALUE`, `2 UNBOUNDED`, `3 NOT_APPLICABLE`, and `4 UNAVAILABLE`; booleans are `0`/`1`; time and
decimal mantissas are signed `i128`. Unknown tags, nonzero reserved, trailing bytes, oversized text or
record, invalid UTF-8, zero provenance digest, or non-canonical decimal are rejected.

Each public term uses exactly one `FactValue`: `VALUE`, `UNBOUNDED`, `NOT_APPLICABLE`, or
`UNAVAILABLE`. The latter three states are distinct and may not be collapsed into `None`, zero, one,
false, or another constructor default. Decimal values are signed `i128` mantissa plus `u8` scale with
minimal trailing-zero representation and no floating point. The public fact deliberately excludes
maker/taker fees, initial/maintenance margins, account-specific commission schedules, leverage
brackets, and every execution-profile authority.

The only admitted source composition in this slice is a raw public `exchangeInfo` baseline followed by
zero or more raw public `!contractInfo` deltas. Each artifact binds the exact admitted Source Binding
identity/digest and raw payload digest. A delta additionally binds the canonical instrument, the prior
raw-event digest, the immediately next correction sequence, provider event time, retrieval time, Owner
observation time, and a field-wise patch. An omitted patch member preserves the baseline/materialized
value; a present member replaces the complete `FactValue`, including a non-value state. This first
delta grammar admits only the public contract-status member carried by `!contractInfo`; currencies,
inverse semantics, executable filters, multiplier, lot, and limits remain baseline-owned. Source,
instrument, raw predecessor, sequence, and observation-time mismatch reject the successor. Provider
`serverTime` is not event or provenance authority and is not stored. Price and quantity precision and
increments come from the executable price/lot filters, never display-precision fields. Baseline
`effective_from` is an explicit Owner-admitted coordinate independent of `serverTime`; native `ts_event`
uses that coordinate or the latest delta event time, and `ts_init` uses the matching Owner observation.

`validate_native_crypto_perpetual_public_terms` is the only V2 public/native validation constructor.
Its `ValidatedCryptoPerpetualPublicTermsV2` result has no public constructor and binds the exact fact,
identity mapping, Source Binding, baseline/latest raw provenance, correction sequence, timestamps, and
complete public structural terms. It fails closed unless contract status, inverse semantics,
base/quote/settlement currency, filter-derived precision and increments, contract multiplier, lot size,
and every optional limit disposition are explicit. `UNBOUNDED` or `NOT_APPLICABLE` may become an
explicit absent optional limit; `UNAVAILABLE` may not. Filter precision must equal its exact increment
scale. The token contains no maker/taker fee, initial/maintenance margin, commission, leverage bracket,
or execution-profile authority and never calls or constructs `InstrumentAny`.

R&D remains the sole owner of the one `ReplayExecutionProfileV1`. The logical Instrument
Owner now separately owns a private `InstrumentEconomicTermsFactV1` PostgreSQL path. Its fact binds the
exact public instrument identity/digest, venue, margin-account scope, half-open validity, source and
provenance, positive revision, quote/fee currency, positive exact maker/taker rates, positive exact
initial/maintenance rates, and one of two closed margin meanings. `STANDARD_NOTIONAL_RATE` is explicitly
`notional * rate` without leverage. `FIRST_BRACKET_NOTIONAL_RATE` is the same `notional * rate` for a position
whose notional is at most the fact's `margin_notional_cap`, a venue's first leverage bracket, and says nothing
about a larger position. Either may map only to native `StandardMarginModel`; V1 never guesses
`LeveragedMarginModel`. The cap is absent from a `STANDARD_NOTIONAL_RATE` fact's bytes, so those bytes are the
ones they were before the cap existed.

Fact and deterministic receipt are committed atomically. Repeating identical meaning and bytes performs
no write and returns the same locator and bytes. Recovery accepts only the exact fact-and-receipt locator,
revalidates canonical bytes, custody and ACL closure, and rejects missing, partial, conflicting,
cross-spliced or tampered storage before returning a move-only readback. This private fact is not generic
public Instrument Master truth and does not alter any V1 or public V2 bytes.

For initial Native Replay composition, Instrument Owner also maintains an Owner-private derived selection
index beside those canonical facts. One fixed read-only operation consumes the unforgeable
`InstrumentMasterReadbackV2`, the Replay profile's venue and common quote currency, and the sealed request
start event time. Instrument Owner derives both canonical member identities and public fact digests from
the Master V2 readback and derives the account scope from its own matching facts. It returns one exact
readback per member only when exactly one complete pair is valid under one shared account scope. Missing,
overlapping, corrupt, or multiple complete pairs are unavailable. The caller supplies no account scope,
economic-terms locator, latest selector, pool, or replacement store.

A custody run has no per-request Master V2 cut, so its sibling operation,
`resolve_unique_custody_run_members`, consumes the custody's verified `PitWindowChainBasisV1` instead. The members are
the ones the root custody bound, in its order. Each member's venue is checked against the basis's own Instrument
Master mapping before any terms are read. Without a V2 cut there is no expected public fact digest per member, so a
member's terms are linked by canonical identity and effective range alone. The same uniqueness rule then applies:
exactly one complete set, under one shared account scope. The returned readbacks name each member's public fact
digest, which a consumer resolves through `resolve_fact_v2` when it needs the V2 fact. The caller still supplies no
member, account scope or locator.

R&D may mint its move-only economic provenance only from that verified Owner readback and
must additionally match venue, account scope, event time, currencies and all visible economic profile
values. Market Data's public-fact module still neither imports R&D nor validates, copies,
selects, or issues replay economic values.

**CURRENT / PARTIAL, production Instrument Economic Terms intake:** one Owner-sealed admission port,
`InstrumentEconomicTermsAdmissionV1` in `owner/instrument_economic_terms_intake_v1.rs`, and one route,
`POST /v1/market-data/instrument-economic-terms`, guarded exactly as the Instrument Master V2 baseline intake is.
It is the only production writer of the private terms store above, and the API composes it only when both
`MARKET_DATA_OWNER_DATABASE_URL` and `INSTRUMENT_OWNER_DATABASE_URL` are configured: it reads the named
Instrument Master V2 fact and the clock head from Market Data's store, in one snapshot and without a row lock,
and issues the terms into the Instrument Owner's.

- **What the submission states:** the instrument's canonical identity (`LINKUSDT-PERP.BINANCE`), the identity
  of its admitted Instrument Master V2 fact, the account scope, and the exclusive end of validity. The account
  scope is the caller's statement, which the Owner cannot verify; the trust boundary is the credential that
  reaches the route.
- **What the Owner derives:** from the fact, the instrument, its public fact digest (the fact's identity, which
  the Native Replay resolver matches a cut member against), the venue, the quote currency, the fee currency
  (the settlement currency, which must equal the quote currency), the start of validity (the baseline's
  effective instant, its listing) and the source digest (the baseline's `raw_payload_digest`). From the
  module's own tables, the fees and margin: `BINANCE_USDM_VIP0_MAKER_FEE_V1` and
  `BINANCE_USDM_VIP0_TAKER_FEE_V1`, and the instrument's row of `BINANCE_USDM_FIRST_LEVERAGE_BRACKETS_V1`.
  Those constants are the only definition of the values, and their comments state each value's source and
  date. The `source_identity` is `ECONOMIC_TERMS_SOURCE_IDENTITY_V1`, which names the values as public defaults,
  not an account's own; the provenance digest binds the exact rows used; the revision is
  `ECONOMIC_TERMS_TABLE_REVISION_V1`; the meaning is `FIRST_BRACKET_NOTIONAL_RATE` with the row's notional
  cap.
- **The fees** are the regular user (VIP 0) schedule. The public fee pages answer an automated client with an
  empty challenge page, so the values rest on the user's confirmation, as the constant states.
- **The margin** is the first leverage bracket: its maintenance rate, and an initial rate of
  `1 / maxOpenPosLeverage` rounded up at the sixth decimal place, so that a rate base ten cannot state exactly
  is never understated. A position whose notional exceeds the row's `notional_cap` (10000 USDT for
  `LINKUSDT-PERP.BINANCE`) is margined by the venue at later brackets, which these terms do not record, and
  priced at the first bracket's rates its margin would be understated. The terms carry the cap, and the Native
  Replay execution refuses such a run as `ECONOMIC_TERMS_NOTIONAL_ABOVE_RECORDED_TIER` (Strategy Factory page).
- **The tables are maintained by hand.** The venue changes its brackets and fees without notice and nothing
  here notices. Adding an instrument is adding a row with its source; changing a value is a new revision,
  issued for a validity that does not overlap the earlier revision's, because the Native Replay resolver
  refuses an instrument with two facts valid at one instant. Keeping the rows current is an Instrument Owner
  task.
- **Refusals**, each with nothing written:
  - `ECONOMIC_TERMS_INSTRUMENT_FACT_UNAVAILABLE`: no fact with that identity is held for that canonical identity.
  - `ECONOMIC_TERMS_MARGIN_BRACKET_UNLISTED`: the table has no row for the instrument.
  - `ECONOMIC_TERMS_VENUE_NOT_ADMITTED`: the fact's venue is not `BINANCE`. The Instrument Master V2 venue
    table has only the Binance row today, so no admitted fact reaches this refusal yet.
  - `ECONOMIC_TERMS_CURRENCY_UNAVAILABLE`: the fact states no quote or settlement currency, or they differ.
  - `ECONOMIC_TERMS_VALIDITY_UNBOUNDED`: the end of validity is later than the last instant a signed 64-bit
    nanosecond count reaches, which is how `i128::MAX` or any other open value is stated.
  - `ECONOMIC_TERMS_VALIDITY_NOT_AFTER_CLOCK_HEAD`: the end of validity is not later than the decision cut of
    Market Data's clock head; a submission naming the head's own cut reaches it.
  - `ECONOMIC_TERMS_INVALID`: the derived terms do not seal, for instance for a blank account scope; the body
    states the reason.
  - `ECONOMIC_TERMS_MEANING_CONFLICT` (HTTP 409): terms with the same meaning are held with other bytes. The
    same submission again rejoins the same terms.

**CURRENT/PARTIAL, durable public V2 custody and fixed Native Replay resolution:** Market Data owns
the additive `InstrumentMasterFactV2` store, immutable content-addressed cut, atomic receipt/outbox, and
move-only exact-locator readback. The first consumer is the exact `BACKTEST_OWNER_V1` Native Replay vertical and
its cut contains exactly two distinct canonical crypto-perpetual instruments in canonical instrument-identity
order. Each entry binds the complete V2 fact bytes and identity, direct predecessor, correction sequence,
baseline/latest-delta provenance, Source Binding identities, venue/raw-symbol mapping, and the complete public
term set. V1 facts, cuts, receipts, readbacks, tables, codecs, and resolver behavior remain byte-for-byte
independent.

Cut issuance accepts only the fixed consumer role, the R&D-owned request identity and decision cut, and the exact
Owner-sealed two-member universe-selection readback. Market Data resolves the two public fact chains internally at
that cut and returns the new exact V2 cut locator/readback. The request cannot carry fact bytes, fact digests,
symbols, member order, a store/pool, or a latest selector. For initial composition only, the fixed resolver derives a
domain-separated request key from the canonical sealed R&D Replay request identity and resolves the unique cut under
that key. After R&D seals the returned four-coordinate cut locator into its request binding, later exact resolution
accepts that locator only.

That initial cut is issued when R&D first binds a sealed Replay request's native execution input, not during
replay-composition issuance: the composition binding comes first and the sealed R&D request names it, so the request
identity the key derives from does not exist while the binding is issued. The bound-replay issuance accepts only that
sealed request identity and the exact composition-binding locator R&D's own sealed V3 record carries. Market Data
recovers the Universe Selection that binding already bound, takes its decision cut, and in one Owner transaction
appends the cut together with a write-once record of which binding the request key was issued under. The same key and
binding again return the stored cut with zero append. The same key under a different binding is refused by name with
zero writes, even when both bindings share one selection, because the cut's own idempotency compares only the
selection. Market Data cannot verify that the identity names a sealed R&D request: the trust boundary is the fixed
writer process holding the Market Data owner credential, and a cut issued under the wrong binding is refused at R&D's
consumer, whose selection and member checks fail closed. The issuance commits separately from R&D's repeatable-read
binding transaction, so an R&D failure after the cut commits is retried and reuses the cut. It reads the binding and
the selection without row locks and never calls R&D, so it cannot wait on a lock R&D's open transaction holds; it
serializes with every other Instrument Master V2 write and resolve through the store's table locks, which each
transaction takes before its first read so that its snapshot already sees the previous holder's commit.

In one fixed Owner snapshot, the resolver must decode and rehash the
cut and both facts, prove exact membership and order, walk every direct-predecessor link back to the bound baseline
without a gap or branch, revalidate current store admission and reader ACL, and return one move-only readback. A
missing, extra, duplicate, reordered, noncanonical, cross-spliced, tampered, or ACL-drifted row returns no
readback. Exact-locator replay and response-loss recovery return byte-identical historical bytes with zero append;
same identity with different bytes conflicts. `resolve_fact_v2` reads one public V2 fact by its exact fact digest
under the same snapshot, ACL and ledger checks, returns it only after decoding and checking every link of its chain,
answers an unknown digest with `UnknownLocator`, and makes no point-in-time judgement, since the fact carries its own
time evidence and its consumer judges its use.

Fact/cut/receipt/outbox creation is append-only and failure-atomic. Only the fixed Market Data writer may create
or advance public V2 custody; the fixed consumer receives only `EXECUTE` on the exact resolver and no raw table
privilege. Market Data does not resolve private `InstrumentEconomicTermsFactV1`, Strategy Input universe frames,
BAR schedules, replay profiles, or the R&D request binding, and it does not assemble a cross-Owner execution-input
aggregate.

**NOT_ADMITTED:** this contract still claims no provider parser or call, authenticated ingestion, completed
migration, admitted default/production database write, registered product composition,
deployment, runtime execution, production effect, or trading. The private economic path does not elevate those
public-fact claims or construct a native instrument.

### Status and fixed consumer

**CURRENT/PARTIAL:** Market Data implements the native `InstrumentMasterFactV1`, `InstrumentMasterCutV1`,
write-once receipt/outbox, move-only `InstrumentMasterReadbackV1`, and sealed PostgreSQL resolver/recovery path
described below for the exact `BACKTEST_OWNER_V1` role. The PIT and Strategy Input product paths still carry a
request-supplied `instrument_master_digest` and compare it with an Owner-verified batch, which the admitted slice
below retires; the representative R&D path still freezes a data-Owner role string and an AAPL/MSFT
fixture. Those legacy provenance, role, and mapping paths do not replace the native authority and do not establish
product consumption of it.

**TARGET:** direct Backtest product consumption replaces the legacy digest and hard-coded R&D
role/mapping paths with the existing Owner-sealed resolution. R&D declares research scope and the Strategy
compiler consumes that resolution, but neither may query Instrument Master storage directly, maintain a
symbol-to-instrument or venue mapping, or synthesize a resolution.

Admitting that consumption is a change to this Owner's sealed read contract, not an access-control change.
The resolution Backtest would consume already exists, so the obstacle is not a missing function. Every
function in this Owner's outward read schema binds its permitted caller inside the sealed function itself,
not only through schema and execute privileges, and it is the sealed body that decides. A privilege grant
alone therefore opens nothing. A caller that holds the privilege but is not the bound caller receives an
empty result rather than a permission error, so at the call site an unauthorized reader and an absent fact
are indistinguishable, and a consumer whose contract treats a missing receipt as evidence will record a
data gap where the truth is a closed door. Any proposal to admit a second consuming Owner is sized by that
contract change and must state which caller binding it rewrites.

**CURRENT / PARTIAL, production Instrument Master V1 intake:** one Owner-sealed admission port and one route,
`POST /v1/market-data/instrument-master-facts`, through which Operations submits `InstrumentMasterFactProposalV1` for
the exact `BACKTEST_OWNER_V1` role; the Owner resolves and appends it through the unchanged write-once
fact/cut/receipt/outbox path, and a replayed proposal rejoins. The submission names the admitted Source Binding the
fact is observed under, and states no Market Semantics Compatibility identity, source frontier or correction
frontier: the Owner takes all three from that binding, deriving the scope as the Market Semantics admission derives
it, so no submission can state a scope no binding claims. A binding the Owner does not hold admitted under exactly
that locator is refused by name as `INSTRUMENT_MASTER_SOURCE_BINDING_UNAVAILABLE` (HTTP 409), and nothing is written.
In the same slice the PIT intake stamps `instrument_master_digest` from the Owner's own durable readback for the
request's instrument scope at its decision cut, so the request-supplied value becomes a claim the Owner overrides or
refuses, never a fact it copies. The isolated PostgreSQL chain proves both halves: a replayed submission rejoins its
fact, a member with no admitted fact mints no snapshot at all, and the persisted request carries the Owner's readback
digest rather than the caller's. Nothing beyond this intake and that stamp is claimed. **NOT_ADMITTED:** this status
does not claim provider ingestion or authenticity, deployment, Dashboard work, dynamic Backtest product acceptance,
inverse or quanto target-consumption semantics, or trading. BAR custody itself is instrument-class neutral when its
exact Instrument Master evidence supports the canonical fixed/session bar. A caller-carried digest, canonical-looking
string, static fixture, transport success, Owner-only test, or documentation check cannot claim product closure.

**CURRENT / PARTIAL, production Instrument Master V2 baseline intake:** one Owner-sealed admission port and one route,
`POST /v1/market-data/instrument-master-v2-facts`, through which Operations submits the raw public `exchangeInfo`
payload one instrument's first V2 fact is derived from. The route is guarded exactly as the V1 intake is: the request
must carry the Product Edge bearer token whose digest the API holds (`authorized(&headers, &state.token_digest)` in
`market_data_pit.rs`), and anything else is refused `UNAUTHORIZED_PRODUCT_EDGE` (HTTP 403) before the body is read. It is
the only production writer of `market_data_instrument_master_v2.facts`, which the request-keyed V2 cut reads, and it runs
in the Owner's own process as `market_data_owner`, as the V1 intake does. That role owns the schema and its six tables,
and the store asserts on every write that no other role holds a privilege on them, so the intake needs no grant and must
not be given one.

- **What the submission states:** the raw symbol, the class by its canonical word, the retrieval instant, the exact
  `exchangeInfo` text the terms are derived from (a complete response, or an envelope around the instrument's entry), and
  the admitted Source Binding the payload was retrieved under. It states no canonical
  identity, no venue, no terms, no effective instant, no digest and no Owner-observation instant. The only class
  word admitted is `CRYPTO_PERPETUAL`, the only class V2 has.
- **The Owner's venue table:** the named binding's `adapter.dataset_mapping`, compared as one exact string, selects a row
  of a closed table. Its only row is `usdm/exchangeInfo`, which gives venue identity `BINANCE`, inverse `false`, contract
  multiplier `1`, and the canonical identity as the raw symbol followed by `-PERP.BINANCE`. That form is byte for byte
  the one Instrument Master V1 perpetual facts use (`BTCUSDT-PERP.BINANCE` for the raw symbol `BTCUSDT`), and the one the
  inherited adapter's instrument identifier uses, so a submission cannot file one symbol's terms under another
  instrument. No prefix or segment of the string is interpreted, and the binding's endpoint identity is not
  used, because a mirror can change it without changing the product.
- **What the Owner derives from the payload:** it parses the bytes strictly and requires exactly one `symbols[]` entry
  whose `symbol` equals the raw symbol byte for byte and whose `contractType` is `PERPETUAL`. The effective instant is that
  entry's `onboardDate`, and every public term comes from its filters, through one function,
  `ExchangeInfoBaselineV2::from_usdm_exchange_info` in `owner/instrument_master_v2.rs`. That function is the only
  definition of the mapping below; this table describes it and does not define it.

  | V2 term                                                  | From the entry                                                                  |
  | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
  | effective instant                                        | `onboardDate`, milliseconds, as nanoseconds                                     |
  | base, quote, settlement currency                         | `baseAsset`, `quoteAsset`, `marginAsset`                                        |
  | contract status                                          | `status`, verbatim; a status other than `TRADING` is recorded, not refused      |
  | price increment                                          | `PRICE_FILTER.tickSize`                                                         |
  | quantity increment, lot size                             | `LOT_SIZE.stepSize`                                                             |
  | price, quantity precision                                | the scale of the canonical tick and step                                        |
  | minimum and maximum price                                | `PRICE_FILTER.minPrice`, `maxPrice`; `"0"` is `UNBOUNDED`                       |
  | minimum and maximum quantity                             | `LOT_SIZE.minQty`, `maxQty`; `"0"` is `UNBOUNDED`                               |
  | minimum notional                                         | `MIN_NOTIONAL.notional`; `"0"` is `UNBOUNDED`, an absent filter `UNAVAILABLE`   |
  | maximum notional                                         | `UNBOUNDED`: no filter caps an order's notional                                 |
  | venue, inverse, contract multiplier                      | the Owner's venue table row, not the payload                                    |

  A decimal is accepted only as digits with an optional fraction, canonicalized by removing trailing fractional zeros; an
  exponent, a sign or an empty string is refused. The quantity bounds are the limit-order bounds of `LOT_SIZE`;
  `MARKET_LOT_SIZE` is not mapped. The precisions are the canonical scales, so a tick of `"0.10"` has precision 1. The
  inherited Binance adapter (`crates/adapters/binance/src/common/parse.rs`) takes precision from the raw string, which
  gives two. The increments are equal and the difference is intentional: V2's native projection requires the precision to equal
  the canonical scale, and downstream Replay uses V2's. A parity test on the adapter's side asserts both the equal
  increments and this one difference.
  The maximum notional is the cap on one order, which is what native `max_notional` means. `exchangeInfo` states every
  order filter the venue applies and none caps notional, so the term is `UNBOUNDED`, as the adapter's `None` also says.
  The leverage brackets cap a position's notional at a leverage, per account. They are execution-profile authority, not a
  public term, and the public fact does not carry them. Stating the term `UNAVAILABLE` refused every USD-M perpetual at the
  native validation, which admits no `UNAVAILABLE` limit.
- **What the Owner takes itself:** the Source Binding identity and digest, from the binding it holds admitted under exactly
  the named locator; the raw payload digest, the module's domain-separated digest of the text's exact UTF-8 bytes, so no
  digest is taken on trust. It proves which bytes were submitted and that the terms were derived from them; it does not
  claim those bytes are the provider's complete original response, which the Owner cannot verify; the Owner-observation instant, which is the decision cut of its current clock head, read in the admitting
  transaction; the chain position, correction sequence 1 with no predecessor; and the terms basis
  `RetrievedTermsAssumedSinceListing`. The V2 fact binds no frontier: any reconciliation with a PIT batch's frontiers
  belongs to the cut, not to this intake.
- **The terms are assumed back to listing.** `exchangeInfo` states an instrument's terms as they are when it is retrieved.
  A baseline therefore observes its terms at `retrieval_time_ns` and assumes them over
  `[effective_from_ns, retrieval_time_ns)`: a tick or lot change between listing and retrieval is not represented, and a Replay over that
  earlier stretch uses the retrieved terms. This is a precision boundary for real-money research, not an error. The fact
  says so itself through its terms basis, which the readback and every member of a cut expose, so a report or
  Qualification can mark a Replay before the retrieval as priced on assumed terms. Recording an earlier change needs the
  correction intake, which is not admitted.
- **The clock:** the Owner-observation instant is the clock head's decision cut, the coordinate R&D's Universe Selection
  request carries as its own Owner-observation instant, so the cut's rule that a member fact is observable when its Owner
  observation is at or before the selection's compares two values from one clock. Two consequences follow.
  - The fact's own ordering requires the retrieval instant to be at or before its Owner observation. The head only
    advances when a Source Binding admission mints a newer clock; a PIT submission admits the current head's clock and
    does not move it. In production a baseline is admitted in this order: retrieve `exchangeInfo`, let a Source Binding
    admission advance the head past the retrieval instant, then submit.
  - At one decision cut, a cut issued before the admission and one issued after it answer differently: the first finds no
    fact, the second resolves it. A cut is written once per request key, so no single request ever changes its answer,
    but two requests at one coordinate can disagree when an admission falls between them.
- **Replay:** a submission whose derived fact equals the instrument's stored baseline, read at that baseline's own
  Owner-observation instant, rejoins it and returns the same terminal: the terminal carries the canonical identity, the
  fact identity, the Owner-observation instant and the terms basis, all of which the stored fact holds. The instant the Owner stamps is not part of what
  the caller means, so a replay after the clock has advanced still rejoins. Two identical submissions at once both
  answer with the one baseline, because the transaction takes the V2 store's table locks before it reads, as the status
  delta intake's does.
- **Refusals, each by name, with nothing written; each says how a submission reaches it today:**
  - `UNAUTHORIZED_PRODUCT_EDGE` (HTTP 403): a request without the Product Edge bearer token.
  - `MALFORMED_TYPED_REQUEST` (HTTP 400): a body that is not the submission, including any unknown field.
  - `INSTRUMENT_MASTER_V2_UNSUPPORTED_CLASS` (HTTP 422): any class word but `CRYPTO_PERPETUAL`, for example `EQUITY`.
  - `INSTRUMENT_MASTER_V2_UNSUPPORTED_VENUE` (HTTP 422): the named binding's dataset mapping has no row in the venue
    table, for example `coinm/exchangeInfo`.
  - `INSTRUMENT_MASTER_V2_DATASET_MISMATCH` (HTTP 422): the selected entry carries `contractSize`, the shape of a COIN-M
    entry, which contradicts the binding's dataset; the Owner refuses rather than choosing one.
  - `INSTRUMENT_MASTER_V2_SYMBOL_ABSENT` (HTTP 422): no `symbols[]` entry has the raw symbol.
  - `INSTRUMENT_MASTER_V2_SYMBOL_AMBIGUOUS` (HTTP 422): more than one entry has it.
  - `INSTRUMENT_MASTER_V2_CONTRACT_TYPE_UNSUPPORTED` (HTTP 422): the entry's `contractType` is not `PERPETUAL`, for
    example `TRADIFI_PERPETUAL` or a delivery contract.
  - `INSTRUMENT_MASTER_V2_ONBOARD_DATE_UNAVAILABLE` (HTTP 422): the entry has no `onboardDate`, or it is later than the
    retrieval instant.
  - `INSTRUMENT_MASTER_V2_FILTER_UNAVAILABLE` (HTTP 422): a required filter or field is absent, a filter type appears
    twice, or a decimal breaks the accepted syntax or is not positive where the term requires it.
  - `INSTRUMENT_MASTER_V2_INVALID_SUBMISSION` (HTTP 422): the payload is not a JSON `exchangeInfo`, or the derived fact
    fails its own validation, for example an empty raw symbol.
  - `INSTRUMENT_MASTER_V2_SOURCE_BINDING_UNAVAILABLE` (HTTP 409): no binding is admitted under exactly the named locator,
    for example a locator whose digest differs from the stored binding's.
  - `INSTRUMENT_MASTER_V2_RETRIEVAL_AFTER_OWNER_CLOCK` (HTTP 409): the retrieval instant is later than the current head's
    decision cut. It is reached by submitting before the head has advanced past the retrieval, and succeeds once it has.
  - `INSTRUMENT_MASTER_V2_BASELINE_EXISTS` (HTTP 409): the instrument already has a baseline with another meaning, for
    example the same symbol retrieved later with a changed tick. Terms retrieved again unchanged land here too: the
    retrieval instant and the payload digest are part of the fact, so a fresh retrieval is a different fact, not a replay,
    and an operator must not treat it as an idempotent retry. A baseline is never replaced here.
  - `MARKET_DATA_CLOCK_UNAVAILABLE` (HTTP 503): the Owner holds no clock head. No submission can construct it: the named
    binding is verified first, and a binding is only ever admitted together with the clock it was observed under, so a
    store that holds the binding holds a head. It remains a refusal rather than an assumption.
  - `INSTRUMENT_MASTER_V2_ADMISSION_CONFLICT` (HTTP 409): a fact with the computed identity is stored with other bytes.
    No submission can construct it, because the identity is the digest of the canonical bytes; it is reached only by
    altering a stored row, and it is refused rather than overwritten.
  - `MARKET_DATA_OWNER_UNAVAILABLE` (HTTP 503): the store is unreachable, refuses the commit, or fails its ownership and
    privilege assertion, as when another role has been granted a privilege on the V2 tables.
- **Proof:** the Market Data PostgreSQL runner proves the intake through production paths only. The clock is advanced by a
  production Source Binding submission, never by writing the head. The request-keyed cut for an instrument with no
  admitted fact refuses with `MissingFact`; after admission, the same cut, issued for a Universe Selection whose request
  carries the decision cut read after admission, resolves the admitted fact, and that member's terms basis is
  `RetrievedTermsAssumedSinceListing` and its canonical identity is `BTCUSDT-PERP.BINANCE`. The payload is the repository's real Binance USD-M `exchangeInfo` fixture, and the
  derived terms equal the expected values field by field. Replay rejoins, and each refusal a submission can reach is driven
  once by a payload or request built from that fixture.

**CURRENT / PARTIAL, production Instrument Master V2 contract-status delta intake:** one Owner-sealed admission port
and one route, `POST /v1/market-data/instrument-master-v2-status-deltas`, guarded exactly as the baseline intake is,
through which Operations submits one raw public `!contractInfo` event for an instrument that already has a V2 fact. The
Owner appends it as that fact's direct successor through `apply_contract_info_delta`, whose grammar changes the contract
status and nothing else. It is the second production writer of `market_data_instrument_master_v2.facts`, runs as
`market_data_owner`, as the baseline intake does, and needs no grant.

- **Only the status changes, by design.** `!contractInfo` carries the contract status, the listing and delivery instants
  and the leverage brackets; the fact admits the status alone. Brackets are execution-profile authority, which the public
  fact excludes, and tick, step, lot, multiplier, limits, currencies and inverse semantics stay baseline-owned. A status
  delta therefore never changes what a Replay is priced on, and it is not a correction of a baseline's terms; see
  NOT_ADMITTED below.
- **What the submission states:** the identity of the fact the event follows, which a baseline or an earlier delta
  terminal returned; the retrieval instant; the exact event text; and the admitted Source Binding it was received under.
  It states nothing the Owner derives.
- **What the Owner derives from the event:** it parses the text strictly as one JSON object whose `e` is `contractInfo`.
  `s` must equal the fact's raw symbol byte for byte, `ct` must be `PERPETUAL`, and `st`, when present, must be `1`, the
  USD-M system; `2`, COIN-M, contradicts the baseline's dataset. The provider event instant is `E`, milliseconds, as
  nanoseconds, and the contract status is `cs`, verbatim. Nothing reads `bks`, `dt`, `ot` or `ps`.
- **What the Owner takes itself:** the instrument, its canonical identity and its baseline from the named fact; the raw
  event digest, the module's domain-separated digest of the text's exact UTF-8 bytes; the prior raw-event digest and the
  next correction sequence from the named fact; and the Owner-observation instant, the decision cut of its current clock
  head read in the admitting transaction. The Source Binding must be admitted under exactly the named locator and must be
  the binding the instrument's baseline names.
- **Order:** the event instant must be later than the instant the named fact already knows the status at, and no later
  than the retrieval; the retrieval must be no later than the head's decision cut. A baseline knows the status as of its
  retrieval, since `exchangeInfo` states it as retrieved, not as listed; a delta knows it as of its event instant; a
  later `exchangeInfo` snapshot, admitted by the snapshot intake below, knows it as of its retrieval when it is the
  newest status evidence. An older event that arrives late, including one after the listing but before the baseline was
  retrieved, is refused rather than admitted over a newer status.
- **The chain:** the named fact must be the instrument's current head, so each delta states what it follows and two
  submissions cannot both extend one fact. A cut resolves each member's latest fact observed at its selection's Owner
  observation, so at one decision cut a cut issued before the delta's admission resolves the named fact and one issued
  after resolves the delta. As with the baseline, a cut is written once per request key, so no single request changes its
  answer.
- **Replay:** a submission whose derived fact equals the stored direct successor of the named fact, read at that
  successor's own Owner-observation instant, rejoins it and returns the same terminal, even after later deltas. Two
  identical submissions at once are no different: the transaction takes the V2 store's table locks as its first
  statement, before it reads anything, so the later one reads what the earlier one committed and rejoins it.
- **Known limit, one writer at a time.** The transaction is `SERIALIZABLE`, and its snapshot is taken by its first
  read, so the table locks come before it and every read sees what the previous lock holder committed. Those locks
  serialize every transaction on `market_data_instrument_master_v2`: both intakes, every cut issuance, the
  bound-replay issuance included, and every cut resolution, which takes the same locks, wait for one another. At
  today's volume of manual submissions that costs nothing; an hourly snapshot archiver would add to it. Revisit when the
  wait is measurable: when an intake, a cut issuance or a resolution is observed waiting on these locks for longer than
  one second.
- **The generation check is unchanged:** it compares no status, so a status delta neither causes nor clears a
  `GenerationMismatch`.
- **Refusals, each by name, with nothing written; each says how a submission reaches it today:**
  - `UNAUTHORIZED_PRODUCT_EDGE` (HTTP 403): a request without the Product Edge bearer token.
  - `MALFORMED_TYPED_REQUEST` (HTTP 400): a body that is not the submission, including any unknown field.
  - `INSTRUMENT_MASTER_V2_INVALID_EVENT` (HTTP 422): the text is not one JSON object whose `e` is `contractInfo`, or
    `E` is not a non-negative integer, or `cs` is not a status text the fact can hold.
  - `INSTRUMENT_MASTER_V2_EVENT_SYMBOL_MISMATCH` (HTTP 422): `s` is not the fact's raw symbol.
  - `INSTRUMENT_MASTER_V2_CONTRACT_TYPE_UNSUPPORTED` (HTTP 422): `ct` is not `PERPETUAL`.
  - `INSTRUMENT_MASTER_V2_DATASET_MISMATCH` (HTTP 422): `st` is present and not `1`.
  - `INSTRUMENT_MASTER_V2_EVENT_AFTER_RETRIEVAL` (HTTP 422): the event instant is later than the retrieval instant.
  - `INSTRUMENT_MASTER_V2_STATUS_UNCHANGED` (HTTP 422): `cs` is the fact's current status. The event changed only what
    the fact does not hold, such as the brackets, so there is nothing to record. A collector fed the whole stream meets
    this on every bracket update and should treat it as an expected skip that no retry changes, not as a failure.
  - `INSTRUMENT_MASTER_V2_EVENT_OUT_OF_ORDER` (HTTP 409): the event instant is not later than the instant the named fact
    knows the status at: the latest of its baseline's retrieval, its latest delta's event and its latest snapshot's
    retrieval.
  - `INSTRUMENT_MASTER_V2_PREDECESSOR_UNKNOWN` (HTTP 409): no V2 fact has the named identity.
  - `INSTRUMENT_MASTER_V2_PREDECESSOR_NOT_CURRENT` (HTTP 409): the named fact already has a successor with another
    meaning, for example after another event was admitted first.
  - `INSTRUMENT_MASTER_V2_SOURCE_BINDING_UNAVAILABLE` (HTTP 409): no binding is admitted under exactly the named locator.
  - `INSTRUMENT_MASTER_V2_SOURCE_BINDING_MISMATCH` (HTTP 409): the binding is admitted but is not the one the
    instrument's baseline names.
  - `INSTRUMENT_MASTER_V2_RETRIEVAL_AFTER_OWNER_CLOCK` (HTTP 409): the retrieval instant is later than the current head's
    decision cut; it succeeds once the head has advanced past it.
  - `MARKET_DATA_CLOCK_UNAVAILABLE` (HTTP 503): the Owner holds no clock head. No submission can construct it, for the
    reason the baseline intake states.
  - `INSTRUMENT_MASTER_V2_ADMISSION_CONFLICT` (HTTP 409): the successor derived from the named fact is not one that fact
    can take, as when the head's decision cut is earlier than the named fact's Owner observation. No submission can
    construct it: the delta is built from the named fact itself, and the head only advances while the named fact was
    observed under an earlier head.
  - `MARKET_DATA_OWNER_UNAVAILABLE` (HTTP 503): the store is unreachable, refuses the commit, or fails its ownership and
    privilege assertion, or the named fact's chain does not decode, as when a stored row has been altered: every fact in
    the chain is re-encoded and rehashed before anything is derived from it.
- **Proof:** the Market Data PostgreSQL runner proves the intake through production paths only. The baseline is admitted
  through the baseline intake from the recorded `exchangeInfo` fixture, and the clock is advanced by production Source
  Binding submissions. The event is built in the provider's documented `!contractInfo` shape for the fixture's symbol;
  no captured event exists in the repository, which the proof says. Before the delta's admission a cut resolves the
  baseline, and after it a cut resolves the delta with its status. A replay after a second delta rejoins, and each
  refusal a submission can reach is driven once, with the store unchanged, including an event after the listing and no
  later than the baseline's retrieval. A second proof holds the clock head row until two identical baseline submissions,
  and then two identical deltas, both wait on a lock, and each pair answers with one fact.

**CURRENT / PARTIAL, production Instrument Master V2 `exchangeInfo` snapshot intake:** one Owner-sealed admission port
and one route, `POST /v1/market-data/instrument-master-v2-snapshots`, through which the archiver or Operations submits a
later raw `exchangeInfo` payload for an instrument that already has a V2 fact. The Owner appends it as that fact's
direct successor, a snapshot successor, through `apply_exchange_info_snapshot`. It is the third production writer of
`market_data_instrument_master_v2.facts`, runs as `market_data_owner` and needs no grant. This is the first slice of the
TARGET below: window selection at the cut and the archiver are not built.

- **What the submission states:** the identity of the fact the snapshot follows, the retrieval instant, the exact
  payload text and the admitted Source Binding it was retrieved under, which must be the one the instrument's baseline
  names. It states nothing the Owner derives.
- **What the Owner derives:** every term through the baseline's own mapping,
  `ExchangeInfoBaselineV2::from_usdm_exchange_info`, for the fact's raw symbol and the venue row of the binding's
  dataset. The payload's `onboardDate` must be the baseline's: another listing is not a later snapshot of this one. The
  record the fact keeps is the payload digest, the retrieval and the Owner observation; the binding is the baseline's
  and is not repeated.
- **Two orders.** Snapshots are ordered among themselves: a retrieval must be later than the fact's latest snapshot, or
  its baseline. The contract status has one order across deltas and snapshots, the instant the fact knows the status at,
  the latest of its baseline's retrieval, its latest delta's event and its latest snapshot's retrieval. The payload's
  status becomes the fact's only when the snapshot is later than that instant; otherwise the fact keeps its newer status
  and the snapshot records its terms only, so a snapshot is never refused because a newer status arrived first. A status
  delta after a snapshot must be later than that same instant, the status instant boundary the TARGET below names.
- **The terms basis.** A snapshot whose terms, the status aside, equal those of the fact it follows keeps the basis
  `RETRIEVED_TERMS_ASSUMED_SINCE_LISTING`: the terms are still the baseline's, now also observed later. One whose terms
  differ gives the fact, and every fact after it, `OBSERVED_SINCE_TERMS_CHANGE`, since what held before that snapshot is
  not these terms. The terminal says whether the snapshot changed the terms. A snapshot does not move the fact's event
  instant, which the native instrument definition carries as `ts_event`: that stays the latest status delta's event, or
  the listing, because a snapshot records when it was retrieved, not when anything changed.
- **The cut refuses a changed member until it selects by window.** A cut reads no Replay window yet, so it cannot tell
  whether a window lies before or after a change. It refuses a member whose fact observed at the selection has the basis
  `OBSERVED_SINCE_TERMS_CHANGE` with `TermsChanged` and zero writes, and R&D's execution-input binding answers
  `INSTRUMENT_MASTER_TERMS_CHANGED` (HTTP 409); no retry changes it. Window selection is the only slice that removes
  this refusal. A member whose snapshots all repeat the baseline's terms resolves as before, on its latest fact.
- **The clock.** When the head's decision cut is at or after the retrieval, the snapshot's Owner observation is that
  cut. Otherwise the intake mints the next Owner clock from its own wall observation, as a Source Binding admission
  does, and admits it in the same transaction through the path a Source Binding admission uses, so the head moves only
  if the fact is appended; the snapshot's Owner observation is the minted cut. A retrieval later than that wall
  observation is refused. The transaction is read committed and takes the clock-state lock before it reads the head, as
  every other clock writer does, so a snapshot that mints and a Source Binding admission at once answer one after the
  other. A clock head needs no owner fact to anchor it: the clock custody checks read only the clock tables. A PIT
  submission R&D froze at the previous head is then refused as `ClockEvidenceNotCurrent`, as after any Source Binding
  admission.
- **One writer at a time and replay.** The transaction takes the V2 store's table locks as its first statement, as both
  other intakes do. A submission whose derived fact equals the stored direct successor of the named fact, read at that
  successor's own Owner observation, rejoins it and returns the same terminal; a rejoin never mints a clock.
- **F is unchanged.** Facts without a snapshot keep their encoding byte for byte: the snapshot successor is a third
  lineage tag, and the baseline and status-delta tags are untouched. A unit test pins a baseline from the recorded
  payload (414 bytes), its status successor (669 bytes) and a one-member cut over the baseline, read from the tree
  before snapshot successors existed, beside the existing two-member cut pin.
- **Refusals, each by name, with nothing written; each says how a submission reaches it today:**
  - `UNAUTHORIZED_PRODUCT_EDGE` (HTTP 403) and `MALFORMED_TYPED_REQUEST` (HTTP 400), as on the other V2 routes.
  - `INSTRUMENT_MASTER_V2_INVALID_SUBMISSION` (HTTP 422): the text is not an `exchangeInfo` object.
  - `INSTRUMENT_MASTER_V2_SYMBOL_ABSENT`, `_SYMBOL_AMBIGUOUS`, `_CONTRACT_TYPE_UNSUPPORTED`, `_DATASET_MISMATCH`,
    `_ONBOARD_DATE_UNAVAILABLE` and `_FILTER_UNAVAILABLE` (HTTP 422): the baseline intake's own mapping refuses the
    payload, for the reasons and by the payloads the baseline intake states.
  - `INSTRUMENT_MASTER_V2_LISTING_DIFFERS` (HTTP 422): the entry's `onboardDate` is not the baseline's.
  - `INSTRUMENT_MASTER_V2_SNAPSHOT_OUT_OF_ORDER` (HTTP 409): the retrieval is not later than the fact's latest snapshot,
    or its baseline.
  - `INSTRUMENT_MASTER_V2_PREDECESSOR_UNKNOWN` and `_PREDECESSOR_NOT_CURRENT` (HTTP 409), `_SOURCE_BINDING_UNAVAILABLE`
    and `_SOURCE_BINDING_MISMATCH` (HTTP 409), as for a status delta.
  - `INSTRUMENT_MASTER_V2_RETRIEVAL_AFTER_OWNER_CLOCK` (HTTP 409): the retrieval is later than the Owner's own wall
    observation.
  - `INSTRUMENT_MASTER_V2_CLOCK_MISMATCH` (HTTP 409): the head is not one the Owner's clock can succeed. No production
    head is: every cut is minted under the Owner's identity and epoch, the chain's market base included since it was
    sealed on the Owner's clock. The proof drives it with a head on a test clock.
  - `MARKET_DATA_CLOCK_UNAVAILABLE` (HTTP 503): the Owner holds no head, or its wall clock has not passed the head. No
    submission can construct it: a baseline exists only under a head, and the head is the Owner's own earlier wall
    observation.
  - `INSTRUMENT_MASTER_V2_ADMISSION_CONFLICT` (HTTP 409): the store disagrees with itself about the named fact. No
    submission can construct it.
  - `MARKET_DATA_OWNER_UNAVAILABLE` (HTTP 503): the store is unreachable, refused the commit, or a stored chain does not
    decode.
- **Proof:** the Market Data PostgreSQL runner proves the intake on bindings committed on the Owner's own clock, sealed
  by the production sealer. A snapshot retrieved after the head mints exactly one clock and takes its cut, and one
  retrieved before takes the head's. Ten reachable refusals each write neither a fact nor a clock, one of them after the
  intake chose to mint. A snapshot later than the known status sets it. A snapshot that widens the tick is recorded with
  the changed basis, after which the cut refuses the member and writes nothing while the cut issued before keeps its
  answer. A replay rejoins and mints nothing, and a later snapshot mints again. A second proof refuses a snapshot past a
  head on a test clock as `CLOCK_MISMATCH` with nothing written. A third holds the clock-state lock while a Source
  Binding admission and then a minting snapshot queue for it, and both answer; with the head's row lock taken first, as
  the intake first did, they deadlock. Two identical minting snapshots at once mint once and answer with one fact. Unit
  tests cover the codec, both orders, the basis, every normalizer and successor refusal, and a year of hourly snapshots
  decoded as one chain.

**NOT_ADMITTED:** a change to a V2 fact's executable terms is recorded, by the snapshot intake, but no Replay is priced
on it: the status delta changes the contract status only, by design, and the cut refuses a member whose terms a snapshot
changed until it selects by the Replay window, which the TARGET below describes and which is not built. Whether a Replay
over a window whose status is not `TRADING` must be refused is not decided; nothing refuses one today. No V1 fact is
derived into V2, no class but the crypto perpetual and no venue outside the Owner's table is admitted, and nothing here
claims provider ingestion, authenticity, deployment or trading. No intake compares a V2 fact with any V1 fact; the cut
that reads both does, as the next paragraph states.

**CURRENT, V1/V2 generation consistency:** while both generations are in use, one instrument is described in each. A PIT
request names the V1 Instrument Master readback its snapshot was cut under (`instrument_master_digest`), and Market
Semantics admission, first-corpus Replay composition and R&D's research scope read that V1 readback; the Native Replay
binding reads the request-keyed V2 cut. The two must describe the same instruments, and the bound-replay issuance proves
they do before it writes anything. In its own transaction it follows the binding's PIT snapshot locator to the V1
readback that snapshot's request cites, reading both without a row lock, and compares that readback member by member
with the V2 facts it has just resolved for the cut:

- the member sets are equal: the V1 readback's facts and the cut's members name the same canonical identities;
- each V1 fact is classed `CryptoPerpetual`, the one class V2 has;
- each V1 fact has exactly one mapping whose venue identity equals the V2 fact's venue identity, and that mapping's source
  instrument is byte for byte the V2 raw symbol;
- the V2 price increment, quantity increment and contract multiplier are each a value, and each equals the V1 term in
  both mantissa and scale. Both generations store a decimal canonically, without trailing fractional zeros, so equal
  values have equal mantissa and scale and nothing is normalized.

A difference refuses the issuance with `GenerationMismatch` and zero writes, and R&D's execution-input binding answers
`INSTRUMENT_MASTER_GENERATION_MISMATCH` (HTTP 409): the cut's facts are fixed at the selection's observation, so a retry
cannot change the answer. Internally the refusal names the rule that failed: the member set, the class, a venue mapping
that is absent or ambiguous, the raw symbol, or a named term that is not a value or differs; R&D records it under the
issuance's storage-diagnostic coordinate. A V2 term that is `UNAVAILABLE`, `UNBOUNDED` or `NOT_APPLICABLE` is refused
rather than skipped, because a V2 fact that cannot vouch for a tick, step or multiplier the V1 fact states must not be
used beside it; no V2 fact reaches this today, because the intake's mapping always gives those three terms a value. No
other term is compared: currencies, lot, limits and status have no V1 counterpart in V2's form, and
V1's calendar, session and frontier fields have none in V2. The check sits at the cut, not at either intake, because the
cut is where the two generations are read together: a V1 fact corrected or admitted after the V2 fact is still compared.

It runs on every bound-replay issuance, the only production path to the V2 cut. The Market Data PostgreSQL runner drives
both outcomes through bindings whose PIT snapshots cite a stored V1 readback. The universe-member composition binding over
the chain market base, whose one V1 instrument is an equity, is refused by class and writes nothing. The bound-replay
issuance proof issues its cuts over PIT snapshots taken by the production PIT intake, whose V1 facts the production V1
intake admitted to agree with the V2 facts, and one member's V1 fact with a different tick is refused by that term. Each
rule's refusal is asserted once on the comparison itself.

**TARGET, effective-dated V2 terms from archived `exchangeInfo` snapshots:** the snapshot successor and its intake are
built, as the CURRENT / PARTIAL paragraph above states; window selection at the cut and the archiver are not admitted
and not built. A V2 fact records terms observed at one retrieval and assumed back to listing, and the cut takes each
member's latest fact observed at its selection, so a tick or lot change is never representable and a Replay before the
retrieval is priced on the terms of the day it was retrieved. This design replaces that one assumption with evidence,
and admits no other.

- **Why, measured, and when: after U1.** On Binance's public USD-M endpoints, BTCUSDT's tick is 0.10 today, so its
  canonical price precision is 1, while its 2021-06-01 daily bar opened at 37244.36; SOLUSDT's tick is 0.0100,
  precision 2, while its 2021-06-01 bar opened at 32.749. Fed to the execution bundle on today's tick, that BTC bar
  refused the whole bundle by name. Until this lands, a Replay runs each member at the finer of its tick and its
  window's data, and states which it used (`docs/architecture/strategy-factory.md`); an order then rounds to the
  data's grid, not to the venue's tick at the time, which only this history can supply.

- **Evidence is an archived snapshot and nothing else.** Every term the Owner holds for an instrument is derived by
  `ExchangeInfoBaselineV2::from_usdm_exchange_info` from an `exchangeInfo` payload retrieved at a stated instant. No
  submission states a historical term. Letting one would put caller-stated terms back behind the trust boundary the
  baseline intake closed, which needs the user's authorization.
- **A snapshot series.** Each admitted snapshot of an instrument is one fact `S_i` with its retrieval instant `t_i`, its
  payload digest and its derived terms `T_i`; the baseline is `S_0`. A later snapshot is a new successor kind in the
  same linear chain a `!contractInfo` delta extends, so each still names the fact it follows. Its encoding is additive:
  a baseline's bytes, and so its identity, do not change. Every snapshot is recorded, including one whose terms equal
  the head's, because an unchanged snapshot is the evidence that nothing changed before it.
- **Two orders on one chain.** Snapshots are ordered among themselves by retrieval: a snapshot must be retrieved later
  than the fact's latest snapshot, or its baseline. The contract status has one order across both kinds, the instant the
  fact knows the status at: its baseline's retrieval, its latest delta's event, or its latest snapshot's retrieval,
  whichever is latest. A snapshot also states the status. It becomes the fact's status when the snapshot is later than
  that instant, which then moves to its retrieval; otherwise the fact keeps the newer status it already holds, and the
  snapshot records its terms only. So a snapshot is never refused because a newer status arrived first, and a fact's
  status is always the newest the Owner has evidence of. A `!contractInfo` event no later than that instant is refused,
  as the status instant boundary below states.
- **What the series lets the Owner say**, over the terms compared, which are every public term but the contract status:

  | Interval                                            | The terms there                                                      | Basis                               |
  | --------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------- |
  | before `t_0`                                        | `T_0`, assumed back to listing                                       | `RetrievedTermsAssumedSinceListing` |
  | `[t_i, t_j]`, every snapshot in it with equal terms | equal at every snapshot bounding it, taken as unchanged between them | `EqualAtAdjacentSnapshots`          |
  | `(t_i, t_{i+1}]` with `T_i` unequal to `T_{i+1}`    | unknown: the change fell somewhere inside                            | none                                |
  | after the latest snapshot `t_n`                     | `T_n`, assumed forward                                               | `RetrievedTermsAssumedForward`      |

- **Named property, the archive precision boundary.** Two adjacent snapshots with equal terms are taken to mean the
  terms did not change between them. A change and its reversal inside one archive interval cannot be seen, and that
  interval is the archiver's cadence: a longer cadence makes the boundary coarser, and the unknown interval around a
  real change is as long as one cadence.
- **Named property, the status instant boundary.** A `!contractInfo` event no later than the instant the fact knows the
  status at is refused as `INSTRUMENT_MASTER_V2_EVENT_OUT_OF_ORDER`, as the status delta intake already refuses an event
  older than what the fact knows; a snapshot later than the event now also sets that instant. When a snapshot is
  admitted before an earlier event reaches the Owner, the event's status is not lost, since the snapshot observed the
  status after it, but its exact instant is: the Owner then knows only that the status changed within the archive
  interval before that snapshot. The boundary is as coarse as the cadence, and a status collector that delivers each
  event within one cadence never meets it.
- **The cut chooses by the Replay window.** The bound-replay issuance already recovers the composition binding, whose
  record carries the window. Per member, among the facts observed at the selection, a window whose intervals all have a
  basis takes the fact that opens the interval holding the window's start, with the weakest basis among the intervals
  the window meets, where assumed is weaker than equal-at-snapshots; those intervals all hold the same terms, since any
  change between them is an unknown interval. The cut still holds one fact per member, so no consumer changes. A window
  that meets an unknown interval is refused with `TermsChangeWithinWindow` and zero writes, and R&D's execution-input
  binding answers `INSTRUMENT_MASTER_TERMS_CHANGE_WITHIN_WINDOW` (HTTP 409); no retry changes it. The V1/V2 generation
  check compares the fact the window selected, so a V1 fact that was not corrected to match is refused by name as it is
  today. A cut is written once per request key, as every cut is: one issued on assumed-forward terms keeps that answer
  after a later snapshot shows them to have changed, and a later request issues a new cut.
- **Growth, and when to compress.** A baseline fact measures 414 canonical bytes. A snapshot successor carries the
  baseline's bytes, its predecessor's identity and a 107-byte record, 553 bytes in all, and about 220 more once a status
  delta is in its chain. At the default hourly cadence an instrument gains 24 facts a day, 8,760 a year, about 4.8 MB a
  year before row overhead. Every cut and every successor admission decodes the member's whole chain, so the cost grows
  with its length: a year of hourly snapshots of one instrument decodes, fact by fact against its predecessor, in about
  20 ms in a release build on a development machine and 120 ms unoptimised. The trigger for compressing runs of
  equal-terms snapshots is the chain length at which issuing one member's cut takes longer than one second, measured
  again on the Linux runner when a member's chain passes a year.
- **The archiver.** A dedicated service, `market-data-exchange-info-archiver`, run from the R&D Owner API image in the
  Market Data Owner's process and credential, admits snapshots through the Owner port, not through Product Edge and not
  through Source Intake, which is unimplemented in production. It retrieves USD-M `exchangeInfo` from the same named
  host as the R&D Owner API's Binance perpetual PIT client (`BINANCE_PERPETUAL_PIT_BASE_URL`), hourly by default, and
  for each instrument with a baseline admits that instrument's entry, sliced byte for byte into a minimal envelope,
  under the baseline's Source Binding.
- **The snapshot intake advances the Owner clock itself.** Today the head moves only when a Source Binding admission
  mints a newer clock, and nothing does so on the archiver's cadence, so a snapshot retrieved after the head could wait
  indefinitely. When the head's decision cut is earlier than a snapshot's retrieval, the intake mints the next clock
  admission from the Owner's own wall observation, as a Source Binding admission does, and commits it with the fact in
  one transaction; the snapshot's Owner observation is that cut. A retrieval later than the Owner's own wall observation
  is refused. The head therefore moves at most once per archive interval. A PIT submission R&D froze at the previous
  head is then refused as `ClockEvidenceNotCurrent` and recovered by reading its correlation back and freezing again at
  the current cut, as after any other move of the head; a run that has to freeze again repeatedly is the signal to
  lengthen the cadence. That recovery is driven today only with the refusal injected at an unchanged cut: the ordered
  chain's database is shared and never reset, so no entry there moves its head between a freeze and a commit for the
  entries after it. The archiver is therefore not turned on until a proof on a database of its own mints a head with the
  Owner's clock, lets R&D freeze, advances the head through a production admission, and shows R&D recovering and
  committing at the new cut. The archiver retries a refused or unanswered submission in retrieval order, and its health
  check fails when the newest admitted snapshot is older than two cadences, a condition the archiver can now clear
  itself.
- **F is unchanged.** With one baseline and no later snapshot, every window before its retrieval lies before `t_0`, the
  member is the baseline with its current basis, and its bytes do not move; the snapshot intake's slice pins a baseline,
  its status successor and a one-member cut byte for byte, beside the existing two-member cut pin.
- **Order.** The snapshot successor and its intake came first, with the byte-for-byte pin, and are built. Until the cut
  selects by window, it refuses by name a member whose fact observed at the selection follows a snapshot that changed
  its terms, rather than price any window on them; the window selection is the only slice that removes that refusal.
  Window selection at the cut changes the issuance F's chain relies on, so it starts only after F's chain passes. The
  archiver is defined but not started, as the compose file does not run the store-custody script yet; running it makes
  production retrieve from Binance periodically, a public read and no trading, and turning it on is the user's
  deployment decision. Whether a Replay window whose status is not `TRADING` must be refused is undecided and outside
  this design.

### Native immutable records

`InstrumentMasterFactV1` is an immutable effective-dated fact. It contains all of the following, with no
consumer-owned substitution:

- its canonical instrument identity and optional exact predecessor fact digest;
- venue and source mappings; instrument class; base, quote, settlement and margin currencies as applicable;
- price increment, quantity increment and contract multiplier, each encoded as signed `i128` mantissa plus an
  explicit decimal scale, with no floating-point representation;
- trading calendar, session and time-zone identities;
- lifecycle, corporate-action, historical-membership, Market Semantics Compatibility, source and correction
  frontiers;
- one half-open effective interval `[effective_from, effective_until)`, where an absent upper bound means open,
  not latest; and
- provider-available, retrieval, correction-publication and Owner-observation coordinates, plus the exact clock
  identity/epoch/sequence, decision cut and complete sealed clock-head projection used to admit the observation.

`InstrumentMasterFactV1` and `InstrumentMasterCutV1` each declare the existing canonical
`timeEvidenceCutKind` `MARKET_DATA_AS_OF`; no new Time Evidence kind is created. Each fact and cut binds the complete
projection of the existing sealed clock-head handoff that admitted it: head identity and digest, clock identity and
epoch, monotonic sequence, wall observation, decision cut, exclusive `valid-through`, restart-continuity digest,
uncertainty and skew bounds, and the comparison rule. A new epoch additionally binds the one direct immutable Epoch
Successor Proof identity and digest resolved with that head; absence is canonical only when no epoch transition was
consumed. These fields remain inside the fact and cut domains and create no fifth identity domain.

Within a fact, provider-available, retrieval, correction-publication and Owner-observation coordinates all bind its
one exact sealed head. Within a cut, Owner-observation time and decision cut bind its one exact sealed head. The only
comparison rule is `SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1`: the cut head must be the exact current Owner-resolved head
at commit, its identity/digest and optional Epoch Successor Proof must verify, its restart continuity must be proven,
the cut Owner-observation time must be strictly before its exclusive `valid-through`, and its uncertainty and skew
must be within the admitted bounds. A fact is observable at that cut only when fact and cut clock identity and epoch
are byte-equal, the fact monotonic sequence is not greater than the cut sequence, the fact decision cut is not
greater than the requested decision cut, and each fact availability, retrieval, correction and observation
coordinate is not greater than the cut Owner-observation time. Consumers cannot walk a head or epoch-proof chain,
skip a predecessor, or compare sequences across epochs. An unavailable, mismatched, expired or discontinuous head,
an unproved epoch transition, mixed or unknown clock/epoch, excess uncertainty or skew, sequence or decision-cut
regression, and correction or observation after the cut produce no positive result. Effective-time containment
remains the independent second predicate.

Effective time and observation/decision-cut time are independent axes. A fact may be effective before it became
observable. Resolution requires both that the requested effective instant is inside the half-open interval and
that the fact was observable at the bound decision cut. A late correction creates only an immutable successor
whose predecessor is the corrected fact; it never rewrites the predecessor or makes the correction available at
an earlier cut.

`InstrumentMasterCutV1` is a content-addressed immutable resolution cut for `BACKTEST_OWNER_V1`. It binds the
consumer role, requested instrument or Universe Selection Record scope, effective instant, observation/decision
cut, complete sealed clock-head projection, exact expected canonical member set, ordered resolved canonical
identities and `InstrumentMasterFactV1` digests, all required frontier identities, and an explicit complete gap set.
A cut with any gap or conflict is not positive.

Every admitted resolution atomically appends one write-once receipt and its outbox entry under Market Data write
authority. The receipt binds request identity and meaning, `BACKTEST_OWNER_V1`, fact and cut digests, canonical
bytes, store commit coordinate, stable correlation and outbox identity. Neither receipt nor outbox entry may be
updated, replaced, reordered into a different identity, or treated as positive before durable commit.

`InstrumentMasterReadbackV1` is move-only and sealed by Market Data. It carries the complete exact canonical
`InstrumentMasterFactV1` record bytes and `InstrumentMasterCutV1` record bytes needed by the consumer, and repeats
the exact request identity and meaning, consumer role, derived fact and cut identities/digests, stable correlation
and durable receipt/outbox coordinates. Ordinary consumers cannot construct, clone, deserialize, implement or
mint it. It is the only recovery path after response loss; transport acknowledgement, retry success, a digest-only
existence proof or a caller copy of prior fields is not readback.

### Canonical identity and codec

The native records use one domain-separated canonical binary codec and BLAKE3-256. The exact four ASCII domains
are:

1. `VIBE_INSTRUMENT_MASTER_FACT_V1`
1. `VIBE_INSTRUMENT_MASTER_CUT_V1`
1. `VIBE_INSTRUMENT_MASTER_RECEIPT_V1`
1. `VIBE_INSTRUMENT_MASTER_READBACK_V1`

Each identity is `BLAKE3-256(domain_utf8 || 0x00 || canonical_record_bytes)`, where `domain_utf8` is exactly one
of the four strings above with no length or terminator inside it. The record codec has this one wire grammar:

- `codec_version` is exactly `0x0001`; unsigned integers are big-endian `u8`, `u16`, `u32` or `u64` at the width
  named by the field; signed decimal
  mantissas and time coordinates are two's-complement big-endian `i128`; decimal scale is `u8`;
- every content identity, digest, request identity, correlation, clock identity, store-generation identity and
  clock epoch and frontier is exactly 32 bytes; every enum discriminant is `u16`; optional absence/presence is
  exactly `0x00`/`0x01` followed by the value only when present; no other value is valid;
- a UTF-8 or opaque byte string is `u32` big-endian byte length followed by those exact bytes; a list is `u32`
  big-endian element count followed by its elements; and
- a time coordinate is signed `i128` Unix-epoch nanoseconds. Clock sequence and the decision cut are `u64`; store
  append sequence is also `u64`. Uncertainty and skew bounds are non-negative `u64` nanoseconds. Intervals compare
  their decoded time coordinates, not their bytewise signed representation.

For price increment, quantity increment and contract multiplier, the represented value is exactly
`mantissa * 10^(-scale)`. The mantissa must be greater than zero and scale must be in `0..=38`. The only canonical
normal form has `scale == 0` or `mantissa % 10 != 0`; therefore redundant fractional trailing zeroes are invalid.
Zero, a negative value, scale above 38, and a non-minimal scale are rejected before canonical bytes are hashed.

The only instrument-class discriminants are `0x0001 EQUITY`, `0x0002 FUTURE`, `0x0003 OPTION`, `0x0004 FX_PAIR`,
`0x0005 CRYPTO_SPOT`, `0x0006 CRYPTO_PERPETUAL`, `0x0007 FIXED_INCOME`, `0x0008 FUND`, `0x0009 INDEX`,
`0x000a COMMODITY`, `0x000b BETTING` and `0x000c SYNTHETIC`; every other value is unsupported and yields no
positive record. A canonical instrument identity, venue identity, source identity, source instrument, currency,
calendar identity, session identity, time-zone identity and consumer role is an exact
case-sensitive UTF-8 byte string under the string rule above, with no normalization. The consumer role bytes must
equal ASCII `BACKTEST_OWNER_V1`. Currency bytes are the Market Data-owned currency semantic identity, not a
consumer-parsed display code.

Within `InstrumentMasterFactV1`, fields occur exactly in this order: `codec_version:u16`, the exact UTF-8 string
`MARKET_DATA_AS_OF`, canonical identity, optional predecessor fact digest, venue/source mappings,
instrument-class discriminant, optional base, quote,
settlement and margin currencies in that order, price-increment mantissa/scale, quantity-increment
mantissa/scale, contract-multiplier mantissa/scale, calendar identity, session identity, time-zone identity,
lifecycle frontier, corporate-action frontier, historical-membership frontier, Market Semantics identity,
source frontier, correction frontier, effective-from time, optional effective-until time, provider-available
time, retrieval time, correction-publication time, Owner-observation time, clock identity, clock epoch, clock
sequence, decision cut, clock-head identity, clock-head digest, clock-head wall observation, exclusive
`valid-through`, restart-continuity digest, uncertainty bound, skew bound, optional Epoch Successor Proof identity,
optional Epoch Successor Proof digest, and the exact UTF-8 string `SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1`. The two
optional proof fields must both be absent or both be present. Venue/source mappings are one count-prefixed list.
Each mapping is the tuple
`(venue identity, source identity, source instrument bytes)`; mappings are strictly increasing by their complete
canonical tuple bytes and duplicates are invalid.

The only scope discriminants are `0x0001 EXACT_INSTRUMENT`, followed by one canonical instrument identity string,
and `0x0002 UNIVERSE_SELECTION_RECORD`, followed by one 32-byte Universe Selection Record identity. Within
`InstrumentMasterCutV1`, fields occur exactly in this order: `codec_version:u16`, consumer role, request identity,
the exact UTF-8 string `MARKET_DATA_AS_OF`, request-meaning digest, scope discriminant and its defined payload,
the exact expected canonical member identities, effective instant, Owner-observation time, decision cut, clock
identity, clock epoch, clock sequence, clock-head identity, clock-head digest, clock-head wall observation,
exclusive `valid-through`, restart-continuity digest, uncertainty bound, skew bound, optional Epoch Successor Proof
identity, optional Epoch Successor Proof digest, the exact UTF-8 string
`SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1`, ordered resolutions, lifecycle frontier, corporate-action frontier,
historical-membership frontier, Market Semantics identity, source frontier, correction frontier, and ordered gaps.
Expected members, resolutions and gaps are separate count-prefixed lists. Expected members are canonical identity
strings strictly increasing by their exact bytes. For `EXACT_INSTRUMENT(A)`, that list is exactly `[A]`. For a
Universe Selection Record, it must be byte-equal to the complete canonical membership set obtained by direct Owner
resolution of the bound record identity; a caller-carried list or digest cannot establish it. Each resolution is
`(canonical identity, fact digest)` and is strictly increasing by canonical identity bytes; each gap is
`(gap-kind:u16, canonical scope bytes)` and is strictly increasing by the complete tuple bytes. The only gap kinds
are `0x0001 UNKNOWN_IDENTITY`, `0x0002 AMBIGUOUS_IDENTITY`, `0x0003 OVERLAP`,
`0x0004 STALE`, `0x0005 WRONG_ROLE`, `0x0006 WRONG_CUT`, `0x0007 DIGEST_MISMATCH`, `0x0008 CODEC_MISMATCH`,
`0x0009 COVERAGE_GAP`, `0x000a STORE_UNAVAILABLE`, `0x000b STORE_UNTRUSTED` and `0x000c FRONTIER_MISMATCH`.
Canonical scope bytes are the exact scope discriminant followed by its defined payload, wrapped once by the opaque
byte-string rule. Every other scope or gap discriminant and duplicate resolution or gap is invalid.

The identity and digest of a fact are the same 32-byte result under the fact domain; the identity and digest of a
cut are the same 32-byte result under the cut domain. Within the receipt-domain record, fields occur exactly in
this order: `codec_version:u16`, request identity, request-meaning digest, consumer role, a count-prefixed list of
complete length-prefixed canonical fact record bytes in the cut resolution order, complete length-prefixed canonical cut
record bytes, store-generation identity, store append sequence, and stable correlation. The receipt identity and
digest are the same 32-byte result under the receipt domain. The outbox identity is defined to be exactly that
receipt identity; it is derived after hashing, is not encoded inside the receipt record, and the outbox stores the
exact receipt bytes.

Within `InstrumentMasterReadbackV1`, fields occur exactly in this order: `codec_version:u16`, request identity,
request-meaning digest, consumer role, the same count-prefixed list of complete length-prefixed canonical fact record bytes in cut order,
the same complete length-prefixed canonical cut record bytes, stable correlation, store-generation identity,
store append sequence, receipt identity and outbox identity. Receipt and outbox identity must be byte-equal. The
readback identity and digest are the same 32-byte result under the readback domain. This nested encoding is the
Owner-sealed atomic retrieval result. The expected-member list and ordered resolutions must have exactly the same
identities, with one resolution per member and no missing or extra entry. Every resolution identity must be
byte-equal to its nested fact canonical identity and every resolution digest must equal the fact-domain hash of
those exact nested fact bytes. Consumers verify these equalities and every nested record under its own domain before
use.

Decoding must consume all bytes, validate every reserved value and canonical order, and re-encoding must reproduce
byte-for-byte equality before any identity is accepted. JSON, maps or map iteration, locale, display formatting,
symbol or alias normalization, database row order, and evidence arrival order never define bytes or identity. The
receipt and readback domains bind their record payloads; the outbox stores the exact receipt identity and canonical
receipt bytes and does not introduce a fifth identity domain.

### Resolution, failure and recovery

A request resolves positively only through the current Market Data Owner store for `BACKTEST_OWNER_V1`. For each
requested effective coordinate, Market Data first keeps facts whose half-open effective interval covers that
coordinate and whose typed `MARKET_DATA_AS_OF` evidence satisfies the exact same-clock/epoch, sequence, decision-cut
and complete sealed clock-head comparison above. Every predecessor in a correction chain must have the same
canonical instrument identity as its successor. Corrections may overlap their predecessors only when they form one
unbroken predecessor chain. Resolution selects the unique maximal
observable fact in that chain: the eligible fact that is not the predecessor of another eligible fact. No eligible
fact, more than one maximal fact, a branch, a predecessor cycle, a missing predecessor, or overlap between facts
outside one chain is a gap or conflict and produces no positive result. A successor first observed after the cut is
ignored for that cut and can never displace its predecessor retroactively.

A positive `EXACT_INSTRUMENT(A)` cut contains exactly the one expected member A and exactly one resolution for A. A
positive Universe Selection Record cut contains exactly the complete Owner-resolved membership set bound by that
record identity and exactly one resolution for every member. In both cases the gap set is empty, every resolution
identity and digest equals its nested fact identity and bytes, and every nested predecessor chain keeps that same
canonical identity. Any missing or extra member, empty exact-instrument resolution, membership mismatch, nested
identity or digest mismatch, or cross-identity predecessor produces no positive cut, receipt or readback.

Unknown or ambiguous identity, any invalid overlap or chain, stale facts or frontiers, wrong consumer role, wrong
decision cut, fact, cut or digest mismatch, codec/version mismatch, membership or coverage gap, unavailable,
mismatched, expired or discontinuous clock-head evidence, excess uncertainty or skew, and unavailable or untrusted
store all produce no positive cut, receipt or readback.

The same request identity with byte-identical meaning joins the durable receipt and may obtain its native sealed
readback. The same identity with changed meaning is a conflict and creates no state transition. A changed effective
scope, observation cut, consumer role, frontier or codec meaning requires a successor request identity. Response
loss never authorizes a second write: recovery is exact receipt lookup and issuance of the corresponding move-only
`InstrumentMasterReadbackV1` only.

### Required consumption and preservation

PIT snapshot creation, Universe Selection Record evaluation, Strategy input binding and Backtest input admission
must each resolve Instrument Master facts directly through this Owner contract. Symbol, ticker, alias, latest-row,
nearest-effective, venue-default and consumer-maintained mapping fallback are forbidden. R&D and Strategy
compiler artifacts may carry sealed fact/cut projections, but cannot become a mapping authority.

Every Backtest result must preserve the exact consumed `InstrumentMasterFactV1` identities/digests and
`InstrumentMasterCutV1` identity/digest. A result with only a symbol, alias, latest Instrument Master digest, or a
different cut is not the result for that admitted input. Runtime, Portfolio, Scanner and Execution adoption remains
separate future work and cannot weaken the fixed Backtest consumer contract.

## Strategy input-role binding

For the [StrategyDesignV2 compiler](../architecture/strategy-factory#strategy-design-v2-shared-lifecycle-kernel),
Research declares a typed input role and Market Data alone resolves market/reference roles to an exact sealed
binding receipt. The receipt binds the role to a role-independent stable selection identity covering field
semantics, instrument or stable Universe Selection Record scope, timeframe/bar specification, units and scaling,
Source Binding lineage root, correction stream, and Market Semantics Compatibility identity. Renewable PIT,
snapshot, batch, frontier/version, time, sequence, row and value facts are excluded. It grants data consumption only; it does not choose a strategy universe,
mechanism, target, lifecycle action or order.

Missing, stale, ambiguous, incompatible or non-unique role resolution is an unavailable binding and produces no
`StrategyPlanV2` or replay/runtime input. Market Data, R&D and the compiler must not infer a binding from ticker,
free-form label, alias, substring, naming similarity, list position or arrival order. Historical Backtest and later
admitted Runtime adapters must preserve the same role and Market Semantics identities; a mismatch fails closed
rather than being normalized by the consumer.

**CURRENT/PARTIAL, Owner-binding M1:** Market Data can derive one exactly-two-member universe only
from a complete `VerifiedPitObservationBatch` and atomically seal its canonically sorted member keys,
distinct canonical instruments, Owner-derived static selection identity/digest, Instrument Master digest,
batch/snapshot facts, Source Binding lineage, Market Semantics identity, and every requested `(member, role)`
value. The static selection authority binds the one-to-one member/instrument set plus Instrument Master,
Source Binding lineage-root and Market Semantics cuts; the original PIT-request universe digest is dynamic
provenance only. Caller arrival order is irrelevant. Missing, duplicate, third or inconsistent members;
cross-key instrument aliasing; missing or ambiguous member-role rows; any selection/master/semantics/lineage
splice; and caller `InstrumentSet` scope produce no positive
selection or frame. This is a current Owner-local binding contract only; it does not claim compiler,
shared-kernel, ProgramHost, Backtest, Paper, Live, or production maturity.

**TARGET / IMPLEMENTATION_ADMITTED, one-member universe:** the Owner-binding above, the `InstrumentMasterCutV2`
cut, economic-terms resolution, Native Replay scheduling and the frame sequence also admit a universe of exactly one
member, alongside the two-member form; admitting one member changes no two-member behaviour or byte, and the cut
already encodes its member count. The separate change the quote cut makes to the V1 scheduling receipt is recorded
with the quote cut paragraph.
The admission and the user's authority for it are recorded with the one-member target-set vertical in the Strategy
Factory architecture. For initial Replay composition, the fixed Market Data writer issues the cut through the
bound-replay issuance the cut-issuance paragraph above states, when R&D first binds the sealed Replay request's native
execution input. Built so far: the `InstrumentMasterCutV2` cut and its custody table, which an existing table migrates
to in place, economic-terms resolution, the Owner-binding, the V1 native scheduling seal, the V2 frame evidence and the
frame sequence admit one member; the V1 scheduling receipt states its member count, part of the quote cut's change to
it. The bound-replay issuance is the only production path to `issue_cut`, and its one caller is R&D's native
execution-input binding issuance.

**TARGET, durable Strategy Input Binding Registry:** Market Data owns write-once, validated binding declarations
keyed by the exact PIT request, `StrategyDesignV2` and typed input role. R&D may supply only
Owner-authenticated Design/role intent; they never supply or select members, frames or a binding digest. In one
Market Data Owner transaction, registration resolves the native PIT Snapshot, Universe Selection, Source Binding,
Instrument Master and Market Semantics authorities, derives and stores the declaration and digest, regenerates the
existing V1 bindings and frames, and then runs the existing V1 complete-census and joined-cut authorities unchanged.
Missing registry registration or any request/Design/role, membership, frame, lineage, semantics or digest mismatch
produces no declaration, census, joined cut or replay input. This registry is the prerequisite for positive Replay
V2 composition and for real Owner-driven R&D and Backtest consumption; it is not a provider registry,
deployment registry or caller-authored data path.

**CURRENT/PARTIAL, authenticated role-set foundation:** the dependency-neutral exact Composer locator and
`StrategyDesignRoleSetReceiptV1` DTO are available, and the production positive-registration seam requires an
authenticated complete role set before it accepts the unchanged V1 request. It verifies the requested Design,
Research request, derived role identity and every semantic coordinate, plus exact complete role coverage. The
observation-census seam likewise verifies that the unchanged V1 join claim exactly repeats one authenticated join
before complete-census/latest-not-after selection. Existing V1 request, binding and receipt bytes and exact legacy
recovery stay unchanged. **CURRENT/PARTIAL:** W3 admits only the R&D-owned, same-Composer-transaction durable
attestation through its exact-locator DB-ACL read function and makes that seam the only reachable positive path; Market
Data then independently resolves its registry, census, join, V4 sample, R0 and Market Semantics authorities before
atomic binding issuance. The resolver is registered rather than planned: `/v1/market-data/strategy-input-bindings` ships
unconditionally in the deployed binary, and its admission is composed whenever both principals are configured, which the
deployment file requires of every run. The write path is exercised by
`postgres_replay_composition_owner_is_atomic_exact_and_observes_reader_market_transaction_overlap`, which binds the
terminal to the Owner's own committed PIT request rather than a caller's claim, rejoins on re-admission and refuses an
unattested locator. **TARGET:** an observed end-to-end sequence. Every link exists ungated - the production Composer's
commit function writes the role-set attestation in the same transaction as its operation, receipts and outbox, and the
default build selects that function - but no run has been seen carrying a Composer commit through W3 registration into a
Bounded Feature Program freeze. The proof above supplies the attestation by writing the Composer rows directly, which a
test may do and a deployment may not, so the sequence itself stays unwitnessed rather than unbuilt.

**TARGET, and the schema says which shapes are possible:**
`rd_develop_strategy_design_role_set_attestations_v1` takes `request_identity` as a primary key that references
`rd_develop_operations_v2`, and requires a unique `operation_receipt_identity`, `artifact_identity` and
`canonical_plan_digest`. An attestation therefore cannot exist without a Composer operation that produced an artifact.
Minting one on its own, however it is authorized, would mean inserting an operation row for an artifact nobody built,
which is the fabrication this seam exists to refuse. Freezing is not the obstacle: `freeze` takes an assembled pair and
never consults this registry, which the chain's joint-freeze proof shows by passing without touching Market Data at all.
The obstacle is the run. Binding resolution calls `resolve_pit_request_for_strategy_design_v1` before it examines the
declared role set, so a frozen program is refused for want of declarations even when it declares no input roles at all -
and an attestation is scoped to one Design, so a first program cannot vouch for a second. There is no input-free escape
either: `validate_declarations` refuses a Design with no inputs, because at least one typed Owner-bound input is
required. The circle is thus a consequence of that requirement rather than an oversight - every admissible Design binds
to Owner-verified custody, which is what makes the artifact trustworthy and what leaves the first one with nothing to
bind to. Each Design therefore closes its own circle: running it needs declarations, declarations need an attestation naming it, and that attestation needs
the operation only a run produces.

**ADMITTED, first registration from an authenticated Design:** nothing that carries a program can open the circle.
`BoundedFeatureInputV1` holds a `static_binding_receipt_digest` per input, an all-zero digest is refused, and the value
enters the program's canonical digest, so a program's own identity depends on receipts this registry has not issued yet.
Freezing does not escape that: it takes an assembled proposal, and assembling one requires a receipt for every role.
The only thing that can precede a program is the Design, which is what the paragraph above already contemplates when it
says R&D may supply Owner-authenticated Design/role intent. R&D therefore publishes that intent - the Design identity
and digest, the Research request it belongs to, the custody digest it was admitted against, and the role set R&D derives
from it - through an exact-locator DB-ACL read function beside the one that exposes an attestation, and Market Data
consumes it exactly as it consumes an attestation: it verifies coverage, then resolves its own registry, census, join
and issuance authorities before issuing anything. No program, artifact or unbound input exists anywhere in this path.
Registration stays write-once, so it reaches a Design once and a Composer commit governs every cycle after it, and W3 is
untouched: an attestation remains the only thing W3 admits.
`POST /v1/market-data/strategy-input-bindings/from-design-intent` is that consumer, and the ordered PostgreSQL chain
witnesses it beside the attested admission, against the same custody and the same role entries: a Design nothing in
`composer_private` names moves from no PIT coordinate to the one this Owner resolved, and to the same PIT request and
decision cut the attested Design resolved to. An unpublished Design reaches no declaration, and a published row edited in
place stops authenticating the Design it was published for.
**NOT_ADMITTED:** caller-proposed Design/role/join fields, receipt/readback/token, receipt hash,
latest/history/full scans, raw R&D table parsing or Market Data storage do not authenticate Design meaning; Market Data
does not depend on R&D, own or reinterpret Strategy Design roles or joins.

**TARGET / IMPLEMENTATION_ADMITTED, a Research request's instrument scope:** the R&D Owner contract lets a Research
request name one or two canonical Instrument Master identities as its `ResearchInstrumentScopeV1`, which the user
admitted on 2026-09-24, and has R&D issue the Intent's initial PIT request from it. Market Data answers that request
and never chooses the instruments. This is how:

- Fixed-member selection rule. Besides the every-member rule (`[0,1,1]`) and the instrument-prefix rule (`[0,1,2,..]`),
  a Universe Selection request may carry the fixed-member rule: `[0,1,3]` followed by the scope's canonical bytes, with
  `selection_rule_identity` equal to the scope identity. Bytes that do not decode as a scope, or any other rule
  identity, are refused as an invalid request. Market Data evaluates the rule against the eligible-instrument frontier
  it holds as current, and refuses a request that names any other frontier as `UNIVERSE_SELECTION_FRONTIER_NOT_CURRENT`.
  The selection includes exactly the requested identities and excludes every other frontier member as
  `RULE_FILTERED_V1`. A requested identity for which the Instrument Master selects no fact in force and observable at
  the request's instants is refused as `UNIVERSE_SELECTION_MEMBER_UNRESOLVED`, and one that no single member of the
  frontier includes as `UNIVERSE_SELECTION_MEMBER_NOT_IN_FRONTIER`; neither is dropped from a selection that would then
  hold fewer members, and no refusal writes a selection. The current frontier is the latest admitted
  historical-membership frontier: each admission succeeds the one before it, so Market Data, not the requester, decides
  which frontier is current. A membership fact belongs to the frontier it was admitted under: restating the same fact
  for another frontier is refused as a conflict.
- PIT references. R&D resolves every Market Data reference of the initial PIT request through one read,
  `resolve_research_pit_references_v1`, which runs in R&D's own transaction, and supplies nothing of its own. The read
  returns the current eligible-instrument frontier; the locator, lineage root, correction frontier and Market Semantics
  identity of the one Source Binding lineage the requested identities' frontier facts name; and Market Data's current
  decision cut with the clock evidence the PIT intake compares exactly. It returns no Instrument Master digest, and the
  request R&D submits states none. The Instrument Master readback a PIT request binds is minted by the intake's own
  write, keyed on the request's correlation and event instant, which no read of the scope can reproduce. R&D therefore
  submits the request without an Instrument Master field and without a claimed identity or digest; the intake stamps its
  own readback digest, seals the request's identity and digest over what it will commit, and refuses by name a
  submission that states any of those three fields, so no stand-in value, all-zero or otherwise, is ever read as one.
  The request identity and digest a terminal reports are Market Data's. The read refuses by name when an identity is not
  admissible; when the identities' facts name more than one Source Binding lineage or correction frontier, because one
  PIT request binds one Source Binding; when that lineage has no admitted head; and when Market Data holds no clock
  head. The intake still re-verifies the Universe Selection R&D then states and the PIT request it freezes, and it
  admits a scope of one or two members.
- One initial intake per correlation. The intake commits at most one initial PIT snapshot per correlation. It claims the
  correlation in the transaction that commits the snapshot, and refuses by name as `CorrelationAlreadyCommitted`, with
  nothing written, a submission that seals to a different request under a correlation already claimed. Re-sending the
  stored submission joins the committed terminal only while Market Data's clock head is still the one the submission was
  cut at: the intake compares the submission's clock evidence with the current head exactly, before it looks at the
  correlation, so after the head moves any submission cut at the old head is refused by name as
  `ClockEvidenceNotCurrent`, before anything is written, whether or not its correlation committed. A head that moves
  while an intake is already running refuses it by the same name when it commits. R&D therefore recovers a send that
  ended without a response, or was refused as either of those, by reading its correlation back, never by re-sending, and
  freezes a new submission at the current cut only when the read returns nothing.
  `resolve_research_pit_terminal_by_correlation_v1` runs in R&D's own transaction, takes no row locks and writes
  nothing. It returns the committed snapshot's terminal as the intake answered it, with the requester its request
  carried, or nothing when Market Data has never committed an initial intake under that correlation. A read that cannot
  run, and a stored claim that does not verify against the snapshot it names, are errors and never nothing. A terminal
  states the committed fact's disposition and its primary blocker, none for `AVAILABLE` and the deciding one for every
  other disposition, so a reader never infers one from the other. The terminal carries the Instrument Master digest the
  intake stamped; sealing the stored submission over it reproduces the request identity and digest the terminal reports,
  which proves which attempt the terminal answers. What crosses into `market_data_rd_api` for this read is one more
  `STABLE` `SECURITY DEFINER` function that returns the claim and the snapshot it names.
- Requester identity. The initial PIT request's `requester_identity` is SHA-256 over
  `vibe.market-data.pit-requester.research-request.v1\0` followed by the 32-byte Research request identity the Design
  role intent carries, which is R&D's `rd.develop.request-identity.v2` digest of the request locator, never another
  digest of the request identity string. Market Data recomputes it from that role intent field and compares; it never
  decodes a requester back into a Research request.
- Registration by reference. A Design role intent of schema 2 names its initial PIT request as
  `(pit_request_identity, pit_request_digest)`. Market Data registers every role of that Design against exactly that
  request: it loads the PIT lineage the pair identifies and its head, and refuses by name, with zero writes, when the
  request is unknown, its digest differs, its head is not `AVAILABLE` with an observation batch, or its
  `requester_identity` is not the value above for the intent's Research request. A universe-member role is composed
  with the Universe Selection that batch derives; an exact-instrument role binds its instrument in the same batch. A
  schema 1 intent names no request: its exact-instrument roles still resolve by coordinate as the paragraphs above
  state, and its universe-member roles are refused by name. A Composer attestation of a universe-member Design takes
  its PIT request from that Design's published schema 2 role intent, never from the attestation.
- Early check. Before R&D accepts a Research request it calls `check_research_instrument_scope_v1`, which returns one
  row per identity, in order, each `ADMISSIBLE`, `UNRESOLVED` or `NOT_IN_ELIGIBLE_FRONTIER`, with the frontier and the
  decision cut it judged them at. Every instant of the judgement is Market Data's current decision cut. An identity is
  `UNRESOLVED` when the Instrument Master selects no single fact for it in force and observable at that cut, and
  `NOT_IN_ELIGIBLE_FRONTIER` when it resolves but no single membership fact for it is in force in the current frontier;
  with no current frontier every row is `NOT_IN_ELIGIBLE_FRONTIER`. It runs inside the caller's R&D transaction without
  row locks, and writes nothing. It only refuses early: the fixed-member evaluation at the PIT request remains the
  decision, and an identity admissible at the check can still end in a terminal that is not `AVAILABLE`.
- The reads' transport. Both reads are Market Data code running in R&D's transaction. What crosses into
  `market_data_rd_api` is four `STABLE` `SECURITY DEFINER` functions that only return stored evidence: the Owner's clock
  head, the current frontier's membership facts for the requested instruments, their Instrument Master facts, and one
  lineage's Source Binding head. The Owner's own decoders and selection rules decide every answer.

Built so far: Market Data's half of this section. The intake takes a submission without Owner fields, refuses one that
states any of them by name, stamps its own Instrument Master digest and seals the request over it; it claims each
correlation once, and the read by correlation answers as stated. The PIT intake admits a Universe Selection Record of one or two included members, each keyed by its canonical instrument,
and refuses any other count or key by name before it writes anything. Registration by reference registers a Design
against exactly the initial PIT request its role intent names, with the refusals stated above. Each newly admitted
frontier takes the next admission number and the latest numbered one is current; a frontier admitted before numbering is
never current. The fixed-member rule and its three refusals, the check and the reference read answer as stated.

Market Data consumes, but does not define or reinterpret, the explicit big-endian R&D canonical binary codec
specified in the R&D Owner contract. Its JSON representation is not canonical receipt material. Registration
must receive byte-identical exact-locator recovery through the fixed R&D adapter; independently recomputed,
reordered or mutated bytes remain caller evidence even when their integrity hash is self-consistent.

**SEALED_ACCEPTANCE only:** enabling the non-default compile-time Cargo feature
`sealed-strategy-input-acceptance` exposes one zero-argument fixture adapter for the fixed AAPL/MSFT,
OPEN/CLOSE corpus. The adapter drives the crate-private Source Binding admission and PIT
prepare/aggregate/verify authorities, then calls the normal universe-frame binder; it accepts no caller-selected
rows, requests, locators, digests, clocks, providers, persistence, or runtime selector. Default and production
manifests omit the feature. A release build that explicitly enables it remains an isolated acceptance artifact,
never a production build. This fixture proves only the compile-time acceptance topology: it provides no PostgreSQL
custody, provider connectivity, deployed Dashboard readiness, production composition, or trading authority.

### `ISOLATED_EVENT_REPLAY_ACCEPTANCE_V1`

**TARGET / ISOLATED_ACCEPTANCE_ONLY:** this explicitly selected, request-driven profile authorizes the smallest
dynamic PostgreSQL acceptance topology; it is separate from the compile-time fixture above and is never a default or
production route. Its disposable PostgreSQL store may be constructed only after the Market Data-private Deployment
Store Admission custodian consumes an immutable acceptance trust bundle provisioned by the canonical management plane
outside the repository, candidate, caller, consumer, and tested process. The bundle pins the environment, signer key fingerprint, witness, credential-
resolver, and direct-measurer identities. Separately executed principals issue signed append-only manifest/history and
its exact current head, maintain the anti-rollback witness, lease an opaque least-privilege credential handle, measure
the target directly, and close the rotation fence. The candidate and caller possess no signer private key, witness
write authority, credential material, or measurement authority; the sealed admission receipt cross-binds the bundle
and every observation. Signature, predecessor/generation, current-head, rotation, endpoint/TLS/
server/database, schema/migration/function/role/ACL, credential audience/version, and measurement identity must all
match before repository construction and again at the protected use boundary. The custodian retains all raw admission,
credential, measurement, PIT, Source Binding, clock, and head evidence inside Market Data.

The input is one exact R&D Owner-issued sealed request locator and receipt, never a caller-authored request DTO. Market
Data must use the fixed read-only R&D Owner port to resolve and verify the canonical request bytes, digest, Owner,
requester role, and request identity; neither the locator label nor a Market Data attestation is sufficient. Under one
Market Data transaction, the Owner resolves that request, selects its exact `EVENT` projection and native event receipt, and commits
the request-to-projection/event locator plus durable Owner readback. Exact same-meaning replay returns byte-identical
locator and readback bytes; changed meaning or same identity with different bytes conflicts and performs no write.
The existing Replay V2 `resolved_owner_inputs` content identity is generic content addressing and, by itself, is not
this authority and must not be reinterpreted as one. The isolated route requires an additive, versioned Owner binding
receipt that cross-binds the sealed R&D request identity, the exact Market Data projection receipt digest, and the
Owner-native event identity before any resolver can be issued.

**CURRENT/PARTIAL, complete ordered EVENT corpus V1:** `StrategyInputEventCorpusV1` is the additive
Market Data boundary for continuous replay. Its new move-only `StrategyInputEventSourceV1` is issued only from
Owner event frames resolved from verified PIT batches; it retains each frame's snapshot identity, snapshot-fact
digest, observation-batch digest, binding/value coordinates, and source/correction provenance. That source - not
`SealedReplayInput` V1 - determines the complete trigger set, so the caller cannot select a subset. Every member binds the canonical native order key
`(logical_time, event_time, owner_sequence, event_identity)`, joined-cut digest, projection receipt digest, and
native trigger identity/digest. The corpus additionally binds the complete source digest, expected count, and a
domain-separated corpus digest. Empty, missing, duplicate, reordered, BAR,
cross-census, cross-request, cross-projection, or cross-native-trigger evidence produces no corpus. Existing V1 cut
and V2 projection bytes, digests, `SealedReplayInput` V1 meaning, resolver meaning, and historical single-event
consumers remain unchanged. Equal-valued evidence from another snapshot or observation batch is rejected by exact
Owner provenance rather than value comparison.
After restart, resolution of that locator must return the same canonical request, projection, and event identities and
bytes. The only value crossing to R&D or Backtest composition is the sealed, read-only
`StrategyInputSampleEventResolverV1` capability for that exact request-selected event; no insert, update, delete, head
advance, generic query, raw DSN, credential, admission receipt, or evidence accessor crosses the Owner boundary.

A caller digest, DSN, fixture, fixed corpus, in-memory or temporary-file writer, or signer/witness/credential/measurer
derived by the candidate, caller, consumer, or tested process
cannot mint the request locator, resolver, event, or readback. Missing, stale, superseded, or mismatched head, rotation,
ACL, credential, measurement, request, role, projection, event, locator, or readback fails before `ProgramHost` or
Backtest state mutation and produces no positive resolver or terminal result. Successful proof authorizes only this
disposable profile; it admits nothing for the default product entry, whose production adapters compose only from a
deployment's own configuration. It establishes no provider authenticity, production
readiness or deployment authority, Dashboard, Paper, Live, real trading, or other production write.

The runtime handoff consumes the existing static receipts plus one verified batch and re-resolves each selection;
the frame contains only its trigger and dynamic value receipts. Market Data issues its trigger only from selected rows
in one Owner-verified observation batch with identical snapshot/fact/batch identities, event-effective,
provider-available and correction-publication times, non-zero correction sequence, and event class. Bars map to
`BAR`; quote, trade, reference, economic and scalar frames map to `EVENT`; logical time is the greater of
provider-available and correction-publication time; event time is event-effective time; and Owner sequence is the
correction sequence. Stable event identity is the first 16 bytes of domain-separated BLAKE3 over those coordinates
and the sorted role/binding/row-digest set. Each ordered role-value receipt preserves its original binding digest
and role identity, seals the explicit fixed-i128 semantic, exact little-endian bytes, scale and row digest, and
cross-binds the trigger and observation-batch digest. Consumers derive the lifecycle envelope from the trigger;
they cannot mint it from caller-selected values or order keys. Market Data never issues `TIMER` or `FILL` triggers:
those remain unavailable pending real Time/Scheduler and Execution Owner contracts respectively.

**CURRENT, a row stated exactly at its role's scale:** a role reads its value at the role's declared scale, and a
canonical row keeps the scale its source stated the value at. The binding used to require the two to be equal and
answered anything else as `ScaleMismatch`, so a row bound only where its price happened to have exactly the role's
decimal places. The PC-1 probe measured this: a BTCUSDT price on its 0.10 tick has scale 1, and a scale 2 universe role
refused it at the universe declaration.

- **Alignment.** Every binding (exact instrument and universe member alike) admits a row whose value
  `decimal_rescale_v1::rescale_exact_v1` states exactly at the role's scale. Widening multiplies the mantissa by
  `10^(role scale - row scale)`, checked. Narrowing divides it and is exact only when the dropped digits are zero, so
  a scale 9 row is the identity at scale 9 and a scale 10 row ending in 0 narrows to 9.
- **Refusal.** Scale never selects a row: the binding resolves its one row first, so rows that differ only in scale
  are refused as not unique, and then states that row's value exactly. When it cannot, the refusal names why:
  `VALUE_FINER_THAN_ROLE_SCALE` for a nonzero digit finer than the role, `VALUE_OVERFLOWS_ROLE_SCALE` for a widened
  mantissa that does not fit in an `i128`. Nothing is rounded.
- **Receipts.** The binding locator records the role's scale. A role-value receipt's `value_bytes` and `value_scale`
  carry the aligned value and the role's scale, and its `canonical_row_digest` stays the source row's own digest, so
  the custody row a value came from stays exact. A row already at the role's scale keeps its bytes.
- **Scale 9.** Universe-member roles read at the fixed scale 9 (Strategy Factory, P1). It is the custody series'
  scale, `decimal_rescale_v1::MARKET_DATA_VALUE_SCALE_V1`, defined once, in Market Data, beside the exact rescale
  every alignment uses. An instrument's tick changes over its history (BTC's is 0.10 today, but its
  2021 prices sit on a 0.01 grid; SOL's had 3 decimals in 2021), so the series is fixed at production fixed-point's
  upper bound, 9, and every row is aligned exactly to it.
- **Refusal names.** `STRATEGY_INPUT_BINDING_UNAVAILABLE` (422) carries the binding's own cause in the
  `x-rd-rejection-cause` header and the body's `cause`, such as `VALUE_FINER_THAN_ROLE_SCALE`.

### CURRENT/PARTIAL EVENT and BAR Owner custody; TARGET BAR product authority

Market Data implements the versioned `TimeframeSpecV1`, `TimeframeProjectionReceiptV1`, `SampleFactV1`, and
`SampleReceiptV1`, their native exact-receipt resolvers, and durable PostgreSQL custody for `POINT_EVENT` samples and
for the BAR samples the universe sample projection commits for a Replay request's initial frame. The code also
implements durable PostgreSQL custody for BAR schedule fact/cut/receipt/outbox/head state, admitted exact
schedule readback, and V3 BAR FRAME projection receipts. These paths are `CURRENT / PARTIAL` Owner authority after
their isolated dynamic PostgreSQL acceptance. The sealed exact-digest V3 resolver core is likewise
`CURRENT / PARTIAL`, but the fixed `STRATEGY_FACTORY_RD_OWNER_API_V1` production startup still fails closed because
its production admission adapters remain unavailable. Production startup and product or composite consumption remain
`TARGET / UNAVAILABLE`. BAR is limited to
complete fixed-interval and
exchange-session bars, while partial bars remain TARGET. Market Data remains the sole writer of all admitted
records. Every existing V1
binding, event, value, frame, joined-cut, row, digest, and byte meaning remains
authoritative and byte-identical; no V1 record is deleted, synthesized, backfilled, garbage-collected, reinterpreted,
or promoted. The additive `StrategyInputSampleProjectionReceiptV2` remains the canonical EVENT FRAME or JOINED_CUT
projection over Owner facts, not a replacement authority. There are no separate V2 event, value, frame, or joined-cut
codecs; the unchanged V1 event/value/frame and joined-cut receipts remain its exact evidence inputs. V2 JOINED_CUT
projection and exact locator readback are `CURRENT / PARTIAL` at the structural Owner-custody seam described below.
They do not establish production startup or product consumption. BAR uses only the separate V3 FRAME projection described below; its durable Owner
custody and its sealed exact historical resolver core are CURRENT/PARTIAL, while production startup and product
resolution remain TARGET/UNAVAILABLE. It
never widens or reinterprets V2. Additive V4 FRAME/JOINED_CUT with BAR lifecycle is TARGET/NOT_ADMITTED and never
widens or reinterprets V2 or V3.

TARGET gap, the BAR schedule's production proposer: `commit_prepared_bar_schedule_v1` is the only writer of BAR
schedule custody, and no production path proposes a schedule; every proposal today is built by a test or an acceptance
fixture. A native Replay's initial read needs a schedule cut at its frame, so until a production proposer exists, an
acceptance that drives that read takes its schedule from the sealed acceptance proposer
`commit_bar_schedule_for_acceptance_v1`, present only in a build carrying `sealed-strategy-input-acceptance`. Given a
PIT snapshot and a BAR role declared on it, the Owner derives every schedule field from the snapshot's verified batch,
the bar its Source Binding declares for the role's row label, the role's binding, and the Instrument Master readback
the snapshot binds: the declared cadence, anchor, clock, label and completion, the master fact's interval, and a cut at
the snapshot's event. The schedule is the instrument's and declared bar's, not the role's, and a schedule the frame
already reads and the declaration admits is rejoined rather than written again. It refuses by name a snapshot it
cannot find, a batch that does not verify, an undeclared role, a role spanning several members, a role whose row is
not a BAR, a Source Binding that declares no bar timeframe, a role row label it declares none for, and a missing
Instrument Master readback. Strategy Factory slice F depends on it. A continuous daily bar such as a Binance
perpetual's is declared as a 24-hour fixed interval on a continuous clock from the Unix epoch and scheduled as that
bar. One source gap remains beside it: no admitted Binance perpetual source supplies QUOTE rows, so a perpetual Replay
has no quote cut to fill from. The fill-bar quote cut below, before PIT window custody, is the design that closes it.

`TimeframeSpecV1` has one fixed canonical codec, in this order: schema `u16LE = 1`, reserved-zero `u16LE`, kind
`u8`, positive step `u32LE`, unit `u8`, anchor identity `[u8; 32]`, calendar identity `[u8; 32]`, session identity
`[u8; 32]`, time-zone identity `[u8; 32]`, label-rule `u8`, and partial-bar-rule `u8`; trailing bytes are forbidden.
Its identity is SHA-256 over `market-data.timeframe.identity.v1\0 || canonical TimeframeSpecV1 bytes`. In
particular, `1d` means one named exchange
session day under the bound calendar, session, and time zone. It never means a UTC-duration day or an unanchored
24-hour interval. A field required by the admitted combination that is absent or ambiguous makes the timeframe
unavailable rather than allowing a consumer default.

The tag registry is closed. Kind is exactly `0x01 POINT_EVENT`, `0x02 FIXED_INTERVAL_BAR`, or
`0x03 EXCHANGE_SESSION_BAR`. Unit is exactly `0x00 NOT_APPLICABLE`, `0x01 SECOND`, `0x02 MINUTE`, `0x03 HOUR`,
or `0x04 EXCHANGE_SESSION_DAY`. Label rule is exactly `0x00 EVENT_EFFECTIVE`, `0x01 INTERVAL_OPEN`, or
`0x02 INTERVAL_CLOSE`. Partial-bar rule is exactly `0x00 NOT_APPLICABLE`, `0x01 COMPLETE_ONLY`, or
`0x02 ADMIT_PARTIAL_AS_DISTINCT_SLOT`. The all-zero 32-byte value is the sole not-applicable identity; every
applicable identity is non-zero.

Only these combinations are canonical:

- `POINT_EVENT` has `step = 1`, `unit = NOT_APPLICABLE`, all four identities zero,
  `label = EVENT_EFFECTIVE`, and `partial = NOT_APPLICABLE`;
- `FIXED_INTERVAL_BAR` has `step > 0`, unit `SECOND`, `MINUTE`, or `HOUR`, non-zero anchor and time-zone
  identities, either both calendar/session identities zero for a continuous clock or both non-zero for a
  schedule-bounded clock, label `INTERVAL_OPEN` or `INTERVAL_CLOSE`, and partial `COMPLETE_ONLY` or
  `ADMIT_PARTIAL_AS_DISTINCT_SLOT`; and
- `EXCHANGE_SESSION_BAR` has `step = 1`, `unit = EXCHANGE_SESSION_DAY`, all four identities non-zero, label
  `INTERVAL_OPEN` or `INTERVAL_CLOSE`, and partial `COMPLETE_ONLY` or `ADMIT_PARTIAL_AS_DISTINCT_SLOT`.

Every other tag, zero/non-zero arrangement, step/unit pair, or combination is unsupported and produces no
timeframe identity. `ADMIT_PARTIAL_AS_DISTINCT_SLOT` requires the partial observation to receive its own root slot
identity; it can never replace or alias the completed slot. Every bar interval is half-open `[open, close)` under
the bound anchor and schedule; `INTERVAL_OPEN` uses `open` as event-effective time and `INTERVAL_CLOSE` uses
`close`. `POINT_EVENT` uses the source event-effective time.

The first TARGET BAR slice accepts only `COMPLETE_ONLY` for `FIXED_INTERVAL_BAR` and
`EXCHANGE_SESSION_BAR`. The canonical `ADMIT_PARTIAL_AS_DISTINCT_SLOT` codec is preserved for a later TARGET, but
it is not executable admission in this slice and produces no positive projection, fact, receipt, or resolver result.

The existing V1 binding's free-form timeframe string is provenance only. It is never parsed into typed schedule
bytes and changing it cannot change a schedule identity, timeframe identity, or series identity. A caller may name
an untrusted desired BAR shape, but that input has no direct projection authority and cannot mint, select, or mutate
schedule, calendar, session, time-zone, anchor, label, partial rule, or instrument evidence.

What a BAR row is as a bar is declared by its Source Binding. A schema-2 Source Binding proposal declares
`bar_timeframes`: one declaration per BAR row label the source stamps, in strictly ascending label order with no label
repeated, each stating the exact `row_timeframe`, a cadence (`FixedInterval` of a positive step in `Second`, `Minute`
or `Hour`, or `ExchangeSessionDay`), an anchor (`UnixEpoch` or `SessionOpen`), a clock (`Continuous` or
`ScheduleBounded`), a label (`IntervalOpen` or `IntervalClose`) and a completion (`CompleteOnly`). Exactly three
combinations are admitted: a fixed interval from the Unix epoch on a continuous clock, a fixed interval from the session
open on the trading schedule, and an exchange session day from the session open on the trading schedule; any other
combination, an out-of-order or repeated label, or a label a PIT batch cannot carry refuses the binding as
`UnsupportedBarTimeframe`. A schema-1 proposal declares none. Under schema 2 the declarations enter the binding
identity and fact digest, count first; schema 1 encodes nothing new, so every binding minted before declarations keeps
its identity. No production Source Binding is schema 2 today. A UTC day, such as a Binance USD-M perpetual's `1d`
kline, is a 24-hour `FixedInterval` from the Unix epoch on a continuous clock; an equity's `1D` is an
`ExchangeSessionDay`. The label `1D` names either, and only the declaration says which.

A schedule is selected and minted by one rule in three places - the native Replay scheduling read, the universe
sample projection's member schedules, and the sealed acceptance proposer: the frame's batch names its Source Binding
fact, the roles' row label selects that binding's declaration by identity equality, and the schedule must state the
declared cadence, anchor, clock, label and completion field by field. The role label, the row label and the
declaration's `row_timeframe` are compared as provenance strings: equality confirms that the roles read the rows the
declaration speaks for, and says nothing about what the label means. A schedule's anchor identity is SHA-256 over
`market-data.bar-schedule.anchor.v1\0 || anchor tag`, so one anchor means one thing on every schedule; a continuous
clock binds zero calendar and session identities whatever the Instrument Master names, and a trading-schedule clock
binds both. In the native Replay scheduling read, the row label is the execution role's: Market Data derives that
role itself from the request's roles, by `execution_role_semantic_id_v1`, Strategy Factory's rule
(`derive_execution_role_v2`): a universe Design declares no join, so it is the one role reading the BAR close. No
caller names it. The read
refuses a request with no role reading the close (`ExecutionRoleAbsent`) or more than one (`ExecutionRoleAmbiguous`),
and one in which another BAR role reads a different label (`MoreThanOneRoleTimeframe`): until Strategy Factory slice T2
resolves each role's own last close, every role is read at the execution role's bar. It refuses by name a binding that
declares no bar timeframe (`SourceBindingDeclaresNoBarTimeframe`) and an execution label the binding declares no bar
for, which therefore cannot be typed (`ExecutionTimeframeNotDeclared`); a declaration from another binding, or a member
whose schedules at the frame all state another bar, is `DeclaredBarTimeframeMismatch`. One role with several
timeframes cannot be constructed: a role has one label and a label has one declaration. Several timeframes in one
Design are several roles, either under different labels of one binding, as the admitted joined-cut corpus below does,
or under different bindings, such as one instrument's 1-hour and 1-day sources; this is the shape Strategy Factory
slice T2 resolves each role's last close under. Whether a declaration is true of the market is the binding author's
statement, as the availability rule is; Market Data refuses only a combination no bar can have. When a Session Owner
serves typed calendars, the schedule-bounded declarations can be checked against the instrument's session instead of
trusted.

The native engine's name for a schedule's bar is an encoding of the typed schedule, which stays the only meaning. The
engine admits a periodic step only - a `Second` or `Minute` step dividing 60 and an `Hour` step dividing 24, never
the whole of either (`BarSpecification::validate_step`) - so a fixed interval from the Unix epoch on a continuous clock
is named in the largest unit that divides its duration and that the engine admits: 24 hours is `1-DAY`, 60 minutes
`1-HOUR`, 48 hours `2-DAY`, and a duration no unit admits, such as 5 hours, refuses the frame as
`NativeRepresentation`. The name is exact because the engine takes these bars as `EXTERNAL`: it neither aggregates them
nor derives their instants from the name, and the rows carry their own times. A fixed interval on a trading schedule
keeps its own unit, and an exchange session day is named `DAY`, which the engine cannot tell from a UTC day; that is a
stated limitation until the engine models sessions. Because several typed bars share one name, a Replay's frame
sequence refuses two frames that name their bars alike but declare different bars, as
`NativeBarTypeCarriesTwoTimeframes`.

The structural `BarScheduleFactV1` codec underpins the CURRENT/PARTIAL durable PostgreSQL schedule authority. Its
canonical bytes are, in order: schema `u16LE = 1`, reserved-zero `u16LE`, canonical instrument as
`u16LE length || UTF-8 bytes`, predecessor-fact presence `u8` followed by its digest `[u8; 32]` only when present,
effective-from `i128LE`, effective-until presence `u8` followed by `i128LE` only when present, kind `u8`, positive
step `u32LE`, unit `u8`, anchor/calendar/session/time-zone identities `[u8; 32]` each, label `u8`, completion `u8`,
Instrument Master readback, fact, and cut digests `[u8; 32]` each, Market Semantics identity `[u8; 32]`, schedule
source and correction frontiers `[u8; 32]` each, and cut-effective instant `i128LE`. Absence/presence is exactly
`0x00`/`0x01`; trailing bytes, an empty instrument, zero required identity, unsupported tag combination, or empty or
inverted half-open effective interval is forbidden. Fact identity and digest are the same SHA-256 over
`market-data.bar-schedule-fact.v1\0 || canonical fact bytes`; there is no separately encoded schedule identity.
The Owner-local proposal supplies the effective interval, kind, step, unit, anchor, clock, label, and completion, but
it cannot itself mint authority. Preparation admits only a BAR row cross-bound to one exact native
`InstrumentMasterReadbackV1`; Market Data derives the time-zone identity from that readback, and the calendar and
session identities too for a trading-schedule clock, while a continuous clock binds both as zero; calendar and session
are both zero or both non-zero, and an exchange session day is never continuous. It rejects instrument, Market
Semantics, frontier, effective-containment, or Instrument Master mismatches.

The structural `BarScheduleCutV1` canonical bytes are schema `u16LE = 1`, reserved-zero `u16LE`, fact digest
`[u8; 32]`, the same canonical-instrument variable bytes, effective instant `i128LE`, then Instrument Master
readback, fact, and cut digests, Market Semantics identity, source frontier, and correction frontier, all `[u8; 32]`
in that order. The effective instant must equal the selected BAR row's event-effective instant. The Instrument
Master cut's effective instant must not be later than it, and both the schedule fact and Instrument Master fact
effective intervals must contain it. The Instrument Master fact that governs the instrument at that instant, as the
Owner resolves it at a cut taken at that instant, must be the fact the schedule's Instrument Master cut holds, compared
by fact identity; otherwise the schedule is refused. A window of frames shares one Instrument Master cut, and this
comparison is what lets its later BARs rest on that cut: a correction effective or observed between the cut and a BAR
resolves to a successor fact and refuses that BAR's schedule, while the superseded fact's interval still contains the
BAR and cannot. The current structural codec does not encode interval open/close or Owner observation/decision-cut coordinates;
those predicates remain TARGET/PENDING rather than inferred from this cut. Cut identity and digest are the same
SHA-256 over `market-data.bar-schedule-cut.v1\0 || canonical cut bytes`.

The structural `BarScheduleReceiptV1` is exactly 108 bytes: schema `u16LE = 1`, reserved-zero `u16LE`, fact digest,
cut digest, and store-generation identity `[u8; 32]` each, followed by positive store-append sequence `u64LE`. Its
identity and digest are the same SHA-256 over
`market-data.bar-schedule-receipt.v1\0 || canonical receipt bytes`. `BarScheduleReadbackV1` nests the exact fact,
cut, and receipt as schema `u16LE = 1`, reserved-zero `u16LE`, then for each artifact its identity `[u8; 32]`, byte
length `u32LE`, and canonical bytes. Its identity and digest are the same SHA-256 over
`market-data.bar-schedule-readback.v1\0 || canonical readback bytes`; its outbox identity is defined to equal the
receipt identity. The readback has no public constructor, `Clone`, or deserialization path. The current Owner has
BAR schedule fact, cut, receipt, outbox, and head tables; one atomic append/recovery path; fixed `SECURITY DEFINER`
exact and historical reads; reader ACLs; admitted capability issuance and revalidation; and a public startup
resolver. Byte-identical recovery returns the exact stored readback, while mismatch or tamper fails closed. This is
CURRENT/PARTIAL schedule custody and admitted read authority, not Dashboard, Backtest, composite, or other product
reachability. A caller locator, structural decode, or reconstructed bytes confers no schedule authority.

For initial Native Replay execution-input composition, the admitted Market Data read capability also exposes one
fixed request-bound operation. It resolves the PIT batch by the snapshot identity and fact digest already sealed in
the R&D Replay request, rebuilds the complete universe frame from the Plan-declared role schema and Owner batch
coordinates, then reads the complete BAR schedule history for each Master V2 canonical member. Market Data returns
exactly one schedule per member only when its canonical timeframe, half-open validity, cut instant, Instrument Master,
Market Semantics, source frontier, and correction frontier all equal that same batch and request window. Missing,
duplicate, overlapping, reordered, or corrupt candidates return no frame or schedule readback. The caller supplies
no schedule locator, account scope, latest selector, raw row, SQL, pool, credential, or replacement store.

**SUPERSEDED TARGET, Native Replay frame sequence V2:** PIT window custody below replaces this profile for
multi-frame Backtest; the sequence issuance and its tables have no caller, and Market Data deletes them with Strategy
Factory slice T1, their tables through a migration rather than only their code, while the frame and quote cut
censuses keep serving the snapshot path. The text remains the statement of the
invariants custody carries forward. The existing initial-frame
resolver, `StrategyInputUniverseFrameReceipt` V1, BAR schedule readbacks and
`NativeReplaySchedulingReadbackV1` keep their exact bytes and single-frame meaning. The additive
Owner-issued `NativeReplayFrameSequenceReadbackV2` is a move-only, request-bound capability. Its
V2 profile contains the sealed window's whole sequence of complete two-member BAR frames with their
own Owner-verified Quote EVENT liquidity: the first is the exact independently re-resolved
initial V1 frame; every later one is issued from a distinct Owner-verified PIT
snapshot and observation batch, never from copied values or a test successor. Market Data alone
resolves the complete eligible frame census for the sealed request window and decision cut. It
admits this profile only when that census holds at least two frames with distinct identities and
strictly increasing canonical event order, with no skipped eligible frame. A run consumes every
frame but the last, which is there to bound the liquidity of the one before it, so a window
holding a single frame consumes none and a longer window is a longer run rather than a refusal. Each frame carries its
own exact PIT snapshot/fact, batch, trigger, frame, source/correction lineage, native scheduling
and liquidity EVENT receipt identities. Each liquidity receipt seals the exact Owner-verified
Quote row digests, bid/ask prices and sizes, event/initialization times and member order from
that frame's quote cut: an Owner-verified PIT snapshot of its own, whose instant lies strictly
after the frame's BAR cut and strictly before the next frame's BAR cut. A PIT snapshot is one instant, so
the Quotes that follow a BAR cannot sit in that BAR's cut. A quote cut is not a frame: it takes
no frame ordinal, and exactly one lies between each consumed frame and its successor. Both
members' Quotes in it share its instant and follow canonical member order, which Backtest consumes
unchanged for elements that share a `ts_init`. The V2 sequence digest binds both complete
frame/schedule/liquidity receipt sets in canonical order and the request identity/window. Every frame's liquidity
EVENTs must precede the next frame's first BAR in native schedule order. All frames
retain the same canonical two-member universe, Design/role set, Instrument Master cut, timeframe,
venue and account scope. Market Data verifies each frame's successor relationship and
half-open validity against the one before it and rejects ambiguous correction branches or
observation after the request decision cut.

The resolver accepts only the sealed request-derived first-cut coordinates and Owner-authenticated
Plan roles; it reads the second cut and both native schedules from its own exact historical
custody. No caller-supplied second PIT locator, timestamp, frame list, raw row, price, quantity,
schedule, pool or replacement resolver is admitted. A missing, extra, duplicate, partial,
out-of-order, cross-request, cross-member, cross-lineage, stale, tampered or ACL-drifted frame
returns no positive V2 readback and performs no append. V2 sequence custody stores its
receipt/outbox and exact-locator readback atomically and append-only; exact same-meaning retry or
response-loss recovery re-resolves and re-verifies the whole sequence and returns byte-identical
historical bytes, while changed meaning conflicts without writing. Market Data does not issue
an R&D binding, Backtest Result, synthetic exit signal or trading order.

This V2 target's request-window frame census exists: every PIT snapshot fact commit takes the next
dense frame ordinal inside its scope, and the window readback and sequence resolver read it back in
that order. What the target lacks is a caller, and a caller alone would not be enough, as the end
of this paragraph records. Only a snapshot whose verified batch holds BAR rows takes a frame
ordinal; one holding Quote rows and nothing else is a quote cut, recorded in a census of its own
and never given an ordinal; one holding neither joins no census. The Owner reads this from the
batch it verified, never from the requester's scope claim, and resolves a frame's quote cut from
that census alone. Each quote cut lineage is read at one cut: the frame's own decision cut, the one
the sealed request names, or the cut the Owner published the lineage's original at when that is
later. An intake freezes its request at Market Data's decision cut, so a frame it mints sits on its
own decision cut and no quote cut that cut could see lies after it; the fill follows the decision,
as the custody quote cut below states for `d_k`, so a quote cut published after the decision is
still the frame's. The lineage is first reduced to its latest correction visible at its reading cut;
it serves the frame when that correction lies strictly between the frame's BAR and the bound at the
same cut, on the frame's scope, Instrument Master, universe selection, Market Semantics and Source
Binding lineage, and quotes exactly the frame's members. A lineage whose latest correction does not
serve the frame contributes nothing and never falls back to the version that correction replaced.
The Instrument Master is compared by the key each census row records: the digest of the facts the
intake resolved for the snapshot's members, which every request that resolves those facts shares.
It is never compared by the readback digest a batch carries, because every intake request resolves
a readback of its own, sealed over its correlation, event instant and decision cut, so no two
snapshots share one. A commit that resolves no facts (a test's or a sealed fixture's, never a
production path) keys its row by its request's digest, and a row recorded before the key existed has
none and serves no frame. Of the lineages that serve, the one read at the earliest cut is the
frame's, and two read at that cut refuse the frame. The
census is keyed by the scope a requester declares, so a second quote cut on every one of a
frame's coordinates, read at the same cut, collides with the first and refuses the frame - a denial
of service, never a quote cut the Owner did not verify for it. Each reading cut is fixed by the
census the Owner already holds, so a later reading resolves the same quote cut: a lineage published
at a later cut never displaces one that serves, and only one published on the chosen cut before the
Owner's clock leaves it can still collide with it. The bound at a reading cut is the first later
frame in the frame's scope census that the Owner had observed by that cut, or the window's end when
none lies before it; a frame observed later does not move it, and a frame published before a late
quote cut bounds it, which makes that quote cut the later frame's. The quote cut reaches only the
fill: the frame's strategy inputs are still bound from its own batch. The caller names none of
these. The existing PIT correction lineage records
revisions of one request; it is not a time-successor index and cannot prove a later frame or the
absence of skipped frames, which is why the census is its own table rather than a reuse of that
lineage. The current initial-frame resolver and QuoteTick projection do not themselves issue a
later frame or a separate liquidity receipt. The V1 native scheduling seal takes each member's BAR
from the frame's batch and each member's Quote from the frame's quote cut, every Quote on the quote
cut's instant and in member order. The Owner resolves the quote cut by the rules above from its own
custody and through the admitted store port, which reads both censuses through two measured census
functions. The V1 scheduling receipt states its member count first and binds the quote cut's
snapshot identity and fact after the frame's batch, so its bytes differ from those it had while it
took Quotes from the frame's own batch - bytes Owner custody never produced. The V2 frame evidence
seals every frame through that same seal, over one or two members, and its liquidity EVENT receipt
seals the quote cut's snapshot, fact and batch in place of the frame's. No proof yet drives a
complete initial read - schedules, universe and quote cut together - on Owner custody.

**TARGET, fill quotes for a source that publishes bars only, and the Owner clock that admits them:** nothing here is
built, and nothing is admitted until its slice is. A deployed Backtest over Binance perpetual history needs a fill quote
between every pair of frames and has none today: Binance publishes no historical quotes (`bookTicker` answers only the
current one), and a quote cut must sit on the frame's own Source Binding lineage. Every frame of such a Backtest is
therefore refused as `QuoteCutMissing`. The first Composer replay meets a second gap as well: it freezes its frame at
the frame's own instant, so its quote is retrieved after the Owner's clock head, and a snapshot retrieved after the
head cannot be admitted at all. It passes only through two named stand-ins: its Data Client builds Quote rows from
klines, and an extra `usdm/klines/4h` Source Binding admission moves the clock past the frame.
This design replaces both.

- **The fill comes from a finer bar of the same source.** A schema 2 Source Binding that declares the frame's bar may
  also declare a finer fixed-interval bar, which a PIT window custody request names as its fill timeframe, apart from
  the timeframes it holds for strategy inputs. Fill-timeframe rows serve the quote cut only: the derived view never
  selects them for a frame's inputs, because they are sparse, one bar per gap, and a strategy role reading that
  timeframe would otherwise see a stale fill bar. A fill timeframe that is not strictly shorter than the execution
  timeframe is refused by name as `FILL_TIMEFRAME_NOT_FINER_THAN_EXECUTION`, and in PIT window custody one whose
  declared interval is not exactly one minute (`FILL_BAR_INTERVAL_NS_V1`) as `PIT_WINDOW_FILL_TIMEFRAME_NOT_ONE_MINUTE`.
  For each frame the fill bar is the first fill-timeframe bar whose open instant lies strictly after the frame's
  availability instant - its BAR's event-effective instant plus the lag the binding's availability rule declares - and
  strictly before the next frame's BAR. In custody it is the quote cut derived for the gap `(d_k, e_{k+1})`; on the
  snapshot path, a PIT snapshot holding exactly that bar for each member, and nothing else, would be recorded in the
  quote census, never the frame census. Either way the Owner reads each member's Quote from the stored row: bid and ask are both the bar's open, both sizes are the bar's traded volume, and its instant is
  the bar's open instant. The caller states no price, size or instant; the Data Client delivers the kline as it
  delivers any bar.
- **Why it is not look-ahead.** Frame `k`'s decision can use nothing visible after its availability instant, and the
  fill instant lies strictly after it, so the price is one the market printed after the strategy could act. The next
  execution bar's open would not do: that bar opens at the frame's event instant, before the declared lag has passed,
  so it would fill at a price printed before the decision was possible. The research prototype filled at the next 4h
  open; a 1m fill bar keeps that intent and removes the lag. As with every quote cut, the fill quote reaches the fill
  path only and never a strategy input.
- **Why it re-reads.** The Quote is a fixed function of one immutable Owner-verified row, and a fill-bar quote cut is
  chosen by the same census and reading-cut rules as an observed one, so a later reading resolves the same quote.
- **It is the declared fill model, not a stand-in, and it says so.** A quote cut's identity carries its derivation -
  observed best bid and offer, or the open of a named fill-timeframe bar - and the Backtest result states it. It has no
  spread and no resting depth: its size is volume the market traded in that bar, not liquidity at the touch. Spread and
  slippage belong to Backtest's cost model, never to a number this Owner invents.
- **The Owner clock follows PIT intake.** A PIT intake whose observations were retrieved after the clock head mints the
  next cut itself, under the clock-state lock and inside its own commit, as an Instrument Master V2 snapshot admission
  already does, and refuses a retrieval later than the cut it minted. A V2 PIT submission therefore states no decision
  cut or clock: the Owner stamps them into the snapshot's time evidence and returns the cut in the receipt, where the
  requester reads it. The cut is still fixed before any reader sees the snapshot's data, so this relocates the
  requester's decision cut from the request to the receipt and removes no property. It also ends
  `ClockEvidenceNotCurrent` for V2 submissions, which an archiver moving the head hourly would otherwise make routine.
  A V1 submission keeps today's contract. R&D's frozen-request handoff changes with it, so this slice starts only with
  R&D's agreement to that change. Without it, any intake that retrieves after the head - a quote after a frame frozen at
  its own instant, or a real-time path - admits nothing until some other admission moves the clock. A historical
  ingestion does not need it: it reads the Owner's cut once and submits requests whose coordinates all lie at or before
  that cut.
- **A companion quote lineage, after U1.** A quote Source Binding admitted as the liquidity companion of one bar lineage
  may supply that lineage's quote cuts. The pairing is declared in the quote binding's proposal and enters its
  identity. It names the bar lineage's root, not a binding, so it survives the bar lineage's successors. Market
  Semantics identity, the time relation and the ambiguity refusal stay exact. It needs a deployment that runs two
  observation sources and a perpetual quote source, which no deployment has; Binance history needs neither, because the
  fill-bar quote cut serves it.
- **Source Binding successor admission, after U1.** `commit_source_successor` has test callers only, and no route or
  request field reaches it, so re-admitting a source today starts an unrelated lineage. It does not gate the companion
  lineage, which names a lineage root.
- **Admission does not check that a mapping is served.** Source Binding admission accepts any dataset mapping,
  including one no Data Client of the deployment serves, and a snapshot under such a binding is simply unavailable.
  That fails closed, but it lets an admission be used only for its effect on the clock, which is what the first
  Composer replay's stand-in does, with a mapping that is at least servable. The Owner clock following PIT intake
  removes the reason to do that. Checking a mapping against the deployment's Data Clients is recorded here and not
  admitted.
- **Slices, in order.** (1) The fill-bar quote cut, on U1's path, as part of T0's custody quote cut, because a
  multi-frame Backtest reads PIT window custody; the backfill then commits one fill bar per member per gap beside the
  window's bars. It needs no clock change. The snapshot-path form follows only if a snapshot-path consumer needs it. (2) The Owner clock
  follows PIT intake, after U1, for the paths that retrieve after the head. (3) The companion lineage and (4) successor
  admission, after U1 and in either order. The mapping check is not admitted.

**TARGET / IMPLEMENTATION_ADMITTED for slice T0, PIT window custody:** a multi-frame Backtest over backfilled history
reads one append-only PIT window custody instead of a snapshot per frame. The user admitted this on 2026-09-27, as the
Strategy Factory page's Strategy shape envelope quotes, including the one property it narrows: frames of a custody run
no longer each carry their own minting cut and trusted-clock evidence, so custody is admitted only for backfilled
history, and real-time decisions keep taking one snapshot per instant. A PIT snapshot remains one instant. The
snapshot path keeps its bytes, seals, censuses, and quote cut port; the verified batch seal and the quote cut read
each gain a custody view branch beside it.

Slice T0 is admitted for implementation, and only T0. The user authorized the design on 2026-09-27 in these words
(translated), as the Strategy shape envelope quotes them: "Switch to window custody. Backfilled history is placed in
custody once for the whole range; when each bar becomes visible is derived from the rule declared on the Source
Binding; real-time trading still takes a snapshot per instant. The user authorizes narrowing the scope of the property
that each frame carries its own minting evidence: in backtests, frames no longer each carry minting evidence, and only
backfilled history is admitted." T0 is the Market Data side alone: the two-layer custody (cross-section version
records and row facts under the successor sample fact schema), the cross-section correction model with its branch
refusal, the availability rule declared on the Source Binding, frame enumeration from the execution timeframe's Owner
BAR schedule, the derived view with its time evidence and identity, the `CustodyView` branch of the verified batch
seal, and the quote cut derived from custody. Of the Readers bullet below, T0 records the Market Semantics fact and
head, the Instrument Master cut, and Reference Fact R0 once per custody chain, because a custody view is read through
them; the declaration registry and the universe member composition basis follow in T1 with the readers that consume
them. A custody request states its member set and timeframes itself. Deriving that request from a Research scope and a
Design is slice T1's, as are the N-frame Backtest composition and every reader outside Market Data; T2
(multi-timeframe roles) and T3 (warm-up by role) stay not admitted here until their slices are. T0 adds no route,
production caller, or Backtest input, so until T1 is admitted nothing outside Market Data's own proofs mints or reads
a custody. Its proofs are the envelope's falsifiers that fall inside Market Data: N=1 and two single-timeframe frames
equal the snapshot path on the projection of values, coordinates, event times, bar types, and member order; two
custodies differing only in whether one correction publishes before `d_k` yield different frame `k` values, and
removing the publication condition turns that red, driven by a synthetic source that declares a correction stream; an
availability rule set to the minting instant hides every frame; and inputs and fill quotes select versions through one
function at two cuts, frame `k`'s inputs at `d_k` and a fill quote at its bar's availability, so an input-bar
correction published after `d_k` does not reach frame `k`'s inputs, a fill-bar correction published after its bar's
availability does not reach the quote, and moving either cut turns its side red. That last falsifier replaced, on
2026-10-04, one no custody can satisfy, that a correction published between `d_k` and a quote's availability reaches
the fill quote: a version's event, availability and publication never decrease, and a fill bar's event is its open
plus its interval, so no fill-bar correction is published at or before the quote's availability. T0 is not driven
until T1: it has no production caller, so a complete T0 is structurally present and run by no Backtest.

Built so far (T0-4a): the custody aggregate - the custody record, its cross-section versions and their `SampleFactV2`
row facts, every commit-time refusal, the Owner clock a commit mints, rejoin and successor custody - behind the sealed
`PitWindowCustodyCommitV1`, which `pit_window_custody_commit_from_environment_v1` opens on the Owner store. No
production caller reaches it yet: the unit tests of its pure authority and four PostgreSQL proofs in
`pit_window_custody_v1_tests` drive it. A commit fixes its minting cut under the clock-state lock and selects the
members' Instrument Master facts at that cut; it refuses a member another of whose facts is in force inside the
window, a row retrieved before its bar closed as `ROW_RETRIEVED_BEFORE_BAR_CLOSE`, a stated publication earlier than
its version's event or availability, and a version whose availability or stated publication is later than the minting
cut as `VERSION_NOT_AVAILABLE_AT_MINTING_CUT`. Every custody series is stated at a fixed scale of 9,
`MARKET_DATA_VALUE_SCALE_V1`: rows are rescaled to it exactly, and a row with more than 9 decimal places is refused as
`VALUE_FINER_THAN_SERIES_SCALE`, never rounded. The scale is fixed rather than taken from the instrument's tick
because ticks change over an instrument's history (`BTCUSDT` 0.01 to 0.10), so a tick's scale would refuse older
rows or split one series.
The timeframe identity a custody binds for a member is the one the BAR schedule path derives from the same declaration
and that member's Instrument Master fact, time zone included. The window schedule, the once-per-chain records and the
derived view are not built yet.

**TARGET, snapshot-path series scale:** a sample fact's series identity binds the value's scale
(`series_projection_bytes`, `crates/data/src/owner/sample_fact.rs` line 1263), while a PIT batch stores each value in
canonical form, refusing a nonzero scale whose mantissa ends in 0 (`decode_observation`,
`crates/data/src/owner/pit_snapshot/authority.rs` line 1613). The scale therefore varies with the value's last digit,
and one instrument and field splits into a new series on every bar whose last digit is 0. Custody is fixed by the
fixed-scale rule above, which is the snapshot path's fix too. The snapshot path keeps its bytes and is left for a
separate slice after U1: today's snapshot consumers each read one frame, so no series continuity depends on it yet.

Built so far (T0-4b): the window schedule fact. A root custody's commit mints one `PitWindowScheduleFactV1` per member
for its execution timeframe, in the same transaction and after every refusal: the member's timeframe identity and
declared shape, the interval and its phase (zero for a grid from the Unix epoch), the custody's window, Instrument
Master key and fact, Market Semantics identity and minting cut. Frames are the bar-close instants
`phase + n * interval` inside the window. A successor mints none and its chain reads back the root's schedules; a
rejoin or a refusal mints none, and no custody commit writes a `bar_schedule_*` table. No production caller reads it
yet; the derived view (T0-5) will. Its unit tests and the custody PostgreSQL proofs drive it.

Built so far (T0-4c): the records a root custody's commit mints once per chain, in the same transaction, after its
window schedules. A `ReferenceFactR0ChainRecordV1` and its cut cover the chain's whole window, from the window's
start to the end `r0_window_end_over_v1` gives the last frame's input timeframes (the execution timeframe among
them; the fill timeframe is not an input and is excluded, because its bar lies inside the gap the execution bar
already covers). A frame's own R0 is never stored: it is computed on read from the chain record, the window
schedule and `e_k`, and is refused unless it lies inside the chain record's window, so every frame's R0 lies inside
it by construction. The commit then issues a real Instrument Master cut on the clock it admitted, for exactly the
facts the custody selected at the window's start, and links the chain to it by a request identity that is a
function of the chain root alone, so one chain has one cut; the view seal's Instrument Master digest stays
`instrument_master_key`, which every row and schedule already carries, and the chain record maps that key to the
readback. It then records the chain's Market Semantics fact, under the compatibility scope its Source Binding
implies, from the typed value the request carries as an untrusted claim: the Owner refuses a chain whose claimed
value differs from any other head of its scope - a snapshot's or another chain's - by a new name,
`MarketSemanticsScopeValueConflict`, under the scope's own advisory lock. **Snapshot heads and chain heads therefore
coexist as two kinds of head under one compatibility scope.** The rule that one binding states one price adjustment
is kept across both: after every Owner commit, every head of a scope - snapshot or chain - carries the same value,
so `load_scope_heads` and `resolve_market_semantics_scope_value_v1` read the union of both kinds, never only one.
The chain's own closed registry entry is version 2 of the snapshot path's registry described above: its key is
over the chain's own dependencies - the compatibility scope, the chain root, the Instrument Master link and the R0
record and cut - instead of a snapshot's, so the property that one key maps to one value is relocated to the chain
rather than dropped. Last, the commit mints a chain basis record that binds the three once-per-chain records - the
R0 record, the Instrument Master link and the Market Semantics fact - to the chain root and its root custody; it
names no byte beyond their identities, since each is already verified against its own stored bytes by its own
readback. The chain readback composes all four: it decodes the basis record against its own bytes, reads the R0,
Instrument Master and Market Semantics records back through their own verified readbacks, and refuses as
`StoreUnavailable` unless every identity the basis names equals the one its own named record holds. A successor
restates all four exactly; it writes none, and its chain reads back its root's. No production caller reaches any of
this yet: the custody PostgreSQL proofs drive it.

Built so far (T0-5): the derived view, the frames port, the `CustodyView` seal, the admitted custody reads and the
native Replay custody frame branch. A run's frames are read from its chain's head: one per execution-grid instant `e_k`
inside the run, each with its decision cut `d_k`, and the run is refused as `PIT_WINDOW_FRAME_NOT_COVERED` unless every
frame is covered. `d_k` is the availability of the execution cross-section's original version (sequence 1), not of
the version a view selects: under `AtRetrieval` a successor's correction carries a later minting cut, and taking the
selected version's availability would make `d_k` depend on the selection it decides. A frame is covered only when
`d_k` precedes the next grid instant `e_k + interval`; a rule at the minting instant therefore hides every backfilled
frame. A frame's view takes, per input timeframe, the latest cross-section whose original is available by `d_k`, at the
highest correction published by `d_k`; a withdrawn one leaves the frame uncovered rather than falling back to an older
bar, and the fill timeframe is never an input. Each per-frame request pins the head its run was read from, so a later
successor never changes a run already enumerated, and a head outside the chain is `PIT_WINDOW_HEAD_NOT_IN_CHAIN`. The
view's time evidence names the root custody's minting clock: every original lives in the root, so `d_k` is an
instant of that clock, and a chain whose successors were minted on later epochs is not refused, since epoch
transitions are covered by `epoch_successor_proofs_v1`. The `CustodyView` seal verifies every row against the custody
record and the selected versions, and states each value in canonical form - custody stores every value at scale 9,
the batch admits only canonical decimals, so the view divides out trailing fractional zeros exactly, never rounding,
and the stored row, its digest and its identity keep scale 9. The native projection holds one precision for a bar's
four prices, so a bar whose canonical prices state different precisions - on BTCUSDT's 0.10 tick, a high of
65400.00 beside an open of 65000.10 - is refused as `NativeRepresentation`, as the snapshot path refuses the same rows.
Production reads go through their own admitted port, `into_pit_window_custody_snapshot_port_v1`, under
`PIT_WINDOW_CUSTODY_FLOOR_V1`, which opens only once a measured manifest carrying that floor is published. The native
Replay resolver gains a custody frame method beside the snapshot one, and each refuses the other's frame source. Its
quote cut is the T0-6 hook: until T0-6 derives the quote cut and the run-level `QuoteCutMissing` check, every gap is
refused as `QuoteCutMissing`, so a custody frame fails closed as `EventOrderUnavailable` and no Quote is invented. The
frames port does not check the gap yet. No production caller reaches any of this yet: its unit tests and PostgreSQL
proofs drive it, the N=1 and two-frame parity proofs with a quote cut injected through the resolver. Until T0-6,
a build with `sealed-strategy-input-acceptance` also opens an acceptance-only custody frame resolver,
`native_replay_custody_frame_resolver_for_sealed_acceptance_v1`, so a consumer can be driven over several custody
frames: it reads each frame through the same pool read, seal and frame issuance, and only its quote source differs - a
closure states each gap's Quotes, which the custody quote cut seal still checks against the gap, the members and the
custody view, and a gap it states nothing for is `QuoteCutMissing` as in production. T0-6's derivation replaces it,
and a result produced with it is not U1 evidence until it is re-run on that derivation.

Built so far (T0-5d): a build with `sealed-strategy-input-acceptance` also opens
`commit_sealed_acceptance_custody_chain_v1`, which commits a synthetic custody chain only through the production Source
Binding, Instrument Master V1, Universe Selection and custody intakes, so its output is production code run on
synthetic inputs and never U1 evidence. Its spec's fill timeframe must be exactly one minute, as every custody's is.
An ordered chain shares one store, so a member an earlier entry already admitted keeps its Instrument Master fact: the
fixture submits no rival genesis fact and names no predecessor, which would correct the earlier entry's instrument. The
custody binds the fact in force at its window's start, and the spec's bars must fit that fact's increments. The custody
intake also requires every member's fact to carry the custody binding's market semantics compatibility scope, so such a
chain names the earlier entry's binding semantics in the spec's `source_semantics`; a held fact under another scope is
refused by name as `HeldInstrumentSemanticsDiffer` before anything is committed. Sharing that scope, the chain also
states the earlier entry's value in `market_semantics_value`, or the custody intake refuses it as
`MarketSemanticsScopeValueConflict`. Its historical membership frontier
names the window, so two fixture chains over the same members are two memberships
(`postgres_a_member_already_admitted_keeps_its_fact`).

Built so far (T0-5b): a custody frame's readback carries its universe-frame sample projection, which Market Data derives
at read time from the `SampleFactV2` rows its view was sealed from and never stores, so a Plan with coordinate rows can
read a custody frame through the host's unchanged projection check. The derivation is stated under "universe-frame
sample projection" below.

Built so far (T0-6, T0-7 and the run-level quote check): the custody quote cut is derived from the gap's first fill bar
that opens strictly inside `(d_k, e_{k+1})` (`resolve_custody_quote_cut_v1`), at the version `select_fill_candidates_v1`
selects at that bar's own availability through the `visible_at` that selects frame `k`'s inputs at `d_k`. T0-6 first
took the bar's latest correction at the pinned head, however late it was published; T0-7 restored the bound. Each of
T0's four falsifiers has PostgreSQL proofs in the Market Data runner. N=1 and two-frame parity are
`postgres_a_one_member_custody_frame_equals_its_snapshot_frame` and
`postgres_two_single_timeframe_custody_frames_equal_their_snapshot_frames`. The correction published before `d_k` is
`postgres_a_correction_published_before_d_k_changes_only_frame_k`. The rule at the minting instant is
`postgres_an_availability_rule_at_the_minting_instant_hides_every_frame`. The two cuts are
`postgres_an_input_correction_published_after_d_k_never_reaches_frame_k` and
`postgres_a_fill_correction_published_after_its_bars_availability_never_reaches_the_quote`, both through the production
custody frame resolver, with `postgres_a_fill_bar_available_after_d_k_gives_its_gap_a_quote` as their positive control.
Moving the input cut to the quote's availability turns the first red, refused by the `CustodyView` seal before the proof
compares anything, and selecting the fill bar at the head turns the second red at its quote. T0 status: complete inside
Market Data. Every T0 falsifier inside Market Data is proved, and the frames port refuses a run any of whose gaps has no
quote as `QuoteCutMissing` before any frame is read, on the pool and admitted-port reads alike
(`frames_from_evidence_v1`). It applies `gap_fill_bar_position_v1`, the predicate each frame's quote cut applies, to the
candidates `select_fill_candidates_v1` selects for each gap
(`postgres_a_run_with_a_gap_without_a_quote_is_refused_before_any_frame_is_read`; dropping the run-level check turns it
red). Outside Market Data, the R&D Owner API's Binance backfill job commits custodies and its Backtest run reads a run's
frames through this port, and no Backtest consumes a frame yet.

Built so far (T0-8): the custody intake refuses an inconsistent bar. External market data enters Market Data at the
custody commit, so that outer boundary is where the bar's own consistency is checked, rather than later, when a frame is
built. The authority checks each member's bar of every original or correction cross-section version before any write,
after the exact rescale to `MARKET_DATA_VALUE_SCALE_V1`, so every comparison is between integers at one scale:
`low <= min(open, close)`, `high >= max(open, close)`, `low <= high`, `volume >= 0`, and `low > 0` for a class whose
prices are positive. Only a crypto perpetual takes that last term, because a future's, an option's or a synthetic's
price can be zero or negative; every custody member today is a crypto perpetual. A violation is refused as
`PIT_WINDOW_BAR_OHLC_INCONSISTENT` (`PitWindowCustodyRefusalV1::BarOhlcInconsistent`) and nothing is rewritten. A
withdrawal holds no rows, so the rule does not apply to it. A stored custody whose bar the rule refuses is refused on
resubmission rather than rejoined. The Binance backfill writer treats the refusal as a writer defect and never retries
it: the venue's data is inconsistent or the writer misread it. The Operations read for legacy rows is the
crate-private `list_inconsistent_custody_bars_v1`. It applies the same pure predicate (`bar_is_consistent_v1`) to every
stored custody bar, decoded from its `SampleFactV2` row facts, with each member's class from the Instrument Master
readback its chain root linked. It returns each one as `(chain_root, custody_identity, version_identity, member,
event_ns)`. It only reads and never rewrites, and it has no route. No deployed custody holds an inconsistent bar,
because Binance archive bars are consistent, so it is expected to list nothing in production. The authority's unit tests
refuse each term by name and admit the boundary (one price for all four, no volume).
`postgres_every_custody_refusal_writes_nothing` proves the refusal writes nothing against a snapshot of every Owner
table, and `postgres_the_legacy_listing_finds_an_inconsistent_stored_bar_and_writes_nothing` proves the listing finds a
bar committed through a test-only seam that admits it as the intake did before the rule.

Built so far (T0-9): the H6 checks a custody run needs and the accessors T1 consumers read.

- **Lineage at commit (H6 D).** The custody commit refuses a Universe Selection record whose
  `source_binding_lineage_root` or `correction_frontier_digest` is not the named Source Binding's own lineage root and
  correction frontier digest. The refusal is `UNIVERSE_SELECTION_LINEAGE_MISMATCH`
  (`PitWindowCustodyRefusalV1::UniverseSelectionLineageMismatch`), a basis refusal for the backfill writer. It is the
  custody path's counterpart of the snapshot path's universe member composition basis check.
- **Lineage on read.** The basis read applies the same check against the chain R0 record's Source Binding. The
  production backfill passes it because the kline dataset's Source Binding is admitted once, through its dataset
  anchor (`market_data_private.source_binding_dataset_anchors_v1`). The universe record and the custody basis
  therefore cite the same lineage.
- **Read-time cross-checks (H6 F).** The basis read also checks the chain records against each other, not only against
  the root custody. The chain Market Semantics fact must name the R0 record and cut and the Instrument Master link's
  cut. Its Source Binding identity, fact digest, lineage root, lineage version and both frontier digests must equal
  the R0 record's. One commit writes these records consistent, and a read that finds otherwise answers
  `StoreUnavailable`.
- **Frame R0 (H6 E).** Each frame a run reads carries its Reference Fact R0 as
  `PitWindowFrameCoordinateV1::r0() -> PitWindowFrameR0V1`, with these accessors:
  - `window_start_ns() = e_k`;
  - `window_end_ns_exclusive()`;
  - `identity()`;
  - `chain_record_identity()`.

  The frame's R0 is computed on read from the chain R0 record, the window schedule and `e_k` alone. The record's end
  is `r0_window_end_over_v1` at the window's last frame, so the span past that frame is the longest input interval,
  and each frame's R0 is the one the same rule gives at its own `e_k`. The admitted custody read therefore needs no
  read of the Source Binding's declarations. A frame with no R0 is a store no commit wrote, so the run answers
  `StoreUnavailable`.
- **A dataset names its custody, not the caller (coverage lookup).**
  `PitWindowCustodyFramesV1::resolve_pit_window_run_for_window_v1(instrument, execution_timeframe, start, end)`
  returns the `UntrustedPitWindowRunV1` over `[start, end)` of the one custody chain that holds that instrument alone
  at that execution timeframe and covers the whole window, with the chain's current head pinned. A consumer names a
  plain dataset, `(instrument, timeframe, window)`, and never a chain root.
  - **Candidates.** They come from the window schedule facts, read through the admitted custody port
    (`resolve_pit_window_chains_for_instrument_v1`, inside the custody floor). A candidate matches when it holds one
    member and its execution interval is the timeframe's (`execution_timeframe_interval_ns_v1`).
  - **More than one covering chain.** The one whose root was minted last is named, which is the latest backfill of
    that window. Between roots minted at the same cut, the lowest chain root is named. The choice is never arbitrary.
  - **Refusals, each by name:**
    - `CustodyNotFound`: no matching chain;
    - `WindowNotCovered { missing }`: the window has parts no chain covers, and `missing` lists them in order;
    - `CoveredOnlyAcrossChains`: chains together cover the window but no single chain does, and a run reads one;
    - `InvalidRequest`: an empty window or an unsupported timeframe.
  - **Verification.** The returned run is verified by `resolve_pit_window_frames_v1`, exactly as a run a caller
    names itself.
- **The sealed acceptance custody frames port.** A build with `sealed-strategy-input-acceptance` also opens
  `pit_window_custody_frames_for_sealed_acceptance_v1(reader_url)`. It is the same `PitWindowCustodyFramesV1` (a run's
  frames and the coverage lookup), with the same raw reads, verification and selection as the admitted port, but no
  Store Admission before or after a read, so it proves the segment after admission; the admission itself is `B3`.
  - **Store.** It opens only on a disposable loopback `vibe_test_` database.
  - **Grants.** The principal holds exactly `grant_pit_window_custody_acceptance_reads_v1`: `USAGE` on
    `market_data_admitted_read` and `EXECUTE` on the chain, chain basis, Universe Selection and
    chains-for-instrument wrappers, with nothing on `market_data_private`. Its proof revokes each grant alone and
    requires exactly the read that needs it to be refused.
- **Availability rule (H7).** `PitWindowChainBasisV1::availability_rule_digest()` returns the root custody record's
  rule digest, which the read has already checked against the chain R0 record's.
- **Pinned-head run read.** `UntrustedPitWindowRunV1` takes an optional `head_identity` (serde-defaulted, omitted when
  `None`). Given one, the frames port reads the chain truncated at that head: its frames, basis, frame R0s and
  run-level quote check are the ones that head held. This is the same pinned read a frame's view takes
  (`verify_chain_evidence_v1`'s pinned head). A head that is not a custody of the chain is refused as
  `PIT_WINDOW_HEAD_NOT_IN_CHAIN` (`PitWindowRunRefusalV1::HeadNotInChain`). Every head of a chain restates the
  root's window, so a run inside the window is inside it at every head. Without a head, the port reads the current
  head as before. A consumer that pinned a head at binding passes it back on every later read, so a daily backfill
  moving the head never refuses those reads.
- **Proofs.**
  - `postgres_every_custody_refusal_writes_nothing` refuses a universe evaluated over another binding and checks that
    nothing is written.
  - The authority's unit tests refuse a moved lineage root and a moved correction frontier by name.
  - The frame R0 unit test pins the first and last frames' R0 and the off-grid refusal.

TARGET (T0-10): a custody run's Design is declared over its own custody frame.

The ruling of 2026-10-05 (Lane 3, recorded in `docs/architecture/strategy-factory.md` under "H2/H4 for a custody run")
says a custody run's Design binds its universe from the chain, not from the initial PIT snapshot. The code fixes what
that means:

- **Per-frame resolution already requires it.** It composes each frame's universe-member binding requests over that
  frame's custody view and requires the frame's strategy-input `selection_identity` to equal the run's. That identity
  is the hash `derive_universe_selection` takes over the Instrument Master digest, the Source Binding lineage root,
  the Market Semantics identity and the members.
- **A snapshot-declared Design cannot match.** A Design declared over the initial PIT snapshot carries the snapshot's
  Instrument Master cut, so it never matches a custody frame.
- **The Design is declared over a custody view.** Its roles are declared over the run's first custody frame, sealed
  as a `VerifiedPitObservationBatch` whose source is `CustodyView`.
- **The snapshot is kept for the goal.** The initial PIT snapshot still serves Research goal admission for both data
  paths.

The work, in order:

- **(a) The admission entry.**
  `StrategyInputBindingAdmissionV1::admit_published_design_over_custody_run(design_identity, run)`.
  - **Input.** It takes the run the coverage lookup names, with its head pinned.
  - **What it reads.** It reads the run's first frame view at that head, and seals it through the same custody-view
    seal the native resolver uses.
  - **How it declares.** It composes every role's request over that batch with the existing
    `compose_binding_request_v1`, which already carries a `CustodyView` source. It then registers them write-once
    beside the snapshot path, under the same coverage rules and terminal.
  - **What the terminal carries.** The terminal's coordinate is the view's request identity, which is its view
    identity, and the view's decision cut.
- **(b) The declaration registry's custody arm.**
  - **Today.** `resolve_and_bind` re-resolves every dependency the snapshot way: the batch by snapshot identity, the
    Universe Selection record by digest, the source, the Market Semantics head, and the Instrument Master.
  - **A custody-sourced request resolves through the chain instead.**
    - **The batch.** The view is re-read at the head whose frame view has the request's view identity, found by walking
      the chain from its head toward its root, so a later correction never refuses an earlier declaration.
    - **The other dependencies** are the chain basis's: its Universe Selection record, its R0 record's Source Binding,
      its Market Semantics fact, and its Instrument Master cut. The chain basis read already verifies each of these
      against the root custody.
  - **Validation.** Each is checked against the request exactly as the snapshot arm checks its own, and nothing is
    stored unless every one agrees.
  - **No silent drop.** A request with any other source stays refused.
- **(c) The persisted-custody reread's custody arm.**
  - **What it serves.** `reread_persisted_strategy_input_universe_custody_for_update_v1`, which H8 reaches through
    `reread_design_input_custody_v1`, re-resolves the declarations' batch through the same custody arm.
  - **Under `rd_owner`.** That principal reads only `market_data_rd_api`, so the arm needs that schema's
    custody-view and chain-basis read functions and their grants.
  - **No deployment script change.** `database/postgres-init` already grants `rd_owner` `USAGE` on
    `market_data_rd_api` and strips that schema's functions only from other roles. Each function's `EXECUTE` comes
    from the Owner migration's own `GRANT ... TO rd_owner`, as every other `market_data_rd_api` function's does.
- **(d) The run's own check (Lane 5).**
  - **What it compares.** H8's check compares the Design's bound Instrument Master digest, Market Semantics identity
    and members with the chain basis's.
  - **What it does not compare.** It does not compare the strategy-input selection hash with the Universe Selection
    record's identity, which is another domain.
  - **When it passes.** Once (a) to (c) hold, the custody run's chain entry answers `custody_binding.is_some()`.
  - **Where the universe property now lives.** The property that a custody run's strategy universe selection is the
    chain's selection is relocated, not removed. The H8 cross-domain comparison #1411 deleted held it before.
    Per-frame custody resolution now proves it: every frame requires the Design's strategy-input `selection_identity`
    to equal the one derived from that frame's custody view. (a) makes that identity the first frame's own, so a
    Design whose universe differs from the chain's is refused at its first frame.

Proofs:

- **Write-once.** PG proofs that a custody-declared Design registers write-once and rejoins.
- **Survives a later head.** A declaration made at one head re-resolves after a correction moved the head.
- **Refusals.** A request whose view, Universe Selection record, Source Binding, Market Semantics fact or Instrument
  Master cut disagrees with the chain is refused by name, and nothing is written.

Built (T0-10 (a) and (b)):

- **The entry.** `admit_published_design_over_custody_run` reads the Design's role intent as the snapshot path does.
  It then composes over the first frame of the run at its pinned head (`register_custody_design_roles_v1`).
- **Refusals before composing.**
  - A run with no pinned head is refused as `CUSTODY_HEAD_UNPINNED`, because two admissions could otherwise compose
    over different views.
  - A run whose frames cannot be read is refused as `CUSTODY_RUN_UNAVAILABLE`.
- **The storage codec.** A custody-view declaration is stored under its own codec version, 2, whose layout differs from
  version 1 only in the source. Snapshot declarations keep their bytes and every digest over them.
- **One declaration per view.** A declaration is keyed by its view's request identity. The same Design over another
  run or head is therefore another declaration at that view's coordinate, not a conflict.
- **The registry's custody arm.** It re-reads the view by walking the chain's custodies from the head toward the root,
  and checks the Universe Selection record, Instrument Master key and Market Semantics identity against the chain
  basis. The Source Binding is checked when the role binds against the sealed view.
- **Proofs.** The three `custody_strategy_input_v1_tests` PG proofs.

Built (T0-10 (c)):

- **The wrappers.** Four `market_data_rd_api` functions pass through to the private chain, rows, chain-basis and
  Universe Selection functions the admitted port reads through `market_data_admitted_read`. They are granted to
  `rd_owner`.
- **Why no lock.** Custody rows are append-only but for the chain head, and the reread walks custodies rather than
  reading the head, so the wrappers are `STABLE` and take no lock.
- **The transport check.** `verify_rd_replay_cut_transport_v1` verifies them as it verifies the locking functions:
  owner, definer, exact source, volatility, and `EXECUTE` held by `rd_owner` alone.
- **One decoder.** The reread decodes their rows with the admitted port's decoders, and the view through the same
  `resolve_pit_window_view_from_raw_v1` the port uses, so both principals verify the same evidence the same way.
- **Proof.** `postgres_the_rd_owner_reread_answers_what_the_owner_reread_answers` runs the wrappers as the Owner, which
  owns them. It shows they return the same sealed view and basis as the Owner's own table read, walking past a
  corrected head, and the same refusal for a view the chain does not hold.
- **The grant path.** The path as `rd_owner` itself is proved by the R&D chain's custody entry.
- **The reread.** The reread under `rd_owner` returns the custody frame the declaration was made over.

- **Custody:** covers the half-open window from its warm-up start and is committed once, then never mutated. A later
  correction is a successor custody that names its predecessor and carries only the versions it adds; a view reads the
  chain to its head. A successor restates its predecessor's basis exactly - Market Semantics fact, Universe Selection
  record, Instrument Master cut, member set, and availability rule digest - and a changed basis is a new root custody,
  never a successor, so one chain never mixes two bases. The correction unit is a cross-section - every row of one
  source, timeframe, and event-effective instant - with a correction sequence, predecessor, and publication instant,
  because a frame's rows must share their time and correction coordinates. Two versions naming one predecessor, a
  repeated sequence, or a publication that does not increase with the sequence is an ambiguous branch. Custody has two
  layers: a cross-section
  version record carrying the lineage, branch refusal, and head rules `SampleFactV1` already states, and immutable row
  facts that are members of one version under a successor sample fact schema. That schema replaces the source snapshot
  fields with the cross-section version identity and row digest, and its root slot hashes the series and
  event-effective instant without a snapshot digest, so one bar's corrections across retrievals form one chain.
  `SampleFactV1` bytes are never reinterpreted. Row identity - Owner event identity, sample slot, and coordinate - is
  therefore keyed by the custody row, never by a derived view, so one higher-timeframe bar carries the same coordinate
  bytes in every frame that reads it. Under that schema the series head advances once per event-effective instant, its
  sequence by one and its event strictly later, and each slot's correction head advances by the cross-section's
  correction sequence. `SampleFactV1` takes a row's series sequence from its correction sequence, a rule that cannot
  chain the bars of a source publishing no corrections, so the successor schema states both chains itself.
- **Publication:** a cross-section's publication instant is observed only from a source that publishes corrections.
  A source that does not, which is every admitted source today, keeps one version per cross-section whose
  publication equals its availability instant, and a successor version for it is refused by name as
  `CROSS_SECTION_CORRECTION_NOT_PUBLISHED_BY_SOURCE`. Nothing constructs that refusal today, because no custody
  exists; the correction falsifier is driven by a synthetic source that declares a correction stream.
- **Availability:** the instant a row becomes visible is derived from a rule declared on the Source Binding, such as
  bar close plus source lag, never from the requester's stamped `provider_available`. The rule's digest enters the
  custody identity. No-look-ahead rests on this rule, which is a declaration rather than an observation. A declared
  lag that is not strictly below the execution bar interval cannot satisfy `d_k < e_{k+1}` and is refused by name as
  `AVAILABILITY_LAG_NOT_BELOW_BAR_INTERVAL`; nothing constructs it today. The rule is declared by a Source Binding
  proposal of schema 2, together with whether the source publishes a correction stream. It is either a lag after the
  row's bar closes or the retrieval instant itself, the second for a source that states nothing earlier; set to the
  retrieval instant, a custody minted today shows no frame of its window. Its digest is taken over the rule alone, so
  a binding successor that keeps the rule keeps the digest, while the binding identity still hashes each cut's
  frontiers and time evidence. A schema-1 binding declares no rule and refuses a custody by name as
  `SOURCE_BINDING_DECLARES_NO_AVAILABILITY_RULE`, which nothing constructs until custody commits exist and the T0
  proofs then drive.
- **Members:** the member set is fixed for the whole custody. A member whose Instrument Master validity or Universe
  membership begins or ends inside the window refuses the custody by name, as `WINDOW_MEMBER_NOT_VALID_THROUGHOUT`.
- **Frames:** enumerated from the execution timeframe's Owner BAR schedule, never from custody rows. Frame `k` has an
  event instant `e_k` and an availability instant `d_k`, with `d_k < e_{k+1}`; a frame with no complete cross-section
  refuses the run as `PIT_WINDOW_FRAME_NOT_COVERED`. `d_k < e_{k+1}` holds only when frames sit at bar-close instants,
  so T0 refuses an execution timeframe labelled at interval open as a malformed request. The execution timeframe is a fixed interval, enumerated from the
  phase instant the window schedule fact records, such as midnight UTC for a daily bar or Monday midnight UTC for a
  Binance weekly bar; a session-based execution timeframe is refused by name as
  `PIT_WINDOW_EXECUTION_TIMEFRAME_NOT_FIXED_INTERVAL`, which nothing constructs until custody commits exist and the T0
  proofs then drive. That is a scope limit, not a property: a session-based timeframe, such as an exchange-session
  daily bar for gold, needs a later slice that expands sessions, and is refused until one exists. The schedule is a
  window schedule fact that the custody's own commit mints over the whole window, since a schedule fact today is
  minted from one batch row.
- **Derived view:** for frame `k`, Market Data selects, for each source, the execution timeframe's cross-section at
  `e_k`, and for every other timeframe the latest cross-section whose availability is at or before `d_k`; in each it
  takes the highest sequence published by `d_k`, drops a withdrawn one, and refuses a branch. A frame for which a
  declared timeframe has produced no cross-section yet, such as during warm-up, refuses the run as
  `PIT_WINDOW_FRAME_NOT_COVERED`. The view's decision cut is `d_k`,
  its order check is event ≤ available ≤ publication ≤ `d_k`, one derived frontier digest covers its uniform
  fields, and its identity is SHA-256 over the selected cross-section version identities, the availability rule
  digest, the view schema version, and `e_k`, so a correction changes only the views that select it. Its time
  evidence names the Owner clock identity and epoch the custody was minted under, and `d_k` is an instant of that
  clock. The custody's own minting cut and retrieval instants stay in custody evidence.
- **Seal:** `VerifiedPitObservationBatch` gains a source, committed snapshot or custody view, and loses its direct
  snapshot identity and fact digest accessors, so the compiler lists every reader keyed by a snapshot. The custody
  view constructor is sealed like the snapshot one and has its own `compile_fail` and tamper tests.
- **Readers:** everything that is one per snapshot today is one per custody chain, and nothing is keyed by the first
  frame's snapshot. The Market Semantics fact and head, the Instrument Master cut stamped at intake, the declaration
  registry, and the universe member composition basis are each recorded once per custody chain; sample slots are
  keyed by the series and event-effective instant each custody row carries, so a correction in a successor custody lands in the
  same slot. Reference Fact R0 is stored once per custody chain over the whole window, and a frame's R0 is computed on
  read from it with no stored per-frame locator. The PIT evaluation evidence read derives from custody, and the BAR
  schedule check becomes a window schedule fact whose interval contains `e_k` with its effective start, the custody
  window's start, at or before `d_k`. The custody's minting cut stays custody evidence and is not compared with `d_k`:
  under the narrowing the user authorized on 2026-09-27, frames no longer carry their own minting evidence and only
  backfilled history is admitted, while the window grid is the Source Binding's declaration, knowable before any frame.
  Every table and function those reads touch is inside the admitted-port measurement.
- **Quote cut:** derived from custody inside `(d_k, e_{k+1})`, exactly one per gap, on one instant, in member order,
  taking no frame ordinal, and never the version a later correction superseded. Its version is the highest sequence
  published at or before the quote's own availability, which is the availability of its fill bar's original version,
  selected by the same rule that selects frame `k`'s inputs at `d_k`: the fill follows the decision, and at `d_k` no
  quote could qualify, since its event follows `d_k`. A correction is published after the version it replaces, and an
  original at or after its own availability, so no correction ever reaches a fill quote: a fill uses the version known
  when its bar became available. The quote's instant is the bar's open - its close less the fill timeframe's declared
  interval, which the custody commit holds to exactly one minute, `FILL_BAR_INTERVAL_NS_V1`, refusing any other as
  `PIT_WINDOW_FILL_TIMEFRAME_NOT_ONE_MINUTE`, since no custody record carries the fill timeframe's declaration - and it
  states the selected version's availability and publication; a bar available only at or after the gap's bound gives
  the gap no quote cut.
- **Interface:** `crates/data/src/owner/pit_window_custody_v1.rs` freezes what a backfill writer commits and how a
  multi-frame consumer finds a run's frames. The custody aggregate implements its commit port and alone constructs a
  receipt; until the derived view implements its frames port, nothing constructs a frame coordinate.
  - A custody request names its Source Binding, Market Semantics fact, Universe Selection record, one or two members,
    window, execution timeframe, input timeframes and an optional fill timeframe. The execution timeframe is named by
    the custody, not by a run, because the custody's commit mints the window schedule; a lag not below its interval is
    refused at commit, and so is a fill timeframe not strictly finer than it. A fill timeframe that is also an input
    timeframe is refused by name as `FILL_TIMEFRAME_IS_AN_INPUT_TIMEFRAME`, since fill rows would then reach strategy
    inputs. `WINDOW_MEMBER_NOT_VALID_THROUGHOUT` covers both the Instrument Master validity and the Universe membership
    the request names.
  - Each cross-section version states its kind - original, correction or withdrawal, a withdrawal carrying no rows -
    its sequence and the version it replaces. Its publication instant is stated only by a source that publishes
    corrections; for any other the Owner derives it as the version's availability, and a stated one is refused as
    `CROSS_SECTION_CORRECTION_NOT_PUBLISHED_BY_SOURCE`.
  - Each row carries the true instant it was retrieved and from where, as custody evidence outside every identity, so
    the same versions resubmitted with other retrieval evidence rejoin and return the original receipt and minting
    cut. Under an availability rule set to the retrieval instant, a row's availability is the custody's minting cut,
    never a caller-stated retrieval, and a row retrieved after that cut is refused as `RETRIEVAL_AFTER_MINTING_CUT`.
  - A run names a custody chain by its root, as an untrusted claim the Owner resolves to the chain's head, and states
    its own window inside the custody's. Its frames come back as coordinates - ordinal, `e_k` and `d_k`, where `d_k` is
    the derived availability of frame `k`'s execution cross-section - read from the head it names, together with the
    chain's basis, read in the same transaction at the same head. R&D takes a custody run's universe, Instrument Master
    cut and Market Semantics from the run's frames readback, never from its own evaluation. The basis also names the
    Universe Selection record the root's locator resolves to in that transaction, by record identity and digest with
    the locator's meaning digest checked, and a run whose record is missing or disagrees is refused as
    `StoreUnavailable`. The basis also selects a member's UNIQUE venue/source mapping from its own Instrument Master
    cut for the V1 structural public terms projection, refusing by name, never a pick, when the member is unknown to
    the basis or its fact carries zero or more than one mapping. Each frame's inputs and quote cut are then resolved
    through the native Replay resolver, whose request gains a custody frame source in
    the derived view slice. That source names the chain root, the head the frames were read from and `e_k`, so a
    correction committed between enumeration and the per-frame reads cannot mix two heads into one run; a head that is
    not in the chain is refused. Every gap has its quote cut, the last bounded by the run's end, and a gap without one
    refuses the run as `QuoteCutMissing`.
  - A batch's source is a committed snapshot, a custody view or a custody quote cut. A custody view names its chain's
    root, not its head, with its view identity, `e_k`, `d_k` and derived frontier, so a correction changes only the
    views that select it. A custody quote cut holds Quote rows only, never fill bars, and names its derivation.
  - Event rows such as funding settlements are not held by T0: one binding states one availability rule, and they have
    no bar close to anchor it. They enter a custody later under a binding of their own.

In the CURRENT/PARTIAL BAR schedule path, only a custody-verified readback may authorize the additive immutable
`TimeframeProjectionReceiptV1` keyed by the exact V1 binding-receipt digest. Its existing canonical bytes and domain
remain unchanged: schema `u16LE = 1`,
reserved-zero `u16LE`, V1 binding-receipt digest `[u8; 32]`, timeframe identity `[u8; 32]`, and the complete
fixed-width canonical `TimeframeSpecV1` bytes, with SHA-256 domain
`market-data.timeframe-projection-receipt.v1\0`. The same V1 digest plus byte-identical projection is idempotent;
different bytes conflict. Missing, ambiguous, non-unique, or non-durable schedule readback is unavailable. No
consumer may parse `1D`, `1h`, another label, venue convention, or default into a spec. Exact historical schedule
and projection readback remains available after later Owner mapping or calendar changes; those changes require a
new Owner schedule fact/cut and cannot be smuggled through a free-form binding label.

`SampleFactV2` is the row fact of a PIT window custody (slice T0), a successor schema beside V1 whose bytes are never
reinterpreted. Its canonical bytes start with schema `u16LE = 2` and reserved-zero `u16LE`, then bind, in order:
series identity, slot identity, series-predecessor sample identity (all zero at a series root), optional
correction-predecessor sample identity, series sequence `u64LE`, correction sequence `u64LE`, cross-section version
identity, canonical-row digest, Owner event identity `[u8; 16]`, instrument, channel and data-kind codes, field
semantic, timeframe identity, value semantic, unit, fixed-I128 value mantissa and scale, event-effective, available,
and publication times `u64LE`, Source Binding identity, lineage root and version, source-frontier digest, correction
stream, correction-frontier digest, Instrument Master digest, and Market Semantics identity; a variable field is
`u16LE length || bytes`. The fact digest is SHA-256 over `market-data.sample-fact.v2\0 || bytes`, and the sample
identity is SHA-256 over `market-data.sample.identity.v2\0 || fact digest`. The series identity is V1's, so a series
names the same thing under both schemas. The root slot is SHA-256 over
`market-data.sample-slot.identity.v2\0 || series identity || event-effective u64LE`, naming no snapshot and no
version. The Owner event identity is the first 16 bytes of SHA-256 over `market-data.sample-event.identity.v2\0` and
schema `u16LE = 2`, reserved-zero `u16LE`, cross-section version identity, canonical-row digest, event-effective,
available, and publication times, correction sequence, and correction stream. A new bar takes its event's root slot,
correction sequence 1, and the next series position, and its event must follow the series head's; a correction keeps
its bar's slot and series position, its correction sequence must be the slot head's plus one, and its publication must
follow the slot head's. Each is refused otherwise, as `EventNotAfterSeriesHead`, `CorrectionSequenceNotNext`, or
`PublicationNotAfterCorrection`, and a stored V2 fact whose slot, event identity, or chain position does not follow
from its own row is refused.

The `Owner event identity` carried by `SampleFactV1`, `SampleReceiptV1`, and the 308-byte coordinate is a new
role-independent Market Data identity; it is not the existing V1 frame-trigger event identity. Its canonical
preimage is, in order: schema `u16LE = 1`, reserved-zero `u16LE`, source snapshot identity `[u8; 32]`,
source-snapshot fact digest `[u8; 32]`, observation-batch digest `[u8; 32]`, canonical-row digest `[u8; 32]`,
logical time `u64LE`, event-effective time `u64LE`, provider-available time `u64LE`, retrieval time `u64LE`,
correction-publication time `u64LE`, Owner sequence `u64LE`, correction-stream `u16LE length || bytes`, and
correction-frontier digest `[u8; 32]`. The identity is the first 16 bytes of SHA-256 over
`market-data.sample-event.identity.v1\0 || canonical preimage`; an all-zero result, alternate encoding, or a
coordinate that does not equal the referenced historical Owner row is unsupported. No Design, role, static
binding, trigger, frame, join, or consumer field enters this preimage.

`SampleFactV1` is the immutable Owner fact for one series slot. Its canonical bytes start with schema `u16LE = 1`
and reserved-zero `u16LE`, then bind, in order: series identity, slot identity, series-predecessor sample identity,
optional correction-predecessor sample identity, source snapshot identity, source-snapshot fact digest,
observation-batch digest, canonical instrument bytes, channel, data kind, field-semantic bytes, timeframe identity,
Owner event identity, logical time, event-effective, provider-available, retrieval, correction-publication, Owner
sequence, value-semantic bytes, exact value bytes, scale, canonical-row digest, Source Binding identity, Source
Binding lineage root, lineage version, source-frontier digest, correction-stream bytes, correction-frontier digest,
Instrument Master digest, Universe Selection digest, and Market Semantics identity. Fixed identities/digests are 32
bytes, Owner event identity is 16 bytes, time/sequence/version fields are `u64LE`, channel/data-kind/scale are `u8`,
optional absence/presence is `0x00`/`0x01`, and variable bytes are `u16LE length || bytes`; reserved or trailing
bytes, oversized values, and alternate encodings are forbidden.

The version-1 channel tag registry is exhaustive: `0x01 MARKET`, `0x02 REFERENCE`, and `0x03 ECONOMIC`. The
version-1 data-kind tag registry is exhaustive: `0x01 BAR`, `0x02 QUOTE`, `0x03 TRADE`, and `0x04 SCALAR`.
These tags are the sole canonical encoding of the unchanged V1 Owner strings returned by
`StrategyInputChannel` and `MarketDataFieldSemantic.data_kind`; the exact historical V1 binding/event value
selects the tag, never the consumer. `0x00`, every unlisted tag or string, a tag/string mismatch, and any later
registry value presented under schema version 1 are unsupported and produce no fact, series identity, receipt,
EVENT V2 coordinate, or BAR V3 coordinate. Extending either registry requires a successor schema version rather than reinterpretation of
stored version-1 bytes.

The version-1 series projection is one ordered Owner-derived codec. Its bytes are schema `u16LE = 1`,
reserved-zero `u16LE`, canonical instrument variable bytes, channel tag `u8`, data-kind tag `u8`, canonical
field-semantic variable bytes, timeframe identity `[u8; 32]`, the exact
`strategy.input.fixed-i128-le.v1` value-semantic variable bytes, the exact V1 unit variable bytes (`PRICE`,
`QUANTITY`, or `SCALAR`), scale `u8`, Source Binding lineage root `[u8; 32]`, correction-stream variable bytes,
and Market Semantics identity `[u8; 32]`, in that order. Each variable field uses the same `u16LE length || bytes`
encoding as `SampleFactV1`. Every member is copied from the exact historical V1 Owner binding/event or its
historical timeframe projection; a consumer supplies none of them. Exact value bytes, slot/predecessor,
snapshot/fact/batch, Owner event/time/sequence, canonical-row digest, Source Binding identity and lineage version,
source/correction frontiers, and every other renewable per-fact field are explicitly excluded. Therefore value or
time renewal retains the series, while a changed correction stream, unit, scale, lineage root, or another listed
static member creates a different series. The series identity is SHA-256 over
`market-data.sample-series.identity.v1\0 || canonical version-1 series projection bytes`.

A root slot identity is SHA-256 over `market-data.sample-slot.identity.v1\0` plus its series identity,
event-effective time, and source-snapshot fact digest; an admitted correction must retain its predecessor's slot
identity rather than recompute it. `fact_digest` is SHA-256 over
`market-data.sample-fact.v1\0 || canonical SampleFactV1 bytes`, and
`sample_identity` is SHA-256 over `market-data.sample.identity.v1\0 || fact_digest`. The sample identity is
therefore distinct from, and cannot be substituted by, the existing BLAKE3 canonical-row digest even when the
value bytes are equal. The all-zero series predecessor is canonical only for the first fact in a series; absent
correction predecessor is canonical only for the first fact in a slot. Every correction has a present predecessor,
and every later fact must name the current corresponding head.

`SampleReceiptV1` is trigger-, consumer-, Design-, and role-independent. Its canonical bytes are exactly 244
bytes, in order: schema `u16LE = 1`, reserved-zero `u16LE`, sample identity `[u8; 32]`, fact digest `[u8; 32]`,
timeframe identity `[u8; 32]`, Owner event identity `[u8; 16]`, logical time `u64LE`, event-effective time
`u64LE`, Owner sequence `u64LE`, canonical-row digest `[u8; 32]`, Source Binding lineage root `[u8; 32]`,
lineage version `u64LE`, and Market Semantics identity `[u8; 32]`. They contain no input-role identity or static
binding digest. Every alternate width, endianness, order, reserved value, missing byte, or trailing byte is
unsupported and produces no receipt identity, EVENT V2 coordinate, or BAR V3 coordinate. Its stable digest is SHA-256 over
`market-data.sample-receipt.v1\0 || canonical SampleReceiptV1 bytes`; those bytes are exactly the listed
role-independent fact projection, is the receipt identity, and supplies the final sample-receipt-digest field of the
existing exact 308-byte coordinate. The native resolver accepts only that exact Owner-authorized stable digest and
returns the historically stored canonical receipt bytes; it never reconstructs them from a row, frame, trigger,
value, latest head, role, binding, or caller coordinates.

`StrategyInputFrameEvidenceIdentityV2` is an additive identity over one complete unchanged V1 frame; it does not
change or replace any V1 receipt. Its canonical preimage is, in order: schema `u16LE = 2`, reserved-zero `u16LE`,
the exact V1 frame-trigger receipt digest `[u8; 32]`, positive value count `u32LE`, and one 96-byte entry for every
V1 frame value. Each entry is input-role identity `[u8; 32]`, static V1 binding-receipt digest `[u8; 32]`, and V1
value-receipt digest `[u8; 32]`. Entries are strictly sorted by input-role identity and duplicate roles are
unsupported; the total length is exactly `40 + 96 * count`. Its identity is SHA-256 over
`market-data.strategy-input-frame-evidence.identity.v2\0 || canonical preimage bytes`. Missing, extra, reordered,
or mismatched trigger/value evidence produces no identity. This identity is not a V1 frame receipt, does not
replace the joined-cut receipt's private single-value component digest, and cannot be derived from only a trigger
or one value.

Only `StrategyInputSampleProjectionReceiptV2` forms the existing EVENT FRAME or JOINED_CUT role-bound coordinate projection. Its
canonical bytes are
one header followed by fixed component entries. The header is, in order: schema `u16LE = 2`, reserved-zero
`u16LE`, closed kind `u8 = 0x01 FRAME` or `0x02 JOINED_CUT`, exact subject identity/digest `[u8; 32]`, and positive
component count `u32LE`. Each entry is exactly 612 bytes, in order: input-role identity `[u8; 32]`, static V1
binding-receipt digest `[u8; 32]`, frame-evidence identity `[u8; 32]`, V1 frame-trigger receipt digest
`[u8; 32]`, V1 role-bound trigger event identity `[u8; 16]`, V1 value-receipt digest `[u8; 32]`, historical
timeframe-projection-receipt digest `[u8; 32]`, sample identity `[u8; 32]`, native `SampleReceiptV1` digest
`[u8; 32]`, coordinate digest `[u8; 32]`, and the exact 308 coordinate bytes. Entries are strictly sorted by
input-role identity bytes and duplicate roles are unsupported; the total length is exactly `41 + 612 * count`.
Reserved, any kind outside the closed registry, zero count, alternate order/width, missing, or trailing bytes produce no receipt.

The subject identity is the additive frame-evidence identity and the entries exhaust the same ordered role values.
Every entry resolves the exact binding and its
historical `TimeframeProjectionReceiptV1`; the coordinate's role, binding, timeframe, row digest, lineage,
Market Semantics, sample identity, native receipt digest, and coordinate digest must match those resolved bytes.
The V1 frame/value row and batch evidence must equal the referenced `SampleFactV1`, and that fact's source
snapshot/correction census must verify its lineage version. The V1 trigger's logical/event times and Owner
sequence must equal the component's coordinate, while its role-bound event identity remains only the separately
stored V1 evidence and is never copied into or equated with the role-independent native event identity. A
current/latest lookup, partial component set, cross-frame splice, or caller-derived field is unsupported. Every V2
component must resolve an unchanged V1 `EVENT` lifecycle. For FRAME, the subject is the exhaustive frame-evidence
identity and every entry shares it. For JOINED_CUT, the subject is the exact valid V1 joined-cut receipt digest,
there are at least two components, each component is one exact single-value EVENT frame, and its independently
recomputed frame-evidence identity must match the entry. Entries remain strictly role-sorted. The stored closed kind,
subject, count, canonical bytes, custody digest, and exact receipt-digest locator must all match before Market Data
promotes a move-only readback. A BAR lifecycle, BAR timeframe, BAR schedule receipt, or any other V2 kind remains
unsupported and produces no V2 receipt or readback.

The V2 receipt identity and digest are the same SHA-256 over
`market-data.sample-projection-receipt.v2\0 || canonical receipt bytes`. Market Data stores and resolves those
exact bytes by that digest; byte-identical replay is idempotent and same-digest different bytes conflict. Thus one
Owner sample keeps one native receipt and, for one role/binding, byte-identical coordinates when carried by a
later trigger, while the enclosing V2 projection correctly changes with its V1 frame. No projection
can mint or alter the Owner sample receipt.

The crate-private `StrategyInputSampleProjectionReceiptV3` structural codec is the only BAR role-bound
projection shape currently present. Its header is, in order: schema `u16LE = 3`, reserved-zero `u16LE`, projection
kind `u8 = 0x01 FRAME`, lifecycle `u8 = 0x02 BAR`, exact frame-evidence identity `[u8; 32]`, and positive component
count `u32LE`. Each entry is exactly the same 612-byte component layout listed for V2; the current V3 codec appends
no schedule receipt or cut digest. Entries remain strictly sorted by input-role identity and total length is exactly
`42 + 612 * count`. V3 identity and digest are the same SHA-256 over
`market-data.sample-projection-receipt.v3\0 || canonical receipt bytes`. Its frame-evidence preimage is schema
`u16LE = 3`, reserved-zero `u16LE`, lifecycle `u8 = 0x02 BAR`, exact V1 frame-trigger receipt digest `[u8; 32]`,
positive value count `u32LE`, and the same ordered 96-byte role/binding/value entries as V2; its total length is
`41 + 96 * count` and identity domain is `market-data.strategy-input-frame-evidence.identity.v3\0`. Lifecycle
`EVENT`, any projection kind other than FRAME, a BAR entry under V2, or alternate order, width, count, or trailing
byte is unsupported.

The current V3 source cross-binds the exact V1 binding, BAR `TimeframeProjectionReceiptV1`, native
`SampleReceiptV1`, coordinate, trigger, value, and frame evidence; native verification requires a BAR timeframe and
byte-identical sample/timeframe dependencies. Its canonical bytes do not carry a `BarScheduleReceiptV1` or
`BarScheduleCutV1`; durable dependency columns cross-bind those Owner artifacts outside the codec. The V3
PostgreSQL table, atomic commit, byte-identical recovery, tamper rejection, and writer/reader ACL oracle are
CURRENT/PARTIAL durable Owner custody and passed the isolated dynamic PostgreSQL acceptance. Its sealed public
locator/readback contract and resolver core are `CURRENT / PARTIAL`: one exact receipt digest reads one
historical FRAME/BAR projection only after a complete fixed PostgreSQL snapshot verifies projection custody,
timeframe/sample facts, schedule dependencies, exact schedule readbacks, and append-only schedule history, with
admission revalidated before the read, after the read, and immediately before promotion. The resolver cannot select
kind or lifecycle, perform a latest lookup, resolve V2 BAR or JOINED_CUT, or expose storage authority. R&D production startup, product composition, ProgramHost, Backtest, composite, Dashboard, and every other product
consumption remain `TARGET / UNAVAILABLE`; required production startup returns no resolver while its external
admission adapters are unavailable. A stored V3 row or structural V3 bytes alone produces no consumer authority or
mutation.

**TARGET / NOT_ADMITTED, additive BAR native join:** `StrategyInputSampleProjectionV4` has exactly the closed
projection kinds `FRAME` and `JOINED_CUT` and the closed lifecycle `BAR`. It neither replaces nor changes any V1
receipt, V2 EVENT projection, or V3 BAR FRAME projection; all existing canonical bytes, domains, identities,
semantics, persistence and resolvers remain byte-for-byte unchanged. For FRAME, V4 binds the exact Owner-resolved V3
BAR FRAME source and its complete schedule dependencies. For JOINED_CUT, its subject is the exact digest of the
unchanged valid V1 joined-cut receipt. The canonical V4 receipt bytes include the exact schedule-dependency-set digest
before the role-sorted component set, so the domain-separated V4 receipt identity necessarily binds both. The
schedule-dependency set exhaustively and canonically binds each component role to its exact BAR schedule cut/receipt
and timeframe dependency; missing, extra, duplicate or reordered entries are unsupported.

Every V4 component must be strictly equal to its corresponding exact-locator V3 BAR FRAME component across the full
role, static binding, frame evidence, trigger, value, timeframe projection, sample identity, native sample receipt,
308-byte coordinate, schedule cut and schedule receipt fields. Recomputing an equivalent-looking component,
substituting a digest, parsing a timeframe label, or mixing components from another frame, slot, batch, joined cut or
schedule set creates no V4 receipt. The first admitted-shape corpus contains exactly six roles: `1m OPEN`, `1m HIGH`,
`1m LOW`, `1m CLOSE`, `1h CLOSE`, and exchange-session `1d CLOSE`. `1m CLOSE` is the trigger; all four `1m` roles must
share the exact complete schedule slot and observation batch. `1h CLOSE` and `1d CLOSE` are selected only as complete
latest-closed samples not after that trigger under their respective schedules. The `1d` role must bind an
`EXCHANGE_SESSION_BAR` day and can never be a UTC day or unanchored 24-hour interval.

One Market Data Owner transaction must lock and re-resolve the exact V1 joined-cut receipt, every V3 FRAME projection,
sample/timeframe fact and schedule cut/receipt; validate the complete schedule-dependency set and all strict component
equalities; then atomically store the V4 receipt, exact-locator readback and outbox. The locator is the exact V4 receipt
identity and is known before send. Byte-identical replay or response-loss recovery resolves that locator and returns
the same historical bytes with zero append. The exact-locator resolver reads no latest/head/history scan and promotes
a move-only positive readback only after complete revalidation in one fixed snapshot. Private tables grant `PUBLIC`
no privilege; only fixed non-grantable Owner/writer roles may mutate them, and the fixed non-grantable W3 reader may
receive only `EXECUTE` on the resolver, never raw `SELECT` or DML. Any locator, ACL, canonical-byte, V1-subject,
schedule-set, component, custody, response-loss or admission failure writes zero V4 receipt, readback, outbox or W3
binding. W3 consumes only this V4 JOINED_CUT locator/readback. This contract claims no implementation, migration,
registered product composition, production startup/write, ProgramHost, Backtest, deployment, runtime or trading
authority.

**CURRENT/PARTIAL, universe-frame sample projection:** `StrategyInputUniverseSampleProjectionV1` gives each (member,
role) value of one universe frame the Owner sample coordinate a bounded feature program reads. It is additive: no V1
receipt, V2, V3 or V4 projection, `SampleFactV1`, `SampleReceiptV1` or coordinate codec changes. Its subject is the
exact digest of one `StrategyInputUniverseFrameReceipt`, the receipt a ProgramHost admits for that frame, never a digest
the host cannot compare with it. It holds one component per (member, role) value of that frame, strictly ordered by
member ordinal - the selection's canonical member order, which a frame's values follow - and then input-role identity,
exhausting the frame; a missing, extra or duplicated pair produces no projection. A component carries the member
ordinal, member key and instrument, the input-role identity, the universe member binding digest, the value receipt
digest, the frame's trigger digest, the timeframe-projection receipt digest, the sample identity, the native
`SampleReceiptV1` digest, the coordinate digest and the 308 coordinate bytes. The coordinate is the existing codec
unchanged (schema `1`, domain `strategy.input.sample-coordinate.v1\0`); its binding field holds the universe member
binding digest, because a universe member has no static binding receipt. A sample is keyed by the row it reads, never by
the binding that reads it: its series, and its slot, which the snapshot's fact digest keys. A universe member's sample
is therefore the same role-free `SampleFactV1` that every binding reading the same row of the same snapshot reads. Each
binding reads it through a `TimeframeProjectionReceiptV1` of its own, which binds the universe member binding digest
where an exact binding binds its receipt digest; Market Data attaches that projection to the sample instead of folding
it into the sample's custody, so a second binding reading a row that already has a sample attaches its projection and
reuses the sample, which is never written twice.

A BAR frame's projection also binds the schedule each member's BAR role was read under. Its schedule-dependency set
digest is SHA-256 over `market-data.universe-sample-projection-schedule-set.v1\0`, the component count `u32LE`, and per
component in order the member ordinal `u8`, input-role identity and that member's BAR schedule readback identity
(`[u8; 32]` each). It is required, never optional, for a BAR frame and absent for an EVENT frame, and it is part of the
projection's identity, so the same frame read under another schedule is a different projection, which the
one-projection-per-frame rule below refuses; a timeframe-projection receipt binds the timeframe but not the schedule, so
without it a schedule change would leave the admitted event's identity unchanged.

Its canonical bytes are, in order: schema `u16LE = 1`, reserved-zero `u16LE`, subject `[u8; 32]`, frame lifecycle `u8`
(`1` EVENT, `2` BAR, the values the V3 and V4 projections use, not the trigger's own encoding), for a BAR frame the
schedule-dependency set digest `[u8; 32]`, positive component count `u32LE`, then per component the member ordinal `u8`,
length-prefixed (`u16LE`) member key and instrument, and the input-role, member-binding, value-receipt, trigger,
timeframe-projection, sample-identity, sample-receipt and coordinate digests (`[u8; 32]` each) followed by the 308
coordinate bytes. Its identity is SHA-256 over `market-data.universe-sample-projection-receipt.v1\0 || canonical bytes`.

The fixed Market Data writer issues projections through one Owner operation, called by R&D with only the sealed Replay
request identity, that request's composition binding locator and which frames: the request's initial frame, or every
frame its window consumes. In one Market Data transaction it resolves each frame's Owner-verified batch - for a window,
from the frame census by the rules above, so the caller names no frame list - takes the Design and the role set the
composition binding recorded when its issuance authenticated the composer's, with each role's declaration Market Data
stores, so the caller names no role and the operation never reads R&D, re-derives each frame's universe frame through
the same binding that produces the frame a host admits, commits or reuses each (member, role) sample and timeframe
projection (a BAR role takes that member's schedule for the frame), and stores each projection's receipt, exact-subject
readback and outbox. Every sample it writes extends its series' one head, which every snapshot, binding and Design
reading that series shares: the operation locks and reads the series head and the row's slot head in its own transaction
before it prepares a sample, reuses the sample a slot already holds, and prepares a new row's sample against the current
series head. A window's projections are issued in that one call, so an R&D transaction that holds locks makes one
cross-database call however long the window is. The request key, the sealed Replay request identity with the frame
scope, is recorded with the binding it was issued under, and another binding under that key is refused by name with zero
writes; an exact retry returns the stored bytes with zero append. The operation never calls R&D. R&D calls it before it
resolves the frames. A host attaches a projection only when its (member, role) set equals both the admitted frame's
value set and the Plan's role table, and refuses it otherwise; any comparison R&D makes earlier is an early refusal, not
that guarantee. A universe frame has at most one projection: a projection for a frame that already has a different one
is refused by name as `SubjectConflict`, with zero writes, so the exact-subject resolver reads exactly one projection by
its universe-frame digest. Built so far: the initial frame. The operation issues a sealed Replay request's initial frame
projection as stated, and the exact-subject resolver reads it; R&D calls it from the initial execution-input binding
issuance, after the request's Instrument Master cut and before it resolves the frame, and refuses early when the
projection names another frame than the one it resolves. Sample custody attaches each binding's projection to the row's
one sample and reuses a slot's sample, as stated. A window's frames, and the host's attachment of a projection to the
frame it admits, are not built yet. It claims no production startup or write, deployment, runtime or trading authority.

A custody frame's projection (T0-5b) is derived, not issued: Market Data builds it when it reads the frame, from the
custody rows the frame's view was sealed from, through the same assembler and the same 308-byte coordinate codec, and
stores nothing. Each value is matched to the view observation its row digest names, and that observation to the one
stored row of its member, field and selected version, which must restate it. The component's coordinate states that
row's `SampleFactV2`: its timeframe identity, Owner event identity and sample identity, a logical time that is V1's -
the later of the row's availability and publication, never the bar's close - its event-effective instant, its series
sequence as the Owner sequence, the custody row's own canonical digest at scale 9, its lineage root and version and
Market Semantics identity, and the fact digest as the receipt digest, since a custody row has no separate receipt. The
coordinate therefore binds the custody row, not the view of it: a view row restates the custody row in canonical form
and with the frame's retrieval instant, so its digest differs from frame to frame, while the coordinate does not, and
one row has the same coordinate bytes in every frame that reads it. A correction is a new version, row and fact, so it
has a new coordinate. The component's timeframe-projection digest is the custody's own: SHA-256 over
`market-data.custody-timeframe-projection.v1\0`, the member binding digest, the member's timeframe spec identity and the
custody timeframe identity. It does not claim equality with a snapshot `TimeframeProjectionReceiptV1`; the spec
identity it binds is already the schedule path's identity for the same declaration. The schedule set follows the
assembler, per component in order, over the member's window schedule fact identity, under
`market-data.universe-sample-projection-schedule-set.custody.v1\0`, and the projection's identity is taken under
`market-data.universe-sample-projection.custody.v1\0`, so a custody projection never equals a stored one. A value no
stored row restates derives no projection, and the frame is refused as `OwnerBindingMismatch`.

An accepted correction is an immutable successor with both an exact series predecessor and correction
predecessor. It creates a new `SampleFactV1`, `SampleReceiptV1`, `sample_identity`, and coordinate and advances the
sample clock exactly once, even when its value bytes equal the predecessor. It never rewrites, replaces, masks,
replays, or retroactively advances predecessor state. An ordinary equal-valued new slot is likewise a new sample
and advances exactly once. For a future admitted BAR path, reusing one 1-hour or exchange-session `1d` sample under
later 1-minute triggers must return the same receipt and coordinate bytes and cause no second sample-clock advance.

The current PostgreSQL sample path, for POINT_EVENT samples and for the BAR samples the universe sample projection
commits, has Owner-owned timeframe-projection-receipt, sample-fact, series-head, per-slot correction-head,
sample-receipt, and outbox tables plus exact native resolvers. One Market Data transaction
inserts the fact, receipt, and outbox row
and compare-and-swap advances both the series and correction heads from the predecessors bound by the fact; an
ordinary new slot advances its correction head from canonical absence to that first fact. A
byte-identical replay performs zero writes and returns the exact historical receipt bytes. Identity/content
mismatch, time or version regression, predecessor or sequence gap, competing branch, cycle, cross-lineage splice,
head mismatch, missing/conflicting timeframe projection, or noncanonical bytes fails closed and advances neither
head. Historical exact receipts remain
readable after successors and corrections. No caller, R&D, ProgramHost, Backtest, fixture, migration,
or reconciliation process receives insert/update/delete, head-advance, synthesis, backfill, or garbage-collection
authority.

The BAR schedule fact/cut/receipt/readback PostgreSQL path, BAR sample custody, and V3 projection PostgreSQL path are
CURRENT/PARTIAL durable Owner custody after isolated dynamic acceptance. Schedule has admitted capability,
revalidation, fixed read/history, reader ACL, and public startup resolution. V3 has durable commit/recovery/tamper/ACL
evidence plus a sealed exact historical resolver core. V3 production startup, product, and composite consumption
remain TARGET/UNAVAILABLE. The crate-private structural codecs or stored rows alone are not product acceptance
evidence.

For EVENT, the V2 projection receipt binds each selected component's exact `sample_identity`, `SampleReceiptV1`
digest, admitted V1 role/binding evidence, and existing 308-byte coordinate bytes/digest. It preserves all V1
trigger, value, frame, and row identities rather than deriving sample authority from them. The same sample selected
by later event frames under the same role/binding therefore retains byte-identical native receipt and
coordinate bytes. For BAR, only the Owner's sealed, dynamically verified V3 resolver core may make the corresponding
historical projection readback inside its admitted boundary; no production startup or product consumer is admitted
by that capability. A
coordinate digest computed from a row/frame/trigger digest, a caller timestamp, or a UTC 24-hour interpretation of `1d` is non-authoritative
and fails before consumer state mutation.

Canonical acceptance must use the repository's existing disposable PostgreSQL harness and repository-authoritative
Makefile, pre-commit, and CI wiring. It covers per-field mutation for every canonical identity and fact field;
byte-identical idempotency and same-identity conflict; ordinary and correction predecessor topology; response loss,
restart, transaction rollback, and historical exact readback; receipt/coordinate tamper and cross-splice;
predecessor gap, branch, cycle, regression, and cross-lineage rejection; V1 byte/meaning preservation; and database
ACL denial for every non-Owner write path. The consumer oracle repeats the same 1-hour and exchange-session `1d`
samples across 1-minute triggers without a double advance, advances once for an equal-valued new sample and once
for an accepted correction, and returns identical native receipt bytes after restart. Until that dynamic evidence
exists, this contract claims no provider authenticity, production migration or deployment, Dashboard, Paper, Live,
BFP executable maturity, Backtest product closure including inverse or quanto target-consumption semantics,
Dashboard/default-database admission, or trading authority. These Backtest limitations do not create a Market Data
instrument-class rejection.

### CURRENT/PARTIAL Binance bar volume and taker buy volume

Both Binance Data Clients, spot (`crates/adapters/binance/src/pit_observation_source_v1.rs`) and USD-M perpetual,
state a closed bar's `VOLUME` and `TAKER_BUY_VOLUME` beside its `OPEN`, `HIGH`, `LOW` and `CLOSE`, in base-asset
units and under the bar's own timeframe. Both numbers arrive in the same kline response the prices come from, so no
request is added.

- **Why `VOLUME` is required.** Every native Replay frame projects a bar from exactly `OPEN`, `HIGH`, `LOW`, `CLOSE`
  and `VOLUME` (`BAR_FIELDS` in `native_replay_scheduling_v1.rs` and `native_replay_scheduling_v2.rs`), and refuses a
  member whose census lacks one. Without `VOLUME`, no frame minted from a Binance snapshot can be projected.
- **Taker sell volume is not a row.** It is `VOLUME - TAKER_BUY_VOLUME`, and it is derived where a consumer first
  needs it, not stated twice.
- **Values as published.** Perpetual quantities are the venue's decimal strings. Spot quantities are the venue's
  128-bit mantissas under the response's quantity exponent.
- **Status.** Both clients state the two rows today, for any deployment that names them. Frame projection still waits
  on the Binance quote gap above. The rows are asserted by a stand-in venue test, by both live source tests, and by
  the credential-free Market Data end-to-end proof.

### CURRENT/PARTIAL Binance perpetual settled funding rows

The Binance USD-M perpetual Data Client in `crates/adapters/binance/src/futures_pit_observation_source_v1.rs`
answers a scope with each member's last closed bar and, beside it, the member's last settled funding. Funding is two
rows on channel `MARKET`, data kind `SCALAR` and timeframe `TICK`: field `FUNDING_RATE` is the venue's decimal as
published, and field `FUNDING_TIME` is the settlement instant in nanoseconds. Both come from the unsigned public
`fundingRate` endpoint, asked for the last two settlements at or before the scope's event-effective coordinate, so a
settlement at exactly that coordinate is included and one a millisecond later is not.

- **Knowable at settlement.** A settled rate is knowable at its own settlement instant. The public archive's
  `calc_time` and the endpoint's `fundingTime` are equal, and so are the rates, for all 93 BTCUSDT settlements of
  2024-01.
- **Absence is the absence of rows, never a value.** Before a member's first settlement, and once the settlement that
  the last two imply is overdue at the coordinate, the member has no funding rows, and the client never states a zero
  rate in their place. A consumer that needs funding refuses on the missing field. An endpoint that cannot be reached
  or refuses the call, a rate that is not a decimal, and a settlement after the coordinate each refuse the whole
  retrieval by its bounded category.
- **No credential.** The client refuses to be built over an HTTP client that holds a credential, and its requests
  carry no `X-MBX-APIKEY` header and no `signature` parameter.
- **Status.** The client is the one `MARKET_DATA_OBSERVATION_SOURCE=binance-perpetual` composes, so a deployment
  that names it commits funding rows today; no consumer reads them yet. Unit tests in that file drive it against a
  local stand-in for the venue, and the credential-free Market Data end-to-end proof asserts the rows on the live
  endpoint.
- **Not stated.** The settlement interval is not a row: the endpoint does not state it, so the timeframe is `TICK`
  rather than a guessed interval. The live estimate from `premiumIndex`, funding accrual in a Replay, and a funding
  field semantic a Design can name are separate slices.

### TARGET Binance backfill fetch for T0 window custody

U1's history enters as T0 window custody: one custody per member over the whole window, for the execution timeframe
and the fill timeframe. This is the fetch side that feeds a custody commit. The commit's own types are T0's.

- **The execution timeframe is a whitelist, defined once.** U1 supports `1w`, `1d`, `4h` and `1h`. The whitelist is
  Market Data's own, defined in exactly one place (`crates/data/src/owner/bar_schedule.rs`,
  `SUPPORTED_EXECUTION_TIMEFRAMES_V1`), and every entry point that takes an execution timeframe - the admit route's
  backfill job, `coverage`, the MCP tool and command line - validates against that one constant rather than
  repeating the list. A timeframe outside it is refused by name as `TIMEFRAME_UNSUPPORTED`; nothing hand-writes the
  list a second time.
- **A week starts Monday 00:00 UTC.** `1w` follows Binance's own weekly kline convention: the bar opens Monday
  00:00:00 UTC and closes the following Monday 00:00:00 UTC, a fixed seven-day interval on that anchor, never a
  session-relative week.
- **`15m` and `1m` stay unsupported.** `15m` waits for an intraday execution model and a cost model; admitting it
  without either would let a Replay choose an execution timeframe no downstream layer can cost. `1m` waits for a
  per-trade (`aggTrades`) fill model: today's fill bar is a `1m` OHLC bar, and using `1m` as the execution timeframe
  itself would make the execution bar its own fill bar, which states no price path inside the bar at all. Both reopen
  once their precondition exists; neither is on U1's path.
- **Execution bars come from the public archive.** For each member, interval and month, the fetch reads
  `data/futures/um/monthly/klines/{SYMBOL}/{interval}/{SYMBOL}-{interval}-{YYYY-MM}.zip` with its `.CHECKSUM` sidecar.
  The bars are read through `authenticate_monthly_klines`, with the sidecar's own digest as the bound digest. That
  proves the bytes arrived as the host published them; it does not prove who published them. The user authorized on
  2026-10-05 (TARGET) that current-month data no longer needs this checksum. A month whose archive is not yet
  published is read from the REST endpoint, and its rows are recorded as not checksum-verified until that month's
  archive is published and verified against them. A closed month keeps the checksum. This sentence aligns with
  Market Data's REST-primary source design, which states the fetch order.
- **A window's bars are the ones that close inside it.** A backfill window and a run window are both `[start, end)`
  over interval-close instants: a bar belongs to the window when its close is in it, and the window schedule's
  frames are exactly those close instants. The archive files a bar by its open, so the bar closing at the window's
  start opens one interval earlier, often in the previous month. The fetch therefore reads months from one interval
  before the start. When that earlier month is not archived at all (the USD-M monthly archive starts at 2020-01, so a
  window from 2020-01-01 needs the 2019-12-31 bar), only that bar comes from the public `klines` endpoint, and its rows
  name the endpoint route; the window's own months must still be archived. A grid-aligned window whose first frame's
  bar is in neither is refused by name, `PRIOR_BAR_UNAVAILABLE`, naming that bar's open, rather than backfilled without
  its first frame. Before this, the first frame of every grid-aligned window had no cross-section, and a run over the
  same window as its backfill was refused as `PIT_WINDOW_FRAME_NOT_COVERED`.
- **The dataset is named by the request, not read from the file.** The reader's entry takes the dataset it was asked
  for (`klines`) and checks it against the archive path it fetched. `markPriceKlines`, `indexPriceKlines` and
  `premiumIndexKlines` archives have the same name, columns and layout.
- **Archives before 2022 have no header.** Every BTCUSDT `1d` month from 2021-01 to 2021-12 starts with data, and
  every month from 2022-01 starts with the official header. Today's reader refuses the first kind, which is a year of
  U1. A first line that is the exact header is skipped. Otherwise the first line is read as a row, under every rule
  the reader already applies to rows:
  - 12 columns;
  - open times on the interval grid and strictly rising, with a gap recorded rather than filled;
  - close times inside the interval;
  - consistent prices;
  - volumes that are not negative, and taker buy volume no larger than volume.
- **The zero-volume rule is what keeps price archives out.** A row with zero volume is accepted only with zero trades
  and one unmoving price, and is refused as `ZeroVolumeAmbiguity` otherwise. For BTCUSDT `1d` 2021-06, every row of
  the mark, index and premium price archives has zero volume, with trade counts of 86,363 to 86,400, 86,360 to 86,400
  and 17,267 to 17,280, and prices that move. The trade archive's volume reaches 1,531,824. Removing that rule would
  let a price archive be read as trades without a refusal, so it stays. The reader applies this today: the header
  is optional in `crates/adapters/binance/src/common/offline.rs`, and its tests read the first real rows of both
  2021-06 archives. The trade row is read and the mark price row is refused.
- **Fill bars come from the endpoint for `1d`, and from the monthly archive for `4h`, `1h` and `1w`.** The fill bar
  for frame `k` is the first `1m` bar opening strictly after frame `k`'s bar event plus the declared lag, and
  strictly before frame `k+1`'s bar event. For `1d`, one unsigned `klines` call with that start and `limit=1`
  returns it: one call per frame, and no `1m` archive, which is about 2 MB a month. For `4h`, `1h` and `1w`, a frame
  is far more frequent, so the fetch instead reads the member's whole `1m` archive month once
  (`data/futures/um/monthly/klines/{SYMBOL}/1m/{SYMBOL}-1m-{YYYY-MM}.zip`, the same authenticated, sidecar-verified
  path as the execution bars) and locates each frame's fill bar inside it, rather than issuing one REST call per
  frame; a BTCUSDT `1m` month is about 43,000 rows. Both paths apply the same gap, lag and closed-bar rules below;
  they differ only in where the candidate rows come from.
- **Funding stays outside this custody for now.** A Source Binding declares one availability rule, and a funding
  settlement is not a declared bar timeframe. U1's funding is therefore read through the perpetual Data Client's
  settled funding rows. A separate binding can add it to custody later, and that change only adds.
- **Each row names its route.** Execution bars come from the archive host, and fill bars from the endpoint host, under
  one Source Binding. The custody evidence records which route produced each row.
- **Resumable and idempotent.** Each fetched file is kept in a shard directory under its archive name, beside its
  sidecar. A shard counts only when its bytes match the sidecar. A rerun verifies the shards it has, fetches only the
  missing or mismatched ones, and writes each new one through a temporary file and a rename. The custody is committed
  once, after every shard for it is present, and T0's commit rejoins an identical resubmission.
- **Status.** The fetch side is in `crates/adapters/binance/src/vision_backfill_v1.rs`.
  - Execution months are read through verified shards and a reuse that refetches nothing.
  - A damaged or mismatched shard is fetched again; a mismatched archive is refused and never kept.
  - Fill bars are taken strictly inside their gap, with no credential.
  - A live test reads the real headerless 2021-06 month, the headed 2025-12 month and one real fill bar.
  - Mapping the bars onto T0's custody request, and the commit, wait for T0's request types.
- **Retrieval is today.** The custody's retrieval instant is the wall clock when the fetch ran. Visibility comes from
  the Source Binding's availability rule, never from a historical retrieval coordinate.
- **The fill gap's lag comes only from the binding.** `fill_bars` takes the availability rule of the Source Binding
  proposal the custody is committed under and locates each gap from its `lag_ns`. No caller states a lag of its own: a
  smaller lag selects a bar the custody refuses, but a larger one selects a later bar still inside the gap, which
  nothing downstream can tell from the right one, so the fill price would be silently wrong.
- **A fill bar has closed when it is retrieved.** The endpoint serves the bar still forming as its last. A fill bar
  whose close time is not before its retrieval is refused as `FillBarNotClosed` and never becomes a row, because the
  custody would refuse that row as retrieved before its bar's close. A bar that has closed but is not yet visible,
  its close plus the declared lag still ahead of the commit, is submitted again later.
- **The writer passes values as the venue published them.** `crates/adapters/binance/src/vision_backfill_custody_v1.rs`
  turns one member's fetched bars into one custody request: every bar of every input timeframe and every fill bar
  whose interval-close instant lies in `[window_start_ns, window_end_ns_exclusive)`, each an original version
  labelled by that instant, in the custody's canonical order of timeframe label then event instant, with `OPEN`,
  `HIGH`, `LOW`, `CLOSE` and `VOLUME` as the exact mantissa and scale the venue's string spells. The window ends one
  execution interval after the last execution bar's close, so the last gap and its fill bar lie inside it. The custody commit
  rescales each value to the member's Instrument Master precision and refuses a finer one, because the commit is where
  external market data enters Market Data; the writer does not check it a second time.
- **Each refusal names what the backfill does.** A refusal means submit the same custody again later, a defect in
  the request the writer built, or a basis - binding, semantics, selection, window or timeframes - that needs replacing
  before anything is committed.
- **Its caller is Market Data's backfill job.** Nothing calls the writer in production yet, because nothing
  implements the custody commit until the custody aggregate (T0-4a) does. Its caller is then the backfill job below,
  which a worker in the Market Data service runs: the entry through which this external history enters Market Data, so
  it sits in the Market Data layer, never in R&D, where a higher layer would be ingesting for a lower one. A command
  line over the same function serves an operator. U1's acceptance runs it once each for BTC, ETH and SOL in the
  deployment image, then reads each member's coverage.

### CURRENT market-data MCP server

The `market-data` server of the [domain MCP catalog](../architecture/product-edge#target---external-agent-tool-surface)
is `market-data-mcp`, a stateless stdio process built from `services/market-data-mcp`, which is its own Cargo
workspace with its own `Cargo.lock` and depends on no Owner crate - only an HTTP client, serde and the stdio
loop. It holds the Market Data API token in its own
environment and reaches Market Data's routes only. Every rule lives in Market Data behind a route; a tool sends one
request, passes its answer or refusal through by name, and sequences nothing. The same functions are a command line
with the same names. `get_bars` and `get_funding` are registered tools today, but each refuses
`HOLDOUT_PARTITION_UNDEFINED` unconditionally: no Owner defines Qualification's holdout partition yet, so no market
value reaches an agent through them.

| Tool                                     | Route                                                   | Refusals by name                                                |
| ---------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `list_instruments()`                     | `GET /v1/market-data/instruments`                       | -                                                               |
| `describe_instrument(instrument)`        | `GET /v1/market-data/instruments/{instrument}`          | `INSTRUMENT_UNKNOWN`                                            |
| `admit_instrument(instrument)`           | `POST /v1/market-data/binance-perpetual-admissions`     | each admission step's own refusal                               |
| `backfill(instrument, timeframe, range)` | `POST /v1/market-data/backfill-jobs`                    | `INSTRUMENT_UNKNOWN`, `TIMEFRAME_UNSUPPORTED`, `RANGE_INVALID`  |
| `job_status(job_id)`                     | `GET /v1/market-data/backfill-jobs/{job_id}`            | `JOB_UNKNOWN`                                                   |
| `coverage(instrument)`                   | `GET /v1/market-data/instruments/{instrument}/coverage` | `INSTRUMENT_UNKNOWN`                                            |
| `get_bars(instrument, timeframe, range)` | `POST /v1/market-data/bars`                             | `HOLDOUT_PARTITION_UNDEFINED` (unconditional, TARGET to narrow) |
| `get_funding(instrument, range)`         | `POST /v1/market-data/funding`                          | `HOLDOUT_PARTITION_UNDEFINED` (unconditional, TARGET to narrow) |

- **Listing and describing read what Market Data holds now.** `GET /v1/market-data/instruments` and
  `GET /v1/market-data/instruments/{instrument}` are `CURRENT`: `crates/data/src/owner/instrument_catalog_v1.rs` reads
  each instrument's latest Instrument Master V2 fact, every link of its chain decoded and checked, and every
  economic-terms version admitted for it. A value the venue does not state is named (`UNBOUNDED`, `NOT_APPLICABLE` or
  `UNAVAILABLE`), never a number. These are discovery reads and never a Replay input: a Replay still binds an exact
  Instrument Master cut and resolves its terms from it, so no consumer gains a latest selector. Chain entry 121 reads
  the perpetual F admits over HTTP.
- **CURRENT: per-symbol admission is one Market Data operation, over five steps.**
  `POST /v1/market-data/binance-perpetual-admissions` takes a Binance USD-M symbol. Market Data fetches the symbol's
  public `exchangeInfo` entry once and commits, in order, five of the six facts the first `COMPOSER_V3` Replay's
  acceptance commits through separate routes: the kline Source Binding, the Instrument Master fact, the
  `exchangeInfo` Source Binding, the Instrument Master V2 fact, and the economic terms
  (`crates/adapters/binance/src/perpetual_admission_v1.rs`,
  `crates/strategy_factory_rd_owner_api/src/market_data_pit.rs::admit_binance_perpetual`). Every step rejoins an
  identical resubmission rather than erroring, so a rerun after any failure completes the rest. The two Source
  Binding steps carry no symbol and claim a fixed effective instant, not the clock's current one: a binding's
  identity folds in its claimed effective instant, so a proposal built from "now" would mint a new binding on every
  call, and a fixed one is what lets the second symbol's identical proposal rejoin the first symbol's binding
  instead. The kline binding proposal, with its availability rule, is constructed only here, and every backfill of
  the instrument reads that same proposal to locate its fill gaps. All five steps stay in the data layer.
- **CURRENT: historical membership is admitted once, whole, for the fixed U1 set, not per symbol.**
  `HistoricalMembershipAdmissionRequestV1` is "one complete membership submission for a single eligible-instrument
  frontier... admitted whole or not at all": a frontier's membership manifest is fixed at the instant it is first
  admitted, so a later admission naming a member outside that manifest refuses `RequestConflict`, and the Owner
  tracks only one global "current" frontier (the most recently admitted one), so a second, different frontier per
  symbol would make an earlier symbol's frontier stop being current. Worse, an Instrument Master cut requires every
  member fact in it to name the same `historical_membership_frontier`
  (`crates/data/src/owner/instrument_master/authority.rs`, `FrontierMismatch`), so a two-member cut over two
  different per-symbol frontiers would always fail. For that reason, before any symbol is admitted through this
  route, its complete fixed member set (`BinancePerpetualDatasetV1`'s sibling constant
  `BINANCE_PERPETUAL_U1_MEMBERS_V1` - BTC, ETH and SOL for U1) is admitted once, whole, through the generic
  `POST /v1/market-data/historical-memberships` route, using
  `binance_perpetual_eligible_set_admission_request_v1`, after the kline Source Binding is admitted (its lineage is
  this request's) but before any symbol's own Instrument Master submission. Every per-symbol admission then names
  that same frontier (derived from the sorted member set, not a fixed constant, so a different future set derives a
  different frontier instead of colliding) in its Instrument Master fact. Re-sending the one-time admission rejoins
  the same frontier. A symbol outside the fixed set is refused by name, `SYMBOL_NOT_IN_ELIGIBLE_FRONTIER`, before
  any admission step runs: nothing is written for a symbol the fixed set does not name.
  The backfill job admits this set through `UniverseSelectionAdmissionV1::admit_membership_at_owner_clock`, under
  the kline dataset's anchored lineage root. The request states only what the membership means: the members, their
  instruments and effective range, the lineage root and the correction frontier. The Owner stamps all five
  observation instants with its own current decision cut, so the facts are in force at that cut and every later
  one, and a Research scope check at the current cut finds them. A later call rejoins the admitted frontier without
  writing when it names exactly the same members with the same meaning, at whatever instant they were observed.
  Another member set or another meaning is `RequestConflict`.

  The job used to stamp the facts at its far-future universe-evaluation instant
  (`BINANCE_PERPETUAL_BACKFILL_UNIVERSE_SELECTION_CUT_V1`, 2100-01-01). That put them out of force at every real
  cut, so every scope check refused the members as `NOT_IN_ELIGIBLE_FRONTIER`. A deployment that admitted
  membership that way, or under the fixed lineage marker that #1375 removed, holds facts no new call can rejoin and
  must be recreated.
- **TARGET: adding a symbol beyond the fixed U1 set is a successor-frontier admission, not something per-symbol
  admission does.** A frontier is Market Data's own complete statement of the eligible-instrument set at a point in
  time - "each admission succeeds the one before it, so Market Data, not the requester, decides which frontier is
  current" - never a set a requester can narrow to one instrument by admitting it alone: doing that would make
  every other admitted instrument fail R&D's current-frontier checks
  (`check_research_instrument_scope_v1`/`resolve_research_pit_references_v1`) the moment a newer, narrower frontier
  superseded theirs. Growing the eligible set is therefore its own deliberate admission: a new
  `HistoricalMembershipAdmissionRequestV1` naming the whole new set (every existing member plus the new one), under
  the frontier digest that set derives. Any Instrument Master fact whose cut spans members across the old and new
  sets together needs a successor fact naming the new frontier; a single-member cut is unaffected, since its one
  fact already names whichever frontier was current when it was admitted. This route does not drive that admission
  itself; it is a separate, explicit operation outside `admit_binance_perpetual`.
- **CURRENT: a backfill is a job Market Data runs.** `POST /v1/market-data/backfill-jobs` records a `QUEUED` job
  fact and returns its `job_id`. The job runs synchronously within that same request
  (`crates/strategy_factory_rd_owner_api/src/binance_backfill_job.rs::start_backfill`), recording `RUNNING`, then
  fetching the member's execution bars and fill bars, building the member's custody request and committing it, and
  recording `SUCCEEDED` with the custody receipt and the exact window it covered, or `FAILED` with the refusal's
  name. Job facts are append-only (`crates/data/src/owner/backfill_job_v1.rs`) and the MCP server holds no job
  state. The timeframe is the custody's execution timeframe, validated against the one whitelist above (`1w`,
  `1d`, `4h`, `1h`); the `1m` fill timeframe comes with it, fetched by `vision_backfill_v1.rs::fill_bars` (one REST
  call per gap, for every execution timeframe today - reading the `1m` archive instead for `4h`/`1h`/`1w`, to cut
  the call count, is a pending efficiency follow-up, not a correctness gap). `GET /v1/market-data/backfill-jobs/{job_id}`
  answers the job's complete transition history.
- **CURRENT: coverage is what Market Data's own backfill job facts record.** `GET
  /v1/market-data/instruments/{instrument}/coverage` answers, for each execution timeframe, the half-open ranges
  every `SUCCEEDED` job has covered, merged where they touch or overlap - not read from the custody chains
  directly: the committed receipt carries no window bounds, and the custody tables have no queryable bounds
  columns either, so this is Market Data's own statement of what it committed, not another Owner's internal rows.
  It states no market value.
- **A run names its data by description.** A `dataset_ref` is the description
  `(instrument, execution_timeframe, [start, end))`, which an agent writes from `coverage`; no tool issues it. The service that runs a backtest resolves it
  against the custody chain that covers it, records the head it resolved, and refuses a range no custody covers as
  `DATASET_REF_UNRESOLVED`. A backtest therefore never needs `get_bars`.
- **Agent reads are recorded by Market Data.** Before a tool returns market values - bars or funding rates - to an
  agent, Market Data appends one agent data-read row per instrument in the same transaction that reads them: the
  server's session identity, minted when the server process starts, the instrument, the timeframe, the half-open range
  `[start, end)` in event nanoseconds, the tool, and the commit cut. A read whose rows cannot be written refuses. These
  rows moved here from R&D's data-read ledger, which held the agent-session rows while R&D was meant to own the agent's
  tools; R&D's census reads them downward and still writes the trial rows itself. Until a session is bound to a
  lineage, R&D counts an agent read against every lineage.
- **No market value reaches an agent before the holdout partition exists.** No Owner defines Qualification's holdout
  partition yet, so `get_bars` and `get_funding` refuse every request as `HOLDOUT_PARTITION_UNDEFINED`, as every
  hand-out of R&D's data-read ledger does.
- **TARGET, after U1, Lane 4: Qualification registers its partition into Market Data.** Qualification calls down and
  registers the protected instruments and periods by value; Market Data only refuses. Then a tool refuses a range that
  overlaps a protected period as `RANGE_IN_HOLDOUT_PARTITION`, and a backtest whose window overlaps one is refused by
  name, because its result alone would leak the holdout. Until the partition is registered, every backtest report
  states that no holdout partition is defined and that its results are exploratory only.
- **Accepted on its own** when, in the deployment image and through this server alone, BTC, ETH and SOL are admitted,
  each is backfilled for `1d` with its `1m` fill, `coverage` shows the windows, and every refusal above is driven once.

### TARGET window funding schedule read

A Replay settles funding at every settlement inside its window, so it needs all of them, not the last two the
perpetual Data Client states per scope. Market Data reads, for a request's members and window, every settled
`(settlement_ns, rate)` in time order and returns a `ReplayFundingScheduleV1`, the value type in
`crates/data/src/owner/replay_funding_schedule_v1.rs` that fixes its canonical encoding and digest.

- **Completeness is Market Data's.** Market Data derives each member's settlement interval from the instrument's facts
  and refuses a window with a missing settlement by name, never filling it with zero. An empty list means the window
  holds no settlement instant; it is never an answer for missing data.
- **The rows come in through the backfill path.** The public funding archive and the unsigned `fundingRate`
  endpoint are both sources; neither needs a credential.
- **It is read downward and passed by value.** R&D reads the schedule and places it in the Replay bundle; Backtest
  never reads Market Data back. Only a schedule Market Data produced is complete: the type's constructor checks
  canonical order, not completeness.
- **Accepted** on one real month of BTCUSDT: the count equals the venue's settlements, and a month with one removed is
  refused by name.

### TARGET live funding retrieval for the strategy runtime

The window funding schedule above answers a bounded historical window for Replay. A strategy runtime that is live,
not replaying, needs the same settled-funding fact as it is produced, plus optionally a forecast of the next
settlement. Both stay inside Market Data; neither widens what may reach real money.

- **The settled-funding recorder lives in Market Data's resident service, never in the MCP.** The MCP is a stateless
  request/response shell and holds no background task; a poller belongs to Market Data's own resident process. On
  every settlement boundary for an admitted perpetual member, the recorder waits out the publication lag (below), then
  calls the same unsigned public `fundingRate` endpoint the two-row scope read already calls
  (`futures_pit_observation_source_v1.rs`), and writes the result idempotently into the funding settlement store that
  commit `#1367` already defines. Backtest, the window funding schedule read above, and the live runtime therefore all
  read one table, never two: the recorder is only ever a writer into that one surface, never a second reader path a
  consumer could get out of sync with.
- **Monthly archive reconciliation, not overwrite.** Once the next month's official archive (the authenticated
  `fundingRate` archive commit `#1364` adds) is published, the recorder re-derives the same window from the archive
  and compares it row for row against what it already wrote from the live endpoint. Equal rows are left untouched. A
  mismatch is reported by name - which settlement, which field, archive value against live value - never silently
  replaced; resolving a reported mismatch is an operator decision, not the recorder's. This also closes the gap the
  archive-only path leaves open on its own: the current month, before its archive exists, has no settled-funding
  history at all without this recorder.
- **A forecast rate is a second, separate fact, and stays unbuilt until a strategy needs it.** The predicted
  next-settlement rate is read from the public WebSocket market stream `/market/ws/<symbol>@markPrice` - not
  `/ws/<symbol>@markPrice`, which handshakes successfully but never pushes a frame, as measured. A forecast row is
  stored under its own kind, distinct from a settled-funding row by construction, so a consumer can never read a
  forecast where it asked for a settled fact. This stream is not built by this design; it only reserves the forecast's
  shape for when a strategy first declares the need.
- **Look-ahead: a funding fact's availability instant is settlement plus publication lag, never settlement alone.**
  One measured sample puts the lag at 11.6 s - one sample, not a bound; more samples are needed before any lag value
  is treated as an upper bound here. Until a bound is measured and each settled row stores its own availability
  instant, settled funding stays what it is today: a P&L input to a run, never a strategy input, because no consumer
  could state when a strategy could first have seen it. Backtest and the live runtime read funding through the same
  surface and apply the same availability cut; a settlement-only cut in one and a settlement-plus-lag cut in the other
  would let a backtest see a fact before any live strategy ever could.
- **Public data only.** Any HTTP client the recorder is built over refuses to hold a credential, exactly as the
  existing Binance clients already refuse (`CredentialPresent`, `vision_backfill_v1.rs`,
  `futures_pit_observation_source_v1.rs`): no `X-MBX-APIKEY` header and no `signature` parameter, ever.
- **A GitHub-hosted runner cannot exercise the REST leg.** It reaches `fapi.binance.com` as `451`, as measured. An
  end-to-end test against the recorder's real REST call can only run locally; that absence from CI is expected, not a
  gap to chase there.
- **Out of scope: real-account funding income.** What was actually charged to or paid into a live account is a
  different fact from the venue's published settlement rate. Reading it needs an exchange API key and is a production
  write adjacent to real money; under the architecture-authority rule in `AGENTS.md`, widening what may reach real
  money needs the user's own explicit authorization, which this design neither requests nor assumes. An agent never
  holds an exchange credential to get there. A real-account funding ledger, if ever wanted, is a separate, separately
  authorized design.
- **Status.** TARGET. This lands together with the runtime's record-only forward stage or the scan resident service,
  whichever is built first - not now. Nothing in this change implements the recorder, the forecast stream, or the
  reconciliation; it only fixes their shape so that later work has one documented design to build against.

### TARGET full chart timeframes and one stitched bar series

The user decided on 2026-10-05 that Market Data serves the timeframes a charting tool offers - `1m`, `15m`, `30m`, `1h`,
`2h`, `4h`, `6h`, `8h`, `12h`, `1d`, `1w` and `1M` (one calendar month) - and that the latest closed bars, the current
month included, are available. The user also chose how (2026-10-05, following Nautilus): public REST is the primary
source for every month, and the official archives only verify it afterwards. A consumer reads one series per instrument
and timeframe and never sees which source a bar came from, except through two marks on each bar. This section states the
design and the measurements behind it. Nothing in it is implemented yet; Lane 8 implements it.

- **Measured: Binance's own bars at different timeframes do not always agree with each other.** The question was
  whether every timeframe can be derived from `1m` alone, so that `1m` is the one source of truth. Every USD-M monthly
  archive of BTCUSDT and ETHUSDT from 2020-01 to 2025-12, and of SOLUSDT from 2020-09 to 2025-12, was read and
  checksum-verified. Each `1m` month was aggregated into every other timeframe and compared, field by field and
  exactly, with the venue's native bars for that timeframe. The aggregation ran twice: through a script, and through
  the production `TimeBarAggregator` (`crates/data/src/aggregation.rs`, historical mode, test clock, left-open
  intervals, timestamp on close). For every fixed interval, both produced the same bars. For BTCUSDT:

  | Timeframe   | Native bars | Equal in all 10 fields | Equal in OHLC |
  | ----------- | ----------: | ---------------------: | ------------: |
  | `15m`       |     210,432 |                210,414 |       210,424 |
  | `30m`       |     105,216 |                105,198 |       105,209 |
  | `1h`        |      52,608 |                 52,591 |        52,603 |
  | `2h`        |      26,304 |                 26,288 |        26,301 |
  | `4h`        |      13,152 |                 13,137 |        13,149 |
  | `6h`        |       8,768 |                  8,755 |         8,766 |
  | `8h`        |       6,576 |                  6,562 |         6,575 |
  | `12h`       |       4,384 |                  4,369 |         4,382 |
  | `1d`        |       2,192 |                  2,178 |         2,192 |
  | `1w` (REST) |         312 |                    298 |           312 |
  | `1M` (REST) |          72 |                     60 |            72 |

  ETHUSDT and SOLUSDT give the same shape; for example, ETHUSDT `1d` has 2,176 of 2,192 equal. Every difference falls
  in a few incident windows, and BTCUSDT and ETHUSDT share them: 2021-01-12, 2021-05-15, 2022-06-18, 2022-06-22 to 24,
  2022-07-04, 2022-07-16, 2022-08-19, 2022-08-21, 2023-08-16, 2023-11-10/14, 2025-01-14 and 2025-01-29. Outside them,
  derivation is exact, including the UTC day boundary, the Monday 00:00 UTC week and the calendar month.
  The fields that differ are volume, quote volume, trade count and the two taker-buy volumes, and in a few intraday
  buckets also the open, high or low. There are two kinds of difference:
  - **The venue's own timeframes disagree.** On 2021-01-12, for example, the `1m` bars sum to 449,027.984 BTC in both
    the archive and REST, while the `1d` bar says 449,065.693 in both. No `1m` source can reproduce that `1d` bar.
  - **The `1m` archive was corrected after it was published.** On 2025-01-29, 20 minutes of the monthly `1m` archive
    differ from today's REST `1m` bars, and REST's `1m` sum equals the native `1d` bar. On 2023-11-10, 99 minutes
    differ.
- **Measured: the archive has defects of its own.**
  - **A monthly file can silently omit days.** SOLUSDT's monthly archives have no `1m` rows, and no native bars, for
    2022-02-26 to 28 and 2022-04-01 to 02. The daily archive and REST both have them.
  - **A monthly `1w` or `1M` file holds a snapshot of a bar that was still forming.** For a week that spans two
    months, the 2021-07 `1w` file closes the week of 2021-07-26 at 41,159.40. That matches neither the 2021-07-31 nor
    the 2021-08-01 close. REST closes it at 39,846.78, exactly the `1m`-derived value. Native `1w` and `1M` monthly
    files exist only up to 2023 or 2024.
  - **Native `1m` coverage is otherwise dense.** BTCUSDT and ETHUSDT have 3,156,480 minutes over 2020 to 2025 and
    none missing.
- **Measured: the daily archive and REST.**
  - **REST equals the daily archive.** Public REST `/fapi/v1/klines` equals the daily archive in all 11 columns, for
    4 x 1,440 BTCUSDT `1m` bars (2026-09-25 and 2026-10-01 to 03).
  - **REST returns the bar that is still forming.** Its last bar's close time is after the request instant.
  - **A REST bar keeps changing after its close.** Of 7 bars first read within 5 s of their close, 3 changed later, at
    up to 9.5 s after close, as late trades landed: close, volume and trade count all moved.
    A second, 20-minute sample polling every 2 s saw 16 of 20 bars change after their first closed read, the
    latest at 5.5 s.
  - **Publication times.** A daily archive is published about 8 to 9.5 hours after its UTC day ends (08:00 to 09:20
    UTC the next day, over 2026-09-20 to 2026-10-03). A monthly archive is published on the 2nd of the next month,
    09:00 to 12:00 UTC.
- **Decision: public REST is the primary source for every timeframe and month; the archives verify.** Every
  timeframe is fetched as the venue's own native bars from `/fapi/v1/klines`, never derived from `1m`. The measurement
  above is why derivation would be wrong: on 14 of 2,192 days, a series derived from `1m` would differ from the
  venue's own bar for that timeframe, because the venue's own timeframes disagree. REST also carries later venue
  corrections that an already-published archive does not (2025-01-29). Fetching natively costs about 14% more rows
  than `1m` alone (about 430,000 against 3,156,480 per instrument over six years). `1m` is stored either way, because
  it is the fill timeframe.
- **How REST is read.**
  - **Use the native fetch that keeps every column.** The existing Futures client fetches native bars with every
    column through `request_binance_bars` (`crates/adapters/binance/src/futures/http/client.rs`), which returns
    `BinanceBar`: open, high, low, close, volume, quote volume, trade count and both taker-buy volumes.
    `request_bars` converts these into Nautilus's `Bar`, which keeps only open, high, low, close and volume, so it
    would drop columns Market Data already serves (`TAKER_BUY_VOLUME`). The recorder uses `request_binance_bars`.
  - **Pagination has to be built.** That call makes exactly one REST request, at most 1,500 bars. The recorder pages
    it forward from the last stored close until the present. Six years of BTCUSDT `1m` is about 2,100 requests at
    weight 10 each, well inside the public rate limit if spread over a few minutes.
  - **A settle delay comes on top of the client's own filter.** The client drops a bar whose close time is not before
    its clock, so it never returns the bar still forming. It does not wait for late trades, which the measurement
    shows can still change a bar up to 9.5 s after close. The recorder therefore admits a bar only once its close plus
    a settle delay, starting at 30 s, has passed at retrieval. The delay stays above every change measured.
  - **The latest bars.** A newly closed bar comes from the next REST poll, or from the WebSocket kline stream's
    closed-bar message (`x = true`), after the same settle delay. A bar from either is the same REST-tier bar.
- **Every bar carries two marks, and the read stays one series.**
  - **`source`:** `REST` for every recorded bar.
  - **`verified`:** false until an archive confirms the bar.
  - **The rest of the bar.** Each bar also carries its retrieval instant and its availability instant. A bar read
    live is available at its retrieval instant. A backfilled historical bar is available at its close plus the
    binding's declared lag, as T0 custody declares it.
  - **The read.** It names an instrument, a timeframe and a window, and returns that timeframe's closed bars in order
    with both marks. A point-in-time read selects the latest version of each bar visible at the reader's cut.
  - **Strict reads.** A consumer that must not rest on unverified data asks for `verified_only`, and the read refuses
    by name any window that holds an unverified bar. The final check of a qualification review is such a consumer.
    The marks are metadata on a bar, never a second read path.
- **The archives verify bars after they are published, and only append.**
  - **What does the verifying.** When an official archive covering stored bars is published, a verifier compares it
    with them, bar by bar and field by field. For fixed-interval timeframes this is the monthly archive. The daily
    archive (T+1) can verify earlier, and covers the days a monthly file omits.
  - **Equal:** the bars are marked verified. Nothing else is written.
  - **Different:** a conflict is reported by name, naming the bar, the fields, the REST value and the archive value.
    The stored bar is never overwritten. Resolving the conflict is an operator decision, and a correction enters as
    an append-only successor version of the bar, as T0 custody already corrects a cross-section.
  - **An archive that is incomplete for its grid** verifies only the bars it holds. It never verifies an absent bar,
    and it never deletes a stored one.
  - **`1w` and `1M` bars are never verified against a monthly archive**, because of the forming-bar snapshot above.
    They are verified against the daily archive's file for that bar where one exists. Otherwise they are verified
    against their derivation from already verified `1m` bars, through `TimeBarAggregator` for `1w` and a calendar
    bucketing for `1M`. A mismatch there is reported by name like any other.
  - **Conflicts are expected on real history.** The measured venue incidents and the 2025-01-29 archive correction
    will each surface as one, so this is a normal path that operators acknowledge, not an error path.
  - **One service.** One resident Market Data service runs this recorder and verifier together with the
    settled-funding recorder (see "TARGET live funding retrieval for the strategy runtime" above), with one scheduler,
    one verification rule and one conflict report. Funding follows the same split: `/fapi/v1/fundingRate` is primary,
    and the monthly funding archive verifies it.
- **What is reused, and what has to be built.**
  - **Reused as is:**
    - `BinanceKlineInterval` (`crates/adapters/binance/src/common/enums.rs`), which already names every timeframe
      here, `1M` included;
    - `request_binance_bars` and the klines query and model (`futures/http/query.rs`, `futures/http/models.rs`);
    - the WebSocket kline stream (`futures/websocket/streams/handler.rs`), whose message carries the closed flag;
    - the authenticated archive readers (`authenticate_monthly_klines`, and the funding archive reader), now on the
      verifying side;
    - `TimeBarAggregator`, for the `1w` derivation check.
  - **Built here:**
    - **Forward pagination** over `request_binance_bars`.
    - **The settle delay.**
    - **The `source` and `verified` marks**, with the availability instant on every bar.
    - **Append-only correction versions.**
    - **The verifier**, with named conflicts, and the `verified_only` read.
    - **The daily-archive reader**, for early verification and for days a monthly file omits.
    - **Calendar-month cadence.** `UntrustedSourceBarCadenceV1` has only `FixedInterval` and `ExchangeSessionDay`,
      so `1M` needs a new `CalendarMonth` cadence on the UTC month anchor.
    - **New labels in the label mapping** (`execution_timeframe_bar_label_v1`, #1386): `15M`, `30M`, `2H`, `6H`,
      `8H` and `12H`, `1m` as `1M` (already the fill label), and a distinct month label. `1M` is taken by the
      minute, so the month cannot reuse it.
  - **Not usable as is:**
    - **`request_bars`**, because its `Bar` drops columns (above).
    - **`TimeBarAggregator` for calendar months.** In historical mode it produced 0 bars from six years of `1m`,
      because its monthly path schedules a time alert that historical replay never fires. The `1M` derivation check
      needs that fixed, or does its own month bucketing.
    - **The DataEngine's composite bars**, which aggregate inside a running engine rather than over stored history.
- **Migration from today's archive-first backfill.**
  - **The archive path #1384 completed stays, as the verifier.** Today's backfill job reads execution bars from
    monthly archives (`authenticate_monthly_klines`) and funding from the monthly funding archive. That code becomes
    the verifier's reader, unchanged.
  - **The order of work:**
    1. Add the REST recorder and the bar store with both marks. The recorder backfills every timeframe from the
       first listed month to the present.
    2. Run the verifier over the stored history with today's archive readers, and check its counts against the
       measurement above.
    3. Point the backfill job's custody input at the stored series instead of fetching archives directly. A
       custody's rows then name the `REST` route, and carry the bar's `verified` mark in their custody evidence.
    4. Keep funding the same way: settled funding is recorded from REST and verified by the monthly archive. The
       #1384 writer becomes the verifier's commit side.
  - **No rewrite.** Custody chains already committed from archive rows are never rewritten. A chain keeps the rows
    and routes it was committed with.
  - **What becomes unnecessary.** The "published months only" rule proposed in the #1384 review: REST serves the
    current month directly.
- **What does not change.**
  - **T0 custody.** It still holds one window over one execution timeframe and the fixed `1m` fill timeframe.
  - **Admitted execution timeframes.** Serving a timeframe as a bar series does not admit it as a custody execution
    timeframe. `1m` stays gated on a per-trade fill model and `15m` on an intraday cost model, as "TARGET Binance
    backfill fetch for T0 window custody" states. `1M` additionally needs the window schedule to enumerate calendar
    intervals, which it does not today: frames are `phase + n * interval`.
- **Constraints.**
  - **Public data only.** Every client refuses a credential, as the existing Binance clients do (`CredentialPresent`).
  - **REST tests run locally.** A GitHub-hosted runner reaches `fapi.binance.com` as `451`, so tests that call REST
    run only on a local machine. The user accepted this explicitly on 2026-10-05.
  - **`get_bars` is not part of this change.** Its `HOLDOUT_PARTITION_UNDEFINED` refusal stays.
- **Implementation slices.** Each slice is a separately reviewable PR with its own acceptance; a slice starts only
  when the ones it names have merged. Lane 2 owns the Market Data core (B1, B2); Lane 8 implements the rest.
  - **B1 - the bar store (Lane 2).** An Owner-private, append-only store of native bars, keyed by instrument,
    timeframe label and open instant, each bar a chain of versions. A version holds the 11 venue columns, its
    source, its retrieval instant and its availability instant. A writer commits a page of bars for one instrument
    and timeframe:
    - **Rejoin:** a bar already stored with the same content writes nothing.
    - **Conflict:** a bar stored with different content is recorded as a named conflict (`BAR_CONTENT_CONFLICT`,
      naming the bar, its fields and both values) and nothing is overwritten.
    - **Refusals:** a bar whose close plus the settle delay is not before its retrieval is refused by name
      (`BAR_NOT_SETTLED`), and so is a bar off its timeframe's grid (`BAR_OFF_GRID`).

    A point-in-time read takes instrument, timeframe, window, cut and `verified_only`, and returns, for each bar,
    the latest version available at the cut, with its marks, through an admitted wrapper inside a new measured
    floor. `verified_only` refuses by name any window holding an unverified bar.

    Acceptance: PG proofs for each of the following.
    - Rejoin writes nothing.
    - A differing re-fetch records exactly one conflict and leaves the stored bar unchanged.
    - Each refusal writes nothing.
    - A read at a cut before a version's availability does not see it.
    - `verified_only` refuses over an unverified bar.
    - The floor is the catalog closure of its read.

    Built (with B2). `crates/data/src/owner/venue_bar_store_v1.rs` and its Postgres implementation, with the served
    timeframe table moved here from B4 (`bar_schedule::served_timeframe_v1`: label and grid per venue interval). The
    admitted read and its floor are deferred until an R&D consumer reads bars: B7 reads on the Owner side, and
    `get_bars` stays refused. A bar belongs to a read window by its close, as in custody.
  - **B2 - verification and corrections (Lane 2, after B1).** An Owner operation verifies stored bars against
    archive rows for an instrument, timeframe and covered window.
    - **Equal bars:** a verification record (archive kind, archive identity, verified instant) is appended, and the
      bar reads as verified.
    - **Differing bars:** a conflict is recorded under the same name as B1's, naming the archive as its second side.
    - **Missing bars:** a bar the archive does not hold stays unverified, and is never deleted.
    - **Corrections:** an operator correction appends a successor version, naming the conflict it resolves. It has
      no route, and the read selects it only from its own availability on.

    Acceptance: PG proofs.
    - Equal bars become verified with nothing else written.
    - A differing bar yields one conflict and stays unverified.
    - An archive missing a day verifies only the days it holds.
    - A correction is seen only from its availability.

    Built (with B1). `verify_venue_bars_v1` reports archive-only and store-only bars. `open_venue_bar_conflicts_v1`
    lists the conflicts no correction resolves. `correct_venue_bar_v1` refuses an unknown conflict
    (`BAR_CONFLICT_UNKNOWN`) or one whose bar has moved on (`BAR_CONFLICT_SUPERSEDED`).
  - **B3 - the REST recorder (Lane 8, after B1).** Forward pagination over Binance's kline rows, for every
    timeframe label in the served set, from an instrument's first listed bar (Binance's own response to a
    `startTime` of the Unix epoch, ascending), or the last stored close, to the present. Every page is committed
    through B1's writer, and a bar is admitted only after the settle delay. It is paced inside the public rate
    limit (the adapter's own built-in `RateLimiter`, already shared by every Binance call) and resumable.

    Acceptance:
    - Unit tests for paging boundaries and the settle filter.
    - A local test against live REST: one day of BTCUSDT `1m` and `1d`, recorded twice, writes once and then
      rejoins.
    - The counts against the archive equal the measurements above.

    Built. `crates/adapters/binance/src/venue_bar_rest_recorder_v1.rs`. The Lane 8 design decision Lane 3 flagged -
    how the recorder resolves and caches an instrument to satisfy `request_binance_bars`'s `BarType` - turned out
    not to be needed: that wrapper keeps only its bar's nautilus event timestamp (Binance's `closeTime`),
    discarding `openTime`, which `VenueBarV1` needs independently of `closeTime` to derive its own grid-exact
    close through `served_timeframe_v1`. `request_raw_klines`, a new thin passthrough to the adapter's already-
    rate-limited raw kline rows, is called directly instead - keyed by the raw venue symbol string, with no
    `BarType` or instrument cache in the loop at all.
  - **B4 - the calendar-month cadence (Lane 8).** `CalendarMonth` cadence on the UTC month anchor in
    `UntrustedSourceBarCadenceV1`, with its codec, refused as an execution timeframe. The served label table is B1's.

    Acceptance:
    - A calendar-month declaration encodes, decodes and refuses a fixed interval.
    - It is refused as an execution timeframe.
  - **B5 - archive verification jobs (Lane 8, after B2 and B3).**
    - **Schedule:** fetch each monthly and daily archive once it is published (the daily archive T+1 from about
      09:30 UTC, the monthly archive from the 2nd at about 12:00 UTC), and verify through B2. The existing
      authenticated readers (`authenticate_monthly_klines`, `funding_archive_v1`) are reused unchanged.
    - **Coverage:** a month whose file omits days is verified from the daily files for those days.
    - **`1w` and `1M`:** verified from their daily files, or by derivation from verified `1m` bars. Derivation uses
      `TimeBarAggregator` for `1w`, and for `1M` either its fixed month path or an explicit month bucketing.

    Acceptance:
    - A local run over BTCUSDT, ETHUSDT and SOLUSDT reproduces the measurement: the incident days surface as the
      named conflicts listed above, and SOLUSDT's omitted days are verified from the daily files.
  - **B6 - one resident service (Lane 8, after B3 and B5).** The recorder, the verification jobs and the
    settled-funding recorder (#1382) run in one scheduler in one resident Market Data process, never in an MCP.

    Acceptance:
    - It restarts without double writes, which is proved by rejoin counts.
    - A local soak of a few days records closed bars, verifies them on archive publication, and reports conflicts.
  - **B7 - custody input from the store (Lane 8, after B1 and B5).** The backfill job builds a custody's execution
    and fill bars from the store instead of fetching archives, and its rows name the REST route. Chains already
    committed are never rewritten.

    Acceptance:
    - A backfill over a window the store holds commits a custody whose rows equal the store's bars.
    - A run over it passes.
    - A window reaching the current month backfills, which supersedes the "published months only" rule.
- **Status.** TARGET, not implemented. The measurement scripts (archive aggregation, the `TimeBarAggregator` harness,
  REST against the daily archive, and REST settling) were run locally on 2026-10-04 and 2026-10-05 and are not kept in
  the repository. They are cheap to rerun before implementation.

## Input handoffs

- Data vendors and trading venues provide raw market and reference records through Data Clients, and every time
  coordinate is attributed to the clock that states it rather than to the clock that admits it. The venue states
  the event-effective instant and the provider-available instant, and states them separately: the first is when
  the event happened, the second is when the venue published it, and using one for the other would assert a
  publication the venue never claimed. Beyond that pair the same vocabulary reaches this Owner through three
  intakes that differ in who holds the clock, and a rule learned from one of them is wrong about the other two.
  A submitted PIT Snapshot Request carries, for every coordinate, both the value and the clock identity and epoch
  the submitter claims; this Owner assigns none of them and admits them only by comparing each claimed clock
  against its own sealed head, refusing on mismatch. An Instrument Master submission carries the coordinate
  values alone and no clock at all; this Owner binds the admitted fact to its own current clock head. On the live
  market channel this Owner states the retrieval coordinate from the host process clock rather than from the
  sealed head, so it is comparable neither with the venue's two instants nor with a sealed-head coordinate.
  Binding a coordinate to the sealed head is admission, not attribution: on the PIT intake a claimed instant
  remains the submitter's claim after the head admits it, and is never compared to an Owner-stated instant as
  though one clock produced both. A record that states no coordinate of its own yields none for it, and this
  Owner never substitutes its own instant, the event instant, or a neighbouring record's stamp for a coordinate
  the source did not state.
- [R&D](./rd/) submits an initial frozen PIT Market Snapshot Request before exploratory consumption.
  It binds the Research Request, Intent, TrialFamily, instrument or universe scope, four-time decision cut,
  required provenance, license and correction frontier, stable correlation, and Time Evidence.
- [R&D](./rd/) may submit one Market Data Repair Request only from a committed `REPAIR_INPUTS`
  Iteration Decision. It repeats the original PIT request identity and proof digest, instrument scope, decision cut,
  bounded reason, stable correlation, required provenance/license/correction fields, and shared Time Evidence.
- Operations supply the Market Data Source Binding, opaque credential handles, license scope, and correction feeds without
  changing observed-at history. Credentials never enter a snapshot, stream, artifact, or product view.
  The admission `POST /v1/market-data/source-bindings` refuses each defect of a proposal under its own name as
  HTTP 400: an empty field as `SOURCE_BINDING_FIELD_MISSING`, a zero digest as `SOURCE_BINDING_DIGEST_ZERO`, an
  invalid schema, policy or frontier version as `SOURCE_BINDING_VERSION_INVALID`, raw credential material, an
  audience other than Market Data or a capability beyond read-only market data as
  `SOURCE_BINDING_RAW_CREDENTIAL_MATERIAL`, `SOURCE_BINDING_CREDENTIAL_AUDIENCE_INVALID` or
  `SOURCE_BINDING_CREDENTIAL_CAPABILITY_FORBIDDEN`, time coordinates that are zero or out of order as
  `SOURCE_BINDING_TIME_EVIDENCE_INVALID`, and a bar timeframe no bar can have as
  `SOURCE_BINDING_BAR_TIMEFRAME_UNSUPPORTED`. Coordinates that are well ordered but later than this Owner's decision
  cut are early rather than wrong: they are a 409 `SOURCE_BINDING_TIME_EVIDENCE_AFTER_DECISION_CUT`, and a later
  admission can accept them. `INVALID_SOURCE_BINDING_PROPOSAL` remains only for a claimed identity that does not
  derive from its content.

## Output handoffs

- To [R&D](./rd/): one move-only, Market Data-sealed `ResearchPitTerminal` whose canonical six-state
  disposition is correlated to the exact initial
  request identity, content digest, scope, cut, provenance, license, correction, and stable correlation, plus the
  exact Universe Selection Record identity and digest for hypothesis testing. A repair request resolves separately to the same correlated request identity
  as `AVAILABLE` with the repaired snapshot, or terminal `UNAVAILABLE` with a bounded decisive source category.
  R&D cannot import, construct, deserialize, or implement the terminal authority and receives no raw
  store receipt, PIT lineage rows, Source Binding lineage rows, or clock rows.
- To [Backtest](./backtest/): the exact PIT Market Snapshot and Universe Selection Record for the request-bound PIT
  scope and snapshot/correction rule. **TARGET:** direct `BACKTEST_OWNER_V1` Instrument Master resolution supplies
  the sealed fact/cut readback; actual consumption and Run Result must repeat the exact snapshot, selection,
  Instrument Master fact/cut and every frozen execution identity.
  **Measured 2026-09-22, and the first version of this paragraph got the shape wrong.** A PIT snapshot is
  one as-of cut, so N bars are N frozen requests. On `BTCUSDT.BINANCE` at `1M`, 512 consecutive coordinates
  produced 512 distinct bars and 512 distinct sealed snapshots, strictly consecutive with no gap and no repeat,
  in 767.8 s. Reading back which bar each coordinate resolved to is a second venue round trip and is what makes
  that statement sayable at all; the same 512 coordinates without it took 655.4 s, and the timings below are
  measured from those witness-free runs. What dominates the clock is **not** the venue: removing half the round
  trips saved 15%, and all SQL execution together accounted for 1.2% of a 256-coordinate run.
  The cost grows with **what the store already holds**. Within one 256-coordinate run the per-coordinate cost
  rose from 0.131 s over the first eighth to 1.182 s over the last. `validate_owner_history_custody` walks every
  lineage in the store on every commit, and every snapshot opens its own lineage, so commit number n re-validates
  n lineages at six statements each: 101,509 iterations and 609,054 statements at N=256, which fills the measured
  clock. Total cost is therefore quadratic. Three witness-free runs - 64, 256 and 512 coordinates in 12.1 s,
  169.2 s and 655.4 s - fit **t is about 0.033 N plus 0.0024 N squared seconds** on the measuring host to within
  0.7%, while the simpler `0.0025 N squared` passes through the 512 point exactly and underestimates 64 by 15%.
  Extrapolating that curve - an extrapolation, and one that assumes a store starting empty - **one year of daily
  bars is roughly five and a half minutes, and one year of minute bars is roughly twenty-two years**, not the
  days a linear reading of the first measurement suggested. One year of daily coordinates has since been run and
  took 336.5 s, but with the witness probe and on another instrument and timeframe, so it corroborates the order
  of magnitude without testing the curve at a controlled point. The practical consequences are that a bounded
  window of a few hundred coordinates is cheap, a long minute-resolution history is not reachable by this path at
  all, and **a store that is never reset makes every later snapshot slower for every writer**, so accumulating
  snapshots in a shared chain database spends a budget that never returns.
  **Measured again on 2026-10-03, and the cause located.** The run was 256 consecutive daily `BTCUSDC-PERP.BINANCE`
  coordinates on main 85c4237d2, against a disposable store with `pg_stat_statements`.
  - **Per-commit cost.** The cheapest commit in each block of 16 rose from 138 ms to 1241 ms. That is about 4.5 ms
    for every lineage already in the store, so the cost is linear per commit and quadratic in total.
  - **Where it goes.** 632,102 statements ran. The top four by time are the per-lineage history checks, each called
    97,920 times, which is 256 squared over two times three. Server execution was 79 s of the 258 s commit time; the
    rest is round trips and decoding each fact in Rust, which an index cannot remove.
  - **What triggers it.** `validate_owner_history_custody` runs about three times per commit: clock admission, clock
    materialization, and the read validation that eight read paths share. Each run re-decodes every PIT lineage.
  - **Projection.** At that slope, about 5,500 daily snapshots would end with a 25 s commit and about 19 hours in
    total, and every read would slow the same way.

  **TARGET - per-lineage history custody.** The check moves to where each lineage is written and read. It is not
  removed.
  - **On commit:** the lineage being written. Its new fact, and its link to the previous head (predecessor digest
    and next version), are validated in the committing transaction.
  - **On read:** the lineage being read. A PIT snapshot or Research PIT terminal read validates the one lineage it
    returns.
  - **The census check stays global.** It is one set-level statement (0.46 s over all 774 calls above). Source
    Binding lineages stay walked whole, because there are few of them (0.21 s over 772 calls).
  - **History cannot be rewritten.** PIT snapshot facts, observation batches, observation rows and the outbox get
    append-only triggers, written the way `native_replay_frame_sequences_are_append_only` is. A rewrite through the
    Owner's own connection is then refused by name rather than detected at a later commit.
  - **Migration keeps one full walk** as the audit entry point.
  - **What changes.** Today a damaged lineage stops every commit and read in the store. After this, it stops the
    consumer that reaches it, which is what "fails closed for the dependent consumer" under Failure and recovery
    states.
  - **Acceptance:**
    - the same sweep must be linear in N;
    - a rewrite of a committed PIT fact through the Owner connection must be refused by the trigger.
  - **Scope.** The tests that rewrite PIT rows to prove detection (15 sites in `postgres/tests.rs` and one each in
    `store_admission/mod.rs` and `bar_schedule_acceptance_v1_tests.rs`) move to the trigger's refusal or to an
    explicitly trigger-disabled admin session.
- To [Scanner](./scanner/): the exact PIT Market Snapshot requested by published activation conditions.
- To [Runtime](./runtime/): live market streams and instrument updates carrying the same Market Semantics
  Compatibility identity consumed by the generation's Strategy Artifact and historical evidence.
  **CURRENT / PARTIAL, one live fact channel, built and proven:** the additive `LiveMarketFactV1` a Strategy Instance consumes,
  its Owner-sealed intake, and exactly one Data Client behind it, the venue's public WebSocket. The vendor side
  states only what a venue can know, as the PIT observation seam already requires; the Owner stamps the admitted
  Source Binding identity and lineage, the binding's Market Semantics Compatibility identity, and the one time
  coordinate that is its own, the retrieval instant, together with the sequence. The venue states the
  event-effective and provider-available instants from its own clock, and the Owner reads its retrieval instant
  from the host process clock rather than from its sealed head, so no ordering across those clocks is provable and
  none is asserted. The Owner refuses an instrument outside the subscription it issued, and keeps a
  durable head so a restart hands over from where it stopped rather than replaying. Nothing else is admitted here:
  no second channel, no instrument-update stream, no Runtime custody, no order path.
  **NOT_ADMITTED:** a live channel establishes no Runtime readiness, Paper, Live, real trading or other production
  write, and a streamed fact is never a PIT snapshot, a replay input or evidence for a historical question.
- **IMPLEMENTATION_ADMITTED, one live market read surface, admitted 2026-09-21 and not built:** a consumer of a
  live market fact is identified by its own database role, and what it may read is narrowed before the read rather
  than filtered by the caller's claim during it. The admitted shape is one view per consumer, owned by
  `market_data_owner`, restricted to the bindings that consumer is admitted to, with `SELECT` granted to that
  consumer's role and no privilege on `market_data_private`. That role is the upper bound on what the consumer can
  see: never `rd_owner`, and never a superset shared with another consumer, so the bound is enforced by the
  database rather than by trusting a process to hold a credential. A caller identity finer than a role is not
  required today and is not introduced; should one ever be, the per-consumer role remains its upper bound and
  refining inside that bound is the only admitted shape. Admission here is permission to build and verify this one
  read. It authorizes no Runtime effect, no Paper or Live adapter binding, no production write and no real trading,
  and it does not admit the Runtime-side consumer, which is the other half `B8` names. The first delivery states
  both sides of its own proof: the consumer's own view returns only the bindings it is admitted to, while another
  consumer's view and `market_data_private` each refuse it rather than returning no rows, because a read that
  returns nothing where it should be refused is a grant that is too wide.
- To [Portfolio](./portfolio/): prices, FX rates, contract specifications, valuation facts, and an identified liquidity input cut for Capacity View.
- **TARGET, after Shared Time producer closure, to [Portfolio](./portfolio/):** the sealed canonical clock-head handoff
  for `PORTFOLIO_FRESHNESS`. Portfolio supplies its exact prior handoff and alone authorizes its transition; it cannot
  walk or skip proof links or compare monotonic sequences across epochs.

## Rejections and prohibitions

- Never select the instruments or time window for a research run, backtest, or scan.
- Never silently fill, rewrite, or forward-date missing historical facts.
- Never treat a reachable source as proof that data is licensed, complete, point-in-time correct, or fit for a strategy.
- Never admit an unavailable, revoked, endpoint-mismatched, digest-mismatched, untrusted, or unlicensed source;
  never expose credential values or data outside its redistribution scope.
- Never own strategy, qualification, deployment, order, or account state.
- Never infer a repair terminal from delivery, silence, a prior snapshot, or a mismatched request proof. A repair
  never mutates the old snapshot or Research Intent.
- Never infer an ordinary snapshot result from submission or transport acknowledgement, or serve an earlier
  snapshot under a changed request identity, content digest, scope, decision cut, or policy binding.
- Never become a global Time Owner or decide another Owner's clock transition.
- Never construct the governed Market Data PostgreSQL repository from a DSN, secret, caller assertion, or ambiguous
  store state alone. The private Market Data store-admission seam must consume and revalidate its exact sealed
  Deployment Store Admission receipt, then
  Market Data must validate current PIT, Source Binding, and clock heads before sealing `ResearchPitTerminal`.
  Ordinary consumers never receive the receipt, capability, raw evidence, or a caller-selected snapshot query.
  Production resolution and dynamic product composition remain `TARGET / UNAVAILABLE`.

## Failure and recovery

Unavailable, stale, unlicensed, ambiguous, or insufficient data fails closed for the dependent consumer. Corrections create a new traceable version rather than rewriting prior receipts. During recovery, Market Data continues supplying valuation facts, but it cannot declare positions, effects, or a Recovery Case closed.

Provider-catalog `LEGAL_REVIEW_REQUIRED` or otherwise unknown rights map to
`RIGHTS_EVIDENCE_UNRESOLVED` and Source Binding `UNAVAILABLE`; they do not become `UNLICENSED` without decisive
denial evidence. `TERMS_OR_LICENSE_BLOCKED` is an R&D Source Intake terminal, not a Market Data state. Market Data
must re-evaluate the underlying rights evidence under its own policy and never copy that terminal across Owners.

When multiple blockers are supported, the binding and snapshot retain all of them and choose one stable primary.
Snapshot precedence is `UNLICENSED` before `AMBIGUOUS`, `STALE`, `INSUFFICIENT`, then `UNAVAILABLE`.
`REVOKED` or `UNLICENSED` source bindings map to snapshot `UNLICENSED`; `INCOMPATIBLE` maps to `AMBIGUOUS`;
source `UNAVAILABLE` maps to snapshot `UNAVAILABLE`. Later evidence creates successor bindings and snapshots and
never upgrades an earlier terminal result.

If any time coordinate or the shared decision cut is missing, conflicting, or cannot prove that the fact was
available at the decision, the snapshot is `AMBIGUOUS` or unavailable. Event time alone never admits a historical
fact, and retrieval after the cut never backfills an earlier decision.

## Decision contract

- **Inputs** - admitted source binding, raw market and reference records, correction feeds, license scope, and a
  requester-owned universe rule or PIT scope.
- **Diagnosis and decision** - normalize meaning, establish four-time availability, resolve instrument identity,
  coverage, correction and license, then materialize one versioned fact or snapshot disposition.
- **Conflict resolution** - source lineage and decision-time availability outrank later corrections; conflicting
  identity, clocks or versions remain ambiguous and corrections create successors.
- **Outputs and terminal negatives** - streams, instrument facts, selection records and PIT snapshots, or explicit
  `INSUFFICIENT`, `STALE`, `UNLICENSED`, `AMBIGUOUS`, and unavailable results.
- **Feedback and economic meaning** - common historical/live semantics prevent phantom Alpha, valuation drift and
  unsafe sizing caused by look-ahead, wrong contract terms or unlicensed incomplete data.
- **Prohibitions** - no research objective, strategy universe choice, lifecycle, order, account projection,
  credential disclosure, forward fill or rewritten availability history.

## Subsequent implementation acceptance

- A historical query can prove exactly which version was observable at its requested time.
- Every admitted fact proves event, provider-available, retrieval, and correction-publication time against the
  same clock and decision cut; no later-known fact can become earlier-available evidence.
- Instrument identity and contract terms remain consistent across research, replay, live data, valuation, and execution adapters.
- Historical and live consumers reject a mismatched Market Semantics Compatibility identity instead of silently
  changing normalization, adjustments, timestamp meaning, or instrument mapping at deployment.
- Every PIT request proves calendar, session, time-zone, corporate-action, lifecycle, historical-membership, and
  universe-selection versions as both effective and observable at the requested cut.
- Every ordinary Research response repeats the exact initial PIT Market Snapshot Request and correlation bindings;
  changed meaning requires a successor request and silence creates no Market Data or Research transition.
- Consumers receive explicit insufficiency or staleness instead of synthetic success.
- A Data Client that answers no rows reports insufficient coverage, not a malformed batch. The snapshot commits
  `INSUFFICIENT` with its coverage blocker and stores no observation batch, because a batch holds at least one row. Its
  records digest is the digest of the canonical encoding of zero rows, which no batch of rows has. The same request
  again rejoins a committed snapshot whatever its disposition, and writes nothing.
- Re-running a snapshot against the same admitted versions yields the same canonical inputs.
- Snapshot outcomes are explicit: `AVAILABLE`, `INSUFFICIENT`, `STALE`, `UNLICENSED`, `AMBIGUOUS`, or
  `UNAVAILABLE`. Every repair response additionally repeats the repair request identity, stable correlation, and
  original request proof digest.
- Simultaneous rights, compatibility, freshness, sufficiency, and availability failures preserve the complete
  blocker set while the frozen precedence selects the same primary under every evidence-arrival permutation.
- Protected replay cannot substitute a different PIT scope, Universe Selection Record identity or digest, snapshot rule, correction frontier, or snapshot identity after Qualification freezes the request.
- Same-epoch handoff replay joins exact bytes; advancement strictly advances required cuts without changing epoch
  semantics. A new epoch fails closed unless its new head and direct immutable proof commit atomically and both remain
  exactly resolvable by digest.
- Native Instrument Master resolution for `BACKTEST_OWNER_V1` returns the same fact/cut identities and canonical
  bytes for the same request identity and meaning; wrong-role, overlap, late-correction, gap, stale, unavailable-store,
  response-loss and changed-meaning cases all demonstrate the fail-closed and successor-only rules above.

## Observability and persistence

Market Data persists Source Binding, rights/retention decision, semantics profile, instrument history, PIT requests and snapshots, stream/valuation facts, corrections, and publication outbox under its own write authority. Telemetry records provider request latency, freshness, gaps, rate limits, correction lag, and bounded rejection category without exporting API keys or licensed payload bodies. Dashboard source health always carries source/semantics versions, as-of frontier, license disposition, completeness, and valid-through; a green provider metric cannot substitute a missing or stale PIT fact.
