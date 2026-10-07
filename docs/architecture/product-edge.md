# Product Edge

<Callout type="info" title="Client boundary, not another service Owner">

Read deployment and domain tools before exact protocol details. The client admits requests and displays results; each domain owns jobs, facts and refusal states. Compatibility transports do not change the approved user journey.

</Callout>

## Responsibility

Product Edge is the protocol and application boundary for bounded requests and result views. The target research
entry is a set of MCP services: Market Data and Backtest extend the current Nautilus modules; R&D is the custom
research service. MCP translates typed requests and identities, without becoming another data or trading engine.
The [capability extension map](./capability-adoption/) defines this foundation and its internal responsibility boundaries.

<a id="product-surface-and-package"></a>

## Product surface and deployment

The [service architecture](./index/) defines target users, markets, strategies and shared-account portfolios, and the derivatives-first, spot-later delivery order.
Deterministic jobs remain owned by the service behind each MCP, not by the caller session. R&D may call the
services through internal typed APIs; external agents choose research hypotheses and iterations. Product
correctness requires neither an embedded model nor a particular agent vendor. Users submit research directly
to their external Agent, which initiates and advances it through MCP.

Dashboard shows progress, evidence and results and provides activation confirmation, policy configuration and
operation controls. Research views are read-only; Dashboard does not initiate, pause, resume or terminate
research, or dispatch/control the external Agent. Product services do not provide a remote-control channel to
local Codex/Claude conversations. The target backend and web Dashboard run on the server; local development
remains supported. Local Agent/PC availability is not the lifetime of server data/backtest jobs or authorized
strategy operation.

Already admitted work continues under its existing bounds while the server is available; new research
orchestration waits for the external Agent. Resuming callers resolve original job/request identities before
issuing successor work. Six responsibilities do not require six processes.

The existing Compose package and Dashboard preview below are current implementation inventory, not proof that
this target service architecture has shipped. Deployment and real-money admission remain separate gates.

**Current Dashboard preview.** The UI entry is `product/dashboard`: one independently buildable
`trade-dashboard` image carrying the Vibe-derived shell, the shared UI atoms, and the currently admitted
first-party read surfaces. It owns its browser session gate, the Trade-owned RunStore, and four
least-privilege process roles - `dashboard-web`, `dashboard-effect-worker`, `dashboard-shadow-worker`, and
`dashboard-shadow-scheduler`. `/api/mcp` is a stateless Streamable HTTP endpoint over the same typed
handlers. It sits outside the browser-session gate but requires its own finite, scoped Bearer capability and
validates Host and Origin before dispatch.

Its fixed tool registry carries only Source/Research action, the Develop Composer and Replay V2
request-custody actions, exact run detail, and bounded run-log reads; it exposes no arbitrary script,
database, shell, or administrative tool. External conversation clients are optional consumers: they are not
bundled product shells, business authorities, or implementation-acceptance dependencies.

The Dashboard and its MCP endpoint invoke one curated set of versioned operations over typed Owner ports. They
may not call arbitrary Owner SQL, mint business facts, or keep a shadow workflow truth. The Operations APIs
read only Trade-owned operational RunStore data; typed R&D and Backtest reads use their exact Owner contracts.
They never copy operational run rows or raw Owner payloads, and operational completion is never reinterpreted
as business success.

A live strategy loop, market session, order state machine, and recovery effect remain owned by Trade Runtime,
Risk, and Execution, which also owns Recovery; the product surface may supervise and display them but is never
the trading runtime.

**Current deployment state:** every Dashboard service starts only under the opt-in `dashboard-preview` profile, the
image tag defaults to `preview`, the web host port defaults to `127.0.0.1:3100`, and the runtime roles expose no
host port. **There is no production deployment.** The Dashboard effect worker is disabled by default, holds only
explicit disposable-local authority, and carries no production trading authority.

**Deployment package.** `product/rd-workbench` packages Postgres, Owner APIs and the custom Dashboard.
Windmill is not a deployed dependency. Domain MCP workspaces are independently buildable and use their own service
contracts. Historical sealed wire spellings retain their meanings; they do not select an active executor.

Routes below the bilingual `DRAWABLE_EXACT` gate remain navigation-only placeholders; a route name or a retained
source is not implementation authority. Production deployment remains `TARGET`. Dashboard
reachability under the preview profile or an MCP handshake does not make the
product surface `CURRENT`; acceptance requires the bounded user journeys, common operations, Owner receipts,
unresolved states, and direct browser evidence defined below.

## Agent-outside R&D authoring

Users initiate research through their chosen external Agent. Agents write native Nautilus Strategies, propose experiments, interpret results and decide iterations.
The product makes no model calls and builds no scientific decision interpreter. R&D seals source/parameters/dependencies/data requirements and retains experiments, budgets and evidence; see [R&D](../owners/rd/) and [native packages](./strategy-factory/).

MCP only adapts Owner APIs, carrying requests/permitted results, not model entitlements, credentials or protected samples.
New content creates a new version; unknown outcomes remain `SUBMITTED_OR_UNKNOWN` and resolve the same request, never overwrite Artifacts or guess by rerunning.
Mechanically valid research requires neither fixed diagnosis categories, a unique winner nor platform approved metrics.

Dashboard reads research facts and Agent explanations with explicit authority for sources, summaries and run state.
Browsers do not compile/run source, edit/overwrite packages or control the user's local Agent.
Existing read only source slices retain their exact admission; native package views need accurate Owner projections and cannot infer wiring from an existing Wasm preview.

### TARGET - External agent tool surface

This section records the domain-tool target and the bounded slices already present. The full
[Research scenario](../scenarios/research/) remains a target; a server handshake or an isolated authoring run does
not prove that journey.

