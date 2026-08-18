# Product Edge

## Responsibility

Product Edge turns natural language into bounded requests and returns read-only product views. LobeHub owns the conversation surface. OpenClaw/Codex is one configurable Agent Shell slot: exactly one shell interprets intent and selects approved Skill or MCP operations for a deployment.

## Agent Shell deployment binding

Product Edge owns one non-business Agent Shell Deployment Binding for each deployment. It binds the selection
generation, exactly one selected shell (`OPENCLAW` or `CODEX`), effective principal, scope-policy version,
approved Skill/MCP capability-set version, audit-policy version, and cutover epoch. The two shells may use
different credentials, but the effective principal and policies are identical; changing shells changes
attribution, never authority.

Every binding commit also binds the authoritative deployment-history head before and after the commit. Genesis
is valid only when that deployment has no binding history, uses generation one, and names no predecessor. Once
history exists, a successor must durably and atomically serialize against the exact current head, name that `SUPERSEDED` predecessor,
increment generation by one, use a strictly newer cutover epoch, and introduce a binding identity never used in
the deployment history. A zero-`ACTIVE` cutover window does not erase or reset the history head.

The only canonical binding states are `ACTIVE` and `SUPERSEDED`; `SUPERSEDED` is monotonic and irreversible. A zero-`ACTIVE` interval is allowed during a
fail-closed cutover, but it admits no mutating Owner request; two `ACTIVE` bindings, a stale generation, or a
policy mismatch likewise admit no mutation. The exact predecessor must commit `SUPERSEDED`, which is its durable
request-origin fence, before the policy-equivalent successor can commit `ACTIVE`. Every mutating request atomically
reads and binds the authoritative history head, and admission requires the unique `ACTIVE` binding to equal that
head. A request already admitted under a valid predecessor keeps its original request and binding identities and
continues to resolve under that binding after cutover, without overlapping writes or a naked retry.

## Typed Owner requests

Every mutating submission binds a stable client request identity, the trusted deployment binding, effective
principal and scope, capability and audit policy versions, target Owner and canonical operation, typed semantic
payload identity, and audit correlation. The shell cannot self-assert identity or broaden scope. Ambiguous target
or meaning fails closed before submission.

The request also binds a non-self-assertable Operator Authorization issued by a trusted authority: issuer,
subject/effective principal, audience, exact scope, issued and expiry times under shared Time Evidence, revocation
frontier, request-proof digest, and content-addressed Agent Operation Manifest. The manifest names the exact
operation, schema, target Owner, allowed object classes, prohibited writes, and capability-policy digest. The shell
may select only a manifest member; natural language, local configuration, or possession of a credential cannot
mint authorization. Secret material remains behind an opaque least-privilege handle and never enters the request.

Together, the stable request identity, effective principal and scope, admitted `ACTIVE` shell binding and exact
deployment-history head, Operator Authorization, and Agent Operation Manifest form the request's Authorization
Lineage. A lifecycle request accepted by Strategy Governance must cross-bind that complete lineage into the
resulting Authorized Generation Decision. Scanner evidence, natural language, an Agent plan, or a bare Governance
decision cannot replace any member of the lineage.

Unattended trading uses a separate, explicit Autonomous Policy Authorization admitted by that lifecycle request;
it does not pretend that a human or Agent authorized each later order. The authorization binds its policy identity
and version, principal and scope, strategy generation and Execution Scope, permitted intent and action classes,
capital-policy bounds, effective and expiry times, revocation frontier, and admitted operation manifest. Runtime,
Risk, and Execution must preserve its identity through application, intent, decision, reservation, command,
Effect Journal, and authoritative readback. Expiry, revocation, scope drift, or a broken lineage blocks new risk.

Shell or transport success means only `SUBMITTED_OR_UNKNOWN`. The receiving Owner's correlated receipt is the
only authoritative outcome. Replaying the same identity and meaning joins that receipt; reusing an identity with
changed meaning rejects, and a new intended action requires a successor identity.

Research closes a research request with a write-once `ACCEPTED` or `REJECTED_NO_WRITE` Research Request Receipt.
An accepted receipt binds exactly one resulting Research Intent identity. Strategy Governance closes a lifecycle
request with the same two terminal outcomes, and an accepted receipt binds exactly one Authorized Generation
Decision identity and its complete Authorization Lineage. Until that Owner-owned receipt exists, Product Edge keeps the original request unresolved; it
does not infer acceptance from a shell acknowledgement, a read model, or an absent error.

