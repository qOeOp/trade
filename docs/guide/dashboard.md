# Trade Dashboard

This chapter is the living implementation contract for the future Trade-owned Dashboard. It defines the product
shell, information architecture, reusable UI system, and the current evidence-backed hypothesis for the narrow
Windmill capability set that the Dashboard may replace. It does not claim that the Dashboard service exists today
or that the capability inventory is final while the observed backend programme remains active.

## Status vocabulary and evidence cut

- `CURRENT/PARTIAL` means a capability is merged on current Trade main and has real consumer evidence, while the
  complete Dashboard is still absent.
- `ACTIVE_OBSERVATION` means an exact Hub task is still implementing, dynamically accepting, or waiting on an
  explicit action required to prove a capability. Its evidence may revise this chapter, but it cannot establish a
  current product fact before merge and readback.
- `OBSERVED_CANDIDATE_NOT_CURRENT` means a capability or consumer-visible defect was observed in an active Hub
  task or worktree but is not a shipped product capability or a current fix.
- `TARGET_DRAFT` means the current design expects the future Dashboard to provide the capability. The expectation
  remains revisable until the relevant real consumer flow is terminal.
- `NOT_ADMITTED` means a UI, green job, chart, log, or this document does not prove the capability or authorize a
  related business transition.

The evidence cut is 2026-08-21 at observed Dashboard checkout base `e21453d4bc`. The latest directly relevant
TrialFamily Product slice is based on Hub Origin `8375a7b616d18c2084bcea7012ebc878afa1a96c`, tree
`0252b50de2951ce3e23cd4cb2b5dbe8aeb0b5b3a`. Explicit architecture authorization now defines an R&D-owned
independence-basis/genesis contract and a separate Qualification Owner that publishes an opaque protected-feedback
frontier from that exact basis. Product Edge carries only references/cuts; R&D re-resolves basis, Qualification
projection, and complete local lineage before family formation. Rejected candidate
`222c7a669aa30b9f28c2191ff14b9c9b8f24e543`, tree `3402b2e16971d1c56f9d375b5e673c4547337d05`,
dynamically proved an isolated canonical-history default-Web chain
`R&D basis receipt -> Qualification GENESIS_EMPTY receipt -> S1 ACCEPTED with family census -> S2 SUCCESS + time-bound binding receipt -> REVIEW_ARTIFACT`,
plus byte-identical S1/S2 restart and Windmill page-state/cache-loss recovery without rerunning the build. Against
the unchanged original Owner database, a successful Windmill job correctly remained business
`SUBMITTED_OR_UNKNOWN` with only `RESOLVE_SAME_REQUEST_IDENTITY`, because incomplete historical custody failed
closed. Authority reviewer `01a02410-4530-7010-b495-9d2a4e588239` still rejected the candidate: Qualification
could infer `GENESIS_EMPTY` from a missing head without exhaustively verifying historical projections/outbox; a
positive TrialFamily graph remained publicly deserializable; and Artifact custody could apply JSON selectors or
predicates before canonical verification. Consumer review and delivery were not admitted. Hub planners are deciding
whether all three are one candidate-local correction batch, so the successful journey remains candidate-only design
evidence rather than a current product fact.
After the lock-only commits `def6b37653` and `3183d3a280`, PR #268 contributed the first business diff: the
Strategy Factory Product Edge now treats its exclusive `valid_through` boundary as stale. That one projection is
`CURRENT/PARTIAL`; it does not promote the unmerged F1 foundations, S3 replay, or any Dashboard/Windmill service.
PR #269 then contributed the structural Risk-to-Model dependency edge. PR #270 changed only
`codex-skills.lock.json`; it advances control-plane bootstrap custody but adds no Dashboard, Windmill, or business
capability.
S1 sourced research intake and S2 Artifact Formation remain `CURRENT/PARTIAL`. S3 Exploratory Replay remains
`ACTIVE_OBSERVATION` and `OBSERVED_CANDIDATE_NOT_CURRENT / DEPLOYMENT_UNAVAILABLE`: its historical Web run remains
design evidence, but the current remote operation is archived and cannot dispatch. F0, Qualification, Scanner, Observability, Governance,
and Runtime foundations have static candidate evidence only and have not entered the shared product workspace.
Exact checkout, candidate, merge-tree, and consumer identities govern every status; a future agent must re-read
them rather than promote an observation by copying this page.

### Observation custody and revision rule

The observation source is Hub `01a014ef-d305-7b40-8d6b-f5c6d26fca56`, but this document is
**event-driven, not cursor-driven**. A Hub or delegated-Task update is relevant only when it changes at least one of:

- a real default Windmill/Workbench Web journey or native operation;
- a consumer-visible route, tab, field, action, state, empty state, permission, or recovery path;
- an Owner/backend contract directly required to render or execute that visible behavior;
- the evidence-backed decision to keep, defer, or exclude a Windmill capability.

Internal bug fixing, gate execution, rebase, candidate commit, review, PR, and merge activity does not revise this
document by itself. Such activity matters only after it produces a changed real consumer contract or dynamic
Windmill/Workbench observation.

| Consumer line                                 | Evidence state                                            | Dashboard consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 V2 TrialFamily -> S2 Artifact binding      | `ACTIVE / OBSERVED_CANDIDATE_NOT_CURRENT`                 | Replacement candidate `3862ed8bcb` re‑proved the default‑App canonical‑history chain `basis receipt -> Qualification GENESIS_EMPTY receipt -> S1 ACCEPTED/family census -> S2 SUCCESS/time‑bound binding receipt -> REVIEW_ARTIFACT`; deleting the three task jobs and restarting Owner/worker returned byte‑identical request, attempt, basis, Qualification frontier, family, Artifact and binding identities without rerunning S2. Earlier rejected candidate `222c7a669a` also showed that unchanged original history can leave Windmill job `success` at business `SUBMITTED_OR_UNKNOWN` with only `RESOLVE_SAME_REQUEST_IDENTITY`, so operational success and Owner outcome remain separate                                                                                                       |
| R&D freshness and no‑Artifact receipt closure | `ACTIVE / OBSERVED_CANDIDATE_NOT_CURRENT`                 | Exact‑expiry zero‑write, relational mutation/restoration, locked binding reads and stale S1/S2 resolve‑only behavior remain preserved. Authority‑unavailable S1 resolve/replay and S2 prepare normalize to non‑terminal `SUBMITTED_OR_UNKNOWN`; semantic conflict remains conflict. Invalid V2 may persist one independent rejection receipt but zero basis/projection/Research/Intent/family/member/head/outbox facts                                                                                                                                                                                                                                                                                                                                                                                  |
| TrialFamily lineage/feedback authority        | `ACTIVE / OBSERVED_CANDIDATE_NOT_CURRENT`                 | Architecture now admits an R&D basis/genesis Owner fact and a Qualification opaque frontier fact. The App no longer accepts predecessor/feedback/independence authority fields; it renders sealed basis and Qualification receipts. Positive S1 must validate the complete V2 request before either prerequisite write, then under `scope -> request` locks enumerate every lineage receipt without a raw selector, canonical‑verify every row, and only then filter/form family. The positive TrialFamily graph must be sealed Owner output, never public `Deserialize`. Corrupt or unavailable history returns `SUBMITTED_OR_UNKNOWN`, never false genesis                                                                                                                                            |
| Product Edge action authorization             | `ACTIVE / OBSERVED_CANDIDATE_NOT_CURRENT`                 | Authority review rejected the earlier self‑proving environment/default‑policy path. Isolated PostgreSQL tests now prove complete Issuer/Product Edge history verification, lock order, cutover/revocation replay and the one‑use invocation claim/start state. Workbench 5/5 proves `claim -> start -> provider`: claim response loss can recover `CLAIMED` and continue to start, but replay after committed `INVOCATION_STARTED` returns `OUTCOME_UNKNOWN`, shows claim identity/digest plus `MANUALLY_RECONCILE_PROVIDER_INVOCATION`, and never calls the provider again. This remains candidate evidence; the unknown actual‑provider‑call window, provider reconciliation and full runtime/final review are `NOT_ADMITTED`, so mutating controls remain unavailable outside the exact proved state |
| Qualification protected‑feedback frontier     | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`            | A missing Qualification head does not prove `GENESIS_EMPTY`. Qualification must exhaustively enumerate and canonical‑verify every historical projection and outbox before filtering by exact basis or publishing an empty frontier. Missing, malformed, ambiguous, or unverifiable history renders `unknown/unavailable`, exposes only exact‑basis Resolve, and writes no positive projection/head/outbox                                                                                                                                                                                                                                                                                                                                                                                               |
| S3 Exploratory Replay                         | `OBSERVED_CANDIDATE_NOT_CURRENT / DEPLOYMENT_UNAVAILABLE` | A historical real default‑Web run proves the Run Detail information architecture and Owner readback shape, but the TrialFamily deployment sync archived the remote S3 replay operation. The Backtest route must now show capability unavailable and disable invocation until S3 is explicitly restored from its frozen candidate and revalidated. Native MCP parity remains unavailable                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Backend integration                           | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`            | F1 proved that stale or self‑asserted telemetry could incorrectly promote the Dashboard to `Available` after telemetry loss. The candidate was rejected and its correction is not current; canonical views remain fail‑closed until exact Owner‑bound telemetry evidence is consumed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Qualification intake replay                   | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`            | F1 proved that two different invalid replay meanings under one request/handoff identity could incorrectly join the first `NOT_ADMITTED` receipt. The rejected candidate must be corrected so exact semantic replay resolves the original receipt while every changed meaning returns `RequestSemanticConflict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Qualification public projection               | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`            | F1 proved that legal non‑terminal `Admitted` and `Evaluating` summaries could be misreported as terminal `ClosedNotQualified`. The public projector must reject non‑terminal summaries; no terminal row, count, receipt, color, or action may be inferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Market Data, Risk, Portfolio                  | `MECHANISM_REJECTED / NOT_ADMITTED`                       | Static schemas and test‑constructed positive paths are not real consumers. Their routes remain target skeletons and must not render available state or enabled business actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

The S3 Web observation shows a Backtest receipt and canonical result, actual Artifact/PIT/runtime/simulator
identities, the complete diagnostic set, the R&D handoff, `EXPLORATION_ACTIVE · AVAILABLE`, explicit
`NOT_ADMITTED` boundaries, and one correlated engine invocation without a duplicate attempt. This evidence
supports the Run Detail layout, tabs, status treatment, receipt cards, bounded logs, and recovery copy. It does not
prove native MCP parity or admit replay as a current shared-product capability.

The remaining action-time credential boundary is also consumer-visible: native MCP verification requires a
revocable short-lived token scoped to the replay operation and bounded read-only job/log access, followed by
revocation and rejection proof. The document may change when that journey is actually exercised; token planning,
backend fixes, or task progress alone do not change it.

When a directly relevant event occurs, the observing agent performs one bounded read of the Hub and affected Task,
then inspects the exact default Web journey, native MCP operation set, job lifecycle, Owner receipt/view, recovery
behavior, and permissions. A capability enters `TARGET_DRAFT/KEEP` only with a real consumer or an explicit
architecture/safety requirement. No observed use remains `NOT_OBSERVED/CURRENTLY_EXCLUDE`, not a permanent
deletion. Documentation checks prove document integrity only; they never promote backend work into Dashboard
capability.

## Product role and authority

The Dashboard is the first-party visual Product Edge for one local operator. It presents native Owner views,
submits typed requests, follows long-running work, and exposes the one next legal action returned by the relevant
Owner. It is also the read-only surface for Observability projections and operational job state.

The Dashboard is never a business-truth Owner. It may cache UI state and disposable job projections, but it must
not own Research Intent, Artifact, Backtest Result, Qualification, Scanner Proposal, lifecycle authorization,
Runtime application, Portfolio, Risk, order, fill, reconciliation, or Recovery truth. Every business state and
allowed action carries its Owner identity, source cut, observed time, freshness or availability, and native
receipt locator. Unknown, stale, partial, rebuilding, quarantined, and unavailable remain explicit.
The Product Edge treats `UntrustedOwnerEvidenceLocatorV1` and `UntrustedLocatorDigest` as routing/integrity
vocabulary, never as proof. It must call the identified
source Owner's typed public resolve port and validate the canonical bytes reread returned from that Owner's durable
store/outbox. Neither browser, BFF, shared library, nor consumer service may establish provenance with caller-supplied
authority text, a self-canonical digest, a generic verifier, or a shared signer.

```text
User -> Dashboard typed request -> Product Edge admission -> native Owner
User <- Dashboard projection <- Owner receipt/view or explicit unavailable state

