# Trade Dashboard

## Bounded admission: read-only shadow schedule calendar

The user admits `/operations/schedules` as `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED` for the
first-party zero-effect shadow-read schedules only. This narrow exception supersedes the generic
blueprint-only classification for this route; it does not admit Scanner due-slot resolution or
Windmill generic schedules. Reuse `configuredShadowScheduleSetV1` and RunStore
`readBoundScheduledReads`: exact configured identity, digest, operation and dispatch bindings must
match every registered row (1-100). Missing configuration, registration or compatible custody fails
closed. GET is the only API action; no scheduler, registration, tick or enqueue occurs on reading.

The browser accepts positive data only from a successful HTTP response and a valid bound projection.
Refreshing with unavailable or rejected evidence removes prior positive rows and selected details.
Use UTC throughout. `next_due_at` and cadence describe **expected triggers**, not executions:
the scheduler may skip elapsed slots. Only the returned `last_due_at` and `last_run_identity` pair is
an **observed run**. Never infer older runs, completion, duration, success or Owner acceptance.

The route has one outer title header (`Shadow-read schedules` with its one-line purpose) and an inset
calendar body. Inside that body, the toolbar preserves the Vibe Journal source hierarchy instead of
replacing it with a Dashboard-specific control strip. The left identity group is Today card, month/year
heading with schedule count or unavailable state, then Previous, range label and Next. The right tool
group is Filter, one shared animated Agenda/Day/Week/Month/Year segmented control, operation selector,
Refresh in the source primary-action position, then Settings. The active view expands to its text label
while inactive views remain icon-only. The operation selector retains the source stacked-marker trigger
geometry, but derives markers only from returned operation identities; unavailable data creates no
placeholder marker. Filter contains local operation/identity search and observed/not-observed scope;
Settings contains compact density and Table mode. Controls horizontally scroll or wrap as one toolbar
on narrow screens. Default view is Month at the current UTC date. No separate summary strip, duplicate
Calendar/Table buttons or always-visible search field is inserted above the source calendar header.

Calendar fidelity preserves Vibe's date navigation, five views, event inspection, overflow expansion
and restrained transitions. Month uses a seven-column full-week grid with at most three summary
entries per day and an accessible overflow button. Day and Week show zero-duration trigger points
grouped by UTC hour, not invented duration blocks. Year shows twelve month tiles opening Month;
Agenda lists days in the selected month. Dense cadence is grouped arithmetically by schedule/day or
schedule/hour; expanding a group pages exact expected timestamps, 50 per page, without materializing
an unbounded event list. Observed records are separately labelled and link to existing Run Detail.
Calendar navigation must not execute a schedule. Today resets the date but preserves the active view.

Table columns are Operation, Cadence, Next expected trigger, Last observed run, in that order; default
sort is next trigger ascending then immutable schedule identity. Search precedes pagination (20 rows;
10/20/50 options). Selection opens the same detail as calendar selection. No column chooser, bulk
selection or per-header decorative icons. Headers remain sticky inside the bounded body scroller.
Details order operation/title, cadence and next expected trigger, last observed due/run link, then
collapsed technical identity/digest/recovery fields. No Run, Resolve, CRUD, drag or resize action.

At 1280px and above, calendar/table and detail use a 2:1 grid with 16px gap and a shared body height
clamped to 420-760px from the available viewport; both scroll internally. Below 1280px details follow
the primary card at natural height. Month and Week retain at least 700px internal scroll width below
768px; other views fit their card. Headers and footers use the same theme chrome token, with inset
body, subtle separators and restrained orange selection/focus. Icons use Lucide. Transitions last
140-180ms and respect reduced motion. Keyboard users can navigate controls, open/close overflow,
select entries and follow observed-run links without pointer gestures.

Loading occupies six 48px skeleton rows in the primary body; empty/search-empty shows one 160px
message without fabricated events. Unavailable, incompatible, malformed and denied responses use
that same bounded message region, a concise reason and Refresh; no stale positive detail survives.
Dynamic acceptance requires disposable PostgreSQL bound reads reaching the browser, mismatch/HTTP
failure rejection, distinction between predicted and observed entries, all five views, overflow,
keyboard operation, both themes and narrow/desktop layouts. Fixtures alone are not dynamic acceptance.

## Bounded admission: Backtest return-band presentation atom

`BacktestReturnBand` is a `TARGET_DRAFT / IMPLEMENTATION_ADMITTED` read-only presentation atom for
the already documented `/backtest` and `/backtest/compare` surfaces. Its source-fidelity reference is
Vibe Trading commit `48c8315f74536d9d308347d63ac9c4e96c9a7120`, tree
`d226b620dc699c9e8e382274434b324a5fefe0e1`, specifically the factor home daily-return band chart.
The Trade adaptation preserves the quantile min/max and Q1/Q3 bands, selected-strategy ink overlay,
month stripes or year dividers, draw-to-focus time window and reset, drawdown ceiling texture,
optional explicit benchmark, and external hover readout. It uses the shared Dashboard panel and theme
tokens, responsive measurement, restrained motion, reduced-motion behavior, and Lucide actions.

Positive rendering accepts only one exact, bounded Owner-projected result identity: canonical UTC
timestamps, ordered finite quantiles, strictly ordered points, and optional strategy and benchmark
series whose timestamps belong to the same cut. Unknown keys, malformed ordering, mismatched series,
stale carried values, or non-canonical time fail closed to zero chart data. A benchmark is shown only
when the projection supplies it explicitly; the browser must never derive a baseline from the band
median, synthesize returns, or import Vibe mock factor data. Loading, unavailable, valid empty, and
available data are distinct states.

This atom performs no Backtest dispatch, selection commit, comparison judgment, economic claim,
Owner resolve, provider call, or business write. No Dashboard route or admitted Backtest Owner resolver
currently supplies its positive projection, so component tests and static rendering do not establish
live data, deployed-browser acceptance, S3 availability, or Windmill replacement.

## Bounded admission: read-only strategy code viewer

`StrategyCodeViewer` is a `TARGET_DRAFT / IMPLEMENTATION_ADMITTED` presentation atom for the
`ArtifactReviewPanel` source/Wasm region. Its source-fidelity reference is Vibe Trading commit
`48c8315f74536d9d308347d63ac9c4e96c9a7120`, tree
`d226b620dc699c9e8e382274434b324a5fefe0e1`, specifically the CodeMirror 6 editor shell and read-only
code surfaces under `apps/web/src/features/lab`. The Trade adaptation keeps the real CodeMirror
line-number gutter, syntax highlighting, folding, text selection, bounded scrolling, file tab,
editor chrome, output pane, responsive layout, reduced-motion transition, and Lucide actions. It is
an editor-shaped **viewer**, not an editor: no content input, cursor, autocomplete, keybinding,
insert-cell, run, save, rewrite, commit, kernel connection, WebSocket, or AI action is present.

Positive rendering accepts only an exact bounded Owner projection containing artifact identity,
canonical observation time, one source filename/language/content/digest, and one explicit Wasm preview
state. Source is limited to 256 KiB and preview output to 64 KiB. Preview states are `not_run`,
`succeeded`, `failed`, and `unavailable`; only succeeded/failed carries an exact module identity,
target, canonical observation time, finite duration, bounded output, and bounded typed diagnostics.
Unknown keys, malformed times, invalid digests, oversized text, invalid positions, contradictory state
fields, or stale carried content fail closed to zero source and preview data. The browser never
generates sample code, executes source, synthesizes a Wasm result, or upgrades transport success to an
Artifact fact.

The only local UI action is Copy source. Folding, selecting and scrolling are presentation state and
cannot change the projection. The Wasm pane displays an already projected sandbox result; it has no
Run control and performs no module instantiation, network call, Owner resolve, provider effect,
business write, Windmill mutation, or trading action.

An `ACTIVE_OBSERVATION / IMPLEMENTATION_ADMITTED` detail slice may bind
`/rd/artifacts/{build_request_identity}/attempts/{attempt_identity}` to the exact authenticated Owner
GET `/v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/source`. The Owner may
return source only for one matching terminal-success custody after its stored attempt, candidate,
receipt, Artifact identity, source capsule, build recipe, deterministic Wasm and review have passed
the existing full custody verifier. It deterministically reconstructs the exact built Rust source,
binds a SHA-256 content digest and committed-at cut, and otherwise returns absent or unavailable; the
Dashboard additionally recomputes the content digest and rejects unknown fields, identity drift,
oversize source and malformed time. Until an exact sandbox preview readback is separately admitted,
the pane is explicitly `not_run` and carries no module, target or output.
The dedicated read port owns no mutation method. Its canonical read-committed transaction reuses the
existing full custody verifier, including the historical Product Edge admission read and row-lock consistency,
but creates no new admission and performs no timeout terminalization, sandbox invocation or database
write. This detail slice does not create an Artifact list, prove deployed availability or establish
Windmill replacement.

## Bounded admission: verified Research directory

`ResearchDirectory` is the exact `P` surface for `/rd/research`. The route uses one full-width `PanelFrame` and
does not reserve an empty detail column. Its frame header contains an eyebrow, title, one-line purpose, and one
`Refresh` action. The body contains one horizontal table toolbar with a `Verified / Custody candidates` segmented
control at the left and search at the right; `Verified` is always the default. The verified table has four plain,
left-aligned columns in this order: `Research request`, `State`,
`Intent`, and `Updated`. Column headings have no decorative icons and there is no View/column-chooser button,
registered/visible count, multi-level filter popover, row action, or backend-only field. The table header remains
sticky inside the bounded scroll viewport. Loading, valid empty, unavailable, and partial states preserve the same
card geometry; narrow layouts scroll horizontally rather than inventing a reduced mobile fact.

The authenticated Owner GET `/v1/research-goals/directory` returns at most 20 verified V2 request outcomes. It
considers at most 60 receipt candidates per page, ordered by `(committed_at_epoch_ms, request_identity)` descending
with PostgreSQL `C` collation for the bounded ASCII identity, and exposes the same tuple only as an opaque stable
`Load older` cursor. Each candidate is read in its own canonical read-committed transaction under `FOR SHARE` and
passes the existing complete Research custody verifier, including its stored request, receipt, frozen intent,
Research view, authority lineage, independence basis, protected-feedback projection, and TrialFamily custody.
Legacy or quarantined request schemas are omitted and make the cut explicitly partial. A malformed or changed
candidate fails the entire read unavailable; it is never treated as an empty successful page. The secondary
candidate view uses authenticated GET `/v1/historical-custodies`. Its dedicated Owner port opens only
`default_transaction_read_only=on` sessions and reads one bounded repeatable-read transaction. It returns at most
200 request identities with their custody time and the exact state `POINT_READ_REQUIRED`; it exposes no request
meaning, disposition, availability, receipt, authority, or current/legacy classification. Truncation is explicit.

The browser receives only request identity, optional intent identity, accepted or rejected-no-write disposition,
current Research-view availability and phase when accepted, and committed time. Rejected-no-write rows carry no
invented intent or view. Research goal text, sources, principals, policy, authorization, raw receipts, TrialFamily
payloads, ancestry, and storage fields remain withheld. Unknown wire keys, contradictory disposition/view fields,
duplicate identities, future or malformed time, invalid completeness/count, oversized response, transport failure,
or missing configuration all fail closed to `unavailable`.

`Refresh`, switching the local directory view, local search/sort/pagination, and `Load older` are the only actions.
There is no detail link in this
slice, and it cannot Submit or Resolve a Research request, create a successor, build or run an Artifact, invoke a
provider, mutate Windmill, write business state, or authorize trading. The broader selected-request detail and
action panels in the route registry remain future blueprint content.

## Bounded admission: verified Artifact directory

`ArtifactDirectory` is the exact `P` surface for `/rd/artifacts`. The route uses one full-width `PanelFrame` and
does not reserve an empty detail column. Its frame header contains the eyebrow, title, one-line purpose, then one
`Refresh` action. Its body contains one horizontal table toolbar with a `Verified / Custody candidates` segmented
control at the left and search at the right; `Verified` is always the default. Candidate mode adds one inline
`Attempts / Bindings` kind rail in the same row. The verified table has four plain, left-aligned columns in this
order: `Artifact`, `Strategy intent`,
`Verification`, and `Created`. Column headings have no decorative icons and there is no View/column-chooser button,
registered/visible count, multi-level filter popover, or backend-only field. Opening the Artifact identity navigates
to the exact read-only source-viewer URL. The table header is sticky inside the bounded scroll viewport; loading,
valid empty, unavailable, and partial states preserve the same card geometry. At narrow widths the table scrolls
horizontally; it does not collapse identities into invented mobile facts.

The authenticated Owner GET `/v1/artifact-builds/directory` returns at most 20 verified items. It considers at most
60 attempt candidates per page, ordered by `(prepared_at_epoch_ms, build_request_identity)` descending with
PostgreSQL `C` collation for the bounded ASCII identity, and exposes
that same tuple only as an opaque stable `Load older` cursor. Every candidate is checked in its own canonical
read-committed transaction by the existing full Artifact custody verifier. Only a terminal `SUCCESS` receipt whose
Artifact identity exactly matches its sealed Artifact Review is projected; the browser receives the build request,
attempt, Artifact, and strategy-intent identities, committed time, build target, and explicit `ADMITTED` build
security state. Nonterminal or non-success attempts are withheld and make the page explicitly partial. Any malformed
custody, database/verification error, unknown wire key, contradictory completeness/count, invalid identity/time,
oversized response, or transport/configuration failure makes the affected read unavailable; it never becomes an
empty successful page. The candidate view uses the same authenticated GET `/v1/historical-custodies` and read-only
Owner cut as Research. It exposes at most 200 attempt and 200 TrialFamily-binding identities, their custody times,
and only `POINT_READ_REQUIRED`. Counts are custody-index counts, never verified Artifact or valid-binding counts.
No Artifact outcome, binding validity, current authority, raw receipt, payload, or storage field is inferred.

`Refresh`, switching the local directory/kind views, local search/sort/pagination, `Load older`, and opening one
exact verified Artifact are the only actions. This
directory does not submit or resolve an attempt, build source, run a sandbox/Wasm module, invoke a provider, mutate
Windmill, write business state, or authorize trading. `WASM_PREVIEW_NOT_RUN` in the linked source viewer remains
unchanged until a separate real Owner-backed preview contract is admitted.

This chapter is the living implementation and phased-admission contract for the Trade-owned Dashboard. It defines
the product shell, information architecture, reusable UI system, and the current evidence-backed hypothesis for the
narrow Windmill capability set that the Dashboard may replace. The user has explicitly admitted bounded Dashboard
implementation and packaging under the exact contracts in this chapter. That admission
does not claim that a Dashboard service is merged or available, that the capability inventory is final, or that any
Windmill cutover, business acceptance, production write, provider effect, or trading action is authorized.

## Status vocabulary and evidence cut

- `CURRENT/PARTIAL` means a capability is merged on current Trade main and has real consumer evidence, while the
  complete Dashboard is still absent.
- `ACTIVE_OBSERVATION` means an exact Hub task is still implementing, dynamically accepting, or waiting on an
  explicit action required to prove a capability. Its evidence may revise this chapter, but it cannot establish a
  current product fact before merge and readback.
- `OBSERVED_CANDIDATE_NOT_CURRENT` means a capability or consumer-visible defect was observed in an active Hub
  task or worktree but is not a shipped product capability or a current fix.
- `RECOVERABLE_BY_RECONSTRUCTION_NOT_RESTORED` means exact surviving evidence may be sufficient for the canonical
  Owner to reconstruct lost facts, but no trusted backup restore or Owner reconstruction has occurred. The affected
  capability stays unavailable and no historical or positive action is inferred.
- `RESTORED_REVALIDATION_PENDING` means canonical Owner custody reconstruction and direct Owner readback succeeded,
  while downstream consumer revalidation has not. It is not `RESTORED`: stale facts remain unavailable at the
  current cut, and no positive action is enabled.
- `TARGET_DRAFT` means the current design expects the future Dashboard to provide the capability. The expectation
  remains revisable until the relevant real consumer flow is terminal.
- `IMPLEMENTATION_ADMITTED` means repository work may implement a documented `DRAWABLE_EXACT` route or reusable
  atom as a bounded, separately reviewable slice. It is permission to build and verify, not evidence that the slice
  is merged, deployed, accepted by an Owner, replacement-ready, or authorized to perform a production effect.
- `NOT_ADMITTED` means a UI, green job, chart, log, or this document does not prove the capability or authorize a
  related business transition.

### 2026-08-28 merged Source, Windmill, Scanner, and Market Data readback

Current Trade main `e12adde09754e20953ac81ce86ffa5e7b3a05c99` contains the completed Source Intake,
Windmill, and Scanner cuts. PR #356, merged as `82c4f59fc600a1d5d0a9bc94eac83234c531e490`, restored the isolated
Source Intake acceptance through the real Windmill entry, PostgreSQL Owner custody, and cleanup/readback. PR #361,
merged as `a7260f6563fbdf1c1b497087d638c0c406e4cefb`, made the checked-in Windmill workspace lock a deterministic,
read-only-verifiable projection; that is repository tooling evidence, not deployment evidence. PR #360, merged as
`67d31f5398922680714827206ceb2583437a869b`, added a sealed Scanner terminal-receipt read boundary for Product Edge;
it remains a static Owner contract and does not establish a Scanner operation or Windmill journey.

PR #362 is the current Source Intake-to-Research cut. The default Windmill operation now sends the admitted Source
terminal to the canonical R&D Owner API: `RUN` owns the first mutation, while `RESOLVE` is read-only and returns
submitted-or-unknown unless the exact durable receipt already exists. On its final tree, focused Source/Windmill
checks passed `5/5`, Workbench default checks passed `164/164`, and focused API checks passed `5/5`. The disposable
Windmill/PostgreSQL sealed acceptance passed on the pre-final tree, but was not rerun after the final `RESOLVE`
correction and disjoint main-only changes. Its maturity is therefore
`CURRENT/PARTIAL · EXACT_HEAD_COLD_ACCEPTANCE_NOT_ADMITTED`: the future Dashboard may preserve these fail-closed
action and recovery semantics, but it must not render a positive Source-to-Research result from transport success
alone. A deployed
default Windmill workspace, authenticated browser or native MCP acceptance, Dashboard implementation, provider or
network execution, production writes, and trading all remain `NOT_ADMITTED`.

PR #364, merged as `e12adde09754e20953ac81ce86ffa5e7b3a05c99`, additionally moves deployment-store
admission and revalidation behind the Market Data Owner boundary and exposes only a move-only sealed
`ResearchPitTerminal` to Strategy Factory. Capability Adoption now places the pure
`crates/product_edge_contracts` representations under Product Edge without granting them fact or authority
ownership. This is `CURRENT/PARTIAL · DYNAMIC_POSTGRES_PRODUCT_COMPOSITION_NOT_ADMITTED`: downstream code cannot
construct the terminal or read raw store, PIT, Source Binding, or clock rows, and the disposable PostgreSQL
acceptance remains unavailable on the observed Darwin cut. The future Dashboard may show this sealed handoff as
Owner evidence, but it cannot infer Market Data availability, default Windmill readiness, production resolution,
or a positive Source-to-Research result from it.

### 2026-08-23 merged H1 readback

PR #326 is merged on Trade main as `81c519fade16810c3d9694226092c83f1f886b07`. Its merge tree
`1760234821f2e12e3e6ea452d1b8395e69a0a34f` is byte-identical to the independently reviewed candidate tree at
`142ba65ef069077b76106f0fe8afa853591926a3`; this is tree equality after a squash merge, not commit ancestry. The
merged cut passed Workbench `67/67`, focused consumer projection `14/14`, artifact build `35/35`, the focused and
manifest-scoped Rust gates, and five disposable Linux/PostgreSQL suites (fresh migration, Product Edge, retry,
recovery, and ACL, each `1/1`). Two independent exact-head review lenses reported no finding. Those receipts admit
the following narrow status change only:

| H1 surface                                                                                                                               | Current evidence state                                     | Dashboard interpretation                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator Authorization, Product Edge admission, claim/start custody, R&D invocation reservation, and strict cross‑Owner readback         | `CURRENT/PARTIAL`                                          | The future UI may rely on exact locked cuts, immutable receipts, direct‑successor distance, zero‑write rejection, and fail‑closed unknown projections. These remain native Owner facts, not Dashboard storage.                                                               |
| Repository Workbench S1/S2 consumer projection and control policy                                                                        | `CURRENT/PARTIAL · DEFAULT_WEB_NOT_REVALIDATED`            | The checked‑in three‑card App, shared exact‑key projector, action admission policy, stale‑safe terminal display, all four read‑only legacy dispositions, and same‑identity recovery are current source contracts. Focused consumer tests are not a deployed‑browser receipt. |
| Web/MCP operation selection                                                                                                              | `CURRENT/PARTIAL · CHANNEL_ACCEPTANCE_NOT_ADMITTED`        | The repository App and narrow MCP profile both select `research_goal_v2`; `artifact_build_v1` remains the S2 operation. No token was minted or used and no native MCP parity run occurred in H1.                                                                             |
| Runtime foundation direct consumer                                                                                                       | `CURRENT/PARTIAL · FOUNDATION_NOT_READY`                   | PR #330 admits only non‑authoritative `NotReady` plus four exact revalidation dependencies. No Runtime custody, Strategy Instance, generation application, recovery or trading surface exists; `READY` and `APPLIED` remain unavailable.                                     |
| Market Data durable Owner foundation                                                                                                     | `CURRENT/PARTIAL · NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER` | PR #331 admits private atomic custody and sealed Source Binding/PIT Snapshot readback contracts only. No provider, ingestion, product resolver, H0/Dashboard/Workbench/Windmill consumer, default database, positive page row/action, or cutover exists.                     |
| Portfolio R0 Owner View contract                                                                                                         | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`       | PR #332 admits deterministic request/replay validation and structured unavailable results only. PAPER and LIVE remain unavailable; positive Performance, Exposure, Capacity, Attribution, Risk, headroom, allocation, deployment and trading surfaces do not exist.          |
| Windmill Runs, Run Detail, logs, workers, service logs, audit, and dependency jobs                                                       | `TARGET_DRAFT` from earlier authenticated observations     | H1 did not add a new default‑Windmill journey. The replacement keeps only the previously observed operational semantics and fixed empty states described below.                                                                                                              |
| Default Windmill/PostgreSQL deployment, external provider execution, Dashboard service/code/package, real trading, and production writes | `NOT_ADMITTED`                                             | No enabled button, green Windmill job, merged backend contract, or this design document may imply these capabilities.                                                                                                                                                        |

This readback supersedes the candidate-only status attached below to the historical H0/H1 defects for the exact
contracts now present in PR #326: action-time Research admission, original-authorization continuity, sealed
claim/start custody, resolution-discriminated wire verification, prepare-free start of an existing claim,
stale-safe terminal custody, and legacy quarantine. The old rows remain incident and design-decision history; they
must not be interpreted as the current status of the merged correction. Default deployment and real external
effects remain unpromoted.

### 2026-08-23 merged Observability readback

PR #327 is merged on current Trade main as `3ec29c7a4662efb2d4d28e2bb3e4181570a815b7`. The new workspace-owned
`vibe-observability` crate and root consumer test make the read-only, rebuildable status projection source contract
`CURRENT/PARTIAL`: it preserves per-Owner/source frontiers, freshness, partial/rebuilding/unavailable visibility,
identity-content conflict quarantine, an opaque restart checkpoint, and a query-only `GlobalStatusReadPort`. Crate
tests passed `18/18` and the root consumer passed `1/1`, with focused fmt/check/clippy/doc and independent review.
Owner ingestion remains sealed until a crate-owned typed canonical outbox adapter exists; telemetry visibility is
hard-coded `Unavailable`, and no runtime adapter or authenticated Windmill/Dashboard consumer was exercised. This
merge therefore admits the fixed `/dashboard` and `/operations/telemetry` source projection contract only. It does
not admit telemetry availability, Owner health inference, commands, retry, Dashboard implementation, default
Windmill, external provider execution, or production effects.

### 2026-08-23 merged Scanner and Governance readback

PR #334 is merged on current Trade main as `1a3c47b06470816da4974bfb85c9a8a140c60f7e`. Scanner terminal receipts
now require sealed Owner admission, and Governance rejects invalid or unavailable Eligibility before any receipt,
lifecycle, outbox, Runtime handoff, or successor write. These static contracts are `CURRENT/PARTIAL ·
STATIC_CONTRACT_CLOSED_NOT_RUNTIME`; durable Owner adapters, Qualification terminal integration, runtime/product
readiness, Windmill, provider/network effects, LIVE, production writes, and trading remain `NOT_ADMITTED`.

### 2026-08-23 merged Runtime foundation readback

PR #330 is merged on current Trade main as `73edb0e32f1745cc835951a1b9bd6cb38e456c35` from reviewed head
`96296549794b5b66fb3d730a505cc0551fe80e16`. The workspace-owned `vibe-runtime` crate and direct consumer make only
the lower-maturity foundation contract `CURRENT/PARTIAL · FOUNDATION_NOT_READY`: `RuntimeFoundation.status()` is
always `NotReady`, and `revalidate_after()` returns exactly Governance authorized-generation decision read,
canonical Runtime custody, Artifact compatibility recovery read, and Execution recovery frontier read. The direct
consumer and crate unit test each pass `1/1`; the PR also records focused checks, root pre-commit, and independent
authority-representation review. The crate exposes no authoritative Runtime fact/custody, Strategy Instance,
generation, checkpoint, recovery, application, order, provider, credential, network, or trading-effect surface.
This merge therefore admits the fixed foundation `NOT_READY` card and its four dependency rows only. It does not
admit a deployed runtime/default-Windmill consumer, `READY`, `APPLIED`, Resolve, Apply, recovery, or another effect.

### 2026-08-23 merged Market Data durable foundation readback

PR #331 is merged on current Trade main as `d790ae8702b1d254342ad81a82d8fc90e4b78d7a` from head
`c07da16786f6e845794790802761ad272342b987`. Its maturity is
`CURRENT/PARTIAL · DURABLE_MD_OWNER_POSTGRES_FOUNDATION_NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER`. Private
PostgreSQL custody atomically commits Source Binding or PIT Snapshot fact, native outbox, lineage head, and Owner
clock with exact replay/conflict handling. Public code exposes only `SourceBindingOwnerResolver` /
`SourceBindingOwnerReadback` and `PitSnapshotOwnerResolver` / `PitSnapshotOwnerReadback`; callers cannot construct
the sealed readbacks or access writers, trusted clocks, database constructors, raw envelopes, or canonical positive
types. The disposable PostgreSQL direct-consumer scenario passed `1/1`, the `vibe-data` library passed `301` with
one ignored disposable harness, and compile-fail doctests passed `10/10`; PR verification also records package and
root gates plus a fresh no-HIGH/MEDIUM review.

This merge admits the durable foundation contract and exact readback field geometry only. It does not admit
provider authenticity, ingestion, a public or production writer composition, default/shared PostgreSQL, H0
HTTP/JSON resolution, Workbench/Dashboard/Windmill consumption, LIVE provider use, trading, or cutover. Until one
such product consumer is separately admitted, `/data` and `/data/pit-catalog` render the fixed foundation card and
no binding/snapshot count, row, timeline, positive badge, resolver action, or mutation action.

A `TARGET_DRAFT` flat `MarketHeatmap` presentation atom may be prepared without changing that route maturity. It
accepts only an already verified, bounded server projection of stable item identity, display label, positive
layout weight and percentage change. It preserves the source squarified layout, responsive measurement, search,
keyboard focus and ripple hover redistribution, but deliberately has no child nodes, breadcrumb, drill-down,
candlestick preview, synthetic series or runtime mock data. Loading, unavailable, valid empty and filtered-empty
remain distinct; unavailable renders zero tiles. The atom cannot resolve Owner custody, read private PostgreSQL,
authenticate a provider or promote `/data`, `/data/pit-catalog` or `/market` to available. A separately admitted
Dashboard/H0 Market Data resolver remains required before any positive runtime item can reach it.

### 2026-08-23 merged Portfolio R0 fail-closed readback

PR #332 is guarded squash-merged on current Trade main as
`0ac5f4979bdc2169931f3b260f4459b4d258794b` from exact head
`e2de832c09811f80158ffd5c70a538f5fad6055c`; the merge tree is
`d4713c95d22cf49bdd63b2ae3243025a6efcaacf`. `PortfolioViewRequest` binds schema version, stable request identity,
principal claim/issuer, principal, account, Execution Scope, PAPER/LIVE mode, authorization-policy cut, common cut,
projection/valid-through time and exactly eleven direct-source dependency classes. Its fingerprint covers every
request, scope, source and time field; reordered equivalent dependencies are exact replay, changed meaning under the
same identity is conflict, and a new identity is distinct.

The public resolver always returns `UnavailablePortfolioView`: schema version, request identity/digest,
`UNAVAILABLE`, `INCOMPLETE_FAIL_CLOSED`, or `STALE`, fixed disposition `SOURCE_OWNER_RESOLVE_UNAVAILABLE`, and the
complete structured failure set. Both PAPER and LIVE direct external consumers resolve unavailable. The eleven
ordered dependencies are Execution account/open orders/fills/fees/settlement, Market Data price/FX/contract/
valuation/liquidity, and the prior Portfolio snapshot. Every caller-supplied principal claim and source locator
remains untrusted; Execution, Market Data and Portfolio direct Owner resolvers are absent. The sealed positive
`PortfolioViewReadback` has no public constructor, `Default`, or `Deserialize`, and the public resolver has no code
path that constructs it.

This merge admits the fail-closed request and unavailable-envelope contract only. It does not admit a Dashboard/H0/
Workbench/Windmill consumer, a positive Account/Performance/Exposure/Gross Capacity projection, Attribution, Risk,
headroom, allocation, deployment, LIVE authority, trading, or another effect. Until a private direct-source
composition is separately admitted, all four Portfolio routes render the same fixed unavailable card and no domain
summary, chart, table, timeline, filter, refresh, resolve, allocation or trading action.

The primary evidence cut is frozen at the 2026-08-22 Dashboard baseline Origin
`6869be69256d093c222ae6e34027077efe83adeb`, tree `b4f23739eaf52c8c8efe213567904649e6a04677`.
This baseline identifies the source revision for the incident and downstream-resolver evidence immediately below;
later consumer rows bind their own exact candidates and do not redefine this baseline as the current repository head.
The stopped exact uncommitted R&D candidate `a05d76ea18e2b35d7e55d74357fbc30b971ec1a2`, tree
`eb25b1a8325c4711ebd8d2cd012b3a87f70741c6`, tracked diff
`a5896bb23294e00fce158eedf97a429f9f06c35b9f243264455c7877c87da6c3`, and untracked set
`46ea5cd2ff29ef88a348a43c4d28c250b21a23ae90ac5871c8b581891567c722`, implemented the two-layer Product Edge
downstream resolver and produced focused OA `3/3`, PE `1/1`, Qualification `1/1`, first R&D-to-TrialFamily S1 `1/1`,
and Workbench `5/5` evidence. Before any image rebuild or new Windmill/Provider run, a destructive Qualification
test was accidentally run against the default persistent database and dropped/recreated the protected-feedback
projection, head, and outbox tables empty. No backup, PITR, Owner archive, or full canonical row image exists.
Canonical Qualification Owner reconstruction and direct Owner readback have now succeeded: projection, head, and
original outbox are `1/1/1`, with one separate recovery receipt. The incident is
`RESTORED_REVALIDATION_PENDING / NOT_ADMITTED`, not `RESTORED`. Recovery receipt
`qualification-owner-recovery-receipt-v1-8d4bc7a06d100b2e7fb1817a7ac3d1697412621024c34556fb8b7a8d1499a2b3`
has digest `sha256:8d4bc7a06d100b2e7fb1817a7ac3d1697412621024c34556fb8b7a8d1499a2b3`; the exact target fingerprint is
`sha256:cb7a0b3d7041e007d87a1afc8b9aa7204535ef64706d7293337cca3c0a1ebd7e`. This was deterministic canonical
reconstruction without a backup: raw original JSONB storage bytes were not observed, no physical backup was
restored, no new validity was minted, and no new domain wake was emitted. The original frontier still has
`valid_through=1787308603208` and is stale/`UNAVAILABLE` at the current cut. Default-Web, Product Edge, and R&D
consumer revalidation has not run; Submit, S1, S2, and provider actions remain disabled. Whole-volume rollback
remains forbidden because Windmill and R&D share the volume. The item-1406 Product Edge admission/receipt/outbox
remains byte-identical, while runtime/Web S1-to-S2, provider canary, full gates, candidate commit, and delivery remain
`OBSERVED_CANDIDATE_NOT_CURRENT / NOT_ADMITTED`.

The earlier authenticated default-Web S1 job `01a0258e-773e-d80b-e464-6b4cd7a20c7e` remains layout evidence: it
rendered `REJECTED_NO_WRITE / CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST / missing Owner receipt`, with S2 disabled,
while durable readback showed one committed Product Edge admission/outbox, zero R&D receipt/Intent/family, and zero
provider claim. The Dashboard must still render that handoff as `SUBMITTED_OR_UNKNOWN`, never as an input rejection.
The earlier directly relevant TrialFamily Product slice is based on Hub Origin
`8375a7b616d18c2084bcea7012ebc878afa1a96c`, tree
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
whether all three are one candidate-local correction batch, so the successful journey remains candidate‑only design
evidence rather than a current product fact.
After the lock-only commits `def6b37653` and `3183d3a280`, PR #268 contributed the first business diff: the
Strategy Factory Product Edge now treats its exclusive `valid_through` boundary as stale. That one projection is
`CURRENT/PARTIAL`; it did not itself promote the then-unmerged F1 foundations, S3 replay, or any
Dashboard/Windmill service. PR #327's later Observability disposition is recorded below.
PR #269 then contributed the structural Risk-to-Model dependency edge. PR #270 changed only
`codex-skills.lock.json`; it advances control-plane bootstrap custody but adds no Dashboard, Windmill, or business
capability.
S1 sourced research intake and S2 Artifact Formation remain `CURRENT/PARTIAL`. S3 Exploratory Replay remains
`ACTIVE_OBSERVATION` and `OBSERVED_CANDIDATE_NOT_CURRENT / DEPLOYMENT_UNAVAILABLE`: its historical Web run remains
design evidence, but the current remote operation is archived and cannot dispatch. PR #326 additionally makes the
narrow Operator Authorization, Product Edge, Qualification custody, R&D invocation-custody, and API-composition
contracts `CURRENT/PARTIAL`; it does not admit their default service/Windmill deployment or external effect. The F1
Observability source projection is also `CURRENT/PARTIAL` after PR #327, while its Owner/telemetry adapters and
runtime consumer remain unavailable. Scanner and Governance have the merged static-contract disposition bound
above; their runtime and product consumers remain unavailable. The PR #330 Runtime
foundation is `CURRENT/PARTIAL`, but its only state is non-authoritative `NotReady`; every authoritative Runtime
custody, instance and application surface remains unavailable. PR #331 likewise makes the durable Market Data
Owner foundation `CURRENT/PARTIAL`, while provider authenticity, product resolver composition, ingestion, cutover,
and every positive Data page row/action remain unavailable.
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

| Consumer line                                 | Recorded evidence state or later disposition               | Dashboard consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR #326 H1 merged override                    | `CURRENT/PARTIAL · DEPLOYMENT_NOT_ADMITTED`                | This row is the latest disposition for the corrected S1/S2, Product Edge authorization, FirstMutation continuity, H0, and H1 contracts narrated below. The merged source and isolated PostgreSQL suites are current; old `OBSERVED_*_NOT_CURRENT` labels on those historical defect rows describe their rejected candidate cut only. Default Windmill, native MCP parity, external provider execution, and Dashboard implementation remain `NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S1 sealed basis stage recovery                | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`             | Fresh authority review rejected `c72f44edb`: the first transaction can commit the Independence Basis Receipt, basis head and outbox while Qualification and the terminal Research receipt remain absent, yet retry still selects `FirstMutation`. Later generation-3 cutover, revocation, or expiry can therefore strand partial custody. TARGET canonically seals that stage as `SEALED_BASIS_PENDING_QUALIFICATION`; the same request resolves or completes from historical custody without duplicate basis/head/outbox, while changed request/admission conflicts. Consumer v4 found no separate H1 static defect across 31/31 tests, but dynamic PostgreSQL, Windmill, provider, and browser acceptance remains unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S1 Workbench resolve and terminal retention   | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`             | Fresh v5 authority and consumer reviews rejected `e5893fd550`: the public Workbench `RESOLVE` sends no request body and reaches `resolve_v2`, which only looks for terminal Research custody and cannot advance a sealed basis stage; the only Historical completion path still requires another `submit_v2`, an action the unknown‑state App forbids. A Qualification projection committed before response loss becomes permanently stale because the Owner has no successor/renewal path, and an already complete S1 receipt/TrialFamily is later hidden as `SUBMITTED_OR_UNKNOWN` when its linked view expires. TARGET seals the complete typed request meaning for body‑free same‑identity Resolve, gives Qualification Owner an explicit verified renewal/successor recovery, and preserves a complete terminal receipt/family as read‑only `STALE` while withdrawing every positive action. S2 claim/start, stale terminal and four legacy projections still passed 31/31 static checks; dynamic PostgreSQL, Windmill, provider and browser evidence remains unavailable                                                                                            |
| S2 action‑time Research freshness             | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`             | Consumer v6 rejected `4c28bd583f`: Workbench caches an Owner `AVAILABLE` projection and validates only its interval shape, so a page left open across `valid_through` still enables S2 Run. Frozen v7 candidate `b48b588f267f8222e98659bc397e362fc70248e6` added App same‑identity S1 Resolve plus server‑locked current‑Research custody, but fresh review rejected it: a transient S1 Resolve failure kept the old S1 row `AVAILABLE` while fabricating an Artifact unknown state whose attempt did not exist; the server path also failed to require the exact canonical effect set, and no dynamic `valid_through` lock‑wait race proved zero write. TARGET separates cancellable read‑only `PREFLIGHTING` from non‑cancellable `ADMITTING`, withdraws the current‑positive Research gate without creating an attempt when preflight fails, requires exact Artifact‑mutation plus provider‑invocation effects at the locked OA → Product Edge → R&D cut, and maps only post‑dispatch ambiguity to `SUBMITTED_OR_UNKNOWN`. Workbench 34/34 and static gates are candidate evidence only; live default‑Web, dynamic PostgreSQL and provider evidence remain unavailable |
| S1 V2 TrialFamily -> S2 Artifact binding      | `ACTIVE / OBSERVED_CANDIDATE_NOT_CURRENT`                  | Replacement candidate `3862ed8bcb` re‑proved the default‑App canonical‑history chain `basis receipt -> Qualification GENESIS_EMPTY receipt -> S1 ACCEPTED/family census -> S2 SUCCESS/time‑bound binding receipt -> REVIEW_ARTIFACT`; deleting the three task jobs and restarting Owner/worker returned byte‑identical request, attempt, basis, Qualification frontier, family, Artifact and binding identities without rerunning S2. Earlier rejected candidate `222c7a669a` also showed that unchanged original history can leave Windmill job `success` at business `SUBMITTED_OR_UNKNOWN` with only `RESOLVE_SAME_REQUEST_IDENTITY`, so operational success and Owner outcome remain separate                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R&D freshness and no‑Artifact receipt closure | `ACTIVE / OBSERVED_CANDIDATE_NOT_CURRENT`                  | Exact‑expiry zero‑write, relational mutation/restoration, locked binding reads and stale S1/S2 resolve‑only behavior remain preserved. Authority‑unavailable S1 resolve/replay and S2 prepare normalize to non‑terminal `SUBMITTED_OR_UNKNOWN`; semantic conflict remains conflict. Invalid V2 may persist one independent rejection receipt but zero basis/projection/Research/Intent/family/member/head/outbox facts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| TrialFamily lineage/feedback authority        | `ACTIVE / OBSERVED_CANDIDATE_NOT_CURRENT`                  | Architecture now admits an R&D basis/genesis Owner fact and a Qualification opaque frontier fact. The App no longer accepts predecessor/feedback/independence authority fields; it renders sealed basis and Qualification receipts. Positive S1 must validate the complete V2 request before either prerequisite write, then under `scope -> request` locks enumerate every lineage receipt without a raw selector, canonical‑verify every row, and only then filter/form family. The positive TrialFamily graph must be sealed Owner output, never public `Deserialize`. Corrupt or unavailable history returns `SUBMITTED_OR_UNKNOWN`, never false genesis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Product Edge action authorization             | `ACTIVE / OBSERVED_CANDIDATE_NOT_CURRENT`                  | The stopped candidate implemented the Product Edge‑owned SQL‑envelope plus Rust sealed‑readback resolver, proved OA‑to‑PE lock order, shared readers/exclusive writers, exact ACL, migration idempotency, and a first R&D S1 through the fixed port. It did not reach rebuilt‑image or default‑Web acceptance before the database incident, so the earlier UI defect remains the current observation: committed PE admission plus unavailable downstream R&D custody is `SUBMITTED_OR_UNKNOWN`, disables S2, and exposes only same‑identity Resolve. Provider, full runtime, commit, delivery, and final review remain `NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| FirstMutation original OA continuity          | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`             | Authority v6 rejected `4c28bd583f`: a not‑yet‑mutated admission verifies its original Operator Authorization only as historical, then lets the immediate Product Edge successor's current OA substitute at the final cut. TARGET requires `CurrentAtLock` for the stored original OA at the exact final write cut and, when an immediate successor is used, independently requires that successor OA and Product Edge binding current at the same cut. Expired/revoked original OA yields `ORIGINAL_AUTHORIZATION_NOT_CURRENT`, preserves both evidence rows read‑only, disables every FirstMutation action, and produces zero basis, rejection receipt, provider invocation admission, or claim. Historical resolution of an already committed basis/terminal remains separate. Dynamic multi‑Owner PostgreSQL and Windmill evidence remains unavailable                                                                                                                                                                                                                                                                                                                 |
| H0 exact‑head correction set                  | `CURRENT/PARTIAL · DEFAULT_WEB_NOT_REVALIDATED`            | PR #326 closes the six rejected‑contract defects from `c224927c54`: Qualification physical authority stays with its Owner; final write‑edge freshness is locked; policy‑equivalent cutover preserves exact predecessor continuity; claimed invocation custody exposes the one resumable Run action; unavailable S2 authority remains unknown rather than input rejection; and App/MCP select `research_goal_v2`. Isolated PostgreSQL evidence is current, but default App, native MCP parity, external provider execution, and product acceptance remain `NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| H1 fresh invocation admission                 | `CURRENT/PARTIAL · DEFAULT_WEB_NOT_REVALIDATED`            | PR #326 closes the rejected `6bd9f627` defects with original‑or‑immediate‑successor distance, resolution‑discriminated absent/present wire fields, prepare‑free start of an existing `CLAIMED` custody, stale‑safe terminal readback, and all four read‑only legacy dispositions. Workbench `67/67`, consumer projection `14/14`, artifact build `35/35`, isolated dynamic PostgreSQL, and two independent review lenses support the merged contract. Default Windmill, external provider execution, and real‑consumer deployment acceptance remain unavailable or `NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Qualification protected‑feedback frontier     | `RESTORED_REVALIDATION_PENDING / NOT_ADMITTED`             | Canonical Qualification Owner reconstruction and direct Owner readback succeeded with projection/head/original outbox `1/1/1` plus one separate recovery receipt. The original frontier remains stale/`UNAVAILABLE` after `valid_through=1787308603208`; default‑Web, Product Edge, and R&D consumer revalidation has not run. The Dashboard renders the Owner store unavailable, never fresh `GENESIS_EMPTY`; hides Copy frontier and every positive Submit/S1/S2/provider action; shows the affected store/table set, last trusted cut, current `1/1/1 + receipt` readback, recovery classification, and immutable incident evidence; and offers only Open incident evidence and Copy locator. There is no Restore, Reconstruct, Clear incident, successor, or retry control                                                                                                                                                                                                                                                                                                                                                                                            |
| S3 Exploratory Replay                         | `OBSERVED_CANDIDATE_NOT_CURRENT / DEPLOYMENT_UNAVAILABLE`  | A historical real default‑Web run proves the Run Detail information architecture and Owner readback shape, but the TrialFamily deployment sync archived the remote S3 replay operation. The Backtest route must now show capability unavailable and disable invocation until S3 is explicitly restored from its frozen candidate and revalidated. Native MCP parity remains unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Observability status projection               | `CURRENT/PARTIAL · ADAPTERS_UNAVAILABLE`                   | PR #327 merges the read‑only, rebuildable projection, per‑source frontier/freshness/completeness states, quarantine, restart checkpoint, and query‑only consumer port. Owner ingestion stays sealed without a crate‑owned typed canonical outbox adapter, telemetry is always `Unavailable`, and stale or self‑asserted telemetry cannot produce `Available`. Runtime consumer, Dashboard/Windmill integration, and operational telemetry backend remain `NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Scanner public terminal projection            | `CURRENT/PARTIAL · STATIC_CONTRACT_CLOSED_NOT_RUNTIME`     | PR #334 seals public terminal receipt construction behind exact Scanner Owner admission. Dashboard terminal rows, counts, badges, receipts, Matcher invocation and Proposal evidence remain unavailable until a direct Owner consumer and runtime adapter are separately admitted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Governance invalid Eligibility admission      | `CURRENT/PARTIAL · STATIC_CONTRACT_CLOSED_NOT_RUNTIME`     | PR #334 rejects invalid or unavailable Eligibility before Governance admission with zero receipt/lifecycle/outbox write, Runtime handoff or successor action. Receipt‑backed `REJECTED_NO_WRITE` remains a distinct admitted Governance decision; positive application and runtime consumers remain `NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Qualification intake replay                   | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`             | F1 proved that two different invalid replay meanings under one request/handoff identity could incorrectly join the first `NOT_ADMITTED` receipt. The rejected candidate must be corrected so exact semantic replay resolves the original receipt while every changed meaning returns `RequestSemanticConflict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Qualification public projection               | `ACTIVE / OBSERVED_VISIBLE_DEFECT_NOT_CURRENT`             | F1 proved that legal non‑terminal `Admitted` and `Evaluating` summaries could be misreported as terminal `ClosedNotQualified`. The public projector must reject non‑terminal summaries; no terminal row, count, receipt, color, or action may be inferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Market Data durable Owner foundation          | `CURRENT/PARTIAL · NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER` | PR #331 admits private atomic PostgreSQL custody plus sealed read‑only Source Binding and PIT Snapshot resolver/readback contracts. No product composition, H0/Dashboard/Workbench/Windmill consumer, provider authentication, ingestion, public writer, default database, cutover, or positive Data page row/action is admitted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Portfolio R0 public resolver                  | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`       | PR #332 makes deterministic request/replay validation and the structured unavailable envelope current. PAPER/LIVE both fail closed; the four Portfolio routes expose only the fixed contract card, never positive projection data or domain actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Risk                                          | `MECHANISM_REJECTED / NOT_ADMITTED`                        | Static schemas and test‑constructed positive paths are not real consumers. Risk routes remain target skeletons and must not render available state or enabled business actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

The S3 Web observation shows a Backtest receipt and canonical result, actual Artifact/PIT/runtime/simulator
identities, the complete diagnostic set, the R&D handoff, `EXPLORATION_ACTIVE · AVAILABLE`, explicit
`NOT_ADMITTED` boundaries, and one correlated engine invocation without a duplicate attempt. This evidence
supports the Run Detail layout, tabs, status treatment, receipt cards, bounded logs, and recovery copy. It does not
prove native MCP parity or admit replay as a current shared-product capability.

The remaining action-time credential boundary is also consumer-visible: native MCP verification requires a
revocable short-lived token scoped to the replay operation and bounded read‑only job/log access, followed by
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
Owner. It is also the read‑only surface for Observability projections and operational job state.

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

An Owner‑projected next action is necessary but not sufficient to enable a button. Before rendering an enabled
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

For an operation with a domain freshness prerequisite such as S2, the visible primary control is `Check & Run`,
not an effect authorized by cached `AVAILABLE`. Its first transition is read‑only `PREFLIGHTING`: the App resolves
the same S1 request/Intent using the Owner's current projection only as a fail‑closed UX preflight. While pending,
the primary reads `Checking…`, the fixed status line is an accessible live region, and Cancel is safe because no
Artifact request has been sent. Cancel, timeout, malformed output, transport failure, or a non‑current projection
withdraws the current‑positive Research gate, preserves the historical Research card as read‑only, creates no
Artifact attempt, and exposes no same‑attempt Resolve.

Only an exact `AVAILABLE / INTENT_FROZEN` preflight may transition atomically to `ADMITTING`, at which point the
effect‑capable Artifact request has been sent, `Submitting…` replaces Cancel, and the UI shows no fake percentage.
The server, not the preflight, must then validate the exact operation/schema/effect set and re‑resolve current R&D
custody inside the locked OA → Product Edge → R&D transaction immediately before its first write. A bounded
server receipt moves the gate to informational blue `ADMITTED`; this is request admission, never Artifact or
business success. Timeout, disconnect, or malformed output after dispatch becomes domain
`SUBMITTED_OR_UNKNOWN` and transfers to same‑attempt Resolve; it never returns to `PREFLIGHTING` or
`REVALIDATION_REQUIRED`. The browser may conservatively mark an aged cached action `REVALIDATION_REQUIRED`, but
only an Owner response may label it `STALE` or restore `Check & Run`.

Historical readback and current effect authority are separate projections. A canonical admission snapshot remains
readable after its binding is superseded or its authorization is revoked so Audit and Run Detail can explain what
was admitted at the original cut. It never supplies the current gate. After historical authorization expires, a
policy-equivalent current authorization is reachable only through a canonical append-only Operator Authorization
successor issuance that binds the prior identity/scope/sequence and its new validity. If that Owner operation or
receipt is absent, `Current authority` is `Unavailable`; the historical snapshot remains visible, while Dashboard
offers no local renewal, replacement selector, or inferred current authorization.

