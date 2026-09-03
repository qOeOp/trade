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

Artifact Formation uses a stable build-request identity and a stable attempt identity in addition to the frozen
Research Intent identity. Replaying the same semantic tuple joins the same Owner attempt; reusing either identity
for different semantics is an identity conflict. The exhaustive Owner dispositions are `SUCCESS`,
`FAILED_NO_ARTIFACT`, `REJECTED_NO_WRITE`, and `OUTCOME_UNKNOWN`; `SUBMITTED_OR_UNKNOWN` is a query state, not a
business disposition. Only `SUCCESS` atomically commits a new immutable Artifact, Build Receipt, Artifact Review,
and `ARTIFACT_AVAILABLE` projection. Every other disposition has no Artifact. Response loss after commit resolves
to that exact receipt, while timeout before commit can only close unknown without an Artifact. App and MCP invoke
the same versioned Formation operation and never use Windmill job state as a substitute.

Product Edge samples the request-admission commit cut only after the canonical authorization, deployment binding,
manifest, and admission locks are held, immediately before its first write. It revalidates all four authorities at
that same half-open cut and binds the cut into the admission identity and receipt. If expiry is crossed while a lock
wait is in progress, the request writes nothing. Product Edge unavailability or storage uncertainty, including
when admission custody may already exist, is reported as `SUBMITTED_OR_UNKNOWN` with only
`RESOLVE_SAME_ATTEMPT_IDENTITY`; it is never converted into `REJECTED_NO_WRITE` or successor authority.

A provider invocation claim is itself durable one-use custody. If the claim commits but its response is lost,
same-attempt resolution returns the exact `CLAIMED` claim and the sole action
`RUN_BOUNDED_EXECUTION_AGENT`. App and script may then start that existing claim once. They cannot create a
successor claim or invoke the provider a second time; after `INVOCATION_STARTED`, the only safe projection is
manual provider reconciliation unless an authoritative terminal Owner receipt exists.

### Sealed Source Intake acceptance topology

Source Intake has one explicitly separate, compile-time `SEALED_ACCEPTANCE` composition. It is not part of the
production artifact, is disabled by default, and cannot be selected by an ordinary Product Edge request, generic
production environment variable, runtime provider name, URL, header, credential, or DSN. The production artifact
contains no acceptance adapter. Its only acquisition class is `LIVE_EXTERNAL`, and it fails closed until all real
policy, time, DNS, rights, credential, egress, and provider authorities are configured and current.

The acceptance composition replaces only the provider boundary with a sealed adapter over a fixed DOI corpus,
fixed response bytes, and deterministic rejection cases. It uses a non-public provider identity, has no external
network capability, and shares no database, volume, workspace, or mutable state with production or another
acceptance run. It still traverses the production Product Edge admission gateway, the same Source Intake Owner
orchestrator, durable claim/start, move-only permit, R&D PostgreSQL atomic terminal transaction, terminal receipt,
readback, and the default Windmill `RUN` and `RESOLVE` transport. The API performs authentication, DTO validation,
and projection only; Windmill schedules or transports calls only. Neither owns or reconstructs the lifecycle.

Each acceptance deployment is created from exact script content plus its lock and content hash in a fresh unique
Windmill project/workspace, ingress port, database, and volume. Its environment identity, provider-profile digest,
fixture-corpus digest, sealed policy and Time Evidence, binding evidence, and retrieval evidence are cross-bound
into the admission, acquisition binding, terminal receipt, and readback. The runner must:

1. deploy that exact identity and invoke deployed `RUN`, the same `RUN` again, and same-request `RESOLVE`;
2. verify one full `RETRIEVED` receipt and its content-addressed locator, content digest, acquisition provenance,
   Source Candidate, and outbox records;
3. verify a sealed policy rejection causes zero provider invocations and zero positive records;
4. induce loss of the first `RUN` response after provider execution and the atomic terminal commit, resolve the
   same attempt, and prove provider invocation count is exactly one; and
5. remove the unique project/workspace, port allocation, database, and volume, then read back that every isolated
   artifact is absent and no shared target changed.

Passing this runner is `SEALED_ACCEPTANCE` evidence only. It is never evidence that the Workbench is `CURRENT` or
that production policy, time, DNS, rights, credentials, egress, PostgreSQL, Windmill, or a live provider is ready.

### Source Intake-to-Composer D0 contract

This section freezes the top-level contract for the next implementation DAG; it does not make any target
capability current. The maturity split is exact:

- **CURRENT/PARTIAL:** crate-local Source Intake contract/regression evidence and Develop Composer V2, including
  its local deterministic bounded-plugin build producer and `ProgramHostV2` consumer proof. These are separate
  local proofs. No current evidence establishes the isolated PostgreSQL/Windmill Source Intake runner or a
  composed Source Intake-to-Research-to-Composer path.
- **TARGET A1 - durable Composer Owner operation:** one public Composer `RUN`/`RESOLVE` contract, in-process A0
  build consumption, and atomic R&D PostgreSQL custody of the private canonical A0 Build Receipt bytes plus restart
  readback as specified below.
- **TARGET A2 - typed ancestry and isolated transport:** one R&D-owned Source Intake-to-Research operation followed
  by the A1 Composer operation through the isolated Windmill topology specified below.
- **SEALED_ACCEPTANCE:** only a completed A2 runner with all listed dynamic gates may claim the composed acceptance
  topology. It remains acceptance-only and cannot establish `PRODUCT_CURRENT` or production readiness.

Replay Policy V2 comes only from the sealed, versioned, content-addressed R&D Catalog defined by the
[R&D Owner contract](../owners/rd). Immediately before the first TrialFamily-formation write, the private R&D
formation resolver locks and rereads the explicit current unrevoked head on its existing transaction and seals the
policy and Catalog cross-binding permanently into the family. Later Composer and Replay compositions use only that
family-sealed policy and cross-binding; it never rereads the Catalog as authority. An optional Catalog reread is
audit-only and cannot affect admissibility, so later Catalog revocation, deletion, unavailability, or tamper cannot
invalidate a formed family. Public Composer or Research requests carry no policy selector. Product Edge, Windmill,
callers, providers, environment values, defaults, migrations, and deployment configuration cannot create or
select a version, advance the head, revoke a version, seed the Catalog, or synthesize a fallback. Only the private
audited R&D Catalog Administration Port owns those writes.

The separately authorized Catalog bootstrap composition remains outside Product Edge. It is a dedicated, opt-in,
one-shot `authority-admin` unit with no HTTP or Windmill route and uses `RD_FACT_WRITER_DATABASE_URL` only after its
sealed, deny-unknown-fields V1 request has been authenticated by Ed25519 against a separately trusted verifier
identity and key. Neither that database credential nor any request field may self-assert authentication;
`authentication_fact_digest` derives from the verified evidence before database access. Product Edge cannot
provide the request, verifier, key, administrator identity, policy bytes, command identities, event time, signature,
or canonical Owner readback, and cannot start the R&D API. The product startup boundary admits the API only after
schema materialization, custody cutover, explicit Catalog bootstrap or exact resolution, and verification of the
byte-identical typed Owner readback reconstructed from the exact sealed request and immutable audited record/head
state. First success and exact response-loss or restart replay return the same bytes; an attempt-local
`CREATED`/`RESOLVED` field cannot distinguish them. The immutable audit facts are the durable command receipts and
that typed readback is the sole projection, with no administration receipt or outbox. Missing or conflicting
bootstrap custody fails startup closed without a default.

The public Composer `RUN` accepts only an untrusted request identity, Research custody reference, Design proposal,
binding requests, and bounded plugin-source capsule. These values are proposals and locators, never verified facts.
In the same process, the operation must invoke the accepted A0 deterministic build boundary, preserve its opaque
verified build in-process, and consume that token by move. That positive type is neither `Clone` nor
serializable/deserializable. The private canonical A0 Build Receipt bytes are a separate durable fact, not a token
representation. There is no public verified-build locator, verified-build read port, database or API token
representation, and no provider, caller, Windmill flow, or restart path may reconstruct a verified token from
bytes, digests, receipts, or labels.

After A0 and immediately before its positive commit, A1 locks and rereads the final accepted Research custody and
every exact fact-Owner binding. The R&D, Composer, and Market Data path uses one admitted R&D PostgreSQL
transaction domain: A1 passes its existing transaction capability to each applicable Owner-owned sealed Composer
or Market Data read method. Each Owner locks, canonically rereads, validates, and seals its own facts on
that exact transaction. No method may open another pool, connection, or transaction; neither caller nor Windmill
may read raw Owner tables, reconstruct sealed evidence, or acquire the Owner's fact authority. Missing,
unavailable, stale, mismatched, cross-cut, or wrong-owner Composer or Market Data evidence, or an invalid
family-sealed policy cross-binding, fails before the first positive write. That same R&D transaction atomically
stores the canonical `StrategyDesignV2`,
`StrategyPlanV2`, `StrategyArtifactV2` package and private module bytes, private canonical A0 Build Receipt bytes,
the Composer receipt, host-admission receipt, operation receipt, and R&D outbox. JSON is a projection only and
cannot be the canonical readback or hash source. Restart and `RESOLVE` reread and parse the canonical Build Receipt,
validate its capsule, toolchain, linker, configuration, and deterministic two-build provenance, bind that receipt to
the Artifact and Composer receipts, then recompute and compare every content and binding digest before readmitting
the Artifact to `ProgramHostV2`. This validation never recreates the move-only verified token. Raw Wasm and the
canonical Build Receipt bytes remain private; the public positive Artifact projection contains only the immutable
Artifact locator and public digests. The operation envelope separately carries its terminal disposition and receipt
identity.