An `ATTENDED_D_ONLY_REPAIR` uses the same request-lineage and receipt rule, but an accepted R&D Request Receipt
binds only the D-only repair admission, not completion. A pre-admission `REJECTED_NO_WRITE` receipt creates no
repair attempt and therefore no D-only Repair Disposition. R&D later commits exactly one request- and attempt-bound
D-only Repair Disposition: `D0_COMPLETED_NO_ARTIFACT`, `D1_VALIDATED`, `D1_VALIDATION_FAILED`,
`D1_BUILD_FAILED`, `REJECTED_NOT_D_ONLY`, or `OUTCOME_UNKNOWN`. Product Edge may display that fact through the existing Research
View; it never owns the disposition, infers it from shell delivery, or turns `D1_VALIDATED` into Qualification,
Governance, deployment, or trading authority. Same-request replay joins the same write-once disposition, while a
new attempt requires a new explicit user request and successor R&D admission.

A Qualification Review Request closes through Qualification's existing write-once Candidate Intake Receipt.
The receipt binds the stable review request identity, canonical typed meaning, exact Candidate, and intake
attempt. Replaying the same request joins it; changed meaning or a naked new identity cannot create a second
intake or holdout attempt.

Qualification returns that receipt through a dedicated committed-fact handoff. The Qualification Status Summary
is a separate bounded read model for later intake, attempt, or eligibility phases. A summary, event, shell
acknowledgement, or missing error cannot substitute for the committed receipt; absence remains
`SUBMITTED_OR_UNKNOWN`.

## Read-only views

Every Product Edge read model is a bounded Owner projection, never a shadow store. Its common envelope binds a
stable read-request identity, trusted principal, exact authorized scope or account and Execution Scope,
authorization-policy identity and cut, source Owner, complete authoritative source frontier or snapshot cut,
observed/projection time, freshness, and valid-through time. The availability outcome is explicit: `AVAILABLE`,
`STALE`, or `UNAVAILABLE`; a model with a stricter completeness state may additionally fail closed. Replaying one
request at one source cut returns the same projection identity. A newer source cut creates a successor view, while
cross-principal, cross-scope, cross-account, cross-mode, stale-policy, expired-time, or same-request conflicting
replay returns no cached view and creates no Owner transition.

Research View is `AVAILABLE`, `STALE`, or `UNAVAILABLE` and exposes one phase:
`REQUEST_UNRESOLVED`, `INTENT_FROZEN`, `ARTIFACT_AVAILABLE`, `EXPLORATION_ACTIVE`, or `SELECTION_TERMINAL`.
It contains only R&D-owned source provenance, Research Intent state, Strategy Artifact and Build Receipt
references, exploratory request/result summaries, Research Selection Disposition, and the bounded D-only Repair
Disposition for an authorized request. It never includes
protected replay measurements, parameters, outcomes, holdout use, or dereferenceable Qualification evidence.

Exploratory Run Result View projects only Backtest-owned exploratory results for the authorized Research scope and
complete Backtest frontier. Governance Decision View projects only Governance lifecycle state, policy bounds,
effective interval, bounded rationale, and opaque committed-fact references from one complete Governance frontier.
Their read availability is `AVAILABLE`, `STALE`, or `UNAVAILABLE`; neither may expose protected evaluation detail,
and a Governance view never proves Runtime application or external effect.

Qualification Status Summary exposes `NOT_ADMITTED`, `ADMITTED`, `EVALUATING`, `CLOSED_NOT_QUALIFIED`,
`QUALIFIED`, `EXPIRED`, `REVOKED`, or `UNAVAILABLE`. Every internal replay rejection, replay invalidity, diagnostic
invalidity or uncertainty, assessment invalidity, and `INELIGIBLE` fact maps to the same
`CLOSED_NOT_QUALIFIED` outcome with a type-opaque non-dereferenceable reference. Product Edge cannot distinguish,
count, group, or filter those internal negative causes.

Portfolio View is `AVAILABLE`, `INCOMPLETE_FAIL_CLOSED`, `STALE`, or `UNAVAILABLE` and contains only Portfolio-owned account,
exposure, performance, and gross Capacity View projections
for an authorized Execution Scope and coherent Portfolio snapshot cut. It never includes Risk Reservations,
Aggregate Commitment Frontier usage, remaining headroom, a Risk Decision, or permission to deploy or trade.
Missing, unauthorized, stale, or mixed source cuts remain visibly non-available rather than being spliced or
inferred.