Telemetry/Event Rail -> rebuildable Dashboard projection
Windmill/Dashboard job success -X-> business success or trading authority
```

Mutating controls stay disabled until the current Owner projection admits exactly that action. Submitting creates
a typed request; it never edits an Owner record. An unknown outcome exposes only same-identity resolve. Real
trading and any other production write still require explicit user authority outside this design document.

### Action authorization admission contract

An Owner-projected next action is necessary but not sufficient to enable a button. Before rendering an enabled
mutating control, the Dashboard calls the typed Product Edge admission port with the stable request preview,
effective principal and scope, target Owner, canonical operation, semantic payload identity, and audit
correlation. The response is an `ActionAdmissionEnvelope` with exactly one state:

```text
admitted | expired | revoked | stale_head | no_active_binding |
ambiguous_active_binding | manifest_mismatch | denied | unavailable
```

The `admitted` branch cross-binds three independently resolved, canonical records:

1. `ShellDeploymentBindingEnvelope`: binding identity, generation, deployment‑history head, `ACTIVE` state,
   principal, scope-policy/capability/audit-policy versions, cutover epoch, source cut, and valid-through time.
2. `OperatorAuthorizationEnvelope`: authorization identity, issuer, subject/effective principal, audience, exact
   scope, issued/expiry times with Time Evidence, revocation frontier, request-proof digest, and manifest digest.
3. `AgentOperationManifestEnvelope`: content digest, operation identity/version/schema, target Owner, allowed
   object classes, prohibited writes, and capability-policy digest.

The Product Edge admission service reads the authoritative deployment head and requires exactly one `ACTIVE`
binding equal to that head, resolves Operator Authorization through its trusted authority port, and fetches the
immutable manifest by content digest. `ShellBindingHistoryStore`, the trusted `OperatorAuthorizationResolver`, and
the content‑addressed `OperationManifestStore` remain separate authority surfaces; Dashboard session state,
environment/default policy, local configuration, credential possession, or an object constructed by the same
validator cannot populate them. The browser receives bounded projections only and never an issuer or signing
operation.

`POST /api/product-edge/actions/{operation_id}/admission` returns the preflight envelope for rendering. An
`admitted` preflight enables only the exact manifest member and displays authorization identity, binding/head,
manifest digest, scope, expiry, and revocation frontier. Submission repeats the same admission atomically at the
business-write boundary; a previously green preflight never authorizes a later write. Every non‑admitted branch
keeps the button disabled and supplies one stable stop predicate. Same-identity Owner resolution remains available
only when its own read manifest member is admitted; transport credentials are neither Operator Authorization nor
proof of admission.

Historical readback and current effect authority are separate projections. A canonical admission snapshot remains
readable after its binding is superseded or its authorization is revoked so Audit and Run Detail can explain what
was admitted at the original cut. It never supplies the current gate. A first provider invocation must atomically
re-read the complete current deployment and authorization histories before writing one immutable invocation claim;
cutover, expiry, revocation, or any malformed/missing/extra history row returns `unavailable` with zero new effect.

The claim receipt and the invocation state are separate Product Edge facts. Claim disposition is
`CLAIMED_NEW | ALREADY_CLAIMED`; state is `CLAIMED | INVOCATION_STARTED`; start disposition is
`STARTED_NEW | OUTCOME_UNKNOWN`. Claim response loss may recover the same `CLAIMED` receipt and proceed through the
single atomic start transition. Once start commits, every replay renders `OUTCOME_UNKNOWN` with
`MANUALLY_RECONCILE_PROVIDER_INVOCATION`; it never invokes the provider again or fabricates a provider outcome.
The fixed presentation order is `Current authority`, `Admission snapshot`, `Invocation claim`, `Invocation state`.

## Windmill capability evidence ledger

Windmill is the borrowed application and job shell. Its replacement retains only capabilities proved necessary by
a Trade consumer or required by an existing architecture contract.

| Windmill capability                                   | Observed use or need                                                                                                                                                                                                                                                               | Current design hypothesis                                                                                                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated browser session                         | S1‑S3 use an authenticated local App; the S1 V2 -> S2 acceptance reused an already signed‑in local `admin` browser session                                                                                                                                                         | `TARGET_DRAFT/KEEP`: one local operator and explicit `authenticated/expired/unavailable` shell state; no anonymous mode or general role‑administration product                           |
| Credential/session bootstrap                          | The active V2 journey rejected stale `.env` login material and succeeded through the existing browser session without creating, rotating, or inspecting an API token                                                                                                               | `TARGET_DRAFT/KEEP_MINIMAL`: local sign‑in/re‑auth boundary only. Exclude password import, token management, workspace credential conversion, and secret display from domain pages       |
| Workspace                                             | One `trade-rd` workspace scopes App, scripts, and tokens                                                                                                                                                                                                                           | `TARGET_DRAFT/COMPRESS`: one installation profile, not a workspace product                                                                                                               |
| Full‑code Raw App and sandbox                         | Hosts the current React Workbench without frontend SDK/Data Table scope                                                                                                                                                                                                            | `TARGET_DRAFT/REPLACE`: first‑party routes and components                                                                                                                                |
| Versioned scripts and App dependencies                | App and MCP call the same typed Product Edge operations; Windmill records dependency‑build jobs separately                                                                                                                                                                         | `TARGET_DRAFT/KEEP_SEMANTICS`: operation registry, content digest, typed BFF gateway, and explicit dependency state                                                                      |
| Server and worker queue                               | Continues bounded provider/build/replay work after client disconnect                                                                                                                                                                                                               | `TARGET_DRAFT/KEEP`: minimal durable dispatcher and worker leases                                                                                                                        |
| Run list, Run Detail, progress, result, bounded logs  | Real App/webhook runs expose path, tag, trigger, timing, worker, inputs, result, memory, script hash, and `getJob`/`getJobLogs`                                                                                                                                                    | `TARGET_DRAFT/CORE_OPERATIONAL`: exact Runs and Run Detail contracts; never a business terminal                                                                                          |
| Worker status and service logs                        | One live `rd-product-edge` worker executes the admitted scripts; service logs expose worker/server hosts                                                                                                                                                                           | `TARGET_DRAFT/KEEP`: worker lease/readiness and bounded service log reads; no REPL or generic administration                                                                             |
| Audit log                                             | Windmill records authenticated create/update/execute/delete operations, but CE redacts the resource detail                                                                                                                                                                         | `TARGET_DRAFT/KEEP_MINIMAL`: first‑party operation audit with principal, operation, target identity, time, outcome, and correlation; no enterprise‑redaction dependency                  |
| Per‑run Metrics, Traces, Assets tabs                  | The observed replay run renders all three tabs, but each is empty; metrics require jobs longer than 500 ms, HTTP tracing is disabled or unused, and no run asset exists                                                                                                            | `NOT_OBSERVED/CURRENTLY_EXCLUDE_AS_BACKENDS`; preserve deterministic empty states and add a backend only after a Trade consumer produces data                                            |
| Same‑identity resolve                                 | S1 V2 recovered response loss and restart/cache‑loss from direct Owner facts; the default page uses exact request and build‑attempt resolve controls and returns the original receipts, Intent, TrialFamily/frontier, Artifact review, and binding. S2/S3 require the same pattern | `TARGET_DRAFT/CORE`: mandatory request/attempt identity, direct Owner resolution, immutable returned bytes/frontier, a separately linked replacement operational run, and no naked retry |
| Disposable completed‑job cache                        | S3 proves job deletion with recovery from Owner facts                                                                                                                                                                                                                              | `TARGET_DRAFT/KEEP_DISPOSABLE`: TTL/delete/readback; no business custody                                                                                                                 |
| Native MCP                                            | S1‑S2 use narrow profiles; S3 A/B parity remains pending                                                                                                                                                                                                                           | `TARGET_DRAFT/KEEP_AS_CHANNEL`: share the UI capability manifest                                                                                                                         |
| Scoped token lifecycle                                | S1‑S2 use scoped credentials; S3 requires one short‑lived replay‑only issue/use/revoke cycle                                                                                                                                                                                       | `TARGET_DRAFT/KEEP_NARROW_ISSUANCE`: exact operation allowlist, bounded read‑only job access, expiry, revocation, one‑time secret display, external custody                              |
| Schedules                                             | Scanner now seals due‑slot attempts unavailable until real source‑Owner typed resolve; no scheduler or Windmill schedule consumer exists                                                                                                                                           | `TARGET_DRAFT/DEFERRED_UNTIL_CONSUMED`                                                                                                                                                   |
| Workspace Assets / files / object storage             | Workspace page reports no Data Table, Ducklake, object storage, or assets; database count is zero                                                                                                                                                                                  | `NOT_OBSERVED/CURRENTLY_EXCLUDE`; Owner artifact locators are not Windmill files                                                                                                         |
| Workspace Resources and Variables                     | `trade-rd` has no Resource or Variable; worker credentials come from Compose environment allowlists. The only database Resource belongs to the `admins` App theme                                                                                                                  | `NOT_OBSERVED/CURRENTLY_EXCLUDE`; use runtime‑injected opaque secret references, not a generic manager                                                                                   |
| App/Flow builder, arbitrary Flow graph, preview tools | No admitted Trade consumer                                                                                                                                                                                                                                                         | `NOT_OBSERVED/CURRENTLY_EXCLUDE`                                                                                                                                                         |
| Data Tables and Windmill business storage             | Explicitly prohibited by the App contract                                                                                                                                                                                                                                          | `NOT_ADMITTED/DROP`                                                                                                                                                                      |
| MCP workspace management                              | Explicitly excluded from current profiles                                                                                                                                                                                                                                          | `NOT_ADMITTED/DROP`                                                                                                                                                                      |
| General secret‑manager UI                             | Secrets remain outside repository and App state                                                                                                                                                                                                                                    | `NOT_OBSERVED/CURRENTLY_EXCLUDE`; accept opaque references only                                                                                                                          |
| General Python/Deno/Bun/Bash runtime catalog          | Trade uses exact repository operations and Owner services                                                                                                                                                                                                                          | `NOT_OBSERVED/CURRENTLY_EXCLUDE`                                                                                                                                                         |
| Multi‑tenancy, billing, marketplace, enterprise RBAC  | No single‑user consumer                                                                                                                                                                                                                                                            | `TARGET_DRAFT/EXCLUDE_BY_PRODUCT_SCOPE`                                                                                                                                                  |

### Native Windmill surface and backend replacement map

This 2026-08-20 snapshot combines the authenticated Windmill UI, the pinned `1.791.0` Compose deployment, App and
script source, and read-only Windmill database counts. Counts are observation evidence, not stable product limits.
The future service implements the contract in the last two columns, not Windmill's tables or generic low-code
models.

| Native surface / current backend            | Exact observed state                                                                                                                                                 | Dashboard route and fixed UI                                                                                                                                                          | Replacement service/store and disposition                                                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home / App and script catalog               | One Raw App `f/trade/rd_workbench`; the current TrialFamily sync deploys S1 V2 research and S2 Artifact operations but archived the remote S3 replay entry           | Domain routes own the four‑stage journey. Backtest remains routed but renders `DEPLOYMENT_UNAVAILABLE`; no generic Home catalog                                                       | Versioned `OperationRegistry` with `available/archived/unavailable` deployment state plus built frontend routes; archive disables dispatch without deleting Owner history. `KEEP_SEMANTICS`, exclude arbitrary catalogs |
| Runs / `v2_job*`                            | UI shows 53 user‑facing jobs; database has 88 rows including 34 App dependency jobs. Real paths use App and webhook triggers and tag `rd-product-edge`               | Operations / Runs: status segments, schedule/future toggles only when admitted, search, duration/concurrency filters, auto‑refresh, path/trigger/tag columns, date groups, pagination | `RunStore` + `DispatcherReadModel`; durable operational metadata with TTL, explicit dependency kind, Owner‑outcome join by identity only                                                                                |
| Run Detail / completed job + result API     | Successful replay shows received/started time, duration, worker, run ID, 5 MB peak, script hash/language, App trigger, exact inputs, JSON result, and Owner receipts | `/operations/runs/:runId`; header actions are Back to Runs, Copy locator, and domain‑aware Resolve. `Run again`, Share, Edit, and arbitrary script links are excluded                 | `RunDetailProjection`; immutable submitted input snapshot, bounded result projection, worker/timing/resource metadata, and Owner receipt references; no business custody                                                |
| Run Logs / `job_logs` and worker log volume | 86 log rows; exact run exposes download endpoint, auto‑scroll, job/tag/worker/host/isolation header, and bounded text                                                | Run Detail `Logs` tab: search, level/source chips, auto‑scroll switch, download bounded log, line viewport, truncation/retention notice                                               | `BoundedRunLogStore`; append‑only chunks, byte/age limits, redaction, correlation, TTL; MCP read scope may expose only exact admitted runs                                                                              |
| Run Metrics                                 | Observed 74 ms run says no metrics because collection begins above 500 ms                                                                                            | Run Detail `Metrics` tab always has fixed geometry; render `NotCollected`, `Unavailable`, or time‑series, never a fabricated zero                                                     | Deferred `RunMetricProjection`; `CURRENTLY_EXCLUDE_BACKEND` until non‑empty consumer evidence                                                                                                                           |
| Run Traces                                  | Observed run says no HTTP request captured or tracing disabled                                                                                                       | Run Detail `Traces` tab: explicit not‑captured reason and no empty success graph                                                                                                      | Deferred `RunTraceProjection`; `CURRENTLY_EXCLUDE_BACKEND`                                                                                                                                                              |
| Run Assets                                  | Observed run says `No assets found`; workspace asset count is zero                                                                                                   | Run Detail `Assets` tab: explicit empty state only. No global Assets route                                                                                                            | No store now. Future entries must be disposable operational attachments that point to, never replace, Owner artifact custody                                                                                            |
| Workers / `worker_ping`                     | One live `rd-product-edge` worker, version `1.791.0`, job count, last‑job link, memory, status, tags; other groups have zero workers                                 | Operations / Workers: group chips, search, worker table, selected‑worker panel, last‑run link. Read actions are Refresh and Open last run                                             | `WorkerLeaseStore` + heartbeats; retain identity/group/tags/version/start/last‑run/occupancy/memory/readiness. Exclude create config, cache clean, restart, REPL, autoscaling UI until separately admitted              |
| Service Logs / server and worker logs       | Auto‑refresh page lists worker group and server hosts, time range, error‑only filter, service/host selector                                                          | Operations / Service Logs: time range, service, instance, severity, search, auto‑refresh, bounded log viewport                                                                        | `ServiceLogGateway`; read‑only, redacted, retention‑bounded. It is operational evidence, not Owner health or a telemetry backend                                                                                        |
| Audit Logs / partitioned audit tables       | Authenticated execute/update/create/delete records exist; CE exposes ID, time, principal, operation and redacts resource detail                                      | Operations / Audit: time/principal/operation/outcome filters, audit table, selected correlation panel; no mutation buttons                                                            | `OperationAuditStore`; append‑only Dashboard/Product Edge control‑plane events with exact target/correlation/outcome. Owner business events remain in Owner/Event Rail custody                                          |
| Workspace/folder/auth                       | Folder `trade` contains three scripts and one App owned by `u/admin`; workspace and scoped tokens delimit access                                                     | Installation profile and Access settings only; no workspace/folder administration route                                                                                               | `LocalSession` + `CapabilityManifest` + narrow token issuer; one installation, one operator profile, exact operation scopes                                                                                             |
| Variables, Resources, Assets, Schedules     | `trade-rd` counts are 0/0/0/0. Compose injects an allowlisted environment into the worker; Data Tables and frontend SDK access are forbidden                         | No product tabs. Settings accepts opaque runtime references; Scanner shows schedule unavailable/deferred                                                                              | Exclude Windmill generic stores. Add a typed service only when a real Owner consumer and custody contract exist                                                                                                         |

The native `bun` runtime is an implementation detail of the three pinned scripts, not a user-selectable runtime
catalog. PostgreSQL persists Windmill operational state; separate R&D and Backtest Owner databases/APIs persist
business facts. The replacement keeps that ownership split even if all services ship in one image set.

### Operations API and backend state contract

This is a `TARGET_DRAFT` replacement contract, not evidence that the services exist. Browser and MCP reads use the
same typed handlers and capability checks. Page cursors are opaque and stable for one filter cut; every response
includes `observed_at`, `projection_version`, `availability`, and a retention or expiry disclosure. A route never
returns an Owner payload merely because the caller can read the operational run.

| UI read or action                 | Fixed Dashboard API                                                                                   | Backend owner and exact rule                                                                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runs list, filters, pagination    | `GET /api/operations/runs` -> `RunPage`                                                               | `RunStore` reads immutable submission metadata plus dispatcher‑owned operational state. Filter fields are status/kind/path/trigger/principal/tag/duration/time cut; the cursor embeds that filter cut. Owner outcome is a separately resolved optional envelope, never derived from exit code |
| Run detail and bounded result     | `GET /api/operations/runs/{run_id}` -> `RunDetailEnvelope`                                            | `RunDetailProjection` returns submitted inputs, timing/worker/resource metadata, bounded result, retention and Owner receipt locators. Missing disposable data with an Owner locator is `operational_data_expired`, not business absence                                                      |
| Same‑identity Owner resolution    | `POST /api/operations/runs/{run_id}/resolve-owner-outcome` -> `OwnerOutcomeEnvelope`                  | Product Edge resolves the immutable request/attempt identity through the named Owner typed port. It neither dispatches a job nor retries an effect                                                                                                                                            |
| Disposable completed‑run deletion | `DELETE /api/operations/runs/{run_id}/cache` -> `OperationalDeletionReceipt`                          | `RunStore` accepts only terminal operational rows after capability check and confirmation. It deletes bounded result/log/cache bytes, preserves the run tombstone and Owner locator, and cannot touch Owner stores                                                                            |
| Run log tail or download          | `GET /api/operations/runs/{run_id}/logs` and `/logs/download` -> `RunLogPage` or bounded stream       | `BoundedRunLogStore` reads append‑only chunks by opaque cursor. Search/severity/source filters, redaction, truncation, byte limit and retention are identical for viewport, download and MCP                                                                                                  |
| Metrics, traces, run assets       | `GET /api/operations/runs/{run_id}/{metrics\|traces\|assets}` -> a discriminated tab envelope         | Until a producer is admitted, handlers return `not_collected`, `not_captured`, `empty`, or `unavailable` with a reason. They never fabricate zeros, spans, files, or success; run assets cannot resolve to a global file browser                                                              |
| Workers and selected lease        | `GET /api/operations/workers` and `/workers/{worker_id}` -> `WorkerPage` or `WorkerLeaseEnvelope`     | `WorkerLeaseStore` is written only by worker registration/heartbeat/claim/release. UI reads identity/group/tags/version/start/limits/occupancy/last run/last observed; lease expiry yields `unavailable`, never a UI-authored `dead` state                                                    |
| Service‑log viewport or download  | `GET /api/operations/service-logs` and `/service-logs/download` -> `ServiceLogPage` or bounded stream | `ServiceLogGateway` requires an exact service/instance cut and applies the same time/severity/search filters, redaction, cursor, retention and byte limit to both outputs. It exposes no delete, clear, restart or health‑promotion endpoint                                                  |
| Audit list and correlation detail | `GET /api/operations/audit` and `/audit/{audit_id}` -> `AuditPage` or `AuditEventEnvelope`            | `OperationAuditStore` is append‑only and written by authenticated Product Edge/Dashboard control‑plane middleware, not by this read route. Unknown/redacted target stays explicit; there is no edit, delete, dismiss or replay endpoint                                                       |

`RunOperationalState` is exactly `queued | running | succeeded | failed | cancelled | unknown`; only Dispatcher and
worker protocol events advance it, using compare-and-set on the last stored transition. `OwnerOutcomeState` is a
separate `available | rejected | unknown | unavailable | not_applicable` envelope and never participates in the
operational transition. A late terminal worker event may replace operational `unknown` for the same run identity,
but only an Owner reread may replace Owner `unknown`. Worker readiness is computed from a stored lease deadline and
last heartbeat; client time, a missing row, or a service-log message cannot promote or demote it.

The replacement is not a smaller low-code platform. It is a Trade-specific Dashboard, typed Product Edge
gateway, narrow job dispatcher, worker protocol, disposable operational store, and optional exact-tool MCP
channel. Native Owners and their stores remain separate services.

## Product shell and layout

The visual direction comes from the stopped local `vibe-trading` product, not Windmill: warm neutral canvas,
compact icon rail, capsule navigation, white content cards, gray framed panels, dense small typography, and
responsive Bento composition. Glass belongs only to navigation and transient overlays, never data cards or
business-state panels.

### Reference implementation anchors

The visual evidence cut is the local checkout `/Users/vx/WebstormProjects/vibe-trading`. It is a source reference,
not a package dependency or business architecture authority. Future agents must inspect these anchors before
changing tokens or shell geometry:

| Reference path under `apps/web/src`                | Inherit                                                                                                                                                            | Explicitly do not inherit                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `app/globals.css`                                  | Mine warm‑neutral raw palette, Inter/JetBrains Mono, market‑direction separation, and the allowed zones/values for `glass-heavy`, `glass-light`, and tooltip glass | Factor/status token names as Trade business semantics; arbitrary literal colors                                |
| `components/layout/left-icon-sidebar.tsx`          | 52 px rail content, 40 px round targets, 18 px icons, 1 px item gap, centered/scrolling heavy‑glass capsule, dark active item                                      | Reference module identities or phase labels                                                                    |
| `features/blueprint/components/doc-mode-shell.tsx` | Full‑viewport flex shell, 12 px sidebar padding, 16 px content gap and right/bottom gutters, bounded inner overflow                                                | Blueprint mode, document toggle, or mock content as product features                                           |
| `components/layout/top-nav-bar.tsx`                | 56 px top bar, replaceable left context slot, light‑glass capsule tabs, notification/action zone                                                                   | Market ticker data as a universal header requirement; Dashboard uses the evidence‑bound status tape            |
| `components/ui/card.tsx`                           | White 12 px card, Mine border, restrained two‑layer shadow, compact structured header, optional canonical‑detail expansion                                         | The available `frosted` card variant; Dashboard business/data cards remain opaque                              |
| `lib/chart-tokens.ts`                              | Resolve CSS custom properties when Canvas or another JavaScript renderer cannot consume `var(...)` directly                                                        | Component‑local chart palettes or literal status colors                                                        |
| `features/blueprint/data/modules.ts`               | Visual density and route‑backed capsule‑navigation pattern only                                                                                                    | The stopped product's module order, labels, phase badges, mock metrics, workflow claims, or trading capability |

The Trade navigation, status vocabulary, domain components, and capability admission in this chapter override the
reference project's information architecture. A screenshot match cannot promote a mock value or reference route
into `CURRENT`.

```text
+----------------------------------------------------------------------------------+
| user | status tape / context                         tabs | search | notifications |
|------|---------------------------------------------------------------------------|
|      | page header / authority / freshness                                      |
| side |                                                                           |
| rail | responsive Bento: cards, panels, tables, charts, timelines               |
|      |                                                                           |
|      | optional right drawer: receipt, identity, evidence, action detail         |
+----------------------------------------------------------------------------------+
```

Desktop shell contracts:

- full-screen viewport with no second page scrollbar;
- 76 px left column: 12 px outer padding, 52 px rail content, 12 px inner separation;
- 56 px top bar; 16 px right/bottom gutter and 16 px Bento gap;
- vertically scrollable icon rail with hidden scrollbar;
- bounded card, table, and log scrolling;
- optional 400-520 px detail drawer that does not replace the canonical route.

## Navigation contract

### Side menu

The side menu is workflow ordered. Icon, accessible label, route, and position are stable. A feature flag may
disable an unavailable item but may not reorder it.

| Order | Module        | Route            | Purpose                                                                         |
| ----: | ------------- | ---------------- | ------------------------------------------------------------------------------- |
| 01    | Overview      | `/dashboard`     | Global Status View, attention queue, recent Owner outcomes                      |
| 02    | R&D           | `/rd`            | Sources, research requests, hypotheses, Artifacts, decisions                    |
| 03    | Backtest      | `/backtest`      | Exploratory runs, comparison, allowed diagnostics                               |
| 04    | Qualification | `/qualification` | Intake, opaque protected‑feedback frontiers, and bounded public outcomes        |
| 05    | Scanner       | `/scanner`       | Schedules, attempts, receipts, proposals                                        |
| 06    | Strategy      | `/strategy`      | Registry, lifecycle authorization, allocations                                  |
| 07    | Runtime       | `/runtime`       | Applied generations, instances, checkpoints, incidents                          |
| 08    | Portfolio     | `/portfolio`     | Performance, exposure, capacity, attribution                                    |
| 09    | Risk          | `/risk`          | Decisions, reservations, claims, adapter admissions, aggregate frontier, fences |
| 10    | Execution     | `/execution`     | Attempts, orders, fills, reconciliation, Recovery readback                      |
| 11    | Data          | `/data`          | Sources, PIT catalog, quality, corrections, freshness                           |
| 12    | Operations    | `/operations`    | Runs, workers, run/service logs, audit, Event Rail, telemetry, alerts           |
| 13    | Settings      | `/settings`      | Data‑source, Agent‑provider, notification, access configuration                 |

The rail starts with the user capsule and local-installation menu. The module capsule is vertically centered when
it fits and scrolls otherwise. Active items use a dark circular fill and white icon; hover, focus, disabled, and
attention states remain distinguishable without color.

### Top menu

The top bar has four zones in order:

1. **Status tape** - active mode/scope, Market Data freshness, R&D queue, Scanner schedule, Runtime readiness,
   Risk fence, and last reconciliation. Unavailable is never hidden.
2. **Module tabs** - route-backed rounded capsule with the same active treatment as the side rail.
3. **Global search/command** - searches identities, receipts, Artifacts, runs, strategies, orders, and docs. A
   command may only open a route or prepare an admitted typed request.
4. **Notifications** - unread count and alert drawer. Delivery is not an Owner outcome or acknowledgement.

| Module        | Tabs in order                                                     |
| ------------- | ----------------------------------------------------------------- |
| Overview      | Status, Attention, Recent, Evidence                               |
| R&D           | Intake, Research, Hypotheses, Artifacts, Decisions                |
| Backtest      | Exploratory, Compare, Diagnostics                                 |
| Qualification | Intake, Outcomes, Eligibility                                     |
| Scanner       | Schedules, Runs, Proposals                                        |
| Strategy      | Registry, Lifecycle, Allocations                                  |
| Runtime       | Instances, Generations, Checkpoints, Incidents                    |
| Portfolio     | Performance, Exposure, Capacity, Attribution                      |
| Risk          | Decisions, Reservations, Claims & Admission, Fences               |
| Execution     | Attempts, Orders, Fills, Reconciliation, Recovery                 |
| Data          | Sources, PIT Catalog, Quality, Freshness                          |
| Operations    | Runs, Workers, Service Logs, Audit, Event Rail, Telemetry, Alerts |
| Settings      | Data Sources, Agents, Notifications, Access                       |

On narrow screens the tape collapses to a status button, tabs scroll horizontally, and the rail becomes a drawer.
Order, route identity, and authority labels remain unchanged.

## Page and data rules

Every routed page contains, in order: a header with scope/Owner/source cut/freshness; a derivable summary strip;
the primary Bento grid; optional table/chart/timeline/comparison; an exact next-action bar only when admitted; and
a detail drawer for identities, receipts, evidence, and recovery.

Overview is a read-only Global Status View. It prioritizes incidents and unknown effects, attention decisions,
stale/unavailable inputs, active research, Scanner/Runtime state, Risk fences, and recent Owner outcomes. It must
not collapse unavailable or protected inputs into one opaque health score. Every status item carries source
frontier, completeness, lag, freshness, and rebuild state. Freshness is evaluated per exact source Owner/cut;
newer data from one source never freshens another. Sequence and frontier namespaces cannot collapse across Owners.
Empty telemetry is unavailable, not healthy. Raw, stale, replayed, or self-asserted telemetry cannot produce
`Available`, even when it carries a nonempty payload or was previously accepted. Availability requires an
Owner-produced projection binding source identity, source cut/frontier, observation and validity times, canonical
payload fingerprint, and the current loss/rebuild state. After telemetry loss, missing or non-current evidence
renders `unavailable` or `stale`; it never falls back to the last positive state. This rule is
`OBSERVED_CANDIDATE_NOT_CURRENT` until the rejected F1 path is corrected and proven through a real consumer.
Every protected negative terminal has the same public bytes regardless
of its opaque internal reference. Freshness, valid‑through, and expiry dispositions come only from Owner‑validated
Time Evidence; an arbitrary nonempty label, client clock, or UI‑derived timestamp cannot drive business state.
Event identity, digest, and checkpoint equality bind the complete canonical envelope, including source Owner/cut,
observed/valid‑through time, payload reference, and telemetry fields. The same identity/frontier with a changed
fingerprint conflicts or quarantines; rebuild never silently rewrites freshness or an Owner fact.

R&D preserves the journey exercised in Windmill:

Source and falsifiable goal -> R&D request receipt -> Frozen Intent -> bounded Agent/build -> immutable Artifact
and Build Receipt -> Artifact Review -> Exploratory Replay Request -> Backtest Result -> R&D handoff -> exact next
action. First-party routes and reusable detail panels replace the single long Raw App; stable identities preserve
deep links and same-identity recovery.

Protected Qualification details stay opaque. The Dashboard shows only the public terminal, type-opaque
non-dereferenceable reference, expiry/revocation, and source-frontier freshness allowed by Qualification. It never
shows protected phase, latency, internal reason, diagnostic category, or a derived research funnel. The public
outcome must be resolved from an Owner-produced projection binding intake receipt, holdout reservation, complete
plan-cell/assessment frontier, and stable attempt identity. The client cannot construct it from equal request/result
DTOs, cannot use renaming to reset an attempt, cannot display N/A without frozen basis, and cannot resurrect a
revoked or expired Eligibility fact. Intake identity binds the complete pre-validation replay meaning, including
invalid values; validation failure must not normalize distinct meanings into one empty sentinel. The first invalid
submission renders its immutable `NOT_ADMITTED` receipt. An exact semantic replay of the same request/handoff may
resolve that receipt, but invalid A to invalid B, invalid to valid, valid to invalid, or any other changed meaning
under the same identity renders `RequestSemanticConflict`, preserves and links the original receipt, disables
submit/resolve-as-success, and offers a new identity only when the Owner admits a successor. The UI exposes only a
redacted changed-meaning summary and semantic fingerprint; protected replay values never enter the page model.
This state machine is `OBSERVED_CANDIDATE_NOT_CURRENT` until a corrected F1 candidate reaches a real Product Edge
consumer. Qualification public projection is terminal-only. `Admitted` and `Evaluating` are legal Owner-internal
non-terminal summaries, but they cannot be converted to `ClosedNotQualified`, `Qualified`, or any other public
terminal. `/qualification/outcomes` omits them from every terminal count and row and renders no public receipt;
the corresponding `/qualification` intake row may show `pending` or `evaluating` only from a separately allowed
intake projection, otherwise `awaiting_terminal / unavailable`. Its only actions are Refresh and the exact
same-identity read admitted by that intake projection. It exposes no terminal color, successor action, or
completion notification. This negative projector rule is `OBSERVED_CANDIDATE_NOT_CURRENT` until the eighth F1
correction is accepted by a real consumer. Owner time evidence and the stored fact head must advance monotonically for
one fact identity; a caller-selected earlier read time cannot restore an older eligible projection. A successor
whose `effective_from` is in the future is rejected or remains an explicit Owner-produced pending successor while
the predecessor remains current. Currentness uses a single half-open interval: the predecessor ends at
`valid_through`, the successor may begin at that exact boundary, and the two may never both be current. The public
projection binds the resulting head transition into its Qualification frontier so identical Time evidence cannot
represent two different heads. Verified late Time evidence remains monotonic even when the requested successor
transition is rejected: the Owner records the expiry/latest-time cut before returning the mismatch, and the client
cannot retry an older boundary to reverse that cut. Browser time, refresh, or optimistic state cannot promote it
early.

At `now == valid_through`, every Strategy Factory Product Edge, Qualification, Scanner, Observability, Runtime,
and Governance projection must treat the predecessor as non-current. Strategy Factory Product Edge now proves
that rule on main as `CURRENT/PARTIAL`; the other producing Owners remain candidate-only and unresolved. The UI
consumes the Owner freshness projection and never recomputes it from browser time.
Any evidence/envelope interval with `available_at >= valid_through` is invalid rather than AVAILABLE.
Until all producing Owners prove that exact boundary consistently, canonical pages render
`EXCLUSIVE_BOUNDARY_UNRESOLVED / unavailable`, keep the last observation for diagnosis, and disable admission or
success actions. A locator comparison, refresh timestamp, or later `+1` test cannot fill this gap.

Runtime application is equally evidence-bound. The Dashboard may display `APPLIED` only from an Owner receipt that
binds the exact generation, application attempt, and resulting Strategy Instance. `APPLICATION_UNKNOWN` remains
unknown until an append-only authoritative reconciliation successor resolves that same attempt. A unit-test or
PAPER harness state is never product Runtime evidence. Live admission and snapshot restore use the same exact
predecessor/reconciliation validator, including valid time, monotonic sequence and `observed_at`, frontier coverage,
and successor evidence at or beyond the reconciliation observation. A malformed or migrated snapshot that fails
those checks remains unavailable or quarantined; it cannot become authoritative through restore. Under the current
F1 correction there is deliberately no positive cross-Owner product path: every public or caller-produced readback
renders `APPLICATION_UNKNOWN`. The Dashboard does not expose an Apply-success state until the separately admitted
sealed-receipt dependency restructuring exists and passes real Owner-store reread.

The earliest independently acceptable Governance-to-Runtime product slice is negative, not positive: the default
Windmill journey may prove `REJECTED_NO_WRITE` and then prove that Runtime produced no application receipt for the
same generation/request identity. The Lifecycle detail shows the rejection receipt, no-write assertion, source
frontier, and exact identity; the Runtime Generations detail shows `NOT_APPLIED / NO_APPLICATION_RECEIPT` and links
back to that Governance receipt. It exposes no Apply or retry button. Positive `APPLIED` remains unavailable until
Qualification, Portfolio, Execution binding, authorization lineage, and Runtime readiness converge in one admitted
consumer slice.

Governance views preserve the complete contender frontier and final ordering by unique canonical strategy-generation
bytes, never arrival order or caller-controlled request identity. A duplicate generation identity, duplicate complete
comparator key, or a policy tie with no admitted resolver produces deterministic `INPUT_INCOMPLETE_NO_WRITE` terminal
receipts for the complete set; exact replay joins the same receipts, while a changed subset cannot admit a decision.
A displayed accepted decision must re-read every authorization and evidence cut through its source Owner and expose
the resulting source frontier. If F0 direct reread is unavailable, the view is `stale`/`unavailable`; a system-clock
digest, UI time, or constant frontier cannot make it current.

Execution and live pages are read-only by default. Future control preserves
`TradeIntent -> RiskDecision/Reservation -> AuthorizedOrderCommand -> EffectAttempt -> VenueReadback/Reconciliation`
and current explicit effect authority. A visual button never shortcuts the chain.

### Windmill screen evidence and route decomposition

The observed authenticated page is `/apps_raw/get/f/trade/rd_workbench` in workspace `trade-rd`. At a 1280 px
browser viewport, Windmill contributes an approximately 208 px workspace sidebar and a 1072 px App iframe. Inside
that iframe, the deployed Raw App uses a 1040 px shell with 16 px side margins, 48/32 px top/bottom padding, and a
single vertical flow. Its four cards have 26 px padding, 18 px radius, 18 px vertical margins, and the source form
uses two 485.5 px columns with a 15 px gap. Primary, secondary, and quiet actions are 46.5 px high and stay in that
order. Below 720 px, the form and receipt lists become one column.

The implementation evidence is the deployed iframe plus
`product/rd-workbench/f/trade/rd_workbench.raw_app/App.tsx`, `index.css`, and `control-policy.mjs`. S3 replay remains
`OBSERVED_CANDIDATE_NOT_CURRENT`; its deployed screen is evidence for layout and interaction, not main or product
admission.

| Windmill stage                         | Observed internal order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Dashboard destination                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01` Source and research goal          | Editable proposal fields: Source URL, source cut, observed time, digest, license basis, required data, interpretation, hypothesis, mechanism, falsifier, expected observation, costs, capacity, Trial budget, precommitted stop rule, PIT/cost/slippage/capacity model identities, independence rationale, and stable request identity. The submit path then renders read‑only R&D basis receipt, Qualification frontier receipt/state, resolved local lineage/frontier, followed by S1 receipt. Submit / Resolve / Successor actions remain in that order | R&D / Intake; split into Source Evidence, Falsifiable Goal, TrialFamily Policy, and Canonical Authority Resolution Bento panels. No authority value is editable. Submit starts validation and the bounded authority chain; family formation remains internally disabled until every sealed row resolves |
| `02` Owner receipt and Research View   | Status row; native receipt/disposition/Intent; availability/phase, source cut, projection/valid‑through; TrialFamily root receipt and root identity/digest; INTENT membership receipt; Census member/fact; Census head/frontier; exact next action; conditional warning                                                                                                                                                                                                                                                                                    | R&D / Research selected‑request detail and `OwnerReceiptDrawer` plus `TrialFamilyReceiptPanel`                                                                                                                                                                                                          |
| `03` Strategy Artifact Formation       | Frozen Intent, build request, attempt, Run / Resolve / Successor actions, status, Formation receipt, Research View, Artifact Review including deterministic double‑build and sandbox policy, Artifact -> TrialFamily binding, binding receipt, bound family/frontier, exact next action and conditional warning                                                                                                                                                                                                                                            | R&D / Artifacts selected‑artifact detail plus `ArtifactTrialFamilyBindingPanel`                                                                                                                                                                                                                         |
| `04` Exploratory Replay and Run Detail | Replay request, run attempt, Artifact, Build Receipt, three actions, status, three Owner receipts/views, actual identities, diagnostics, bounded summary, next action, permanent non‑claims                                                                                                                                                                                                                                                                                                                                                                | Backtest / Exploratory plus `RunDetailDrawer`; Compare and Diagnostics reuse the same receipt‑backed view                                                                                                                                                                                               |