For an admission that has not performed its first downstream mutation, continuity is bounded to the original
binding or exactly one **immediate** policy-equivalent successor. `successor_distance` is therefore `0 | 1`; a
second cutover, a skipped predecessor, a branch, or an arbitrary chain head renders `Current authority` and every
first-mutation action `Unavailable`, even when the latest scope text is equivalent. The fixed
`AuthorizationSuccessorReadiness` geometry shows admission generation, current generation, distance, predecessor
locator and the `DIRECT_SUCCESSOR_REQUIRED` stop. It never walks forward until something matches or promotes a
generation-3 head on behalf of a generation-1 admission. Already committed invocation admission/claim/start facts
remain historically resolvable from their sealed custody and do not re-enter this first-mutation gate.

The stored original Operator Authorization never becomes historical authority for a new FirstMutation. At the
final locked write cut, its own row is resolved as `CurrentAtLock`. If `successor_distance=1`, the immediate
successor's Operator Authorization and Product Edge binding are additional current requirements, not substitutes
for the original. `AuthorizationSuccessorReadiness` therefore renders `Original authorization at final cut` before
`Immediate successor at final cut`; either non-current row produces `ORIGINAL_AUTHORIZATION_NOT_CURRENT` or the
successor-specific stop and keeps every FirstMutation control disabled.

Before a first provider claim, Product Edge must atomically re-read the complete current deployment and
authorization histories and persist a distinct sealed
invocation‑admission receipt. That receipt binds the directly resolved current authorization identity and frontier,
Time Evidence, the policy-equivalent `ACTIVE` binding/head, exact manifest digest, the historical request‑admission
lineage, and one final write cut sampled under the complete lock set. Its commit time cannot cross authorization or
binding validity. Cutover, expiry, revocation, a mismatched manifest, or any malformed/missing/extra history row
returns `unavailable` with zero invocation‑admission, claim, state, or provider effect.

The invocation‑admission receipt, claim receipt, and invocation state are three separate Product Edge facts. The
claim consumes and references the sealed invocation admission; it cannot substitute the original request admission
or transient resolver output. The versioned public claim readback includes
`invocation_admission_receipt_identity` and `invocation_admission_receipt_digest`; the Windmill operation adapter and
shared consumer projector must consume one generated/exact parser and bind both values before projecting a claim.
That parser is discriminated by Owner resolution and follows Rust serialization exactly: `SUCCESS` carries present,
non-null `trial_family_resolution` and `artifact_trial_family`; `CLAIMED`, `INVOCATION_STARTED`,
`FAILED_NO_ARTIFACT`, `OUTCOME_UNKNOWN`, and `REJECTED_NO_WRITE` omit both optional family keys; verified legacy
terminal carries `trial_family_resolution=TRIAL_FAMILY_UNAVAILABLE_LEGACY` and omits
`artifact_trial_family`. Explicit `null` is not interchangeable with omission. Rust fixture bytes must feed both
Windmill verifiers in one cross-language contract test; hand-authored `null` fixtures are not acceptance.
Missing, extra, schema-mismatched, or tampered wire fields preserve the A0/A1 geometry as `Unavailable`, expose only
same‑attempt Resolve and operational evidence, and never enable Run. Claim disposition is
`CLAIMED_NEW | ALREADY_CLAIMED`; state is `CLAIMED | INVOCATION_STARTED`; start disposition is
`STARTED_NEW | OUTCOME_UNKNOWN`. Claim response loss must recover the same durable `CLAIMED` receipt and project the
exact next action `RUN_BOUNDED_EXECUTION_AGENT` for the same build request, attempt, and claim. Only that projection
plus direct equality to the sealed invocation‑admission receipt enables **Run bounded Agent + sandbox**; invoking it
starts the existing claim exactly once and never creates a successor, a replacement claim, or a second provider
invocation. Once claim commits, no upper layer may rerun R&D `prepare` or current Research freshness as a new start
gate. Start/recovery resolves the historical Intent/attempt custody sealed by that claim; a fresh Research cut
governs only a pre-claim admission or an explicitly admitted successor. Missing, stale, malformed, or mismatched
invocation admission renders unavailable even when a claim row exists. Once start commits, the Run control disappears
and every replay renders `OUTCOME_UNKNOWN` with
`MANUALLY_RECONCILE_PROVIDER_INVOCATION`; it never invokes the provider again or fabricates a provider outcome.
The operation adapter must resolve the same attempt before any pre-claim preparation: recovered `CLAIMED` dispatches
the start operation directly, while only a genuinely unclaimed identity may call `prepare`. After
`INVOCATION_STARTED`, success/failure terminalization consumes sealed attempt/claim custody without current Research
freshness. Later Resolve returns the exact durable terminal receipt even when the linked Research View is stale;
staleness disables review/successor actions but never deletes or rewrites the terminal business fact.
The fixed presentation order is `Current authority`, `Admission snapshot`, `Invocation admission`,
`Invocation claim`, `Invocation state`.

Current authority readiness is conjunctive. An Operator Authorization genesis or issuance receipt may be displayed
as sealed historical evidence, but it cannot enable an action unless the corresponding Product Edge binding, head,
and outbox projection all resolve canonically at the same admitted cut. When the OA row exists but any Product Edge
row is absent, unavailable, or lock-incompatible, `AuthorizationLineagePanel` keeps the two Owner rows separate,
labels the Product Edge row `Unavailable`, shows the exact stop predicate, and `ActionAdmissionGate` renders no
primary action. The browser never offers bootstrap, repair, permission elevation, or force-admit controls.

An admitted Product Edge snapshot is still not an R&D terminal. Before the first R&D mutation, a versioned
Product Edge-owned `DownstreamAdmissionResolver` must run inside the caller's physical PostgreSQL transaction. It
acquires the existing OA shared locks, then locks and verifies Product Edge binding/head/manifest/admission/outbox,
and returns sealed canonical admission bytes without exposing either Owner's tables. R&D receives execute-only
access to that port, never OA access or Product Edge table authority. If this seam is absent, denied, stale, corrupt,
or cannot retain the lock cut, the page renders Product Edge admission as committed and downstream custody as
`Unavailable`; overall S1 is `SUBMITTED_OR_UNKNOWN`, S2 stays disabled, and the only business action is
same-identity Resolve. It must not relabel the request `REJECTED_NO_WRITE` or offer Create successor merely because
the R&D receipt is missing.

The S2 error projection follows the attempt identity, not the operational job result. `artifact_product_edge_error`
maps unavailable, storage, or unknown Product Edge authority - including an existing custody record - to
`SUBMITTED_OR_UNKNOWN` with the sole business action `RESOLVE_SAME_ATTEMPT_IDENTITY`. It never renders
`REJECTED_NO_WRITE`, Create successor, a new claim, or a provider action.

Business outcome projection has a separate fixed precedence. A sealed R&D terminal receipt is authoritative over
the Product Edge invocation fence: `SUCCESS` renders the canonical Artifact/Build Receipt/Review projection, while
`FAILED_NO_ARTIFACT` renders `NoArtifactReceiptPanel` and no Artifact. Only when neither R&D terminal exists and the
Product Edge fence is `INVOCATION_STARTED` may the page render `OUTCOME_UNKNOWN` plus
`MANUALLY_RECONCILE_PROVIDER_INVOCATION`; it must not retry, mark success, or dismiss the stop. A verified historical
terminal from pre-current custody renders `LEGACY_TERMINAL_QUARANTINED`, exposes its historical receipt only, and
creates no current Research View, provider action, successor action, or TrialFamily repair action. The Owner wire
discriminant, request/attempt identity, terminal receipt, custody generation, quarantine reason, and original
disposition must survive the shared consumer projector as one strict legacy-only branch. Its exact accepted set is
`SUCCESS | FAILED_NO_ARTIFACT | REJECTED_NO_WRITE | OUTCOME_UNKNOWN`; sparse legacy rejection may omit Intent
identity/digest exactly as the Rust Owner wire does. Every variant remains read-only with family/provider/actions
absent. If that branch is missing or malformed, the fixed legacy slot renders `Unavailable` with same-attempt
Resolve; it must not silently collapse into an untyped generic unknown.

## Windmill capability evidence ledger

Windmill is the borrowed application and job shell. Its replacement retains only capabilities proved necessary by
a Trade consumer or required by an existing architecture contract.

| Windmill capability                                  | Observed use or need                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Current design hypothesis                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated browser session                        | S1‑S3 use an authenticated local App; the S1 V2 -> S2 acceptance reused an already signed‑in local `admin` browser session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `TARGET_DRAFT/KEEP`: one local operator and explicit `authenticated/expired/unavailable` shell state; no anonymous mode or general role‑administration product                                                                                                                                                                                                                                                                                                                                      |
| Credential/session bootstrap                         | The active V2 journey rejected stale `.env` login material and succeeded through the existing browser session without creating, rotating, or inspecting an API token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `TARGET_DRAFT/KEEP_MINIMAL`: local sign‑in/re‑auth boundary only. Exclude password import, token management, workspace credential conversion, and secret display from domain pages                                                                                                                                                                                                                                                                                                                  |
| Workspace                                            | One `trade-rd` workspace scopes App, scripts, and tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `TARGET_DRAFT/COMPRESS`: one installation profile, not a workspace product                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Full‑code Raw App and sandbox                        | Hosts the current React Workbench without frontend SDK/Data Table scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `TARGET_DRAFT/REPLACE`: first‑party routes and components                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Versioned scripts and App dependencies               | PR #326 makes the repository App and narrow MCP profile select the same `research_goal_v2` Product Edge operation; `artifact_build_v1` remains S2. The shared empty‑input `consumer_projection_v1` exact‑key projector is imported by the App and validates resolution‑discriminated Rust wires, including explicit absent/present fields and all four legacy terminal dispositions. Existing `CLAIMED` custody starts without another freshness‑sensitive prepare. The repository projection now contains legacy `research_goal_v1`, current `research_goal_v2`, `artifact_build_v1`, the non‑business projector, and one Raw App; H1 did not deploy or revalidate that set in default Windmill. Windmill records dependency‑build jobs separately | `TARGET_DRAFT/KEEP_SEMANTICS`: one versioned operation registry entry, content digest, typed BFF gateway, and explicit dependency state. Adapter and projector consume one resolution‑discriminated parser and direct serialization fixtures; schema drift preserves fixed unavailable geometry. Projection verification compiles into the typed library with no catalog item, route, action, or user‑run record. Legacy V1 remains migration/quarantine input, never a selectable future operation |
| Server and worker queue                              | Continues bounded provider/build/replay work after client disconnect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `TARGET_DRAFT/KEEP`: minimal durable dispatcher and worker leases                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Run list, Run Detail, progress, result, bounded logs | Real App/webhook runs expose path, tag, trigger, timing, worker, inputs, result, memory, script hash, and `getJob`/`getJobLogs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `TARGET_DRAFT/CORE_OPERATIONAL`: exact Runs and Run Detail contracts; never a business terminal                                                                                                                                                                                                                                                                                                                                                                                                     |
| Worker status and service logs                       | One live `rd-product-edge` worker executes the admitted scripts; service logs expose worker/server hosts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `TARGET_DRAFT/KEEP`: worker lease/capabilities, exact‑run readiness in Run Detail, and bounded service log reads; no REPL or generic administration                                                                                                                                                                                                                                                                                                                                                 |
| Audit log                                            | Windmill records authenticated create/update/execute/delete operations, but CE redacts the resource detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `TARGET_DRAFT/KEEP_MINIMAL`: first‑party operation audit with principal, operation, target identity, time, outcome, and correlation; no enterprise‑redaction dependency                                                                                                                                                                                                                                                                                                                             |
| Per‑run Metrics, Traces, Assets tabs                 | The observed replay run renders all three tabs, but each is empty; metrics require jobs longer than 500 ms, HTTP tracing is disabled or unused, and no run asset exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `NOT_OBSERVED/CURRENTLY_EXCLUDE_AS_BACKENDS`; preserve deterministic empty states and add a backend only after a Trade consumer produces data                                                                                                                                                                                                                                                                                                                                                       |
| Same‑identity resolve                                | S1 V2 recovered response loss and restart/cache‑loss from direct Owner facts; the default page uses exact request and build‑attempt resolve controls and returns the original receipts, Intent, TrialFamily/frontier, Artifact review, and binding. S2/S3 require the same pattern                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `TARGET_DRAFT/CORE`: mandatory request/attempt identity, direct Owner resolution, immutable returned bytes/frontier, a separately linked replacement operational run, and no naked retry                                                                                                                                                                                                                                                                                                            |
| Disposable completed‑job cache                       | S3 proves job deletion with recovery from Owner facts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `TARGET_DRAFT/KEEP_DISPOSABLE`: TTL/delete/readback; no business custody                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Native MCP                                           | S1‑S2 use narrow profiles; S3 A/B parity remains pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `TARGET_DRAFT/KEEP_AS_CHANNEL`: share the UI capability manifest                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Scoped token lifecycle                               | S1‑S2 use scoped credentials; S3 requires one short‑lived replay‑only issue/use/revoke cycle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `TARGET_DRAFT/KEEP_NARROW_ISSUANCE`: exact operation allowlist, bounded read‑only job access, expiry, revocation, one‑time secret display, external custody                                                                                                                                                                                                                                                                                                                                         |

| Schedules | Scanner now seals due‑slot attempts unavailable until real source‑Owner typed resolve; no scheduler or Windmill schedule consumer exists | `TARGET_DRAFT/DEFERRED_UNTIL_CONSUMED` |
| Workspace Assets / files / object storage | Workspace page reports no Data Table, Ducklake, object storage, or assets; database count is zero | `NOT_OBSERVED/CURRENTLY_EXCLUDE`; Owner artifact locators are not Windmill files |
| Workspace Resources and Variables | `trade-rd` has no Resource or Variable; worker credentials come from Compose environment allowlists. The only database Resource belongs to the `admins` App theme | `NOT_OBSERVED/CURRENTLY_EXCLUDE`; use runtime‑injected opaque secret references, not a generic manager |
| App/Flow builder, arbitrary Flow graph, preview tools | No admitted Trade consumer | `NOT_OBSERVED/CURRENTLY_EXCLUDE` |
| Data Tables and Windmill business storage | Explicitly prohibited by the App contract | `NOT_ADMITTED/DROP` |
| MCP workspace management | Explicitly excluded from current profiles | `NOT_ADMITTED/DROP` |
| General secret‑manager UI | Secrets remain outside repository and App state | `NOT_OBSERVED/CURRENTLY_EXCLUDE`; accept opaque references only |
| General Python/Deno/Bun/Bash runtime catalog | Trade uses exact repository operations and Owner services | `NOT_OBSERVED/CURRENTLY_EXCLUDE` |
| Multi‑tenancy, billing, marketplace, enterprise RBAC | No single‑user consumer | `TARGET_DRAFT/EXCLUDE_BY_PRODUCT_SCOPE` |

`OBSERVED_CANDIDATE_NOT_CURRENT`: a 2026-08-23 candidate-lock check adds one narrower Windmill boundary. The
immutable observation packet is Hub thread `codex://threads/01a014ef-d305-7b40-8d6b-f5c6d26fca56`, turn
`01a02b42-82f7-71d3-b086-339a3b0bba28`, with tool-output receipts `ctco_01a02b4d-9276-7793-bb29-691adbff2784`
(queue/exit), `ctco_01a02b4d-d106-7b13-b965-634b8428d03c` (cancel), and
`ctco_01a02b4e-2c82-7e60-9d02-8162cb7f91ec` (offline rehash). This packet is observation evidence, not a repository
capability or Dashboard implementation receipt.
`wmill sync push --dry-run --auto-metadata` for three Product Edge scripts and the Raw App did not publish, but it still enqueued dependency
job `01a02b4b-a5bc-c91c-d964-03f47a3d1564`. The job remained first in the queue because no matching executor
claimed it; the CLI ended with code `130`, and the exact queued job was then cancelled with HTTP `200`. The frozen
candidate instead used offline `wmill generate-metadata` rehash for exactly three scripts and one App. The
replacement therefore keeps deterministic dependency/lock compilation in the build pipeline and exposes remote
dependency work only as an operational run. It does not reproduce Windmill's metadata editor, script catalog, or
Dashboard-driven publish flow.

This observation also narrows cancellation and readiness. Run Detail may expose `Cancel queued dependency` only
for `kind=dependency`, `state=queued`, an empty domain‑effect set, and Dispatcher proof that no worker claim exists.
It returns an immutable operational cancellation receipt and never changes Owner truth. There is no batch cancel,
and provider, build, replay, admission, claim, or otherwise effect‑capable runs have no Cancel action. Worker status
is two-dimensional: lease liveness plus compatibility with the selected job's kind, tag, runtime, and required
isolation. A live heartbeat with no compatible executor is `online / incompatible` for that job, never Ready.

### Native Windmill surface and backend replacement map

This 2026-08-20 snapshot combines the authenticated Windmill UI, the pinned `1.791.0` Compose deployment, App and
script source, and read‑only Windmill database counts. Counts are observation evidence, not stable product limits.
The future service implements the contract in the last two columns, not Windmill's tables or generic low-code
models.

The layout and exclusion decisions are also checked against the exact official Windmill source embedded in that
image: version `1.791.0`, revision `ce71756c893c2ef1ea399ad50f0617015999ddd0`. These are implementation evidence
anchors, not Trade UI dependencies:

| Windmill implementation anchor                                                                              | Layout retained by the Dashboard                                                                                                   | Windmill behavior deliberately excluded                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `RunsPage.svelte` → `RunsTable.svelte` plus `JobRunsPreview.svelte`; full route `run/[...run]/+page.svelte` | URL-backed filters, auto‑refresh, date‑grouped table, selection drawer, Result above fixed `Logs / Metrics / Traces / Assets` tabs | Batch rerun/cancel/resolve, `Run again`, Share, Edit, Code, schedule editing, restart and public‑link controls   |
| `workers/+page.svelte`                                                                                      | Group selection, worker table, host/IP grouping, occupancy/status, search and last‑run navigation                                  | Worker config import/edit, tag administration, HTTP-agent creation, REPL, autoscaling and cache/restart controls |
| `service_logs/+page.svelte` → `ServiceLogsInner.svelte`                                                     | Timeframe/error/search filters, service/group/hostname selection, responsive split pane, context drawer and auto‑refresh           | Superadmin management, unbounded file access and any inference from logs to Owner health                         |
| `audit_logs/+page.svelte` plus `AuditLogsFilters`, `AuditLogsTable`, `AuditLogsTimeline`, `AuditLogDetails` | Filters, append‑only table, selected‑event timeline/detail and mobile drawer                                                       | Mutation, replay, dismiss and business‑truth projection from CE-redacted resource fields                         |

At that exact Workers source revision, worker and group reads refresh every five seconds; fewer than six groups
use tabs and six or more use a selector. Search reacts case-insensitively to worker name, worker-instance identity,
or IP. The table inserts host/IP group rows; always shows worker start, jobs ran, memory, limits, version and status;
and conditionally adds tags, last job with four occupancy windows, and REPL. It distinguishes no workers from no search matches; initial loading is four
generic skeleton rows. These facts justify the retained grouping, search, operational fields and explicit empty
states only. They do **not** justify a native selected-worker detail: the source has no worker-row selection or
worker-detail drawer. The Dashboard's future `WorkerLeaseCard` is therefore a Trade TARGET composition over the
replacement read model. It also does not inherit Windmill's conditional admin-shaped columns, 15/60-second UI
liveness thresholds, group-config drawer or REPL authority; the fixed Trade columns and Owner-independent lease
policy below remain the design authority.

At the exact Audit source revision, username, page, before/after, page size, operation, resource, scope and action
kind are URL-backed filters. The route always declares a 70/30 table/detail split with 50/15 minimum pane shares
below an upper two-sixths timeline, and separately declares an `md:hidden` table whose selection opens the same
`AuditLogDetails` in a drawer. The source alone does not prove that the split pane is suppressed at mobile runtime.
The split-pane initial branch has eight skeleton rows; the mobile `AuditLogsTable` instead uses its centered loading
spinner. CE or Pro licenses show an explicit redacted-logs warning. These
facts prove the retained filter, timeline, selection, detail and responsive-drawer layout. They do not admit the
native default page size, missing-job-span lookup or redacted parameter bytes as Trade authority: the future
`OperationAuditStore` and Product Edge receipt panels below remain TARGET contracts, and neither source layout nor
extra read can create Owner business truth or an effect action.

A 2026-08-22 read-only Docker-label audit found one live Compose project whose server came from worktree `5781`,
Backtest Owner from `dc01`, and PostgreSQL, worker, R&D Owner and build sandbox from
`trial-family-custody-replacement`. All containers can be healthy while no canonical artifact cross-binds those
sources, App/script hashes and Owner compatibility. The Dashboard therefore treats this as deployment provenance
`unavailable`, not runtime success. TARGET uses one content-addressed compatibility envelope; it may intentionally
bind multiple service artifacts, but a mixed runtime with no such envelope cannot become available.

The `TARGET_DRAFT` local entry topology keeps every Owner, Windmill and PostgreSQL container exclusively on one
sealed internal network, with no published port or external route. The sole ingress is a credential-free,
read-only-filesystem TCP sidecar attached to that network and a separate bridge with IP masquerading disabled. It
drops all Linux capabilities, runs a fixed command, and forwards only the host-bound `127.0.0.1:<port>` to internal
Windmill. Acceptance requires dynamic proof that the host can reach Windmill through that loopback port while each
business container still has no external route; any additional published address, forwarding target, credential,
capability or business-container bridge attachment fails closed. The isolated topology experiment passed this
boundary, but it remains design evidence only: it does not establish a default deployment, Dashboard
implementation, provider/network execution, production write or trading authority.

| Native surface / current backend            | Exact observed state                                                                                                                                                 | Dashboard route and fixed UI                                                                                                                                                                                                                               | Replacement service/store and disposition                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home / App and script catalog               | One Raw App `f/trade/rd_workbench`; the current TrialFamily sync deploys S1 V2 research and S2 Artifact operations but archived the remote S3 replay entry           | Domain routes own the four‑stage journey. Backtest remains routed but renders `DEPLOYMENT_UNAVAILABLE`; no generic Home catalog                                                                                                                            | Versioned `OperationRegistry` with `available/archived/unavailable` deployment state plus built frontend routes; archive disables dispatch without deleting Owner history. `KEEP_SEMANTICS`, exclude arbitrary catalogs                                                                                               |
| Runs / `v2_job*`                            | UI shows 53 user‑facing jobs; database has 88 rows including 34 App dependency jobs. Real paths use App and webhook triggers and tag `rd-product-edge`               | Operations / Runs: status segments, schedule/future toggles only when admitted, search, duration/concurrency filters, auto‑refresh, path/trigger/tag columns, date groups, pagination                                                                      | `RunStore` + `DispatcherReadModel`; durable operational metadata with TTL, explicit dependency kind, Owner‑outcome join by identity only                                                                                                                                                                              |
| Run Detail / completed job + result API     | Successful replay shows received/started time, duration, worker, run ID, 5 MB peak, script hash/language, App trigger, exact inputs, JSON result, and Owner receipts | `/operations/runs/:runId`; breadcrumb Back to Runs, then header actions Copy locator, Refresh, conditional Cancel queued dependency, Resolve same identity, Download bounded result/log. `Run again`, Share, Edit, and arbitrary script links are excluded | `RunDetailProjection`; schema‑allowlisted immutable input and bounded result projections, exact‑run worker compatibility, fixed operational cancellation receipt readback, explicit withheld/redacted disclosure, timing/resource metadata, and Owner receipt references; no raw payload fallback or business custody |
| Run Logs / `job_logs` and worker log volume | 86 log rows; exact run exposes download endpoint, auto‑scroll, job/tag/worker/host/isolation header, and bounded text                                                | Run Detail `Logs` tab: search, level/source chips, auto‑scroll switch, download bounded log, line viewport, truncation/retention notice                                                                                                                    | `BoundedRunLogStore`; append‑only chunks, byte/age limits, redaction, correlation, TTL; MCP read scope may expose only exact admitted runs                                                                                                                                                                            |
| Run Metrics                                 | Observed 74 ms run says no metrics because collection begins above 500 ms                                                                                            | Run Detail `Metrics` tab always has fixed geometry; render `NotCollected`, `Unavailable`, or time‑series, never a fabricated zero                                                                                                                          | Deferred `RunMetricProjection`; `CURRENTLY_EXCLUDE_BACKEND` until non‑empty consumer evidence                                                                                                                                                                                                                         |
| Run Traces                                  | Observed run says no HTTP request captured or tracing disabled                                                                                                       | Run Detail `Traces` tab: explicit not‑captured reason and no empty success graph                                                                                                                                                                           | Deferred `RunTraceProjection`; `CURRENTLY_EXCLUDE_BACKEND`                                                                                                                                                                                                                                                            |
| Run Assets                                  | Observed run says `No assets found`; workspace asset count is zero                                                                                                   | Run Detail `Assets` tab: explicit empty state only. No global Assets route                                                                                                                                                                                 | No store now. Future entries must be disposable operational attachments that point to, never replace, Owner artifact custody                                                                                                                                                                                          |
| Workers / `worker_ping`                     | One live `rd-product-edge` worker, version `1.791.0`, job count, last‑job link, memory, status, tags; other groups have zero workers                                 | Operations / Workers: group chips, search, worker table, selected‑worker panel, last‑run link. Read actions are Refresh and Open last run                                                                                                                  | `WorkerLeaseStore` + heartbeats; retain identity/group/tags/version/start/last‑run/occupancy/memory, lease liveness and registered capabilities. Exact‑run readiness exists only in Run Detail. Exclude create config, cache clean, restart, REPL, autoscaling UI until separately admitted                           |
| Service Logs / server and worker logs       | Auto‑refresh page lists worker group and server hosts, time range, error‑only filter, service/host selector                                                          | Operations / Service Logs: time range, service, instance, severity, search, auto‑refresh, bounded log viewport                                                                                                                                             | `ServiceLogGateway`; read‑only, redacted, retention‑bounded. It is operational evidence, not Owner health or a telemetry backend                                                                                                                                                                                      |
| Audit Logs / partitioned audit tables       | Authenticated execute/update/create/delete records exist; CE exposes ID, time, principal, operation and redacts resource detail                                      | Operations / Audit: time/principal/operation/outcome filters, audit table, selected correlation panel; no mutation buttons                                                                                                                                 | `OperationAuditStore`; append‑only Dashboard/Product Edge control‑plane events with exact target/correlation/outcome. Owner business events remain in Owner/Event Rail custody                                                                                                                                        |
| Workspace/folder/auth                       | Folder `trade` contains three scripts and one App owned by `u/admin`; workspace and scoped tokens delimit access                                                     | Installation profile and Access settings only; no workspace/folder administration route                                                                                                                                                                    | `LocalSession` + `CapabilityManifest` + narrow token issuer; one installation, one operator profile, exact operation scopes                                                                                                                                                                                           |
| Variables, Resources, Assets, Schedules     | `trade-rd` counts are 0/0/0/0. Compose injects an allowlisted environment into the worker; Data Tables and frontend SDK access are forbidden                         | No product tabs. Settings accepts opaque runtime references; Scanner shows schedule unavailable/deferred                                                                                                                                                   | Exclude Windmill generic stores. Add a typed service only when a real Owner consumer and custody contract exist                                                                                                                                                                                                       |