Effect Closure View is requested directly from Execution for one stable effect-view request and authorized
Execution Scope. `AVAILABLE` returns exactly one `UNKNOWN_EFFECT`, `NO_EFFECT`, or `SETTLED` projection with the
attempt, account, mode, effect namespace, Effect Journal frontier, readback/reconciliation cuts, blocker,
responsible Owner, projection cut, and valid-through. Missing or stale policy, cross-principal/account/mode,
changed request meaning, or mismatched case/fence returns no view. If the source frontier or authoritative
readback is unresolved, the same request remains `UNAVAILABLE` rather than inferring closure. Exact replay at the
same source cut joins the same projection; a newer cut creates a successor view. Product Edge may explain progress
from this view, but only the committed Execution and other source-Owner facts establish effect or Recovery state,
and Research never consumes the view as provenance.

## Product closure and application layer

A product closure exists only when a user can carry one bounded goal from entry to an authoritative outcome and
its next legal action without manually joining Owner databases, receipts, logs, or terminal output. Product Edge
composes that journey from typed Owner requests, request-correlated receipts, and bounded read models; it does not
own the business transitions that the journey exposes.

The R&D application journey presents `Source / Hypothesis → Frozen Research Intent → Strategy Artifact and Build
Receipt → Exploratory Run → Run Detail or Compare → Diagnosis → Iteration Decision`. Its terminal actions are to
stop, submit the exact typed input-repair request, create the single admitted successor, or hand an exact selected
Candidate to Qualification. Each stage binds its native Owner fact, source frontier, freshness, and unresolved
state. A visible button submits a new typed request; it never mutates a projection or advances a stage by itself.
Until the native Owner receipt arrives, the action remains `SUBMITTED_OR_UNKNOWN`.

Product Edge may own ephemeral interaction details such as filters, layout, and an unsubmitted form, but not
Research lineage, Iteration Decision, Qualification status, lifecycle state, or external effect closure.
Observability may annotate the journey with progress and diagnostics. Telemetry availability, Dashboard state,
and alert delivery never establish completion or choose the next business action.

## Authority boundary

It owns no research, strategy, order, account, risk, or recovery truth. A successful agent action proves only local submission state; it is not an Owner receipt or business result.

Every bounded Qualification phase fact projected to a principal advances a non-dereferenceable protected-feedback
observation frontier. Later Research and Qualification requests commit the relevant frontier and predecessor
identity so shell changes, request renaming, or a new TrialFamily cannot silently erase observed feedback.

## Handoffs

Research and lifecycle admission requests close only through the receiving Owner's terminal receipt; an accepted
D-only admission remains distinct from its later R&D-owned D-only Repair Disposition. Product Edge shows a
strategy as running only from Runtime's Generation Application Receipt, never from Governance authorization alone.

Product Edge can request Research work, independent Qualification review, or exactly one canonical Strategy Governance lifecycle action: `INITIAL_ACTIVATION`, `PROMOTION`, `REDUCTION`, `PAUSE`, `RETIREMENT`, `DE_RISK`, or `RECOVERY`. Conflicts resolve by `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION`; `PROMOTION` requires unattended policy plus fresh compatible Capacity View, Performance, and Exposure evidence under its own evidence key. It may read Research View, Portfolio View, exploratory Backtest results, bounded Qualification Status Summaries, the sole terminal Scanner Receipt for each ScheduledScanId, and bounded Governance Decision Views. A Research View shows terminal stops only from Iteration Decision and shows Selection only when the selected-only `SELECTED_FOR_QUALIFICATION` disposition exists. Intake status preserves the write-once `NOT_ADMITTED` or `ADMITTED` receipt; `EVALUATING` is a derived summary of an `ADMITTED` receipt plus a protected request in progress or unknown, not an Intake Receipt state. Every negative terminal protected outcome appears only as `CLOSED_NOT_QUALIFIED`; no internal replay, diagnostic, assessment, or ineligibility reason is projected. A committed positive Eligibility Fact supersedes the view phase as `QUALIFIED` without rewriting prior facts. Product Edge reads the Scanner Receipt directly; it stores no competing Scanner-owned projection. The receipt exposes exact completion state and one expected-set branch. A resolved branch contains exact expected, observed, and missing members; an unresolved branch contains the authoritative unresolved-set disposition, observed facts, missing-members-unavailable marker, and terminal reason. Only a complete `PROPOSED` receipt includes exact proposal members; incomplete `FAILED` never claims a complete set. Qualification and Governance views contain public state, conditions or policy bounds, effective interval, and type-opaque non-dereferenceable committed fact references only; they never reveal protected measurements, negative reason, or evaluation detail. Event Rail notification is never terminal proof.

