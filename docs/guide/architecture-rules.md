# Architecture rules

These rules are the stable contract between the global Flow, this documentation, and future implementation.

## Bounded overview

- The global Flow contains exactly 13 top-level groups plus one non-authoritative Event Rail channel node.
- Each group contains no more than five modules.
- Strategy Factory is a value-stream boundary. R&D is one business Owner containing both Research and Develop capabilities; Backtest remains a separate evidence-producing service Owner.
- Product Edge, Observability, and Event Rail are boundaries or channels, not business-truth owners.
- New detail belongs in prose unless it changes authority or an owner handoff.

## Normative publication authority

The only current normative product-document roots are `guide`, `architecture`, `owners`, and `scenarios`.
Together they define the TARGET architecture and the published information architecture. Other historical source
roots are retained only as backup and migration evidence: they are not TARGET, are not published, and cannot be
used to override this contract. Deleting, restoring, or remigrating any legacy root requires new, explicit,
scoped user authority; build or navigation logic must never republish one implicitly.

Every public invariant must be discoverable without reading implementation code or a private test: its canonical
object, authority Owner, allowed relations, accepted, rejected, unknown, and replay meanings are published from
`architecture-contract.json` and linked from the corresponding Owner or guide page. A test may enforce a published
invariant but cannot create one. Missing public semantics block a development chunk rather than inviting an Agent
to infer a hidden contract from test names.

## Product Edge request authority

Each target deployment has exactly one `ACTIVE` Agent Shell binding selecting the canonical
`WINDMILL_PRODUCT_EDGE` admission gateway in steady state. Windmill App and Windmill MCP are channels behind that
gateway, not separate writers. A client- or transport-only change preserves the same effective principal, scope
policy, approved Skill/MCP capability policy, and audit policy. During cutover, zero `ACTIVE` bindings is allowed only as a fail-closed interval. The exact
predecessor commits `SUPERSEDED` before the policy-equivalent successor commits `ACTIVE`; multiple, stale, or
policy-mismatched bindings admit no mutating Owner request. In-flight work retains its original request and
binding identities across that transition.

Each commit binds the authoritative deployment-history head before and after commit. Genesis is allowed only for
an empty history at generation one. Every later successor durably and atomically serializes against the exact current head, names that
superseded predecessor, increments generation by one, advances cutover epoch, and uses a history-unique binding
identity. The zero-active window never resets history.

Every mutating Product Edge request has a stable identity, trusted authorization context, typed meaning, target
Owner operation, and audit correlation. Its atomic admission reads and binds the authoritative deployment-history
head; the unique `ACTIVE` binding must equal that head at the admission cut. `SUPERSEDED` is monotonic and
irreversible. Shell or transport success is only `SUBMITTED_OR_UNKNOWN`; the receiving Owner receipt is
authoritative. Same identity and meaning join the same receipt, changed meaning rejects, and an already admitted
in-flight request continues to resolve under its original binding even after a newer head becomes active.

Product Edge is the unique writer of content-addressed Agent Operation Manifests, Agent Shell Deployment
Bindings and their history head, immutable request admissions, and the matching outbox. A separately named
**Operator Authorization Issuer** is the unique writer of authorization issuance and its revocation frontier.
Product Edge may only direct-resolve the Issuer's canonical facts; Windmill, an API, R&D, a token, configuration,
or Product Edge admission code cannot issue or self-assert them. Both writers use distinct PostgreSQL roles in
one authority database. Admission holds a shared lock on the exact issuance and revocation frontier while it
commits, and revocation takes the conflicting update lock. This common cut, rather than a copied DTO, cache, or
signature checked by the same caller, decides whether an authorization is current.

Deployment genesis is an explicit one-time administrative operation, never a service-start or request-path
default. It requires completely verified empty binding and head history, expected head `EMPTY`, generation one,
a finite validity interval, content-addressed manifests, one immutable receipt, and its outbox. Exact replay joins
the same bytes; concurrent or changed meaning conflicts without creating another `ACTIVE` binding. Cutover first
commits the exact predecessor `SUPERSEDED` fence and only then may commit its policy-equivalent successor
`ACTIVE`; the zero-active interval is fail closed and no request may recreate genesis.

An immutable Product Edge Request Admission binds the stable request identity and typed-payload digest, exact
deployment binding and head, effective principal and scope, authorization identity, issuer and key version,
validity and revocation frontier, manifest identity and digest, operation, schema, target and effects, time
evidence, request-proof digest, and audit correlation. R&D receives only its locator and directly resolves the
complete canonical admission before S1 or S2 mutation. If no downstream custody has committed, later expiry or
revocation forbids the first submission. A committed downstream receipt remains resolvable under its original
admission cut, but recovery cannot start a new provider or external-effect invocation without a new one-use
invocation admission at a current authorization cut. Supersession, expiry, and revocation never rewrite an
admission or downstream Owner receipt.

Rows previously accepted only from environment-constructed authority are never backfilled or retroactively
blessed. Terminal legacy rows are read-only and quarantined; an identity collision fails closed, and activation
stops while any legacy nonterminal S2 custody remains undrained. Missing, dual, stale, expired, revoked,
wrong-issuer, wrong-audience, cross-principal, cross-scope, proof-mismatched, manifest-mismatched, digest-mismatched,
or mixed-cut authority creates no Product Edge admission and no downstream Owner write or provider call.