The native `bun` runtime is an implementation detail of the three pinned scripts, not a user-selectable runtime
catalog. PostgreSQL persists Windmill operational state; separate R&D and Backtest Owner databases/APIs persist
business facts. The replacement keeps that ownership split even if all services ship in one image set.

### Operations API and backend state contract

This is a `TARGET_DRAFT` replacement contract, not evidence that the services exist. Browser and MCP reads use the
same typed handlers and capability checks. Page cursors are opaque and stable for one filter cut; every response
includes `observed_at`, `projection_version`, `availability`, and a retention or expiry disclosure. A route never
returns an Owner payload merely because the caller can read the operational run.

| UI read or action                 | Fixed Dashboard API                                                                                   | Backend owner and exact rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runs list, filters, pagination    | `GET /api/operations/runs` -> `RunPage`                                                               | `RunStore` reads immutable submission metadata plus dispatcher‑owned operational state. Filter fields are status/kind/path/trigger/principal/tag/duration/time cut; the cursor embeds that filter cut. Owner outcome is a separately resolved optional envelope, never derived from exit code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Run detail and bounded result     | `GET /api/operations/runs/{run_id}` -> `RunDetailEnvelope`                                            | `RunDetailProjection` resolves the exact operation/version manifest and returns only display‑allowed registered input/result fields, timing/worker/resource metadata, immutable operational cancellation receipt readback, retention and Owner receipt locators. It joins that path‑bound `run_id`'s dispatcher requirements to immutable worker registrations at one observation cut and returns `RunWorkerCompatibilityMatrix`; missing, stale or mismatched inputs are `unavailable`. Cancellation readback is `none / pending / receipt / unavailable`, remains read‑only after A disappears, and never changes Owner truth. Secret, protected and unknown fields are omitted behind typed withheld counts/reasons; viewport, Copy JSON and download reuse the identical redacted bounded projection. An unknown operation version or schema mismatch is `unavailable`, never raw JSON fallback. Missing disposable data with an Owner locator is `operational_data_expired`, not business absence |
| Same‑identity Owner resolution    | `POST /api/operations/runs/{run_id}/resolve-owner-outcome` -> `OwnerOutcomeEnvelope`                  | Product Edge resolves the immutable request/attempt identity through the named Owner typed port. It neither dispatches a job nor retries an effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Queued dependency cancellation    | `POST /api/operations/runs/{run_id}/cancel-dependency` -> `OperationalCancellationReceipt`            | `OperationalActionEnvelope` binds the authenticated principal, `dependency.cancel.queued` capability, exact run, current transition version, `kind=dependency`, `state=queued`, empty domain‑effect digest, no‑claim cut and short expiry. Dispatcher re‑resolves every field under its transition lock and compare‑and‑set changes only that exact operational run to `cancelled`; stale, revoked, claimed, terminal, unknown, mismatched or effect‑capable input fails closed. The receipt records run, prior state/version, principal, authorization cut, time and transition. It cannot cancel a domain request, provider/build/replay effect or Owner operation, and no batch endpoint exists                                                                                                                                                                                                                                                                                                     |
| Disposable completed‑run deletion | `DELETE /api/operations/runs/{run_id}/cache` -> `OperationalDeletionReceipt`                          | `RunStore` accepts only terminal operational rows after capability check and confirmation. It deletes bounded result/log/cache bytes, preserves the run tombstone and Owner locator, and cannot touch Owner stores                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Run log tail or download          | `GET /api/operations/runs/{run_id}/logs` and `/logs/download` -> `RunLogPage` or bounded stream       | `BoundedRunLogStore` reads append‑only chunks by opaque cursor. Search/severity/source filters, redaction, truncation, byte limit and retention are identical for viewport, download and MCP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Metrics, traces, run assets       | `GET /api/operations/runs/{run_id}/{metrics\|traces\|assets}` -> a discriminated tab envelope         | Until a producer is admitted, handlers return `not_collected`, `not_captured`, `empty`, or `unavailable` with a reason. They never fabricate zeros, spans, files, or success; run assets cannot resolve to a global file browser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Workers and selected lease        | `GET /api/operations/workers` and `/workers/{worker_id}` -> `WorkerPage` or `WorkerLeaseEnvelope`     | `WorkerLeaseStore` is written only by worker registration/heartbeat/claim/release. UI reads identity/group/tags/version/start/limits/occupancy/last run/last observed plus the registered kind/tag/runtime/isolation capability set. Lease expiry yields `unavailable`; these worker‑only routes never infer readiness for an unbound run or create a UI‑authored `dead` state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Service‑log viewport or download  | `GET /api/operations/service-logs` and `/service-logs/download` -> `ServiceLogPage` or bounded stream | `ServiceLogGateway` requires an exact service/instance cut and applies the same time/severity/search filters, redaction, cursor, retention and byte limit to both outputs. It exposes no delete, clear, restart or health‑promotion endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Audit list and correlation detail | `GET /api/operations/audit` and `/audit/{audit_id}` -> `AuditPage` or `AuditEventEnvelope`            | `OperationAuditStore` is append‑only and written by authenticated Product Edge/Dashboard control‑plane middleware, not by this read route. Unknown/redacted target stays explicit; there is no edit, delete, dismiss or replay endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

`RunOperationalState` is exactly `queued | running | succeeded | failed | cancelled | unknown`; only Dispatcher and
worker protocol events advance it, using compare-and-set on the last stored transition. `OwnerOutcomeState` is a
separate `available | rejected | unknown | unavailable | not_applicable` envelope and never participates in the
operational transition. A late terminal worker event may replace operational `unknown` for the same run identity,
but only an Owner reread may replace Owner `unknown`. Worker liveness is computed from a stored lease deadline and
last heartbeat. Only the path‑bound `RunDetailProjection` computes readiness by canonically matching that exact
run's kind, tag, runtime and required isolation to worker registrations at the same observation cut. Client time,
a missing row, process/container health, or a service-log message can
neither promote liveness nor fabricate compatibility.

The replacement is not a smaller low-code platform. It is a Trade-specific Dashboard, typed Product Edge
gateway, narrow job dispatcher, worker protocol, disposable operational store, and optional exact-tool MCP
channel. Native Owners and their stores remain separate services.

## Product shell and layout

The visual direction comes from the stopped local `vibe-trading` product, not Windmill: warm neutral canvas,
compact icon rail, capsule navigation, white content cards, gray framed panels, dense small typography, and
responsive Bento composition. Glass belongs only to navigation and transient overlays, never data cards or
business-state panels.

### Reference implementation anchors

The visual evidence cut is the local checkout `/Users/vx/WebstormProjects/vibe-trading` at commit
`4a6d66fb77fc144c2a013417c703db2caf401641`, tree `984c7d684dba72a6af78dc3e6cf50191bc3622ea`. The referenced
files below were clean against that revision at observation; unrelated dirty files in the stopped checkout are not
design evidence. This is a source reference, not a package dependency or business architecture authority. Future
agents must inspect these anchors before changing tokens or shell geometry:

| Reference path under `apps/web/src`                                              | Inherit                                                                                                                                                                  | Explicitly do not inherit                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `app/globals.css`                                                                | Mine warm‑neutral raw palette, Inter/JetBrains Mono, market‑direction separation, and the allowed zones/values for `glass-heavy`, `glass-light`, and tooltip glass       | Factor/status token names as Trade business semantics; arbitrary literal colors                                |
| `components/layout/left-icon-sidebar.tsx`                                        | 52 px rail content, 40 px round targets, 18 px icons, 1 px item gap, centered/scrolling heavy‑glass capsule, dark active item                                            | Reference module identities or phase labels                                                                    |
| `features/blueprint/components/doc-mode-shell.tsx`                               | Full‑viewport flex shell, 12 px sidebar padding, 16 px content gap and right/bottom gutters, bounded inner overflow                                                      | Blueprint mode, document toggle, or mock content as product features                                           |
| `components/shared/bento-grid.tsx`                                               | Container‑observed `wide/narrow/collapse` composition, `rowHeight=180`, `gap=16`, 560 px collapse and 700 px narrow evidence, 1/2/3/4/8 column spans and 1-4 row spans   | Its 1/2/3/4/8 API as the routed‑page grid, or its 560/700 container thresholds as global viewport breakpoints  |
| `components/layout/top-nav-bar.tsx`                                              | 56 px top bar, replaceable left context slot, light‑glass capsule tabs, notification/action zone                                                                         | Market ticker data as a universal header requirement; Dashboard uses the evidence‑bound status tape            |
| `components/ui/card.tsx`                                                         | White 12 px card, Mine border, restrained two‑layer shadow, compact structured header, optional canonical‑detail expansion                                               | The available `frosted` card variant; Dashboard business/data cards remain opaque                              |
| `components/ui/table.tsx`, `lib/data-table/components/data-table.tsx`            | Full‑width bounded scroll container, sticky 40 px dark header, 8 px cell padding, fixed‑layout percentage columns, ellipsis, row hover, and 96 px empty row              | Reference business columns, selected‑row/bulk behavior, or client‑side data authority                          |
| `lib/data-table/components/data-table-pagination.tsx`, `data-table-skeleton.tsx` | Compact responsive pager geometry, 32 px controls, explicit page‑size selector, first/previous/next/last order, and shape‑equivalent filter/header/body/footer skeletons | Reference selected‑row count, page‑size defaults, or unbounded in‑memory pagination                            |
| `lib/chart-tokens.ts`                                                            | Resolve CSS custom properties when Canvas or another JavaScript renderer cannot consume `var(...)` directly                                                              | Component‑local chart palettes or literal status colors                                                        |
| `features/blueprint/data/modules.ts`                                             | Visual density and route‑backed capsule‑navigation pattern only                                                                                                          | The stopped product's module order, labels, phase badges, mock metrics, workflow claims, or trading capability |

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
|    01 | Overview      | `/dashboard`     | Global Status View, attention queue, recent Owner outcomes                      |
|    02 | R&D           | `/rd`            | Sources, research requests, hypotheses, Artifacts, decisions                    |
|    03 | Backtest      | `/backtest`      | Exploratory runs, comparison, allowed diagnostics                               |
|    04 | Qualification | `/qualification` | Intake, opaque protected‑feedback frontiers, and bounded public outcomes        |
|    05 | Scanner       | `/scanner`       | Schedules, attempts, receipts, proposals                                        |
|    06 | Strategy      | `/strategy`      | Registry, lifecycle authorization, allocations                                  |
|    07 | Runtime       | `/runtime`       | Applied generations, instances, checkpoints, incidents                          |
|    08 | Portfolio     | `/portfolio`     | Performance, exposure, capacity, attribution                                    |
|    09 | Risk          | `/risk`          | Decisions, reservations, claims, adapter admissions, aggregate frontier, fences |
|    10 | Execution     | `/execution`     | Attempts, orders, fills, reconciliation, Recovery readback                      |
|    11 | Data          | `/data`          | Sources, PIT catalog, quality, corrections, freshness                           |
|    12 | Operations    | `/operations`    | Runs, workers, run/service logs, audit, Event Rail, telemetry, alerts           |
|    13 | Settings      | `/settings`      | Data‑source, Agent‑provider, notification, access configuration                 |

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

Overview is a read‑only Global Status View. It prioritizes incidents and unknown effects, attention decisions,
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

S1 V2 is a staged Owner journey, not one all-or-nothing request. Fresh authority review of candidate
`c72f44edb06f927afe6b67e5890f4610f4edc727` rejected recovery after the first transaction has committed the
Independence Basis Receipt, basis head, and Owner outbox but Qualification and the terminal Research receipt are
still absent. The Dashboard fixes this partial geometry as `SEALED_BASIS_PENDING_QUALIFICATION`: it binds the exact
request, original admission, basis receipt/identity, basis head/outbox, commit cut, missing next Owner receipt, and
next action `RESOLVE_SAME_REQUEST_IDENTITY`. Submit and successor controls are absent. Current authority is required
to create the basis stage; after it commits, the same request may only resolve or complete from sealed historical
custody across later cutover, revocation, or expiry. It never creates a second basis/head/outbox, while changed
request or admission identity is a conflict. The consumer review found no static consumer defect in the separate H1
claim/start/terminal fixes (31/31), but dynamic PostgreSQL, Windmill, provider, and browser acceptance remains
unavailable; none of this candidate is current product capability.

Fresh v5 review of `e5893fd5503c65be2afaae0da4a8b234b211c80f` proves that this geometry is still a target,
not reachable Workbench recovery. The public empty-body `RESOLVE` path must consume the complete sealed request
meaning and advance the same Historical completion used internally by submit; it cannot stop at a terminal-receipt
lookup miss. If Qualification committed before response loss and that projection later expires, only Qualification
Owner may issue a canonically linked renewal/successor (or equivalent recovery fact) for the sealed basis. Once the
complete S1 terminal receipt and TrialFamily have been verified, later read-time expiry preserves those historical
facts and changes only currentness and action admission. It never collapses them back to `SUBMITTED_OR_UNKNOWN`.

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
that rule on main as `CURRENT/PARTIAL`; the other producing Owners remain candidate‑only and unresolved. The UI
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
sealed‑receipt dependency restructuring exists and passes real Owner-store reread.

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

Execution and live pages are read‑only by default. Future control preserves
`TradeIntent -> RiskDecision/Reservation -> AuthorizedOrderCommand -> EffectAttempt -> VenueReadback/Reconciliation`
and current explicit effect authority. A visual button never shortcuts the chain.

### Windmill screen evidence and route decomposition

The observed authenticated page is `/apps_raw/get/f/trade/rd_workbench` in workspace `trade-rd`. At a 1280 px
browser viewport, Windmill contributes an approximately 208 px workspace sidebar and a 1072 px App iframe. Inside
that iframe, the deployed Raw App uses a 1040 px shell with 16 px side margins, 48/32 px top/bottom padding, and a
single vertical flow. The observed four-card candidate has 26 px card padding, 18 px radius, 18 px vertical margins,
and a source form with two 485.5 px columns separated by a 15 px gap. Primary, secondary, and quiet actions are
46.5 px high and stay in that order. Below 720 px, the form and receipt lists become one column.

The implementation evidence is the deployed iframe plus
`product/rd-workbench/f/trade/rd_workbench.raw_app/App.tsx`, `index.css`, `control-policy.mjs`, and the shared
`consumer_projection_v1.ts`. Trade main `81c519fade` renders cards `01` through `03` and now contains the merged H1
projection/control contract described above; H1 did not rebuild or revalidate the default Windmill iframe. Card
`04` exists only in the observed deployed S3 candidate. S3 replay therefore remains
`OBSERVED_CANDIDATE_NOT_CURRENT`: its screen is evidence for layout and interaction, not main or product admission.
The table below deliberately keeps repository-current and historically deployed evidence visible without implying
that all four stages coexist in current source or in one accepted deployment.

| Windmill stage                         | Observed internal order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Dashboard destination                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01` Source and research goal          | Editable proposal fields: Source URL, source cut, observed time, digest, license basis, required data, interpretation, hypothesis, mechanism, falsifier, expected observation, costs, capacity, Trial budget, precommitted stop rule, PIT/cost/slippage/capacity model identities, independence rationale, and stable request identity. The submit path then renders read‑only R&D basis receipt, Qualification frontier receipt/state, resolved local lineage/frontier, followed by S1 receipt. Submit / Resolve / Successor actions remain in that order | R&D / Intake; split into Source Evidence, Falsifiable Goal, TrialFamily Policy, and Canonical Authority Resolution Bento panels. No authority value is editable. Submit starts validation and the bounded authority chain; family formation remains internally disabled until every sealed row resolves |
| `02` Owner receipt and Research View   | Status row; native receipt/disposition/Intent; availability/phase, source cut, projection/valid‑through; TrialFamily root receipt and root identity/digest; INTENT membership receipt; Census member/fact; Census head/frontier; exact next action; conditional warning                                                                                                                                                                                                                                                                                    | R&D / Research selected‑request detail and `OwnerReceiptDrawer` plus `TrialFamilyReceiptPanel`                                                                                                                                                                                                          |
| `03` Strategy Artifact Formation       | Frozen Intent, build request, attempt, Run / Resolve / Successor actions, status, Formation receipt, Research View, Artifact Review including deterministic double‑build and sandbox policy, Artifact -> TrialFamily binding, binding receipt, bound family/frontier, exact next action and conditional warning                                                                                                                                                                                                                                            | R&D / Artifacts selected‑artifact detail plus `ArtifactTrialFamilyBindingPanel`                                                                                                                                                                                                                         |
| `04` Exploratory Replay and Run Detail | Replay request, run attempt, Artifact, Build Receipt, three actions, status, three Owner receipts/views, actual identities, diagnostics, bounded summary, next action, permanent non‑claims                                                                                                                                                                                                                                                                                                                                                                | Backtest / Exploratory plus `RunDetailDrawer`; Compare and Diagnostics reuse the same receipt‑backed view                                                                                                                                                                                               |

#### Exact S1 V2 and S2 page skeleton

The S1/S2 contract below combines the authenticated historical default-Web geometry with the repository-current H1
projection and control policy. The merged source behavior is `CURRENT/PARTIAL`; default-Web deployment of that exact
source remains `NOT_ADMITTED`. Desktop uses the canonical 12-column route shell; `P` is 8 columns and `Q` is 4.
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
P4 Canonical Authority Resolution (read‑only)
   R&D basis: state | receipt identity | basis identity | cut [12]
   stage custody: SEALED_BASIS_PENDING_QUALIFICATION | request/admission | basis head/outbox | cut [12]
   Qualification frontier: state/GENESIS_EMPTY | receipt identity | frontier identity | cut [12]
   R&D lineage: state | predecessor frontier | census cut [12]
I  stable request identity strip [12]
A  [Submit to R&D Owner] [Resolve same identity] [Create successor identity]
Q  source non-authority warning -> form completeness -> Owner custody incident (when active) ->
   current stop predicate
T  request list; selection opens the S1 detail drawer below

S1 selected-request drawer / /rd/research detail
S  semantic label | ACCEPTED / SUBMITTED_OR_UNKNOWN / REJECTED_NO_WRITE /
   IDENTITY_CONFLICT / unavailable
H  Product Edge handoff | admission receipt/cut | downstream resolver version/state |
   R&D custody state/stop predicate; committed admission plus missing R&D receipt is
   SUBMITTED_OR_UNKNOWN, never REJECTED_NO_WRITE
B  sealed basis stage -> basis receipt/identity -> basis head/outbox -> commit cut ->
   missing Qualification/Research terminal -> RESOLVE_SAME_REQUEST_IDENTITY; no Submit/successor
   merged Resolve consumes sealed complete typed request meaning and enters Historical completion;
   terminal-only lookup miss or caller-resubmitted request bytes cannot satisfy this path
K  Qualification response loss -> committed projection -> expiry -> Owner-issued verified renewal/successor ->
   fresh locked readback; R&D/Product Edge/Dashboard cannot extend validity or create that recovery fact
D  verified terminal custody -> Research receipt/Intent -> TrialFamily root/member/census stays visible after
   linked-view expiry as STALE/read-only; remove positive actions, never return SUBMITTED_OR_UNKNOWN
R1 native receipt -> disposition -> Research Intent
R2 availability/phase -> linked Artifact availability -> source cut -> projection/valid-through ->
   Owner‑projected read-time freshness/action
F  TrialFamily root receipt -> family identity/root digest -> INTENT membership receipt ->
   Census member/fact -> Census head/frontier
X  restart/cache loss: immutable request identity -> Resolve -> identical receipt/Intent/family/frontier;
   replacement operational run link stays separate from Owner truth
N  current linked view: ARTIFACT_AVAILABLE / AVAILABLE / REVIEW_ARTIFACT
   expired linked view: STALE / ARTIFACT_AVAILABLE / RESOLVE_SAME_REQUEST_IDENTITY
W  one state-specific warning; ACCEPTED without complete direct F is unavailable, never success;
   downstream resolver unavailable disables S2 and exposes only Resolve same identity
C  Owner custody incident, when active: affected Owner/store/tables -> last trusted cut/counts ->
   current direct readback -> RESTORED_REVALIDATION_PENDING -> recovery evidence class;
   fixed actions [Open incident evidence] [Copy affected locator], with no Restore/Reconstruct/Clear

/rd/artifacts selected-artifact drawer
G  ActionAdmissionGate, always visible before attempt/provider sections:
   R cached Research View/valid-through/currentness is historical display only, never effect authority
   U UI same-request Resolve: IDLE -> PREFLIGHTING; [Checking…] [Cancel] while no Artifact request exists
     failure/cancel -> REVALIDATION_REQUIRED with no attempt and no same-attempt Resolve
   P ArtifactRequestAdmissionPanel: build request + attempt + Intent + channel -> exact operation/schema/effects ->
     Product Edge admission locator/receipt/final cut -> sealed current-Research evidence identity/digest ->
     source S1 admission locator -> R&D resolver/version/cut -> stop predicate
   Sending the Artifact request changes U to ADMITTING: [Submitting…], no Cancel and no fake percentage.
   Only a bounded typed server projection changes P to informational ADMITTED. The current Workbench wire does not
   expose its stored current-Research custody, so P keeps fixed unavailable geometry rather than inferring success.
   A post-send unknown transfers to SUBMITTED_OR_UNKNOWN + SameIdentityResolvePanel. Server success reveals the
   admitted-attempt section; A0 remains absent until the separate provider claim admission exists.
I  Frozen Intent -> build request identity -> attempt identity
A0 sealed invocation admission -> current authorization/frontier -> policy-equivalent binding/head ->
   exact manifest -> historical request‑admission lineage -> final locked write cut
A1 CLAIMED response-loss recovery + exact next action RUN_BOUNDED_EXECUTION_AGENT;
   Run requires exact A0 receipt equality, not the historical admission or claim alone
   wire binds invocation_admission_receipt_identity + invocation_admission_receipt_digest;
   claim/non-success wires omit optional family keys; explicit null is a schema mismatch;
   fresh Research read is never a post-claim start gate; recovered CLAIMED dispatches start directly,
   never prepare
   [Run bounded Agent + sandbox] [Resolve same attempt] [Copy claim] [Open operational run]
A2 INVOCATION_STARTED / OUTCOME_UNKNOWN
   [Resolve same attempt] [Copy claim] [Open operational run]
   Run bounded Agent and Create successor are absent
L  LEGACY_TERMINAL_QUARANTINED -> original SUCCESS / FAILED_NO_ARTIFACT /
   REJECTED_NO_WRITE / OUTCOME_UNKNOWN -> historical receipt/custody generation/quarantine reason;
   sparse rejection may omit Intent identity/digest; family/provider/actions remain absent
   [Resolve same attempt] [Open historical receipt] with no Artifact/provider/successor
S  semantic label | SUCCESS / SUBMITTED_OR_UNKNOWN / FAILED_NO_ARTIFACT /
   REJECTED_NO_WRITE / OUTCOME_UNKNOWN / unavailable
C  durable terminal and currentness are separate: linked Research View STALE keeps SUCCESS history but
   removes every review action and permits only Resolve same attempt
R1 Formation receipt -> disposition/failure -> Artifact/Build Receipt
E  FAILED_NO_ARTIFACT canonical receipt identity binds attempt + Intent + disposition + failure code +
   commit time; optional family keys are absent; failure code independently determines disposition;
   stale linked Research never removes or rewrites the receipt and receipt fields never self-verify
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
H  Operations / Runs                        [Refresh] [Auto-refresh: Off v]
N  [Runs] [Workers] [Service Logs] [Audit] [Event Rail] [Telemetry] [Alerts]
F  [Runs|Dependencies] [All|Queued|Running|Succeeded|Failed|Unknown]
   [Search path / run ID] [Duration v] [Concurrency v] [More filters]
S  Queued | Running | Unknown | Completed/Failed
T  RunTable / date group
   Status | Started | Duration | Path | Trigger/principal | Tag | Owner outcome
   row selection -> D; final column [Open] -> /operations/runs/:runId
D  RunSummaryCard: statuses, immutable run/operation/Owner locators, retention
   [Open run] [Resolve Owner outcome]
B  shown rows / filtered total | Rows per page [25|50|100] | Page n of m
   [First] [Previous] [Next] [Last]
```