## Prohibitions

It must not run OpenClaw and Codex as competing writers, accept self-asserted operator identity, execute arbitrary
SQL or commands against Owner storage, invoke an operation absent from the admitted manifest, expose credentials,
bypass Risk, create orders, approve eligibility, dereference protected evidence, or report recovery success from
agent memory.

## Decision contract

- **Inputs** — natural-language intent, the unique active Agent Shell Deployment Binding, trusted principal and
  scope, Operator Authorization, admitted Agent Operation Manifest, and bounded Owner read-model requests.
- **Diagnosis and decision** — resolve one canonical Owner operation and semantic payload, then either submit one
  typed request under the exact Authorization Lineage or reject it before any business write.
- **Conflict resolution** — the authoritative deployment-history head and policy-equivalent active binding win;
  ambiguous intent, dual shell writers, stale cutover, changed replay meaning, or conflicting scope fails closed.
- **Outputs and terminal negatives** — request-correlated Owner receipt or bounded view; local shell success stays
  `SUBMITTED_OR_UNKNOWN`, while rejected authorization or unresolved Owner receipt never becomes business success.
- **Feedback and economic meaning** — natural language becomes attributable replay-safe product work without
  turning an Agent, credential, notification, or UI cache into trading authority.
- **Prohibitions** — no unschematized command or SQL, self-issued identity, capability widening, business-state
  write, protected-evidence disclosure, order, allocation, Risk bypass, or Recovery claim.

## Implementation acceptance

Changing the configured shell preserves the same effective principal, scope, capability and audit policies, and Owner authority rules. Tests prove exactly one selected implementation, an allowed zero-active cutover interval, predecessor `SUPERSEDED` before successor `ACTIVE`, irreversible supersession, rejection of dual writers or policy drift, per-request admission against the exact authoritative head, and preservation of every already admitted in-flight request identity. Every mutating operation is typed, attributable, replay-safe, and bound to a receiving-Owner receipt. Qualification review reuses the Candidate Intake Receipt as that request-correlated terminal receipt and returns it independently of the bounded status view. Same meaning alone never joins a receipt whose Candidate, attempt, state, result, or identity differs. Accepted Research and lifecycle receipts bind the exact resulting fact; rejected receipts prove no write. Runtime application remains visibly `APPLICATION_UNKNOWN` until Runtime proves `APPLIED` or `REJECTED_NO_INSTANCE`. Natural-language ambiguity fails closed before any business write.

Read-model tests prove every view preserves stable request, principal, scope, authorization-policy cut, source
Owner, source cut, observed/projection time, freshness, valid-through time, and explicit availability status;
rejects mixed cuts, stale policy, conflicting replay, and unauthorized scope; and proves protected Qualification
detail, Risk headroom, or authorization cannot enter a projection.

The future Dashboard reads the Observability-owned Global Status View only. That view exposes its projection
version, cited Owner/telemetry frontier, freshness, completeness, lag, quarantine, and rebuild state. A stale,
partial, rebuilding, or unavailable view stays visibly non-current. Any Dashboard action that could mutate an
Owner becomes a new typed and separately authorized Product Edge request; it never writes through the projection.

Cutover tests additionally reject a forged genesis after any prior binding, a stale history head, a reused binding
identity, non-monotonic generation or epoch, and every concurrent successor except the single winner of the head
serialization.

Security tests reject wrong issuer, audience, subject, scope, expiry, revocation frontier, proof digest, manifest,
operation schema, or target Owner before submission and prove that neither shell can widen the admitted operation.
Lineage tests prove every accepted lifecycle decision and every resulting effect/readback resolves to the same
request, principal, scope, admitted shell binding and history head, Operator Authorization, operation manifest,
and authorization mode. An unattended lineage additionally resolves to the same Autonomous Policy Authorization;
a missing or mismatched required member fails before new risk.
