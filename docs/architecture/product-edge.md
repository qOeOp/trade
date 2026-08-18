# Product Edge

## Responsibility

Product Edge is the application and conversation boundary. It turns attended UI or natural-language intent into
bounded requests and returns read-only product views. The selected target surface is a Windmill R&D Workbench;
Windmill's MCP endpoint exposes the same admitted operations to optional external conversation clients.

## Target product surface and package

The target distribution is one VibeTrader Docker Compose package, not one monolithic image. It composes the Trade
Runtime and Owner APIs, a Windmill server and workers, their required persistence and local ingress. The Windmill
web application is the sole default product entry. Its native MCP endpoint is the sole target conversation outlet,
so LobeHub, OpenClaw, WorkBuddy, or another compatible client may connect without a project-owned adapter or a
second `trade-rd` MCP service. Those external clients are optional consumers: they are not bundled product shells,
business authorities, or implementation-acceptance dependencies.

The Windmill App and MCP endpoint invoke one curated set of versioned scripts and flows over typed Owner ports.
They may not call arbitrary Owner SQL, mint business facts, or keep a shadow workflow truth. Scheduled research,
scanner, replay, report, and maintenance work may run as Windmill jobs with live operational progress, logs,
retries, and Owner-owned artifact references. A live strategy loop, market session, order state machine, and recovery effect remain owned by
Trade Runtime, Risk, Execution, and Recovery; Windmill may supervise and display them but is never the trading
runtime.

This selection remains `TARGET/ABSENT_TARGET_ONLY`. A local Windmill installation, an MCP handshake, or a mock
dashboard does not make the workbench `CURRENT`; acceptance requires the bounded user journeys, common operations,
Owner receipts, unresolved states, and direct browser evidence defined below.

## Windmill capability adoption contract

The audited implementation floor is self-hosted Windmill Community Edition. The 2026-08-18 evidence cut verified
local `CE v1.791.0` server and worker health and checked the official Windmill capability documentation for Apps,
MCP, jobs, logs, schedules, workers, resources, and variables. That cut is `VENDOR_DECLARED` and
`LOCAL_REACHABLE`, not `PRODUCT_CURRENT`. Every product release must pin the Windmill server, worker, and CLI to an
exact compatible version and container digest; `main`, `latest`, or another moving tag is forbidden.

| Windmill primitive                | Adopted Product Edge role                                                                               | Mandatory boundary                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full‑code App                     | One repository‑owned React workbench, bundled from `.raw_app/` sources                                  | Authenticated and `viewer` execution policy only. `publisher`, `anonymous`, and `public` are forbidden because they erase the caller's effective permission boundary.                                                                        |
| Native MCP                        | Optional conversation channel to the same versioned operation set                                       | Workspace‑scoped OAuth or a scoped token exposes an exact allowlist. It must not expose preview or create/update/delete tools for Apps, scripts, flows, resources, variables, schedules, or workers. Folder filtering alone is insufficient. |
| Scripts and flows                 | Typed adapters and bounded orchestration over Owner ports                                               | They may route, wait, retry, and compose; they never write Owner storage, invent business state, or turn flow success into an Owner result.                                                                                                  |
| Jobs, progress, logs, and SSE     | Operational run identity, live progress, diagnostics, and UI streaming                                  | A Windmill job ID, percentage, result, or log is not an Owner receipt. Self‑hosted CE job detail retention is bounded, so durable research artifacts and outcome facts remain with Trade Owners.                                             |
| Schedules                         | Trigger bounded research, scanner, replay, report, and maintenance flows                                | A schedule is not a deployment registry, lifecycle authority, or live strategy runtime. CE correctness uses a flow‑level error path and same‑request resolution; it does not depend on the Enterprise schedule error handler.                |
| Workers and worker groups         | Queue‑backed execution and workload isolation by admitted tags                                          | Worker loss leaves the business result unresolved until the receiving Owner is queried. Enterprise Agent Workers are not required and must not be confused with LLM agents.                                                                  |
| AI Agent flow step                | Optional bounded internal R&D reasoning step with explicitly admitted script or MCP tools               | Agent memory, model output, and tool‑call success are non‑authoritative. The step gets no arbitrary shell, Owner SQL, lifecycle, Risk, Execution, secret‑management, or workspace‑management capability.                                     |
| Resources, variables, and secrets | Typed connection configuration and opaque credential custody                                            | Windmill secret access is not Operator Authorization. Least‑privilege paths are mandatory; secret values never enter prompts, Owner requests, logs, artifacts, or receipts.                                                                  |
| Data tables and transient state   | UI preferences and explicitly rebuildable non‑authoritative caches only                                 | Research lineage, receipts, Qualification, Governance, Runtime, Risk, Execution, Portfolio, and Recovery truth are forbidden. Long‑lived artifacts use Owner storage or admitted object storage.                                             |
| Git and deployment versions       | Repository‑first source for App, script, flow, schedule, resource schema, and `wmill.yaml` declarations | UI state is a deployed projection. Promotion records the Git revision, Windmill resource versions, CLI version, image digest, schema versions, and rollback target as one compatibility cut.                                                 |