#### Exact S1 V2 and S2 page skeleton

The active candidate is not current backend capability, but its authenticated default-Web execution fixes the
following first-party layout. Desktop uses the canonical 12-column route shell; `P` is 8 columns and `Q` is 4.
Below 768 px the same blocks stack in this order without dropping identities or warnings.

```text
/rd
P1 Source Evidence
   URL [12] -> source cut [6] | observed time [6] -> digest [12]
   license basis [6] | required data [6] -> interpretation [12]
P2 Falsifiable Goal
   hypothesis [12] -> mechanism [12] -> falsifier [12]
   expected observation [6] | costs [6] -> capacity boundary [12]
P3 TrialFamily Policy
   trial budget [6] -> precommitted stop rule [12]
   PIT rule [6] | cost model [6] -> slippage model [6] | capacity model [6]
P4 Canonical Authority Resolution (read-only)
   R&D basis: state | receipt identity | basis identity | cut [12]
   Qualification frontier: state/GENESIS_EMPTY | receipt identity | frontier identity | cut [12]
   R&D lineage: state | predecessor frontier | census cut [12]
I  stable request identity strip [12]
A  [Submit to R&D Owner] [Resolve same identity] [Create successor identity]
Q  source non-authority warning -> form completeness -> current stop predicate
T  request list; selection opens the S1 detail drawer below

S1 selected-request drawer / /rd/research detail
S  semantic label | ACCEPTED / SUBMITTED_OR_UNKNOWN / REJECTED_NO_WRITE /
   IDENTITY_CONFLICT / unavailable
R1 native receipt -> disposition -> Research Intent
R2 availability/phase -> linked Artifact availability -> source cut -> projection/valid-through ->
   Owner-projected read-time freshness/action
F  TrialFamily root receipt -> family identity/root digest -> INTENT membership receipt ->
   Census member/fact -> Census head/frontier
X  restart/cache loss: immutable request identity -> Resolve -> identical receipt/Intent/family/frontier;
   replacement operational run link stays separate from Owner truth
N  current linked view: ARTIFACT_AVAILABLE / AVAILABLE / REVIEW_ARTIFACT
   expired linked view: STALE / ARTIFACT_AVAILABLE / RESOLVE_SAME_REQUEST_IDENTITY
W  one state-specific warning; ACCEPTED without complete direct F is unavailable, never success

/rd/artifacts selected-artifact drawer
I  Frozen Intent -> build request identity -> attempt identity
A  [Run bounded Agent + sandbox] [Resolve same attempt] [Create successor build request]
S  semantic label | SUCCESS / SUBMITTED_OR_UNKNOWN / FAILED_NO_ARTIFACT /
   REJECTED_NO_WRITE / OUTCOME_UNKNOWN / unavailable
C  durable terminal and currentness are separate: linked Research View STALE keeps SUCCESS history but
   removes every review action and permits only Resolve same attempt
R1 Formation receipt -> disposition/failure -> Artifact/Build Receipt
E  FAILED_NO_ARTIFACT canonical receipt identity binds attempt + Intent + disposition + failure code +
   commit time; failure code independently determines disposition and receipt fields never self-verify
R2 Research View -> Artifact/Build/Review identities
V  Artifact Review in fixed order: Artifact digest; Intent/semantic digest; request/source lineage;
   source/Wasm/recipe; structured logic; parameter/dependency identity; Build/Security with
   deterministic double-build and sandbox policy; toolchain/target; Agent explanation/authority;
   admitted actions; S2 NOT_ADMITTED actions
F  Artifact -> TrialFamily binding -> binding receipt -> bound family/frontier
X  restart/cache loss: immutable build request + attempt -> Resolve -> identical Artifact/Review/
   binding/frontier; never Run again or create a naked retry
N  exact next legal action
W  SUCCESS without complete direct F is unavailable; a green job or Agent text cannot fill the gap
```