`LegacyPreparedAttemptDrainV1` is the only bounded exception for an exact historical schema-v1 `PREPARED`
APP or MCP request. The original attempt bytes remain immutable. An explicit bounded admin may append an
Owner-only canonical receipt and its Owner outbox event in the same transaction only when they bind the exact
attempt and column digests, build and attempt identities, canonical Product Edge admission, target database,
and exhaustive zero canonical effect-admission, claim, state, artifact, provider-start custody, and non-drain
attempt/build outbox facts. Startup, request handling, and `Resolve` cannot create this receipt. The exact
all-target operation is idempotent; a partial completed set, changed or extra target, digest mismatch, effect,
or fault writes nothing. A verified receipt projects only legacy-quarantined `OUTCOME_UNKNOWN` with
`PROVIDER_NEVER_STARTED` and permits only same-identity read and `Resolve`; it never creates current custody,
freshness, authorization, artifact, family, successor, provider retry, or effect authority. Startup may ignore
that exact row only after the canonical receipt and outbox both verify; every undrained, malformed, mismatched,
or unknown row still blocks activation. Isolated local recovery evidence is not production authority and does
not establish default-database, Windmill, or product maturity acceptance.

The request's Authorization Lineage is the indivisible tuple of stable request identity, effective principal and
scope, admitted `ACTIVE` shell binding and exact deployment-history head, Operator Authorization, and Agent
Operation Manifest. Every accepted Governance lifecycle decision declares either `ATTENDED_REQUEST` or
`UNATTENDED_REQUEST_WITH_POLICY`, and both modes cross-bind and preserve that complete request lineage.
`UNATTENDED_REQUEST_WITH_POLICY` additionally requires a separate Autonomous Policy Authorization, admitted by
the lifecycle request and bounded to one policy version, generation, Execution Scope, allowed intent/action
classes, capital bounds, validity, revocation frontier, and operation manifest. It augments rather than replaces
the request lineage. A bare decision is not automatic-trading authority. Application, intent, Risk permit,
command, Effect Journal, and readback preserve the mode and every identity required by that mode end to end.

`ATTENDED_REQUEST` is non-running authority. It may inspect state or request a decrease-only `REDUCTION`, `PAUSE`,
`RETIREMENT`, `DE_RISK`, or `RECOVERY` action, but it cannot create `ACTIVE_GENERATION`, `APPLIED`, normal Paper
or Live add-risk, or an adapter effect. `INITIAL_ACTIVATION`, `PROMOTION`, and automated Paper or Live require
`UNATTENDED_REQUEST_WITH_POLICY`. `PROMOTION` covers the bounded higher-capital or active-successor transition;
resume and capital-increase names are not lifecycle-action aliases. A future attended external-effect path would require a separate explicit
attended-effect contract; presence of a principal does not imply that contract.

Research and Strategy Governance each own their request-correlated write-once terminal receipt. Qualification
uses its existing write-once Candidate Intake Receipt as the terminal receipt for a Qualification Review Request
and returns it through a dedicated committed-fact handoff separate from the bounded status read model.
That intake receipt binds the stable request identity and canonical typed meaning. `ACCEPTED` binds the exact
resulting Research Intent or Authorized Generation Decision identity. `REJECTED_NO_WRITE` proves no Owner
transition. Receipt absence preserves `SUBMITTED_OR_UNKNOWN`; it is not an implicit rejection or acceptance.

## One authority per mutable fact

Each mutable business fact has one writer. Research owns artifact identity. Qualification owns eligibility.
Governance owns deployment and lifecycle decisions. Runtime owns strategy-instance, checkpoint, readiness, and
incident facts. Risk owns decisions, reservations, and fence activation. Execution owns orders, external effects,
Recovery Case, Recovery Command, and `KNOWN_CLOSED`. Portfolio owns account and
performance projections. A cache, event, notification, or read model cannot become a second authority.

## Research, development, and qualification

Exploratory replay is accepted for selection only when request and result are exactly equal. A terminal
Exploratory Run Result repeats the Strategy Artifact, requested PIT scope, PIT Market Snapshot identity, Universe
Selection Record identity and correction rule, replay configuration, Runtime kernel, simulator, and cost, slippage,
and capacity-model versions exactly. Only a request-equal terminal result may enter Research Selection. Rejected,
invalid, unknown, nonterminal, or mismatched attempts remain TrialFamily Census facts only.
The exact cost, slippage, and capacity-model identities also remain equal from Research Intent through Exploratory
Replay Request and Result, Diagnosis, Iteration Decision, Research Selection, and Candidate. A model change is one
explicit successor-Intent hypothesis change, never a silent replay or selection reinterpretation.