The Runs table uses fixed layout at `>=1280 px`: sticky header 40 px, date-group header 32 px, body row minimum
44 px, 8 px horizontal cell padding, and column shares `Status 10 / Started 14 / Duration 9 / Path 21 /
Trigger-principal 14 / Tag 10 / Owner outcome 14 / Open 8`. Path, trigger/principal, tag, and Owner outcome use one
line plus ellipsis; hover/focus reveals the same redacted value, never raw payload. Default order is effective run
time descending, then immutable run ID ascending. Effective time is `started_at`, falling back to `received_at`
for an unstarted run; its Started cell remains an em dash. Only Started and Duration headers expose sort controls,
each cycling descending then ascending then back to the default order. Date groups use the selected display time
zone and remain newest first; changing filter, time zone, grouping, or sort returns to page one.

The four `S` cards never change count or position. In the `Runs` segment their labels are exactly `Queued`,
`Running`, `Unknown`, and `Completed / Failed`; in `Dependencies` they are
`Queued dependencies`, `Running dependencies`, `Unknown dependencies`, and `Completed / Failed dependencies`. The first three values are one
integer count and the fourth is `completed / failed` as two integer counts in that order. A missing count is an em
dash in its existing value slot. Counts use the selected kind plus every applied non-status filter but ignore the
selected status, so choosing one status never erases the other three summaries.

The control contract is closed rather than inherited from Windmill defaults. `Runs` is the default kind segment;
`Dependencies` is its only peer. `All` is the default status. Search is empty by default and matches only redacted
path or immutable run ID. `Duration` is `Any` by default, followed by `<1 s`, `1-10 s`, `10-60 s`, and `>=60 s`.
`Concurrency` is `Any` by default, followed by `Has key` and `No key`; it describes the presence of the immutable
dispatcher concurrency key, not live worker count. The header auto-refresh menu is `Off` by default, followed by
`5 s`, `15 s`, and `30 s`. A cadence change takes effect immediately, does not reset pagination, and performs only
the same read as Refresh; hidden or offline tabs do not queue catch-up reads.

Kind, status, Duration, and Concurrency apply immediately on selection and return to page one. Search applies
exactly 300 ms after the last edit; Enter or clearing the field applies immediately, while blur adds no separate
transition. A later search application cancels the earlier in-flight list read. The explicit Started and Duration
sorts never reorder the newest-first date-group rows: they sort only inside each group, or the whole list when
grouping is `None`. Started places rows with `started_at` first in the chosen direction, ties by immutable run ID
ascending, then places unstarted rows ordered by `received_at` in that direction and run ID ascending. Duration
places rows with a duration first in the chosen direction, ties by effective time descending then run ID ascending,
and places missing-duration rows last by effective time descending then run ID ascending.

`More filters` opens one 360 px popover anchored below that button. Its fields are ordered `Trigger` (`All`
default, `App`, `Webhook`, `Other`), `Principal` (empty exact-text input), `Tag` (empty exact-text input), `Time cut`
(`Last 24 h` default, then `Last 1 h`, `Last 7 d`, `Last 30 d`, `Custom`), `Display time zone` (`UTC` default,
`Browser local`), and `Group by` (`Day` default, `Hour`, `None`). `Custom` adds start then end inputs interpreted in
the selected display time zone. Its footer is `[Reset filters] [Apply]`; values are staged until Apply, Escape or
outside-click discards them, and the button badge is the count of non-default applied fields. Reset restores these
six defaults and applies immediately. `None` removes date-group rows; `Day` and `Hour` retain newest-first groups.

Pagination defaults to 50 rows with only 25, 50, and 100 available. The footer keeps shown rows, filtered total,
page size, `Page n of m`, then First/Previous/Next/Last in that order; unavailable totals retain the same slots with
em dashes and disable page movement. Loading is exactly four summary skeletons, the two filter rows, one 40 px
header, three 32 px date-group bars for the default `Day` grouping, ten 44 px rows, and the complete pager skeleton.
`Hour` uses the same three group bars; `None` uses no group bar and still exactly ten rows. Unfiltered empty, filtered
empty, permission denied, and backend unavailable each occupy one 96 px full-width table row with a distinct title,
one-line explanation, and no fabricated count. Only backend unavailable exposes Refresh through the existing route
header.

At `768-1279 px` the table retains the same order in a 960 px minimum-width bounded horizontal scroller. Its 8%
action cell keeps the standard 8 px horizontal padding and contains a 32 px text Open button, a 4 px gap, and the
24 px More button when admitted. Buttons plus padding occupy exactly 76 px, fitting the 76.8 px cell at the 960 px
minimum table width; wider tables retain the same left-aligned geometry. Below
`768 px` it becomes a six-row run card: status + effective time; path; Owner outcome; trigger/principal; duration +
tag; then Open. Cards have 12 px padding, 12 px gap, and 156 px minimum height; six loading cards replace the table
rows, while the same filter order and pager remain. Card selection opens the same `D`; no checkbox, column chooser,
selection count, bulk action, or swipe action exists.

`Show schedules` and `Show future jobs` are absent by default. They append to the second `F` row only after a typed
schedule/future consumer is admitted. The 8% `Open` cell contains `[Open]` first and, only for a completed run with
a disposable cache plus a current `OperationalActionEnvelope`, a 24 px `[More]` button second. Its sole menu item
is `Delete disposable cache`. At `>=768 px` that item opens a 480 px dialog ordered as immutable run ID, cache locator, Owner
readback locator, the fixed statement `Business facts are unaffected`, consequence, and stop predicate; footer
buttons are `[Cancel] [Delete cache]`. Below `768 px` it uses a full-screen sheet of `100vw × 100dvh` with zero
radius; the same ordered fields scroll inside it and the same footer stays sticky at the bottom. Missing eligibility
or envelope removes More rather than disabling it. The mobile card places the same two controls left-to-right in
its sixth row. The list has no bulk rerun, bulk delete,
editor link, checkbox, or other overflow action. Empty, filtered-empty, permission-denied, and backend-unavailable
remain distinct as specified above.

#### Exact Workers read-only skeleton

`/operations/workers` and `/operations/workers/:workerId` are `DRAWABLE_EXACT` and
`IMPLEMENTATION_ADMITTED` for first-party RunStore GET readback only. This Workers-specific closure supersedes
the earlier Windmill worker-table sketch, not any other route's maturity. It neither reads the Windmill
`rd-product-edge` administration surface nor authorizes cutover, Owner effects, or production writes.

```text
H  Trade worker custody / Shadow read workers                         [Refresh]
N  Existing Operations tabs; Workers remains in its existing position
S  [Fleet] Online | Expired                 [Workload] Claimed | Active
T  [Lease: All / Available / Expired]                  [Search workers]
   Worker | Lease | Jobs | Last run | Operations
D  Identity + lease badge -> Lease -> Activity -> Last run -> Capabilities
   Heartbeat history unavailable -> artifact digest -> [Back to worker list]
```

- Layout: `PanelFrame` (flat) contains header then body; body contains `CompactStatusBar` then
  `SplitBento(T,D)`. `P/Q` are absent (zero reserved height). At widths >=1280 px, columns are
  `minmax(560px,1.55fr) minmax(300px,.8fr)` with 12 px gap and content-driven heights; D is sticky at top 0.
  Below 1280 px, T precedes D in one column. At all widths T retains horizontal overflow, not a replacement
  card list or full-screen drawer. The 62 px minimum-height summary pill scrolls horizontally when necessary;
  each group is at least 52 px tall, with a 44 px title pill followed by its values. Shared theme tokens,
  title/action header, rounded inner content, subtle interrupted separators and Lucide icons remain authoritative.
- Summary: Online counts available leases at the list observation cut; Expired counts expired leases;
  Claimed sums durable job counts; Active sums active job counts. These are operational observations, not
  current process health or unbound-run readiness. A valid empty list yields four zeros; initial, invalid,
  transport-error or unavailable list yields four `-` values, never zeros inferred from failure.
  Detail availability cannot change list counts. No group, memory or occupancy estimate is invented.
- Table: columns in exact order are Worker (minimum 250 px, identity link then registered time), Lease
  (minimum 125 px, available/expired badge), Jobs (105 px, active / claimed), Last run (minimum 220 px,
  identity then state/time; absent claim shows Unavailable / No durable claim), Operations (120 px, exact
  registered-operation count). All headers/cells align left. Every column supports ascending/descending sort;
  Jobs sorts active then claimed, Operations sorts count. Default is newest last-run time first, falling back
  to registration time; identity orders equal-time input rows. Browser validation requires unique identities,
  not JavaScript ordering of database-collated rows. No grouping, checkbox, bulk action or column chooser.
- Filters: one inline Lease selector with All, Available, Expired in that order, followed by right-aligned
  Search workers (maximum 128 characters). Case-insensitive local search covers identity, artifact digest,
  last-run identity/state and registered operations. Shared Worker/Lease column filters remain local.
  Pagination follows filtering: 20 rows initially, choices 20/50/100, range then previous/next controls;
  changing lease/search resets the page. Row selection updates D on the list route; the identity link opens
  the exact route. Exact-route selection stays bound to the requested identity despite list/filter changes.
- Detail: heading is Selected worker or Exact worker readback, exact identity, lease badge. Four ordered
  clusters have 8 px outer gap/padding, 13 px radius and 13 px by 14 px inner padding; facts use two equal
  columns with 12 px gap. Lease: Registered, Expires. Activity: Claimed, Heartbeat, with active count in title.
  Last run: Run link, Claimed at, with state or No claim in title. Capabilities: full-width Registered
  operations, in registry order. Then show Heartbeat history unavailable, the explanation that only latest
  heartbeat/deadline are retained and memory/host are not inferred; footer shows artifact digest and
  no-unbound-run-readiness explanation. Back to worker list appears only on the exact route.
- State geometry: initial load uses the same header/summary and compact Worker store unavailable region
  with `READING_WORKERS`; loading-row count is exactly zero, not synthetic worker rows. Refresh is disabled
  and labelled Reading while pending; during refresh the previous observation remains until replacement,
  without claiming freshness. Valid empty and filtered-empty tables retain columns/toolbar and a minimum
  220 px empty body; no worker detail is invented. Partial list/detail availability is independent:
  successful D remains beside failed T; successful T remains beside unavailable D. Invalid JSON/envelope,
  transport error and permission-denied responses produce no data from that failed endpoint and use its
  compact unavailable region; exact D retains requested identity, unavailable badge/reason and Back link.
  Missing worker uses the same D geometry with WORKER_NOT_FOUND. The wire has no separate stale/partial
  status: expired lease remains an observed expired row; unsupported stale/partial envelopes fail closed,
  and no timer promotes old data to live health. A list error never overrides an independently valid D.
- Action order/admission: header Refresh; table identity navigation; D Last run link only with exact run
  identity; exact-route footer Back to worker list. Filters, sorting and pagination are local. All remote
  reads use GET/no-store and strict endpoint-specific envelopes; D must echo and match the path identity.
  There is no mutating action or operational/domain action envelope on this surface. Create/edit config,
  restart, cache-clean, REPL, autoscaling, host/group/version and heartbeat-history fabrication stay excluded.

`/operations/service-logs` is a read‑only split pane:

```text
H  Operations / Service Logs                  [Refresh] [Auto-refresh on|off]
N  Operations tabs in the fixed order above
F  [Time range] [Worker|Server] [Service/group] [Instance/host] [Severity] [Search]
S  Error count | Worker hosts | Server hosts | Selected instance
P  Instance list: service/group, shortened host, readiness, last observed
Q  Selected instance: exact identity, service/group, host, readiness, source cut, last observed
T  ServiceLogPanel: Timestamp | severity | service | instance | correlation | bounded message
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
P  OperationAuditTable: Time | audit ID | principal | operation | outcome | target | correlation
Q  Fixed selected-correlation stack, in order:
   AuditCorrelationCard -> InvocationAdmissionReceipt -> InvocationClaimReceipt -> ProviderInvocationStateCard
   exact target/correlation, request/run locator, redaction reason, receipt/state stops
T  Timeline: selected operation events in canonical order; no replay action
B  Retention / redaction disclosure                 [Copy audit locator]
```

Windmill CE hides resource detail, so current migration evidence displays `redacted` and never fabricates a target.
The first-party `OperationAuditStore` later records exact target/correlation; the page still has no edit, delete,
dismiss, or replay action. On mobile the split pages preserve `H -> N -> F -> S -> P -> Q -> T -> B`; Runs and
Workers omit `P/Q`. Runs retain full-width `T` and open `D` as a full-screen overlay with route-local filter
drawer; Workers instead retain the inline filters and stacked T/D geometry of their exact skeleton above.

#### Exact Run Detail skeleton

`/operations/runs/:runId` is a full route; `DetailDrawer` renders the `RunDetailPanel` quick-inspection projection
at 480 px. Both use the same ordered slots and route-backed tabs:

```text
H  Breadcrumb / Runs > path > shortened run ID
   [Copy locator] [Refresh] [Cancel queued dependency…?] [Resolve same identity] [Download bounded result/log]
S  Semantic status | operational status | duration | received/started/completed
P  Run identity, path, kind, tag, trigger, principal, worker, version, hash, language,
   memory peak, parent/root correlation, retention; then allowlisted Inputs key/value table
   and `n fields withheld` disclosure with reason chips; RunWorkerCompatibilityMatrix is bound to this run ID
   OperationalCancellationReceiptCard is the fixed read-only post-attempt location: pending/unavailable/receipt
Q  Owner Outcome: availability, source Owner, next legal action, receipt identity, source cut
T  Result: allowlisted/redacted bounded JSON/tree view with Copy field, Copy JSON,
   Download bounded result, and the same withheld-field disclosure
   then the fixed nested tabs [Logs] [Metrics] [Traces] [Assets]
   Logs   = search/filter/autoscroll/download + bounded line viewport + truncation notice
   Metrics= NotCollected/Unavailable/time-series
   Traces = NotCaptured/Unavailable/request spans
   Assets = Empty/disposable attachments only; Owner artifacts appear only as receipt locators
A  DependencyCancellationPanel in the fixed action slot, present only for a queued, unclaimed,
   zero-domain-effect dependency run with a current OperationalActionEnvelope. The third H action opens/focuses
   this confirmation; the panel's sole effect button is Cancel queued dependency. It stays disabled as Cancelling…
   while CAS is pending, then A and H slot 3 disappear. P retains the immutable receipt or explicit unavailable state.
```

Buttons never inherit Windmill's generic `Run again`, `Share`, `Edit`, script editor, worker REPL, restart, or cache
clean actions. A domain route may offer a successor request only when the current Owner manifest admits it; the run
page itself offers navigation, copy/download of bounded operational evidence, refresh, and same-identity resolve.
Inputs and Result never render arbitrary stored JSON. The exact operation/version registry labels every displayable
field and its sensitivity; secret, protected, unknown, and schema-mismatched fields have no value slot. Copy field is
disabled for a withheld value, while Copy JSON and Download bounded result serialize the same redacted projection
shown on screen, never the raw job payload or result bytes. If the registry entry is missing or mismatched, both
panels preserve their geometry and render `Unavailable` with the operation/version and stop reason.

#### Windmill-derived action state machine

| State                                                                    | Primary action                              | Secondary action                                                       | Quiet action                                                               | Required presentation                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial valid input                                                      | Submit or Run enabled                       | Resolve disabled unless an exact imported identity tuple is complete   | Successor disabled                                                         | Neutral `NOT_SUBMITTED`; editable identity and semantic fields                                                                                                                                                                                                                      |
| Effect‑capable request sent; delivery pending                            | Disabled and labelled `Submitting…`         | No Cancel; Resolve appears only after the bounded call returns unknown | Disabled                                                                   | `ADMITTING` uses amber pending text/icon and no fake percentage. The request may already have written; timeout/disconnect transfers to the domain unknown state rather than claiming zero write or returning to preflight                                                           |
| Unknown outcome                                                          | Disabled                                    | Resolve same request/attempt identity enabled                          | Disabled                                                                   | Persistent warning, immutable identity tuple, no naked retry                                                                                                                                                                                                                        |
| Historical OA expired; canonical equivalent successor unavailable        | Disabled                                    | Open/Copy historical authorization evidence                            | Disabled                                                                   | Current authority row unavailable; immutable snapshot remains; no renewal or replacement selector                                                                                                                                                                                   |
| Admission successor distance greater than one                            | Disabled                                    | Open/Copy authorization chain evidence                                 | Disabled                                                                   | Show admission/current generations, distance and `DIRECT_SUCCESSOR_REQUIRED`; never select chain head                                                                                                                                                                               |
| Product Edge admission committed; downstream R&D custody unavailable     | Disabled                                    | Resolve same request identity enabled                                  | Successor disabled                                                         | `SUBMITTED_OR_UNKNOWN`; admission receipt/outbox plus resolver stop predicate; never rejection                                                                                                                                                                                      |
| Sealed S1 basis; Qualification and terminal Research receipt absent      | Disabled                                    | Resolve same request identity enabled                                  | Disabled                                                                   | TARGET only: `SEALED_BASIS_PENDING_QUALIFICATION` shows basis receipt/head/outbox and missing next receipt; Resolve must advance sealed Historical completion. Rejected `e5893fd550` only repeats a terminal lookup miss, so it remains unavailable rather than pretending recovery |
| Verified S1 terminal; linked view stale                                  | Disabled                                    | Resolve same request identity enabled                                  | Open/Copy terminal evidence                                                | Amber `STALE` currentness only; verified Research receipt and TrialFamily remain neutral/read‑only, every successor/S2/review action is absent, and the state never becomes green success or gray unavailable                                                                       |
| Cached `AVAILABLE`; S2 has not started                                   | `Check & Run` enabled                       | Refresh current Research state                                         | Open/Copy historical evidence                                              | Neutral `IDLE`; cached currentness is display‑only and the effect gate is not admitted                                                                                                                                                                                              |
| S2 same‑identity Research preflight pending                              | Disabled and labelled `Checking…`           | Cancel enabled                                                         | Disabled                                                                   | `PREFLIGHTING` is read‑only. An accessible live region plus spinner/amber text reports the state; no Artifact request or attempt exists                                                                                                                                             |
| S2 preflight cancelled, timed out, malformed or transport‑unavailable    | Disabled                                    | Refresh/Resolve same Research request identity                         | Open/Copy historical evidence                                              | `REVALIDATION_REQUIRED`; historical S1 evidence remains visible but its current‑positive action is withdrawn. No Artifact attempt exists, so same‑attempt Resolve is absent and Artifact is not labelled unknown                                                                    |
| S2 Owner preflight returns stale or unavailable                          | Disabled                                    | Resolve same Research request identity                                 | Open/Copy historical evidence                                              | Only Owner readback may label `STALE`; unavailable remains non‑positive. Product Edge admission, R&D attempt, invocation admission, claim and provider effect are all absent                                                                                                        |
| S2 preflight current; Artifact request dispatched                        | Disabled and labelled `Submitting…`         | No Cancel                                                              | Open/Copy preflight evidence                                               | `ADMITTING`; server repeats the gate at the final OA → Product Edge → R&D cut and requires the exact operation/schema/effect set. Navigation cannot imply cancellation                                                                                                              |
| S2 bounded server admission projection returned                          | Pipeline continues; no second submit button | Open/Copy admission                                                    | Open operational run                                                       | Informational blue `ADMITTED`, never green. `ArtifactRequestAdmissionPanel` shows the receipt/cut and sealed current‑Research projection; missing public projection preserves unavailable geometry                                                                                  |
| S2 request dispatched; admission/write outcome unknown                   | Disabled                                    | Resolve same attempt identity                                          | Open/Copy preflight and transport evidence                                 | Domain `SUBMITTED_OR_UNKNOWN`; write outcome is unknown, so no retry, Cancel, preflight reset, success badge or zero‑write claim                                                                                                                                                    |
| FirstMutation original OA stale/revoked; immediate successor current     | Disabled                                    | Open/Copy original and successor evidence                              | Disabled                                                                   | Fixed two‑row currentness geometry, original first; `ORIGINAL_AUTHORIZATION_NOT_CURRENT`. Successor never substitutes original authority and no basis/rejection/invocation fact is written                                                                                          |
| `CLAIMED` with missing or mismatched invocation admission                | Disabled                                    | Resolve same attempt identity enabled                                  | Disabled                                                                   | Unavailable A0 receipt slot, claim identity retained, no Run or replacement claim                                                                                                                                                                                                   |
| Claim wire schema/version mismatch                                       | Disabled                                    | Resolve same attempt identity enabled                                  | Disabled                                                                   | Fixed A0/A1 slots unavailable; show operation/schema and both expected receipt fields; no Run                                                                                                                                                                                       |
| Rust optional family keys omitted but gateway expects `null`             | Disabled                                    | Resolve same attempt identity enabled                                  | Disabled                                                                   | Resolution‑specific A1/terminal slot unavailable; display absent‑vs‑null schema stop; no inferred fact                                                                                                                                                                              |
| Sealed `CLAIMED`; fresh Research read is stale or unavailable            | Run bounded Agent + sandbox enabled         | Resolve same attempt identity enabled                                  | Disabled                                                                   | Historical claim/attempt custody is the gate; Run dispatches start directly and never calls `prepare`                                                                                                                                                                               |
| Started claim; Research expires before terminal/readback                 | Disabled                                    | Resolve same attempt identity enabled                                  | Disabled                                                                   | Terminalize/read exact sealed custody; stale linked view disables follow‑on actions but preserves receipt                                                                                                                                                                           |
| Verified legacy terminal                                                 | Disabled                                    | Resolve same attempt identity enabled                                  | Disabled                                                                   | Fixed panel shows original four‑value disposition and historical receipt; no Artifact/provider/successor                                                                                                                                                                            |
| Terminal success with Owner receipt                                      | Disabled for the completed identity         | Resolve available only when the Owner manifest says so                 | Create successor only when `next_legal_action` admits it                   | Green semantic state, receipt and source frontier; a green Windmill job alone is insufficient                                                                                                                                                                                       |
| Rejected/no‑write terminal                                               | Disabled                                    | Resolve original receipt when admitted                                 | Create successor only when the Owner explicitly admits corrected semantics | Rejection code, zero‑created‑fact statement, original identity preserved                                                                                                                                                                                                            |
| Identity conflict                                                        | Disabled                                    | Resolve original identity only                                         | Disabled until the original meaning is known                               | Conflict state; never overwrite or imply absence                                                                                                                                                                                                                                    |
| Missing receipt, invalid evidence, stale, unavailable, permission denied | Disabled                                    | Read/resolve only if a typed Owner operation exists                    | Disabled                                                                   | `NotAdmittedNotice` or stop predicate; no optimistic terminal                                                                                                                                                                                                                       |

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
|             | A one admitted action: domain Owner | operational envelope       |
+-------------+------------------------------------------------------------------+
                                                    D detail drawer: 480 px max