The Windmill native workspace sidebar is not copied wholesale. Home/catalog, Variables, Resources, global Assets,
Folders, Groups, Tutorials, generic Schedules, editor links, App builder, arbitrary Run-again, worker REPL, and
worker administration are excluded. Evidence-backed Runs, Run Detail, Workers, Service Logs, and Audit are
redistributed under Operations; Settings owns only opaque installation/access references, and domain routes own the
business journey. Settings is not the authority for deployment configuration, Capacity Scope, or `PORT_BOUND`.

#### Exact Operations navigation and list-page skeletons

The fixed `ModuleTabs` order under Operations is `Runs`, `Workers`, `Service Logs`, `Audit`, `Event Rail`,
`Telemetry`, and `Alerts`. The first four come from real Windmill screens; the last three come from Trade
architecture. On narrow screens they become a horizontally scrollable tab row in the same order, never a generic
More menu. Windmill Home, Variables, Resources, global Assets, and Schedules are absent from this row. Run Detail
Metrics, Traces, and Assets remain run-scoped tabs and never become global routes.

`/operations` is the canonical Runs route. Desktop keeps filters, columns, date groups, and row actions stable:

```text
H  Operations / Runs                        [Refresh] [Auto-refresh v]
N  [Runs] [Workers] [Service Logs] [Audit] [Event Rail] [Telemetry] [Alerts]
F  [Runs|Dependencies] [All|Queued|Running|Succeeded|Failed|Unknown]
   [Search path / run ID] [Duration v] [Concurrency v] [More filters]
S  Queued | Running | Unknown | Completed/Failed
T  Date group
   Status | Started | Duration | Path | Trigger/principal | Tag | Owner outcome
   row click -> /operations/runs/:runId; final column only [Open]
B  shown rows / total                         [Previous] page n [Next]
```

`Show schedules` and `Show future jobs` are absent by default. They append to the second `F` row only after a typed
schedule/future consumer is admitted. `Delete disposable cache` exists only in a completed-run overflow menu and
must first show the Owner readback locator plus a confirmation that business facts are unaffected. The list has no
bulk rerun, bulk delete, or editor links. Its loading skeleton keeps four summary slots, two filter rows, and at
least eight table rows; empty, filtered-empty, permission-denied, and backend-unavailable are distinct.

`/operations/workers` uses master-detail without copying Windmill administration:

```text
H  Operations / Workers                                      [Refresh]
N  Operations tabs in the fixed order above
F  [All groups] [rd-product-edge] [reports] [native] [default] [Search worker]
S  Online | Busy | Unavailable | Total leases
T  Worker | Group/tags | Started | Jobs | Last run | Occupancy | Memory | Version | Status
Q  Selected worker: identity, host, lease/readiness, heartbeat age, limits, last run
R  Heartbeat history / explicit unavailable reason                 [Open last run]
```

`Create/Edit config`, `New agent worker`, `Clean cache`, `Restart workers`, REPL, and autoscaling controls never
render. An unknown heartbeat does not imply dead; after the lease policy expires the row shows `Unavailable` and
the last-observed time. On narrow screens `T` becomes a worker-card list and selection opens `Q/R` in a 480 px
drawer.

`/operations/service-logs` is a read-only split pane:

```text
H  Operations / Service Logs                  [Refresh] [Auto-refresh on|off]
N  Operations tabs in the fixed order above
F  [Time range] [Worker|Server] [Service/group] [Instance/host] [Severity] [Search]
S  Error count | Worker hosts | Server hosts | Selected instance
P  Instance list: service/group, shortened host, readiness, last observed
T  Timestamp | severity | service | instance | correlation | bounded message
B  Showing newest n of retention limit | redaction/truncation notice [Download bounded]
```

The initial state requires a host selection and does not paint an empty viewport as success. Auto-refresh preserves
filters and scroll position, following the newest row only while the user is already at the tail. Downloads reuse
the same filters, redaction, and byte limit. Logs cannot promote Owner health, business success, or Telemetry
availability.

`/operations/audit` preserves append-only control-plane semantics:

```text
H  Operations / Audit                                           [Refresh]
N  Operations tabs in the fixed order above
F  [Time range] [Principal] [Operation] [Outcome] [Target/correlation search]
S  Execute | Create/Update | Delete | Failed/Denied
T  Time | audit ID | principal | operation | outcome | target | correlation
Q  Selected event: exact target/correlation, request/run locator, redaction reason
B  Retention / redaction disclosure                 [Copy audit locator]
```

Windmill CE hides resource detail, so current migration evidence displays `redacted` and never fabricates a target.
The first-party `OperationAuditStore` later records exact target/correlation; the page still has no edit, delete,
dismiss, or replay action. On mobile all four pages preserve the semantic order
`H -> N -> F -> S -> T/P -> Q/R -> B`; filters move into a route-local drawer while primary table/card state remains
visible.

#### Exact Run Detail skeleton

`/operations/runs/:runId` is a full route; `RunDetailDrawer` is its 480 px quick-inspection projection. Both use the
same ordered slots and route-backed tabs:

```text
H  Breadcrumb / Runs > path > shortened run ID          [Copy locator] [Resolve outcome]
S  Semantic status | operational status | duration | received/started/completed
P  Run identity, path, kind, tag, trigger, principal, worker, version, hash, language,
   memory peak, parent/root correlation, retention; then Inputs key/value table
Q  Owner Outcome: availability, source Owner, next legal action, receipt identity, source cut
R  Result: bounded JSON/tree view with Copy field, Copy JSON, Download bounded result
T  [Logs] [Metrics] [Traces] [Assets]
   Logs   = search/filter/autoscroll/download + bounded line viewport + truncation notice
   Metrics= NotCollected/Unavailable/time-series
   Traces = NotCaptured/Unavailable/request spans
   Assets = Empty/disposable attachments only; Owner artifacts appear only as receipt locators
```

Buttons never inherit Windmill's generic `Run again`, `Share`, `Edit`, script editor, worker REPL, restart, or cache
clean actions. A domain route may offer a successor request only when the current Owner manifest admits it; the run
page itself offers navigation, copy/download of bounded operational evidence, refresh, and same-identity resolve.

#### Windmill-derived action state machine

