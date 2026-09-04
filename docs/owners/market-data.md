# Market Data

## Responsibility

Provide canonical, time-correct market, reference, and instrument facts to every analytical and trading consumer. Market Data owns data meaning and observability, not the strategy-specific selection of what a run should consume.

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
  Successor Proof are not current.
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
or response-loss retry mismatch appends nothing. **NOT_ADMITTED:** R0 grants no provider authenticity, default or
production database write, deployment, runtime, Dashboard or trading authority.

### Shared native boundary and custody

**CURRENT:** Replay V2 has typed Calendar and Time Zone values, while PIT and Instrument Master still carry
calendar, time-zone or ruleset identities without native Calendar/Time Zone readback. Shared Time authenticates
when Market Data observed a fact; it never supplies a calendar day, open disposition, time-zone rule or UTC offset.

**TARGET:** Calendar and Time Zone are independent Market Data native authorities. Their fixed consumers are PIT,
which preserves the direct native cut identity/digest; Instrument Master, which binds native cut identities/digests
rather than strings; Replay V2, which receives deterministic projections; and later BAR resolution. Session is the
sole join of exact Calendar and Time Zone cuts. Neither native authority depends on Session or copies the other's
facts. An untrusted private proposal cannot reinterpret an existing Replay V2 value or mint positive custody.

Both authorities resolve the exact admitted Source Binding in the caller's Owner transaction and use one verified
`ReferenceFactCoordinatesV1` only as observation evidence. Every fact has one lineage root, positive correction
sequence, optional direct predecessor and current head. A missing predecessor, branch, cycle, sequence gap or
regression, cross-source splice, effective overlap/gap, incomplete requested coverage, clock mismatch or expired
observation fails before any write. Positive facts, complete cuts, receipts and move-only readbacks have no public
constructor/deserializer. Public callers receive only an untrusted sealed locator; the resolver is crate-sealed.

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
reserved its bytes are that value, lineage root, correction sequence `u64BE`, optional predecessor, effective-from
and optional effective-until `i128BE`, provider-available, retrieval, correction-publication and Owner-observation
`i128BE`, decision cut `u64BE`, R0 coordinate identity/digest, Source Binding identity/fact digest/lineage root/
`u64BE` version, and source/correction frontier digests.

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

Fact domain is `vibe.market-data.time-zone-fact.v1\0`; bytes are schema, reserved, that value, lineage root,
correction sequence, optional predecessor, the effective and observation fields and exact R0/Source Binding/
frontier tail defined for Calendar, in the same order. Request-meaning domain is
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
and additive BAR composition may consume it, while Backtest and Strategy Factory receive sealed projections only.
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
correction identity and complete R0 observation coordinates. Every scalar is recomputed from those native facts.

Fact domain is `vibe.market-data.session-fact.v1\0`; bytes are schema `u16BE = 1`, reserved, session identity
`u32BE length || bytes`, trading day, interval ordinal, local-open tuple, local-close tuple, UTC open, UTC close,
Calendar fact identity/digest and cut identity/digest, Time Zone open fact identity/digest, close fact identity/
digest and cut identity/digest, Instrument Master readback/fact/cut digests, optional predecessor, correction
sequence `u64BE`, provider-available, retrieval, correction-publication and Owner-observation `i128BE`, decision
cut `u64BE`, R0 coordinate identity/digest, Source Binding identity/fact digest/lineage root/`u64BE` version,
source frontier, correction frontier and correction identity. A correction is an immutable current-head direct
successor for the exact `(session identity, trading day, interval ordinal)` key.

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

**NOT_ADMITTED:** this contract does not claim provider ingestion or authenticity, default or production database migration/write, Strategy Input Registry or
Replay V2 product composition, deployment, runtime execution, Dashboard work or trading authority. A fixture,
caller-carried identity, structurally valid bytes or existing Replay V2 fact is not standalone Owner readback.

### Typed fact, time and correction topology