Exploratory results may return from Backtest to Research. Research commits one terminal Research Selection
Disposition cross-bound to the exact Intent falsifier, stop rule, exploratory frontier, Candidate, and Census
Frontier. Only `SELECTED_FOR_QUALIFICATION` enters the independent protected path. Protected results never return
to the same R&D loop. Eligibility is a fact consumed by Governance, not permission to bypass Governance. Before a
fresh Research program, R&D first commits a sealed principal/request-scope Independence Basis Receipt.
Qualification directly resolves that receipt and its own complete durable history to publish only
`GENESIS_EMPTY`, an opaque current `FRONTIER(ref, cut)`, or `UNAVAILABLE`. Product Edge transports that
principal/scope-bound projection and cannot assert genesis, emptiness, disposition, basis identity, or a frontier.
Physical custody follows the same boundary: R&D has no raw Qualification table read or write privilege and may
only invoke the Qualification-owned locked admission function; Qualification Rust must canonically verify its raw
envelope before producing a sealed positive readback. After that final reread, the consuming R&D transaction
samples one final cut immediately before its first write and rechecks every half-open authority interval there.
R&D then resolves its own locked local history as `GENESIS_EMPTY`, `COMPLETE_FRONTIER`, or `UNAVAILABLE`; only
current canonical reads from both Owners may commit the Intent and TrialFamily. Research preserves semantic
predecessors without receiving protected detail; Qualification alone resolves cross-family ancestry and cumulative
holdout disposition. Changing TrialFamily, Candidate, Artifact, shell, or request identity cannot reset either history.
A terminal Research stop creates no Selection or Candidate and therefore never reaches Qualification. A missing or
mismatched selected-only disposition produces `NOT_ADMITTED` before protected replay and consumes no holdout.
Every selected Candidate also binds one pre-result Protected Robustness Plan. It fixes the complete finite set of
required time-window, regime, instrument-slice, perturbation, and reasonable parameter-neighborhood cells plus
coverage, metric, tolerance, threshold, aggregation, missing-cell, and stop policies. An axis may require multiple
cells. The plan, request, result, and assessment repeat the exact plan-cell-set digest; the result and assessment
must account for every frozen cell exactly once. Qualification owns the resulting categorical assessment;
protected measurements and cell detail never return to R&D. One attractive aggregate, one cell
per axis, or one protected terminal result cannot substitute for the complete plan.
For a qualified Candidate, the Eligibility Fact also binds one downstream-enforceable economic-condition version,
evaluated cost/capacity-model version, and qualified capacity ceiling. Governance and Risk preserve that exact
provenance; no candidate Capital Envelope exceeds the Qualification ceiling, lifecycle ceiling, or current compatible Capacity View estimate.

A frozen Candidate and its Candidate Intake Receipt bind one preregistered protected decision-policy identity and
version. The `ADMITTED` intake, Protected Replay Request, and initial or renewed Eligibility Fact must repeat that
exact pair; missing, substituted, or changed policy identity/version is `NOT_ADMITTED` before request creation or
requires a successor protected evaluation, never reinterpretation of prior evidence.

A Protected Replay Request freezes the exact Strategy Artifact, requested PIT scope, exact PIT Market Snapshot
identity, snapshot and correction rule, replay-configuration digest, Runtime kernel, simulator, and cost,
slippage, and capacity model versions.
The Protected Run Result repeats the consumed counterpart of every field, and each pair must be exactly equal.
Any omission, substitution, or mismatch is `INVALID_REPLAY_EVIDENCE`, closes the attempt under Qualification's
preregistered holdout treatment, and can produce no Eligibility Fact.
An initial or renewed Eligibility Fact cross-binds that exact Protected Replay Request, the exact
`TERMINAL_RESULT` Protected Run Result, the protected decision-policy identity and version, and Qualification's verified
request/result equality. A rejected, invalid, nonterminal, or mismatched result can never produce Eligibility.

## Automated trading write chain

An Authorized Generation Decision is permission, not Runtime state. Runtime separately owns a Generation
Application Receipt. Only `APPLIED`, bound to exactly one Strategy Instance, checkpoint, decision, generation,
Execution Scope, artifact, and fence epoch, proves running state. `REJECTED_NO_INSTANCE` proves no instance;
`APPLICATION_UNKNOWN` blocks duplicate application and automated intent until the same attempt is reconciled.

The normal add-risk chain is exact and ordered:

1. Governance authorizes one generation and immutable Execution Scope under an explicit authorization mode.
   `INITIAL_ACTIVATION`, `PROMOTION`, and automated Paper or Live require
   `UNATTENDED_REQUEST_WITH_POLICY` plus a current Autonomous Policy Authorization. `ATTENDED_REQUEST` remains
   non-running and decrease-only. Authorization does not prove execution.
2. Runtime applies that decision. Only its `APPLIED` Generation Application Receipt proves one Strategy Instance.
3. The applied instance sends one Trade Intent to Risk.
4. Risk returns terminal `ALLOW` plus a one-use Reservation, or `REJECT` with no Reservation.
5. Runtime sends Execution an Authorized Order Command bound to that exact decision and Reservation.
6. Execution validates the binding and sends one stable Reservation Claim Request to Risk.
7. Risk durably and atomically serializes one immutable `CONSUMED`, `WITHDRAWN`, or `REJECTED` claim result;
   only `CONSUMED` permits preparation.
8. Execution durably records one stable `PREPARED` attempt, then sends one `ADAPTER_ADMISSION_REQUEST`.
9. Risk durably and atomically serializes admission with recovery fence activation and commits one immutable
   `ADMITTED_ONCE`, `SUPPRESSED_BY_FENCE`, or `REJECTED` result.
10. Only matching `ADMITTED_ONCE` permits Execution to persist `INVOCATION_STARTED` and invoke the adapter.
11. Adapter response and authoritative readback close the Effect Journal without a naked retry.
12. Execution reports outcome and settlement lineage to Risk, and order, fill, rejection, readback, and
    reconciliation facts to Runtime.