| State                                                                    | Primary action                        | Secondary action                                                                   | Quiet action                                                               | Required presentation                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Initial valid input                                                      | Submit or Run enabled                 | Resolve disabled unless an exact imported identity tuple is complete               | Successor disabled                                                         | Neutral `NOT_SUBMITTED`; editable identity and semantic fields                                         |
| Busy or delivery pending                                                 | All submit/successor actions disabled | Resolve becomes the only possible follow‑up after the bounded call returns unknown | Disabled                                                                   | Operational progress is separate; business state is `SUBMITTED_OR_UNKNOWN` or `IN_PROGRESS_OR_UNKNOWN` |
| Unknown outcome                                                          | Disabled                              | Resolve same request/attempt identity enabled                                      | Disabled                                                                   | Persistent warning, immutable identity tuple, no naked retry                                           |
| Terminal success with Owner receipt                                      | Disabled for the completed identity   | Resolve available only when the Owner manifest says so                             | Create successor only when `next_legal_action` admits it                   | Green semantic state, receipt and source frontier; a green Windmill job alone is insufficient          |
| Rejected/no‑write terminal                                               | Disabled                              | Resolve original receipt when admitted                                             | Create successor only when the Owner explicitly admits corrected semantics | Rejection code, zero‑created‑fact statement, original identity preserved                               |
| Identity conflict                                                        | Disabled                              | Resolve original identity only                                                     | Disabled until the original meaning is known                               | Conflict state; never overwrite or imply absence                                                       |
| Missing receipt, invalid evidence, stale, unavailable, permission denied | Disabled                              | Read/resolve only if a typed Owner operation exists                                | Disabled                                                                   | `NotAdmittedNotice` or stop predicate; no optimistic terminal                                          |

### Canonical routed-page skeleton

Every tab must be drawable from the following desktop skeleton before implementation. The content region uses a
12-column grid; omitted slots collapse without changing the order of the remaining slots.

```text
+-- 76 rail --+-- main -----------------------------------------------------------+
| user        | 56 top bar: status tape | tabs | search | notifications          |
| module rail +------------------------------------------------------------------+
|             | H  page title · scope · Owner · cut · freshness · route actions   |
|             +------------------------------------------------------------------+
|             | S1 summary | S2 summary | S3 summary | S4 summary                 |
|             +---------------------------------------------+--------------------+
|             | P primary workspace (8 columns, min 320)    | Q context (4 cols) |
|             +---------------------------------------------+--------------------+
|             | T table / chart / timeline / comparison (12 columns, min 360)    |
|             +------------------------------------------------------------------+
|             | A exact next legal action, sticky only while Owner‑admitted       |
+-------------+------------------------------------------------------------------+
                                                    D detail drawer: 480 px max
```

- `H` is 72-96 px and always contains page title, one-line purpose, scope selector when applicable, Owner/source
  cut, freshness badge, and only route-level actions.
- `S1-S4` are 104 px summary cards. A missing metric keeps its slot and displays `Unavailable`; the grid never
  closes gaps by substituting zero.
- `P` and `Q` are one 320 px minimum row. `Q` contains context, stop predicates, evidence completeness, or the
  currently selected identity; it never duplicates `P` as a second writer.
- `T` is the canonical list/history/comparison surface. Selection opens `D`; it does not replace the URL.
- `A` is absent unless the Owner projection returns one admitted action. It contains the action label, target
  identity, consequence, stop predicate, and one primary button.
- `D` is 480 px at desktop, 400 px at compact desktop, and full-screen below 768 px. Its order is status, immutable
  identities, Owner receipt, source cut/frontier/freshness, evidence, separate operational job link, recovery, then
  the same `A` action. It never contains a second semantic form.
- Loading uses shape-preserving skeletons for every occupied slot. Empty, partial, stale, unavailable, unknown,
  rejected, conflict, quarantined, and permission-denied states retain the same geometry.

### Routed page blueprint registry

The following registry is normative for skeletons. Buttons appear left to right in the listed order. `Open`,
`Copy`, `Refresh`, filters, and compare selection are read-only UI actions; every other button additionally needs
the named Owner action manifest at render time.

#### Overview and R&D

| Tab and route                    | Fixed `S / P / Q / T` contents                                                                                                                                                                                                                                        | Buttons in order                                                                                                                                                                                                            | Default evidence state                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status `/dashboard`              | Four summaries: incidents, unknown effects, stale/unavailable Owners, active work; `P=GlobalStatusMatrix`; `Q=AttentionQueue`; `T=OwnerOutcomeTimeline`                                                                                                               | Refresh views, Open selected detail                                                                                                                                                                                         | `CURRENT/PARTIAL`; missing Owner adapters remain unavailable                                                                                                                                                                                                                                                                                                                                                                          |
| Attention `/dashboard/attention` | Counts by stop predicate; `P=AttentionTable`; `Q=SelectedStopPredicate`; `T=EvidenceCompletenessMatrix`                                                                                                                                                               | Open detail, Resolve same identity when admitted, Copy locator                                                                                                                                                              | Read‑only; no generic dismiss                                                                                                                                                                                                                                                                                                                                                                                                         |
| Recent `/dashboard/recent`       | Owner terminal counts; `P=RecentOwnerOutcomes`; `Q=SourceFreshness`; `T=ReceiptTimeline`                                                                                                                                                                              | Filter, Open receipt, Copy identity                                                                                                                                                                                         | Read‑only                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Evidence `/dashboard/evidence`   | Available/stale/unavailable/quarantined counts; `P=OwnerFrontierMatrix`; `Q=RebuildState`; `T=EvidenceConflictTable`                                                                                                                                                  | Refresh, Open evidence, Copy locator                                                                                                                                                                                        | Static foundations do not become product availability                                                                                                                                                                                                                                                                                                                                                                                 |
| Intake `/rd`                     | Form completeness/source count/request state/Owner freshness; `P=ResearchRequestComposer + TrialFamilyPolicyComposer + TrialFamilyAuthorityResolutionPanel`; `Q=SourceEvidenceCard + NonAuthorityCallout`; `T=DraftSourceList`                                        | Submit starts complete validation then basis/frontier/lineage resolution; while bounded work is pending it is disabled and Resolve same identity is the only recovery; Create successor requires an Owner‑admitted terminal | Existing S1 remains `CURRENT/PARTIAL`; V2 authority chain is `OBSERVED_CANDIDATE_NOT_CURRENT`. Invalid renders its independent rejection receipt and no authority rows; unknown/corrupt history never renders genesis or enables a family action                                                                                                                                                                                      |
| Research `/rd/research`          | Active/stale/unknown/accepted/rejected counts; `P=ResearchRequestTable`; `Q=ResearchViewCard + TrialFamilyReceiptPanel`; `T=ResearchReceiptTimeline`                                                                                                                  | Refresh, Open detail, Resolve same identity, Create successor when admitted                                                                                                                                                 | Existing S1 is `CURRENT/PARTIAL`; TrialFamily root/member/frontier and unified read‑time freshness are `OBSERVED_CANDIDATE_NOT_CURRENT`. The fixed current linked state is `ARTIFACT_AVAILABLE / AVAILABLE / REVIEW_ARTIFACT`; at `now >= valid_through`, the same historical Artifact availability is retained but the fixed state is `STALE / ARTIFACT_AVAILABLE / RESOLVE_SAME_REQUEST_IDENTITY` with every positive action hidden |
| Hypotheses `/rd/hypotheses`      | Active/falsified/pending/unavailable counts; `P=HypothesisLineageTable`; `Q=FalsifierCard`; `T=SourceToIntentGraph`                                                                                                                                                   | Open source, Open Intent, Prepare successor in Intake                                                                                                                                                                       | No direct Fact mutation from this tab                                                                                                                                                                                                                                                                                                                                                                                                 |
| Artifacts `/rd/artifacts`        | Available/failed/unknown/review‑required counts; `P=ArtifactTable`; `Q=ArtifactReviewPanel + ArtifactTrialFamilyBindingPanel + NoArtifactReceiptPanel + ProviderInvocationStateCard`; `T=BuildAndSecurityEvidence` with deterministic double‑build and sandbox policy | Open Artifact, Resolve same attempt, Copy provider claim, Open operational run, Ask Agent to revise, Start exploratory replay                                                                                               | Existing S2 is `CURRENT/PARTIAL`; binding, no‑Artifact closure and invocation state are `OBSERVED_CANDIDATE_NOT_CURRENT`. `OUTCOME_UNKNOWN` hides review/successor actions and exposes only claim copy, operational evidence, same‑attempt resolve and the fixed manual‑reconciliation stop; there is no provider retry button. `ACTUAL_PROVIDER_CALL_AT_MOST_ONCE` remains `NOT_ADMITTED`                                            |
| Decisions `/rd/decisions`        | Accepted/rejected/unknown/action‑required counts; `P=IterationDecisionTable`; `Q=DecisionEvidenceCard`; `T=DecisionLineage`                                                                                                                                           | Open decision, Resolve same identity, Prepare admitted successor                                                                                                                                                            | Read‑only unless Owner returns exact action                                                                                                                                                                                                                                                                                                                                                                                           |

#### Backtest, Qualification, and Scanner

| Tab and route                                          | Fixed `S / P / Q / T` contents                                                                                                                                                                                            | Buttons in order                                                                                                                                                  | Default evidence state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exploratory `/backtest`                                | Running/unknown/terminal/rejected counts plus operation deployment state; `P=ExploratoryReplayComposer`; `Q=CapabilityUnavailablePanel + OperationalJobCard`; `T=BacktestRunTable` preserves historical Owner‑linked rows | When operation is archived: Refresh registry, Open historical run, Copy capability locator. Run/Resolve/Create successor are disabled until restored and admitted | S3 `OBSERVED_CANDIDATE_NOT_CURRENT / DEPLOYMENT_UNAVAILABLE`; remote replay entry is currently archived. Historical design evidence remains, but the page cannot dispatch or imply MCP parity                                                                                                                                                                                                                                                                                                                          |
| Compare `/backtest/compare`                            | Selected‑run count and comparable cuts; `P=RunPicker`; `Q=ComparisonBasis`; `T=RunComparePanel`                                                                                                                           | Add run, Remove run, Swap baseline, Open run detail                                                                                                               | Read‑only; compare 2-4 exact compatible runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Diagnostics `/backtest/diagnostics`                    | Diagnostic category counts; `P=DiagnosticFilter`; `Q=ModelIdentityList`; `T=DiagnosticTable + bounded summary`                                                                                                            | Filter, Copy identity, Open source receipt                                                                                                                        | Only allowed categories; no protected Qualification data                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Intake `/qualification`                                | Submitted/pending/evaluating/unknown/not‑admitted/semantic‑conflict/unavailable counts; `P=QualificationIntakeTable`; `Q=EvidenceCompleteness + QualificationIntakeConflictPanel`; `T=IntakeReceiptTimeline`              | Submit intake, Refresh, Resolve exact same meaning, Open original receipt, Prepare admitted successor                                                             | Pending/evaluating requires a separately allowed intake projection and never implies a public terminal. Exact replay may resolve; any changed valid or invalid meaning under the same identity is `RequestSemanticConflict`. `OBSERVED_CANDIDATE_NOT_CURRENT`; no real Product Edge consumer yet                                                                                                                                                                                                                       |
| Protected feedback `/qualification/protected-feedback` | Current/genesis‑empty/unknown/corrupt counts; `P=QualificationFrontierTable`; `Q=QualificationFrontierReceiptPanel + IndependenceBasisLink`; `T=OpaqueFrontierTimeline`                                                   | Refresh, Resolve current by exact basis, Open R&D basis receipt, Copy opaque frontier reference                                                                   | `OBSERVED_CANDIDATE_NOT_CURRENT`; an isolated canonical‑history Workbench flow consumed a sealed `GENESIS_EMPTY` receipt, but missing head alone is never sufficient. Until exhaustive historical projection/outbox verification succeeds, the page renders `unknown/unavailable`, hides Copy frontier, and exposes only exact‑basis Resolve. Identity/cut/digest/state remain visible; protected content, candidate Intake, protected attempts, eligibility, holdout, and cross‑family ancestry remain `NOT_ADMITTED` |
| Outcomes `/qualification/outcomes`                     | Qualified/ineligible/expired/revoked public‑terminal counts only; `P=PublicOutcomeTable`; `Q=QualificationPublicOutcome`; `T=PublicFrontierTimeline`                                                                      | Refresh, Open public outcome, Copy opaque reference                                                                                                               | `Admitted/Evaluating` create no row, terminal count, receipt, color, notification, or action. Public redaction only; protected fields have no slots. `OBSERVED_CANDIDATE_NOT_CURRENT`                                                                                                                                                                                                                                                                                                                                  |
| Eligibility `/qualification/eligibility`               | Current/pending/expired/conflict counts; `P=EligibilityIntervalTable`; `Q=HeadFrontierCard`; `T=TransitionTimeline`                                                                                                       | Refresh, Resolve current head                                                                                                                                     | Foundation only; empty or dual‑current intervals are unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Schedules `/scanner`                                   | Due/unknown/unavailable/failed counts; `P=ScheduleTable`; `Q=DueSlotEvidence`; `T=AttemptTimeline`                                                                                                                        | Open schedule, Resolve same due‑slot                                                                                                                              | Creation/editing deferred until a real schedule consumer exists                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Runs `/scanner/runs`                                   | Running/unknown/rejected/terminal counts; `P=ScannerAttemptTable`; `Q=AttemptReceipt`; `T=MatcherInvocationEvidence`                                                                                                      | Open run, Resolve same attempt                                                                                                                                    | Missing Owner resolution displays zero Matcher/Proposal calls                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Proposals `/scanner/proposals`                         | New/accepted/rejected/unavailable counts; `P=ProposalTable`; `Q=ProposalEvidence`; `T=ProposalLineage`                                                                                                                    | Open proposal, Prepare admitted lifecycle request                                                                                                                 | Proposal never authorizes Governance or Runtime                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

#### Strategy, Runtime, and Portfolio