The custom Dashboard is the product UI. Compatibility identifiers such as
`WINDMILL_PRODUCT_EDGE` in existing custody/routing contracts do not describe an active Windmill deployment.
The external agent composes domain MCP tools; a `backtest.run` is still one server-side job, not fifteen agent
steps. Internal service calls follow [one-way layering and value passing](../guide/architecture-rules/#owner-layering-and-inter-owner-trust).
Strict input trust verification occurs at the outer boundary; internal consumers do not reread upper layers to
verify their values. Budget enforcement, holdout isolation and unknown-result handling remain mandatory.

**Implementation entry points.** Dedicated stateless stdio servers exist at
`services/market-data-mcp`, `services/strategy-authoring-mcp`, and `services/backtest-mcp`, with local deployment
wrappers under `product/rd-workbench`. The Dashboard also retains its `/api/mcp` surface. Current acceptance and
limits belong to the relevant Owner pages; this inventory establishes neither deployment nor operation-level CLI
parity.

**Service shape.** Each domain MCP connects to its owning backend. [Capability adoption](./capability-adoption/) defines native extensions and custom responsibilities; the call boundaries follow.

- Market Data MCP exposes the extended native data service; Backtest MCP exposes the extended native backtest
  service. R&D MCP exposes research admission, authoring, experiment tracking and decisions. The current
  `strategy-authoring-mcp` inventory does not by itself prove the full target R&D service.
- R&D consumes data and backtest through typed internal APIs. MCP transports are external interfaces, not
  internal service dependencies. Deterministic data preparation and job dependencies belong to the services;
  the external agent owns research choices within frozen boundaries.
- Data passes by reference, not through the agent. The consuming service resolves and records the exact
  admitted custody. Job identities, status and results persist beyond an MCP disconnect.
- All entry paths, including direct Backtest MCP calls and internal R&D calls, enforce the same scopes and
  refusals. Research trials require registered admission and count against the frozen budget and trial ledger;
  unknown attempts remain counted and resolve by the same identity rather than blind retry.
- Native execution/cache/portfolio retain trading truth. Research and custody extensions add their own
  explicitly assigned records, not an independently advancing mirror order book or account ledger.
- Shared framework code does not combine credentials, protected caches or database permissions. Protected
  reads and bounded public verdicts remain enforced inside the services, not only at MCP dispatch.
- CLI parity, where provided, uses the same typed service operations and checks; it is not evidence that the
  complete research journey is implemented.

**CURRENT T0/U1 compatibility surface.** The dataset description, timeframe whitelist and full-window minute backfill below retain the current bounded protocol. Target preparation binds complete 1m execution input and native subscriptions/aggregation, without drilldown or local precision switching; data corrections form immutable successors for complete native replay. The current list is not the target timeframe ceiling.

**`dataset_ref`.** A plain description of one slice of market data: the instrument, the execution timeframe (`1w`, `1d`, `4h` or
`1h`) and the half-open range `[start, end)` in event nanoseconds. It is not a token anything issues: the agent writes
it from what `coverage` reports. The service that consumes it resolves it inside Market Data's custody at the moment
it runs, and refuses it by name when that custody does not cover it, as `DATASET_REF_UNRESOLVED`, or when the
timeframe is not an execution timeframe, as `TIMEFRAME_UNSUPPORTED`. The custody the run resolved is recorded with
the run, so a replay reads the same data.

**`market-data`**, served by Market Data:

- `list_instruments()` → the admitted instruments.
- `describe_instrument(instrument)` → tick size, lot size and the current economic terms (fees and margin), or
  `INSTRUMENT_UNKNOWN`.
- `admit_instrument(symbol)` → the admission receipt for the venue symbol (such as `BTCUSDT`), which Market Data maps
  to its canonical instrument, or the admission refusal by name.
- `backfill(instrument, timeframe, range)` → a `job_id`. `timeframe` is the execution timeframe, `1w`, `1d`, `4h` or `1h`, and the
  `1m` bars the fills read are backfilled with it; any other timeframe is `TIMEFRAME_UNSUPPORTED`. Other refusals:
  `INSTRUMENT_UNKNOWN`, `RANGE_INVALID`.
- `job_status(job_id)` → the job's state, one of `QUEUED`, `RUNNING`, `SUCCEEDED` or `FAILED`; the coverage it added
  once `SUCCEEDED`; and the cause by name once `FAILED`. An unknown job is `JOB_UNKNOWN`.
- `coverage(instrument)` → the covered ranges for each timeframe.
- `get_bars(instrument, execution_timeframe, range)` → the bars, inline and bounded. Refusals: `RANGE_NOT_COVERED`,
  `RANGE_TOO_LARGE_FOR_INLINE`, and `HOLDOUT_PARTITION_UNDEFINED`. A backtest never reads through it: it takes a
  `dataset_ref`.
- `get_funding(instrument, range)` → funding rates, under the same bound and refusals.
- Until Qualification registers its holdout partition with Market Data, by value and downward, both tools refuse every
  request as `HOLDOUT_PARTITION_UNDEFINED`: the answer before registration is refuse all, never allow all.
- Every tool that returns market values appends its read to Market Data's agent data-read ledger in the transaction
  that answers, and refuses when it cannot ("Agent data-read ledger" in [Market Data](../owners/market-data/)). Trial
  rows stay with R&D, whose census reads Market Data's ledger downward.
- Accepted on its own when an agent can list, describe, admit, backfill and read one instrument end to end against a
  disposable store, with each refusal driven once.

**`strategy-authoring`**, served by R&D:

- It belongs to R&D's authoring layer (Strategy Artifact): it authors, compiles and checks, and keeps immutable
  versions. It does not register a qualified strategy or own its lifecycle and capital, which is Strategy Governance
  and a later `governance` server, and it does not run anything, which is Runtime.
- **CURRENT bounded catalog:** `spec` accepts either a single-threshold statement or a JSON document with language
  `research.strategy-authoring.v1`, as the tool's advertised input and R&D's closed `StrategyStatementV1` define.
  Each family keeps its own canonical content/hash domain independently of Research identities. This authoring
  surface does not establish complete R-1 execution.
- **TARGET native strategy integration:** Agents submit Nautilus Strategy source, parameters, dependencies and data requirements; R&D checks mechanical bounds and seals content/environment.
  R-1 expresses resting entries, invalidation, protection and staged exits through native order APIs. Missing interfaces are integration/extension gaps, not another JSON language or BFP/Wasm compiler.
  The six current statement tools do not prove package submission exists; admit native integration as a minimal vertical slice. See [R&D](../owners/rd/) and [package contract](./strategy-factory/).
- `validate(spec)` → `VALID`, or every violation by the authoring compiler's own name, writing nothing.
- `create(spec)` → `strategy_id`, the content digest of the canonical spec. Creating the same spec again returns the
  same id.
- `get(strategy_id)` returns the spec byte for byte; `list(filter)`.
- `revise(strategy_id, spec)` → the new spec's `strategy_id`, recorded as naming its predecessor; nothing is edited in
  place.
- `archive(strategy_id)` appends an archive record. The strategy stays readable and can no longer be run.
- Accepted on its own when, using only this server and no market data, a spec is validated, created, read back byte
  for byte, revised into a successor and archived, with every refusal driven once.

**`backtest`**, served by R&D's run route, which calls Backtest:

- **CURRENT bounded route:** `run(run_id, strategy_id, instrument, execution_timeframe, window_start_ns, window_end_ns_exclusive)` is the existing single-threshold route.
  It forms a goal inside the run. That shape is a limited authoring-to-report slice, not preregistration for an
  autonomous research family, and must not be described as the full research loop.
  Current tools accept neither `dataset_ref` nor `cost_profile`; execution occurs within one call. Advertised schemas define exact arguments.
- **TARGET research route:** a versioned run request also names an already frozen Research Intent and its admitted
  trial. R&D checks the Artifact, scope, execution semantics, cost profile, predecessor data reads, and resource
  allowance before dispatching a deterministic job. It cannot invent a hypothesis after reading results. Requests
  and failed or unknown attempts remain counted; exact retries join the same request.
- Submission returns a durable `run_id`/job reference; `status`, `list`, and `report` observe it later. The
  serving domain owns job execution and recovery, so the MCP process or agent session can end without losing it.
- `report` binds native Result identities and states data coverage, event-order resolution, fees, funding,
  slippage, margin and capacity assumptions. Portfolio return, drawdown, exposure overlap, and holding/cash
  comparisons are primary; optional random-entry controls and per-trade diagnostics help the Agent explain causes; no automatic control replay is a report prerequisite. Exploratory detail is
  readable, protected Qualification detail is not.
- Before a protected partition exists, reports explicitly remain exploratory and cannot establish independent
  qualification. Once registered, overlapping research reads and runs are refused as `HOLDOUT_WINDOW_OVERLAP`.
- Full acceptance is the R-1 journey in the Research scenario, including session restart, losing and failed
  trials, and native readback. Single-threshold report acceptance remains a smaller current slice.

**`research`**, served by R&D (TARGET for V0.2 research management; V0.1 retains minimal registered experiments):

- Registration freezes the Agent experiment proposal, comparison goals, source package, data scope, configuration, resources and approved policy before outcome data is read.
  R&D records actual admitted tasks and parameter groups; caller reported counts do not prove a complete census.
- The response binds the Research Intent, permanent TrialFamily, and census frontier. A family can have successor
  Intents, so hypothesis, family, and each experiment are not flattened into one identity. Prior data reads are
  checked through Market Data's ledger and complete predecessor lineage; existing knowledge can motivate a new
  experiment, but previously seen outcomes cannot be relabeled as independent validation.
- The agent may open a new mechanism family within the user's frozen theme and resource allowance. A protocol or
  scope change outside that mandate needs a new user request. Each round proposes diagnosis and a successor or
  stop; only R&D admission creates its Iteration Decision.
- `list_trials` and `census` resolve every admitted attempt, its native run/report references, outcome category,
  and count, including failure and unknown. Trial count and resource spend are distinct; legacy trial-budget
  fields remain legacy facts until their documented migration, never a new spend report.
- MCP transport does not write Owner storage directly. Every write invokes the existing R&D operation and receives
  its native receipt. A missing producer or readback is an implementation dependency, not something the MCP
  adapter fabricates.
- Protected values, verdict reasons, and per-trade protected records remain inaccessible. Public
  `CLOSED_NOT_QUALIFIED` does not close a research mechanism. Exploration diagnostics are available through their
  native Result references.
- Acceptance registers an experiment, rejects an invalid preregistration, runs its frozen Artifact, and reads
  the complete attempt and Iteration Decision back after a session restart, without any protected detail.

**Composition inputs and readback (TARGET).** `research` registers sealed multi-strategy composition experiments;
`backtest` admits their members and shared account configuration; `qualification` accepts independently selected
compositions and returns bounded eligibility; `governance` lifecycle requests reference exact composition eligibility
and user confirmation. Status/results distinguish member from composition eligibility and expose composition
identity and assessment scope. A single `strategy_id` request is not implicitly a member list. Reuse existing MCP/API
capabilities: extend input and evidence shapes without another server or direct trading tool.

**Additional domain API catalogs (TARGET; not separate server requirements).** These group existing Owner capabilities, not mandatory separate departments
or processes; the [service blueprint](./) defines their composition. Each remains a blueprint until its operation contracts pass.

- **`knowledge`**, served by R&D's knowledge ledger: `family_status`, `record_conclusion` and
  `check_before_research`. Red line: entries are append-only and hold no protected value. Construct search returns
  exact rule versions, applicability, evidence grades and counterexamples. Positive findings and negative conclusions
  are retained alike; reuse enters a new Intent without inheriting strategy eligibility. See the
  [Research knowledge ledger](../owners/rd/#knowledge-reuse).
  `docs/plans/research-knowledge-ledger-seed.md` is a draft first-entries import from `research/ronnie`
  (constructs, mechanism statuses, the development-only leak rule) for whoever builds this server next.
- **`qualification`**, served by Qualification: `submit_candidate`, `status` and `verdict`. Optional `forward_register`/`forward_status` remain separately unadmitted and are not real-trial prerequisites. Red line: no holdout value ever leaves. Today Qualification projects every negative terminal
  byte-equivalently as `CLOSED_NOT_QUALIFIED`, so `verdict` answers `QUALIFIED` or `CLOSED_NOT_QUALIFIED`; the
  internal assessment may distinguish pass, equivalence to null and insufficient evidence; those categories remain protected. No public negative verdict closes a research mechanism.
- **On demand discovery** reuses direct Market Data queries and native Backtest replay for stateful observation.
  R&D retains research requests/result references as needed, without another observation Host or mandatory scan
  route. There is no scan schedule CRUD. Running strategies consume native live data continuously; results grant
  no activation authority. See
  [R&D discovery](../owners/rd/#on-demand-read-only-opportunity-discovery).
- **`governance`**, served by Strategy Governance: `list_eligible`, `request_trial` (exact version and user-confirmed real-trial policy), `pause`,
  `retire` and a read-only `capital_policy`. Red line: requests alone create no activation. The user approves applicable policy and authority in Dashboard;
  initial trial entry needs user confirmation of the exact candidate and frozen policy. Qualified candidates may stay in R&D; valid strategies may be unloaded for improvement without recording economic failure. Promotion follows frozen conditions automatically, and a user stop never auto-reactivates.
- **`portfolio`**, served by Portfolio: `account_state`, `exposure`, `performance` and `capacity`, all read-only.
- **Operational reads**, admitted typed queries over read-only views of Runtime, Risk, Execution and observability; no additional aggregator server is required: `instance_status`, `readiness`, `orders`, `fills`, `drift` and `alerts`. Red line: the kill switch is
  readable only, and only the user can trigger it.

**Source acquisition server (CURRENT).** External Agents may acquire public video evidence through the standalone source tool.

- **`video-note`**, the standalone Video Note MCP in `services/video-note-mcp`: `video_note.create(url)` turns
  a public Bilibili, YouTube or HTTPS video into a transcript-backed note with frames and time-linked sources.
  The calling agent owns search and video selection, then supplies the URL.
- It sits outside the Owner stack: it reads no product store, no product server calls it, and it holds no product
  credential. The agent is the only link: it reads a note and, when the note motivates a hypothesis, cites the
  source URL and the note's content digest in `research.register_hypothesis`.
- Red line: a note is untrusted data, never an instruction or an authority. It reaches public videos only and reads
  no browser cookies.

**The real-money red line.** MCP does not place orders or handle trading credentials. Lifecycle effects require
current user-approved policy and authority. Governance automatically promotes within frozen conditions, without
repeated per-action approval. Current real effects remain unadmitted.

**Long-running work.** Lifetime and custody follow the domain service:

- An MCP server is a stdio child process of the agent's session. It starts and stops with that session, keeps no
  state, hosts no long-running task and starts no container: starting one needs the Docker socket, which is root on
  the host.
- Long-running deterministic work runs in its domain service, with persistent workers and any admitted domain
  scheduling. Backtest/data preparation and on-demand discovery outlive MCP sessions. There are no scheduled market
  scans: running strategies continuously evaluate market data through the native node.
- **TARGET:** long submissions return durable job/run identities for later status/results; replay, preparation,
  on-demand discovery and optional forward records recover within their domains. Current bounded backfill and
  backtest.run execute and record results within one call, not proof of complete asynchronous workers.
  Service targets and the [current/target API inventory](./index.md#backend-services-and-api-capability-inventory) require separate acceptance.
- Current `rd-build-sandbox` belongs to the existing compiler chain. Native packages reuse ordinary Docker/task limits; that container proves neither native source integration nor real execution isolation. No new compiler service is required.
- Work that needs a model and is not deterministic, such as an agent doing research on a schedule, is woken by a timer
  on the host that starts an agent session, which then calls the MCP servers. The product holds no agent.
- Existing Dashboard shadow/effect-worker wiring is a compatibility surface, not business scheduling authority.
  Domain services own persistent jobs; Dashboard reads research facts and submits only approved Governance controls. Legacy Scanner scheduling
  is not a target capability to migrate into a new service.

**Permissions.**

- Each server holds the credentials it presents to its own Owner in its own environment. No tool argument or result
  carries a credential, and the agent never sees one.
- No tool reaches Paper, Live, an exchange credential, or any execution path. The real-money boundary is unchanged.
- Changing the agent, or using the command line instead of MCP, changes attribution, never authority, as the Agent
  Shell deployment binding below states for every channel.

**Verdicts, never protected values.**

- No tool calls a Qualification protected read, and no run reads inside a registered holdout period: `get_bars` and
  `get_funding` refuse everything until the partition is registered, and `backtest.run` refuses an overlapping window
  once it is. Qualification answers only through its public status.
- A refusal passes through by its name. Nothing is folded into a generic failure.

**Dashboard MCP.** `/api/mcp` is a bounded preview-operation channel, not the external research agent's domain
entry or a research-tool aggregator. Its retained compatibility tools are Source/Research, Develop Composer, Replay V2 request
actions and exact run/log reads, using the existing typed handlers and admission. Those research actions are not admitted as the target Dashboard research route; its research views remain read-only. It exposes no Artifact
Formation preflight/action or internal model-build tool.

## Typed Owner requests

Clients submit stable request identity, exact content, principal, scope and the authorization required by the operation to its domain API. That service validates permissions, validity, revocation, input versions and idempotent meaning at the outer boundary; internal calls pass verified values. MCP names, natural language, client configuration and transport success confer no business authority.

The same identity and meaning join one request. Changed content, scope or authorization meaning under that identity is rejected. Unknown outcomes remain `SUBMITTED_OR_UNKNOWN` and resolve the same Owner receipt, never a new request used to guess success. Expiry/revocation blocks uncommitted new effects without rewriting committed facts; recovery only resolves original custody and grants no new invocation.

Unattended trading additionally requires explicit Autonomous Policy Authorization bound to strategy version, generation, account/effect scope, allowed actions, capital policy and effective interval. Governance, Runtime, Risk and Execution preserve that lineage; missing, expired, revoked, cross-scope or mixed-version evidence and unknown effects block new risk. Services resolve opaque least-privilege credential handles; secrets never enter requests, artifacts or logs.

The existing request entry still enforces exact deployment binding, history head, operation manifest and Product Edge admission. Its refusals remain; legacy rows are not backfilled and quarantine/replay fences are not lifted. Native domain APIs need not rebuild a Shell-history database.

The one-to-two-instrument `ProductEdgeResearchGoalRequestV3` is a narrow existing slice, not the product research ceiling. Target requests explicitly bind a complete instrument set, data requirements and versions, including research across dozens of instruments. They invent no defaults and claim no unimplemented batch capability.

## Read-only views

Every Product Edge read model is a bounded Owner projection, never a shadow store. Its common envelope binds a
stable read-request identity, trusted principal, exact authorized scope or account and Execution Scope,
authorization-policy identity and cut, source Owner, complete authoritative source frontier or snapshot cut,
observed/projection time, freshness, and valid-through time. The availability outcome is explicit:
`AVAILABLE`, `STALE`, or `UNAVAILABLE`; a model with a stricter completeness
state may additionally fail closed. Replaying one request at one source cut returns the same projection
identity.

A newer source cut creates a successor view, while cross-principal, cross-scope, cross-account, cross-mode,
stale-policy, expired-time, or same-request conflicting replay returns no cached view and creates no Owner
transition.

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
Execution Scope. `AVAILABLE` returns exactly one `UNKNOWN_EFFECT`, `NO_EFFECT`, or
`SETTLED` projection with the attempt, account, mode, effect namespace, Effect Journal frontier,
readback/reconciliation cuts, blocker, responsible Owner, projection cut, and valid-through. Missing or stale
policy, cross-principal/account/mode, changed request meaning, or mismatched case/fence returns no view. If
the source frontier or authoritative readback is unresolved, the same request remains `UNAVAILABLE`
rather than inferring closure.

Exact replay at the same source cut joins the same projection; a newer cut creates a successor view. Product
Edge may explain progress from this view, but only the committed Execution and other source-Owner facts
establish effect or Recovery state, and Research never consumes the view as provenance.

## Product closure and application layer

A product closure exists only when a user can carry one bounded goal from entry to an authoritative outcome and
its next legal action without manually joining Owner databases, receipts, logs, or terminal output. Product Edge
composes that journey from typed Owner requests, request-correlated receipts, and bounded read models; it does not
own the business transitions that the journey exposes.

The research journey links Agent sources and hypotheses to sealed native packages, registered experiments,
actual Backtest evidence and Agent explanations, selections or next steps. R&D persists those records without
requiring a fixed diagnosis pipeline, a unique successor or automated repair request. Dashboard displays the
same references read-only. Research submissions originate from external Agents through domain MCP; only admitted
Governance actions use Dashboard controls. An accepted task remains unknown until its owning service returns the
request-correlated terminal receipt; a visible button or operational status cannot advance business truth.

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

Historical ScheduledScanId/Scanner Receipt reads are legacy compatibility only: they require no new scan schedules,
deployment proposals or target activation prerequisite. On-demand discovery returns R&D observation jobs/results under
frozen Artifact/input cuts, authorized scope and explicit unknown outcomes.

Research and lifecycle admission requests close only through the receiving Owner's terminal receipt; an accepted
D-only admission remains distinct from its later R&D-owned D-only Repair Disposition. Product Edge shows a
strategy as running only from Runtime's Generation Application Receipt, never from Governance authorization alone.

Product Edge can request Research work, independent Qualification review, or exactly one canonical Strategy
Governance lifecycle action: `INITIAL_ACTIVATION`, `PROMOTION`, `REDUCTION`,
`PAUSE`, `RETIREMENT`, `DE_RISK`, or `RECOVERY`. Conflicts resolve
by `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION`; `PROMOTION` requires unattended policy plus fresh compatible Capacity View,
Performance, and Exposure evidence under its own evidence key. It may read Research View, Portfolio View,
exploratory Backtest results, bounded Qualification Status Summaries, the sole terminal Scanner Receipt for
each ScheduledScanId, and bounded Governance Decision Views.

A Research View shows terminal stops only from Iteration Decision and shows Selection only when the
selected-only `SELECTED_FOR_QUALIFICATION` disposition exists. Intake status preserves the write-once
`NOT_ADMITTED` or `ADMITTED` receipt; `EVALUATING` is a derived summary of an
`ADMITTED` receipt plus a protected request in progress or unknown, not an Intake Receipt state.
Every negative terminal protected outcome appears only as `CLOSED_NOT_QUALIFIED`; no internal replay,
diagnostic, assessment, or ineligibility reason is projected. A committed positive Eligibility Fact supersedes
the view phase as `QUALIFIED` without rewriting prior facts.

Product Edge reads the Scanner Receipt directly; it stores no competing Scanner-owned projection. The receipt
exposes exact completion state and one expected-set branch. A resolved branch contains exact expected,
observed, and missing members; an unresolved branch contains the authoritative unresolved-set disposition,
observed facts, missing-members-unavailable marker, and terminal reason. Only a complete `PROPOSED`
receipt includes exact proposal members; incomplete `FAILED` never claims a complete set.

Qualification and Governance views contain public state, conditions or policy bounds, effective interval, and
type-opaque non-dereferenceable committed fact references only; they never reveal protected measurements,
negative reason, or evaluation detail. A notification is never terminal proof.

## Prohibitions

It must not let the Dashboard, an MCP client, or a workflow become competing business writers, accept self-asserted operator identity, execute arbitrary
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

## Agent Shell deployment binding

Product Edge owns one non-business Agent Shell Deployment Binding for each deployment. The target binding
names the canonical `TRADE_PRODUCT_EDGE` admission gateway, which every admission sealed before that name
existed still carries as `WINDMILL_PRODUCT_EDGE`; App and MCP calls are channels behind that same gateway, not
competing shell writers. The binding records the selection generation, effective principal, scope-policy
version, approved Skill/MCP capability-set version, audit-policy version, and cutover epoch.

The channels may use different credentials, but the effective principal and policies are identical; changing
the external conversation client or transport changes attribution, never authority.

Every binding commit also binds the authoritative deployment-history head before and after the commit. Genesis
is valid only when that deployment has no binding history, uses generation one, and names no predecessor. Once
history exists, a successor must durably and atomically serialize against the exact current head, name that `SUPERSEDED` predecessor,
increment generation by one, use a strictly newer cutover epoch, and introduce a binding identity never used in
the deployment history. A zero-`ACTIVE` cutover window does not erase or reset the history head.

The only canonical binding states are `ACTIVE` and `SUPERSEDED`; `SUPERSEDED` is
monotonic and irreversible. A zero-`ACTIVE` interval is allowed during a fail-closed cutover, but
it admits no mutating Owner request; two `ACTIVE` bindings, a stale generation, or a policy
mismatch likewise admit no mutation. The exact predecessor must commit `SUPERSEDED`, which is its
durable request-origin fence, before the policy-equivalent successor can commit `ACTIVE`. Every
mutating request atomically reads and binds the authoritative history head, and admission requires the unique
`ACTIVE` binding to equal that head.

A request already admitted under a valid predecessor keeps its original request and binding identities and
continues to resolve under that binding after cutover, without overlapping writes or a naked retry. If its
first downstream mutation was not yet receipted, it may proceed only after the immediate policy-equivalent
successor is `ACTIVE`, the original stored lineage still matches exactly, and the original
Operator Authorization is current at the final write cut. The zero-`ACTIVE` fence blocks this
continuity, and every new admission still requires the current `ACTIVE` head.

Product Edge reads one clock. Every time it checks or records - a binding's genesis, a successor's activation
and its fence, an admission or a claim's read cut and final write cut, an invocation's start - is
`pg_catalog.clock_timestamp()` read inside its own transaction, never the application process clock. A binding's
validity window comes from the operator, who reads no clock on Product Edge's behalf, so genesis and every
later admission compare that window with the same clock. At an admission's cut the research window is checked
against the R&D Owner's `owner_cut` and projection time, which R&D stamps from the same database
clock, so both sides of each comparison come from one clock.

The research View's `valid_through` is not part of that window: it is a reader's freshness, and the R&D
Owner proves at each of its own mutations that the Research may still be continued under the authority it was
admitted under. Qualification holds the same authority for its Owner cut. The Operator Authorization Issuer
reads the same store clock for everything it judges or stamps: an authorization's issuance, revocation,
succession and expired-manifest recovery, and a grant's issuance, succession and revocation.

An authorization's window is judged by the Issuer at issuance and again by Product Edge at genesis and at
every admission; both judges read one clock, so no skew can leave a window current for one and not for the
other. Each call is schema-qualified so that no function reachable through `search_path` can take its
place.

### Administrative bootstrap and control-plane writers

Product Edge is the sole writer of deployment bindings and heads, content-addressed operation manifests,
immutable request admissions, and its outbox. A separately named **Operator Authorization Issuer** is the sole
writer of authorization issuance and the revocation frontier. It is a distinct control-plane writer behind the
Product Edge boundary, not another business Owner or a Product Edge admission helper. Product Edge direct-resolves
its facts and cannot write them; the executor, the API, R&D, configuration, and possession of a token cannot issue an
authorization.

Both writers use separate PostgreSQL roles in the same authority database. A request-admission transaction locks
the exact issuance and current revocation frontier for shared read before writing the admission. Issuance or
revocation takes the conflicting update lock. The committed serialization cut is therefore enforceable across
the two writers without a third verifier, cache, Event Store, or copied caller assertion.

The first deployment binding is created only by an explicit one-time administrative bootstrap. Bootstrap is
forbidden on service start and on every product request path. It verifies complete empty binding and head
history, requires expected head `EMPTY`, generation one, a finite validity interval,
content-addressed manifests, and a pre-issued current Operator Authorization. Binding, head, manifest
receipts, and outbox commit atomically. Exact replay joins the original bytes; changed meaning and concurrent
losing genesis attempts conflict with no partial write.

A successor is a separate administrative cutover: the exact predecessor's `SUPERSEDED` fence commits
first, then and only then may a policy-equivalent successor become `ACTIVE` at generation plus
one.

### Store provisioning order

A Product Edge store is provisioned in two ordered steps, and both run before any Owner connects:
`10-migrate-authority-custody.sh` creates the Owner's schemas and core relations and their grants, then
`product-edge-authority-bootstrap materialize-schema` creates the relations the Owner materializes itself (the
expired-manifest recovery epochs and the operation routing history). `connect_existing` runs no DDL and refuses,
with `TopologyNotAdmitted`, a store that lacks any of its fifteen relations. Both steps are idempotent, and the deployment package reruns both on every start, so an upgrade that adds a
relation provisions it before any service connects.

### Operation routing

Product Edge is the sole routing authority for the typed mutating operations a deployment admits. For each
routing key - the deployment identity, the typed operation, its version, and the admission gateway channel its
requests are sealed under (every admission today carries `WINDMILL_PRODUCT_EDGE`) - Product Edge keeps one
history of operation routing bindings. A binding names the dispatcher that is the fresh business writer for
that key: `WINDMILL`, the legacy effect runner, or `TRADE_DASHBOARD`, the first-party Dashboard
effect worker. Deployment flags and credentials never choose a dispatcher; only this history does.

A key's version is the operation name's `.vN` suffix (`research_goal.submit_or_resolve.v2` has version 2); a
key whose version differs from that suffix names no operation and is refused.

A binding records its key, its generation, its predecessor binding (none exactly at generation one), the
`ACTIVE` deployment binding it was committed under (identity and digest), the operation manifest
it routes (identity and digest; that deployment binding must admit the manifest for this operation and
version), its dispatcher, and its commit time on the store clock.

Its digest is `canonical_digest("product-edge.operation-routing-binding.v1", content)` over exactly these fields in this order: `schema_version` (1),
`key` (`deployment_identity`, `operation`, `version`, `channel`),
`generation`, `predecessor_binding_identity`, `deployment_binding_identity`, `deployment_binding_digest`, `manifest_identity`,
`manifest_digest`, `dispatcher`, `committed_at_epoch_ms`. Its identity is `identity("product-edge-operation-routing-binding-v1", [digest])`. The
Dashboard recomputes both from every observation it receives, so one shared vector file pins the encoding for
both implementations.

A routing key's history follows the deployment binding rules. Genesis is valid only for a key with no history,
at generation one with no predecessor. Every successor serializes against the exact current head, names it as
predecessor, increments the generation by one, and introduces a binding identity never used for that key. The
states are `ACTIVE` and `SUPERSEDED`, and `SUPERSEDED` is monotonic. Withdrawing
the head supersedes it without a successor; the key then has a zero-`ACTIVE` head, which the next
successor names as its predecessor.

A binding is stale once the deployment binding it names is no longer that deployment's `ACTIVE`
head; routing under a new deployment binding needs a routing successor committed under it. Only the explicit
administrative writer `product-edge-authority-bootstrap route` commits routing bindings, one proposal per invocation; no service
start or product request path does. Committing a `TRADE_DASHBOARD` binding in a deployed or shared
environment is the separate explicit effect the Dashboard contract names, and this contract does not authorize
it.

The read port is `GET /v1/operation-routing?operation=...&version=...&channel=...` with a bearer token, served by `product-edge-routing-read-api` and answering for
the deployment the service is configured for. It reads in a read-only transaction and takes no row lock. It
answers `ACTIVE` with the head binding and `observed_at_epoch_ms` from the store clock when the head
is `ACTIVE` and current, and `ZERO_ACTIVE` with the key, generation, and head identity when
the head was withdrawn.

Every other case is a named refusal: `OPERATION_ROUTING_ABSENT` (404) for a key with no history,
`OPERATION_ROUTING_STALE` (409) for a stale head, `OPERATION_ROUTING_QUERY_INVALID` (400), `OPERATION_ROUTING_UNAUTHORIZED` (401) for a
missing or wrong token, and `OPERATION_ROUTING_UNAVAILABLE` (503) for a store that cannot answer. The Dashboard admits a
fresh `RUN` only on `ACTIVE` with dispatcher `TRADE_DASHBOARD`; every other
answer fails closed there.

### Expired manifest recovery epoch

Expired-manifest recovery applies only to the entry already using this authorization store; it is not native research preparation. It binds the original authorization frontier, deployment head, successor manifest content, exact authority database, PostgreSQL system identifier and two distinct Owner roles. Mismatched endpoint readbacks permit no write.

Operator Authorization OA2 commits or exact-replays before Product Edge irreversibly fences B1 and compare-and-swaps B2. Partial completion stays fail closed; original requests, authorizations and facts are never rewritten. The same recovery identity resolves its existing result, never bypassing expiry/revocation or creating another effect. This interface grants no automatic recovery, default bootstrap, production write or trading.

## Sealed executor compatibility contract

### Executor capability contract

This section governs the **first-party executor path**, not the product entry, which the section above defines.
The product shell that once executed these effects is retired; `Capability Adoption` records where each of its
capabilities went. The boundaries below outlived it, because they constrain any executor, and they now bind the
Dashboard's effect custody.

| Executor primitive                | Product Edge role                                                                           | Mandatory boundary                                                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product application               | The Dashboard is the product entry                                                          | Authenticated operator execution only. Public, anonymous, and publisher execution are forbidden because they erase the caller's effective permission boundary.                                                                       |
| MCP endpoint                      | Optional conversation channel to the same versioned operation set                           | A scoped token exposes an exact allowlist, deny by default. It must not expose preview or create/update/delete tools for applications, scripts, resources, variables, schedules, or workers. Folder filtering alone is insufficient. |
| Typed adapters and orchestration  | Typed adapters and bounded orchestration over Owner ports                                   | They may route, wait, retry, and compose; they never write Owner storage, invent business state, or turn orchestration success into an Owner result.                                                                                 |
| Runs, progress, logs, and streams | Operational run identity, live progress, diagnostics, and UI streaming                      | An operational run ID, percentage, result, or log is not an Owner receipt. Operational retention is bounded, so durable research artifacts and outcome facts remain with Trade Owners.                                               |
| Schedules                         | Trigger admitted deterministic data, replay, report and maintenance work                    | A schedule is not a deployment registry, lifecycle authority, or live strategy runtime. Correctness uses an error path and same‑request resolution at the executor level.                                                            |
| Workers and workload isolation    | Queue‑backed execution and workload isolation by admitted role                              | Worker loss leaves the business result unresolved until the receiving Owner is queried.                                                                                                                                              |
| External agent tools              | Host agent submits and queries domain MCP operations                                        | Product runs no model; agent cannot write Owner SQL, mint lifecycle/risk permission or inspect secrets.                                                                                                                              |
| Connection config and secrets     | Typed connection configuration and opaque credential custody                                | Executor secret access is not Operator Authorization. Least‑privilege paths are mandatory; secret values never enter prompts, Owner requests, logs, artifacts, or receipts.                                                          |
| Operational state                 | UI preferences and explicitly rebuildable non‑authoritative caches only                     | Research lineage, receipts, Qualification, Governance, Runtime, Risk, Execution, and Portfolio truth, including Execution‑owned Recovery truth, are forbidden. Long‑lived artifacts use Owner storage or admitted object storage.    |
| Deployment versions               | Repository‑first source for the application, its operations, schedules, and resource schema | Deployed state is a projection of the repository. Promotion records the Git revision, image digest, schema versions, and rollback target as one compatibility cut.                                                                   |

Operator UI visibility is not an authorization boundary. The distributable MCP profile is deny by default: its
allowed tools are only the curated Product Edge operations plus read-only operational run reads. Application and
MCP calls bind the same operation version and semantic request; neither channel may deploy or edit the operation
it is currently using.

Unattended execution begins from a canonical due-slot identity and derives one stable Product Edge request
identity before the first Owner call. Retries, worker restart, timeout recovery, and manual resolution reuse that
identity and meaning. If the executor cannot prove whether an Owner accepted the call, the run stays
`SUBMITTED_OR_UNKNOWN` and a resolver queries the Owner receipt; it never submits a naked successor. Parallel or
overlapping schedule delivery is harmless only when the due-slot and Owner idempotency contract join the same
receipt. Flow error handling may notify and enqueue resolution, but only an Owner receipt closes the business
operation.

A due slot supplies an identity, never authority. An unattended submission is an ordinary mutating submission
and binds the same complete Authorization Lineage, including a current non-self-assertable Operator
Authorization resolved at that run's own cut.

The schedule, the due slot, the worker's role, its transport credentials, and its environment supply none of
those members, so an unattended run that cannot resolve a current Operator Authorization fails closed before
the first Owner call and creates no admission, run, or provider claim. **TARGET / NOT_ADMITTED:** unattended
non-trading execution stays closed until an issuance path for that authorization is separately specified and
admitted; unattended trading additionally requires the registered Autonomous Policy Authorization.

Artifact Formation uses a stable build-request identity and a stable attempt identity in addition to the
frozen Research Intent identity. Replaying the same semantic tuple joins the same Owner attempt; reusing
either identity for different semantics is an identity conflict. The exhaustive Owner dispositions are
`SUCCESS`, `FAILED_NO_ARTIFACT`, `REJECTED_NO_WRITE`, and `OUTCOME_UNKNOWN`;
`SUBMITTED_OR_UNKNOWN` is a query state, not a business disposition. Only `SUCCESS` atomically
commits a new immutable Artifact, Build Receipt, Artifact Review, and `ARTIFACT_AVAILABLE` projection. Every
other disposition has no Artifact.

Response loss after commit resolves to that exact receipt, while timeout before commit can only close unknown
without an Artifact. App and MCP invoke the same versioned Formation operation and never use operational run
state as a substitute.

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

#### Source intake and composition acceptance

Source intake, R&D authoring and replay require composed acceptance through current service contracts. A fixed
corpus or isolated database pass proves only that bounded chain, not provider authenticity, default deployment,
external effects, Paper/Live or trading. Isolate executor, database, network and volumes and prove baseline
preservation after cleanup. Response loss and restart resolve the same receipt without repeating completed effects.

#### Sealed Source Intake-to-Composer compatibility

Existing Source Intake/Composer read ports may resolve already sealed identities, but are not prerequisites for native strategy research. The native route uses Agent source references, R&D projects and Git Strategy packages; it adds no A0/A1/A2, ProgramHost or two-build pipeline.

Existing compatibility consumers retain exact source binding, equal request/meaning, one Owner writer, atomic receipt/outbox commit and same-identity readback after restart. Missing or conflicting evidence produces no positive result; historical bytes are not rewritten and legacy quarantine is not backfilled. These seals and refusals apply to actual compatibility entries and admit no new Composer, provider invocation or trading.

## Implementation acceptance

Changing the external conversation client or Product Edge transport preserves the same effective principal,
scope, capability and audit policies, and Owner authority rules. Tests prove exactly one selected admission
gateway, an allowed zero-active cutover interval, predecessor `SUPERSEDED` before successor
`ACTIVE`, irreversible supersession, rejection of dual writers or policy drift, per-request
admission against the exact authoritative head, and preservation of every already admitted in-flight request
identity.

Dashboard and MCP tests must prove that the same semantic request reaches the same versioned operation and
Owner receipt, while incompatible clients fail before a business write. Every mutating operation is typed,
attributable, replay-safe, and bound to a receiving-Owner receipt. Qualification review reuses the Candidate
Intake Receipt as that request-correlated terminal receipt and returns it independently of the bounded status
view. Same meaning alone never joins a receipt whose Candidate, attempt, state, result, or identity differs.
Accepted Research and lifecycle receipts bind the exact resulting fact; rejected receipts prove no write.

Runtime application remains visibly `APPLICATION_UNKNOWN` until Runtime proves `APPLIED` or
`REJECTED_NO_INSTANCE`. Natural-language ambiguity fails closed before any business write.

Read-model tests prove every view preserves stable request, principal, scope, authorization-policy cut, source
Owner, source cut, observed/projection time, freshness, valid-through time, and explicit availability status;
rejects mixed cuts, stale policy, conflicting replay, and unauthorized scope; and proves protected Qualification
detail, Risk headroom, or authorization cannot enter a projection.

Dashboard reads the bounded Owner and RunStore projections its admitted pages need. A global status projection is optional when a page needs it; if admitted, it retains projection version, source frontier, freshness and completeness. No global aggregation service is a prerequisite. A stale,
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