The Community Edition floor must remain correct without service accounts, Agent Workers, schedule-level error
handlers, job debouncing, critical alerts, full-text job/log search, unlimited retention, or Enterprise OTLP export.
Enterprise features may improve isolation or operations, but cannot be required for business correctness. On CE,
unattended schedules run on behalf of dedicated least-privilege virtual users; on EE a service account may replace
that identity without changing its Product Edge principal, scope, manifest, or Owner semantics. Operator UI
visibility is not an authorization boundary.

Windmill's native MCP includes powerful workspace-management tools, so the distributable MCP profile is deny by
default. Its allowed tools are only the curated Product Edge operations plus the read-only built-in tools `getJob`
and `getJobLogs`. App and MCP calls bind the same operation version and semantic request;
neither channel may deploy or edit the operation it is currently using.

Unattended execution begins from a canonical due-slot identity and derives one stable Product Edge request
identity before the first Owner call. Retries, worker restart, timeout recovery, and manual resolution reuse that
identity and meaning. If Windmill cannot prove whether an Owner accepted the call, the run stays
`SUBMITTED_OR_UNKNOWN` and a resolver queries the Owner receipt; it never submits a naked successor. Parallel or
overlapping schedule delivery is harmless only when the due-slot and Owner idempotency contract join the same
receipt. Flow error handling may notify and enqueue resolution, but only an Owner receipt closes the business
operation.

The external conversation client and Windmill internal AI are separate credential planes. A client may use its
own model provider key before calling MCP; an internal AI Agent step uses an independently scoped Windmill AI
resource. Neither model credential authenticates to Trade, and sharing one provider account is an operator choice,
not an architecture dependency.