| Tab and route                        | Fixed `S / P / Q / T` contents                                                                                                                                                                  | Buttons in order                                                 | Default evidence state                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry `/strategy`                 | Registered/current/superseded/unavailable counts; `P=StrategyRegistryTable`; `Q=GenerationIdentityCard`; `T=GenerationLineage`                                                                  | Open generation, Copy identity                                   | Static Governance foundation only                                                                                                                                                                                                                                                                                                                                                                              |
| Lifecycle `/strategy/lifecycle`      | Pending/accepted/rejected‑no‑write/unknown counts; `P=LifecycleRequestTable`; `Q=GovernanceDecisionCard`; `T=ContenderFrontier`                                                                 | Submit lifecycle request, Resolve same request, Create successor | First product slice is `TARGET_DRAFT`: receipt‑backed `REJECTED_NO_WRITE`; it must correlate to Runtime `NO_APPLICATION_RECEIPT`. Accepted/positive remains `NOT_ADMITTED`                                                                                                                                                                                                                                     |
| Allocations `/strategy/allocations`  | Allocated/unallocated/capacity‑blocked/unavailable counts; `P=AllocationTable`; `Q=CapacityEvidence`; `T=AllocationHistory`                                                                     | Open allocation, Prepare allocation request                      | No allocation writer in Dashboard                                                                                                                                                                                                                                                                                                                                                                              |
| Instances `/runtime`                 | Ready/not‑ready/unknown/incident counts; `P=StrategyInstanceTable`; `Q=RuntimeReadinessCard`; `T=ReadinessTimeline`                                                                             | Refresh, Open instance, Resolve unknown application              | Static Runtime foundation only                                                                                                                                                                                                                                                                                                                                                                                 |
| Generations `/runtime/generations`   | Applied/pending/not‑applied/unknown counts; `P=GenerationApplicationTable`; `Q=RuntimeApplicationCard`; `T=ApplicationReceiptTimeline`                                                          | Resolve same application, Open Governance decision               | First product slice may render `NOT_APPLIED / NO_APPLICATION_RECEIPT` only when joined to the exact `REJECTED_NO_WRITE` Governance receipt; no Apply/retry button. Positive `APPLIED` remains `NOT_ADMITTED` pending the complete five‑input convergence                                                                                                                                                       |
| Checkpoints `/runtime/checkpoints`   | Current/stale/quarantined/unavailable counts; `P=CheckpointTable`; `Q=RestoreValidationCard`; `T=CheckpointHistory`                                                                             | Open checkpoint, Validate restore evidence                       | No restore action from the Dashboard                                                                                                                                                                                                                                                                                                                                                                           |
| Incidents `/runtime/incidents`       | Open/fenced/recovering/closed counts; `P=RuntimeIncidentTable`; `Q=IncidentEvidence`; `T=IncidentTimeline`                                                                                      | Open incident, Open Recovery case                                | Missing heartbeat never closes an incident                                                                                                                                                                                                                                                                                                                                                                     |
| Performance `/portfolio`             | Available/stale/unavailable/source‑incomplete summaries; `P=PerformanceChart`; `Q=AccountAndFactCut`; `T=PerformancePeriods`                                                                    | Change range, Open Execution fact, Open Market Data cut          | `NOT_ADMITTED`: legacy `PortfolioSnapshot` is a migration diagnostic, not an Owner fact                                                                                                                                                                                                                                                                                                                        |
| Exposure `/portfolio/exposure`       | Gross/net/concentration/unavailable summaries; `P=ExposureMatrix`; `Q=CoherentEvidenceCut`; `T=ExposureTable`                                                                                   | Filter scope, Open position fact, Open valuation cut             | `NOT_ADMITTED`: shared Cache positions and stale flags cannot establish currentness                                                                                                                                                                                                                                                                                                                            |
| Capacity `/portfolio/capacity`       | Incomplete/unbound/expired/unavailable scope and available/unavailable gross‑view summaries; `P=CapacityScopeCard + GrossCapacityView`; `Q=CapacitySourceCompleteness`; `T=CapacityViewHistory` | Refresh, Open scope, Open source facts, Copy capacity locator    | `TARGET_DRAFT / CONFIG_AUTHORITY_UNRESOLVED`: only the static Scope skeleton may precede the View. Positive `PORT_BOUND` is `NOT_ADMITTED` until one unique deployment‑configuration Owner, fact identity, and state machine are documented. Until then render `INCOMPLETE_FAIL_CLOSED`; AVAILABLE View also requires Execution account/collateral plus Market Data cuts. Usage/headroom has no Portfolio slot |
| Attribution `/portfolio/attribution` | Available/stale/source‑incomplete/unavailable summaries; `P=AttributionChart`; `Q=AttributionEvidenceCut`; `T=AttributionTable`                                                                 | Change period, Open Execution/Market Data evidence               | `NOT_ADMITTED`; no inferred Alpha, Qualification, or Risk usage                                                                                                                                                                                                                                                                                                                                                |

#### Risk, Execution, and Data

| Tab and route                              | Fixed `S / P / Q / T` contents                                                                                                                            | Buttons in order                                                    | Default evidence state                                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decisions `/risk`                          | Allow/reject/decrease‑only/unavailable counts; `P=RiskDecisionTable`; `Q=DecisionEvidenceAndLineage`; `T=RiskDecisionTimeline`                            | Open decision, Resolve same intent, Open source facts               | `NOT_ADMITTED`: legacy check/forward/denial events never populate this page; no manual override                                                                                                       |
| Reservations `/risk/reservations`          | Available/withdrawn/consumed/unknown‑effect/no‑effect/settled counts; `P=ReservationTable`; `Q=ReservationLiabilityCard`; `T=ReservationHistory`          | Open reservation, Open claim result, Open linked effect             | `MECHANISM_REJECTED / NOT_ADMITTED` for a standalone Risk core; only a complete cross‑Owner input chain with Risk‑owned one‑use facts/store can re‑enter planning. Dashboard never releases liability |
| Claims & Admission `/risk/claims`          | Consumed/rejected/admitted‑once/suppressed/conflict/unavailable counts; `P=ClaimAndAdmissionTable`; `Q=AggregateFrontierCard`; `T=ClaimAdmissionTimeline` | Open claim, Open prepared attempt, Open adapter binding, Open fence | `MECHANISM_REJECTED / NOT_ADMITTED` as a local‑core leaf; claim, admission and fence arbitration must arrive in one real‑consumer vertical slice sharing one Risk transaction frontier                |
| Fences `/risk/fences`                      | Active/pending/cleared/unavailable counts; `P=FenceTable`; `Q=FenceSetAndFrontier`; `T=FenceTimeline`                                                     | Open fence, Open Recovery case, Open source facts                   | `NOT_ADMITTED` until Risk‑owned fence facts exist; an active fence is never hidden or dismissed                                                                                                       |
| Attempts `/execution`                      | Prepared/invoked/unknown/rejected counts; `P=EffectAttemptTable`; `Q=EffectAuthorityCard`; `T=AttemptJournal`                                             | Open attempt, Resolve same effect                                   | Read‑only by default; no invocation button without explicit effect authority                                                                                                                          |
| Orders `/execution/orders`                 | Open/partial/filled/rejected counts; `P=OrderTable`; `Q=AuthorizedCommandCard`; `T=OrderStateTimeline`                                                    | Open order, Open command, Resolve venue readback                    | UI cannot create or alter an order                                                                                                                                                                    |
| Fills `/execution/fills`                   | Fill/fee/slippage/unavailable summaries; `P=FillTable`; `Q=FillEvidence`; `T=FillTimeline`                                                                | Filter, Open fill receipt                                           | Read‑only                                                                                                                                                                                             |
| Reconciliation `/execution/reconciliation` | Matched/missing/conflicting/unknown counts; `P=ReconciliationTable`; `Q=ReconciliationPanel`; `T=VenueReadbackTimeline`                                   | Refresh readback, Resolve same effect, Open Recovery case           | Unknown stays persistent                                                                                                                                                                              |
| Recovery `/execution/recovery`             | Open/contained/reconciling/closed counts; `P=RecoveryCaseTable`; `Q=RecoveryEvidence`; `T=RecoveryTimeline`                                               | Open case, Run admitted read‑only reconciliation step               | No effect retry or closure inferred by UI                                                                                                                                                             |
| Sources `/data`                            | Available/stale/unavailable/license‑blocked counts; `P=DataSourceTable`; `Q=SourceBindingCard`; `T=SourceCutHistory`                                      | Refresh canary, Open source, Copy cut                               | `MECHANISM_REJECTED / NOT_ADMITTED` for a standalone schema leaf; a read‑only canary remains non‑authoritative, and positive binding requires an existing adapter or `LiveNode` consumer              |
| PIT Catalog `/data/pit-catalog`            | Dataset/snapshot/gap/unavailable counts; `P=PITCatalogTable`; `Q=SnapshotIdentityCard`; `T=CorrectionTimeline`                                            | Filter, Open manifest, Copy identity                                | Standalone Source Binding is `MECHANISM_REJECTED`; keep the page unavailable until a consumer‑bound vertical slice is admitted                                                                        |
| Quality `/data/quality`                    | Complete/partial/conflict/quarantined counts; `P=QualityRuleMatrix`; `Q=SelectedQualityFinding`; `T=QualityTimeline`                                      | Open finding, Open source evidence                                  | No automatic acceptance                                                                                                                                                                               |
| Freshness `/data/freshness`                | Per‑source current/stale/expired/unavailable counts; `P=FreshnessMatrix`; `Q=TimeEvidenceCard`; `T=LagHistory`                                            | Refresh, Open frontier                                              | Never compute one global freshness maximum                                                                                                                                                            |

#### Operations and Settings

| Tab and route                           | Fixed `S / P / Q / T` contents                                                                                                                                                                                                                                                                               | Buttons in order                                                                     | Default evidence state                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runs `/operations`                      | Queued/running/unknown/completed/dependency counts; `P=RunTable` with status/date/path/trigger/principal/tag/duration; `Q=SelectedRunSummary`; `T=RecentRunTimeline`                                                                                                                                         | Refresh, Filter, Open run, Resolve Owner outcome, Delete disposable completed cache  | Real Windmill use; operational only and deletion never changes business truth                                                                                                                                                                                                                                                                                                                                                 |
| Run Detail `/operations/runs/:runId`    | Semantic/operational/timing summaries; `P=RunMetadataAndInputs`; `Q=OwnerOutcomeCard`; `T=Logs/Metrics/Traces/Assets`                                                                                                                                                                                        | Copy locator, Refresh, Resolve same identity, Download bounded result/log            | Exact fixed skeleton above; no generic rerun/edit/share                                                                                                                                                                                                                                                                                                                                                                       |
| Workers `/operations/workers`           | Group/online/busy/unavailable counts; `P=WorkerTable`; `Q=WorkerLeaseCard`; `T=WorkerHeartbeatHistory`                                                                                                                                                                                                       | Refresh, Open last run                                                               | Real `rd-product-edge` worker; no create/edit/restart/cache‑clean/REPL controls                                                                                                                                                                                                                                                                                                                                               |
| Service Logs `/operations/service-logs` | Error/worker/server/instance counts; `P=ServiceLogFilters`; `Q=SelectedInstance`; `T=BoundedServiceLogViewport`                                                                                                                                                                                              | Refresh, Toggle auto‑refresh, Download bounded logs                                  | Real Windmill use; read‑only, redacted, retention‑bounded                                                                                                                                                                                                                                                                                                                                                                     |
| Audit `/operations/audit`               | Execute/update/create/delete/success/failure counts; `P=AuditTable`; `Q=AuditCorrelationCard + InvocationClaimReceipt + ProviderInvocationStateCard`; `T=OperationTimeline`                                                                                                                                  | Filter, Open correlation, Copy audit locator, Copy provider claim                    | Real Windmill audit remains append‑only control‑plane evidence, not Owner business truth. Product Edge separately shows claim disposition, `CLAIMED / INVOCATION_STARTED`, start disposition and state digest. `OUTCOME_UNKNOWN` is a persistent manual‑reconciliation stop; historical admission or claim resolution never implies a new effect or provider retry                                                            |
| Event Rail `/operations/event-rail`     | Ingested/conflict/quarantined/rebuilding counts; `P=EventRailTable`; `Q=EnvelopeEvidence`; `T=RebuildTimeline`                                                                                                                                                                                               | Filter, Open event, Copy locator                                                     | Static Observability foundation until real adapter consumption                                                                                                                                                                                                                                                                                                                                                                |
| Telemetry `/operations/telemetry`       | Available/stale/partial/unavailable/quarantined counts; `P=TelemetryMatrix`; `Q=SourceFrontierCard`; `T=TelemetryTimeline`                                                                                                                                                                                   | Refresh, Open source                                                                 | Empty, raw, stale, replayed, or self‑asserted telemetry cannot produce `Available`; loss invalidates the positive projection instead of reviving cached health. `OBSERVED_CANDIDATE_NOT_CURRENT`                                                                                                                                                                                                                              |
| Alerts `/operations/alerts`             | Critical/warning/info/unread counts; `P=AlertTable`; `Q=AlertDetail`; `T=DeliveryHistory`                                                                                                                                                                                                                    | Open alert, Mark presentation read, Open Owner evidence                              | Read acknowledgement is not business acknowledgement                                                                                                                                                                                                                                                                                                                                                                          |
| Data Sources `/settings`                | Configured/healthy/unavailable/secret‑missing counts; `P=DataSourceConfigList`; `Q=OpaqueConnectionRefForm`; `T=ValidationHistory`                                                                                                                                                                           | Test read‑only connection, Save opaque reference                                     | No secret values displayed or stored in page state                                                                                                                                                                                                                                                                                                                                                                            |
| Agents `/settings/agents`               | Configured/running/unavailable/budget‑blocked counts; `P=AgentProfileList`; `Q=ProviderAndBudgetForm`; `T=InvocationHistory`                                                                                                                                                                                 | Test provider, Save profile                                                          | No provider key pass‑through to Owner requests                                                                                                                                                                                                                                                                                                                                                                                |
| Notifications `/settings/notifications` | Channel/enabled/failed/unavailable counts; `P=NotificationPreferenceForm`; `Q=ChannelStatus`; `T=DeliveryHistory`                                                                                                                                                                                            | Send local test, Save preferences                                                    | Does not acknowledge Owner outcomes                                                                                                                                                                                                                                                                                                                                                                                           |
| Access `/settings/access`               | Principal/session/token/revoked counts plus binding `ACTIVE/SUPERSEDED/zero‑active` and authorization available/expired/revoked/unavailable counts; `P=LocalPrincipalCard`; `Q=AuthorizationLineagePanel` with fixed `Current authority / Admission snapshot` tabs; `T=CapabilityManifest + CredentialAudit` | Re‑authenticate local session, Issue narrow transport token, Revoke token, Copy once | Transport credential controls never mint, renew, or revoke Operator Authorization. `Current authority` alone feeds action state; `Admission snapshot` is immutable audit readback and may remain available after cutover/revocation. Both expose exact binding/head, issuer/audience/scope, expiry/revocation frontier, manifest digest, source cut, and stop predicate; secret/token values remain one‑time and never logged |

### Overlay, button, and state rendering contract

- `OwnerReceiptDrawer` and `RunDetailDrawer` use the fixed `D` order above. A receipt section is never hidden behind
  an accordion when it is the only terminal evidence.
- `GlobalSearchDialog` has a query input, type chips, result groups, identity/source-cut preview, and only `Open`
  or `Prepare request` actions. It cannot execute a domain mutation.
- `NotificationDrawer` groups incident, unknown, stale, fence, and informational delivery. `Mark read` affects only
  presentation state.
- Primary buttons submit one admitted semantic operation. Secondary buttons resolve the same identity. Outline or
  quiet buttons create an Owner-admitted successor. Ghost buttons navigate, filter, refresh reads, or copy.
- Every mutating button is wrapped by `ActionAdmissionGate`. An enabled state requires both the current
  `NextLegalActionBar` operation and an `admitted` envelope for the same principal, scope, Owner, operation, schema,
  binding head, authorization, and manifest digest. Expiry, revocation, head change, zero/dual `ACTIVE` bindings,
  manifest mismatch, or resolver unavailability disables the control without preserving its previous green state.
- A disabled business button remains visible only when its prerequisite can be stated locally; its help text names
  the missing receipt, capability, freshness, permission, or identity. A capability that is not admitted renders a
  `NotAdmittedNotice` instead of a permanently disabled fake control.
- Skeletons preserve final geometry: text lines at 60/35% widths, four summary blocks, `P/Q/T` bodies, status badge,
  and drawer rows. They contain no random values, success color, or animated progress unless a real job exists.
- Status order and color are fixed: unavailable/neutral, pending/amber, success/green, rejected or incident/red,
  protected/purple, conflict/quarantine red with an explicit label. Text and icon repeat every color meaning.

## Reusable component inventory

Higher layers depend only on lower layers. Pages do not redefine color, spacing, status semantics, or action rules.

### Foundation primitives