```

`RouteGrid` owns this page-level geometry and is distinct from the reference-derived `BentoGrid`. At viewport width
`>=1280px`, it has 12 equal logical columns: `S1-S4=3` each, `P=8`, `Q=4`, and `T/A=12`. At `768-1279px`, it has
six columns: each summary is three columns and wraps two per row, while `P/Q/T/A=6` and remain in source order.
Below `768px`, it has one column and the order is `H -> S1 -> S2 -> S3 -> S4 -> P -> Q -> T -> A`; `D` is a
full-screen overlay rather than a grid slot. `RouteSlot` owns only these spans and may not accept an arbitrary
caller-supplied column count. Panel-internal `BentoGrid` retains container-observed `wide/narrow/collapse`, a
180 px minimum auto-row, 16 px gap, 1/2/3/4/8 columns and 1-4 row spans; it never changes route order or drawer
behavior.

- `H` is 72-96 px and always contains page title, one-line purpose, scope selector when applicable, Owner/source
  cut, freshness badge, and only route-level actions.
- `S1-S4` are 104 px summary cards. A missing metric keeps its slot and displays `Unavailable`; the grid never
  closes gaps by substituting zero.
- `P` and `Q` are one 320 px minimum row. `Q` contains context, stop predicates, evidence completeness, or the
  currently selected identity; it never duplicates `P` as a second writer.
- `T` is the canonical list/history/comparison surface. Selection opens `D`; it does not replace the URL.
- `A` appears only for one admitted `ActionAdmissionGate` branch. The `domain` variant requires the Owner projection
  and contains the action label, target identity, consequence, stop predicate and one primary button. The
  `operational` variant requires a current `OperationalActionEnvelope`, keeps the same geometry, and cannot host a
  domain action or substitute for Owner admission.
- `D` is 480 px at desktop, 400 px at compact desktop, and full-screen below 768 px. Its order is status, immutable
  identities, Owner receipt, source cut/frontier/freshness, evidence, separate operational job link, recovery, then
  the same `A` action. It never contains a second semantic form.
- Loading uses shape-preserving skeletons for every occupied slot. Empty, partial, stale, unavailable, unknown,
  rejected, conflict, quarantined, and permission-denied states retain the same geometry.

#### Skeleton completeness gate

A route name, an `S/P/Q/T` slot assignment, or a PascalCase label is not by itself an implementable component
contract. The following status is normative and prevents the experimental chapter from overstating how much of the
Dashboard can already be drawn:

| Completeness status                   | Current pages or surfaces                                                                                                                                                                                                                                                         | Admission meaning                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DRAWABLE_EXACT`                      | Operations Runs `/operations`, Run Detail `/operations/runs/:runId`, Workers `/operations/workers` and `/operations/workers/:workerId`; R&D Research `/rd/research` directory and Artifacts `/rd/artifacts`; Market Data `/data` and `/data/pit-catalog`; all four Runtime routes | The chapter fixes route slots, internal field/column order, dimensions or responsive transformation, state geometry, and button order. Fail‑closed routes are drawable with fixed unavailable/not‑ready values; this status does not make their backend or Dashboard consumer available                |
| `DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY` | R&D Intake `/rd` composer and authority‑resolution panels; R&D Research `/rd/research` selected‑request detail beyond the admitted directory                                                                                                                                      | The named content/detail region is exact, but its enclosing route list still lacks one or more of summary labels, table columns, row actions, sort, pagination, or loading‑row geometry; the whole route is not drawable or implementable                                                              |
| `BLUEPRINT_ONLY_NOT_IMPLEMENTABLE`    | Every other complete route in the registry, explicitly including Service Logs, Audit, Event Rail, Telemetry, and Alerts, plus all four Portfolio routes                                                                                                                           | The registry fixes navigation position, route slots, named page‑local composites, and button intent only. An unattended agent must not infer missing list behavior, timeline rows, responsive table transformation, or internal geometry from a component‑like name or excluded Windmill/native layout |

Names referenced by a route but absent from the reusable component inventory are page-local composite labels, not
hidden reusable atoms. Promoting one blueprint to `DRAWABLE_EXACT` requires this chapter to specify, in both
languages: all summary labels and value states; ordered `P/Q` children with dimensions; every `T` column, row
action, grouping, sort, filter, pagination and loading-row count; ordered `D` fields; empty/partial/stale/
unavailable/error/permission-denied geometry; and exact button order plus admission gate. Its reusable atoms must
then be added to the inventory. Dashboard implementation is `IMPLEMENTATION_ADMITTED` only for those exact routes
and shared atoms, delivered as bounded reviewable slices with fail-closed data/effect boundaries. A
`DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY` or `BLUEPRINT_ONLY_NOT_IMPLEMENTABLE` surface remains prohibited until the
same bilingual completeness closure promotes it; implementation admission never promotes backend availability,
Owner acceptance, replacement readiness, Windmill cutover, or production effects.

### Routed page blueprint registry

The following registry is normative for skeletons. Buttons appear left to right in the listed order. `Open`,
`Copy`, `Refresh`, filters, and compare selection are read‑only UI actions; every other button additionally needs
the matching admitted `ActionAdmissionGate` branch at render time: a named Owner action manifest for `domain`, or a
current `OperationalActionEnvelope` for the explicitly registered `operational` control.

For `/rd`, `/rd/research`, and `/rd/artifacts`, the H0/H1 defect narratives retained in the last column are
historical rationale. The current disposition is the merged H1 readback at the start of this chapter: the named
source contracts are `CURRENT/PARTIAL`, their exact default-Web deployment remains unvalidated, the
`ArtifactRequestAdmissionPanel` remains fixed unavailable until a bounded server projection exposes its required
custody, and actual provider execution remains `NOT_ADMITTED`. This rule resolves status only; it does not change
the fixed panel, button, or state geometry in the registry.

The currently admitted `/rd/research` and `/rd/artifacts` routes are bounded read-only directories and supersede
the broader future Research and Artifacts registry rows below for implementation. Neither has a summary strip or
split detail pane. Their only `P` surfaces are `ResearchDirectory` and `ArtifactDirectory`. Research has no detail
link in its admitted slice; Artifact detail remains a separate identity-bound URL. The broader Research detail,
admission, outcome, review, binding, replay, and security-evidence panels in the registry stay future blueprint
content and are not inferred into these slices.

#### Overview and R&D

| Tab and route                    | Fixed `S / P / Q / T` contents                                                                                                                                                                                                                                                                                                                                                                     | Buttons in order                                                                                                                                                                                                                                                          | Default evidence state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status `/dashboard`              | Four summaries: incidents, unknown effects, stale/unavailable Owners, active work; `P=GlobalStatusMatrix`; `Q=AttentionQueue + OwnerCustodyIncidentPanel`; `T=OwnerOutcomeTimeline`                                                                                                                                                                                                                | Refresh views, Open selected detail, Copy affected locator                                                                                                                                                                                                                | `CURRENT/PARTIAL`; missing Owner adapters remain unavailable. The Qualification incident occupies one row with current `1/1/1 + receipt` direct readback and `RESTORED_REVALIDATION_PENDING / NOT_ADMITTED`; the stale frontier remains unavailable, and the row never supplies a restore action or healthy score                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Attention `/dashboard/attention` | Counts by stop predicate; `P=AttentionTable`; `Q=SelectedStopPredicate`; `T=EvidenceCompletenessMatrix`                                                                                                                                                                                                                                                                                            | Open detail, Resolve same identity when admitted, Copy locator                                                                                                                                                                                                            | Read‑only; no generic dismiss                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Recent `/dashboard/recent`       | Owner terminal counts; `P=RecentOwnerOutcomes`; `Q=SourceFreshness`; `T=ReceiptTimeline`                                                                                                                                                                                                                                                                                                           | Filter, Open receipt, Copy identity                                                                                                                                                                                                                                       | Read‑only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Evidence `/dashboard/evidence`   | Available/stale/unavailable/quarantined counts; `P=OwnerFrontierMatrix`; `Q=RebuildState`; `T=EvidenceConflictTable`                                                                                                                                                                                                                                                                               | Refresh, Open evidence, Copy locator                                                                                                                                                                                                                                      | Static foundations do not become product availability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Intake `/rd`                     | Form completeness/source count/request state/Owner freshness; `P=ResearchRequestComposer + TrialFamilyPolicyComposer + TrialFamilyAuthorityResolutionPanel`; `Q=OwnerCustodyIncidentPanel + SourceEvidenceCard + NonAuthorityCallout`; `T=DraftSourceList`                                                                                                                                         | While custody is unavailable: Open incident evidence, Copy affected locator; Submit, Resolve, and Create successor are disabled. Otherwise Submit starts complete validation then basis/frontier/lineage resolution; Create successor requires an Owner‑admitted terminal | Existing S1 remains `CURRENT/PARTIAL`; V2 authority chain is `OBSERVED_CANDIDATE_NOT_CURRENT`. The current default Qualification store is `RESTORED_REVALIDATION_PENDING / NOT_ADMITTED`: canonical Owner recovery and direct readback succeeded, but the original frontier is stale and default‑Web/Product Edge/R&D revalidation has not run. The browser does not reconstruct a pre‑loss receipt, and no positive Submit/S1/S2/provider action appears                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Research `/rd/research`          | Active/stale/unknown/accepted/rejected counts; `P=ResearchRequestTable`; `Q=ResearchViewCard + TrialFamilyReceiptPanel + S1TerminalCustodyPanel`; `T=ResearchReceiptTimeline`                                                                                                                                                                                                                      | Refresh, Open detail, Resolve same identity, Create successor when admitted                                                                                                                                                                                               | Existing S1 is `CURRENT/PARTIAL`; TrialFamily root/member/frontier and unified read‑time freshness are `OBSERVED_VISIBLE_DEFECT_NOT_CURRENT` after v5 showed that `e5893fd550` hides a complete stale S1 terminal as receipt‑less unknown. TARGET current linked state is `ARTIFACT_AVAILABLE / AVAILABLE / REVIEW_ARTIFACT`; at `now >= valid_through`, the same verified Research receipt/TrialFamily and historical Artifact availability remain visible while currentness becomes `STALE / ARTIFACT_AVAILABLE / RESOLVE_SAME_REQUEST_IDENTITY` and every positive action is hidden                                                                                                                                                                                                                                                                                               |
| Hypotheses `/rd/hypotheses`      | Active/falsified/pending/unavailable counts; `P=HypothesisLineageTable`; `Q=FalsifierCard`; `T=SourceToIntentGraph`                                                                                                                                                                                                                                                                                | Open source, Open Intent, Prepare successor in Intake                                                                                                                                                                                                                     | No direct Fact mutation from this tab                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Artifacts `/rd/artifacts`        | Available/failed/unknown/review‑required counts; `P=ArtifactTable`; `Q=ArtifactRequestAdmissionPanel + ArtifactOutcomeProjectionGate + ArtifactReviewPanel + ArtifactTrialFamilyBindingPanel + NoArtifactReceiptPanel + InvocationAdmissionReceipt + ProviderInvocationStateCard + LegacyTerminalQuarantinePanel`; `T=BuildAndSecurityEvidence` with deterministic double‑build and sandbox policy | Check & Run, Open Artifact, Resolve same attempt only after dispatch, Copy provider claim, Open operational run, Ask Agent to revise, Start exploratory replay                                                                                                            | Existing S2 is `CURRENT/PARTIAL`; action‑time admission, result‑authority precedence, binding, no‑Artifact closure and invocation state are `OBSERVED_*_NOT_CURRENT`. Pre‑dispatch failure keeps the Artifact request unsubmitted with no attempt Resolve; only `ADMITTING` ambiguity becomes `SUBMITTED_OR_UNKNOWN`. The outcome gate first selects sealed R&D terminal receipts; only without one may `INVOCATION_STARTED` project `OUTCOME_UNKNOWN`. TARGET also uses resolution‑specific absent/present keys, direct claimed start, stale‑safe terminal receipts and all four read‑only legacy dispositions. The server‑admission panel remains unavailable until a bounded public projection exposes its receipt and sealed current‑Research custody; job success cannot fill it. There is no provider retry button; `ACTUAL_PROVIDER_CALL_AT_MOST_ONCE` remains `NOT_ADMITTED` |
| Decisions `/rd/decisions`        | Accepted/rejected/unknown/action‑required counts; `P=IterationDecisionTable`; `Q=DecisionEvidenceCard`; `T=DecisionLineage`                                                                                                                                                                                                                                                                        | Open decision, Resolve same identity, Prepare admitted successor                                                                                                                                                                                                          | Read‑only unless Owner returns exact action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

#### Backtest, Qualification, and Scanner

| Tab and route                                          | Fixed `S / P / Q / T` contents                                                                                                                                                                                            | Buttons in order                                                                                                                                                  | Default evidence state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exploratory `/backtest`                                | Running/unknown/terminal/rejected counts plus operation deployment state; `P=ExploratoryReplayComposer`; `Q=CapabilityUnavailablePanel + OperationalJobCard`; `T=BacktestRunTable` preserves historical Owner‑linked rows | When operation is archived: Refresh registry, Open historical run, Copy capability locator. Run/Resolve/Create successor are disabled until restored and admitted | S3 `OBSERVED_CANDIDATE_NOT_CURRENT / DEPLOYMENT_UNAVAILABLE`; remote replay entry is currently archived. Historical design evidence remains, but the page cannot dispatch or imply MCP parity                                                                                                                                                                                                                                                                                                                                                       |
| Compare `/backtest/compare`                            | Selected‑run count and comparable cuts; `P=RunPicker`; `Q=ComparisonBasis`; `T=RunComparePanel`                                                                                                                           | Add run, Remove run, Swap baseline, Open run detail                                                                                                               | Read‑only; compare 2-4 exact compatible runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Diagnostics `/backtest/diagnostics`                    | Diagnostic category counts; `P=DiagnosticFilter`; `Q=ModelIdentityList`; `T=DiagnosticTable + bounded summary`                                                                                                            | Filter, Copy identity, Open source receipt                                                                                                                        | Only allowed categories; no protected Qualification data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Intake `/qualification`                                | Submitted/pending/evaluating/unknown/not‑admitted/semantic‑conflict/unavailable counts; `P=QualificationIntakeTable`; `Q=EvidenceCompleteness + QualificationIntakeConflictPanel`; `T=IntakeReceiptTimeline`              | Submit intake, Refresh, Resolve exact same meaning, Open original receipt, Prepare admitted successor                                                             | Pending/evaluating requires a separately allowed intake projection and never implies a public terminal. Exact replay may resolve; any changed valid or invalid meaning under the same identity is `RequestSemanticConflict`. `OBSERVED_CANDIDATE_NOT_CURRENT`; no real Product Edge consumer yet                                                                                                                                                                                                                                                    |
| Protected feedback `/qualification/protected-feedback` | Current/genesis‑empty/unknown/corrupt counts; `P=QualificationFrontierTable`; `Q=QualificationFrontierReceiptPanel + IndependenceBasisLink`; `T=OpaqueFrontierTimeline`                                                   | Refresh, Resolve current by exact basis, Open R&D basis receipt, Copy opaque frontier reference                                                                   | `RESTORED_REVALIDATION_PENDING / NOT_ADMITTED`; exhaustive canonical Owner history verification and direct `1/1/1 + receipt` readback succeeded, but the reconstructed original frontier is stale/`UNAVAILABLE` at the current cut and consumer revalidation has not run. The page renders unavailable, hides Copy frontier, and exposes only read‑only incident evidence. Identity/cut/digest/state remain visible; protected content, candidate Intake, protected attempts, eligibility, holdout, and cross‑family ancestry remain `NOT_ADMITTED` |
| Outcomes `/qualification/outcomes`                     | Qualified/ineligible/expired/revoked public‑terminal counts only; `P=PublicOutcomeTable`; `Q=QualificationPublicOutcome`; `T=PublicFrontierTimeline`                                                                      | Refresh, Open public outcome, Copy opaque reference                                                                                                               | `Admitted/Evaluating` create no row, terminal count, receipt, color, notification, or action. Public redaction only; protected fields have no slots. `OBSERVED_CANDIDATE_NOT_CURRENT`                                                                                                                                                                                                                                                                                                                                                               |
| Eligibility `/qualification/eligibility`               | Current/pending/expired/conflict counts; `P=EligibilityIntervalTable`; `Q=HeadFrontierCard`; `T=TransitionTimeline`                                                                                                       | Refresh, Resolve current head                                                                                                                                     | Foundation only; empty or dual‑current intervals are unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Schedules `/scanner`                                   | Due/unknown/unavailable/failed counts; `P=ScheduleTable`; `Q=DueSlotEvidence`; `T=AttemptTimeline`                                                                                                                        | Open schedule, Resolve same due‑slot                                                                                                                              | Creation/editing deferred until a real schedule consumer exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Runs `/scanner/runs`                                   | Running/unknown/rejected/terminal counts; `P=ScannerAttemptTable`; `Q=AttemptReceipt + ScannerPublicReceiptIntegrityPanel`; `T=MatcherInvocationEvidence`                                                                 | Open run, Resolve same attempt                                                                                                                                    | `CURRENT/PARTIAL · STATIC_CONTRACT_CLOSED_NOT_RUNTIME`: PR #334 requires sealed Scanner Owner admission. No row/count/badge/receipt or Matcher/Proposal evidence appears without a separately admitted direct Owner consumer and runtime adapter                                                                                                                                                                                                                                                                                                    |
| Proposals `/scanner/proposals`                         | New/accepted/rejected/unavailable counts; `P=ProposalTable`; `Q=ProposalEvidence`; `T=ProposalLineage`                                                                                                                    | Open proposal, Prepare admitted lifecycle request                                                                                                                 | Proposal never authorizes Governance or Runtime                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

#### Strategy, Runtime, and Portfolio

