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

## Instrument Master Owner contract

### Status and fixed consumer

**CURRENT/PARTIAL:** the PIT and Strategy Input paths carry an `instrument_master_digest` supplied on the
request and compare it with the digest carried by an Owner-verified batch. That digest is provenance for the
current bounded path, but it is not a native Instrument Master fact, cut, write receipt, or sealed readback.
The representative Strategy Factory path also freezes a data-Owner role string and an AAPL/MSFT fixture. Those
hard-coded role and mapping choices are an implementation target, not Instrument Master authority. No current
code or dynamic acceptance establishes the TARGET contract below.

**TARGET:** Market Data is the sole writer and resolver of the native Instrument Master state path. Its fixed
cross-Owner consumer role is the exact ASCII identity `BACKTEST_OWNER_V1`. R&D declares research scope and the
Strategy compiler consumes Owner-sealed resolutions, but neither may query Instrument Master storage directly,
maintain a symbol-to-instrument or venue mapping, or synthesize a resolution. Replacing the current hard-coded
Strategy Factory role/mapping path with direct Owner resolution is required implementation work.

**NOT_ADMITTED:** this contract does not admit Rust implementation, a schema migration, provider ingestion,
production/default database writes, Dashboard work, dynamic product acceptance, or trading. A caller-carried
digest, canonical-looking string, static fixture, transport success, or documentation check cannot claim native
Instrument Master custody.

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

**SEALED_ACCEPTANCE only:** enabling the non-default compile-time Cargo feature
`sealed-strategy-input-acceptance` exposes one zero-argument fixture adapter for the fixed AAPL/MSFT,
OPEN/CLOSE corpus. The adapter drives the crate-private Source Binding admission and PIT
prepare/aggregate/verify authorities, then calls the normal universe-frame binder; it accepts no caller-selected
rows, requests, locators, digests, clocks, providers, persistence, or runtime selector. Default and production
manifests omit the feature. A release build that explicitly enables it remains an isolated acceptance artifact,
never a production build. This fixture proves only the compile-time acceptance topology: it provides no PostgreSQL
custody, provider connectivity, deployed Windmill readiness, production composition, or trading authority.

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