| Component                                                                         | Contract                                                              |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Text`, `Heading`, `Numeric`, `Code`, `Link`                                      | Semantic typography; identities/numbers use mono tabular numerals     |
| `Icon`                                                                            | One library, 1.5 px default stroke, accessible label when interactive |
| `Button`, `IconButton`, `ButtonGroup`                                             | primary, secondary, outline, ghost, destructive; loading/disabled     |
| `Input`, `Textarea`, `Select`, `Combobox`, `Checkbox`, `Switch`                   | label, help, error, disabled, readonly, pending                       |
| `Tabs`, `SegmentedControl`, `Breadcrumb`, `Pagination`                            | route‑backed when resource identity changes                           |
| `Badge`, `StatusDot`, `IdentityChip`, `ModeChip`                                  | text plus icon/shape; never color‑only                                |
| `Tooltip`, `Popover`, `Menu`, `Dialog`, `Drawer`                                  | bounded layers and keyboard dismissal                                 |
| `Skeleton`, `Spinner`, `Progress`, `EmptyState`, `ErrorState`, `UnavailableState` | loading distinct from unknown/empty/unavailable                       |
| `Separator`, `ScrollArea`, `VisuallyHidden`, `CopyButton`                         | shared structure and accessibility                                    |

### Layout and navigation components

| Component                                                                   | Contract                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `DashboardShell`                                                            | full‑screen rail, top bar, viewport, overlay roots          |
| `UserCapsule`                                                               | local operator and installation menu; no business authority |
| `IconRail`, `IconNavItem`                                                   | stable order, tooltip, active/focus/disabled/attention      |
| `TopBar`, `StatusTape`, `ModuleTabs`, `GlobalCommand`, `NotificationButton` | four top‑menu zones                                         |
| `PageHeader`, `ScopeBar`, `AuthorityStamp`, `FreshnessStamp`                | Owner/evidence context                                      |
| `BentoGrid`, `BentoItem`, `SplitPane`, `DetailDrawer`                       | responsive 1/2/3/4/8-column composition                     |

### Data display components

| Component                                                                    | Contract                                                                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Card`, `CardHeader`, `CardBody`, `CardFooter`                               | white, 12 px radius, optional expand, no glass                                                                          |
| `PanelFrame`, `PanelFrameHeader`, `PanelFrameBody`, `PanelSection`           | gray frame, white body, scroll/flex modes                                                                               |
| `StatGrid`, `StatItem`, `KVRow`, `DataList`, `DataTable`                     | unit, source cut, empty/unavailable states                                                                              |
| `ChartFrame`, `ChartLegend`, `ChartTooltip`, `TimeRangeControl`              | axes, unit, locale, disclosure, no‑data behavior                                                                        |
| `Timeline`, `EventRow`, `BoundedLogViewport`, `DiffView`, `ComparisonMatrix` | virtualization, stable keys, redaction, truncation and retention disclosure                                             |
| `FilterBar`, `FilterDrawer`, `DateGroup`, `TableToolbar`, `TableFooter`      | route‑backed filters, stable columns/order, filtered‑empty, row count and pagination; mobile changes only the container |
| `StateBanner`, `Callout`, `AlertRow`                                         | success/pending/unknown/rejected/unavailable/protected/incident                                                         |

### Domain components

| Component                                                                 | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OwnerReceiptCard`, `OwnerViewCard`, `ReceiptLink`                        | Owner identity, disposition, cut, freshness, locator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `NextLegalActionBar`                                                      | only an Owner‑admitted action from the current direct‑read projection; durable historical success never preserves an action across stale/unavailable/archived state. Otherwise render the stop predicate                                                                                                                                                                                                                                                                                                                                                                          |
| `ActionAdmissionGate`, `AuthorizationLineagePanel`                        | cross‑bind the current next action to the unique `ACTIVE` shell binding/history head, independent Operator Authorization, Time Evidence/revocation frontier, and exact content‑addressed operation manifest. The gate alone controls button enablement. The panel has fixed `Current authority` then `Admission snapshot` tabs with identical identity/scope/issuer/audience/expiry/frontier/manifest geometry; the snapshot is labelled historical and never feeds the gate. Neither component constructs, signs, refreshes, or infers authority from credential or local policy |
| `InvocationClaimReceipt`                                                  | Product Edge claim identity, admission identity, attempt identity, committed time, digest, `CLAIMED_NEW / ALREADY_CLAIMED / unavailable` disposition and current `CLAIMED / INVOCATION_STARTED` state. `ALREADY_CLAIMED` links the original receipt; only recovered `CLAIMED` may proceed through the separate atomic start gate                                                                                                                                                                                                                                                  |
| `ProviderInvocationStateCard`                                             | claim identity/digest, state digest, started time, `STARTED_NEW / OUTCOME_UNKNOWN`, operational‑run link and exact next action. `OUTCOME_UNKNOWN` uses the fixed red geometry and `MANUALLY_RECONCILE_PROVIDER_INVOCATION`; buttons are Copy claim, Open operational run and Resolve same attempt. There is no retry‑provider, mark‑success or dismiss control, and no inferred provider outcome                                                                                                                                                                                  |
| `SameIdentityResolvePanel`                                                | immutable request or request+attempt tuple, previous Owner receipt fingerprint, replacement operational‑run link, resolved Owner receipt/view fingerprint, and exact equality/conflict/unavailable result; it is the sole unknown/response‑loss/restart/cache‑loss recovery and never dispatches a naked retry                                                                                                                                                                                                                                                                    |
| `ResearchRequestComposer`                                                 | sourced falsifiable typed request; never creates Intent directly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ResearchViewCard`                                                        | immutable historical Research fact plus separate linked‑Artifact availability, Owner‑projected read‑time availability/phase/action, source cut, projection time and `valid_through`; render current `ARTIFACT_AVAILABLE / AVAILABLE / REVIEW_ARTIFACT` or expired `STALE / ARTIFACT_AVAILABLE / RESOLVE_SAME_REQUEST_IDENTITY` without erasing historical Artifact availability; the expired form has no positive next‑action slot                                                                                                                                                |
| `TrialFamilyPolicyComposer`                                               | editable proposal meaning only: bounded trial budget, precommitted stop rule, PIT/cost/slippage/capacity model identities, independence rationale, and falsifier; it has no editable predecessor/frontier, protected‑feedback, independence disposition/basis identity, falsifier binding, or family identity fields                                                                                                                                                                                                                                                              |
| `TrialFamilyAuthorityResolutionPanel`                                     | three read‑only rows in order: R&D basis receipt/basis/cut, Qualification frontier receipt/frontier/cut/state such as `GENESIS_EMPTY`, then R&D resolved lineage/predecessor/census cut; each includes Owner, operation, locator, availability and stop reason. Positive rows accept only sealed Owner output, never a browser‑deserialized TrialFamily graph. Missing/corrupt/unknown authority exposes only same‑identity Resolve and yields zero S1 family writes                                                                                                              |
| `QualificationFrontierReceiptPanel`, `IndependenceBasisLink`              | sealed Qualification receipt identity, opaque frontier identity/digest/state/cut, source R&D basis receipt locator, exact resolution operation, and no protected payload slot; `GENESIS_EMPTY` appears only after exhaustive canonical verification proves no historical projection/outbox. A missing head or unverifiable history renders `unknown/unavailable`, suppresses Copy frontier, and exposes only exact‑basis Resolve                                                                                                                                                  |
| `TrialFamilyReceiptPanel`                                                 | direct R&D Owner root receipt, family/root digest, INTENT membership receipt, Census member/fact, and head/frontier in fixed order; availability requires canonical JSON to match every duplicated relational identity, ordinal, digest, and committed‑time field; missing/corrupt/incomplete/inconsistent custody is unavailable and cannot coexist with an S1 success badge                                                                                                                                                                                                     |
| `ArtifactReviewPanel`                                                     | immutable identity, lineage, logic, parameters, build/security, and actions from the current linked Research projection; stale‑linked durable S2 success retains evidence but renders no review action                                                                                                                                                                                                                                                                                                                                                                            |
| `ArtifactTrialFamilyBindingPanel`                                         | binding identity, binding receipt identity including `committed_at`, independently displayed commit cut, bound TrialFamily identity and Census frontier from one locked direct‑Owner custody cut; present only beside an Owner‑resolved S2 Artifact, never inferred from Intent/Artifact identifiers, and unavailable during unresolved concurrent mutation or any canonical/time mismatch                                                                                                                                                                                        |
| `NoArtifactReceiptPanel`                                                  | canonical receipt payload identity, attempt, Intent, independently derived disposition, failure code and commit time, plus the explicit zero‑Artifact statement; mismatch or self‑derived verification renders unavailable and exposes no positive action                                                                                                                                                                                                                                                                                                                         |
| `CapabilityUnavailablePanel`                                              | operation identity, registry version, `archived/unavailable` state, last observed deployment, affected channel, preserved historical‑read disclosure, and exact restoration/revalidation predicate; no dispatch, resolve, successor, or credential action                                                                                                                                                                                                                                                                                                                         |
| `RunTable`, `RunSummaryCard`, `RunMetadataAndInputs`                      | operational status/date/path/trigger/principal/tag/duration, immutable inputs, dependency kind, and explicit Owner‑outcome join                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `RunDetailPanel`, `RunResultView`, `RunComparePanel`                      | fixed metadata/result/tab skeleton; Owner‑correlated receipt/result, actual Artifact/PIT/runtime/simulator identities, diagnostics, invocation count, and handoff; no Selection authority                                                                                                                                                                                                                                                                                                                                                                                         |
| `RunLogPanel`, `RunMetricPanel`, `RunTracePanel`, `RunAssetPanel`         | exact four‑tab order; collected/not‑collected/unavailable/empty are distinct and keep identical geometry                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `WorkerGroupTabs`, `WorkerLeaseCard`, `WorkerHeartbeatHistory`            | group, lease/readiness, last observed, last run, memory/version; no administration action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ServiceLogFilters`, `ServiceInstanceList`, `ServiceLogPanel`             | time/service/instance/severity/search, host‑required empty state, auto‑scroll/refresh, and bounded download                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `AuditFilters`, `OperationAuditTable`, `AuditCorrelationCard`             | principal/operation/outcome, exact target/correlation, redaction/retention; append‑only with no dismiss                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `TelemetryMatrix`, `SourceFrontierCard`, `TelemetryTimeline`              | every positive cell binds Owner/source/cut, canonical fingerprint, observed/valid‑through time, and loss/rebuild state; raw, stale, replayed, self‑asserted, or identity‑conflicting input renders unavailable/stale/quarantined and never inherits the previous success color                                                                                                                                                                                                                                                                                                    |
| `QualificationIntakeConflictPanel`                                        | fixed `RequestSemanticConflict` banner, immutable request/handoff identity, original `NOT_ADMITTED` receipt link, redacted changed‑meaning summary, semantic fingerprints, and optional Owner‑admitted successor action; never displays protected replay values or reuses the old receipt for changed meaning                                                                                                                                                                                                                                                                     |
| `QualificationPublicOutcome`                                              | terminal‑only Owner‑produced lineage, stable attempt, N/A basis, checked nonempty interval, monotonic expiry/revocation and late Time cuts, half‑open pending/current transition, and sealed Qualification head frontier; `Admitted/Evaluating` fail projection and leave this component absent, never `ClosedNotQualified`; no protected‑detail slot, empty current Fact, dual‑current boundary, time rollback, or client promotion                                                                                                                                              |
| `GovernanceDecisionCard`                                                  | complete contender frontier, canonical generation ordering, deterministic no‑write tie receipts, decision/action cuts, source frontier, and revalidation; unavailable without direct Owner reread                                                                                                                                                                                                                                                                                                                                                                                 |
| `RuntimeApplicationCard`                                                  | generation, attempt, Strategy Instance, receipt, reconciliation successor, and restore validation; never infers authority from a job/harness or a snapshot weaker than live admission                                                                                                                                                                                                                                                                                                                                                                                             |
| `CapacityScopeCard`, `GrossCapacityView`, `CapacitySourceCompleteness`    | account/mode/economic‑pool scope, candidate‑neutral gross ceilings, exact Execution/Market Data cuts, availability and frontier; while configuration authority is unresolved the fixed card state is `INCOMPLETE_FAIL_CLOSED`, names the missing Owner/fact/state‑machine predicate, exposes no positive BOUND badge or action, and has no usage, headroom, Reservation, allocation, or permit fields                                                                                                                                                                             |
| `RiskDecisionTable`, `ReservationLiabilityCard`, `ClaimAndAdmissionTable` | terminal decision lineage, one‑use Reservation states, stable claim/admission results, complete rejection set and exact linked effects; legacy forwarded commands have no row shape                                                                                                                                                                                                                                                                                                                                                                                               |
| `AggregateFrontierCard`, `FenceSetAndFrontier`                            | one Risk‑owned Capacity Scope frontier, held liabilities, immutable fence‑set membership and transaction ordering; no Portfolio write or UI release action                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `WorkerCard`, `WorkerTable`, `ScheduleCard`                               | operational state separate from business state; no generic worker administration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `FenceBanner`, `UnknownEffectBanner`, `ReconciliationPanel`               | persistent safety surfaces and locators                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `NotAdmittedNotice`                                                       | unavailable capability and evidence required for promotion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Components cover loading, empty, partial, stale, unavailable, error, and permission denied where possible. Domain
components also cover identity conflict and missing receipt. Story fixtures are not acceptance evidence.

## CSS tokens and palette inheritance

CSS uses four layers. Components consume only semantic or component tokens.

```text
raw palette -> semantic role -> component alias -> state modifier
neutral-950 -> text-primary -> panel-text -> [data-state="unavailable"]
```

Raw names describe color; semantic roles describe meaning; component aliases isolate component changes; state
modifiers select semantic roles and never introduce literal colors.

### Core theme tokens

| Semantic token         | Light                 | Dark target | Consumers                                 |
| ---------------------- | --------------------- | ----------- | ----------------------------------------- |
| `--surface-page`       | `oklch(0.92 0.01 85)` | `#111411`   | viewport                                  |
| `--surface-panel`      | `#f2f2f2`             | `#181c19`   | `PanelFrame`                              |
| `--surface-card`       | `#ffffff`             | `#202521`   | cards/panel body                          |
| `--surface-elevated`   | `#ffffff`             | `#272d28`   | menus/drawers/dialogs                     |
| `--surface-hover`      | `#f7f5f1`             | `#2d342e`   | hover                                     |
| `--text-primary`       | `#1a1a1a`             | `#f1f4f1`   | headings/values                           |
| `--text-muted`         | `#5a5a5a`             | `#a7b0aa`   | labels/hints                              |
| `--border-default`     | `#e0ddd8`             | `#343c36`   | cards/inputs/separators                   |
| `--nav-active`         | `#2d2d2d`             | `#f1f4f1`   | active rail/tab                           |
| `--nav-active-text`    | `#ffffff`             | `#171b18`   | active icon/text                          |
| `--focus-ring`         | `#3b82f6`             | `#60a5fa`   | keyboard focus                            |
| `--status-positive`    | `#0b8c5f`             | `#58ceaa`   | available/success, never market direction |
| `--status-negative`    | `#cf304a`             | `#f87171`   | rejected/failure/incident                 |
| `--status-warning`     | `#f59e0b`             | `#fbbf24`   | pending/stale/unknown                     |
| `--status-info`        | `#3b82f6`             | `#60a5fa`   | information                               |
| `--status-protected`   | `#8b5cf6`             | `#a78bfa`   | protected/opaque                          |
| `--status-unavailable` | `#76808e`             | `#9ca3af`   | unavailable/not observed                  |

Dark values are `TARGET`, not evidence that the reference implements a complete dark theme. The first
implementation tests both themes before claiming parity. Market direction uses separate locale-aware
`--market-up`, `--market-flat`, and `--market-down`; these never alias business success/failure. Charts repeat
direction with sign, label, or glyph.