| Tab and route                        | Fixed `S / P / Q / T` contents                                                                                                                                        | Buttons in order                                                                                                                            | Default evidence state                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry `/strategy`                 | Registered/current/superseded/unavailable counts; `P=StrategyRegistryTable`; `Q=GenerationIdentityCard`; `T=GenerationLineage`                                        | Open generation, Copy identity                                                                                                              | Static Governance foundation only                                                                                                                                                                                                                                                                                      |
| Lifecycle `/strategy/lifecycle`      | Pending/accepted/rejected‑no‑write/unknown counts; `P=LifecycleRequestTable`; `Q=GovernanceEligibilityAdmissionPanel + GovernanceDecisionCard`; `T=ContenderFrontier` | With valid Eligibility: Submit lifecycle request, Resolve same request, Create successor; otherwise Open Eligibility evidence, Copy locator | `CURRENT/PARTIAL · STATIC_CONTRACT_CLOSED_NOT_RUNTIME`: PR #334 makes invalid/unavailable Eligibility a pre‑admission zero‑write state. Receipt‑backed `REJECTED_NO_WRITE` is a distinct admitted Governance decision; positive Runtime application and product consumers remain `NOT_ADMITTED`                        |
| Allocations `/strategy/allocations`  | Allocated/unallocated/capacity‑blocked/unavailable counts; `P=AllocationTable`; `Q=CapacityEvidence`; `T=AllocationHistory`                                           | Open allocation, Prepare allocation request                                                                                                 | No allocation writer in Dashboard                                                                                                                                                                                                                                                                                      |
| Instances `/runtime`                 | One fixed not‑ready summary; `P=EmptyState`; `Q=RuntimeFoundationNotReadyCard`; `T=EmptyState`                                                                        | Refresh foundation, Open revalidation dependency, Copy foundation locator                                                                   | `CURRENT/PARTIAL · FOUNDATION_NOT_READY`: display `NotReady` and exactly four dependencies. There is no Strategy Instance row, readiness receipt, incident, Resolve, Apply or green state. `RuntimeReadinessCard` remains a future Owner‑backed component and is absent                                                |
| Generations `/runtime/generations`   | No generation counts; `P=EmptyState`; `Q=RuntimeFoundationNotReadyCard`; `T=EmptyState`                                                                               | Refresh foundation, Open revalidation dependency, Copy foundation locator                                                                   | `NOT_ADMITTED`: PR #330 exposes no generation or application surface. Even `NOT_APPLIED / NO_APPLICATION_RECEIPT` awaits a separately admitted Governance‑to‑Runtime consumer; all future generation geometry, `APPLIED`, Resolve and Apply remain absent                                                              |
| Checkpoints `/runtime/checkpoints`   | No checkpoint counts; `P=EmptyState`; `Q=RuntimeFoundationNotReadyCard`; `T=EmptyState`                                                                               | Refresh foundation, Open revalidation dependency, Copy foundation locator                                                                   | `NOT_ADMITTED`: PR #330 exposes no checkpoint or restore surface. Future `CheckpointTable`, `RestoreValidationCard`, `CheckpointHistory`, Open checkpoint and Validate restore evidence remain absent                                                                                                                  |
| Incidents `/runtime/incidents`       | No incident counts; `P=EmptyState`; `Q=RuntimeFoundationNotReadyCard`; `T=EmptyState`                                                                                 | Refresh foundation, Open revalidation dependency, Copy foundation locator                                                                   | `NOT_ADMITTED`: PR #330 exposes no incident or Recovery surface. Future `RuntimeIncidentTable`, `IncidentEvidence`, `IncidentTimeline`, Open incident and Open Recovery case remain absent; a missing heartbeat cannot manufacture an incident                                                                         |
| Performance `/portfolio`             | No performance summary; `P=EmptyState`; `Q=PortfolioViewUnavailableCard`; `T=EmptyState`                                                                              | Open contract evidence, Copy contract locator                                                                                               | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`: show only the request/envelope contract. Future `PerformanceChart`, `AccountAndFactCut`, `PerformancePeriods`, range control and source‑fact actions remain absent; legacy `PortfolioSnapshot` is not an Owner fact                                              |
| Exposure `/portfolio/exposure`       | No exposure summary; `P=EmptyState`; `Q=PortfolioViewUnavailableCard`; `T=EmptyState`                                                                                 | Open contract evidence, Copy contract locator                                                                                               | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`: future `ExposureMatrix`, `CoherentEvidenceCut`, `ExposureTable`, scope filter and fact actions remain absent; shared Cache positions or stale flags cannot fill the card                                                                                         |
| Capacity `/portfolio/capacity`       | No capacity summary; `P=EmptyState`; `Q=PortfolioViewUnavailableCard`; `T=EmptyState`                                                                                 | Open contract evidence, Copy contract locator                                                                                               | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`: the request binds scope/mode/policy/common cut, but no positive Gross Capacity projection exists. Future `CapacityScopeCard`, `GrossCapacityView`, `CapacitySourceCompleteness`, `CapacityViewHistory`, refresh/source actions, usage and headroom remain absent |
| Attribution `/portfolio/attribution` | No attribution summary; `P=EmptyState`; `Q=PortfolioViewUnavailableCard`; `T=EmptyState`                                                                              | Open contract evidence, Copy contract locator                                                                                               | `NOT_ADMITTED · NO_ATTRIBUTION_SURFACE`: PR #332 exposes no attribution projection identity. Future `AttributionChart`, `AttributionEvidenceCut`, `AttributionTable`, period control and evidence actions remain absent; no Alpha, Qualification or Risk usage is inferred                                             |

#### Risk, Execution, and Data

| Tab and route                              | Fixed `S / P / Q / T` contents                                                                                                                            | Buttons in order                                                    | Default evidence state                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decisions `/risk`                          | Allow/reject/decrease‑only/unavailable counts; `P=RiskDecisionTable`; `Q=DecisionEvidenceAndLineage`; `T=RiskDecisionTimeline`                            | Open decision, Resolve same intent, Open source facts               | `NOT_ADMITTED`: legacy check/forward/denial events never populate this page; no manual override                                                                                                                                                                                                       |
| Reservations `/risk/reservations`          | Available/withdrawn/consumed/unknown‑effect/no‑effect/settled counts; `P=ReservationTable`; `Q=ReservationLiabilityCard`; `T=ReservationHistory`          | Open reservation, Open claim result, Open linked effect             | `MECHANISM_REJECTED / NOT_ADMITTED` for a standalone Risk core; only a complete cross‑Owner input chain with Risk‑owned one‑use facts/store can re‑enter planning. Dashboard never releases liability                                                                                                 |
| Claims & Admission `/risk/claims`          | Consumed/rejected/admitted‑once/suppressed/conflict/unavailable counts; `P=ClaimAndAdmissionTable`; `Q=AggregateFrontierCard`; `T=ClaimAdmissionTimeline` | Open claim, Open prepared attempt, Open adapter binding, Open fence | `MECHANISM_REJECTED / NOT_ADMITTED` as a local‑core leaf; claim, admission and fence arbitration must arrive in one real‑consumer vertical slice sharing one Risk transaction frontier                                                                                                                |
| Fences `/risk/fences`                      | Active/pending/cleared/unavailable counts; `P=FenceTable`; `Q=FenceSetAndFrontier`; `T=FenceTimeline`                                                     | Open fence, Open Recovery case, Open source facts                   | `NOT_ADMITTED` until Risk‑owned fence facts exist; an active fence is never hidden or dismissed                                                                                                                                                                                                       |
| Attempts `/execution`                      | Prepared/invoked/unknown/rejected counts; `P=EffectAttemptTable`; `Q=EffectAuthorityCard`; `T=AttemptJournal`                                             | Open attempt, Resolve same effect                                   | Read‑only by default; no invocation button without explicit effect authority                                                                                                                                                                                                                          |
| Orders `/execution/orders`                 | Open/partial/filled/rejected counts; `P=OrderTable`; `Q=AuthorizedCommandCard`; `T=OrderStateTimeline`                                                    | Open order, Open command, Resolve venue readback                    | UI cannot create or alter an order                                                                                                                                                                                                                                                                    |
| Fills `/execution/fills`                   | Fill/fee/slippage/unavailable summaries; `P=FillTable`; `Q=FillEvidence`; `T=FillTimeline`                                                                | Filter, Open fill receipt                                           | Read‑only                                                                                                                                                                                                                                                                                             |
| Reconciliation `/execution/reconciliation` | Matched/missing/conflicting/unknown counts; `P=ReconciliationTable`; `Q=ReconciliationPanel`; `T=VenueReadbackTimeline`                                   | Refresh readback, Resolve same effect, Open Recovery case           | Unknown stays persistent                                                                                                                                                                                                                                                                              |
| Recovery `/execution/recovery`             | Open/contained/reconciling/closed counts; `P=RecoveryCaseTable`; `Q=RecoveryEvidence`; `T=RecoveryTimeline`                                               | Open case, Run admitted read‑only reconciliation step               | No effect retry or closure inferred by UI                                                                                                                                                                                                                                                             |
| Sources `/data`                            | No binding counts; `P=EmptyState`; `Q=MarketDataOwnerFoundationCard`; `T=EmptyState`                                                                      | Open foundation evidence, Copy foundation locator                   | `CURRENT/PARTIAL · NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER`: PR #331 admits the sealed Source Binding readback schema but no Dashboard/H0 resolver composition. Future `DataSourceTable`, `SourceBindingCard`, `SourceCutHistory`, positive admitted badge and resolver/mutation actions remain absent |
| PIT Catalog `/data/pit-catalog`            | No snapshot counts; `P=EmptyState`; `Q=MarketDataOwnerFoundationCard`; `T=EmptyState`                                                                     | Open foundation evidence, Copy foundation locator                   | `CURRENT/PARTIAL · NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER`: PR #331 admits the sealed PIT Snapshot readback schema but no Dashboard/H0 resolver composition. Future `PITCatalogTable`, `SnapshotIdentityCard`, `CorrectionTimeline`, available badge and resolver/mutation actions remain absent      |
| Quality `/data/quality`                    | Complete/partial/conflict/quarantined counts; `P=QualityRuleMatrix`; `Q=SelectedQualityFinding`; `T=QualityTimeline`                                      | Open finding, Open source evidence                                  | No automatic acceptance                                                                                                                                                                                                                                                                               |
| Freshness `/data/freshness`                | Per‑source current/stale/expired/unavailable counts; `P=FreshnessMatrix`; `Q=TimeEvidenceCard`; `T=LagHistory`                                            | Refresh, Open frontier                                              | Never compute one global freshness maximum                                                                                                                                                                                                                                                            |

#### Operations and Settings

| Tab and route                                                     | Fixed `S / P / Q / T` contents                                                                                                                                                                                                                                                                                                                                                                                     | Buttons in order                                                                                                  | Default evidence state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runs `/operations`                                                | Four fixed status cards scoped by the selected Runs/Dependencies kind: queued, running, unknown, and completed/failed; `T=RunTable` with status/date/path/trigger/principal/tag/duration; `D=RunSummaryCard` after row selection; `P/Q` omitted                                                                                                                                                                    | Refresh, Filter, Open run, Resolve Owner outcome, Delete disposable completed cache                               | Real Windmill use; operational only and deletion never changes business truth                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Run Detail `/operations/runs/:runId`                              | Semantic/operational/timing summaries; `P=RunMetadataAndInputs + RunWorkerCompatibilityMatrix + OperationalCancellationReceiptCard` bound to `:runId`; `Q=OwnerViewCard`; `T=RunResultView` followed by fixed nested `Logs/Metrics/Traces/Assets` tabs                                                                                                                                                             | Copy locator, Refresh, conditionally Cancel queued dependency, Resolve same identity, Download bounded result/log | Exact fixed skeleton above; Cancel occupies the third slot only for a queued, unclaimed, zero‑domain‑effect dependency run and is otherwise absent. `Cancelling…` disables it during CAS; after terminal transition the action/panel disappear while P preserves receipt or unavailable readback. Worker readiness is derived only for this exact run. No batch cancel or generic rerun/edit/share                                                                                                                                                                                                                 |
| Workers `/operations/workers` and `/operations/workers/:workerId` | Exact Workers read‑only skeleton above: Fleet/Workload summary; P/Q absent; T columns Worker, Lease, Jobs, Last run, Operations; identity‑bound D in four clusters                                                                                                                                                                                                                                                 | Refresh, Open exact worker, Open last run, Back to worker list                                                    | `IMPLEMENTATION_ADMITTED · FIRST_PARTY_RUN_STORE_GET_ONLY`; registration/lease/claim observation only, independent list/detail fail‑closed states; no Windmill administration, unbound‑run readiness, Owner acceptance or cutover                                                                                                                                                                                                                                                                                                                                                                                  |
| Service Logs `/operations/service-logs`                           | Error/worker/server/instance counts; `F=ServiceLogFilters`; `P=ServiceInstanceList`; `Q=ServiceInstanceCard`; `T=ServiceLogPanel` composed with `BoundedLogViewport`                                                                                                                                                                                                                                               | Refresh, Toggle auto‑refresh, Download bounded logs                                                               | Real Windmill use; read‑only, redacted, retention‑bounded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Audit `/operations/audit`                                         | Execute/update/create/delete/success/failure counts; `P=OperationAuditTable`; `Q=AuditCorrelationCard + InvocationAdmissionReceipt + InvocationClaimReceipt + ProviderInvocationStateCard` in that order; `T=Timeline` for canonical operation events                                                                                                                                                              | Filter, Open correlation, Copy audit locator, Copy provider claim                                                 | Real Windmill audit remains append‑only control‑plane evidence, not Owner business truth. Product Edge separately shows invocation admission, claim disposition, `CLAIMED / INVOCATION_STARTED`, start disposition and state digest. `OUTCOME_UNKNOWN` is a persistent manual‑reconciliation stop; historical request admission, missing invocation admission, or claim resolution never implies a new effect or provider retry                                                                                                                                                                                    |
| Event Rail `/operations/event-rail`                               | Ingested/conflict/quarantined/rebuilding counts; `P=EventRailTable`; `Q=EnvelopeEvidence`; `T=RebuildTimeline`                                                                                                                                                                                                                                                                                                     | Filter, Open event, Copy locator                                                                                  | Static Observability foundation until real adapter consumption                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Telemetry `/operations/telemetry`                                 | Available/stale/partial/rebuilding/unavailable/quarantined counts; `P=TelemetryMatrix`; `Q=SourceFrontierCard`; `T=TelemetryTimeline`                                                                                                                                                                                                                                                                              | Refresh, Open source                                                                                              | PR #327 source projection is `CURRENT/PARTIAL`; per‑source frontier, freshness, completeness, rebuild state, quarantine, and opaque checkpoint have fixed read‑only geometry. Owner and telemetry adapters are unavailable, telemetry visibility is fixed `Unavailable`, and no empty, raw, stale, replayed, or self‑asserted signal may produce `Available`                                                                                                                                                                                                                                                       |
| Alerts `/operations/alerts`                                       | Critical/warning/info/unread counts; `P=AlertTable`; `Q=AlertDetail`; `T=DeliveryHistory`                                                                                                                                                                                                                                                                                                                          | Open alert, Mark presentation read, Open Owner evidence                                                           | Read acknowledgement is not business acknowledgement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Data Sources `/settings`                                          | Configured/healthy/unavailable/secret‑missing counts; `P=DataSourceConfigList`; `Q=OpaqueConnectionRefForm`; `T=ValidationHistory`                                                                                                                                                                                                                                                                                 | Test read‑only connection, Save opaque reference                                                                  | No secret values displayed or stored in page state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Agents `/settings/agents`                                         | Configured/running/unavailable/budget‑blocked counts; `P=AgentProfileList`; `Q=ProviderAndBudgetForm`; `T=InvocationHistory`                                                                                                                                                                                                                                                                                       | Test provider, Save profile                                                                                       | No provider key pass‑through to Owner requests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Notifications `/settings/notifications`                           | Channel/enabled/failed/unavailable counts; `P=NotificationPreferenceForm`; `Q=ChannelStatus`; `T=DeliveryHistory`                                                                                                                                                                                                                                                                                                  | Send local test, Save preferences                                                                                 | Does not acknowledge Owner outcomes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Access `/settings/access`                                         | Principal/session/token/revoked counts plus binding `ACTIVE/SUPERSEDED/zero‑active` and authorization available/expired/revoked/unavailable counts; `P=LocalPrincipalCard`; `Q=AuthorizationLineagePanel` with fixed `Current authority / Admission snapshot` tabs and separate `Operator Authorization / Product Edge readiness` rows; `T=AuthorizationSuccessorReadiness + CapabilityManifest + CredentialAudit` | Re‑authenticate local session, Issue narrow transport token, Revoke token, Copy once                              | Transport credential controls never mint, renew, revoke, or chain‑walk Operator Authorization. Historical expiry with no immediate equivalent successor, or `successor_distance>1`, renders `Current authority` unavailable with prior/current identity, generation, distance and exact stop; immutable snapshot remains visible with no renewal/replacement selector. `Current authority` alone feeds action state. Both tabs expose exact binding/head, issuer/audience/scope, expiry/revocation frontier, manifest digest, source cut, and stop predicate; secret/token values remain one‑time and never logged |

`/settings/access` uses this fixed read/control separation:

```text
H  Settings / Access                                                   [Refresh]
S  Session | Current authority | Successor readiness | Revoked
P  Local principal/session: identity, authenticated/expired/unavailable, last re-auth
Q  [Current authority] [Admission snapshot]
   Operator Authorization: identity, issuer, audience, scope, sequence, validity, state, cut
   Product Edge readiness: binding/head, manifest digest, outbox, state, cut, stop predicate
R  Successor readiness: prior identity/scope/sequence -> Owner operation availability ->
   admission/current generation -> successor distance 0|1 -> predecessor locator ->
   successor receipt/identity or DIRECT_SUCCESSOR_REQUIRED / exact unavailable reason;
   no editable value, selector, or chain-head promotion
T  [Authorization successor] [Capability manifest] [Credential audit]
B  [Re-authenticate] [Issue narrow transport token] [Revoke token] [Copy once]
```

When successor issuance is unavailable, `S` keeps its fourth-width slot, `R` uses fixed amber unavailable geometry,
and `B` contains transport/session controls only. No Issue/Renew authorization, Select replacement, Force active,
or pasted-receipt control appears at any viewport.

### Overlay, button, and state rendering contract

- `OwnerReceiptDrawer` and `RunDetailDrawer` use the fixed `D` order above. A receipt section is never hidden behind
  an accordion when it is the only terminal evidence.
- `GlobalSearchDialog` has a query input, type chips, result groups, identity/source-cut preview, and only `Open`
  or `Prepare request` actions. It cannot execute a domain mutation.
- `NotificationDrawer` groups incident, unknown, stale, fence, and informational delivery. `Mark read` affects only
  presentation state.
- Primary buttons submit one admitted semantic operation. Secondary buttons resolve the same identity. Outline or
  quiet buttons create an Owner-admitted successor. Ghost buttons navigate, filter, refresh reads, or copy.
- Every effect‑capable button is wrapped by `ActionAdmissionGate`, whose branch tag has exactly the `domain` and
  `operational` variants. The domain branch requires the current `NextLegalActionBar` operation and an `admitted` envelope
  for the same principal, scope, Owner, operation, schema, exact effect set, binding head, authorization and manifest
  digest. `Check & Run` is a composite domain control whose first click is read-only preflight; only its internal
  dispatch transition may cross into `ADMITTING`. The operational branch exists only for a registered disposable
  control such as `dependency.cancel.queued`; it requires a current `OperationalActionEnvelope` binding principal,
  capability, exact operational identity, dispatcher transition version, zero domain effects, claim-absence cut and
  short expiry. The backend re-resolves that envelope under its own transition lock; it never substitutes for an
  Owner envelope or `NextLegalActionBar`. Expiry, revocation, identity/version/head change, zero/dual `ACTIVE`
  bindings, manifest mismatch, a new claim, resolver unavailability or preflight failure disables the applicable
  branch without preserving the previous positive state.
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

| Component                                                                   | Contract                                                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `DashboardShell`                                                            | full‑screen rail, top bar, viewport, overlay roots                                                   |
| `UserCapsule`                                                               | local operator and installation menu; no business authority                                          |
| `IconRail`, `IconNavItem`                                                   | stable order, tooltip, active/focus/disabled/attention                                               |
| `TopBar`, `StatusTape`, `ModuleTabs`, `GlobalCommand`, `NotificationButton` | four top‑menu zones                                                                                  |
| `PageHeader`, `ScopeBar`, `AuthorityStamp`, `FreshnessStamp`                | Owner/evidence context                                                                               |
| `RouteGrid`, `RouteSlot`                                                    | page‑level 12/6/1‑column contract, fixed slot spans/order, no caller‑defined column count            |
| `BentoGrid`, `BentoItem`, `SplitPane`, `DetailDrawer`                       | panel‑internal container‑responsive 1/2/3/4/8‑column composition, 180 px minimum auto‑row, 16 px gap |

### Data display components

| Component                                                                    | Contract                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Card`, `CardHeader`, `CardBody`, `CardFooter`                               | white, 12 px radius, optional expand, no glass                                                                                                                                                        |
| `PanelFrame`, `PanelFrameHeader`, `PanelFrameBody`, `PanelSection`           | gray frame, white body, scroll/flex modes                                                                                                                                                             |
| `StatGrid`, `StatItem`, `KVRow`, `DataList`, `DataTable`                     | unit, source cut, empty/unavailable states                                                                                                                                                            |
| `DataTableSurface`, `DataWorkspaceTable`, `ArtifactDirectory`                | TanStack headless state with shared shadcn‑style table atoms; one‑row toolbar, sticky plain headers, subtle separators, bounded Owner‑verified rows, and fail‑closed empty/partial/unavailable states |
| `ChartFrame`, `ChartLegend`, `ChartTooltip`, `TimeRangeControl`              | axes, unit, locale, disclosure, no‑data behavior                                                                                                                                                      |
| `Timeline`, `EventRow`, `BoundedLogViewport`, `DiffView`, `ComparisonMatrix` | virtualization, stable keys, redaction, truncation and retention disclosure                                                                                                                           |
| `FilterBar`, `FilterDrawer`, `DateGroup`, `TableToolbar`, `TableFooter`      | route‑backed filters, stable columns/order, filtered‑empty, row count and pagination; mobile changes only the container                                                                               |
| `StateBanner`, `Callout`, `AlertRow`                                         | success/pending/unknown/rejected/unavailable/protected/incident                                                                                                                                       |

### Domain components