13. Execution reports account, order, fill, fee, venue, and settlement lineage to Portfolio. Portfolio publishes
    the coherent projection bundle; Risk then closes or retains Reservation liability from that same lineage.

Risk never issues an order command. Execution rejects a missing, stale, mismatched, or already consumed permit.
Governance owns one immutable Execution Scope for every generation: strategy generation, `PAPER` or `LIVE` mode,
account namespace, and effect namespace. Portfolio separately owns the immutable Capacity Scope key: account,
mode, and economic pool only, never strategy or generation. Every shared indivisible gross constraint maps to
one key; Paper and Live differ, and unresolved overlap fails closed. Intent, decision, reservation, command,
effect, account, and feedback facts must repeat compatible identities.
The same authorization mode, request, principal, scope, admitted shell binding and history head, Operator
Authorization, and operation manifest must remain resolvable through every normal write-chain fact.
`UNATTENDED_REQUEST_WITH_POLICY` additionally preserves and revalidates the same Autonomous Policy Authorization;
`ATTENDED_REQUEST` never substitutes a policy identity for any request-lineage member.
Runtime commits local suppression and immutable `NOT_READY` readiness before publication. Risk independently
activates the matching fence without waiting for Recovery Case acknowledgement; readiness expiry also fails
closed. Risk first arbitrates claim versus expiry, fence, or policy withdrawal; only `CONSUMED` permits a prepared
attempt. It then arbitrates each `ADAPTER_ADMISSION_REQUEST` versus fence activation. Only `ADMITTED_ONCE` can
reach invocation; `SUPPRESSED_BY_FENCE` and `REJECTED`
prove no invocation. Mixed, missing, or conflicting no-effect proof variants fail closed.

The normal decrease-only chain is separate and equally ordered. Governance commits the lifecycle decision,
Runtime stops new strategy intent, Risk returns exact `PERMIT_DECREASE_ONLY`, and Runtime sends a bounded command
whose Reservation and Reservation Claim fields are explicit-none. Execution validates that shape, durably records
one `PREPARED` attempt, and sends one `ADAPTER_ADMISSION_REQUEST` without creating a Reservation Claim Request.
Risk atomically orders that request against same-scope fence activation and returns exactly one immutable
`ADMITTED_ONCE`, `SUPPRESSED_BY_FENCE`, or `REJECTED`. Only matching `ADMITTED_ONCE` permits
`INVOCATION_STARTED` and an adapter call. Replay or restart joins the same attempt and admission result; the
absence of Reservation and claim never bypasses preparation, admission, or fence arbitration.

For every Capacity Scope, Risk owns one durably and atomically serialized Aggregate Commitment Frontier. Portfolio
supplies a candidate-neutral gross Capacity View and a coherent Portfolio Risk Evidence Bundle containing
projected exposure, open orders, account/valuation cuts, and incorporated Execution settlement lineages. Portfolio
never reads Risk state or computes remaining headroom. Risk joins that bundle with every held Reservation liability,
deduplicates stable economic lineages, and alone computes usage and headroom. Unknown effect consumes worst-case
capacity. A stale serialization attempt or missing, stale, incomplete, overlapping-unknown, or mismatched member
rejects without a Reservation. `WITHDRAWN` and authoritative `NO_EFFECT` may release liability. `SETTLED` alone
does not: liability remains held until the same serialized transition replaces it with a Portfolio bundle that
covers the exact Execution settlement/readback lineage, without counting both.

Governance publishes a Capital Envelope applicability chain with one `POOL_ROOT` envelope for the Capacity Scope
and one `STRATEGY_GENERATION` envelope for the intent generation. The intent is bounded only by its own chain;
sibling envelopes are not folded into a global minimum, while aggregate usage remains under the common pool ceiling.
A narrowing below current usage supersedes the wider Capital Envelope. Risk alone commits
`OVERCOMMITTED_NO_NEW_RISK` on its Aggregate Commitment Frontier; Governance neither creates nor clears that
state, reads it through a hidden handoff, nor treats envelope publication as proof of current usage.

The dependency order is acyclic. Deployment configuration first admits immutable account, mode, economic-pool,
market-source, and Execution-adapter bindings. Portfolio then owns the candidate-neutral Capacity Scope and may
publish its gross ceiling and coherent Portfolio Risk Evidence Bundle. Qualification supplies generation-specific economic evidence;
Governance may then authorize a generation bound to the pre-existing Capacity Scope and admitted Execution Scope.
Risk consumes those facts but never creates or repairs them.

## Active generation retention

`ACTIVE_GENERATION` is retained only by an explicit Governance renewal bound to current Eligibility and every
required Performance, Exposure, and degradation-evidence cut. Eligibility that is expired, revoked, missing, or
unknown, or any required retention evidence that is stale or unavailable, immediately supersedes add-risk
authority with `DE_RISK_PENDING`. Runtime stops new intent and Risk rejects new risk from that successor cut.
Governance then drives the decrease-only chain until the generation is reduced, paused, retired, or its effects
enter Recovery. Missing Capacity View, performance, or exposure evidence must never block pause, reduction, or
retirement because those transitions do not add risk. A later return of evidence cannot silently revive the old
generation; resume requires a fresh Authorized Generation Decision and, when unattended, Autonomous Policy Authorization.

## Decrease-only lifecycle chain