### Component, geometry, and motion tokens

- Cards derive `--card-bg`, `--card-border`, `--card-radius: 12px`, and `--card-shadow` from semantic roles.
- Panels derive `--panel-frame-bg`, `--panel-body-bg`, and `--panel-radius: 20px`.
- Heavy navigation glass uses 40 px blur, 40% surface alpha, 60% light border, and soft 8/32 shadow. Light glass
  uses 4 px blur and 60% surface alpha. Only rail/tabs/tape/tooltip/transient overlays use glass.
- Spacing uses 4, 8, 12, 16, 24, 32, 48 px; Bento gap is 16 px. Radii are 6, 8, 12, 16, 20 px, then full capsule.
- Inter is the UI font; JetBrains Mono/platform mono renders identities, digests, timestamps, and tabular values.
  Panel labels are 10 px uppercase, body/value 11 px, card titles 14 px, page titles 24-32 px.
- Normal transitions are 150-200 ms. Status/receipt/numeric updates do not animate through misleading values.
  `prefers-reduced-motion` removes nonessential motion and continuous tape movement.
- Elevation has named `base`, `raised`, `overlay`, and `modal` levels; arbitrary shadows are prohibited.

## Interaction, responsive, and accessibility rules

- Keyboard order is rail, tape, tabs, page controls, content, detail drawer.
- Icon-only controls have accessible names; focus is visible; overlays trap/restore focus.
- State always uses text and optionally icon/color; color alone never carries meaning.
- Identities wrap or scroll within their component and provide copy actions.
- Tables preserve headers, units, sort, source cut, pagination; large data/log views are virtualized.
- At >=1280 px use the full shell and multi-column grid. At 768-1279 px collapse spans. Below 768 px use a
  navigation drawer, full-screen detail, and deliberate card/horizontal table representations.
- Small viewports never hide an incident, unknown effect, active fence, next legal action, or unavailable state.
- Optimistic UI may show delivery progress but never an Owner terminal before its receipt.

## Service and data boundaries

The Dashboard service owns only route/presentation state, local session/capability projection, versioned operation
descriptors, disposable run/worker/progress/result/log projections, bounded service logs, append-only control-plane
audit, rebuildable read caches with frontier/lag, and notification presentation/delivery acknowledgement.

It does not own authorization lineage. `AuthorizationAdmissionGateway` is a typed Product Edge orchestrator over
three canonical ports: deployment binding/history readback, trusted Operator Authorization resolution with Time
Evidence and revocation frontier, and content‑addressed operation-manifest retrieval. It may cache only a bounded
negative/positive projection through the record's valid-through cut; cache loss never changes authority, and a
cache hit never skips the atomic admission reread at submission. Missing, stale, expired, revoked, ambiguous,
self-asserted, locally configured, or mutually inconsistent inputs return a non‑admitted envelope with zero Owner
write. There is no Dashboard endpoint to create, edit, sign, renew, select a replacement for, or force-activate
these records.

It never queries Owner tables directly. A typed Dashboard API/BFF calls public Owner/Product Edge ports and returns
discriminated `available`, `stale`, `partial`, `unavailable`, `unknown`, `rejected`, and `terminal` envelopes.
Every cache entry carries source identity/cut, projection version, observed time, expiry, and rebuild path. Deleting
Dashboard or job storage does not change a business fact.

For R&D S1 V2, one typed envelope groups the request receipt, Research View, TrialFamily root receipt,
INTENT-membership receipt, and Census frontier returned by direct R&D Owner readback. `ACCEPTED` with any missing,
corrupt, stale, or inconsistent family part is `unavailable`, not a partial green terminal. For S2, `SUCCESS`
requires the Artifact, Build Receipt, Artifact Review, Artifact-to-TrialFamily binding receipt, and bound Census
frontier from the same Owner transaction. The BFF exposes separate same-identity request and build-attempt resolve
operations; neither operation dispatches a replacement job or derives a family from caller-provided identifiers.

The S1 chain first performs complete pure V2 validation. Invalid input may commit only one independent rejection
receipt; it writes no independence basis, Qualification projection, Research receipt, Intent, family, member, head,
or outbox. Only the resulting opaque validated marker can enter positive formation. R&D then writes or reuses its
write-once basis fact; Qualification resolves that exact basis and publishes or reuses an opaque protected-feedback
frontier; Product Edge carries only their references and cuts. In the final `scope -> request` locked transaction,
R&D re-reads both Owner facts and its full local lineage before any Research/family write.

Lineage discovery never uses an unverified JSON field as an SQL selector. Under the scope lock it enumerates every
receipt row for the scope, canonical-decodes and custody-verifies every row through one central kernel, then filters
the verified facts. One corrupt, missing, stale, or unavailable row makes the result non-positive
`SUBMITTED_OR_UNKNOWN`; it cannot be skipped to create `GENESIS_EMPTY`. Exact request replay after lineage advances
reuses the original basis and receipts rather than recomputing authority from current caller data.

Qualification applies the same exhaustive rule to its own authority history. Under its Owner lock it enumerates
every supported protected-feedback projection and outbox row, canonical-verifies the complete stored meaning, and
only then filters by exact R&D basis. `GENESIS_EMPTY` is admitted only when that fully verified history is empty; a
missing head, orphan projection/outbox, malformed representation, ambiguous decoder, or unavailable read returns
`unknown/unavailable` and permits only exact-basis Resolve. It must not create or repair a positive head from absence.

Positive TrialFamily root/member/head/frontier graphs are sealed direct R&D Owner outputs. Public deserialization,
caller construction, browser reconstruction, or a shared DTO cannot create an admitted graph even when its bytes
look canonical. The Dashboard accepts only the typed Owner projection and otherwise renders the authority panel
unavailable.

Stored Research history remains immutable; freshness and the next legal action are projected by the R&D Owner on
every direct read. The Dashboard/BFF may not cache a previous positive action across `valid_through`: at
`now >= valid_through` the envelope is `STALE`, contains no positive action, and admits only same-identity Resolve.
That rule is an end-to-end transition invariant, not merely a disabled button: prepare, candidate, and fail must
prove an Owner-cut `AVAILABLE` Research View inside the same locked transaction before attempt creation or any
Prepared-to-Building/terminal transition. `STALE`, `UNAVAILABLE`, and `SUBMITTED_OR_UNKNOWN` produce zero business
writes and can expose only exact-identity resolution; recovered canonical Prepared custody is a distinct state.
The write-admission cut is sampled only after acquiring the custody lock and completing canonical custody read,
immediately before the first protected write. A pre-lock/request/response-projection timestamp cannot authorize a
write; crossing `valid_through` while waiting for the lock must therefore return the non-positive zero-write path.
The S2 no-Artifact envelope accepts only an Owner-verified canonical receipt identity that binds attempt, Intent,
disposition, failure code, and commit time; failure-code-to-disposition mapping is checked independently rather
than reconstructed from caller/receipt fields. Any mismatch is `unavailable`, never a terminal failure badge.

TrialFamily availability additionally requires every duplicated PostgreSQL relation field - family/member/head/
binding/outbox identity, member ordinal and fact identity, digest, and committed time - to match the verified
canonical representation. A partial comparison cannot render `ACCEPTED`, `AVAILABLE`, a review action, or a green
receipt panel; mismatch or unreadable custody yields `unavailable` with no write-capable action.

Positive binding resolution must read and verify its canonical binding, receipt, family/frontier, and outbox at
one protected custody cut with the binding row locked against concurrent mutation. A previously read READ
COMMITTED snapshot cannot remain positive after another transaction changes custody; unresolved lock/mutation
state is `unavailable`, and only a later exact direct read after canonical restoration may recover availability.
The binding receipt identity covers the complete receipt meaning, including its independently authoritative
`committed_at` cut; coordinated canonical/relational timestamp changes must change identity or fail closed.

Artifact custody discovery cannot use a raw JSON selector, discriminator, or caller predicate to decide which
binding, receipt, family/frontier, or outbox rows deserve verification. It first enumerates the bounded candidate
rows under the custody lock, canonical-decodes and verifies every supported representation, and only then applies
the verified predicate. Missing, malformed, ambiguous, or selector-only custody is `unavailable`, never a partial
Artifact success or review action.

Legacy Portfolio Cache snapshots and legacy Risk command/denial events may enter only a separately labelled
`MigrationDiagnostic` envelope. That envelope has no Owner locator, cannot satisfy a canonical page query, cannot
be joined into Capacity/Risk summaries, and exposes no action. Canonical Portfolio and Risk routes remain
`unavailable` until their Owner-local stores and direct typed resolvers exist.

The BFF may carry the shared untrusted fact-reference vocabulary and canonical framing, but owns no cross-Owner
proof service. It routes each reference to the named source Owner's typed resolve operation; only that Owner's
durable-store/outbox reread may return a crate-private admitted projection to its consumer. Missing resolve ports,
canonical-byte mismatch, or unavailable Owner storage returns `unavailable` and disables elevation/action.

No `DeploymentConfigurationAuthority` service is admitted yet. System/live configuration, routing maps, Cache,
environment variables, and Settings forms are transport or installation mechanisms, not the unique Owner fact that
can establish `PORT_BOUND`. The Dashboard may display redacted opaque references to those mechanisms, but the BFF
must return `CONFIG_AUTHORITY_UNRESOLVED / INCOMPLETE_FAIL_CLOSED` until documentation explicitly assigns one Owner,
canonical fact identity, lifecycle/state machine, typed resolver, and reread rule. It must not synthesize that
authority from agreement among configuration values.

Visual UI and MCP consume one operation registry and policy compiler: exact version, schemas, capability, Owner
route, timeout class, recovery identity fields, and allowed operational reads. The operational implementation is
split into `RunStore`, `Dispatcher`, `WorkerLeaseStore`, `BoundedRunLogStore`, `ServiceLogGateway`, and
`OperationAuditStore`; none may expose or mutate Owner payload tables. Neither channel receives workspace
management, deployment, preview, arbitrary script, database, shell, worker administration, object storage, or
secret-management tools.

Each registry operation also has a deployment state: `available`, `archived`, or `unavailable`. `archived` removes
dispatch and domain mutation actions from UI and MCP while preserving route geometry, capability identity, and
read-only access to Owner-linked historical runs. Only an externally completed, version-matched deployment plus
consumer revalidation may return it to `available`; the Dashboard never performs archive/restore or infers
availability because source code or a historical run exists.

## Packaging and deployment target

The Dashboard ships with the Trade image set as the default visual entry and control surface. It must pin frontend
dependencies; produce a content-addressed artifact; run unprivileged with a read-only filesystem except explicit
caches; expose process readiness without claiming Owner/trading health; accept endpoints and opaque secret
references at runtime; keep credentials out of images, HTML, bundles, URLs, logs, telemetry, and errors; preserve
separate Owner stores/credentials; and include asset manifest, provenance, compatibility declaration, and route
smoke test.

Windmill and Dashboard may coexist during migration without dual business writers. Cutover is consumer based:
every admitted Windmill Web/MCP journey passes through the new Dashboard/registry with the same Owner receipts and
fail-close behavior. Windmill removal is a separate reversible cleanup after parity, cache-loss recovery, and
artifact custody are proven.

## Unattended implementation sequence

The backend dependency wave is a `TARGET_DRAFT` development-custody constraint, not evidence that any Owner or
Dashboard capability is current. F1 must first freeze, pass independent exact-head review, and pass the repository
root gate. The first logical W1 wave after Hub acceptance is exactly five parallel leaves: **Market Data Binding**,
**Execution Binding**, **Portfolio Scope fail-close skeleton**, the **Risk-Execution edge-break**, and **GR0
Governance-Runtime Sealed Read Seams**. GR0 changes only the two existing Owner crates to expose concrete sealed
read seams; it creates no shared crate and does not edit root workspace files. The edge-break is a five-file,
zero-lock mechanical predecessor: move the trailing algorithm to Model, retain an Execution compatibility
re-export, and reduce Risk's Execution dependency to dev-only. Risk Core cannot start before it freezes. Market
Data facts succeed Market Data Binding; the Execution Sandbox descriptor succeeds Execution Binding and is never
part of the same leaf writer. Portfolio's static Scope skeleton does not establish `PORT_BOUND`.
There is no dependency-prewire task: each leaf adds an Owner-evidence dependency to its package manifest only when
its real source imports the exact public API. Leaf tasks must not edit root `Cargo.toml`, `Cargo.lock`, or `Makefile`;
after all five heads freeze, the sole **GR1 root/lock/testkit fan-in** may create the read-only relation crate, update
the lock/root inventory, and run the complete locked gates. A missing frozen predecessor, typed public port, or exact Task identity keeps
the affected Dashboard projection `unavailable` and prevents an unattended agent from inventing the dependency.

1. **Foundations** - tokens, themes, shell, routes, navigation, responsiveness, accessibility, component catalog.
2. **Read-only projections** - typed BFF, stamps, Overview, identity search, stale/partial/unavailable behavior.
3. **R&D S1 replacement** - sourced request, TrialFamily policy, receipt, Research View, direct root/member/frontier
   readback, next action, reject-no-write, conflict, unknown, and same-identity resolve.
4. **R&D S2 replacement** - bounded build job, Artifact/Build Receipt/Review, deterministic build evidence,
   direct Artifact-family binding/frontier readback, action admission, no-Artifact failure, restart recovery, and
   App/MCP parity.
5. **Exploratory replay replacement** - only after S3 merge and independent revalidation; preserve separate R&D
   and Backtest receipts and `NOT_ADMITTED` economic claims.
6. **Operations** - worker leases, schedules only for admitted consumers, job/progress/log views, disposable cache
   deletion, restart, Owner-based recovery.
7. **Portfolio projections** - after F1, begin only with the fail-close static Capacity Scope skeleton. Keep it
   `INCOMPLETE_FAIL_CLOSED` and positive `PORT_BOUND` unavailable until documentation assigns the unique deployment-
   configuration Owner/fact/state machine and the admitted Market Data/Execution bindings resolve. Then render
   BOUND Scope; keep Capacity View unavailable until complete account/collateral and valuation cuts exist. Never
   adapt legacy Cache snapshots or add usage/headroom fields.
8. **Risk projections** - after Portfolio facts and removal of the Risk-to-Execution production dependency, add
   Decisions, Reservations, Claims & Admission, Aggregate Frontier, and Fences from Risk-owned facts only. Legacy
   forwarded commands and denials remain migration diagnostics.
9. **Remaining domain views** - add in side-menu order under current Owner disclosure contracts; no mutation until
   separately admitted.
10. **Image integration and cutover** - provenance, packaging, migration parity, rollback, then separately authorized
   Windmill retirement.

Each slice runs component/accessibility, route/responsive, typed-contract, negative/unknown tests, the real Owner
journey, App/MCP parity where applicable, cache-loss/restart recovery, repository docs/root gates, and full diff
inspection. Screenshots and mocks never replace the real consumer.

## Non-goals and kill conditions

The Dashboard is not a notebook, code IDE, general automation builder, observability backend, data warehouse,
secret manager, business database, broker, exchange terminal, or autonomous trading authority. It does not
recreate all of Windmill.

Implementation stops when it needs a second business writer, direct Owner-table write, hidden protected detail,
fabricated freshness, success without a receipt, broad management tool, unresolved effect, unavailable current
Owner contract, or a change to documented top-level authority. A top-level architecture change requires explicit
user authorization before further code or documentation changes.