The durable operation serializes one semantic attempt. Concurrent exact request and meaning join the same
byte-identical terminal receipt. Reuse of the request, Research/Intent, build-attempt, or artifact identity with any
changed meaning or canonical byte is `CONFLICT` and writes nothing. A positive terminal is visible only after the
single transaction commits all canonical bytes, receipts, and outbox; any rejection, unsupported/refinement,
unavailable evidence, A0 failure, reread drift, host rejection, serialization/storage failure, or rollback leaves
zero partial positive rows and grants no successor authority. `REJECTED_NO_WRITE`, `UNSUPPORTED`, and
`NEEDS_RESEARCH_REFINEMENT` may return only an authoritative negative operation receipt proving that absence;
missing, stale, or unavailable required evidence returns `UNAVAILABLE` with only same-attempt resolution and no
successor authority. Loss of the response after commit remains `SUBMITTED_OR_UNKNOWN`; same-request `RESOLVE`
returns the committed receipt without rebuilding, reinvoking a provider, or minting a successor attempt. Storage
uncertainty that cannot prove commit remains unresolved, never a fabricated rejection or success.

Source ancestry is a separate typed R&D-owned operation. It locks and rereads the exact Source Intake `RETRIEVED`
terminal receipt, acquisition provenance record, Source Candidate, and matching transition outbox, verifies their
shared request/attempt/content/retrieval/policy/rights lineage, and returns sealed ancestry evidence only. Source
content remains untrusted and never confers accepted Research custody. The following typed Research `RUN` consumes
an untrusted Research proposal and that separately verified ancestry evidence through the canonical R&D Research
admission. R&D remains the sole Intent owner: only that admission may resolve the Independence Basis, current
Qualification frontier, and local semantic-predecessor lineage, then freeze the Intent, falsifier, permanent
TrialFamily authority, receipts, and the current Research custody that Composer consumes. A Source attempt alone
can never derive `CurrentResearchDevelopCustodyV2`. Copying caller-supplied fields, accepting a provenance locator
without Owner reread, or merely deploying Source Intake and Composer together is not composition. A missing,
mismatched, stale, non-`RETRIEVED`, or unavailable ancestry member, or any failed canonical Research admission,
creates no accepted Research custody and makes Composer unavailable for that ancestry.

A2 uses Windmill only as transport in this fixed order:

`Source Intake RUN/RESOLVE -> typed Research RUN/RESOLVE -> Composer RUN/RESOLVE`.

Each deployed script parses a typed request or receipt and calls the next Owner operation; it owns no lifecycle,
verified build, canonical bytes, or business result. The acceptance binary selects sealed adapters at compile time,
uses the fixed Source Intake corpus and fixed A0 source/build corpus, and exposes no runtime provider selector,
provider URL, credential, fixture path, DSN, header, or environment switch. Every run receives a unique internal
PostgreSQL instance/schema, Windmill project/workspace, network, ingress allocation, and volumes, with no route or
mutable state shared with production or another run. A fixed content-addressed Replay Policy Catalog fixture is
test-only: the isolated harness creates it and explicitly advances its head through the private administration
port before forming the disposable TrialFamily; later acceptance steps consume only the family-sealed policy. The
fixture, administration hook, and policy bytes exist only in the compile-time `SEALED_ACCEPTANCE` composition;
they are not a runtime default, migration seed, production artifact, or deployment selector. That fixed fixture
hook is distinct from the sealed one-shot product bootstrap: neither path gives Product Edge or Windmill Catalog
authority.

The composed runner must prove all of the following against the deployed operations and canonical Owner readback:

1. concurrent same-meaning `RUN`s join one byte-identical receipt, while concurrent same-identity changed meaning
   conflicts with zero changed-meaning or partial rows;