A reduction, pause, or retirement is not a normal add-risk trade. Governance commits a decrease-only lifecycle
decision. Runtime first stops new strategy intents and applies the decision, then proposes only cancel, reduce-only,
flatten, or readback work. Risk validates non-increasing exposure and returns a decrease-only decision without an
add-risk Reservation, expressed only as exact `PERMIT_DECREASE_ONLY`. Runtime creates a bounded command bound to
that permit and explicit-none Reservation/claim lineage. Execution records the stable attempt as `PREPARED`, then
requests adapter admission; Risk orders that request against fence activation without creating a claim. The
Execution adapter gate invokes only after `ADMITTED_ONCE`, admits only cancel, reduce, flatten, or readback, and
rejects any add-risk shape. Execution enforces the admitted adapter binding and reduce-only capability, journals
the effect, and reads back the external state. Portfolio projection and Execution
reconciliation prove the resulting exposure before Governance closes the transition. An unknown effect never
becomes a successful reduction: it opens Recovery and keeps the generation fenced.

Attended normal lifecycle de-risk uses this narrow `PERMIT_DECREASE_ONLY` gate. Recovery does not: Risk proves the
complete current `ACTIVE` fence set at one Aggregate Commitment Frontier. Only an action in the deterministic
intersection of every member's versioned set may reach Execution; an empty intersection permits no command.
Neither authority permits activation, ordinary add-risk flow, or exposure increase.

## Paper and live parity

Paper and live use the same Strategy Instance, risk, order, effect, reconciliation, and feedback contracts. Paper
uses a simulated Execution adapter; live uses a venue adapter. Adapter choice, account namespace, and effect
namespace derive from the exact Execution Scope and belong to Execution, not Runtime. Paper and Live namespaces
can never equal or alias, and cross-mode facts are rejected rather than merged, including after replay or restart.
Runtime and Execution reject a missing, opposite-mode, or mismatched scope and cannot override Governance mode.

## Scheduled scanner

Scanner is a scheduled proposal producer. It reads governed deployable strategies, Market Data facts, and an
optional bounded Portfolio capacity view. It records insufficient data and submits matched evidence to
Governance. It never activates a strategy or sends a trade intent.

Capacity View identity binds its immutable account-plus-mode economic-pool Capacity Scope, exact account and collateral fact cut, gross ceilings by dimension and unit, valuation version, liquidity input
cut, candidate-neutral pool methodology and assumption versions, measurement time,
and validity deadline. It remains optional unless a
published activation condition requires it; when required, missing, stale, unavailable, or mismatched identity
commits `INPUT_UNAVAILABLE` and cannot become `MATCHED`.

Capacity View is also the current Portfolio-owned read-only gross economic ceiling for deployment and add-risk control.
`INITIAL_ACTIVATION` requires a fresh compatible Portfolio Lifecycle Evidence Receipt. `PROMOTION` additionally
requires fresh exact Performance and Exposure Receipts under the `PROMOTION` transition-evidence key.
`PAUSE`, `REDUCTION`, and `RETIREMENT` remain available when capacity evidence is absent. Governance
binds the compatible evidence into its generation decision and policy. Risk binds a fresh exact Capacity View at
each add-risk decision and terminally rejects missing, expired, scope-, condition-, methodology-, assumption-, or
liquidity-mismatched evidence without creating a Reservation. Risk additionally admits the decision only against
its same-scope Aggregate Commitment Frontier usage. Portfolio never allocates capital, tracks commitment, reads Risk, or grants permission.

## Security bindings

Product Edge mutating requests bind a non-self-assertable Operator Authorization issued for the exact principal,
audience, scope, expiry, revocation frontier, request proof, and content-addressed Agent Operation Manifest.
Research Strategy Artifacts bind code bytes, dependency provenance, runtime and sandbox policy, capability manifest,
Artifact Security Admission, and explicit denial of ambient filesystem, network, secret, and effect-port access.
Market Data admits each source through an immutable Market Data Source Binding covering implementation and configuration digests,
authenticated endpoint, dataset/account mapping, normalization policy, trust policy, license scope, and opaque
least-privilege credential handle. Execution Scope binds the equivalent adapter identity, venue or simulator
endpoint, account mapping, capability and reduce-only policy, trust policy, and opaque credential handle. A secret
value is never copied into an artifact, request, command, journal, or read model.
Security verification traces the authorization mode and complete Authorization Lineage from the accepted
Governance receipt through Runtime, Risk, Execution, and authoritative readback. For
`UNATTENDED_REQUEST_WITH_POLICY`, it additionally traces and revalidates the Autonomous Policy Authorization.
A missing, expired, revoked, scope-mismatched, or history-head-mismatched required member fails before Reservation
creation or adapter invocation.

## Readiness, time, and effect closure

Every mutating Owner exposes an observable readiness state. Startup remains `NOT_READY` until authoritative facts,
frontier recovery, adapter/source admission, and clock evidence are reconciled. Overload applies bounded admission
and explicit backpressure; partial Owner outage makes dependent transitions unavailable rather than buffering an
unbounded promise. Shutdown enters `DRAINING`, rejects new mutation, preserves accepted identities, resolves or
surfaces unknown effects, and records a restart cursor. Readiness is not business permission.

Freshness and deadlines bind shared Time Evidence: clock identity and epoch, wall and monotonic observations,
uncertainty and skew bound, restart relation, and comparison rule. A consumer cannot compare timestamps from
unknown epochs or silently extend validity. SLOs observe admission, decision, effect-readback, projection, and
recovery-closure latency plus queue depth and dropped wake counts; they never rewrite business truth.