Official capability evidence for this floor is the Windmill documentation for
[full-code App deployment](https://www.windmill.dev/docs/full_code_apps/deployment),
[MCP tools and scopes](https://www.windmill.dev/docs/core_concepts/mcp),
[jobs and retention](https://www.windmill.dev/docs/core_concepts/jobs),
[roles and run-on-behalf](https://www.windmill.dev/docs/core_concepts/roles_and_permissions),
[schedules](https://www.windmill.dev/docs/core_concepts/scheduling),
[flow error handling](https://www.windmill.dev/docs/core_concepts/error_handling),
[persistent storage](https://www.windmill.dev/docs/core_concepts/persistent_storage), and
[Git sync](https://www.windmill.dev/docs/advanced/git_sync). A later implementation chunk must re-audit these
claims against its exact pinned Windmill version rather than assuming the 2026-08-18 evidence cut is timeless.

## Agent-native R&D authoring

The target product admits one user-facing strategy-authoring path: a person expresses a sourced research goal,
question, explanation request, or revision request in natural language, and an Agent invokes the admitted typed
R&D operations. The Windmill App may provide that attended conversation surface directly, while an optional
external conversation client may invoke the same operations through Windmill MCP. Neither channel authors a
business fact or edits an Artifact.

This path separates two Agent roles. A **Conversation Agent** runs in the attended Windmill experience or an
external client such as WorkBuddy; it frames intent, submits or queries typed operations, and explains returned
views. A server-side **R&D Execution Agent** runs in a Windmill-supervised job and the admitted Development Sandbox;
it continues after the conversation disconnects, performs bounded research and generation, and submits candidate
outputs through R&D Owner ports. Neither Agent owns Research facts, and the Conversation Agent never drives the
step-by-step lifetime of the execution Agent.

MCP carries operation requests and bounded results, not an LLM session, hidden reasoning, model entitlement, or
credential. The two Agent roles may be configured to use the same provider, gateway, billing account, or even the
same underlying credential under deployment policy, but that is explicit backend configuration rather than
credential pass-through. Each role retains a distinct invocation identity, scope, capability policy, budget, and
audit trail. Secret values never enter MCP payloads, Owner facts, Artifact metadata, or logs.

An accepted revision request starts a new governed R&D attempt. It either produces a new immutable,
content-addressed Strategy Artifact and its own build and exploratory evidence, or closes with the native
no-artifact, failure, rejection, or unknown disposition. It never changes bytes under an existing Artifact
identity. A semantic strategy change requires the applicable successor hypothesis and Research Intent path;
an attended D-only repair remains constrained by its separate repair contract. The visible **Ask Agent to revise**
action submits that typed request and remains `SUBMITTED_OR_UNKNOWN` until the R&D-owned receipt arrives.

The first admitted Artifact Review surface does not require raw source access. It presents the Artifact identity,
Research Intent and iteration lineage, structured strategy-logic summary, parameter and dependency identities,
build state, Agent change explanation, exploratory result references, bounded Qualification status, and allowed
next actions. Every item binds its native Owner fact or is visibly non-authoritative explanation; an Agent summary
cannot replace Artifact bytes, a Build Receipt, a Run Result, an Iteration Decision, or a Qualification fact.
Semantic change summaries use only R&D-owned lineage and permitted exploratory evidence, never protected
Qualification detail.

Full source inspection, source-level diff, controlled source download, and source-linked diagnostics are
`DEFERRED_TARGET` advanced audit capabilities. If introduced, they are read-only and are not required for the
initial Workbench acceptance. An in-product code editor, Notebook-first authoring, in-place Artifact mutation, and
overwriting an Artifact version are `NOT_ADMITTED`. External IDEs or notebooks may remain engineering tools, but
they are outside the product contract and cannot establish a Product Edge request, Owner fact, or acceptance
evidence.

## Agent Shell deployment binding

Product Edge owns one non-business Agent Shell Deployment Binding for each deployment. The target binding names the
canonical `WINDMILL_PRODUCT_EDGE` admission gateway; Windmill App and MCP calls are channels behind that same
gateway, not competing shell writers. The binding records the selection generation, effective principal, scope-policy version,
approved Skill/MCP capability-set version, audit-policy version, and cutover epoch. The channels may use
different credentials, but the effective principal and policies are identical; changing the external
conversation client or transport changes attribution, never authority.

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

It must not let the Windmill App, an MCP client, or a workflow become competing business writers, accept self-asserted operator identity, execute arbitrary
SQL or commands against Owner storage, invoke an operation absent from the admitted manifest, expose credentials,
bypass Risk, create orders, approve eligibility, dereference protected evidence, or report recovery success from
agent memory.

## Decision contract

- **Inputs** - natural-language intent, the unique active Agent Shell Deployment Binding, trusted principal and
  scope, Operator Authorization, admitted Agent Operation Manifest, and bounded Owner read-model requests.
- **Diagnosis and decision** - resolve one canonical Owner operation and semantic payload, then either submit one
  typed request under the exact Authorization Lineage or reject it before any business write.
- **Conflict resolution** - the authoritative deployment-history head and policy-equivalent active binding win;
  ambiguous intent, dual shell writers, stale cutover, changed replay meaning, or conflicting scope fails closed.
- **Outputs and terminal negatives** - request-correlated Owner receipt or bounded view; local shell success stays
  `SUBMITTED_OR_UNKNOWN`, while rejected authorization or unresolved Owner receipt never becomes business success.
- **Feedback and economic meaning** - natural language becomes attributable replay-safe product work without
  turning an Agent, credential, notification, or UI cache into trading authority.
- **Prohibitions** - no unschematized command or SQL, self-issued identity, capability widening, business-state
  write, protected-evidence disclosure, order, allocation, Risk bypass, or Recovery claim.

## Implementation acceptance

Changing the external conversation client or Product Edge transport preserves the same effective principal, scope,
capability and audit policies, and Owner authority rules. Tests prove exactly one selected admission gateway, an
allowed zero-active cutover interval, predecessor `SUPERSEDED` before successor `ACTIVE`, irreversible
supersession, rejection of dual writers or policy drift, per-request admission against the exact authoritative
head, and preservation of every already admitted in-flight request identity. Windmill App and MCP tests must prove
that the same semantic request reaches the same versioned operation and Owner receipt, while incompatible clients
fail before a business write. Every mutating operation is typed, attributable, replay-safe, and bound to a receiving-Owner receipt. Qualification review reuses the Candidate Intake Receipt as that request-correlated terminal receipt and returns it independently of the bounded status view. Same meaning alone never joins a receipt whose Candidate, attempt, state, result, or identity differs. Accepted Research and lifecycle receipts bind the exact resulting fact; rejected receipts prove no write. Runtime application remains visibly `APPLICATION_UNKNOWN` until Runtime proves `APPLIED` or `REJECTED_NO_INSTANCE`. Natural-language ambiguity fails closed before any business write.

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