2. injected failure at each A1 write boundary leaves zero partial Design, Plan, Artifact/module, receipt,
   host-admission, operation, or outbox rows;
3. response loss after atomic commit resolves the exact terminal with one A0 execution and no successor attempt;
4. process and database restart followed by `RESOLVE` rereads and parses the private canonical A0 Build Receipt,
   validates its capsule/toolchain/linker/configuration/two-build provenance and Artifact/Composer receipt bindings,
   then returns byte-identical public evidence after remaining canonical-byte parse/hash verification and successful
   `ProgramHostV2` readmission;
5. a single-field mutation of every Source Intake ancestry member, Research proposal/Design/binding/source-capsule
   input, A0 identity, stored canonical object, module byte, receipt, or outbox binding fails closed and creates no
   positive successor; a separate single-field mutation of the private canonical A0 Build Receipt does the same;
6. the deployed Windmill golden path reaches `RETRIEVED`, canonical Research admission with typed accepted Research
   custody, and the durable Composer terminal; exact replay uses all three same-request `RESOLVE` paths and joins
   the same receipts; and
7. cleanup removes the unique Windmill project/workspace, PostgreSQL state, network, ingress allocation, and every
   volume, then proves byte-for-byte or enumerated baseline equality, zero isolated residue, and zero shared-target
   change.

Until those gates pass, durable Composer custody, public API composition, typed Source Intake-to-Research handoff,
and the Windmill A2 topology remain `TARGET`. A production Market Data binding resolver, live OpenAlex
policy/rights/DNS/credentials/egress, `PRODUCT_CURRENT`, Dashboard implementation, Paper, Live, deployment, and any
trading effect remain unavailable and outside this acceptance authority. Passing the fixed-corpus, fixed-adapter,
isolated PostgreSQL/Windmill runner is `SEALED_ACCEPTANCE` evidence only and never production readiness.

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
The R&D Owner publishes next-action admission as a versioned typed projection: only exhaustively known actions are
`ADMITTED`; unknown and legacy actions are `NOT_ADMITTED`. Web and MCP consumers display that same projection and
must not infer authority from action names.
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
continues to resolve under that binding after cutover, without overlapping writes or a naked retry. If its first
downstream mutation was not yet receipted, it may proceed only after the immediate policy-equivalent successor is
`ACTIVE`, the original stored lineage still matches exactly, and the original Operator Authorization is current at
the final write cut. The zero-`ACTIVE` fence blocks this continuity, and every new admission still requires the
current `ACTIVE` head.

### Administrative bootstrap and control-plane writers

Product Edge is the sole writer of deployment bindings and heads, content-addressed operation manifests,
immutable request admissions, and its outbox. A separately named **Operator Authorization Issuer** is the sole
writer of authorization issuance and the revocation frontier. It is a distinct control-plane writer behind the
Product Edge boundary, not another business Owner or a Product Edge admission helper. Product Edge direct-resolves
its facts and cannot write them; Windmill, the API, R&D, configuration, and possession of a token cannot issue an
authorization.

Both writers use separate PostgreSQL roles in the same authority database. A request-admission transaction locks
the exact issuance and current revocation frontier for shared read before writing the admission. Issuance or
revocation takes the conflicting update lock. The committed serialization cut is therefore enforceable across
the two writers without a third verifier, cache, Event Store, or copied caller assertion.

The first deployment binding is created only by an explicit one-time administrative bootstrap. Bootstrap is
forbidden on service start and on every product request path. It verifies complete empty binding and head history,
requires expected head `EMPTY`, generation one, a finite validity interval, content-addressed manifests, and a
pre-issued current Operator Authorization. Binding, head, manifest receipts, and outbox commit atomically. Exact
replay joins the original bytes; changed meaning and concurrent losing genesis attempts conflict with no partial
write. A successor is a separate administrative cutover: the exact predecessor's `SUPERSEDED` fence commits first,
then and only then may a policy-equivalent successor become `ACTIVE` at generation plus one.

### Expired manifest recovery epoch

An ordinary authorization or deployment successor is admissible only while its exact predecessor remains current at
the commit cut. Once the manifest interval has expired, renewal cannot use that path. The only forward path is an
explicit `ExpiredManifestRecoveryEpochV1` bound to the exact Operator Authorization issuance head and revocation
frontier, the exact Product Edge deployment head and generation, and the complete prior and successor manifest sets.
It is never a rollback, a second genesis, a service-start action, or a request-path fallback.