Time evidence is typed by use, not reduced to one timestamp:

Every time-sensitive architecture object declares exactly one canonical `timeEvidenceCutKind`. The six matrix
rows and those object declarations form an exact bijection: an undeclared time-sensitive object, a duplicate row,
or a declaration absent from the matrix is contract-invalid. This includes source bindings and PIT requests,
protected request/result/assessment evidence, Trade Intent and Authorized Order Command, incident and drift facts,
Recovery admission and closure, and every explicitly time-bound Portfolio fact. The selected row contributes its
complete required bindings; a local timestamp cannot satisfy the declaration.

- `MARKET_DATA_AS_OF` binds event-effective, provider-available, retrieval, and correction times for PIT snapshots,
  streams, and valuation facts. Observation time cannot replace any of those cuts.
- `RESEARCH_AND_GOVERNANCE_DECISION` binds the decision to one clock epoch, monotonic sequence, observation time,
  and `valid-through`; a later wall time cannot rewrite when evidence was available.
- `SCANNER_DUE_SLOT` additionally binds time-zone ruleset identity and version, local scheduled time, resolved UTC
  interval, DST fold or gap disposition, misfire/backfill policy, and due-slot boundary. A fall-back fold yields
  distinguishable slots; a spring-forward gap follows the frozen skip or shift policy rather than running twice.
- `PORTFOLIO_FRESHNESS` binds Capacity View, Performance Receipt, Exposure Receipt, Portfolio Interaction Receipt,
  and Portfolio Lifecycle Evidence Receipt to one clock identity and epoch, monotonic sequence, observed-at,
  uncertainty/skew bound, restart-continuity proof, `valid-through`, and complete source-fact frontier. Mixed epochs,
  incomplete frontiers, or expired evidence cannot drive Scanner, Governance, or Risk.
- `RISK_AND_EFFECT_FRONTIER` binds each decision, claim, effect, and settlement to its aggregate or effect frontier
  cut so wall-clock ordering cannot override durable serialization.
- `RECOVERY_CLOSURE` binds one causal frontier and common evidence cut across Runtime, Risk, Execution, and
  Portfolio; mixed clock epochs or uncertain continuity keep the case open.

Restart without proven continuity creates a new clock epoch. Excess skew, ambiguous DST resolution, stale
`valid-through`, or a missing required time field fails only the dependent transition and can never be normalized
away by local time conversion.

### Shared Time clock-head handoff

**CURRENT:** Market Data atomically persists one private canonical clock head with its own Source Binding and PIT
facts. The implementation supports exact replay and same-epoch advancement and rejects an epoch change. It exposes
neither a canonical cross-Owner handoff nor a current epoch-successor proof.

**TARGET:** Market Data remains the Owner-local producer; there is no global Time Owner. Its sealed read-only
clock-head handoff is immutable, content-addressed, and exactly resolvable. It binds the head identity and digest,
clock identity and epoch, monotonic sequence, wall observation, decision cut, exclusive `valid-through`,
restart-continuity digest, uncertainty and skew bounds, and the comparison rule. A same-epoch successor strictly
advances every required cut while preserving epoch-stable semantics. A new epoch is consumable only with one direct,
immutable Epoch Successor Proof committed atomically with the new head. The proof binds the exact predecessor and
successor head digests, prior and successor epoch identities, successor continuity digest, proof identity, commit cut,
and comparison rule. Consumers cannot walk a chain, skip a predecessor, or compare sequences across epochs. Each
consumer supplies its exact prior sealed handoff and alone decides its own transition. After producer closure,
Portfolio `PORTFOLIO_FRESHNESS` is the first TARGET real consumer.

### Deployment Store Admission

**CURRENT:** `crates/data/src/owner/store_admission` keeps the non-business PostgreSQL admission mechanism and its
pre/post revalidation inside the Market Data crate. The fixed `rd-owner-api` bootstrap requests that private seam;
unavailable production resolver, signer, anti-rollback witness, credential resolver, or direct measurer fails closed
before repository construction. Market Data then rereads current PIT, Source Binding, and clock heads and seals
`ResearchPitTerminal`. Strategy Factory receives only the sealed terminal resolver: no raw receipt, capability, query,
DTO, evidence accessor, or caller-authored positive authority crosses the Owner boundary. The generic S3 catalog
remains mechanism, not authority.

**TARGET:** One Market Data-private, non-business Deployment Store Admission Custodian, absent from business
`authorityOwners`, Flow, and Dashboard, owns only a signed append-only store manifest and history, one unique signed current head, direct target
measurements, immutable admission receipts, rotation fencing, and custody incidents. The manifest binds environment,
deployment, consumer Owner, backend, endpoint, TLS, server and database or bucket and prefix identities; PostgreSQL
schema, migration, function, role, and ACL identity or S3 capability and version semantics; an opaque credential-handle
identity, audience, and version; and predecessor, generation, validity, and recovery. A positive receipt requires the
signature, current head, anti-rollback witness, direct measurement, credential lease, and closed rotation fence. It
cannot be assembled from caller-authored positive evidence. Restart or cache loss re-verifies signatures and the head
and remeasures the target. Ambiguity yields no Owner repository and no business retry.