| Component                                                                                                                | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OwnerReceiptCard`, `OwnerViewCard`, `ReceiptLink`                                                                       | Owner identity, disposition, cut, freshness, locator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `NextLegalActionBar`                                                                                                     | only an Owner‑admitted action from the current direct‑read projection; durable historical success never preserves an action across stale/unavailable/archived state. Otherwise render the stop predicate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ActionAdmissionGate`, `AuthorizationLineagePanel`                                                                       | discriminated input is exactly `domain / operational`, never both. `domain` cross‑binds `NextLegalActionBar` to the unique `ACTIVE` shell binding/history head, Operator Authorization, Time/revocation, Owner freshness, Product Edge readiness, exact effect set and manifest. `operational` accepts only a registered disposable capability plus current `OperationalActionEnvelope` for principal, run, dispatcher transition version, empty domain‑effect digest, no‑claim cut and expiry; Dispatcher re‑resolves it under lock, and it cannot populate `AuthorizationLineagePanel` or substitute for Owner authority. Both use `IDLE / PREFLIGHTING / ADMITTING / ADMITTED / REVALIDATION_REQUIRED / STALE / UNAVAILABLE`; post‑dispatch unknown moves to branch‑specific same‑identity readback. Domain shows `Current authority` then `Admission snapshot`; operational shows envelope/transition/no‑claim evidence. Historical snapshots feed neither branch, and neither component constructs or repairs authority                                                                                                                                                                                                                                                                                                                              |
| `AuthorizationSuccessorReadiness`                                                                                        | read‑only prior authorization identity/scope/sequence, admission/current generations, `successor_distance=0\|1`, terminal expiry/revocation state, canonical direct‑successor operation availability, successor receipt/identity when present, and exact missing/invalid stop. FirstMutation adds fixed `Original authorization at final cut` then `Immediate successor at final cut` rows; the original must be `CurrentAtLock`, and a successor is an additional current requirement. Distance greater than one is `DIRECT_SUCCESSOR_REQUIRED`; a non‑current original is `ORIGINAL_AUTHORIZATION_NOT_CURRENT`. It never walks a chain, substitutes a successor for the original authority, constructs scope, chooses a replacement, signs, renews, revokes, or calls a transport‑token control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `DownstreamAdmissionHandoffPanel`                                                                                        | fixed Product Edge admission receipt/identity/cut, admission‑outbox locator, downstream‑resolver version and availability, target R&D Owner, R&D receipt/custody state, and stop predicate. It distinguishes `admission committed / downstream unavailable` from input rejection, renders overall `SUBMITTED_OR_UNKNOWN`, disables S2, and exposes only Copy admission, Open operational run, and Resolve same identity. It never offers successor, retry, permission repair, or inferred R&D receipt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ArtifactRequestAdmissionPanel`                                                                                          | fixed three‑row S2 gate: historical cached Research View/currentness; cancellable UI same‑request `PREFLIGHTING`; then server‑authoritative Artifact request admission. The server row binds build request, attempt, Intent, channel, exact operation/schema/effect set, Product Edge locator/receipt/final cut, sealed current‑Research evidence identity/digest, source S1 admission locator and R&D resolver/version/cut. Preflight failure preserves the first row read‑only, marks currentness non‑positive and renders no attempt Resolve. Dispatch enters `ADMITTING`; unknown transfers to `SUBMITTED_OR_UNKNOWN`. A bounded public projection is required for blue `ADMITTED`; the current private stored custody or a green Windmill job cannot populate it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `InvocationAdmissionReceipt`                                                                                             | sealed Product Edge receipt created before the first claim: identity/digest; original request‑admission lineage; build request and attempt; directly resolved current authorization identity/frontier and Time Evidence; policy‑equivalent `ACTIVE` binding/head; exact manifest digest; final locked write cut and commit time. Missing, expired, cross‑cut, malformed, or mismatched custody is unavailable and suppresses claim/start/Run. It is read‑only in Dashboard and cannot be reconstructed from the claim, admission snapshot, session, or credential                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `InvocationClaimReceipt`                                                                                                 | Product Edge claim plus exact public wire fields `invocation_admission_receipt_identity` and `invocation_admission_receipt_digest`, historical request‑admission lineage, attempt identity, committed time, claim digest, `CLAIMED_NEW / ALREADY_CLAIMED / unavailable`, current `CLAIMED / INVOCATION_STARTED`, and Owner‑projected next action. One resolution‑discriminated parser is shared by operation adapter/projector and tested with direct Rust serialization bytes; claim/non‑success family keys must be absent, never synthesized `null`. Missing/extra/tampered fields keep A0/A1 unavailable. Only recovered `CLAIMED + RUN_BOUNDED_EXECUTION_AGENT` with direct sealed‑receipt equality may enter start                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ArtifactOutcomeProjectionGate`                                                                                          | read‑only precedence gate over one attempt: canonical sealed R&D `SUCCESS`, canonical sealed R&D `FAILED_NO_ARTIFACT`, then Product Edge `INVOCATION_STARTED` only when no R&D terminal exists. It renders exactly one downstream panel and records both source cuts; conflict, missing custody or ambiguous dual terminal is unavailable rather than first‑match success                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ProviderInvocationStateCard`                                                                                            | Two fixed geometries. Resumable `CLAIMED` first shows the exact sealed invocation‑admission receipt, then the same request/attempt/claim, no started time, next action `RUN_BOUNDED_EXECUTION_AGENT`, and buttons in order: Run bounded Agent + sandbox, Resolve same attempt, Copy claim, Open operational run. Missing or mismatched invocation admission keeps the same geometry unavailable and removes Run. A stale/unavailable fresh Research read is non‑gating after claim; Run dispatches start directly without prepare. `INVOCATION_STARTED / OUTCOME_UNKNOWN` uses fixed red geometry with manual reconciliation and no Run/successor; terminalization and later readback consume sealed custody and preserve terminal receipts across Research expiry. It never creates a claim, retries provider, marks success, dismisses the stop, or infers outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `LegacyTerminalQuarantinePanel`                                                                                          | strict legacy‑only projection of Owner discriminant, original `SUCCESS / FAILED_NO_ARTIFACT / REJECTED_NO_WRITE / OUTCOME_UNKNOWN` disposition, request/attempt identity, verified historical terminal receipt identity, optional sparse Intent fields, legacy custody generation, observed time and quarantine reason. It exposes Resolve same attempt then Open/Copy historical receipt only; family/provider/actions stay absent and there is no current Research View, Artifact promotion, successor, TrialFamily repair, or dismiss action. Missing/malformed projection preserves this fixed geometry as unavailable instead of collapsing into generic unknown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `SameIdentityResolvePanel`                                                                                               | immutable request or request+attempt tuple, previous Owner receipt fingerprint, replacement operational‑run link, resolved Owner receipt/view fingerprint, and exact equality/conflict/unavailable result; it is the sole unknown/response‑loss/restart/cache‑loss recovery and never dispatches a naked retry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ResearchRequestComposer`                                                                                                | sourced falsifiable typed request; never creates Intent directly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `S1StageCustodyPanel`                                                                                                    | read‑only `SEALED_BASIS_PENDING_QUALIFICATION` geometry binding exact request and original admission, sealed complete typed request meaning fingerprint, basis receipt/identity, basis head/outbox, commit cut, missing Qualification/terminal Research receipt, and next action. It renders only after canonical basis‑stage verification. Same‑identity Resolve must consume that sealed meaning through Historical completion; a terminal‑only lookup miss keeps the panel unavailable. Submit/successor are absent, duplicate basis/head/outbox is unavailable, and changed request/admission is conflict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `S1TerminalCustodyPanel`                                                                                                 | complete verified Research receipt/Intent plus TrialFamily root/member/Census in fixed geometry, with separate terminal custody and linked‑view currentness rows. Expiry changes the latter to `STALE`, removes Submit/successor/S2/review actions, and leaves Resolve/Open/Copy evidence; it never hides the terminal receipt/family or relabels them `SUBMITTED_OR_UNKNOWN`. Missing or cross‑bound terminal parts preserve the same geometry as unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ResearchViewCard`                                                                                                       | immutable historical Research fact plus separate linked‑Artifact availability, Owner‑projected read‑time availability/phase/action, source cut, projection time and `valid_through`; render current `ARTIFACT_AVAILABLE / AVAILABLE / REVIEW_ARTIFACT`, conservative cached `REVALIDATION_REQUIRED`, or Owner‑returned `STALE / ARTIFACT_AVAILABLE / RESOLVE_SAME_REQUEST_IDENTITY` without erasing historical Artifact availability. `Check & Run` enters read‑only `PREFLIGHTING`; the latter two forms have no positive next‑action slot, and browser time alone never claims `STALE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `TrialFamilyPolicyComposer`                                                                                              | editable proposal meaning only: bounded trial budget, precommitted stop rule, PIT/cost/slippage/capacity model identities, independence rationale, and falsifier; it has no editable predecessor/frontier, protected‑feedback, independence disposition/basis identity, falsifier binding, or family identity fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `TrialFamilyAuthorityResolutionPanel`                                                                                    | three read‑only rows in order: R&D basis receipt/basis/cut, Qualification frontier receipt/frontier/cut/state such as `GENESIS_EMPTY`, then R&D resolved lineage/predecessor/census cut; each includes Owner, operation, locator, availability and stop reason. Positive rows accept only sealed Owner output, never a browser‑deserialized TrialFamily graph. Missing/corrupt/unknown authority exposes only same‑identity Resolve and yields zero S1 family writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `QualificationFrontierReceiptPanel`, `IndependenceBasisLink`                                                             | sealed Qualification receipt identity, opaque frontier identity/digest/state/cut, source R&D basis receipt locator, exact resolution operation, and no protected payload slot; `GENESIS_EMPTY` appears only after exhaustive canonical verification proves no historical projection/outbox. A missing head or unverifiable history renders `unknown/unavailable`, suppresses Copy frontier, and exposes only exact‑basis Resolve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `TrialFamilyReceiptPanel`                                                                                                | direct R&D Owner root receipt, family/root digest, INTENT membership receipt, Census member/fact, and head/frontier in fixed order; availability requires canonical JSON to match every duplicated relational identity, ordinal, digest, and committed‑time field; missing/corrupt/incomplete/inconsistent custody is unavailable and cannot coexist with an S1 success badge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ArtifactReviewPanel`                                                                                                    | immutable identity, lineage, logic, parameters, build/security, and actions from the current linked Research projection; stale‑linked durable S2 success retains evidence but renders no review action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ArtifactTrialFamilyBindingPanel`                                                                                        | binding identity, binding receipt identity including `committed_at`, independently displayed commit cut, bound TrialFamily identity and Census frontier from one locked direct‑Owner custody cut; present only beside an Owner‑resolved S2 Artifact, never inferred from Intent/Artifact identifiers, and unavailable during unresolved concurrent mutation or any canonical/time mismatch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `NoArtifactReceiptPanel`                                                                                                 | canonical receipt payload identity, attempt, Intent, independently derived disposition, failure code and commit time, plus the explicit zero‑Artifact statement. Optional family keys are absent on the exact wire. Research expiry may mark the linked view stale and remove follow‑on actions, but never removes or rewrites this receipt; mismatch or self‑derived verification renders unavailable and exposes no positive action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `CapabilityUnavailablePanel`                                                                                             | operation identity/version, registry version, `archived/unavailable` state, compatibility‑envelope identity/digest, expected versus observed component source/image/App/script hashes, affected channels, observation cut, mismatch reason, preserved historical‑read disclosure and exact restoration/revalidation predicate. Healthy services or matching source text cannot fill a missing envelope. It exposes Refresh registry, Open historical run and Copy capability locator only; no dispatch, archive/restore, successor, permission repair or credential action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `OwnerCustodyIncidentPanel`                                                                                              | fixed red unavailable geometry: incident identity/evidence locator; affected Owner, store and ordered table set; last trusted cut and pre‑loss counts; current direct‑read cut/counts; `backup / PITR / Owner archive / reconstruction evidence` source class; recovery state (`UNKNOWN`, `RESTORABLE_FROM_CANONICAL_SOURCE`, `RECOVERABLE_BY_RECONSTRUCTION_NOT_RESTORED`, `RESTORED_REVALIDATION_PENDING`, `RESTORED`); shared‑volume rollback constraint; and exact revalidation predicate. Buttons are Open incident evidence then Copy affected locator. It never reconstructs rows, accepts pasted JSON, clears the incident, marks restored, or enables a domain action; only canonical recovery plus fresh direct Owner and consumer readback may advance the state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `RunTable`, `RunSummaryCard`, `RunMetadataAndInputs`                                                                     | operational status/date/path/trigger/principal/tag/duration, schema‑allowlisted immutable inputs, typed withheld counts/reasons, dependency kind, and explicit Owner‑outcome join; no raw payload fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `DependencyCancellationPanel`                                                                                            | fixed operational‑only confirmation for one queued dependency run: run/kind/path, queued‑since, required executor compatibility, current `OperationalActionEnvelope` identity/expiry, explicit empty domain‑effect set, no‑claim proof and receipt handoff target. The sole effect button is `Cancel queued dependency`; CAS pending reads disabled `Cancelling…`; terminal transition removes A and header slot 3. Missing/expired/revoked capability, identity/version conflict, claim, terminal or unknown removes the effect, and no batch, retry or domain cancellation exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `OperationalCancellationReceiptCard`                                                                                     | fixed read‑only P location keyed by exact `run_id`; state is `none / pending / receipt / unavailable`. Receipt shows prior state/version, principal, authorization cut, transition time and immutable receipt locator. It persists after A disappears, never exposes an effect button, and never changes or stands in for Owner truth                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `RunDetailPanel`, `RunResultView`, `RunComparePanel`                                                                     | fixed metadata/result/tab skeleton; schema‑allowlisted and sensitivity‑redacted bounded result shared identically by viewport/copy/download; Owner‑correlated receipt/result, actual Artifact/PIT/runtime/simulator identities, diagnostics, invocation count, and handoff; missing/mismatched registry renders unavailable; no Selection authority                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `RunLogPanel`, `RunMetricPanel`, `RunTracePanel`, `RunAssetPanel`                                                        | exact four‑tab order; collected/not‑collected/unavailable/empty are distinct and keep identical geometry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `CompactStatusBar`, `CompactStatusGroup`, `CompactStatusItem`, `DetailClusterGrid`, `DetailCluster`, `DetailClusterFact` | Workers exact skeleton: ordered title/value summary groups and Lease/Activity/Last run/Capabilities clusters with dimensions and unavailable behavior defined above. Compose existing `PanelFrame`, `SplitBento`, `DataTableSurface`, `DataWorkspaceTable`, `DetailInspector`, `DetailNotice`, `DetailEmpty` and `UnavailableState`; no independent color palette or worker administration. `WorkerGroupTabs` and fabricated heartbeat‑history panels are not part of this admitted route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `RunWorkerCompatibilityMatrix`                                                                                           | path‑bound `run_id`, required kind/tag/runtime/isolation, one projection observation cut, and each candidate worker's registration/lease evidence. `ready`, `online / incompatible`, expired lease, missing registration and isolation unavailable are distinct fail‑closed states; the matrix is never rendered without the exact run binding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ServiceLogFilters`, `ServiceInstanceList`, `ServiceInstanceCard`, `ServiceLogPanel`                                     | time/service/instance/severity/search, exact selected instance/source cut, host‑required empty state, auto‑scroll/refresh, and bounded download                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `AuditFilters`, `OperationAuditTable`, `AuditCorrelationCard`                                                            | principal/operation/outcome, exact target/correlation, redaction/retention; append‑only with no dismiss                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `TelemetryMatrix`, `SourceFrontierCard`, `TelemetryTimeline`                                                             | every positive cell binds Owner/source/cut, canonical fingerprint, observed/valid‑through time, and loss/rebuild state; raw, stale, replayed, self‑asserted, or identity‑conflicting input renders unavailable/stale/quarantined and never inherits the previous success color                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `QualificationIntakeConflictPanel`                                                                                       | fixed `RequestSemanticConflict` banner, immutable request/handoff identity, original `NOT_ADMITTED` receipt link, redacted changed‑meaning summary, semantic fingerprints, and optional Owner‑admitted successor action; never displays protected replay values or reuses the old receipt for changed meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `QualificationPublicOutcome`                                                                                             | terminal‑only Owner‑produced lineage, stable attempt, N/A basis, checked nonempty interval, monotonic expiry/revocation and late Time cuts, half‑open pending/current transition, and sealed Qualification head frontier; `Admitted/Evaluating` fail projection and leave this component absent, never `ClosedNotQualified`; no protected‑detail slot, empty current Fact, dual‑current boundary, time rollback, or client promotion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ScannerPublicReceiptIntegrityPanel`                                                                                     | exact Scanner Owner resolve operation, attempt identity, canonical terminal receipt identity/digest, source cut and direct‑read locator. Missing, caller‑constructed, locally reconstructed, mismatched or unavailable resolution fixes the panel in unavailable state, removes the terminal row/count/badge and every Matcher/Proposal projection, and exposes Open source evidence then Copy locator only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GovernanceEligibilityAdmissionPanel`                                                                                    | exact Eligibility identity, interval/frontier, source cut, validation disposition and zero‑write proof before Governance admission. Invalid, expired, conflicting or unavailable Eligibility produces no Governance receipt, lifecycle row, outbox, Runtime handoff or successor action; it exposes Open Eligibility evidence then Copy locator only. A later receipt‑backed Governance rejection is a disjoint admitted branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `GovernanceDecisionCard`                                                                                                 | complete contender frontier, canonical generation ordering, deterministic no‑write tie receipts, decision/action cuts, source frontier, and revalidation; unavailable without direct Owner reread                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `RuntimeFoundationNotReadyCard`                                                                                          | fixed non‑authoritative foundation state `NotReady`; source revision; and exactly four ordered dependency rows: Governance authorized‑generation decision read, canonical Runtime custody, Artifact compatibility recovery read, Execution recovery frontier read. Each row has only Open dependency; footer has Copy foundation locator. No instance/generation/receipt/checkpoint/recovery/application/action slot exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `RuntimeReadinessCard`                                                                                                   | future Owner‑backed exact generation and Strategy Instance identity, canonical readiness fact/receipt, observation cut, freshness and incident locator. It is absent while only `RuntimeFoundationNotReadyCard` is admitted; CI, review, mergeability, merge tree or delivery receipt cannot fill its fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `RuntimeApplicationCard`                                                                                                 | future generation, attempt, Strategy Instance, application receipt, reconciliation successor and restore validation; absent under PR #330 and never inferred from a job/harness, foundation dependency list, CI/review/merge tree, delivery receipt or snapshot weaker than live admission                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `MarketDataOwnerFoundationCard`                                                                                          | fixed PR #331 maturity and source revision; two ordered schema groups only. Source Binding labels are binding identity, fact digest, lineage root/version, outbox digest, observational `is_admitted`, and locator. PIT Snapshot labels are request identity/digest, snapshot identity/fact digest, consumed Source Binding identity, lineage root/version, outbox digest, observational `is_available`, and locator. Without a separately admitted product resolver, every value row is `UNAVAILABLE_NO_PRODUCT_RESOLVER`; footer buttons are Open foundation evidence then Copy foundation locator. No provider‑authentication, ingestion, payload, credential, database locator, writer, resolve, refresh‑canary, positive badge, row, timeline, or mutation slot exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `PortfolioViewUnavailableCard`                                                                                           | fixed PR #332 source revision and schema `1`. Header slots are request identity/digest, projection time, valid‑through time, availability and disposition. The principal‑claim block orders claim identity, issuer, principal, account, Execution Scope, PAPER/LIVE mode, authorization‑policy cut, not‑before time and valid‑through time, always with a caller‑supplied/untrusted badge. The dependency table has three Owner groups and exactly eleven ordered rows: Execution account/open orders/fills/fees/settlement; Market Data price/FX/contract/valuation/liquidity; Portfolio snapshot. Columns are kind, claimed Owner, locator, frontier, sequence, common cut, principal, account, Execution Scope, mode, authorization‑policy cut, observed time, valid‑through time and applicable structured failures. Because no Dashboard consumer exists, every request‑bound slot is an em dash and a fixed `UNAVAILABLE_NO_DASHBOARD_CONSUMER` banner precedes the contract legend; it never fabricates an `UNAVAILABLE`, `INCOMPLETE_FAIL_CLOSED`, or `STALE` response instance. Footer buttons are Open contract evidence then Copy contract locator. No positive Account/Performance/Exposure/Gross Capacity/Attribution value, chart, table, timeline, filter, refresh, resolve, headroom, allocation, Risk, deployment or trading slot exists |
| `PortfolioViewRequestBindingBlock`                                                                                       | mandatory first child below the `PortfolioViewUnavailableCard` header and before the principal‑claim block. It orders the request‑side operands independently as principal identity, account identity, Execution Scope identity, PAPER/LIVE mode, authorization‑policy cut, and common‑cut identity. Claim and dependency blocks compare against these six slots to make principal‑claim mismatch, cross‑scope and mixed‑cut geometry drawable. Without a Dashboard consumer every value is an em dash; the block has no trusted, matched, resolved, available, retry, or action state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `PortfolioViewFailureList`                                                                                               | read‑only ordered failure vocabulary: `UNSUPPORTED_SCHEMA_VERSION`, `INVALID_FIELD`, `MISSING_DEPENDENCY`, `DUPLICATE_DEPENDENCY`, `CROSS_OWNER_DEPENDENCY`, `INVALID_FRONTIER_SEQUENCE`, `PRINCIPAL_CLAIM_MISMATCH`, `CROSS_SCOPE_DEPENDENCY`, `MIXED_CUT_DEPENDENCY`, `FUTURE_DATED_DEPENDENCY`, `STALE_DEPENDENCY`, `EXPIRED_REQUEST`, `EXPIRED_PRINCIPAL_CLAIM`, `VALIDITY_OUTLIVES_PRINCIPAL_CLAIM`, `VALIDITY_OUTLIVES_DEPENDENCY`, `CALLER_SUPPLIED_PRINCIPAL_CLAIM`, `CALLER_SUPPLIED_SOURCE_LOCATOR`, `SOURCE_OWNER_RESOLVE_UNAVAILABLE`. Each item displays its typed field/kind/owner coordinate when present; it has no dismiss, override, retry or promotion action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `CapacityScopeCard`, `GrossCapacityView`, `CapacitySourceCompleteness`                                                   | account/mode/economic‑pool scope, candidate‑neutral gross ceilings, exact Execution/Market Data cuts, availability and frontier; while configuration authority is unresolved the fixed card state is `INCOMPLETE_FAIL_CLOSED`, names the missing Owner/fact/state‑machine predicate, exposes no positive BOUND badge or action, and has no usage, headroom, Reservation, allocation, or permit fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `RiskDecisionTable`, `ReservationLiabilityCard`, `ClaimAndAdmissionTable`                                                | terminal decision lineage, one‑use Reservation states, stable claim/admission results, complete rejection set and exact linked effects; legacy forwarded commands have no row shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `AggregateFrontierCard`, `FenceSetAndFrontier`                                                                           | one Risk‑owned Capacity Scope frontier, held liabilities, immutable fence‑set membership and transaction ordering; no Portfolio write or UI release action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `WorkerCard`, `WorkerTable`, `ScheduleCard`                                                                              | operational state separate from business state; no generic worker administration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `FenceBanner`, `UnknownEffectBanner`, `ReconciliationPanel`                                                              | persistent safety surfaces and locators                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `NotAdmittedNotice`                                                                                                      | unavailable capability and evidence required for promotion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

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

`S1TerminalCustodyPanel [data-state="stale"]` applies warning styling only to its currentness row:
`border-inline-start: 3px solid var(--status-warning)` and
`background: color-mix(in oklab, var(--status-warning) 8%, var(--surface-card))`; its state icon and `STALE` label
also consume `--status-warning`. The verified receipt and TrialFamily evidence rows continue to inherit
`--surface-card`, `--text-primary`, and `--border-default`, with no positive wrapper. Missing or cross-bound
terminal custody switches the whole fixed geometry to `--status-unavailable` instead of reusing stale styling.

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
- `PREFLIGHTING` and `ADMITTING` use amber pending text plus distinct `Checking…`/`Submitting…` labels;
  `ADMITTED` uses `--status-info` blue and never green. Only an Owner terminal receipt may use semantic success.
- Admission-state text is exposed through a polite live region; persistent unknown/unavailable transitions use an
  alert announcement. Spinner, motion, color or an operationally green job is never the only state signal.
- Identities wrap or scroll within their component and provide copy actions.
- Tables preserve headers, units, sort, source cut, pagination; large data/log views are virtualized.
- At `>=1280 px` use the full shell and multi-column grid. At `768-1279 px` collapse spans. Below `<768 px` use a
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

The backend authority target nevertheless requires an Operator Authorization Owner operation for append-only
successor issuance on an existing scope. It must bind the prior authorization identity and sequence, preserve the
same canonical principal/audience/permission scope, append the new validity and receipt, and make changed-scope or
duplicate-sequence requests conflict. For an admission before its first downstream mutation, only its original
binding or one immediate successor may supply current-policy evidence; chain distance greater than one fails closed
even if every link is equivalent. `AuthorizationSuccessorReadiness` may resolve and display that Owner fact and
distance, but the Dashboard BFF never invokes issuance or walks to a later head. Until canonical Owner API,
direct-successor enforcement, and PostgreSQL evidence exist, expired-history recovery is `NOT_ADMITTED` and every
dependent Product Edge claim remains unavailable.

The observed candidate proves three independently rendered readiness stages: Operator Authorization custody,
Product Edge current binding/admission custody, and the Product Edge-to-R&D downstream seam. OA and PE genesis can
both resolve, and Product Edge can atomically commit an admission plus outbox, while R&D still cannot consume that
admission in its mutation transaction. The Dashboard therefore preserves both sealed OA/PE receipts and renders
the downstream seam separately; it never collapses the missing R&D receipt into an input rejection.

The required backend target is `ProductEdgeDownstreamAdmissionResolverV1`, a Product Edge-owned hardened port that
is callable by R&D within R&D's physical PostgreSQL transaction. Its SQL boundary uses non-locking normalized hints
only to build the complete bounded OA locator plan, obtains the sorted/deduplicated OA shared locks first, then
locks the complete Product Edge binding/history/head/supersession/manifest/admission/receipt/outbox set and returns
a provenance-bearing read-only envelope with no table handle. SQL performs no business admission, writes no fact,
and never constructs sealed authority. The Product Edge Rust boundary reuses OA's explicitly non-authoritative
canonical-envelope parser, verifies the complete OA and PE row/digest/receipt/outbox/cross-binding set, and alone
privately constructs the non-deserializable sealed downstream admission readback that R&D may consume. A changed or
new locator after the hint cut aborts the transaction; no additional OA lock is acquired after any PE lock. R&D
receives schema usage plus exact function execute only. PUBLIC and unrelated Owners receive neither. A separate
Product Edge connection, an unlocked read, direct R&D OA permission, raw SQL-envelope consumption, or Dashboard/BFF
reconstruction cannot satisfy this contract because each breaks the lock cut or Owner boundary. Until both layers
and their migration/ACL are dynamically admitted, the seam remains backend `NOT_ADMITTED`, the BFF returns
`partial/unavailable` with the exact stop predicate, and S2/provider effects remain zero.

It never queries Owner tables directly. A typed Dashboard API/BFF calls public Owner/Product Edge ports and returns
discriminated `available`, `stale`, `partial`, `unavailable`, `unknown`, `rejected`, and `terminal` envelopes.
Every cache entry carries source identity/cut, projection version, observed time, expiry, and rebuild path. Deleting
Dashboard or job storage does not change a business fact.

R&D S1 V2 has a two-stage mutation boundary. New Independence Basis creation uses `FirstMutation` and therefore
requires current Product Edge authority. After the basis receipt, basis head, and Owner outbox commit, an R&D-owned
stage resolver canonically verifies their exact request, complete typed request meaning, original admission,
digests, and commit cut. When the Qualification and terminal Research receipts are still absent, it returns sealed
`SEALED_BASIS_PENDING_QUALIFICATION` custody. The public same-identity `resolve_v2` entrypoint consumes that custody
without caller request bytes and the second transaction uses `Historical` completion semantics; a terminal-only
receipt lookup is not a resolver. Ordinary row existence cannot construct that custody; duplicate basis/head/outbox
writes are forbidden, and a changed request or admission conflicts. If Qualification committed before response loss
and later becomes stale, recovery requires a Qualification Owner-issued, canonically linked renewal/successor (or
equivalent typed recovery fact) followed by fresh locked readback. R&D, Product Edge, Dashboard, and the caller
cannot extend its validity. Dashboard/BFF may display these sealed projections but cannot mint either one or
substitute current authority for historical completion.

For R&D S1 V2, one typed envelope groups the request receipt, Research View, TrialFamily root receipt,
INTENT-membership receipt, and Census frontier returned by direct R&D Owner readback. Before terminalization, any
missing, corrupt, stale, or inconsistent prerequisite is `unavailable`. After every terminal part is directly and
cross-binding verified, later linked-view expiry preserves the complete historical `ACCEPTED` receipt/family in a
separate `terminal/stale` envelope and removes every positive action; it never returns a receipt-less unknown. For S2, `SUCCESS`
requires the Artifact, Build Receipt, Artifact Review, Artifact-to-TrialFamily binding receipt, and bound Census
frontier from the same Owner transaction. The BFF exposes separate same-identity request and build-attempt resolve
operations; neither operation dispatches a replacement job or derives a family from caller-provided identifiers.

Replay action admission consumes the complete selected S2 Owner projection and verifies every required identity,
receipt/binding, locator, availability, and currentness field against the Replay request. A UI/display boolean such
as `selectedS2Available` may describe derived display state, but it must never authorize `RUN` or substitute for the
Owner projection. A missing, malformed, mismatched, stale, or unavailable projection disables `RUN` and produces
zero Replay dispatch or business write.

The S1 chain first performs complete pure V2 validation. Invalid input may commit only one independent rejection
receipt; it writes no independence basis, Qualification projection, Research receipt, Intent, family, member, head,
or outbox. Only the resulting opaque validated marker can enter positive formation. R&D then writes or reuses its
write-once basis fact; Qualification resolves that exact basis and publishes or reuses an opaque protected-feedback
frontier; Product Edge carries only their references and cuts. In the final `scope -> request` locked transaction,
R&D re-reads both Owner facts and its full local lineage before any Research/family write.

Qualification physical custody is a separate Owner boundary. A distinct `qualification_owner` owns the
Qualification tables, sequences, and writer role; `rd_owner` has no ownership, raw `SELECT`, or
`INSERT/UPDATE/DELETE` privilege on them. R&D receives only exact `EXECUTE` on a narrowly scoped
Qualification-owned `SECURITY DEFINER` locked resolver/admission function in the caller's transaction. The function
uses a fixed safe `search_path`, fully qualified relations, and the existing global lock order, and returns only a
raw canonical envelope. Qualification-owned Rust verifies that envelope and alone constructs the sealed,
non-`Deserialize` positive readback; no public raw-envelope-to-positive constructor exists.

The final mutation cut is sampled only after all OA, Product Edge, and Qualification canonical locks and the final
Qualification reread. OA authorization, Product Edge binding/manifest, and Qualification half-open validity are
revalidated at that exact cut, and the same cut is bound into identities and receipts immediately before the first
write. Expiry while waiting produces zero write. An already committed Product Edge admission with no R&D receipt
may perform its first mutation against its exact original canonical binding after a policy-equivalent successor is
`ACTIVE`, but only with current authorization and exact stored lineage at the final cut. New admissions still
require the current `ACTIVE` head and obey the zero-active fence.

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
Prepared-to-Building/terminal transition. A server-proven `STALE` or pre-dispatch `UNAVAILABLE` path produces zero
business writes. `SUBMITTED_OR_UNKNOWN` means the effect boundary was crossed and write outcome is unknown; it can
expose only exact-identity resolution and must never claim zero write, return to preflight or dispatch a retry.
Recovered canonical Prepared custody is a distinct state.
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

Each registry operation also has a deployment state: `available`, `archived`, or `unavailable`, backed by one
content-addressed compatibility envelope. The envelope binds the operation/schema/effect set, required service and
image digests, App and script-lock hashes, Owner API/schema versions, channels, source identities and an observation
cut. It may deliberately compose multiple service artifacts; availability requires the observed component set to
equal that one envelope, not merely share a Compose project, report healthy, or resemble source text. Mixed
config-file sources, missing App/script hashes, or any expected/observed mismatch render the operation unavailable
with the exact failed predicate. `archived` removes dispatch and domain mutation actions from UI and MCP while
preserving route geometry, capability identity and read-only Owner-linked historical runs. Only an externally
completed, version-matched deployment plus consumer revalidation may return it to `available`; the Dashboard never
creates the envelope, performs archive/restore, or infers availability from source code or a historical run.

## Packaging and deployment target

The Dashboard ships with the Trade image set as the default visual entry and control surface. It must pin frontend
dependencies; produce a content-addressed artifact; run unprivileged with a read‑only filesystem except explicit
caches; expose process readiness without claiming Owner/trading health; accept endpoints and opaque secret
references at runtime; keep credentials out of images, HTML, bundles, URLs, logs, telemetry, and errors; preserve
separate Owner stores/credentials; and include asset manifest, provenance, compatibility declaration, and route
smoke test.

Windmill and Dashboard may coexist during migration without dual business writers. Cutover is consumer based:
every admitted Windmill Web/MCP journey passes through the new Dashboard/registry with the same Owner receipts and
fail-close behavior. Windmill removal is a separate reversible cleanup after parity, cache-loss recovery, and
artifact custody are proven.

## Unattended implementation sequence

The backend dependency wave is a `TARGET_DRAFT` development-custody constraint and does not authorize Dashboard
implementation. PR #327 has already merged the F1 read-only Observability source projection as `CURRENT/PARTIAL`
after independent exact-head review and repository gates. Its real Owner canonical-outbox adapter, telemetry
backend, runtime/default-Windmill consumer, and every Dashboard implementation remain unavailable or
`NOT_ADMITTED`. PR #332 separately supersedes the planned Portfolio static Scope skeleton with the
`CURRENT/PARTIAL` fail-closed public request/unavailable-envelope contract; it still exposes no direct-source
composition, positive readback, `PORT_BOUND`, Dashboard consumer, or effect. The first logical W1 wave after Hub
acceptance was exactly five parallel leaves: **Market Data Binding**, **Execution Binding**, **Portfolio Scope
fail-close skeleton**, the **Risk-Execution edge-break**, and **GR0 Governance-Runtime Sealed Read Seams**. GR0
changes only the two existing Owner crates to expose concrete sealed read seams; it creates no shared crate and
does not edit root workspace files. The edge-break is a five-file, zero-lock mechanical predecessor: move the
trailing algorithm to Model, retain an Execution compatibility re-export, and reduce Risk's Execution dependency
to dev-only. Risk Core cannot start before it freezes. Market Data facts succeed Market Data Binding; the Execution
Sandbox descriptor succeeds Execution Binding and is never part of the same leaf writer.
There is no dependency-prewire task: each leaf adds an Owner-evidence dependency to its package manifest only when
its real source imports the exact public API. Leaf tasks must not edit root `Cargo.toml`, `Cargo.lock`, or `Makefile`;
after all five heads freeze, the sole **GR1 root/lock/testkit fan-in** may create the read‑only relation crate, update
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
7. **Portfolio projections** - PR #332 admits only deterministic request/replay validation and the structured
   unavailable envelope. Until the private Execution, Market Data, and Portfolio direct-source resolvers and their
   composition are separately admitted, render `PortfolioViewUnavailableCard` on all four routes and expose no
   request-bound values. A later positive phase may begin only from the sealed Owner readback contract, after a
   real Dashboard consumer is admitted; it must not infer `PORT_BOUND`, Account, Performance, Exposure, Gross
   Capacity, Attribution, Risk, usage, or headroom from caller claims, legacy Cache snapshots, or the unavailable
   envelope.
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