The closed version-1 value is exactly: non-zero normalization identity `[u8; 32]`; price adjustment `u16BE` with
`1 RAW`, `2 SPLIT_ADJUSTED` or `3 TOTAL_RETURN_ADJUSTED`; timestamp basis `u16BE` with `1 EVENT_EFFECTIVE`,
`2 INTERVAL_OPEN` or `3 INTERVAL_CLOSE`; non-zero price-unit identity `[u8; 32]`; and non-zero size-unit identity
`[u8; 32]`. Zero and every unlisted tag are unsupported. Unit identities name Owner-registry meanings; they are
not unit strings, currency defaults, scale guesses or Instrument Master increment fields.

Each immutable fact binds one Owner-registry compatibility-scope identity, an optional exact predecessor, one
half-open effective interval `[effective_from, effective_until)`, provider-available, retrieval,
correction-publication and Owner-observation coordinates, and a positive decision cut. It also binds the exact R0
coordinate identity/digest and the exact admitted PIT Snapshot, Source Binding and Instrument Master
identities/digests, Source Binding lineage, source and correction frontiers and correction identity. All repeated
coordinate scalars must byte-match the resolved `ReferenceFactR0ReadbackV1`; the standalone authority creates no
second clock or coordinate authority. Effective containment and observation availability are independent
predicates. Every availability coordinate must be observable under the same authenticated clock and decision cut.

A correction is an immutable direct successor in the same compatibility scope. It names the current predecessor,
advances authenticated correction/observation evidence and may retain the corrected effective interval; it never
rewrites or makes its predecessor unavailable at an earlier cut. Different effective regimes cannot overlap.
Missing predecessors, branches, cycles, ambiguous overlap, regressed coordinates/frontiers or a later correction
selected at an earlier observation cut produce no positive fact or cut.

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

One Owner transaction appends immutable facts/heads, the complete cut, receipt, outbox and store
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
availability; later versions carrying the byte-identical source, stream, sequence, successor-only value and
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
contract and canonical codec. One complete cut contains typed, content-addressed calendar-day,
session-interval, time-zone ruleset, Market Semantics, successor-only correction-policy,
corporate-action and historical-membership facts. Every fact binds its half-open effective interval,
provider-available, retrieval, correction-publication and Owner-observation coordinates, decision cut,
Source identity and correction identity. Corporate actions carry their actual split, cash-dividend,
symbol-change, expiry or roll terms. Historical membership carries the exact selection, member,
instrument and inclusion disposition. A complete corporate-action or membership cut may contain zero
members, but that empty census is an explicit content-addressed cut over an exact scope and decision
cut; a string such as `NO_ACTIONS` is never equivalent.

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

**TARGET, durable R&D attestation seam:** the positive R&D Develop Composer transaction canonically persists one
immutable complete `StrategyDesignRoleSetReceiptV1` attestation together with the Composer aggregate, receipt and
outbox. It binds the
exact Research request, Composer aggregate and `StrategyDesignV2`, canonically ordered typed roles, every semantic
coordinate and complete role coverage. Its content-addressed exact locator is known before send. Replay Policy V2
composition is coordinated by the R&D-owned A1 on one `rd_owner` PostgreSQL transaction. On that same transaction,
`rd_owner` resolves the exact R&D attestation through the Composer Owner's locator-only `SECURITY DEFINER` facade and
invokes only the Market Data Owner's bounded locator-only `SECURITY DEFINER` composition facade. Each facade executes
with its owning non-login role, performs its own ordered locks, canonical rereads, validation, sealing and exact
recovery, and returns only the evidence required by A1. The ACL grants `rd_owner` only schema `USAGE` and `EXECUTE` on
those named functions: it grants no raw-table `SELECT` or DML, no role membership, generic query surface, public
positive constructor/deserializer, receipt/readback input, bearer token, cryptographic-key authority,
latest/history/full scan or cross-Owner parser. The fixed `market_data_reader` remains an independent read-only
principal for its separately admitted locator-resolution surfaces; it neither holds the A1 transaction nor receives
the Market Data composition write facade.