The intended default consumer is the `product/rd-workbench` `rd-owner-api` bootstrap composition. Before Market Data
constructs the governed PostgreSQL repository, its private seam must consume one sealed store-admission receipt for the
exact Market Data Owner, PostgreSQL backend, environment, deployment, and consumer identity. S3 remains TARGET and
`UNAVAILABLE` until a real catalog consumer and pinned disposable S3-compatible test authority exist. Receipt and raw
store/PIT/source/clock evidence stay inside Market Data; the first ordinary-consumer value is a sealed
`ResearchPitTerminal`. The default product entry remains `UNAVAILABLE` until its distinct production resolver, signer,
anti-rollback witness, credential-resolver, and direct-measurement adapters exist.

**`ISOLATED_EVENT_REPLAY_ACCEPTANCE_V1` / TARGET:** This explicitly selected profile is the only admitted non-default,
non-production dynamic acceptance topology before those adapters exist. An immutable acceptance trust bundle is
provisioned by the canonical management plane outside the repository, candidate, caller, consumer, and tested process and pins the environment, signer key
fingerprint, witness, credential-resolver, and direct-measurer identities. Separately executed principals issue the
signed append-only manifest/history and exact current head, maintain the witness, lease the opaque credential handle,
measure the disposable PostgreSQL target, and close rotation; the candidate and caller have none of those write or
secret authorities. The admission receipt cross-binds that bundle and every observation. The remaining stages are:
Market Data-private admission and custodian; an Owner-issued
request-to-projection/event locator and durable readback; sealed read-only `StrategyInputSampleEventResolverV1`;
`ProgramHost`; the real BacktestEngine and Sim Exchange; and a Backtest Owner terminal-result receipt with restart
readback. Raw custody evidence never crosses to the consumer. Backtest atomically commits the exact request, attempt,
actual-consumption record, diagnosis, and result; byte-identical retry joins the same canonical bytes, while changed
meaning conflicts and performs no write.

The profile fails closed before `ProgramHost` or Backtest mutation when any signature, head, rotation, ACL, credential,
measurement, request, locator, projection, event, role, or readback binding is missing or mismatched. A raw DSN, caller
digest, fixture, fixed corpus, in-memory or temporary-file writer, or signer/witness/credential/measurer derived by the
candidate, caller, consumer, or tested process cannot create a
positive resolver or result. Successful isolated evidence proves only that exact disposable topology; it cannot promote
production readiness, deployment authority, Paper, Live, real trading, or another production write.

**NOT_ADMITTED:** the custodian creates no business fact or receipt, global registry, scheduler, or deployment service;
stores no raw DSN, secret, or private key in artifacts or logs; performs no automatic DDL, role, credential, bucket, or
provider mutation or probe; and authorizes no production write, Dashboard implementation, or trading.

The Shared Time producer state machine precedes its Portfolio consumer. Disposable PostgreSQL acceptance must cover
private admission, pre/post revalidation, Market Data current-head checks, and the explicitly selected isolated consumer
path; fixtures do not prove production adapters. Production signer, resolver, witness, credential-resolver, direct-
measurement, default-product, and S3 adapters remain unavailable without their own evidence.

Execution's Product Edge Effect Closure View distinguishes `UNKNOWN_EFFECT`, `NO_EFFECT`, and `SETTLED`, and binds the exact
effect frontier, readback/reconciliation cuts, blockers, freshness, and responsible Owner. Recovery projection
separately distinguishes Runtime readiness `NOT_READY`, Risk fence `ACTIVE`, and Execution case `OPEN`,
`FENCED_OPEN`, and `KNOWN_CLOSED`. A view can
explain progress but cannot declare a transition its source Owners have not committed.

Research never receives that view as source evidence. Successor-only research provenance binds exact committed
Execution account, order, fill, quality-observation, Effect Journal, readback, or Reconciliation Drift fact
identities and their source cuts; a mutable projection or Event Rail wake cannot stand in for those facts.

## Localization stability

Canvas Owner, boundary, channel, and module labels are canonical English in every locale so language switching
does not change topology or layout. Scenario labels, navigation, prose, node descriptions, and the bottom detail
and proof capsules are localized. Locale changes replace those texts without changing node, edge, or viewport identity.

## Event Rail

Event Rail is transport custodian, never a business authority. For committed eligibility, incident, order, fill,
and reconciliation facts it owns only the Event Wake transport record; the source Owner remains authoritative.
Events → Observability carries that Event Wake, not a business result. Observability updates rebuildable status and alert projections, while Alert Routing creates delivery attempts and
receipts as outputs. Neither wake nor delivery can approve, retry a business effect, own terminal state, act as
evidence authority, or replace a direct owner-to-owner fact read.

## Observability

Domain events use a native-Owner transactional outbox and at-least-once Event Rail delivery; traces, metrics,
and logs use a separately switchable OTLP pipeline. Both bind stable identity, correlation/causation, source,
time, schema, disclosure, and policy versions, but only the committed Owner fact is business truth. Projection
consumers are idempotent and expose checkpoint, freshness, completeness, lag, and rebuild state. Shared physical
storage or middleware may not collapse Owner write credentials, schemas, retention, or effect namespaces.

## Recovery terminal