The recovery command accepts only a content-bound PostgreSQL target naming the exact authority database, PostgreSQL
system identifier, Operator Authorization role, and distinct Product Edge role. Before either Owner write, it opens
both supplied endpoints read-only and requires `current_database()`, `current_user`, and `pg_control_system()` system
identifier readback to match that target and to prove both roles reach the same database cluster. Any absent, empty,
same-role, ambient-default, or cross-spliced binding fails closed without an Owner write; URLs and secrets are never
logged.

The epoch enumerates every manifest semantic key exactly once as `RETAINED`, `ADDED`, or `REMOVED`, with the exact
old and new content-addressed bindings applicable to that disposition. A retained manifest may only narrow allowed
effects and must preserve every prior prohibited effect. An added manifest must remain inside the unchanged
principal, audience, Operator Authorization scope, request proof, scope policy, and audit policy; it must preserve
the immutable `LIVE_TRADING_V1`, `REAL_TRADING_V1`, and `PROTECTED_FEEDBACK_DETAIL_V1` prohibition floor and cannot
name a live or trading target or allowed effect. Removal grants no successor authority. The capability-policy version
may change only when the content-addressed epoch contains an addition or removal, and every successor manifest binds
that exact version. Omitted, duplicated, cross-spliced, stale, or differently interpreted transitions fail closed.

Recovery is intentionally two-owner and forward-only. The Operator Authorization Issuer first appends or exact-replays
OA2 after locking the expired issuance head and current frontier; OA2 alone is not Product Edge request authority.
Product Edge then verifies that canonical OA2 at its own cut, irreversibly appends the exact B1 `SUPERSEDED` fence,
enters a zero-`ACTIVE` fail-closed interval, and atomically appends B2, its manifests, receipt and outbox while advancing
the deployment head by compare-and-swap. A crash after OA2 or after the fence resumes only through the same epoch and
same complete bytes; a changed epoch conflicts. This protocol does not claim cross-Owner transaction atomicity and
never rewrites OA1, B1, prior manifests, admissions, receipts, outbox events, or downstream Owner facts. Requests that
were never admitted under B1 must use a new identity after B2 becomes current; recovery cannot bless or complete them.

The local API token is only opaque request proof. Bootstrap binds its digest without logging or publishing the
secret, and request admission compares that proof against the canonical issuance and binding. Environment values,
defaults, a same-object comparison, or a valid transport session cannot supply principal, scope, issuer, audience,
authorization, manifest, deployment head, capability, or audit authority.

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

Product Edge persists that complete tuple as one immutable Request Admission before any R&D mutation. The
admission additionally binds the canonical typed-payload digest, operation schema, target Owner, allowed and
prohibited effects, time evidence, request-proof digest, and audit correlation. R&D receives only an opaque
admission locator and direct-resolves the complete canonical bytes under lock; a locator, serialized readback, or
caller-computable digest is not authority. Same request and meaning join the original admission, while changed
meaning or a changed authority cut conflicts without a downstream write.

Superseding a deployment binding never rewrites an admitted request; its original binding, head, authorization,
frontier, manifest, and cut remain directly resolvable. Authorization expiry or revocation likewise never rewrites
an admission or an already committed downstream Owner receipt. If no downstream custody has committed, current
expiry or revocation forbids first submission. If R&D already committed a receipt or prepared attempt, recovery may
resolve or terminalize that custody, but a new provider or effect invocation requires one durable, one-use
invocation admission serialized against the then-current authorization frontier. Response loss after that claim
never permits a second invocation. Product Edge durably separates the claim from `INVOCATION_STARTED`; once the
start fence commits, missing provider idempotency or authoritative provider readback yields `OUTCOME_UNKNOWN` with
manual reconciliation only. Automatic recovery across that window and `ACTUAL_PROVIDER_CALL_AT_MOST_ONCE` remain
`NOT_ADMITTED`; the start fact never proves that the provider ran or returned a result.

Environment-authorized legacy rows have no Product Edge admission and are never backfilled. Terminal legacy rows
are read-only and quarantined, an identity collision fails closed, and the R&D API refuses activation while any
legacy nonterminal S2 attempt remains. Missing, dual, stale, malformed, expired, revoked, wrong-issuer,
wrong-audience, cross-principal, cross-scope, proof-mismatched, manifest-mismatched, digest-mismatched, or mixed-cut
authority returns `SUBMITTED_OR_UNKNOWN` and creates no Product Edge admission, R&D/Qualification/TrialFamily/
attempt/Artifact write, outbox, or provider call.

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