W3 issuance accepts only that untrusted R&D attestation locator plus exact Market dependency locators. Market Data
validates the recovered attestation internally, then independently re-resolves every durable registry declaration, the
complete observation census, unchanged V1 joined cut, V4 BAR JOINED_CUT sample projection, R0 and standalone Market Semantics record,
and requires the Market Semantics cut to name the exact recovered R0 cut. It never consumes `StrategyPlanV2` and has no
dependency on Strategy Factory. Binding record, receipt and receipt-payload outbox are persisted atomically with the
unchanged Replay V2 fact, receipt and outbox rows. Exact binding-locator recovery decodes, rehashes and cross-checks both
custody aggregates and returns their byte-identical payloads. Exact attestation-locator recovery after response loss
rejoins the pre-existing R&D attestation without append. No public boundary accepts a resolver, authoritative receipt or
readback, role list, count or token, and no caller representation can mint a positive role set.

**NOT_ADMITTED:** this target does not establish the R&D persistence/read function, its database ACL, registered W3
composition, disposable PostgreSQL Owner readback, deployment, production write, runtime or trading authority.

**TARGET:** admitted deployment and the isolated
disposable PostgreSQL acceptance must then prove exact replay, response-loss recovery, successor-only correction,
and the move-only Strategy Factory and Backtest consumer path.

**NOT_ADMITTED:** the implemented storage, custody and fixed API composition are not an admitted store,
isolated PostgreSQL acceptance, provider ingestion or authenticity proof, default product composition,
Strategy Factory or Backtest consumer, runtime execution, production write, deployment or trading authority. They
do not make the existing exactly-two-member Universe receipt a general Universe Selection Record, do not replace
the V1 joined-cut codec with a V2 codec, and do not permit Source Binding rule strings or a generic
`version = "v2"` label to stand in for a canonical fact cut.

## Instrument Master Owner contract

### Status and fixed consumer

**CURRENT/PARTIAL:** Market Data implements the native `InstrumentMasterFactV1`, `InstrumentMasterCutV1`,
write-once receipt/outbox, move-only `InstrumentMasterReadbackV1`, and sealed PostgreSQL resolver/recovery path
described below for the exact `BACKTEST_OWNER_V1` role. The PIT and Strategy Input product paths still carry a
request-supplied `instrument_master_digest` and compare it with an Owner-verified batch; the representative
Strategy Factory path still freezes a data-Owner role string and an AAPL/MSFT fixture. Those legacy provenance,
role, and mapping paths do not replace the native authority and do not establish product consumption of it.

**TARGET:** direct Backtest product consumption replaces the legacy digest and hard-coded Strategy Factory
role/mapping paths with the existing Owner-sealed resolution. R&D declares research scope and the Strategy
compiler consumes that resolution, but neither may query Instrument Master storage directly, maintain a
symbol-to-instrument or venue mapping, or synthesize a resolution.

**NOT_ADMITTED:** this status does not claim provider ingestion or authenticity, production migration or
production/default database writes, deployment, Dashboard work, dynamic Backtest product acceptance, inverse or
quanto target-consumption semantics, or trading. BAR custody itself is instrument-class neutral when its exact
Instrument Master evidence supports the canonical fixed/session bar. A caller-carried digest, canonical-looking
string, static fixture, transport success,
Owner-only test, or documentation check cannot claim product closure.

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

**TARGET, durable Strategy Input Binding Registry:** Market Data owns write-once, validated binding declarations
keyed by the exact PIT request, `StrategyDesignV2` and typed input role. R&D and Strategy Factory may supply only
Owner-authenticated Design/role intent; they never supply or select members, frames or a binding digest. In one
Market Data Owner transaction, registration resolves the native PIT Snapshot, Universe Selection, Source Binding,
Instrument Master and Market Semantics authorities, derives and stores the declaration and digest, regenerates the
existing V1 bindings and frames, and then runs the existing V1 complete-census and joined-cut authorities unchanged.
Missing registry registration or any request/Design/role, membership, frame, lineage, semantics or digest mismatch
produces no declaration, census, joined cut or replay input. This registry is the prerequisite for positive Replay
V2 composition and for real Owner-driven Strategy Factory and Backtest consumption; it is not a provider registry,
deployment registry or caller-authored data path.