Recovery classifies every committed initiating cause into exactly one of `RUNTIME_NOT_READY`, `RUNTIME_INCIDENT`,
`RECONCILIATION_DRIFT`, or `RISK_HARD_STOP`. Distinct simultaneous causes retain separate branch membership and join
one case; no branch requires evidence owned only by another. `RUNTIME_NOT_READY` binds local suppression and the
immutable `NOT_READY` fact. `RUNTIME_INCIDENT` binds only the exact `runtime-incident-fact`, carried to Risk by
`runtime-risk-incident-fence`; `RECONCILIATION_DRIFT` binds only the exact `reconciliation-drift-fact`, carried
to Risk by `execution-risk-drift-fence`. Both relations carry committed source evidence only, and Risk remains
the sole Recovery Fence writer. Either singleton proceeds
without the other source, but may create or join a case only after Execution commits its distinct write-once
`RECOVERY_ADMITTED` disposition and matching `ACTIVE` Risk Recovery Fence. When both are admitted, the two
dispositions join one append-only case. When Runtime
is `READY` and no matching fence exists, authoritative no-effect or fully reconciled no-residual-liability proof closes
as `NO_RECOVERY_REQUIRED`; missing, mixed-cut, or non-isolating evidence closes as `UNRESOLVED_NO_CASE`. Neither
no-case state creates a case, command, effect attempt, or fence. `RISK_HARD_STOP` may open and fence the case while
Runtime is `READY` and neither `RUNTIME_INCIDENT` nor `RECONCILIATION_DRIFT` exists. Risk independently activates each applicable fence on its same-scope
frontier and never waits for case acknowledgement. Fence activation and every normal
`ADAPTER_ADMISSION_REQUEST` are totally ordered: if the fence wins, `SUPPRESSED_BY_FENCE` proves no invocation;
if admission wins, exactly one `ADMITTED_ONCE` attempt enters the Recovery effect frontier. Execution Reconciler
also preserves a simultaneous applied-Artifact `DECREASE_ONLY_STRATEGY_PROTECTIVE` cause without treating it as
Recovery authority, and deduplicates that normal attempt against the same open-order/exposure/readback cut so
all arrival orders permit at most one external decrease effect for the remaining quantity. Execution Reconciler
opens one case as `OPEN` and binds the Risk-authoritative complete active fence-set identity/content digest to
advance it to `FENCED_OPEN`. Execution cannot infer completeness from delivered members. Only Reconciler creates
Recovery Commands, which may cancel, reduce, flatten, or read back. Reduce and flatten also bind
the authoritative Execution exposure readback cut, side, quantity, bounded target, and reduce-only policy. Execution
revalidates the same cut immediately before adapter invocation; partial or concurrent fills, a newer cut, zero or
flipped exposure, unsupported reduce-only semantics, or possible zero crossing reject without invocation. Runtime,
Risk, Execution, and Portfolio facts must close before Reconciler writes `KNOWN_CLOSED`. Unknown external effect keeps
the case open and prevents a new generation.

Before requesting admission, Execution persists the attempt as `PREPARED`; only `ADMITTED_ONCE` allows it to persist
`INVOCATION_STARTED` before the external call. A crash, lost response, or restart joins those records and proceeds by
readback; it never issues a naked retry. Recovery actions do not submit a normal adapter-admission request. Risk alone owns the
Reservation membership frontier, its three-state resolution, and the complete affected set or explicit empty set.
Execution reports common case, complete fence-set, command, and effect identity plus state-specific evidence. A
committed drift `UNKNOWN_EFFECT` binds effect journal, uncertain-effect lineage, uncertainty observation, last
readback attempt or proven absence, and complete source/time frontier without fabricating an outcome; only
`NO_EFFECT` and `SETTLED` bind authoritative terminal readback
and reconciliation cuts. Execution never reads or proves Reservation membership. Risk joins the facts to its own frontier. A Risk-owned set may be `RESOLVED_EMPTY`
for an orphan external effect only after the complete Risk frontier joins authoritative Execution readback. Implicit
empty or `UNRESOLVED` membership remains `UNKNOWN_EFFECT`, keeps Reservations non-reusable, and keeps the case fenced.

Execution Reconciler keeps at most one nonterminal Recovery Case for an exact generation and affected scope.
Matching branch causes join its append-only causal set without manufacturing another branch's prerequisite.
Closure binds the source-owner
frontiers and must include every cause at those cuts, the exact complete fence set, reconciled Execution readback, complete
Risk reservation coverage, and the matching Portfolio projection. A new cause invalidates pending closure.
Only a `FENCED_OPEN` case bound to the matching complete `ACTIVE` fence set may issue decrease-only Recovery
Commands. Every plan, attempt, and closure binds one immutable set snapshot; a new member before invocation
invalidates the old command while a new member after invocation preserves the started attempt and advances only a
successor frontier.
`KNOWN_CLOSED` is Execution-owned append-only, never resumes the old generation, and only permits Governance to
consider a fresh authorization. The predecessor fence remains `ACTIVE` and bound to that predecessor generation.
A fresh generation needs a fresh Governance decision and the ordinary add-risk gates, but it has no Recovery
Fence until one of its own four exact Recovery source branches independently activates one; creating a fence merely
because the generation is new would suppress that generation.

## Fail closed

Missing, stale, malformed, ambiguous, or unavailable facts stop only their dependent transition. No component
may infer success from silence, retry a naked external effect, or promote a hypothesis, backtest result,
notification, or read model into trading authority.