**CURRENT/PARTIAL, authenticated role-set foundation:** the dependency-neutral exact Composer locator and
`StrategyDesignRoleSetReceiptV1` DTO are available, and the production positive-registration seam requires an
authenticated complete role set before it accepts the unchanged V1 request. It verifies the requested Design,
Research request, derived role identity and every semantic coordinate, plus exact complete role coverage. The
observation-census seam likewise verifies that the unchanged V1 join claim exactly repeats one authenticated join
before complete-census/latest-not-after selection. Existing V1 request, binding and receipt bytes and exact legacy
recovery stay unchanged. **TARGET:** W3 admits only the R&D-owned, same-Composer-transaction durable attestation through
its exact-locator DB-ACL read function and makes that seam the only reachable positive path; Market Data then
independently resolves its registry, census, join, V4 sample, R0 and Market Semantics authorities before atomic binding
issuance. **NOT_ADMITTED:** caller-proposed Design/role/join fields, receipt/readback/token, receipt hash,
latest/history/full scans, raw R&D table parsing or Market Data storage do not authenticate Design meaning; Market Data
does not depend on Strategy Factory, own or reinterpret Strategy Design roles or joins, and this foundation claims no
registered W3 resolver or production write.

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
custody, provider connectivity, deployed Windmill readiness, production composition, or trading authority.

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
After restart, resolution of that locator must return the same canonical request, projection, and event identities and
bytes. The only value crossing to Strategy Factory or Backtest composition is the sealed, read-only
`StrategyInputSampleEventResolverV1` capability for that exact request-selected event; no insert, update, delete, head
advance, generic query, raw DSN, credential, admission receipt, or evidence accessor crosses the Owner boundary.

A caller digest, DSN, fixture, fixed corpus, in-memory or temporary-file writer, or signer/witness/credential/measurer
derived by the candidate, caller, consumer, or tested process
cannot mint the request locator, resolver, event, or readback. Missing, stale, superseded, or mismatched head, rotation,
ACL, credential, measurement, request, role, projection, event, locator, or readback fails before `ProgramHost` or
Backtest state mutation and produces no positive resolver or terminal result. Successful proof authorizes only this
disposable profile; production resolver, signer, anti-rollback witness, credential-resolver, and direct-measurement
adapters and the default product entry remain `UNAVAILABLE`. It establishes no provider authenticity, production
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

### CURRENT/PARTIAL EVENT and BAR Owner custody; TARGET BAR product authority

Market Data implements the versioned `TimeframeSpecV1`, `TimeframeProjectionReceiptV1`, `SampleFactV1`, and
`SampleReceiptV1`, their native exact-receipt resolvers, and durable PostgreSQL custody for `POINT_EVENT`. The code
also implements durable PostgreSQL custody for BAR schedule fact/cut/receipt/outbox/head state, admitted exact
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
The Owner-local proposal supplies the effective interval, kind, step, unit, anchor, label, and completion, but it
cannot itself mint authority. Preparation admits only a BAR row cross-bound to one exact native
`InstrumentMasterReadbackV1`; Market Data derives calendar/session/time-zone identities from that readback and
rejects instrument, Market Semantics, frontier, effective-containment, or Instrument Master mismatches.

The structural `BarScheduleCutV1` canonical bytes are schema `u16LE = 1`, reserved-zero `u16LE`, fact digest
`[u8; 32]`, the same canonical-instrument variable bytes, effective instant `i128LE`, then Instrument Master
readback, fact, and cut digests, Market Semantics identity, source frontier, and correction frontier, all `[u8; 32]`
in that order. The effective instant must equal the selected BAR row's event-effective instant and the Instrument
Master cut effective instant, and both the schedule fact and Instrument Master fact effective intervals must contain
it. The current structural codec does not encode interval open/close or Owner observation/decision-cut coordinates;
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
CURRENT/PARTIAL schedule custody and admitted read authority, not Windmill, Backtest, composite, or other product
reachability. A caller locator, structural decode, or reconstructed bytes confers no schedule authority.

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
kind or lifecycle, perform a latest lookup, resolve V2 BAR or JOINED_CUT, or expose storage authority. Strategy
Factory production startup, product composition, ProgramHost, Backtest, composite, Windmill, and every other product
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

An accepted correction is an immutable successor with both an exact series predecessor and correction
predecessor. It creates a new `SampleFactV1`, `SampleReceiptV1`, `sample_identity`, and coordinate and advances the
sample clock exactly once, even when its value bytes equal the predecessor. It never rewrites, replaces, masks,
replays, or retroactively advances predecessor state. An ordinary equal-valued new slot is likewise a new sample
and advances exactly once. For a future admitted BAR path, reusing one 1-hour or exchange-session `1d` sample under
later 1-minute triggers must return the same receipt and coordinate bytes and cause no second sample-clock advance.

The current POINT_EVENT PostgreSQL path has Owner-owned timeframe-projection-receipt, sample-fact, series-head,
per-slot correction-head, sample-receipt, and outbox tables plus exact native resolvers. One Market Data transaction
inserts the fact, receipt, and outbox row
and compare-and-swap advances both the series and correction heads from the predecessors bound by the fact; an
ordinary new slot advances its correction head from canonical absence to that first fact. A
byte-identical replay performs zero writes and returns the exact historical receipt bytes. Identity/content
mismatch, time or version regression, predecessor or sequence gap, competing branch, cycle, cross-lineage splice,
head mismatch, missing/conflicting timeframe projection, or noncanonical bytes fails closed and advances neither
head. Historical exact receipts remain
readable after successors and corrections. No caller, Strategy Factory, ProgramHost, Backtest, fixture, migration,
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
Windmill/default-database admission, or trading authority. These Backtest limitations do not create a Market Data
instrument-class rejection.

## Input handoffs

- Data vendors and trading venues provide raw market and reference records through Data Clients.
- [R&D](./rd/) submits an initial frozen PIT Market Snapshot Request before exploratory consumption.
  It binds the Research Request, Intent, TrialFamily, instrument or universe scope, four-time decision cut,
  required provenance, license and correction frontier, stable correlation, and Time Evidence.
- [R&D](./rd/) may submit one Market Data Repair Request only from a committed `REPAIR_INPUTS`
  Iteration Decision. It repeats the original PIT request identity and proof digest, instrument scope, decision cut,
  bounded reason, stable correlation, required provenance/license/correction fields, and shared Time Evidence.
- Operations supply the Market Data Source Binding, opaque credential handles, license scope, and correction feeds without
  changing observed-at history. Credentials never enter a snapshot, stream, artifact, or product view.

## Output handoffs

- To [R&D](./rd/): one move-only, Market Data-sealed `ResearchPitTerminal` whose canonical six-state
  disposition is correlated to the exact initial
  request identity, content digest, scope, cut, provenance, license, correction, and stable correlation, plus the
  exact Universe Selection Record identity and digest for hypothesis testing. A repair request resolves separately to the same correlated request identity
  as `AVAILABLE` with the repaired snapshot, or terminal `UNAVAILABLE` with a bounded decisive source category.
  Strategy Factory cannot import, construct, deserialize, or implement the terminal authority and receives no raw
  store receipt, PIT lineage rows, Source Binding lineage rows, or clock rows.
- To [Backtest](./backtest/): the exact PIT Market Snapshot and Universe Selection Record for the request-bound PIT
  scope and snapshot/correction rule. **TARGET:** direct `BACKTEST_OWNER_V1` Instrument Master resolution supplies
  the sealed fact/cut readback; actual consumption and Run Result must repeat the exact snapshot, selection,
  Instrument Master fact/cut and every frozen execution identity.
- To [Scanner](./scanner/): the exact PIT Market Snapshot requested by published activation conditions.
- To [Runtime](./runtime/): live market streams and instrument updates carrying the same Market Semantics
  Compatibility identity consumed by the generation's Strategy Artifact and historical evidence.
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
