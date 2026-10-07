# Trade Dashboard

<Callout type="info" title="Readback first; controls belong to Governance">

Research routes are read-only. The route admission and exact geometry sections govern implementation; inventories do not admit additional components. Lifecycle controls require their own Governance authority.

</Callout>

## Product role and authority

Dashboard is the first-party interface for one operator. It reads research progress, evidence, results, telemetry and operational jobs, and submits admitted Governance requests for activation, policies and strategy operation.
Research is initiated through the external Agent and domain MCP; Dashboard neither controls research nor the Agent. An Owner-projected next action is not browser authorization.

The Dashboard is never a business-truth Owner. It may cache UI state and disposable job projections, but it
must not own Research Intent, Artifact, Backtest Result, Qualification, legacy Scanner Receipt, lifecycle
authorization, Runtime application, Portfolio, Risk, order, fill, reconciliation, or Recovery truth. Every
business state and allowed action carries its Owner identity, source cut, observed time, freshness or
availability, and native receipt locator. Unknown, stale, partial, rebuilding, quarantined, and unavailable
remain explicit. The Product Edge treats `UntrustedOwnerEvidenceLocatorV1` and `UntrustedLocatorDigest` as routing/integrity
vocabulary, never as proof.

It must call the identified source Owner's typed public resolve port and validate the canonical bytes reread
returned from that Owner's durable store/outbox. Neither browser, BFF, shared library, nor consumer service
may establish provenance with caller-supplied authority text, a self-canonical digest, a generic verifier, or
a shared signer.

```text
User -> Dashboard typed request -> Product Edge admission -> native Owner
User <- Dashboard projection <- Owner receipt/view or explicit unavailable state

Telemetry/Owner events -> rebuildable Dashboard projection
Dashboard job success -X-> business success or trading authority
```

Mutating controls stay disabled until the current Owner projection admits exactly that action. Submitting creates
a typed request; it never edits an Owner record. An unknown outcome exposes only same-identity resolve. Real
trading and any other production write still require explicit user authority outside this design document.

Discovery is R&D on-demand observation. Retaining `/scanner` is URL compatibility, not scan schedules or deployment proposals.
Unadmitted Discovery views below remain target; navigation creates no implementation authority. Existing Operations
read-only schedule history retains accurate facts without authorizing new market scan schedules.

This chapter defines Dashboard layout, interaction and slice admission. Implement only the exact admitted slice; admission proves neither service availability nor business acceptance and authorizes no executor cutover, production write, provider effect or trading. See [status vocabulary](#status-vocabulary-and-evidence-cut).

### Reading entrypoints

| Task                                   | Exact section                                                                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product layout                         | [Product shell and layout](#product-shell-and-layout) / [Navigation contract](#navigation-contract)                                                                                                                                            |
| Route skeleton and exact page registry | [Canonical route skeleton](#canonical-routed-page-skeleton) / [Routed page blueprint registry](#routed-page-blueprint-registry)                                                                                                                |
| R&D and Backtest slice admission       | [Implementation admission by slice](#implementation-admission-by-slice)                                                                                                                                                                        |
| Operations precise contracts           | [Exact Workers read‑only skeleton](#exact-workers-readonly-skeleton) / [Service Logs exact read‑only skeleton](#service-logs-exact-readonly-skeleton) / [Exact Operations Audit read‑only skeleton](#exact-operations-audit-readonly-skeleton) |
| Components and behavior                | [Reusable component inventory](#reusable-component-inventory) / [Interaction, responsive, and accessibility rules](#interaction-responsive-and-accessibility-rules)                                                                            |

The slice ledger is not the complete admission set: Operations and Overview contracts also appear in their exact skeletons and registry. Exact route geometry and local admission override general skeletons; inventories grant no additional slot action or implementation permission.

## Page design

### Product shell and layout

The product shell uses warm neutral canvas,
compact icon rail, capsule navigation, white content cards, gray framed panels, dense small typography, and
responsive Bento composition. Glass belongs only to navigation and transient overlays, never data cards or
business-state panels.

#### Reference implementation anchors

The table and CSS token section define current geometry and tokens independently; implementation requires no other checkout. Optional visual provenance is `vibe-trading` commit `4a6d66fb77fc144c2a013417c703db2caf401641` / tree `984c7d684dba72a6af78dc3e6cf50191bc3622ea`. Reference paths identify the source only; they create no business, route, or capability authority.

| Reference path under `apps/web/src`                                              | Inherit                                                                                                                                                                  | Explicitly do not inherit                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `app/globals.css`                                                                | Mine warm‑neutral raw palette, Inter/JetBrains Mono, market‑direction separation, and the allowed zones/values for `glass‑heavy`, `glass‑light`, and tooltip glass       | Factor/status token names as Trade business semantics; arbitrary literal colors                                |
| `components/layout/left‑icon‑sidebar.tsx`                                        | 52 px rail content, 40 px round targets, 18 px icons, 1 px item gap, centered/scrolling heavy‑glass capsule, dark active item                                            | Reference module identities or phase labels                                                                    |
| `features/blueprint/components/doc‑mode‑shell.tsx`                               | Full‑viewport flex shell, 12 px sidebar padding, 16 px content gap and right/bottom gutters, bounded inner overflow                                                      | Blueprint mode, document toggle, or mock content as product features                                           |
| `components/shared/bento‑grid.tsx`                                               | Container‑observed `wide/narrow/collapse` composition, `rowHeight=180`, `gap=16`, 560 px collapse and 700 px narrow evidence, 1/2/3/4/8 column spans and 1‑4 row spans   | Its 1/2/3/4/8 API as the routed‑page grid, or its 560/700 container thresholds as global viewport breakpoints  |
| `components/layout/top‑nav‑bar.tsx`                                              | 56 px top bar, replaceable left context slot, light‑glass capsule tabs, notification/action zone                                                                         | Market ticker data as a universal header requirement; Dashboard uses the evidence‑bound status tape            |
| `components/ui/card.tsx`                                                         | White 12 px card, Mine border, restrained two‑layer shadow, compact structured header, optional canonical‑detail expansion                                               | The available `frosted` card variant; Dashboard business/data cards remain opaque                              |
| `components/ui/table.tsx`, `lib/data‑table/components/data‑table.tsx`            | Full‑width bounded scroll container, sticky 40 px dark header, 8 px cell padding, fixed‑layout percentage columns, ellipsis, row hover, and 96 px empty row              | Reference business columns, selected‑row/bulk behavior, or client‑side data authority                          |
| `lib/data‑table/components/data‑table‑pagination.tsx`, `data‑table‑skeleton.tsx` | Compact responsive pager geometry, 32 px controls, explicit page‑size selector, first/previous/next/last order, and shape‑equivalent filter/header/body/footer skeletons | Reference selected‑row count, page‑size defaults, or unbounded in‑memory pagination                            |
| `lib/chart‑tokens.ts`                                                            | Resolve CSS custom properties when Canvas or another JavaScript renderer cannot consume `var(...)` directly                                                              | Component‑local chart palettes or literal status colors                                                        |
| `features/blueprint/data/modules.ts`                                             | Visual density and route‑backed capsule‑navigation pattern only                                                                                                          | The stopped product's module order, labels, phase badges, mock metrics, workflow claims, or trading capability |

This chapter owns Trade navigation, status, and admission semantics; visual matching proves neither real data nor capability.

```text
+----------------------------------------------------------------------------------+
| user | status tape / context                         tabs | search | notifications |
|---|---|
| | page header / authority / freshness |
| side | |
| rail | responsive Bento: cards, panels, tables, charts, timelines |
| | |
| | optional right drawer: receipt, identity, evidence, action detail |
+----------------------------------------------------------------------------------+
```

Desktop shell contracts:

- full-screen viewport with no second page scrollbar;
- 76 px left column: 12 px outer padding, 52 px rail content, 12 px inner separation;
- 56 px top bar; 16 px right/bottom gutter and 16 px Bento gap;
- vertically scrollable icon rail with hidden scrollbar;
- bounded card, table, and log scrolling;
- optional 400-520 px detail drawer that does not replace the canonical route.

### Navigation contract

#### Side menu

The side menu is workflow ordered. Icon, accessible label, route, and position are stable. A feature flag may
disable an unavailable item but may not reorder it.

| Order | Module        | Route            | Purpose                                                                         |
| ----: | ------------- | ---------------- | ------------------------------------------------------------------------------- |
| 01    | Overview      | `/dashboard`     | Global Status View, attention queue, recent Owner outcomes                      |
| 02    | R&D           | `/rd`            | Sources, research requests, hypotheses, Artifacts, decisions                    |
| 03    | Backtest      | `/backtest`      | Exploratory runs, comparison, allowed diagnostics                               |
| 04    | Qualification | `/qualification` | Intake, bounded binary public outcomes, and eligibility facts                   |
| 05    | Discovery     | `/scanner`       | R&D on‑demand queries, jobs, signals and coverage                               |
| 06    | Strategy      | `/strategy`      | Registry, lifecycle authorization, allocations                                  |
| 07    | Runtime       | `/runtime`       | Applied generations, instances, checkpoints, incidents                          |
| 08    | Portfolio     | `/portfolio`     | Performance, exposure, capacity, attribution                                    |
| 09    | Risk          | `/risk`          | Decisions, reservations, claims, adapter admissions, aggregate frontier, fences |
| 10    | Execution     | `/execution`     | Attempts, orders, fills, reconciliation, Recovery readback                      |
| 11    | Data          | `/data`          | Sources, PIT catalog, quality, corrections, freshness                           |
| 12    | Operations    | `/operations`    | Runs, workers, run/service logs, audit, telemetry, alerts                       |
| 13    | Settings      | `/settings`      | Data‑source, external Agent access, notification, access configuration          |

The rail starts with the user capsule and local-installation menu. The module capsule is vertically centered when
it fits and scrolls otherwise. Active items use a dark circular fill and white icon; hover, focus, disabled, and
attention states remain distinguishable without color.

#### Top menu

The top bar has four zones in order:

1. **Status tape** - active mode/scope, Market Data freshness, R&D queue, Observation status, Runtime readiness,
   Risk fence, and last reconciliation. Unavailable is never hidden.
2. **Module tabs** - route-backed rounded capsule with the same active treatment as the side rail.
3. **Global search/command** - searches identities, receipts, Artifacts, runs, strategies, orders, and docs. A
   command may only open a route or prepare an admitted typed request.
4. **Notifications** - unread count and alert drawer. Delivery is not an Owner outcome or acknowledgement.

| Module        | Tabs in order                                                    |
| ------------- | ---------------------------------------------------------------- |
| Overview      | Status, Attention, Recent, Evidence                              |
| R&D           | Intake, Research, Hypotheses, Artifacts, Decisions               |
| Backtest      | Exploratory, Compare, Diagnostics                                |
| Qualification | Intake, Outcomes, Eligibility                                    |
| Discovery     | Queries, Results, Coverage                                       |
| Strategy      | Registry, Lifecycle, Allocations                                 |
| Runtime       | Instances, Generations, Checkpoints, Incidents                   |
| Portfolio     | Performance, Exposure, Capacity, Attribution                     |
| Risk          | Decisions, Reservations, Claims & Admission, Fences              |
| Execution     | Attempts, Orders, Fills, Reconciliation, Recovery                |
| Data          | Sources, PIT Catalog, Quality, Freshness                         |
| Operations    | Runs, Workers, Schedules, Service Logs, Audit, Telemetry, Alerts |
| Settings      | Data Sources, Agents, Notifications, Access                      |

On narrow screens the tape collapses to a status button, tabs scroll horizontally, and the rail becomes a drawer.
Order, route identity, and authority labels remain unchanged.

### Page and data rules

#### Facts, freshness and disclosure

Each panel reads its canonical Owner projection. It separates business outcome from operational completion and binds identity, source cut/frontier, observation time and validity. Another source's fresh data cannot renew stale evidence; unavailable is not zero or healthy. Owner-projected half-open validity applies: at `now == valid_through` a view is non-current. Browser clocks cannot extend authority, and intervals with `available_at >= valid_through` are invalid.

Caches are disposable. Cache loss, reconnect or rebuild resolves original identities; it never creates an alternative fact, changed fingerprint under the same identity or positive result from stale telemetry. Missing producer/currentness evidence withdraws the positive view. notifications and Observability carry hints/telemetry, never admission, retry, closure or lifecycle authority.

The Dashboard and external Agents share the same bounded qualification feedback. Protected Qualification detail, internal three-level judgments, protected-period returns/drawdown, equity and order/fill detail never enter any Dashboard page, export, chart, filter or alert; there is no user unsealing entry. Negative reasons/categories and protected timing remain isolated. All negative public terminals are byte-equivalent `CLOSED_NOT_QUALIFIED`; `QUALIFIED` remains exact. Permitted task-state and evidence-availability projections add no protected information. Permitted ordinary research, real trial and production trading reports remain fully displayable. Account and operational projections do not imply trading permission.

#### Research custody readback

Source → frozen Research → immutable Artifact → native Backtest → R&D decision is a domain-service journey initiated by the external Agent. Dashboard offers readbacks of those facts, not a parallel workflow.

A sealed basis without a terminal Research receipt remains `SEALED_BASIS_PENDING_QUALIFICATION`; original request/admission, basis and commit cut stay bound. The authorized domain resolver uses complete sealed custody across expiry/cutover, never creates another basis or accepts replacement request meaning. The browser only reads that state. A durable terminal remains visible after linked view expiry, with current actions absent.

Artifact/readback verifies the exact request, attempt, Intent, Artifact/Build and family identities. Unknown invocation state retains its original claim and fence; no new provider invocation or inferred success occurs. Quarantined records expose only admitted historical custody and cannot satisfy current selectors. Exact omission/null, schema, digest and identity rules are the [R&D contract](../owners/rd/), not browser heuristics.

#### Operating state

Governance approval and Runtime application are distinct: display `APPLIED` only from the bound application receipt. Stale eligibility, required performance/exposure or degradation prevents new risk; fences preserve the decrease-only path. Portfolio supplies actual account/capacity facts, Governance applies approved allocation and composition policy, and Risk admits reservations at its atomic frontier. Dashboard cannot recompute these facts from display values or rank strategies as a competing allocator.

Every route renders the declared loading, empty, filtered-empty, partial, stale, unknown and unavailable geometry. A missing endpoint stays unavailable; no fixture, mock, log, notification or screenshot establishes a producer, direct consumer, `PORT_BOUND` or effect readiness.

#### Page decomposition and operational layout

Domain routes use the canonical twelve-column shell. Wide layouts may place the primary panel in eight columns and its supporting panel in four; below 768 px, panels stack in semantic order. The admitted exact-readback routes above use their own fixed full-width geometry. They receive no new form, split pane or reserved height from this general layout.

##### Exact S1 V2 and S2 page skeleton

Source, Research, Composer and Artifact pages display submitted requests and canonical Owner evidence. Lookup identity inputs, Open readback, Refresh and navigation are presentation/read actions only. Source, hypothesis, TrialFamily policy and strategy inputs are authored by the external Agent through domain MCPs, never through a Dashboard composer.

Readback preserves request/version/instrument identity, terminal disposition, receipt/custody identity,
linked view availability, exact Artifact/Build references and bounded next-action information as admitted by
each route above. Currentness and durable terminal history are distinct: expiry removes current authority
without rewriting the terminal. Partial basis custody remains unresolved; missing receipts cannot become
rejection or success. Unknown provider/replay work keeps its original identity; stale views cannot enable a
rerun, successor or provider invocation.

The exact underlying admission, claim, renewal and recovery rules remain in [Product
Edge](../architecture/product-edge/) and [R&D](../owners/rd/).

No Submit, Resolve mutation, Run bounded Agent, Build, Create successor, Stop research or Agent-dispatch control belongs to these pages. Displayed next legal actions describe what an authorized external caller may request; they are not browser permissions. Existing compatibility transports do not admit such controls into the current product. Only the separately specified Governance lifecycle controls may mutate business state.

Operations contains bounded Runs, Run Detail, Workers, Service Logs and Audit views. Arbitrary scripts, generic schedules, worker administration and editor controls are excluded. Settings shows opaque installation/access references, without owning deployment configuration, Capacity Scope or `PORT_BOUND`.

##### Exact Operations navigation and list-page skeletons

The fixed `ModuleTabs` order under Operations is `Runs`, `Workers`, `Schedules`, `Service Logs`, `Audit`,
`Telemetry` and `Alerts`. Runs, Workers, Service Logs and Audit read first-party RunStore and typed service projections;
Schedules is the separately admitted first-party bounded shadow-read surface; the last three come from Trade
architecture. On narrow screens they become a horizontally scrollable tab row in the same order, never a generic
More menu. Windmill Home, Variables, Resources, global Assets, and generic Schedules are absent from this row. Run Detail
Metrics, Traces, and Assets remain run-scoped tabs and never become global routes.

`/operations` is the canonical Runs route. Desktop keeps filters, columns, date groups, and row actions stable:

```text
H  Operations / Runs                        [Refresh] [Auto-refresh: Off v]
N  [Runs] [Workers] [Schedules] [Service Logs] [Audit] [Telemetry] [Alerts]
F  [Action runs|Data reads] [All|Waiting|Running|Completed|Failed|Cancelled|Unknown]
   [Search activity / run ID] [Duration v]
S  Waiting | Running | Unknown | Completed | Failed
T  RunTable / date group
   Status | Started | Duration | Activity | Started by | Source result
   row selection or final-column [Open] -> D
D  shared DetailSheet: status, activity, trigger, started, duration, source result
   [Open full details] -> /operations/runs/:runId
B  shown rows / filtered total | Rows per page [25|50|100] | Page n of m
   [First] [Previous] [Next] [Last]
```

The row and its compact `Open` action are two accessible origins for the same contextual inspection; both open the
single shared `DetailSheet` and preserve the Runs URL, filters, page, scroll position, and origin focus. Only the
explicit `Open full details` action inside that sheet may navigate to the canonical run workspace.

The Runs table uses fixed layout at `>=1280 px`: sticky header 40 px, date-group header 32 px, body
row minimum 44 px, and 8 px horizontal cell padding. `Activity` renders the shared business label;
hover/focus reveals its same exact registered operation ID. Activity, Started by, and Source result use one
line plus ellipsis, never raw payload. Default order is effective run time descending, then immutable run ID
ascending. Effective time is `started_at`, falling back to `received_at` for an unstarted run;
its Started cell remains an em dash.

Only Started and Duration headers expose sort controls, each cycling descending then ascending then back to
the default order. Date groups use the selected display time zone and remain newest first; changing filter,
time zone, grouping, or sort returns to page one.

The five `S` items never change count or position. Under the `action runs` or `data reads` group shoulder their
labels are exactly `waiting`, `running`, `unknown`, `completed`, and `failed`. Each value is one integer count;
a missing count is an em dash in its existing value slot. Counts use the selected kind plus every applied non-status
filter but ignore the selected status, so choosing one status never erases the other summaries.

The positive list projection retains the newest 512 rows after kind, search, and Duration filters and before
the selected status is applied. A 513th eligible row returns HTTP 200 with `availability=available`,
`completeness=partial_unavailable`, and `retention_limit=512`; it never makes the verified newest rows unavailable. Summary
counts, filtered total, pagination, and the page frontier are exact only inside that retained cut and must
never be labelled or interpreted as all-history totals. The source cut binds the retained rows, retention
limit, and completeness, so a boundary change invalidates an existing snapshot. A partial footer says that the
latest 512 are shown and older history is outside this view.

A filtered empty partial view says that no retained row matches; it never claims that no matching historical
row exists.

The control contract is closed rather than inherited from Windmill defaults. `Action runs` is the default kind segment;
`Data reads` is its only peer and maps only to the typed wire value `kind=dependencies`. `All` is the default status. Search is empty by default and matches only redacted
activity identity or immutable run ID. `Duration` is `Any` by default, followed by `<1 s`, `1-10 s`, `10-60 s`, and `>=60 s`.
The header auto-refresh menu is `Off` by default, followed by
`5 s`, `15 s`, and `30 s`. A cadence change takes effect immediately, does not reset pagination, and performs only
the same read as Refresh; hidden or offline tabs do not queue catch-up reads.

Kind, status, and Duration apply immediately on selection and return to page one. Search applies exactly 300
ms after the last edit; Enter or clearing the field applies immediately, while blur adds no separate
transition. A later search application cancels the earlier in-flight list read. The explicit Started and
Duration sorts never reorder the newest-first date-group rows: they sort only inside each group, or the whole
list when grouping is `None`. Started places rows with `started_at` first in the chosen
direction, ties by immutable run ID ascending, then places unstarted rows ordered by `received_at` in
that direction and run ID ascending.

Duration places rows with a duration first in the chosen direction, ties by effective time descending then run
ID ascending, and places missing-duration rows last by effective time descending then run ID ascending.

When the extended filter surface is admitted, `More filters` opens one 360 px popover anchored below
that button. Its fields are ordered `Trigger` (`All` default, `App`,
`Webhook`, `Other`), `Principal` (empty exact-text input),
`Tag` (empty exact-text input), `Time cut` (`Last 24 h` default, then
`Last 1 h`, `Last 7 d`, `Last 30 d`, `Custom`), `Display time zone`
(`UTC` default, `Browser local`), and `Group by` (`Day` default,
`Hour`, `None`).

`Custom` adds start then end inputs interpreted in the selected display time zone. Its footer is
`[Reset filters] [Apply]`; values are staged until Apply, Escape or outside-click discards them, and the button
badge is the count of non-default applied fields. Reset restores these six defaults and applies immediately.
`None` removes date-group rows; `Day` and `Hour` retain
newest-first groups.

Pagination defaults to 50 rows with only 25, 50, and 100 available. The footer keeps shown rows, filtered
total, page size, `Page n of m`, then First/Previous/Next/Last in that order; unavailable totals retain
the same slots with em dashes and disable page movement. Loading is exactly four summary skeletons, the two
filter rows, one 40 px header, three 32 px date-group bars for the default `Day` grouping, ten
44 px rows, and the complete pager skeleton. `Hour` uses the same three group bars;
`None` uses no group bar and still exactly ten rows.

Unfiltered empty, filtered empty, permission denied, and backend unavailable each occupy one 96 px full-width
table row with a distinct title, one-line explanation, and no fabricated count. An unfiltered empty Action
runs view exposes one compact `View data reads` secondary action that selects the existing Data reads
segment; it creates no run and issues no effect. Only backend unavailable exposes Refresh through the existing
route header. Absent tag and concurrency fields are not promoted into empty business columns or explanatory
copy.

At `768-1279 px` the table retains the same order in a 960 px minimum-width bounded horizontal
scroller. Its 8% action cell keeps the standard 8 px horizontal padding and contains a 32 px text Open button,
a 4 px gap, and the 24 px More button when admitted. Buttons plus padding occupy exactly 76 px, fitting the
76.8 px cell at the 960 px minimum table width; wider tables retain the same left-aligned geometry. Below
`768 px` it becomes a six-row run card: status + effective time; activity; Source result; Started
by; duration; then Open.

Cards have 12 px padding, 12 px gap, and 156 px minimum height; six loading cards replace the table rows,
while the same filter order and pager remain. Card selection opens the same `D`; no checkbox,
column chooser, selection count, bulk action, or swipe action exists.

`Show schedules` and `Show future jobs` are absent by default. They append to the second
`F` row only after a typed schedule/future consumer is admitted. The 8% `Open`
cell contains `[Open]` first and, only for a completed run with a disposable cache plus a current
`OperationalActionEnvelope`, a 24 px `[More]` button second. Its sole menu item is `Delete disposable cache`.
At `>=768 px` that item opens a 480 px dialog ordered as immutable run ID, cache locator, Owner
readback locator, the fixed statement `Business facts are unaffected`, consequence, and stop predicate; footer buttons
are `[Cancel] [Delete cache]`.

Below `768 px` it uses a full-screen sheet of `100vw × 100dvh` with zero radius; the same
ordered fields scroll inside it and the same footer stays sticky at the bottom. Missing eligibility or
envelope removes More rather than disabling it. The mobile card places the same two controls left-to-right in
its sixth row. The list has no bulk rerun, bulk delete, editor link, checkbox, or other overflow action.
Empty, filtered-empty, permission-denied, and backend-unavailable remain distinct as specified above.

##### Exact Workers read‑only skeleton

`/operations/workers` and `/operations/workers/:workerId` are `DRAWABLE_EXACT` and
`IMPLEMENTATION_ADMITTED` for first-party RunStore GET readback only. This slice reads bounded first-party registration/lease evidence only and grants no administration, cutover, Owner effects or production writes.

```text
H  Service capacity / Workers                                         [info] [Refresh]
N  Existing Operations tabs; Workers remains in its existing position
S  [Capacity] Ready | Offline               [Work handled] Processed | Active
T  [Availability: All / Ready / Offline]               [Search services]
   Service | Availability | Active / processed | Recent activity | Supports
D  Service + availability -> Availability -> Work handled -> Recent activity -> Supported work
   [Service information] -> [Back to services]
```

- Layout: `PanelFrame` (flat) contains header then body; body contains `CompactStatusBar` then
  `SplitBento(T,D)`. `P/Q` are absent (zero reserved height). At widths >=1280 px, columns are
  `minmax(560px,1.55fr) minmax(300px,.8fr)` with 12 px gap and content-driven heights; D is sticky at top 0.
  On the list route below 1280 px, T occupies the full inset and row activation opens the shared right-side
  `DetailSheet` without changing the URL; below 768 px that same sheet becomes full-screen. The exact route
  remains the canonical full detail and keeps D in page flow. At all widths T retains horizontal overflow,
  not a replacement card list. The 62 px minimum-height summary pill scrolls horizontally when necessary;
  each group is at least 52 px tall, with a 44 px title pill followed by its values. Shared theme tokens,
  title/action header, rounded inner content, subtle interrupted separators and Lucide icons remain authoritative.
- Summary: Ready counts available leases at the list observation cut; Offline counts expired leases;
  Processed sums durable job counts; Active sums active job counts. These are operational observations, not
  current process health or unbound-run readiness. A valid empty list yields four zeros; initial, invalid,
  transport-error or unavailable list yields four `-` values, never zeros inferred from failure.
  Detail availability cannot change list counts. No group, memory or occupancy estimate is invented.
- Table: columns in exact order are Service (minimum 250 px, identity link then added time), Availability
  (minimum 125 px, Ready/Offline badge), Active / processed (132 px), Recent activity (minimum 220 px,
  compact run reference then business state/time; absent activity says No activity), Supports (120 px, exact
  registered-operation count). All headers/cells align left. Every column supports ascending/descending sort;
  Active / processed sorts active then processed, Supports sorts count. Default is newest last-run time first, falling back
  to registration time; identity orders equal-time input rows. Browser validation requires unique identities,
  not JavaScript ordering of database-collated rows. No grouping, checkbox, bulk action or column chooser.
- Filters: one inline Availability selector with All, Ready, Offline in that order, followed by right-aligned
  Search services (maximum 128 characters). Case-insensitive local search covers identity, build fingerprint,
  last-run identity/state, registered operation IDs and their business labels. Shared Service/Availability column filters remain local.
  Pagination follows filtering: 20 rows initially, choices 20/50/100, range then previous/next controls;
  changing lease/search resets the page. On desktop, row selection updates in-page D. Below 1280 px it opens
  the shared short-detail sheet while preserving the list URL and returns focus to the originating row when
  closed. The Service cell and row both use this same-context selection; they do not navigate or duplicate the
  detail action. The exact route remains a deep-link compatibility surface, and its selection stays bound to the
  requested identity despite list/filter changes.
- Detail: heading is Selected service or Service details, compact service label, and Ready/Offline badge. Four ordered
  clusters have 8 px outer gap/padding, 13 px radius and 13 px by 14 px inner padding; facts use two equal
  columns with 12 px gap. Availability: Added, Last seen. Work handled: Processed, Active.
  Recent activity: contextual Run preview trigger, Started, with the business-facing run state or No activity in the title.
  The trigger reuses the shared `OperationsRunPreview` facts and exact `RunDetailEnvelopeV1`; it does not navigate the
  Workers surface or add a Run menu state. On desktop and the exact Worker route it opens the one shared `DetailSheet`.
  In compact list detail it replaces the Worker body inside that same sheet; `Back to service` restores the same explicit
  Worker and trigger, while Close restores the trigger that opened the sheet. The preview contains only bounded status facts
  plus `Open full run details`; logs and Run actions remain on the canonical Run route. It never stacks a second overlay and
  never infers its return target from a later table selection. Supported work: role and
  full-width registered-operation labels in registry order; exact operation IDs remain title evidence rather than
  primary copy. The footer exposes one shared `Service information` control containing exact service/build identity,
  the latest-signal observation scope, and the per-service availability boundary. Back to services appears only on the
  exact route.
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
- Action order/admission: header info then Refresh; same-context table selection; D Recent activity preview only with exact
  run identity; preview Open full run details; exact-route footer Back to services. Filters, sorting and pagination are local. All remote
  reads use GET/no-store and strict endpoint-specific envelopes; D must echo and match the path identity.
  There is no mutating action or operational/domain action envelope on this surface. Create/edit config,
  restart, cache-clean, REPL, autoscaling, host/group/version and heartbeat-history fabrication stay excluded.

##### Service Logs exact read‑only skeleton

`/operations/service-logs` is `DRAWABLE_EXACT` and `IMPLEMENTATION_ADMITTED` only as a first-party
RunStore GET projection of bounded operational evidence. This is the current Service Logs contract. It does not read retired-shell administration or log storage, and it does not admit a
worker command, Owner call, effect retry, deployment, cutover, production write, or trading action.

```text
H  Operational evidence / Service logs        [Refresh] [Auto-refresh on|off] [Download bounded]
N  Operations tabs in the fixed order above
S  [Severity] Error | Warning | Info          [Instances] Worker | Server
F  [Range: 15m|1h|6h|24h] [Kind: All|Worker|Server] [Service] [Instance] [Severity] [Search]
P  Source list: business source | kind/readiness | last observed
Q  Selected source: business source | services | kind/readiness | last observed | [technical info]
T  Time | Level | Activity | Source | Related
B  Showing newest n of retention limit | completeness/redaction/truncation disclosure
```

- Layout: one flat `PanelFrame` owns the outer radius and shadow. Its title/subtitle and the three actions sit
  directly on the frame background; no rectangular header card, self-radius, or independent header fill is
  permitted. The sole rounded inset is `PanelFrameBody`, containing `CompactStatusBar`, one-row filters, then
  `SplitBento(P, Q+T)`, followed by B. At widths >=1280 px, P is `minmax(248px, .55fr)` and Q+T is
  `minmax(620px, 1.45fr)` with a 12 px gap. Both columns are content-driven, neither receives a viewport-height
  minimum or stretches to match the other, and the page owns vertical scrolling. When the cut contains only one
  source, P is omitted and Q+T uses the full inset width; selection remains bound to that exact sole identity.
  Below 1280 px the order is S, F, P, Q, T, B in one column. T retains horizontal overflow and
  never becomes a card-per-log list. Header/cell text is left aligned. Shared theme tokens, 13 px inner radii,
  subtle interrupted row/column separators, and Lucide icons are mandatory; no blue focus/selection outline or
  caller-defined radius/fill may override the shared atoms.
- Query/cut: one strict `ServiceLogFilterCutV1` contains the exact ISO observation cut, one range from
  `15m|1h|6h|24h`, kind `all|worker|server`, one allowlisted service or `all`, exact instance identity or `all`,
  severity `all|info|warning|error`, and a trimmed case-insensitive search of at most 128 characters. Search covers
  only event code, correlation identity, service, and instance identity. The wire echoes the canonical filter cut
  and its `sha256` digest together with `projection_version=1`; unknown keys, invalid enum/identity/timestamp,
  future cuts, digest mismatch, or unbound rows fail closed. Filters are server-applied before retention bounding.
- Summary and instance selection: Error, Warning, and Info count the eligible filtered rows at the exact echoed cut
  before viewport pagination; Worker and Server count distinct eligible instances at that same cut. An available
  empty cut yields five zeros. Initial/loading,
  unavailable, invalid, transport-error, or permission-denied states yield `-`, never inferred zeros. A valid
  nonempty result selects the most recently observed instance, then identity as tie-breaker; a valid requested
  instance remains selected only when it is present in the same cut. No host is displayed or shortened:
  `host_ref` is canonically `null`, and instance identity is the only selectable locator.
- P/Q: P orders instances by last-observed descending then identity and uses one selected row tone from the shared
  accent family, without a border halo. Its primary copy is the business-facing source name, followed by
  kind/readiness and last observed. Q keeps the same identity-bound selection but presents source, services and
  observation state first. Exact instance identity and source/filter cut digests remain available only through the
  shared info control; no memory, process health, hostname, version, occupancy, or heartbeat history is inferred.
  If selection is missing or mismatched, Q and T use the same compact selected-instance unavailable geometry and
  expose no rows.
- T and retention: columns are exactly Time (190 px), Level (108 px), Activity (minimum 220 px), Source (190 px),
  and Related (minimum 160 px). Activity is a deterministic sentence-case presentation of bounded `event_code`;
  Source uses the exhaustive business label for its allowlisted service. Related links to Run Detail only when the
  correlation identity satisfies the exact run-identity contract; otherwise it remains neutral copy. Exact wire
  values stay in title/info affordances rather than the primary scan path. There is no free-form
  message field in V1 and the UI must not manufacture one. Default order is newest first by observed time,
  correlation identity, then sequence; every row key is correlation plus sequence. The viewport returns at most
  200 rows; pagination uses an opaque server-issued cursor bound to the echoed filter-cut digest, with 20/50/100/200
  page sizes. Cursor mismatch/expiry is unavailable, not an empty page. The gateway retention ceiling remains 512
  eligible rows per observation cut; changing any filter resets the cursor and page. `complete` and
  `partial_unavailable` stay visibly distinct.
- Event drilldown: selecting a verified T row opens the shared `DetailSheet` without changing the Service Logs URL
  or unmounting its filters, page, scroll position, or menu context. The sheet composes the shared `DetailFactGrid`,
  `DetailCluster`, `StatusBadge`, and `PanelFrameInfo` atoms; it does not redraw a route-specific detail surface.
  Selection is bound to filter-cut digest + correlation identity + sequence, so a replacement cut or page withdraws
  stale detail. Primary content answers activity, level, observed time, source, and exact source context; event code,
  sequence, correlation, instance identity, and source/filter cuts stay behind the information affordance. Only a
  correlation that satisfies the exact run-identity contract exposes `Open related run`; other events expose no false
  route. Opening a row performs no new read, closing returns focus to that row, and the shared sheet becomes a full
  viewport surface below 768 px. It never embeds the action-bearing Run Detail or infers cause, Owner outcome, or
  service health.
- States: initial read keeps the exact header/body geometry and renders zero synthetic rows with
  `READING_SERVICE_LOGS`; Refresh is disabled and labelled Reading. A refresh may retain the prior cut only while
  pending and labels it Previous observation. Any failed replacement clears prior positive instances, counts,
  selection, and rows before rendering the compact unavailable region. Valid empty and filtered-empty retain
  S/F/columns/B with a 220 px minimum T body. Partial data may render only validated rows and must keep a visible
  partial disclosure; malformed envelopes, unbound instance rows, duplicate correlation/sequence keys, or source
  cuts that do not cover displayed rows render no positive projection. There is no timer-based promotion to live,
  healthy, complete, or Owner-accepted.
- Actions and download: header order is Refresh, Auto-refresh, Download bounded. Auto-refresh is presentation-only,
  preserves the exact filters and selection, and follows the newest row only when the viewport was already at the
  tail. It never changes the observation cut in place: each refresh replaces it with a newly echoed cut. Download
  is GET/no-store and reuses the exact canonical filter cut, ordering, redaction, and retention selection; it is
  capped at 512 rows and 256 KiB UTF-8. A truncated download declares truncation and never silently differs from the
  viewport's canonical filtered set, although it may contain more rows than the current page. Download is absent
  during loading/unavailable/permission-denied or without a valid echoed
  cut. No POST/PUT/PATCH/DELETE endpoint, operational/domain action envelope, delete, clear, restart, REPL, retry,
  or health-promotion action exists.

The positive producer is Trade-owned RunStore data observed in one repeatable-read PostgreSQL transaction. A
browser fixture, copied retired-shell row, hand-authored JSON, HTTP success alone, or stale prior envelope cannot prove
availability. Dynamic acceptance must produce logs through the real disposable `PostgresRunStoreV1`, read them
through the production gateway and GET route, and exercise the browser filters/selection/download parity while
proving zero Owner, provider, scheduler, dispatcher, production, and trading effects. Logs cannot promote
Owner health, business success, worker readiness for an unbound run, Telemetry availability, or replacement
readiness.

##### Exact Operations Audit read‑only skeleton

`/operations/audit` is `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED` only for the first-party, append-only control-plane evidence
defined here. It never reads the retired shell's partitioned audit table as a positive first-party source: the
rows observed there exposed only principal, time and action kind while operation and resource are
`redacted`. They may remain external migration evidence, but cannot fabricate a target, outcome or
Dashboard audit identity. Target producers are successful `dashboard.dependency.cancel.queued.v1` and
`dashboard.operational_cache.delete.v1` transitions. Each inserts its audit event and immutable action receipt
in the same serializable transaction. R&D requests remain owning-service evidence, not a required Dashboard
control-plane registry or workflow.

Existing compatibility Source/Composer/Replay admissions retain their immutable receipt/audit pairs and exact
run/principal/authorization/action/mode bindings. Their begin transaction must commit before an Owner effect;
a failed insert rolls back the transition. Exact repeats resolve the same record; response loss never creates
another submission. Audit `succeeded` means admission committed, not Owner or provider success. Artifact
Formation remains rejected, and missing historical principals are never fabricated. None of these records
admits a new Dashboard research control or changes production/trading authority.

```text
H  Operations / Audit · one-line purpose                         [info] [Refresh]
S  activity: execute | create / update | delete
   outcome: succeeded | failed / denied
F  [24h|7d|30d|all] [principal] [operation] [outcome] [target or correlation search]
P  OperationAuditTable: Time | principal | operation | outcome | target
Q  Selected event: outcome; operation; principal; target; correlation;
   receipt; audit identity; authorization cut; observed time
T  Correlation timeline: Time | operation | outcome | receipt; canonical ascending order
B  count / completeness / retention                            [Copy audit locator]
```

`H` is the transparent `PanelFrameHeader`, 72-96 px high. The title and short product purpose remain left aligned;
the circular info control precedes the secondary Refresh button at the right. Technical scope, source-cut and
retention prose live only in that info popover or `B`, never as loose page copy. `S` is one compact
`CompactStatusBar` with two groups and the labels above; values are integers, missing data renders `-`, and zero is
shown only from an available source cut. The body inset begins with `S`, then `F`, then the `P/Q` split.

`F` is a single 40 px control row at `>=1024px` in the exact order above. Range values are `24h / 7d / 30d / all`;
principal and operation options come only from the current available cut; outcome is
`all / succeeded / failed / denied / unknown`; normalized search is at most 128 UTF-8 bytes and matches only exact
display-safe target/correlation text. At `768-1023px` controls wrap into two rows without reordering. Below 768 px
each control is full width and search remains last. Every filter is server-owned and replaces the observation cut;
no client-only filtering may reinterpret a page.

At `>=1024px`, `P/Q` is a `minmax(660px, 1.55fr) minmax(340px, .75fr)` split with a 12 px gap and a 420 px
minimum height. `P` uses `DataWorkspaceTable`, 44 px rows and these widths: Time 190,
principal 160, operation min 260, outcome 120, target min 240. Default order is `(observed_at, audit_identity)`
descending; Time is the only sortable column. A row click selects its exact audit identity and performs
`GET /api/operations/audit/{audit_id}`. `Q` uses one `DetailInspector` and the field order shown above; long
identities are visually compacted but retain full title and copy value.

`T` is inside the same inspector body below the selected-event facts and is limited to 256
events for that exact correlation at the detail observation cut. At `768-1023px`, `P`
precedes `Q`; below 768 px `P` is a horizontally scrollable table and
`Q` becomes a full-width block below it. Selection never changes the URL or offers a
mutation.

Pagination is server-side with opaque filter-bound cursors and page sizes `20 / 50 / 100`; changing page
size or any filter returns to page one. Loading preserves six 44 px table rows and the selected-card
footprint. The unfiltered empty state says no first-party audit events exist. Filtered empty says no events
match. A partial cut keeps verified rows and an amber completeness notice. Store/configuration unavailable and
permission-denied retain the `S/F/P/Q/B` geometry, use `-` summaries and expose the
machine reason only behind info.

Unknown audit identity returns the same `Q` footprint with `AUDIT_EVENT_NOT_FOUND`;
malformed/cursor-expired inputs fail closed with no rows. `B` shows displayed count,
`complete|partial_unavailable`, the fixed 512-event retention bound, and only when one verified event is selected the
secondary Copy audit locator action. There is no edit, delete, dismiss, replay, retry, Owner resolution,
provider claim, download or generic shell action.

The list API is `GET /api/operations/audit`; detail is
`GET /api/operations/audit/{audit_id}`. Both are `no-store`, consume `OperationAuditStore`, echo an immutable
observation cut and fail closed on malformed rows, duplicate audit/receipt identity, invalid correlation ordering,
filter/cursor mismatch or unreadable storage. The table is append-only: runtime `UPDATE` and `DELETE` are rejected.
The browser parser accepts exact keys only and recomputes the filter-cut digest before rendering a positive page.
On mobile this page preserves `H -> S -> F -> P -> Q -> B`.

##### Exact Run Detail skeleton

`/operations/runs/:runId` is a full route; `DetailDrawer` renders the `RunDetailPanel` quick-inspection projection
at 480 px. Both use the same ordered slots and route-backed tabs:

```text
H  Breadcrumb / Runs > path > shortened run ID
   [Copy locator] [Refresh] [Cancel queued dependency…?] [Resolve same identity] [Download bounded result/log]
S  Semantic status | operational status | duration | received/started/completed
P  Run identity, path, kind, tag, trigger, principal, worker, version, hash, language,
   memory peak, parent/root correlation, retention; then allowlisted Inputs key/value table
   and `n fields withheld` disclosure with reason chips; RunWorkerCompatibilityMatrix is bound to this run ID
   OperationalCancellationReceiptCard is the fixed read‑only post-attempt location: pending/unavailable/receipt
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

Buttons never inherit Windmill's generic `Run again`, `Share`, `Edit`,
script editor, worker REPL, restart, or cache clean actions. A domain route may offer a successor request only
when the current Owner manifest admits it; the run page itself offers navigation, copy/download of bounded
operational evidence, refresh, and same-identity resolve. Inputs and Result never render arbitrary stored
JSON. The exact operation/version registry labels every displayable field and its sensitivity; secret,
protected, unknown, and schema-mismatched fields have no value slot.

Copy field is disabled for a withheld value, while Copy JSON and Download bounded result serialize the same
redacted projection shown on screen, never the raw job payload or result bytes. If the registry entry is
missing or mismatched, both panels preserve their geometry and render `Unavailable` with the
operation/version and stop reason.

##### User action state machine

| Context/state                                 | Browser action                                     | Required meaning                                                              |
| --------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Research lookup not opened                    | Validate local identity, Open readback             | No Owner mutation or request creation                                         |
| Read loading                                  | Preserve geometry, show loading                    | No fabricated progress or previous positive result                            |
| Verified terminal                             | Refresh, Open canonical evidence                   | Durable outcome and current linked view freshness stay separate               |
| Missing, stale, malformed or unknown readback | Refresh the same lookup or Open available evidence | No Resolve mutation, retry, successor, provider dispatch or inferred terminal |
| Governance valid request before submission    | Confirm the exact admitted lifecycle action        | Current policy/authorization and frozen semantic inputs required              |
| Governance request dispatched                 | Disable duplicate submission; show pending         | Identity/meaning immutable; no Cancel implying rollback                       |
| Governance outcome unknown                    | Read the original request identity                 | No fresh request, presumed failure, effect retry or commitment release        |
| Governance receipt accepted                   | Read Runtime application separately                | Accepted is not `APPLIED`; real effects still obey Risk/Execution             |
| Expired or mismatched authority               | Open available evidence                            | No bootstrap, renewal, elevation or force admit action                        |

Action meaning follows its domain contract. Research readback never inherits Governance write permissions. Mutable control and response-loss details are admitted only for the bounded Governance route specified here; generic operation or provider controls are not browser product capabilities.

#### Canonical routed-page skeleton

Every tab must be drawable from the following desktop skeleton before implementation. The content region uses a
12-column grid; omitted slots collapse without changing the order of the remaining slots.

```text
+-- 76 rail --+-- main -----------------------------------------------------------+
| user | 56 top bar: status tape | tabs | search | notifications |
| module rail +------------------------------------------------------------------+
| | H  page title · scope · Owner · cut · freshness · route actions |
| +------------------------------------------------------------------+
| | S1 summary | S2 summary | S3 summary | S4 summary |
| +---------------------------------------------+--------------------+
| | P primary workspace (8 columns, min 320) | Q context (4 cols) |
| +---------------------------------------------+--------------------+
| | T table / chart / timeline / comparison (12 columns, min 360) |
| +------------------------------------------------------------------+
| | A one admitted action: domain Owner | operational envelope |
+-------------+------------------------------------------------------------------+
                                                    D detail drawer: 480 px max
```

`RouteGrid` owns this page-level geometry and is distinct from the reference-derived
`BentoGrid`. At viewport width `>=1280px`, it has 12 equal logical columns:
`S1-S4=3` each, `P=8`, `Q=4`, and `T/A=12`. At
`768-1279px`, it has six columns: each summary is three columns and wraps two per row, while
`P/Q/T/A=6` and remain in source order. Below `768px`, it has one column and the order
is `H -> S1 -> S2 -> S3 -> S4 -> P -> Q -> T -> A`; `D` is a full-screen overlay rather than a grid slot.
`RouteSlot` owns only these spans and may not accept an arbitrary caller-supplied column count.

Panel-internal `BentoGrid` retains container-observed `wide/narrow/collapse`, a 180 px minimum
auto-row, 16 px gap, 1/2/3/4/8 columns and 1-4 row spans; it never changes route order or drawer behavior.

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

##### Skeleton completeness gate

`DRAWABLE_EXACT` means this chapter fixes summary/value states, ordered dimensioned `P/Q`, `T` columns/row actions/group/sort/filter/pagination/loading, `D` fields, failure-state geometry, and button/admission order. A name or slot alone is not a component contract.

`DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY` has exact detail only; `BLUEPRINT_ONLY_NOT_IMPLEMENTABLE` lacks complete geometry. Both prohibit implementation. Promotion requires the same bilingual geometry and reusable-atom closure, then `IMPLEMENTATION_ADMITTED` in the single admission table below. Admission permits bounded, separately reviewable build/verification; it proves no backend/Owner acceptance, deployment, cutover, or production effect.

Unadmitted navigation-only routes display shared `UnavailableState`: workspace disconnected, no data or actions; technical completeness stays in info disclosure. Navigation names, retained source, and page-local composites cannot imply admission.

#### Routed page blueprint registry

This is the single route/atom admission index. Subsequent tables specify current contents/buttons; slice sections own detailed geometry, methods, query identities, and refusal boundaries. `Open/Copy/Refresh/filter/compare selection` are reads; other controls require a matching Owner `domain` or registered `operational` envelope. Retained interfaces and backend facts do not expand this table.

| Route / atom                                                                                            | Completeness and admission                        | Scope / geometry owner                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`, `/dashboard/attention`, `/dashboard/recent`, `/dashboard/evidence`                        | `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`        | Four independent typed‑read workspaces below; zero research/Owner/effect mutation                                    |
| `/operations`, `/operations/runs/:runId`                                                                | `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`        | Exact Runs / Run Detail skeletons; only the registered queued‑dependency cancel exception                            |
| `/operations/workers`, `/operations/workers/:workerId`, `/operations/service-logs`, `/operations/audit` | `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`        | Corresponding exact GET-only operational skeletons above                                                             |
| `/operations/schedules`                                                                                 | `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`        | History/shadow‑calendar read slice below; no new scheduler prerequisite                                              |
| `/rd`, `/rd/composer`                                                                                   | `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`        | Full‑width Source Intake / Develop Composer exact readback of existing compatibility records; no composer/submission |
| `/rd/research`, `/rd/research/:requestIdentity`                                                         | `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`        | Full‑width ResearchDirectory / ResearchReadbackWorkspace and bounded inline previews                                 |
| `/rd/hypotheses`, `/rd/decisions`                                                                       | `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`        | Verified question/Iteration Decision read‑only directory slices below                                                |
| `/rd/artifacts`, `/rd/artifacts/:buildRequestIdentity/attempts/:attemptIdentity`                        | `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`        | Existing ArtifactDirectory and exact source/readback; compatibility identities, no new native‑package integration    |
| `/backtest`                                                                                             | `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`        | Exact Replay request/result/quarantine GETs and separate single‑run report; no Run                                   |
| Local operator session, `BacktestReturnBand`, `BacktestRunReport`, `StrategyCodeViewer`                 | `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`        | Corresponding bounded atoms below; session grants no Owner authority, charts invent no result, code never runs       |
| Shared atoms required by an admitted slice with an inventory contract                                   | `IMPLEMENTATION_ADMITTED`                         | Reuse only within that slice's input/output, state and geometry                                                      |
| `/data`, `/data/pit-catalog`; four Runtime routes                                                       | `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`        | Existing unavailable/not‑ready geometry; no positive facts without a product resolver                                |
| Every other route or surface beyond these slices                                                        | `BLUEPRINT_ONLY_NOT_IMPLEMENTABLE / NOT_ADMITTED` | Exact detail with incomplete list is `DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY`; no scaffold/build/package/deploy         |

Status `/dashboard` is a bounded read-only queue overview. It answers only "what is ready to review, and where can I continue?"
It does not calculate global health, incident totals, workflow progress, or a cross-Owner state machine. Its
first fixed panel is `DashboardOverview`: header `Overview / Continue your work`, the technical scope disclosure, then
`Refresh`; its body uses the shared `CompactStatusBar` as a 3:2 bento: `R&D`
(`results ready`, `waiting`, `reviewable`, `bindings`) and
`operations` (`active`, `needs attention`).

R&D totals come from the historical-custody projection; outcome and build-review counts appear only when their
complete identity sets match that custody projection. Build-attempt totals remain available on the Artifact
route and are not repeated as a home-page KPI. Operations uses the exact unfiltered RunStore V2 cut
`runs/all/any/pageSize=50/page=1`; `active = queued + running` and `needs attention = failed + unknown`. An all-zero RunStore cut means only that
no runs are recorded in that view, never that the system is healthy.

The second fixed panel is `Next / Ready to review`. It contains up to four read-only navigation cards, in order:
positive research results, positive reviewable build outcomes, positive waiting research, and positive failed
or unknown runs. Zero counts omit their card; if no card remains, the body keeps its geometry and says that no
recorded work is ready for review. Loading keeps both panel frames, replaces every metric with an em dash, and
replaces the second body with one quiet loading state. Refresh starts all reads independently, disables
duplicate refresh, and withdraws prior positive metrics until each current read succeeds.

A rejected, malformed, partial, stale, or identity-mismatched source withdraws only the values and links that
depend on it; it never becomes zero. Observation times, source cuts, completeness, and the explicit statement
that sections are read independently remain inside the technical disclosure. There is no page-level
observation time or aggregate status. At widths below 980 px the navigation cards become one column; the
shared compact-status atom retains its documented responsive behavior.

The admitted Attention `/dashboard/attention` workspace answers "what recorded work needs follow-up now, why, and
where can I continue?" without creating a stop-predicate owner. `DashboardAttention` reuses the historical-custody,
research-question, research-outcome, artifact-review, and exact failed/unknown RunStore projections. Its fixed table
lists individual waiting or unavailable Research requests, Build attempts whose historical outcome is unavailable,
and failed or unknown action runs. Primary columns are `Item`, `Area`, `Needs follow-up`, and `Recorded`; opaque
request, attempt, and run identities stay inside the expanded detail or `PanelFrameInfo`.

The summary counts individual follow-up items by `research`, `builds`, and `runs`, plus a total only when all three
source families are bound. `All / Research / Builds / Runs` filters and search keep the Attention URL stable. A row
expands one controlled inline detail and links to the canonical Research record, historical Build record, or Run
record. The table is ordered by the recorded Owner/RunStore time and uses the shared pagination atom.

Every source fails closed independently: an identity mismatch or unavailable read withdraws only its dependent rows
and count, never converts them to zero, and marks the overall list partial when another source remains readable.
Loading withdraws retained positive rows. The page has one outer vertical scroll owner and no dialog, drawer, Resolve,
retry, dismiss, clipboard locator action, Owner mutation, effect dispatch, or effect routing change.

The admitted Recent `/dashboard/recent` workspace answers "what verified outcome was recorded most recently?"
without introducing another outcome owner. `RecentOwnerOutcomes` consumes two bounded Owner reads, the verified
Research outcome list and the verified Build outcome list, each already resolved to its outcome state. The
reads a page makes do not grow with the rows it lists: the workspace asks each list for at most the rows it
shows, the Owner clamps that to the bound it owns, and a list the Owner had to shorten declares its truncation
rather than reporting a count of everything.

Neither read names a custody cut; each Owner resolves the cut from its own custody and echoes it, so the
workspace cannot state a coordinate the Owner did not resolve, and rows echoed against different cuts are
never merged. It includes only `outcome_ready` Research records and `reviewable` Build records,
merges them by their Owner-recorded time, and uses the shared `DataWorkspaceTable` with controlled same-page
inline row expansion. Filters change only the visible Research/Build cut and never the URL. A Research row
opens the canonical Research record; a Build row opens the canonical historical Build result.

Request, attempt, observation-time, completeness, and identity details remain inside `PanelFrameInfo` or
the expanded row, not as primary table columns. The two reads stay independent: a malformed,
identity-mismatched, unavailable, or differently cut Research answer withdraws only Research rows/counts, and
the equivalent Build failure withdraws only Build rows/counts. Missing values render unavailable rather than
zero; the total exists only when both source families are bound. Loading withdraws every retained positive row
until the current reads complete. There is one page scroll owner and no dialog, drawer, nested vertical table
scroller, Owner mutation, or effect action.

The admitted Evidence `/dashboard/evidence` workspace answers "which Dashboard areas have current readable
data, and where is coverage still incomplete?" It reuses the same historical-custody, research-outcome,
artifact-review, and exact unfiltered RunStore reads as Status rather than creating an evidence owner. Its
fixed `DashboardEvidence` table has four business rows in order: `R&D history`, `Research results`,
`Build results`, and `Operations history`. Columns are `Area`, `Current`,
`Needs follow-up`, and `Coverage`; exact source identities do not appear as primary columns.

`Connected` means the row's typed source and required identity binding are complete,
`Limited` means the source is readable but truncated, partial, or contains unreadable point
results, and `Unavailable` means the read or identity binding failed. Those labels describe Dashboard
read coverage only, never Owner health, scientific validity, or a global incident state.

The summary counts areas, not heterogeneous records: `connected`, `limited`, and `unavailable`. `All / Connected /
Needs coverage` filters change only the visible rows and keep the Evidence URL stable. Activating a row expands one
controlled inline coverage detail with its business explanation and canonical workspace link. Observation time,
completeness, and unavailable reason remain behind `PanelFrameInfo`. Every source fails closed independently;
loading withdraws retained values, a missing source renders unavailable rather than zero, and no row admits rebuild,
resolve, dismiss, Owner mutation, or effect action. The page uses the outer page viewport as its only vertical scroll
owner.

##### Overview and R&D

| Tab and route                    | Fixed `S / P / Q / T` contents                                                                                                                                                                                                                   | Buttons in order                                                                                                           | Default evidence state                                                                                                                                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status `/dashboard`              | Admitted queue Overview specified above: `P=DashboardOverview`; compact independent R&D and RunStore summaries; `T=ReadyToReview` navigation cards; no `Q`, global matrix, incident aggregate, or Owner timeline                                 | Open the exact read‑only queue from a metric/card; View data scope; Refresh                                                | `IMPLEMENTATION_ADMITTED / CURRENT_PARTIAL`: positive values require their current typed projection and the documented identity‑set binding. Missing or mismatched sources stay unavailable in place. No global health, restore, resolve, submit, run, or other effect action            |
| Attention `/dashboard/attention` | Admitted follow‑up workspace above: individual waiting/unavailable Research requests, unavailable Build outcomes, and failed/unknown Runs; `P=DashboardAttention`; controlled same‑page inline detail; source evidence stays in `PanelFrameInfo` | Filter All/Research/Builds/Runs, search, expand one row in place, open the canonical record, Refresh                       | `IMPLEMENTATION_ADMITTED / CURRENT_PARTIAL`: independent typed reads only; mismatched or unavailable sources withdraw their rows/counts instead of becoming zero; no Resolve, retry, dismiss, clipboard locator action, Owner mutation, effect dispatch, or Windmill routing change      |
| Recent `/dashboard/recent`       | Admitted recent‑outcome workspace above: verified Research/Build counts and time‑ordered `P=RecentOwnerOutcomes`; independent source freshness remains in `PanelFrameInfo`; controlled same‑page inline detail provides the outcome summary      | Filter All/Research/Build, expand one row in place, open the canonical Research record or historical Build result, Refresh | `IMPLEMENTATION_ADMITTED / CURRENT_PARTIAL`: typed independent Owner reads only; identity mismatch withdraws only its dependent rows/count; missing is unavailable, never zero; no Owner or effect mutation                                                                              |
| Evidence `/dashboard/evidence`   | Admitted read‑coverage workspace above: area counts and `P=DashboardEvidence`; controlled same‑page inline detail provides the business explanation and canonical destination; technical observation evidence remains in `PanelFrameInfo`        | Filter All/Connected/Needs coverage, expand one row in place, open the canonical workspace, Refresh                        | `IMPLEMENTATION_ADMITTED / CURRENT_PARTIAL`: four independent typed reads; identity mismatch withdraws only its dependent row; missing is unavailable, never zero; coverage is not Owner health or global incident state; no rebuild, resolve, dismiss, Owner mutation, or effect action |
| Intake `/rd`                     | `P=SourceIntakeReadbackWorkbench`; exact lookup and Intake / Custody / Evidence groups; no summary strip, split pane or composer                                                                                                                 | Open readback, Refresh                                                                                                     | `IMPLEMENTATION_ADMITTED`: exact typed read only; no Submit, Resolve mutation, successor or provider call                                                                                                                                                                                |
| Develop Composer `/rd/composer`  | `P=DevelopComposerReadbackWorkbench`; full‑width exact lookup, Request / Custody / Artifact groups; existing compatibility record only                                                                                                           | Open readback, Refresh                                                                                                     | Exact typed GET only; no authoring, build, provider or effect                                                                                                                                                                                                                            |
| Research `/rd/research`          | `P=ResearchDirectory`; full‑width Research history / Current intents, four ordered columns and inline preview; `/rd/research/:requestIdentity` is `ResearchReadbackWorkspace`; no summary strip or split pane                                    | Filter, Search, Open research, Refresh                                                                                     | Exact typed read only; no research dispatch, Resolve mutation or successor                                                                                                                                                                                                               |
| Hypotheses `/rd/hypotheses`      | Verified/unavailable saved‑question filters; `P=HypothesisDirectory` with inline `ResearchQuestionBrief`; technical custody only in `PanelFrameInfo`                                                                                             | Expand one row in place; Open research record                                                                              | Read‑only `rd.research_question_directory.read.v1`; verified custody is not scientific validity, active/falsified state, an outcome, or an Iteration Decision; no direct Fact mutation                                                                                                   |
| Artifacts `/rd/artifacts`        | `P=ArtifactDirectory`; exact verified Artifact list/detail with Review and custody evidence; geometry defined by the admitted directory above                                                                                                    | Filter, Search, Open Artifact, Refresh                                                                                     | `IMPLEMENTATION_ADMITTED`: exact typed read only; no build, provider, claim, Resolve mutation or successor                                                                                                                                                                               |
| Decisions `/rd/decisions`        | verified Iteration Decision filters; `P=RdDecisionDirectory` with inline `ResearchQuestionBrief`; technical lineage remains in `PanelFrameInfo`                                                                                                  | Expand one row in place; Open research record                                                                              | read‑only Formation catalog plus exact per‑family Iteration timelines; zero family is an honest empty cut; no Decision action or effect mutation                                                                                                                                         |

##### Backtest, Qualification, and on-demand Discovery

| Tab and route                            | Fixed `S / P / Q / T` contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Buttons in order                                                                                                                      | Default evidence state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exploratory `/backtest`                  | No summary strip; `P=ExploratoryReplayReadbackWorkbench` first renders `Request`, `Custody`, and `Replay basis`, then an exact Result/Attempt lookup and one compact shared `FactGroup` for terminal, diagnosis, reconciliation, semantic trace, and result identity, followed by the `BacktestRunReport` slot for the result that lookup opened. A separate explicit three‑field point‑read renders one verified historical Replay rejection as shared `Outcome / Custody / Timing` status cards; the page has no historical directory or table, that historical rejection point‑read has no chart, and a chart appears only inside the mounted `BacktestRunReport` | Open readback, Open result, Open historical, Refresh. Run/Resolve/Create successor/edit/compare/download/dismiss have no browser slot | `IMPLEMENTATION_ADMITTED` covers exact Replay V2 request, canonical result readback, and exact pre‑V2 `REJECTED_NO_WRITE / INVALID_REPLAY_EVIDENCE` quarantine readback through the consolidated read API. Historical custody never falls back into or satisfies the V2 selector. The separately authenticated HTTP/MCP request‑custody path is `IMPLEMENTATION_ADMITTED / NOT_CUT_OVER`; archived Windmill S3 execution and native replay execution remain unavailable. All summaries are read‑only, and the page cannot invent returns or imply native‑execution or cutover parity |
| Compare `/backtest/compare`              | Selected‑run count and comparable cuts; `P=RunPicker`; `Q=ComparisonBasis`; `T=RunComparePanel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Add run, Remove run, Swap baseline, Open run detail                                                                                   | Read‑only; compare 2‑4 exact compatible runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Diagnostics `/backtest/diagnostics`      | Diagnostic category counts; `P=DiagnosticFilter`; `Q=ModelIdentityList`; `T=DiagnosticTable + bounded summary`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Filter, Copy identity, Open source receipt                                                                                            | Only allowed categories; no protected Qualification data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Intake `/qualification`                  | Submitted/pending/evaluating/unknown/not‑admitted/semantic‑conflict/unavailable counts; `P=QualificationIntakeTable`; `Q=EvidenceCompleteness + QualificationIntakeConflictPanel`; `T=IntakeReceiptTimeline`                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Submit intake, Refresh, Resolve exact same meaning, Open original receipt, Prepare admitted successor                                 | Pending/evaluating requires a separately allowed intake projection and never implies a public terminal. Exact replay may resolve; any changed valid or invalid meaning under the same identity is `RequestSemanticConflict`. `TARGET / NOT_ADMITTED`; no real Product Edge consumer yet                                                                                                                                                                                                                                                                                              |
| Outcomes `/qualification/outcomes`       | `QUALIFIED / CLOSED_NOT_QUALIFIED` public‑terminal counts only; `P=PublicOutcomeTable`; `Q=QualificationPublicOutcome`; current eligibility interval, expiry/revocation facts; no internal negative‑category grouping                                                                                                                                                                                                                                                                                                                                                                                                                                                | Refresh, Open public outcome, Copy opaque reference                                                                                   | `Admitted/Evaluating` create no row, terminal count, receipt, color, notification, or action. Public redaction only; protected fields have no slots. `TARGET / NOT_ADMITTED`                                                                                                                                                                                                                                                                                                                                                                                                         |
| Eligibility `/qualification/eligibility` | Current/pending/expired/conflict counts; `P=EligibilityIntervalTable`; `Q=HeadFrontierCard`; `T=TransitionTimeline`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Refresh, Resolve current head                                                                                                         | Foundation only; empty or dual‑current intervals are unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Discovery `/scanner`                     | `P=ObservationTable`; `Q=InputCoverage`; `T=ObservationTimeline`; Artifact, evaluation time, completed/excluded/incomplete members and signals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Submit read‑only query, Read same job                                                                                                 | R&D on‑demand discovery; no schedules, due slots or deployment proposals; full business/route admission still needs acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

##### Strategy, Runtime, and Portfolio

Target Runtime reads native Strategy Instance, exact generation, readiness, APPLIED, checkpoints and incidents. Portfolio reads account equity, realized/unrealized performance, position exposure, capacity and attribution. The table preserves current unavailable/not-ready geometry: without the source Owner resolver it shows no positive facts. Target fields grant no route admission.

| Tab and route                        | Fixed `S / P / Q / T` contents                                                                                                                                        | Buttons in order                                                                                                                            | Default evidence state                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry `/strategy`                 | Registered/current/superseded/unavailable counts; `P=StrategyRegistryTable`; `Q=GenerationIdentityCard`; `T=GenerationLineage`                                        | Open generation, Copy identity                                                                                                              | Static Governance foundation only                                                                                                                                                                                                                                                                                                                                 |
| Lifecycle `/strategy/lifecycle`      | Pending/accepted/rejected‑no‑write/unknown counts; `P=LifecycleRequestTable`; `Q=GovernanceEligibilityAdmissionPanel + GovernanceDecisionCard`; `T=ContenderFrontier` | With valid Eligibility: Submit lifecycle request, Resolve same request, Create successor; otherwise Open Eligibility evidence, Copy locator | `CURRENT/PARTIAL · STATIC_CONTRACT_CLOSED_NOT_RUNTIME`: The current contract makes invalid/unavailable Eligibility a pre‑admission zero‑write state. Receipt‑backed `REJECTED_NO_WRITE` is a distinct admitted Governance decision; positive Runtime application and product consumers remain `NOT_ADMITTED`                                                      |
| Allocations `/strategy/allocations`  | Allocated/unallocated/capacity‑blocked/unavailable counts; `P=AllocationTable`; `Q=CapacityEvidence`; `T=AllocationHistory`                                           | Open allocation, Prepare allocation request                                                                                                 | No allocation writer in Dashboard                                                                                                                                                                                                                                                                                                                                 |
| Instances `/runtime`                 | One fixed not‑ready summary; `P=EmptyState`; `Q=RuntimeFoundationNotReadyCard`; `T=EmptyState`                                                                        | Refresh foundation, Open revalidation dependency, Copy foundation locator                                                                   | `CURRENT/PARTIAL · FOUNDATION_NOT_READY`: display `NotReady` and exactly four dependencies. There is no Strategy Instance row, readiness receipt, incident, Resolve, Apply or green state. `RuntimeReadinessCard` remains a future Owner‑backed component and is absent                                                                                           |
| Generations `/runtime/generations`   | No generation counts; `P=EmptyState`; `Q=RuntimeFoundationNotReadyCard`; `T=EmptyState`                                                                               | Refresh foundation, Open revalidation dependency, Copy foundation locator                                                                   | `NOT_ADMITTED`: The current contract exposes no generation or application surface. Even `NOT_APPLIED / NO_APPLICATION_RECEIPT` awaits a separately admitted Governance‑to‑Runtime consumer; all future generation geometry, `APPLIED`, Resolve and Apply remain absent                                                                                            |
| Checkpoints `/runtime/checkpoints`   | No checkpoint counts; `P=EmptyState`; `Q=RuntimeFoundationNotReadyCard`; `T=EmptyState`                                                                               | Refresh foundation, Open revalidation dependency, Copy foundation locator                                                                   | `NOT_ADMITTED`: The current contract exposes no checkpoint or restore surface. Future `CheckpointTable`, `RestoreValidationCard`, `CheckpointHistory`, Open checkpoint and Validate restore evidence remain absent                                                                                                                                                |
| Incidents `/runtime/incidents`       | No incident counts; `P=EmptyState`; `Q=RuntimeFoundationNotReadyCard`; `T=EmptyState`                                                                                 | Refresh foundation, Open revalidation dependency, Copy foundation locator                                                                   | `NOT_ADMITTED`: The current contract exposes no incident or Recovery surface. Future `RuntimeIncidentTable`, `IncidentEvidence`, `IncidentTimeline`, Open incident and Open Recovery case remain absent; a missing heartbeat cannot manufacture an incident                                                                                                       |
| Performance `/portfolio`             | No performance summary; `P=EmptyState`; `Q=PortfolioViewUnavailableCard`; `T=EmptyState`                                                                              | View Portfolio technical details                                                                                                            | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`: show only the unavailable state and source requirements; retain the exact request/envelope contract in the technical disclosure. Future `PerformanceChart`, `AccountAndFactCut`, `PerformancePeriods`, range control and source‑fact actions remain absent; legacy `PortfolioSnapshot` is not an Owner fact |
| Exposure `/portfolio/exposure`       | No exposure summary; `P=EmptyState`; `Q=PortfolioViewUnavailableCard`; `T=EmptyState`                                                                                 | View Portfolio technical details                                                                                                            | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`: future `ExposureMatrix`, `CoherentEvidenceCut`, `ExposureTable`, scope filter and fact actions remain absent; shared Cache positions or stale flags cannot fill the card                                                                                                                                    |
| Capacity `/portfolio/capacity`       | No capacity summary; `P=EmptyState`; `Q=PortfolioViewUnavailableCard`; `T=EmptyState`                                                                                 | View Portfolio technical details                                                                                                            | `CURRENT/PARTIAL · SOURCE_OWNER_RESOLVE_UNAVAILABLE`: the request binds scope/mode/policy/common cut, but no positive Gross Capacity projection exists. Future `CapacityScopeCard`, `GrossCapacityView`, `CapacitySourceCompleteness`, `CapacityViewHistory`, refresh/source actions, usage and headroom remain absent                                            |
| Attribution `/portfolio/attribution` | No attribution summary; `P=EmptyState`; `Q=PortfolioViewUnavailableCard`; `T=EmptyState`                                                                              | View Portfolio technical details                                                                                                            | `NOT_ADMITTED · NO_ATTRIBUTION_SURFACE`: The current contract exposes no attribution projection identity. Future `AttributionChart`, `AttributionEvidenceCut`, `AttributionTable`, period control and evidence actions remain absent; no Alpha, Qualification or Risk usage is inferred                                                                           |

##### Risk, Execution, and Data

| Tab and route                              | Fixed `S / P / Q / T` contents                                                                                                                            | Buttons in order                                                    | Default evidence state                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decisions `/risk`                          | Allow/reject/decrease‑only/unavailable counts; `P=RiskDecisionTable`; `Q=DecisionEvidenceAndLineage`; `T=RiskDecisionTimeline`                            | Open decision, Resolve same intent, Open source facts               | `NOT_ADMITTED`: legacy check/forward/denial events never populate this page; no manual override                                                                                                                                                                                               |
| Reservations `/risk/reservations`          | Available/withdrawn/consumed/unknown‑effect/no‑effect/settled counts; `P=ReservationTable`; `Q=ReservationLiabilityCard`; `T=ReservationHistory`          | Open reservation, Open claim result, Open linked effect             | `MECHANISM_REJECTED / NOT_ADMITTED` for a standalone Risk core; only a complete cross‑Owner input chain with Risk‑owned one‑use facts/store can re‑enter planning. Dashboard never releases liability                                                                                         |
| Claims & Admission `/risk/claims`          | Consumed/rejected/admitted‑once/suppressed/conflict/unavailable counts; `P=ClaimAndAdmissionTable`; `Q=AggregateFrontierCard`; `T=ClaimAdmissionTimeline` | Open claim, Open prepared attempt, Open adapter binding, Open fence | `MECHANISM_REJECTED / NOT_ADMITTED` as a local‑core leaf; claim, admission and fence arbitration must arrive in one real‑consumer vertical slice sharing one Risk transaction frontier                                                                                                        |
| Fences `/risk/fences`                      | Active/pending/cleared/unavailable counts; `P=FenceTable`; `Q=FenceSetAndFrontier`; `T=FenceTimeline`                                                     | Open fence, Open Recovery case, Open source facts                   | `NOT_ADMITTED` until Risk‑owned fence facts exist; an active fence is never hidden or dismissed                                                                                                                                                                                               |
| Attempts `/execution`                      | Prepared/invoked/unknown/rejected counts; `P=EffectAttemptTable`; `Q=EffectAuthorityCard`; `T=AttemptJournal`                                             | Open attempt, Resolve same effect                                   | Read‑only by default; no invocation button without explicit effect authority                                                                                                                                                                                                                  |
| Orders `/execution/orders`                 | Open/partial/filled/rejected counts; `P=OrderTable`; `Q=AuthorizedCommandCard`; `T=OrderStateTimeline`                                                    | Open order, Open command, Resolve venue readback                    | UI cannot create or alter an order                                                                                                                                                                                                                                                            |
| Fills `/execution/fills`                   | Fill/fee/slippage/unavailable summaries; `P=FillTable`; `Q=FillEvidence`; `T=FillTimeline`                                                                | Filter, Open fill receipt                                           | Read‑only                                                                                                                                                                                                                                                                                     |
| Reconciliation `/execution/reconciliation` | Matched/missing/conflicting/unknown counts; `P=ReconciliationTable`; `Q=ReconciliationPanel`; `T=VenueReadbackTimeline`                                   | Refresh readback, Resolve same effect, Open Recovery case           | Unknown stays persistent                                                                                                                                                                                                                                                                      |
| Recovery `/execution/recovery`             | Open/contained/reconciling/closed counts; `P=RecoveryCaseTable`; `Q=RecoveryEvidence`; `T=RecoveryTimeline`                                               | Open case, Run admitted read‑only reconciliation step               | No effect retry or closure inferred by UI                                                                                                                                                                                                                                                     |
| Sources `/data`                            | No binding counts; `P=EmptyState`; `Q=MarketDataOwnerFoundationCard`; `T=EmptyState`                                                                      | Open foundation evidence, Copy foundation locator                   | `CURRENT/PARTIAL · NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER`: admits the sealed Source Binding readback schema but no Dashboard/H0 resolver composition. Future `DataSourceTable`, `SourceBindingCard`, `SourceCutHistory`, positive admitted badge and resolver/mutation actions remain absent |
| PIT Catalog `/data/pit‑catalog`            | No snapshot counts; `P=EmptyState`; `Q=MarketDataOwnerFoundationCard`; `T=EmptyState`                                                                     | Open foundation evidence, Copy foundation locator                   | `CURRENT/PARTIAL · NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER`: admits the sealed PIT Snapshot readback schema but no Dashboard/H0 resolver composition. Future `PITCatalogTable`, `SnapshotIdentityCard`, `CorrectionTimeline`, available badge and resolver/mutation actions remain absent      |
| Quality `/data/quality`                    | Complete/partial/conflict/quarantined counts; `P=QualityRuleMatrix`; `Q=SelectedQualityFinding`; `T=QualityTimeline`                                      | Open finding, Open source evidence                                  | No automatic acceptance                                                                                                                                                                                                                                                                       |
| Freshness `/data/freshness`                | Per‑source current/stale/expired/unavailable counts; `P=FreshnessMatrix`; `Q=TimeEvidenceCard`; `T=LagHistory`                                            | Refresh, Open frontier                                              | Never compute one global freshness maximum                                                                                                                                                                                                                                                    |

##### Operations and Settings

| Tab and route                                                     | Fixed `S / P / Q / T` contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Buttons in order                                                                                                              | Default evidence state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runs `/operations`                                                | Four fixed status cards scoped by the selected Runs/Owner reads kind: queued, running, unknown, and completed/failed; `T=RunTable` with status/date/operation/trigger/principal/duration/Owner outcome; `D=RunSummaryCard` after row selection; `P/Q` omitted                                                                                                                                                                                                                                                                                                                       | Refresh, Filter, Open run, Resolve Owner outcome, Delete disposable completed cache                                           | First party RunStore operational projection only; current route admission and exact skeleton govern availability; no Owner mutation or business truth                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Run Detail `/operations/runs/:runId`                              | Business‑facing result/timing summary; `P=Run inputs + worker assignment + OperationalCancellationReceiptCard` bound to `:runId`; `Q=Related source result`; `T=Logs and evidence` followed by fixed nested `Logs/Metrics/Traces/Assets` tabs. The primary path uses the registered business operation name, source result, run state, timing, request source, work type and related‑result action; exact operation/run IDs, channel, transition, terminal code, dispatch digests/reasons, source‑owner identity and protected‑field reasons stay in shared information disclosure. | Copy reference, Refresh, conditionally Cancel queued dependency, Check source result, View source result, Download result/log | Exact fixed skeleton above; Cancel occupies the third slot only for a queued, unclaimed, zero‑domain‑effect dependency run and is otherwise absent. `Cancelling…` disables it during CAS; after terminal transition the action/panel disappear while P preserves receipt or unavailable readback. Worker assignment describes only the exact historical run and cannot assert current service health. Presentation labels never alter the typed result, transition, Owner locator, action envelope, or effect boundary. No batch cancel or generic rerun/edit/share.                                               |
| Workers `/operations/workers` and `/operations/workers/:workerId` | Exact Workers read‑only skeleton above: Capacity/Work handled summary; P/Q absent; T columns Service, Availability, Active / processed, Recent activity, Supports; identity‑bound D in four clusters                                                                                                                                                                                                                                                                                                                                                                                | Refresh, select service in context, preview recent Run in the shared sheet, Open full run details, Back to service/services   | `IMPLEMENTATION_ADMITTED · FIRST_PARTY_RUN_STORE_GET_ONLY`; registration/lease/claim observation only, independently fail‑closed list/detail states; exact Run GET preview remains bounded and adds no Worker or Run effect; no Windmill administration, unbound‑run readiness, Owner acceptance or cutover                                                                                                                                                                                                                                                                                                        |
| Service Logs `/operations/service‑logs`                           | Exact skeleton above: severity/instance summary; canonical filter cut; `P=ServiceInstanceList` with business source names; identity‑bound `Q=ServiceInstanceCard` with technical values behind info; `T=ServiceLogPanel` composed with `BoundedLogViewport` and a Time/Level/Activity/Source/Related scan path; explicit complete/partial/empty/filtered‑empty/unavailable states                                                                                                                                                                                                   | Refresh, Toggle auto‑refresh, Download bounded logs                                                                           | `IMPLEMENTATION_ADMITTED · FIRST_PARTY_RUN_STORE_GET_ONLY`; real Windmill use is replaced only as a bounded operational read. One repeatable‑read PostgreSQL cut, strict echo/digest/cursor binding, no host/message invention, no administration, Owner fact, effect route or cutover                                                                                                                                                                                                                                                                                                                             |
| Audit `/operations/audit`                                         | Exact AuditFilters / OperationAuditTable / AuditCorrelationCard skeleton above; bounded append‑only operation events, redacted correlation and source cut                                                                                                                                                                                                                                                                                                                                                                                                                           | Filter, Open correlation, Copy audit locator                                                                                  | Control‑plane evidence only; no Owner mutation, provider start/retry or protected detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Telemetry `/operations/telemetry`                                 | Available/stale/partial/rebuilding/unavailable/quarantined counts; `P=TelemetryMatrix`; `Q=SourceFrontierCard`; `T=TelemetryTimeline`                                                                                                                                                                                                                                                                                                                                                                                                                                               | Refresh, Open source                                                                                                          | Source projection is `CURRENT/PARTIAL`; per‑source frontier, freshness, completeness, rebuild state, quarantine, and opaque checkpoint have fixed read‑only geometry. Owner and telemetry adapters are unavailable, telemetry visibility is fixed `Unavailable`, and no empty, raw, stale, replayed, or self‑asserted signal may produce `Available`                                                                                                                                                                                                                                                               |
| Alerts `/operations/alerts`                                       | Critical/warning/info/unread counts; `P=AlertTable`; `Q=AlertDetail`; `T=DeliveryHistory`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Open alert, Mark presentation read, Open Owner evidence                                                                       | Read acknowledgement is not business acknowledgement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Data Sources `/settings`                                          | Configured/healthy/unavailable/secret‑missing counts; `P=DataSourceConfigList`; `Q=OpaqueConnectionRefForm`; `T=ValidationHistory`                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Test read‑only connection, Save opaque reference                                                                              | No secret values displayed or stored in page state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Agents `/settings/agents`                                         | External Agent connection/authorization references and readable host reported usage; unavailable consumption remains unknown                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Refresh, Open access evidence                                                                                                 | Blueprint only; no provider test, model keys, Save profile, Agent dispatch or host remote control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Notifications `/settings/notifications`                           | Channel/enabled/failed/unavailable counts; `P=NotificationPreferenceForm`; `Q=ChannelStatus`; `T=DeliveryHistory`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Send local test, Save preferences                                                                                             | Does not acknowledge Owner outcomes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Access `/settings/access`                                         | Principal/session/token/revoked counts plus binding `ACTIVE/SUPERSEDED/zero‑active` and authorization available/expired/revoked/unavailable counts; `P=LocalPrincipalCard`; `Q=AuthorizationLineagePanel` with fixed `Current authority / Admission snapshot` tabs and separate `Operator Authorization / Product Edge readiness` rows; `T=AuthorizationSuccessorReadiness + CapabilityManifest + CredentialAudit`                                                                                                                                                                  | Re‑authenticate local session, Issue narrow transport token, Revoke token, Copy once                                          | Transport credential controls never mint, renew, revoke, or chain‑walk Operator Authorization. Historical expiry with no immediate equivalent successor, or `successor_distance>1`, renders `Current authority` unavailable with prior/current identity, generation, distance and exact stop; immutable snapshot remains visible with no renewal/replacement selector. `Current authority` alone feeds action state. Both tabs expose exact binding/head, issuer/audience/scope, expiry/revocation frontier, manifest digest, source cut, and stop predicate; secret/token values remain one‑time and never logged |

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

#### Overlay, button, and state rendering contract

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
  digest. Research pages have no `Check & Run`, preflight, or dispatch control. Retained S2 transport follows its Owner compatibility effect boundary. The operational branch exists only for a registered disposable
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

## Shared visual and interaction system

### Reusable component inventory

Higher layers depend only on lower layers. Pages do not redefine color, spacing, status semantics, or action rules.

#### Foundation primitives

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

#### Layout and navigation components

| Component                                                                   | Contract                                                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `DashboardShell`                                                            | full‑screen rail, top bar, viewport, overlay roots                                                   |
| `UserCapsule`                                                               | local operator and installation menu; no business authority                                          |
| `IconRail`, `IconNavItem`                                                   | stable order, tooltip, active/focus/disabled/attention                                               |
| `TopBar`, `StatusTape`, `ModuleTabs`, `GlobalCommand`, `NotificationButton` | four top‑menu zones                                                                                  |
| `PageHeader`, `ScopeBar`, `AuthorityStamp`, `FreshnessStamp`                | Owner/evidence context                                                                               |
| `RouteGrid`, `RouteSlot`                                                    | page‑level 12/6/1‑column contract, fixed slot spans/order, no caller‑defined column count            |
| `BentoGrid`, `BentoItem`, `SplitPane`, `DetailDrawer`                       | panel‑internal container‑responsive 1/2/3/4/8‑column composition, 180 px minimum auto‑row, 16 px gap |

#### Data display components

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

#### Domain components

Components consume their source Owner typed public projections and produce presentation state; they do not duplicate SQL/custody verification or create a cross-Owner proof service. The definitions below own component fields and states. Route/slice sections own dimensions and responsive geometry.

These fields describe the existing read contracts and retained compatibility records. They impose no compiler, repair, Scanner or selection workflow on native research. A component name does not widen the admitted set: only an exact admitted slice may be implemented; all other entries remain inventory or blueprint.

- `OwnerReceiptCard`, `OwnerViewCard`, `ReceiptLink`: Owner identity, disposition, cut, freshness, locator

- `NextLegalActionBar`: only an Owner‑admitted action from the current direct‑read projection; durable historical success never preserves an action across stale/unavailable/archived state. Otherwise render the stop predicate

- `ActionAdmissionGate`, `AuthorizationLineagePanel`: discriminated input is exactly `domain / operational`, never both. `domain` cross‑binds `NextLegalActionBar` to the unique `ACTIVE` shell binding/history head, Operator Authorization, Time/revocation, Owner freshness, Product Edge readiness, exact effect set and manifest. `operational` accepts only a registered disposable capability plus current `OperationalActionEnvelope` for principal, run, dispatcher transition version, empty domain‑effect digest, no‑claim cut and expiry; Dispatcher re‑resolves it under lock, and it cannot populate `AuthorizationLineagePanel` or substitute for Owner authority. Both use `IDLE / PREFLIGHTING / ADMITTING / ADMITTED / REVALIDATION_REQUIRED / STALE / UNAVAILABLE`; post‑dispatch unknown moves to branch‑specific same‑identity readback. Domain shows `Current authority` then `Admission snapshot`; operational shows envelope/transition/no‑claim evidence. Historical snapshots feed neither branch, and neither component constructs or repairs authority

- `AuthorizationSuccessorReadiness`: read‑only prior authorization identity/scope/sequence, admission/current generations, `successor_distance=0|1`, terminal expiry/revocation state, canonical direct‑successor operation availability, successor receipt/identity when present, and exact missing/invalid stop. FirstMutation adds fixed `Original authorization at final cut` then `Immediate successor at final cut` rows; the original must be `CurrentAtLock`, and a successor is an additional current requirement. Distance greater than one is `DIRECT_SUCCESSOR_REQUIRED`; a non‑current original is `ORIGINAL_AUTHORIZATION_NOT_CURRENT`. It never walks a chain, substitutes a successor for the original authority, constructs scope, chooses a replacement, signs, renews, revokes, or calls a transport‑token control

- `DownstreamAdmissionHandoffPanel`: fixed Product Edge admission receipt/identity/cut, admission‑outbox locator, downstream‑resolver version and availability, target R&D Owner, R&D receipt/custody state, and stop predicate. It distinguishes `admission committed / downstream unavailable` from input rejection, renders overall `SUBMITTED_OR_UNKNOWN`, disables S2, and exposes only Copy admission, Open operational run, and Resolve same identity. It never offers successor, retry, permission repair, or inferred R&D receipt

- `ArtifactRequestAdmissionPanel`: Read only admitted custody evidence; unavailable/unknown remains nonpositive. It exposes no Artifact submission, preflight, provider or build control

- `InvocationAdmissionReceipt`: Retained compatibility inventory; no Dashboard research dispatch or provider effect admission. sealed Product Edge receipt created before the first claim: identity/digest; original request‑admission lineage; build request and attempt; directly resolved current authorization identity/frontier and Time Evidence; policy‑equivalent `ACTIVE` binding/head; exact manifest digest; final locked write cut and commit time. Missing, expired, cross‑cut, malformed, or mismatched custody is unavailable and suppresses claim/start/Run. It is read‑only in Dashboard and cannot be reconstructed from the claim, admission snapshot, session, or credential

- `InvocationClaimReceipt`: Retained compatibility inventory; no Dashboard research dispatch or provider effect admission. Product Edge claim plus exact public wire fields `invocation_admission_receipt_identity` and `invocation_admission_receipt_digest`, historical request‑admission lineage, attempt identity, committed time, claim digest, `CLAIMED_NEW / ALREADY_CLAIMED / unavailable`, current `CLAIMED / INVOCATION_STARTED`, and Owner‑projected next action. One resolution‑discriminated parser is shared by operation adapter/projector and tested with direct Rust serialization bytes; claim/non‑success family keys must be absent, never synthesized `null`. Missing/extra/tampered fields keep A0/A1 unavailable. Only recovered `CLAIMED + RUN_BOUNDED_EXECUTION_AGENT` with direct sealed‑receipt equality may enter start

- `ArtifactOutcomeProjectionGate`: read‑only precedence gate over one attempt: canonical sealed R&D `SUCCESS`, canonical sealed R&D `FAILED_NO_ARTIFACT`, then Product Edge `INVOCATION_STARTED` only when no R&D terminal exists. It renders exactly one downstream panel and records both source cuts; conflict, missing custody or ambiguous dual terminal is unavailable rather than first‑match success

- `ProviderInvocationStateCard`: Read only bounded invocation status and original identity; unknown state never enables a provider start, Resolve mutation, rerun or successor. Canonical claim/start semantics belong to Product Edge

- `LegacyTerminalQuarantinePanel`: strict legacy‑only projection of Owner discriminant, original `SUCCESS / FAILED_NO_ARTIFACT / REJECTED_NO_WRITE / OUTCOME_UNKNOWN` disposition, request/attempt identity, verified historical terminal receipt identity, optional sparse Intent fields, legacy custody generation, observed time and quarantine reason. It exposes Resolve same attempt then Open/Copy historical receipt only; family/provider/actions stay absent and there is no current Research View, Artifact promotion, successor, TrialFamily repair, or dismiss action. Missing/malformed projection preserves this fixed geometry as unavailable instead of collapsing into generic unknown

- `SameIdentityResolvePanel`: immutable request or request+attempt tuple, previous Owner receipt fingerprint, replacement operational‑run link, resolved Owner receipt/view fingerprint, and exact equality/conflict/unavailable result; it is the sole unknown/response‑loss/restart/cache‑loss recovery and never dispatches a naked retry

- `ResearchRequestComposer`: Retained compatibility inventory; no Dashboard research dispatch or provider effect admission. sourced falsifiable typed request; never creates Intent directly

- `S1StageCustodyPanel`: read‑only `SEALED_BASIS_PENDING_QUALIFICATION` geometry binding exact request and original admission, sealed complete typed request meaning fingerprint, basis receipt/identity, basis head/outbox, commit cut, missing Qualification/terminal Research receipt, and next action. It renders only after canonical basis‑stage verification. Same‑identity Resolve must consume that sealed meaning through Historical completion; a terminal‑only lookup miss keeps the panel unavailable. Submit/successor are absent, duplicate basis/head/outbox is unavailable, and changed request/admission is conflict

- `S1TerminalCustodyPanel`: complete verified Research receipt/Intent plus TrialFamily root/member/Census in fixed geometry, with separate terminal custody and linked‑view currentness rows. Expiry changes the latter to `STALE`, removes Submit/successor/S2/review actions, and leaves Resolve/Open/Copy evidence; it never hides the terminal receipt/family or relabels them `SUBMITTED_OR_UNKNOWN`. Missing or cross‑bound terminal parts preserve the same geometry as unavailable

- `ResearchViewCard`: Retained compatibility inventory; no Dashboard research dispatch or provider effect admission. immutable historical Research fact plus separate linked‑Artifact availability, Owner‑projected read‑time availability/phase/action, source cut, projection time and `valid_through`; render current `ARTIFACT_AVAILABLE / AVAILABLE / REVIEW_ARTIFACT`, conservative cached `REVALIDATION_REQUIRED`, or Owner‑returned `STALE / ARTIFACT_AVAILABLE / RESOLVE_SAME_REQUEST_IDENTITY` without erasing historical Artifact availability. `Check & Run` enters read‑only `PREFLIGHTING`; the latter two forms have no positive next‑action slot, and browser time alone never claims `STALE`

- `TrialFamilyPolicyComposer`: No browser composer; frozen policy is read through the admitted Research view. Authoring, spend cap and census belong to R&D MCP; no editable protected feedback or authority fields

- `TrialFamilyAuthorityResolutionPanel`: three read‑only rows in order: R&D basis receipt/basis/cut, Qualification frontier receipt/frontier/cut/state such as `GENESIS_EMPTY`, then R&D resolved lineage/predecessor/census cut; each includes Owner, operation, locator, availability and stop reason. Positive rows accept only sealed Owner output, never a browser‑deserialized TrialFamily graph. Missing/corrupt/unknown authority exposes only same‑identity Resolve and yields zero S1 family writes

- `QualificationFrontierReceiptPanel`, `IndependenceBasisLink`: sealed Qualification receipt identity, opaque frontier identity/digest/state/cut, source R&D basis receipt locator, exact resolution operation, and no protected payload slot; `GENESIS_EMPTY` appears only after exhaustive canonical verification proves no historical projection/outbox. A missing head or unverifiable history renders `unknown/unavailable`, suppresses Copy frontier, and exposes only exact‑basis Resolve

- `TrialFamilyReceiptPanel`: direct R&D Owner root receipt, family/root digest, INTENT membership receipt, Census member/fact, and head/frontier in fixed order; availability requires canonical JSON to match every duplicated relational identity, ordinal, digest, and committed‑time field; missing/corrupt/incomplete/inconsistent custody is unavailable and cannot coexist with an S1 success badge

- `ArtifactReviewPanel`: immutable identity, lineage, logic, parameters, build/security, and actions from the current linked Research projection; stale‑linked durable S2 success retains evidence but renders no review action

- `ArtifactTrialFamilyBindingPanel`: binding identity, binding receipt identity including `committed_at`, independently displayed commit cut, bound TrialFamily identity and Census frontier from one locked direct‑Owner custody cut; present only beside an Owner‑resolved S2 Artifact, never inferred from Intent/Artifact identifiers, and unavailable during unresolved concurrent mutation or any canonical/time mismatch

- `NoArtifactReceiptPanel`: canonical receipt payload identity, attempt, Intent, independently derived disposition, failure code and commit time, plus the explicit zero‑Artifact statement. Optional family keys are absent on the exact wire. Research expiry may mark the linked view stale and remove follow‑on actions, but never removes or rewrites this receipt; mismatch or self‑derived verification renders unavailable and exposes no positive action

- `CapabilityUnavailablePanel`: operation identity/version, registry version, `archived/unavailable` state, compatibility‑envelope identity/digest, expected versus observed component source/image/App/script hashes, affected channels, observation cut, mismatch reason, preserved historical‑read disclosure and exact restoration/revalidation predicate. Healthy services or matching source text cannot fill a missing envelope. It exposes Refresh registry, Open historical run and Copy capability locator only; no dispatch, archive/restore, successor, permission repair or credential action

- `OwnerCustodyIncidentPanel`: fixed red unavailable geometry: incident identity/evidence locator; affected Owner, store and ordered table set; last trusted cut and pre‑loss counts; current direct‑read cut/counts; `backup / PITR / Owner archive / reconstruction evidence` source class; recovery state (`UNKNOWN`, `RESTORABLE_FROM_CANONICAL_SOURCE`, `RECOVERABLE_BY_RECONSTRUCTION_NOT_RESTORED`, `RESTORED_REVALIDATION_PENDING`, `RESTORED`); shared‑volume rollback constraint; and exact revalidation predicate. Buttons are Open incident evidence then Copy affected locator. It never reconstructs rows, accepts pasted JSON, clears the incident, marks restored, or enables a domain action; only canonical recovery plus fresh direct Owner and consumer readback may advance the state

- `RunTable`, `RunSummaryCard`, `RunMetadataAndInputs`: operational status/date/path/trigger/principal/tag/duration, schema‑allowlisted immutable inputs, typed withheld counts/reasons, dependency kind, and explicit Owner‑outcome join; no raw payload fallback

- `DependencyCancellationPanel`: fixed operational‑only confirmation for one queued dependency run: run/kind/path, queued‑since, required executor compatibility, current `OperationalActionEnvelope` identity/expiry, explicit empty domain‑effect set, no‑claim proof and receipt handoff target. The sole effect button is `Cancel queued dependency`; CAS pending reads disabled `Cancelling…`; terminal transition removes A and header slot 3. Missing/expired/revoked capability, identity/version conflict, claim, terminal or unknown removes the effect, and no batch, retry or domain cancellation exists

- `OperationalCancellationReceiptCard`: fixed read‑only P location keyed by exact `run_id`; state is `none / pending / receipt / unavailable`. Receipt shows prior state/version, principal, authorization cut, transition time and immutable receipt locator. It persists after A disappears, never exposes an effect button, and never changes or stands in for Owner truth

- `RunDetailPanel`, `RunResultView`, `RunComparePanel`: fixed metadata/result/tab skeleton; schema‑allowlisted and sensitivity‑redacted bounded result shared identically by viewport/copy/download; Owner‑correlated receipt/result, actual Artifact/PIT/runtime/simulator identities, diagnostics, invocation count, and handoff; missing/mismatched registry renders unavailable; no Selection authority

- `RunLogPanel`, `RunMetricPanel`, `RunTracePanel`, `RunAssetPanel`: exact four‑tab order; collected/not‑collected/unavailable/empty are distinct and keep identical geometry

- `CompactStatusBar`, `CompactStatusGroup`, `CompactStatusItem`, `DetailClusterGrid`, `DetailCluster`, `DetailClusterFact`: Workers exact skeleton: ordered title/value summary groups and Availability/Work handled/Recent activity/Supported work clusters with dimensions and unavailable behavior defined above. Compose existing `PanelFrame`, `SplitBento`, `DataTableSurface`, `DataWorkspaceTable`, `DetailInspector`, `DetailNotice`, `DetailEmpty` and `UnavailableState`; no independent color palette or worker administration. `WorkerGroupTabs` and fabricated heartbeat‑history panels are not part of this admitted route.

- `RunWorkerCompatibilityMatrix`: path‑bound `run_id`, required kind/tag/runtime/isolation, one projection observation cut, and each candidate worker's registration/lease evidence. `ready`, `online / incompatible`, expired lease, missing registration and isolation unavailable are distinct fail‑closed states; the matrix is never rendered without the exact run binding

- `ServiceLogFilters`, `ServiceInstanceList`, `ServiceInstanceCard`, `ServiceLogPanel`: Service Logs exact skeleton above: canonical echoed filter cut/digest; fixed range/kind/service/instance/severity/search order; exact identity‑only selection because `host_ref=null`, while primary copy uses shared business source/event presentation and exact implementation values live behind title/info affordances; bounded rows, cursor/retention/byte limits, auto‑tail behavior, and viewport/download parity. They compose shared `PanelFrame`, `CompactStatusBar`, `SplitBento`, `DataWorkspaceTable`, `DetailInspector`, `UnavailableState`, and `BoundedLogViewport`; no independent radius, header fill, palette, hostname/message fabrication, administration, or effect action.

- `AuditFilters`, `OperationAuditTable`, `AuditCorrelationCard`: principal/operation/outcome, exact target/correlation, redaction/retention; append‑only with no dismiss

- `TelemetryMatrix`, `SourceFrontierCard`, `TelemetryTimeline`: every positive cell binds Owner/source/cut, canonical fingerprint, observed/valid‑through time, and loss/rebuild state; raw, stale, replayed, self‑asserted, or identity‑conflicting input renders unavailable/stale/quarantined and never inherits the previous success color

- `QualificationIntakeConflictPanel`: fixed `RequestSemanticConflict` banner, immutable request/handoff identity, original `NOT_ADMITTED` receipt link, redacted changed‑meaning summary, semantic fingerprints, and optional Owner‑admitted successor action; never displays protected replay values or reuses the old receipt for changed meaning

- `QualificationPublicOutcome`: terminal‑only Owner‑produced lineage, stable attempt, N/A basis, checked nonempty interval, monotonic expiry/revocation and late Time cuts, half‑open pending/current transition, and sealed Qualification head frontier; `Admitted/Evaluating` fail projection and leave this component absent, never `ClosedNotQualified`; no protected‑detail slot, empty current Fact, dual‑current boundary, time rollback, or client promotion

- `ScannerPublicReceiptIntegrityPanel`: exact Scanner Owner resolve operation, attempt identity, canonical terminal receipt identity/digest, source cut and direct‑read locator. Missing, caller‑constructed, locally reconstructed, mismatched or unavailable resolution fixes the panel in unavailable state, removes the terminal row/count/badge and every Matcher/Proposal projection, and exposes Open source evidence then Copy locator only

- `GovernanceEligibilityAdmissionPanel`: exact Eligibility identity, interval/frontier, source cut, validation disposition and zero‑write proof before Governance admission. Invalid, expired, conflicting or unavailable Eligibility produces no Governance receipt, lifecycle row, outbox, Runtime handoff or successor action; it exposes Open Eligibility evidence then Copy locator only. A later receipt‑backed Governance rejection is a disjoint admitted branch

- `GovernanceDecisionCard`: complete contender frontier, canonical generation ordering, deterministic no‑write tie receipts, decision/action cuts, source frontier, and revalidation; unavailable without direct Owner reread

- `RuntimeFoundationNotReadyCard`: fixed non‑authoritative foundation state `NotReady`; source revision; and exactly four ordered dependency rows: Governance authorized‑generation decision read, canonical Runtime custody, Artifact compatibility recovery read, Execution recovery frontier read. Each visible row carries only a Pending status; exact dependency links and source revisions stay inside the header technical disclosure; footer has Copy foundation locator. No instance/generation/receipt/checkpoint/recovery/application/action slot exists

- `RuntimeReadinessCard`: future Owner‑backed exact generation and Strategy Instance identity, canonical readiness fact/receipt, observation cut, freshness and incident locator. It is absent while only `RuntimeFoundationNotReadyCard` is admitted; CI, review, mergeability, merge tree or delivery receipt cannot fill its fields

- `RuntimeApplicationCard`: future generation, attempt, Strategy Instance, application receipt, reconciliation successor and restore validation; absent in the current admitted slice and never inferred from a job/harness, foundation dependency list, CI/review/merge tree, delivery receipt or snapshot weaker than live admission

- `MarketDataOwnerFoundationCard`: fixed admitted foundation maturity and source revision; two ordered schema groups only. Source Binding labels are binding identity, fact digest, lineage root/version, outbox digest, observational `is_admitted`, and locator. PIT Snapshot labels are request identity/digest, snapshot identity/fact digest, consumed Source Binding identity, lineage root/version, outbox digest, observational `is_available`, and locator. Without a separately admitted product resolver, every value row is `UNAVAILABLE_NO_PRODUCT_RESOLVER`; footer buttons are Open foundation evidence then Copy foundation locator. No provider‑authentication, ingestion, payload, credential, database locator, writer, resolve, refresh‑canary, positive badge, row, timeline, or mutation slot exists

- `PortfolioViewUnavailableCard`: fixed admitted source revision and schema `1`. The visible card uses shared `UnavailableState` and `SummaryList` atoms to show the business‑facing unavailable state and three required source groups. Its info disclosure retains the exact header slots, request binding, caller‑supplied/untrusted principal‑claim slots, eleven ordered dependency classes across Execution, Market Data and Portfolio, and the applicable structured failure set. Every request‑bound value remains an em dash. It never fabricates an `UNAVAILABLE`, `INCOMPLETE_FAIL_CLOSED`, or `STALE` response instance and exposes no action. No positive Account/Performance/Exposure/Gross Capacity/Attribution value, chart, table, timeline, filter, refresh, resolve, headroom, allocation, Risk, deployment or trading slot exists

- `PortfolioViewRequestBindingBlock`: mandatory first group in the `PortfolioViewUnavailableCard` technical disclosure. It orders the request‑side operands independently as principal identity, account identity, Execution Scope identity, PAPER/LIVE mode, authorization‑policy cut, and common‑cut identity. The principal‑claim and dependency groups retain comparison context for principal‑claim mismatch, cross‑scope and mixed‑cut review. Without a Dashboard consumer every value is an em dash; the group has no trusted, matched, resolved, available, retry or action state

- `PortfolioViewFailureList`: read‑only ordered failure vocabulary: `UNSUPPORTED_SCHEMA_VERSION`, `INVALID_FIELD`, `MISSING_DEPENDENCY`, `DUPLICATE_DEPENDENCY`, `CROSS_OWNER_DEPENDENCY`, `INVALID_FRONTIER_SEQUENCE`, `PRINCIPAL_CLAIM_MISMATCH`, `CROSS_SCOPE_DEPENDENCY`, `MIXED_CUT_DEPENDENCY`, `FUTURE_DATED_DEPENDENCY`, `STALE_DEPENDENCY`, `EXPIRED_REQUEST`, `EXPIRED_PRINCIPAL_CLAIM`, `VALIDITY_OUTLIVES_PRINCIPAL_CLAIM`, `VALIDITY_OUTLIVES_DEPENDENCY`, `CALLER_SUPPLIED_PRINCIPAL_CLAIM`, `CALLER_SUPPLIED_SOURCE_LOCATOR`, `SOURCE_OWNER_RESOLVE_UNAVAILABLE`. Each item displays its typed field/kind/owner coordinate when present; it has no dismiss, override, retry or promotion action

- `CapacityScopeCard`, `GrossCapacityView`, `CapacitySourceCompleteness`: account/mode/economic‑pool scope, candidate‑neutral gross ceilings, exact Execution/Market Data cuts, availability and frontier; while configuration authority is unresolved the fixed card state is `INCOMPLETE_FAIL_CLOSED`, names the missing Owner/fact/state‑machine predicate, exposes no positive BOUND badge or action, and has no usage, headroom, Reservation, allocation, or permit fields

- `RiskDecisionTable`, `ReservationLiabilityCard`, `ClaimAndAdmissionTable`: terminal decision lineage, one‑use Reservation states, stable claim/admission results, complete rejection set and exact linked effects; legacy forwarded commands have no row shape

- `AggregateFrontierCard`, `FenceSetAndFrontier`: one Risk‑owned Capacity Scope frontier, held liabilities, immutable fence‑set membership and transaction ordering; no Portfolio write or UI release action

- `WorkerCard`, `WorkerTable`, `ScheduleCard`: operational state separate from business state; no generic worker administration

- `FenceBanner`, `UnknownEffectBanner`, `ReconciliationPanel`: persistent safety surfaces and locators

- `NotAdmittedNotice`: unavailable capability and evidence required for promotion

### CSS tokens and palette inheritance

CSS uses four layers. Components consume only semantic or component tokens.

```text
raw palette -> semantic role -> component alias -> state modifier
neutral-950 -> text-primary -> panel-text -> [data-state="unavailable"]
```

Raw names describe color; semantic roles describe meaning; component aliases isolate component changes; state
modifiers select semantic roles and never introduce literal colors.

#### Core theme tokens

| Semantic token         | Light                 | Dark target | Consumers                                 |
| ---------------------- | --------------------- | ----------- | ----------------------------------------- |
| `--surface‑page`       | `oklch(0.92 0.01 85)` | `#111411`   | viewport                                  |
| `--surface‑panel`      | `#f2f2f2`             | `#181c19`   | `PanelFrame`                              |
| `--surface‑card`       | `#ffffff`             | `#202521`   | cards/panel body                          |
| `--surface‑elevated`   | `#ffffff`             | `#272d28`   | menus/drawers/dialogs                     |
| `--surface‑hover`      | `#f7f5f1`             | `#2d342e`   | hover                                     |
| `--text‑primary`       | `#1a1a1a`             | `#f1f4f1`   | headings/values                           |
| `--text‑muted`         | `#5a5a5a`             | `#a7b0aa`   | labels/hints                              |
| `--border‑default`     | `#e0ddd8`             | `#343c36`   | cards/inputs/separators                   |
| `--nav‑active`         | `#2d2d2d`             | `#f1f4f1`   | active rail/tab                           |
| `--nav‑active‑text`    | `#ffffff`             | `#171b18`   | active icon/text                          |
| `--focus‑ring`         | `#3b82f6`             | `#60a5fa`   | keyboard focus                            |
| `--status‑positive`    | `#0b8c5f`             | `#58ceaa`   | available/success, never market direction |
| `--status‑negative`    | `#cf304a`             | `#f87171`   | rejected/failure/incident                 |
| `--status‑warning`     | `#f59e0b`             | `#fbbf24`   | pending/stale/unknown                     |
| `--status‑info`        | `#3b82f6`             | `#60a5fa`   | information                               |
| `--status‑protected`   | `#8b5cf6`             | `#a78bfa`   | protected/opaque                          |
| `--status‑unavailable` | `#76808e`             | `#9ca3af`   | unavailable/not observed                  |

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

#### Component, geometry, and motion tokens

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

### Interaction, responsive, and accessibility rules

- The module rail names business domains, not every inspection state. Crossing into another domain or opening a
  complete, long, multi-step, code, result, or log workspace uses its canonical route. A filter within one directory
  uses the shared filter/tabs atoms; its bounded URL state may change without presenting a new page shell.
- A short read-only inspection of an independent object within the current domain uses one shared right-side
  `DetailSheet` composition over `DetailInspector`. When the user's task is to compare adjacent table records, the
  same short inspection instead uses the shared controlled `DataWorkspaceTable` row-detail directly beneath its
  source row; only one row expands, it never changes record counts, and long content still opens its canonical
  route. Sheets preserve the underlying list and scroll position, expose a canonical full-view link, forbid stacked
  sheets and never embed an entire route. Below 768 px a sheet becomes full-screen, while a row-detail remains inline
  and single-column. Selected identity/filter URL state is presentation state, never Owner evidence.
- Modal dialogs are reserved for independent, bounded tasks that must be completed or dismissed before returning;
  explanatory or technical metadata stays in inline disclosure. A share requirement alone does not turn a short
  inspection into a route: reload, Back/Forward and focus return must reconstruct the same truthful selection.
- Keyboard order is rail, tape, tabs, page controls, content, then inline detail or detail drawer.
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

## State and admitted controls

### TARGET - Trial condition selection

Display content hash, stage evidence and run ID separately. First trial entry authorizes the exact candidate and frozen trial/capital policies for the Governance activation queue; dispatch follows current checks, not the confirmation click. A changed hash requires the full new-version lifecycle; unchanged reactivation requires confirmation and current checks.
Show enqueue order, current waiting reason and the admitted withdrawal control. Waiting alone does not expire the activation decision; unready requests do not block later ready requests. Show Governance authorization separately from Runtime application; confirmation alone does not mean running. Record improvement unloading as a user decision, not an economic failure; never auto-reactivate after a user stop. Qualified candidates may remain in R&D.

Before a trial starts, Dashboard offers finite named condition templates with only exposed parameters adjustable. The user selects and approves them; concrete templates, thresholds and page interactions remain to be frozen; examples such
as one month or positive returns are not published options. Submit the chosen version and complete parameters for
business Owner validation and freezing. Dashboard does not decide qualification or promotion. Changing a selection
cannot rewrite an active trial; the page reads back the frozen conditions and their exact trial identity.
This remains target design and does not expand the `IMPLEMENTATION_ADMITTED` routes or atoms below.

#### Action authorization admission contract

Research pages have no mutating action admission. They read exact Owner projections and preserve missing, stale, partial, rejected and unknown states. A displayed next legal action is information for the external Agent, never a browser dispatch permission. The input and effect protocols remain in [Product Edge](../architecture/product-edge/) and their owning service contracts.

Governance controls bind an exact strategy/composition version, operation manifest, trusted principal/scope, current Operator Authorization, active deployment binding/history head and the required Autonomous Policy Authorization. The browser cannot issue, renew, elevate or self-assert any of them. Authorization, policy and final-cut freshness are checked by the owning backend; cached readiness, historical admissions, transport success and UI state cannot authorize effects.

First trial confirmation identifies the exact candidate, frozen condition template and allocation policy. A request remains pending or unknown until the Owner returns its bound receipt; only Runtime's separate `APPLIED` receipt proves application. A user stop cannot auto-reactivate a strategy. Same identity and meaning resolve the original request; conflicting meaning is refused. Unknown external effects preserve commitments and original identities without blind resubmit.

The browser exposes no bootstrap, issuer, SQL, provider, strategy build or Agent-control interface. Admission expiry cannot be recovered by walking an arbitrary authorization chain, inventing a successor or recreating genesis. Canonical direct-successor, response-loss, invocation-fence, downstream-resolution and sealed-terminal rules remain enforced at Product Edge/Owner boundaries.

A bounded readback shows a verified terminal even if a linked view later becomes stale, distinguishing terminal history from current authority. A verified `FAILED_NO_ARTIFACT` shows its canonical no-Artifact receipt; missing terminal custody remains unavailable/unknown. Quarantined versions are read-only and cannot supply current Artifact, family, provider or activation authority.

### Status vocabulary and evidence cut

- `TARGET` (the retained `TARGET_DRAFT` spelling) is design awaiting implementation/integration, never capability authority.
- `CURRENT/PARTIAL` means named implementation and consumer evidence exist; the complete route or deployment may still be missing.
- `IMPLEMENTATION_ADMITTED` permits bounded build/verification of the table's exact route/atom only; it proves no merge, deployment, Owner acceptance, cutover, or production effect.
- `NOT_ADMITTED` / `unavailable` cannot become positive capability through UI, job, chart, log, or source existence.

Historical facts remain immutable. After custody loss, capability stays unavailable until canonical restore/reconstruction, direct Owner readback, and downstream consumer revalidation all complete. Stale facts cannot restore positive actions. Candidate code, screenshots, and local checks establish no current product effect.

### Operations capabilities and backend responsibilities

Dashboard is the first-party user interface; Windmill is not a deployment dependency. Operational views expose
service-owned jobs, bounded logs, worker state, audit correlation and dependencies. They provide no arbitrary
script editor, Flow, database mutation, model session or secret-manager UI. Dependencies and locks are determined
in the build pipeline; remote dependency work is only a bounded operational job, not Dashboard publishing.

Queue cancellation is available only for `kind=dependency`, `state=queued`, an empty domain-effect set and
Dispatcher proof of no worker claim. Its immutable operational receipt changes no business fact. Provider, build,
replay, admission, claim and other effect-capable jobs have no such Cancel action or batch cancellation. Lease
liveness and compatibility with a job's kind/tag/runtime/isolation are separate: a heartbeat without a compatible
executor is online/incompatible, never Ready. Deleting disposable completed cache never deletes Owner facts.

#### Operations API and backend state contract

This is a `TARGET_DRAFT` replacement contract, not evidence that the services exist. Browser and MCP
reads use the same typed handlers and capability checks. Page cursors are opaque and stable for one filter
cut; every response includes `observed_at`, `projection_version`, `availability`, and a retention
or expiry disclosure. A route never returns an Owner payload merely because the caller can read the
operational run.

A current view's filter cut is the database's statement time, the clock the rows it filters were stamped with:
the browser asks for the current view without sending a time of its own, the server cuts at that instant and
returns the cut, and a page, a download or a cursor carries that returned cut forward. A browser clock never
becomes a cut, so one running ahead of the database cannot refuse the read and one running behind it cannot
hide the newest rows. The browser checks `observed_at` only against times from the same answer, never
against its own clock.

An operational action's `observed_at` is the database's time read in the action's own transaction, the
clock its receipt is stamped with, so a server clock running behind the database cannot make a completed
cancellation or deletion read as refused.

| UI read or action                 | Fixed Dashboard API                                                                                   | Backend owner and exact rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runs list, filters, pagination    | `GET /api/operations/runs` -> `RunPage`                                                               | `RunStore` reads immutable submission metadata plus dispatcher‑owned operational state. Filter fields are status/kind/path/trigger/principal/tag/duration/time cut; the cursor embeds that filter cut. Owner outcome is a separately resolved optional envelope, never derived from exit code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Run detail and bounded result     | `GET /api/operations/runs/{run_id}` -> `RunDetailEnvelope`                                            | `RunDetailProjection` resolves the exact operation/version manifest and returns only display‑allowed registered input/result fields, timing/worker/resource metadata, immutable operational cancellation receipt readback, retention and Owner receipt locators. It joins that path‑bound `run_id`'s dispatcher requirements to immutable worker registrations at one observation cut and returns `RunWorkerCompatibilityMatrix`; missing, stale or mismatched inputs are `unavailable`. Cancellation readback is `none / pending / receipt / unavailable`, remains read‑only after A disappears, and never changes Owner truth. Secret, protected and unknown fields are omitted behind typed withheld counts/reasons; viewport, Copy JSON and download reuse the identical redacted bounded projection. An unknown operation version or schema mismatch is `unavailable`, never raw JSON fallback. Missing disposable data with an Owner locator is `operational_data_expired`, not business absence |
| Same‑identity Owner resolution    | `POST /api/operations/runs/{run_id}/resolve‑owner‑outcome` -> `OwnerOutcomeEnvelope`                  | Product Edge resolves the immutable request/attempt identity through the named Owner typed port. It neither dispatches a job nor retries an effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Queued dependency cancellation    | `POST /api/operations/runs/{run_id}/cancel‑dependency` -> `OperationalCancellationReceipt`            | `OperationalActionEnvelope` binds the authenticated principal, `dependency.cancel.queued` capability, exact run, current transition version, `kind=dependency`, `state=queued`, empty domain‑effect digest, no‑claim cut and short expiry. Dispatcher re‑resolves every field under its transition lock and compare‑and‑set changes only that exact operational run to `cancelled`; stale, revoked, claimed, terminal, unknown, mismatched or effect‑capable input fails closed. The receipt records run, prior state/version, principal, authorization cut, time and transition. It cannot cancel a domain request, provider/build/replay effect or Owner operation, and no batch endpoint exists                                                                                                                                                                                                                                                                                                     |
| Disposable completed‑run deletion | `DELETE /api/operations/runs/{run_id}/cache` -> `OperationalDeletionReceipt`                          | `RunStore` accepts only terminal operational rows after capability check and confirmation. It deletes bounded result/log/cache bytes, preserves the run tombstone and Owner locator, and cannot touch Owner stores                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Run log tail or download          | `GET /api/operations/runs/{run_id}/logs` and `/logs/download` -> `RunLogPage` or bounded stream       | `BoundedRunLogStore` reads append‑only chunks by opaque cursor. Search/severity/source filters, redaction, truncation, byte limit and retention are identical for viewport, download and MCP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Metrics, traces, run assets       | `GET /api/operations/runs/{run_id}/{metrics\|traces\|assets}` -> a discriminated tab envelope         | Until a producer is admitted, handlers return `not_collected`, `not_captured`, `empty`, or `unavailable` with a reason. They never fabricate zeros, spans, files, or success; run assets cannot resolve to a global file browser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Workers and selected lease        | `GET /api/operations/workers` and `/workers/{worker_id}` -> `WorkerPage` or `WorkerLeaseEnvelope`     | `WorkerLeaseStore` is written only by worker registration/heartbeat/claim/release. UI reads identity/group/tags/version/start/limits/occupancy/last run/last observed plus the registered kind/tag/runtime/isolation capability set. Lease expiry yields `unavailable`; these worker‑only routes never infer readiness for an unbound run or create a UI‑authored `dead` state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Service‑log viewport or download  | `GET /api/operations/service‑logs` and `/service‑logs/download` -> `ServiceLogPage` or bounded stream | `ServiceLogGateway` requires an exact service/instance cut and applies the same time/severity/search filters, redaction, cursor, retention and byte limit to both outputs. It exposes no delete, clear, restart or health‑promotion endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Audit list and correlation detail | `GET /api/operations/audit` and `/audit/{audit_id}` -> `AuditPage` or `AuditEventEnvelope`            | `OperationAuditStore` is append‑only and written by authenticated Product Edge/Dashboard control‑plane middleware, not by this read route. Unknown/redacted target stays explicit; there is no edit, delete, dismiss or replay endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

`RunOperationalState` is exactly `queued | running | succeeded | failed | cancelled | unknown`; only Dispatcher and worker protocol events advance it,
using compare-and-set on the last stored transition. `OwnerOutcomeState` is a separate `available | rejected | unknown | unavailable | not_applicable`
envelope and never participates in the operational transition. A late terminal worker event may replace
operational `unknown` for the same run identity, but only an Owner reread may replace Owner
`unknown`. Worker liveness is computed from a stored lease deadline and last heartbeat.

Only the path‑bound `RunDetailProjection` computes readiness by canonically matching that exact run's kind,
tag, runtime and required isolation to worker registrations at the same observation cut. Client time, a
missing row, process/container health, or a service-log message can neither promote liveness nor fabricate
compatibility.

The replacement is not a smaller low-code platform. It is a Trade-specific Dashboard, typed Product Edge
gateway, narrow job dispatcher, worker protocol, disposable operational store, and optional exact-tool MCP
channel. Native Owners and their stores remain separate services.

## Implementation admission by slice

### Bounded admission: local operator browser session

The user admits one first-party local operator session shell and the read‑only `/settings/access` surface as
`DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED`. This narrow slice replaces the inert login presentation only. It does
not admit OAuth, account creation, password import, transport-token issuance, Operator Authorization or Product
Edge binding mutation, authorization successor selection, a role-administration product, or any Owner/provider
effect. Product Edge routing and `DASHBOARD_OPERATOR_API_TOKEN` remain unchanged.

`DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN` is proof for creating or renewing the browser session only.
`DASHBOARD_SESSION_HMAC_KEY` signs a versioned cookie containing the fixed `local_operator` principal, a random
session identity, login-credential digest, issue time and expiry. Both secrets must be 32-4096 UTF-8 bytes. The
cookie is HttpOnly, SameSite=Strict, path `/`, finite-lived for eight hours, and Secure whenever the request is
HTTPS. It is never placed in local/session storage or exposed by an API. Rotating either secret invalidates prior
sessions. The login credential never satisfies an effect endpoint; admitted effects continue to require their
independent bearer capability.

The Next proxy guards all Dashboard pages and APIs except `/login`, `/api/auth/session`, static assets and the
zero-business-data `/api/health` liveness endpoint. The Dashboard layout repeats the page guard as defense in
depth. Missing configuration fails closed as `configuration_unavailable`; absent, invalid and expired sessions
become `required`, `invalid` and `expired` without retaining positive state. Page requests redirect to login with
one sanitized local return path; API requests return 401, or 503 for unavailable configuration. Session creation
accepts same-origin JSON and deletion also requires same origin. Invalid, expired and deleted cookies are cleared.

`/settings/access` reads only current principal, session identity, last re-authentication and expiry. Transport
token, Operator Authorization, Product Edge readiness and successor areas remain visibly unavailable with no
mutation control or secret value. Dynamic acceptance covers unavailable configuration, no-cookie page/API,
wrong credential, cookie attributes, authenticated page/API, tampering, expiry and logout. The fixed local preview
port must not replace its listener until isolated acceptance passes and both session secrets are provisioned.

### Bounded admission: read-only schedule history and shadow schedule calendar

This slice maintains the existing operational schedule-history and shadow-configuration read task. V0.1, on-demand discovery and new research require no scheduler. Historical/expected triggers stay distinct from observed runs.

The user admits `/operations/schedules` as `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED` for two
strictly separated GET-only views. `History` is the default and reads persisted first-party RunStore
registrations through `/api/operations/schedules/history/`; it is historical evidence only and must
never be presented as current configuration or activity. `Current schedules` uses the existing
configuration-bound `/api/operations/schedules/` contract. This narrow exception supersedes the
generic blueprint-only classification for this route; it does not admit Scanner due-slot resolution
or generic shell schedules. No scheduler, registration, tick or enqueue occurs on reading.

History reads at most the latest 100 rows ordered by the millisecond projection of `COALESCE(last_due_at, created_at)`
descending and immutable schedule identity ascending. A 101-row probe distinguishes `complete` from
`partial_unavailable`; the browser receives only schedule identity, business operation, cadence, registration
time, last observed time/run pair, and recorded time. Empty complete history is valid. Digests, recovery
identity, registry bindings and projected next-due time do not cross this browser contract. Technical identity
is collapsed behind an info control.

The view uses shared PanelFrame, CompactStatusBar, DataTableSurface, DataWorkspaceTable, SplitBento and
DetailInspector atoms, with business activity labels and one explicit `Historical registrations only - not current schedules` boundary. Search
and activity filters are local and never mutate the RunStore.

Current schedules reuse `configuredShadowScheduleSetV1` and RunStore `readBoundScheduledReads`:
exact configured identity, digest, operation and dispatch bindings must match every registered row
(1-100). Missing configuration, registration or compatible custody fails closed; historical rows
must never be used to reconstruct or soften that unavailable state.

The browser accepts positive data only from a successful HTTP response and a valid bound projection.
Refreshing with unavailable or rejected evidence removes prior positive rows and selected details.
Use UTC throughout. `next_due_at` and cadence describe **expected triggers**, not executions:
the scheduler may skip elapsed slots. Only the returned `last_due_at` and `last_run_identity` pair is
an **observed run**. Never infer older runs, completion, duration, success or Owner acceptance.

The current-schedules view has one calendar header and an inset calendar body. Inside that body, the toolbar
preserves the Vibe Journal source hierarchy instead of replacing it with a Dashboard-specific control strip.
The left identity group is Today card, month/year heading with schedule count or unavailable state, then
Previous, range label and Next. The right tool group is Filter, one shared animated Agenda/Day/Week/Month/Year
segmented control, operation selector, Refresh in the source primary-action position, then Settings. The
active view expands to its text label while inactive views remain icon-only.

The operation selector retains the source stacked-marker trigger geometry, but derives markers only from
returned operation identities; unavailable data creates no placeholder marker. Filter contains local
operation/identity search and observed/not-observed scope; Settings contains compact density and Table mode.
Controls horizontally scroll or wrap as one toolbar on narrow screens. Its default calendar mode is Month at
the current UTC date. No separate summary strip, duplicate Calendar/Table buttons or always-visible search
field is inserted above the source calendar header.

Calendar fidelity preserves Vibe's date navigation, five views, event inspection, overflow expansion and
restrained transitions. Month uses a seven-column full-week grid with at most three summary entries per day
and an accessible overflow button. Day and Week show zero-duration trigger points grouped by UTC hour, not
invented duration blocks. Year shows twelve month tiles opening Month; Agenda lists days in the selected
month. Dense cadence is grouped arithmetically by schedule/day or schedule/hour; expanding a group pages exact
expected timestamps, 50 per page, without materializing an unbounded event list.

Observed records are separately labelled and open the shared related-run preview; only its explicit canonical
action links to Run Detail. Calendar navigation must not execute a schedule. Today resets the date but
preserves the active view.

Table columns are Operation, Cadence, Next expected trigger, Last observed run, in that order; default
sort is next trigger ascending then immutable schedule identity. Search precedes pagination (20 rows;
10/20/50 options). Selection opens the same detail as calendar selection. No column chooser, bulk
selection or per-header decorative icons. Headers remain sticky inside the bounded body scroller.
Details order operation/title, cadence and next expected trigger, last observed due/run preview trigger, then
collapsed technical identity/digest/recovery fields. No Run, Resolve, CRUD, drag or resize action.

At 1280px and above, calendar/table and detail use a 2:1 grid with 16px gap and a shared body height clamped
to 420-760px from the available viewport; both scroll internally. The History view likewise keeps its table
and selected registration in the documented `SplitBento` at this width. Below 1280px, selection from
either view opens the shared right-side `DetailSheet` without changing the schedules URL, while the
calendar or table keeps the full inset width; below 768px the same sheet is full-screen. Closing returns focus
to the selected calendar entry or table row. Month and Week retain at least 700px internal scroll width below
768px; other views fit their card.

Headers and footers use the same theme chrome token, with inset body, subtle separators and restrained orange
selection/focus. Icons use Lucide. Transitions last 140-180ms and respect reduced motion. Keyboard users can
navigate controls, open/close overflow, select entries and follow observed-run links without pointer gestures.

The History and Current schedules views reuse one read-only related-run preview instead of changing
the Schedules URL. It re-reads the exact `RunDetailEnvelopeV1`, shows only run state, activity, trigger, started
time, duration and source result, and offers one explicit `Open full run details` canonical escalation. It never
embeds logs or run actions. A trigger inside either compact schedule sheet replaces that sheet body and provides
`Back to schedule`; the interaction never stacks a second overlay. A table-origin preview has no synthetic Back
target: Close returns focus to that exact table trigger. Returning preserves filters, pagination, scroll and the
selected registration.

Loading occupies six 48px skeleton rows in the primary body; empty/search-empty shows one 160px message
without fabricated events. Unavailable, incompatible, malformed and denied responses use that same bounded
message region, a concise reason and Refresh; no stale positive detail survives. Related-run reads are on
demand and clear prior positive data before every identity change. Non-success positive responses, malformed
envelopes and request/envelope/run identity mismatch fail closed; an aborted or late read cannot refill a
closed or newer preview.

Dynamic acceptance requires disposable PostgreSQL bound reads reaching the browser, mismatch/HTTP failure
rejection, distinction between predicted and observed entries, all five views, overflow, keyboard operation,
both themes and narrow/desktop layouts. Fixtures alone are not dynamic acceptance.

### Bounded admission: Backtest return-band presentation atom

`BacktestReturnBand` is a `TARGET_DRAFT / IMPLEMENTATION_ADMITTED` read‑only presentation atom for the already documented
`/backtest` and `/backtest/compare` surfaces. Its source-fidelity reference is Vibe Trading commit
`48c8315f74536d9d308347d63ac9c4e96c9a7120`, tree `d226b620dc699c9e8e382274434b324a5fefe0e1`, specifically the factor home daily-return band chart. The
Trade adaptation preserves the quantile min/max and Q1/Q3 bands, selected-strategy ink overlay, month stripes
or year dividers, draw-to-focus time window and reset, drawdown ceiling texture, optional explicit benchmark,
and external hover readout.

It uses the shared Dashboard panel and theme tokens, responsive measurement, restrained motion, reduced-motion
behavior, and Lucide actions.

Positive rendering accepts only one exact, bounded Owner-projected result identity: canonical UTC timestamps
(RFC3339 with exactly nine fractional digits and a `Z` offset, the definition the single-run
report below also uses), ordered finite quantiles, strictly ordered points, and optional strategy and
benchmark series whose timestamps belong to the same cut. Unknown keys, malformed ordering, mismatched series,
stale carried values, or non-canonical time fail closed to zero chart data. A benchmark is shown only when the
projection supplies it explicitly; the browser must never derive a baseline from the band median, synthesize
returns, or import Vibe mock factor data.

Loading, unavailable, valid empty, and available data are distinct states.

This atom performs no Backtest dispatch, selection commit, comparison judgment, economic claim,
Owner resolve, provider call, or business write. No Dashboard route or admitted Backtest Owner resolver
currently supplies its positive projection, so component tests and static rendering do not establish
live data, deployed-browser acceptance, S3 availability, or executor cutover.

### Bounded admission: single-run backtest report

`BacktestRunReport` is a `TARGET_DRAFT / IMPLEMENTATION_ADMITTED` read-only surface for one Owner-committed run on `/backtest`. Its presentation is defined here without an upstream source-fidelity claim.
It contains only strategy, data window, run result and fills. Peer ranking belongs to `BacktestReturnBand`; this report has no quantile band, benchmark or comparison.

Positive rendering accepts only one exact, bounded Owner-projected `run_identity`. The strategy is given
as the admitted single-threshold family states it: channel, threshold, comparison, both-side actions and
falsifier, and the program's exits. An exit is stated as named: a stop-loss or take-profit as an adverse or
favourable move of the close, measured as a fraction of the entry bar's close, a holding limit in bars after
the entry bar, and always that it is judged at the bar close and filled on the next bar
(`AT_BAR_CLOSE_FILLED_NEXT_FRAME`); a program that names none says it has none, so a report never reads as though it had
no exit rules when the projection could not state them.

Canonical UTC means RFC3339 with exactly nine fractional digits and a `Z` offset, so no
truncation decision is delegated and no offset form is accepted. The data window is given as instrument,
granularity, a canonical UTC start and an exclusive end `end_exclusive`, the first instant outside the
window, the snapshot count, and an explicit `cut_identity` that the projection carries rather than the
browser inferring from timestamp alignment.

Neither the strategy statement nor the granularity, snapshot count and `cut_identity` comes from the
backtest result: the run carries them from upstream and the projection states them beside it, so a reader
looking for a threshold inside a canonical backtest result will not find one. The result is a return series
plus net return, maximum drawdown and fill count, each a named field the Owner validates rather than a lookup
into an untyped map, so a renamed key fails to `unavailable` instead of rendering as absent.

A projection that lacks required keys and carries none the contract does not know is `unavailable`
under a reason naming the missing keys, so a statement not yet delivered is not read as a malformed one. Every
value in the series, and net return and maximum drawdown, is a fraction, where 0.01 is one percent. The
canonical result can build the series on either of two bases and the projection does not yet say which, so the
report states these values as fractions and names no base: nothing it shows, whether a label, a tooltip or
explanatory text, states or implies an equity return. Carrying the basis is still open.

When the Owner carries it, the labels name it; if the basis cannot be determined, net return and maximum
drawdown are unavailable for a named reason, a state distinct from the null an empty series gives them. Each
fill carries a canonical UTC timestamp, side, price and quantity. Price and quantity are plain decimal strings
at the instrument's precision and are shown exactly as given: trailing zeros are kept and none are added, a
price may be negative, a quantity never carries a sign, and neither uses an exponent or digit grouping. Points
are strictly ordered, so equal adjacent timestamps fail closed rather than render.

Every numeric value is finite, so `NaN` and infinity fail closed rather than reaching an axis.
Unknown keys, malformed ordering, mismatched series, stale carried values or non-canonical time fail closed to
zero report data. The browser derives nothing: it does not synthesize returns, compute a drawdown the
projection did not state, or infer a fill the projection did not list.

`loading`, `unavailable`, valid `empty` and `available` are four
distinct states, and the projection expresses them distinctly: an empty series must not stand for both a run
that produced no points and a read that could not be answered. The projection names its state rather than
leaving it to be inferred from an empty array. `empty` means the series has no points and both
net return and maximum drawdown are null; fills may still be listed, because a run can fill without the engine
recording a return - when all its snapshots fall in one engine day, for one - and a fill is a fact regardless.

`empty` also shows the Owner's `empty_reason`, one of the closed set `docs/owners/backtest.md`
defines, exactly as the Owner states it; the browser derives no reason of its own. `empty_reason` is
always present as a key, null only in `available`, so three projections are `unavailable`: an
`empty` one without a reason, an `available` one with a reason, and one whose reason is
not in the set. `available` means the series has points and both quantities are stated. Net return
and maximum drawdown are always present as keys and null only in `empty`, so a missing key is
always a fault.

A run whose strategy is outside the admitted single-threshold family is `unavailable` for a named
reason, that no Owner statement of strategy exists for this program family, rather than under a generic code.
An authoring-language document is stated only on `backtest.run`'s own report route, which finds the
statement through its run registry; this surface reads by result locator, so it keeps that reason for such a
run until a renderer for documents is admitted here. A custody run's `cut_identity` is its pinned
custody head and its snapshot count is one.

This surface performs no Backtest dispatch, selection commit, comparison judgment, Owner resolve,
provider call or business write, and it establishes no S3 deployment availability, executor cutover or
real-trading authority.

Its admission extends to one `/backtest` read route that feeds it, the page that mounts it, and
full-route acceptance, conditioned on the Backtest Owner projection that supplies this report. The route
relays that projection's answer and adds nothing: when the Owner answers `unavailable`, the route does
too, for the Owner's own reason. Acceptance proves two states separately. An unavailable projection renders
the unavailable state, and the acceptance waits for that state's specific element rather than for an empty
body or a message. An available projection renders the report from real committed bytes.

Where no run in the ordered chain can produce the available state, that state is recorded as not constructible
today with the reason, and no fixture stands in for it. Component tests and static rendering alone still
establish neither live data nor deployed-browser acceptance.

The authenticated read API route is exactly `GET /v1/backtest-run-reports/{result_identity}?request_identity={request_identity}&attempt_identity={attempt_identity}`, keyed by the same three-field locator the
`/backtest` result lookup already holds. It reads the Backtest Owner projection through the Owner's
own resolver, which opens its own `SERIALIZABLE, READ ONLY, DEFERRABLE` R&D Owner transaction and always rolls it back. A
report answers `200` with the projection exactly as the Owner serialized it.

An absent run answers `404` and an Owner refusal answers `503`, each with an
envelope that carries `state: UNAVAILABLE` and the reason and nothing else: the absent run's reason is
`BACKTEST_RUN_ABSENT`, a refusal's is the Owner's own code, and the refusal's sentence stays in the log. The
Dashboard BFF binds the three identities without normalization and relays that answer. It names a reason of
its own only for a leg that failed before any Owner answer arrived, or for a report this contract refuses.

### Bounded admission: Exploratory Replay request and result readback

This slice reads existing Replay protocol identities. The target links native runs/results from research projects; this admission grants no new native inputs, execution or browser dispatch.

`ExploratoryReplayReadbackWorkbench` is the exact `P` surface for `/backtest`. It is an
`IMPLEMENTATION_ADMITTED` point-read of one previously committed Replay V2 request and, when all three result
locator fields are supplied, one Backtest-owned canonical result. It is not a replay composer, dispatcher,
comparison surface, or economic chart. Compatibility composer-backed Replay V2 is readable only by an Owner build supporting its custody; otherwise it is `UNAVAILABLE`, never evidence of native replay capability. The route uses one full-width `PanelFrame`, without summary strip, history list/table, split pane or reserved chart height.

The route uses one full-width `PanelFrame` with no summary strip, historical list/table, split detail
pane, or reserved chart height. Its header contains the `EXPLORATORY REPLAY` eyebrow, `Replay request`
title, one concise purpose, and `Refresh`, which is disabled until a valid selector has been
opened. The inset body starts with one horizontal lookup rail: `Request identity`, `Meaning digest`,
then `Open readback`. On narrow screens only that rail wraps; labels and values remain left aligned.
Icons come only from Lucide and field labels have no decorative icon.

An available readback renders three ordered, subtly grouped surfaces. `Request` contains exact
request identity, availability, namespace and deterministic seed. `Custody` contains meaning
digest, receipt identity, seal digest, committed time and Owner observation cut. `Replay basis` contains
the exact event window plus TrialFamily, Artifact, strategy-design, universe-selection, PIT-snapshot,
runtime-kernel and simulator identities. The universe-selection identity names the member set the request was
bound to; which instrument that set held is stated by the run's report, on its own member, and is not derived
here.

Long identities remain selectable, expose their complete accessible text and truncate only visually. The
browser receives none of the canonical request bytes, raw receipt, component digests, Product Edge admission,
protected evidence, source, result bytes or storage fields.

After a request is available, the workbench reads the Results the Backtest Owner holds for it through the
Owner's Result directory, `GET /v2/exploratory-replay-results?request_identity={request_identity}&meaning_digest={meaning_digest}` on the same read API, and lists them in one shared
`DataWorkspaceTable`: each row names the committed time, status, Result and attempt identity, in the Owner's
order, and a request with none shows `No runs recorded`. A refusal withdraws the list under the Owner's own
reason. Nothing is typed: `Open result` on a row opens that Result with exactly the identities the
Owner listed, completed by the already-open request identity and meaning digest, and a link that names a
Result marks its row selected without opening it.

The opened Result renders one shared `FactGroup` with only result status, concise diagnostic
category, reconciled component count, semantic-trace availability and the result identity. Status uses the
shared semantic badge colors. No raw 28-row reconciliation, decisive-evidence locator or internal short
sentence is rendered in the primary page. Below that `FactGroup`, the same opened result mounts one
`BacktestRunReport` for that result. The report is its own admitted surface, bounded by its section above, so
this workbench still reserves no chart height and draws no chart of its own: the report's series appears only
inside that report, and only once a result is open.

The authenticated Owner route is exactly `GET /v2/exploratory-replay-requests/readback?request_identity={request_identity}&meaning_digest={meaning_digest}`. It accepts no body and calls the existing
sealed R&D Owner Replay V2 read port. The Owner reads existing custody only; it creates no request, admission,
attempt, timeout transition, outbox row or effect. The Dashboard BFF query-binds both selector fields without
path normalization, validates the complete canonical Owner response, verifies canonical request bytes against
the typed request, and then projects only the fields above. Invalid selectors perform zero Owner calls.

Unknown keys, malformed canonical bytes, identity/digest drift, contradictory availability, oversize response,
permission denial or transport failure clear stale positive state and fail closed.

The result route is exactly `GET /v2/exploratory-replay-results/{result_identity}?request_identity={request_identity}&attempt_identity={attempt_identity}`. It is exposed by the existing `rd-dashboard-owner-read-api`, not by
borrowing the Dashboard write credential. Its narrow typed port opens an R&D transaction, invokes the existing
Backtest Owner locked-read function, returns only the already-validated canonical result bytes, and always
rolls the transaction back. The BFF binds all three locator identities plus the opened request meaning,
validates the complete finite component and diagnostic censuses, and projects only the compact fields above.
Cross-spliced, missing, duplicate, noncanonical, oversized or unknown data fails closed and clears the
previous result.

The same workbench also admits one explicitly selected pre-V2 rejection quarantine point-read. It is not a
fallback from the Replay V2 selector and cannot satisfy or replace a current request/result read. The exact
Owner route is `GET /v1/exploratory-replay-rejections/readback?request_identity={request_identity}&attempt_identity={attempt_identity}&semantic_digest={semantic_digest}`. All three fields are required and must match one row in the R&D-owned
`rd_exploratory_replay_rejections_v1` relation. The query-only Owner port starts a repeatable-read, read-only transaction,
verifies the exact persistent relation shape, Owner, primary/unique identity constraints and SELECT access,
and validates canonical operation/receipt equality before projecting anything.

Only schema V1 `REJECTED_NO_WRITE` with `INVALID_REPLAY_EVIDENCE`, the digest-derived receipt identity, matching
Artifact/build receipt, matching commit time and an original `APP | MCP` channel may be returned.
Missing, widened, current-success, cross-spliced or malformed custody is unavailable.

The browser opens this quarantine through a separate three-field rail labeled `Historical rejection`. Its shared
atomic status cards show only business-facing `Historical`, `Rejected`,
`Quarantined`, `Invalid replay evidence`, committed time and observed time. Request/attempt identities,
semantic digest, Owner receipt, Artifact, build receipt and source channel are available only through the
header info control. There is no directory inference, automatic fallback, Resolve, retry, successor, dismiss,
execution or write action.

A URL may prefill the explicit selector with `custody=historical`, `replayRequestIdentity`, `attemptIdentity`
and `meaningDigest`, but opening it still requires the read action.

Loading preserves the active lookup rail and uses bounded group skeletons. Missing or unavailable custody uses
the same compact body geometry and a precise reason. The result readback supplies no return series, so the
workbench's own surfaces render no `BacktestReturnBand`, invented strategy line, benchmark, return, drawdown
or run count. A return series, net return and maximum drawdown appear only inside the mounted
`BacktestRunReport`, exactly as its Owner projection states them. `Run`, `Resolve`,
`Create successor`, edit, compare, download and provider actions have no slot.

This slice does not establish S3 deployment availability, Backtest execution, executor cutover or real-trading
authority.

### Bounded admission: read‑only strategy code viewer

This slice constrains current Artifact source/preview readback and preserves its existing admission. Native packages retain read only presentation/content verification; Wasm preview is not a prerequisite for native packages, research or activation.

`StrategyCodeViewer` is a `TARGET_DRAFT / IMPLEMENTATION_ADMITTED` presentation atom for the `ArtifactReviewPanel` source/Wasm
region. Its source-fidelity reference is Vibe Trading commit `48c8315f74536d9d308347d63ac9c4e96c9a7120`, tree `d226b620dc699c9e8e382274434b324a5fefe0e1`,
specifically the CodeMirror 6 editor shell and read‑only code surfaces under `apps/web/src/features/lab`. The Trade
adaptation keeps the real CodeMirror line-number gutter, syntax highlighting, folding, text selection, bounded
scrolling, file tab, editor chrome, output pane, responsive layout, reduced-motion transition, and Lucide
actions.

It is an editor-shaped **viewer**, not an editor: no content input, cursor, autocomplete, keybinding,
insert-cell, run, save, rewrite, commit, kernel connection, WebSocket, or AI action is present.

Positive rendering accepts only an exact bounded Owner projection containing artifact identity, canonical
observation time, one source filename/language/content/digest, and one explicit Wasm preview state. Source is
limited to 256 KiB and preview output to 64 KiB. Preview states are `not_run`,
`succeeded`, `failed`, and `unavailable`; only succeeded/failed carries an exact
module identity, target, canonical observation time, finite duration, bounded output, and bounded typed
diagnostics.

Unknown keys, malformed times, invalid digests, oversized text, invalid positions, contradictory state fields,
or stale carried content fail closed to zero source and preview data. The browser never generates sample code,
executes source, synthesizes a Wasm result, or upgrades transport success to an Artifact fact.

The only local UI action is Copy source. Folding, selecting and scrolling are presentation state and
cannot change the projection. The Wasm pane displays an already projected sandbox result; it has no
Run control and performs no module instantiation, network call, Owner resolve, provider effect,
business write, effect-worker mutation, or trading action.

An `IMPLEMENTATION_ADMITTED` detail slice may bind `/rd/artifacts/{build_request_identity}/attempts/{attempt_identity}` to the exact authenticated Owner GET
`/v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/source`. The Owner may return source only for one matching terminal-success custody after its
stored attempt, candidate, receipt, Artifact identity, source capsule, build recipe, deterministic Wasm and
review have passed the existing full custody verifier. It deterministically reconstructs the exact built Rust
source, binds a SHA-256 content digest and committed-at cut, and otherwise returns absent or unavailable; the
Dashboard additionally recomputes the content digest and rejects unknown fields, identity drift, oversize
source and malformed time.

Until an exact sandbox preview readback is separately admitted, the pane is explicitly `not_run`
and carries no module, target or output. The dedicated read port owns no mutation method. Its canonical
read-committed transaction reuses the existing full custody verifier, including the historical Product Edge
admission read and row-lock consistency, but creates no new admission and performs no timeout terminalization,
sandbox invocation or database write. This detail slice does not create an Artifact list, prove deployed
availability or establish executor cutover.

### Bounded admission: Source Intake exact-readback workbench

This slice recovers exact receipts for existing managed Source Intake. Agent host tools acquire and record target sources. This opaque readback is not a source-reading page; it admits no DOI, interpretation or content fields and is no prerequisite to native research.

`SourceIntakeReadbackWorkbench` is the exact `P` surface for `/rd`. It is a bounded
read‑only recovery surface, not the future Source Intake composer. The route uses one full-width
`PanelFrame` and no summary strip, split detail pane, table, timeline, pagination, or reserved empty
height. The frame header contains the `SOURCE INTAKE` eyebrow, `Source intake` title, one-line
purpose, and a `Refresh` action that is disabled until one valid identity has been opened. Its
inset body starts with one horizontal lookup rail: one flexible `Request identity` input followed by
`Open readback`.

At narrow widths only this rail wraps into input then button; the information groups remain in document order.
Icons, when present for state or actions, are Lucide icons only and never decorate field labels.

The initial state is a compact prompt below the lookup rail and does not stretch to the viewport. Opening a
valid identity replaces it with three ordered, softly grouped regions: `Intake` contains the exact
request identity and terminal resolution; `Custody` contains the binding identity, terminal receipt
identity, and committed time; `Evidence` contains authority class and, only for
`RETRIEVED`, the content-presence state and content digest.

The browser does not receive or render raw receipt JSON, DOI, interpretation, source payload, provider
address, response headers, policy decision, principals, TrialFamily fields, provenance internals, outbox
identity, or storage fields. Long identities truncate visually but remain selectable and expose their full
value through accessible text. Labels are muted, values are left aligned, and the group title has the slightly
lighter theme surface used by the standard card system; borders are low-contrast and do not form a fully
connected grid.

Loading retains the lookup rail and shows exactly three grouped skeletons. A verified terminal keeps the same
geometry for every terminal value. An exact `SUBMITTED_OR_UNKNOWN` readback shows a neutral `No verified terminal`
state with the request identity only; it does not expose or imply a Resolve control. Invalid identity shows
inline validation without transport. Missing configuration, transport failure, malformed or oversized Owner
response, permission denial, and any identity/receipt/custody mismatch replace all previously rendered
terminal fields with one same-height unavailable state. Stale successful content is never retained after a new
lookup or failed refresh.

An identity that Product Edge admitted for another operation is one of those mismatches, not an unfinished
Intake: no Source Intake terminal can ever exist for it, so the Owner refuses it with 409 `CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY`
instead of answering `SUBMITTED_OR_UNKNOWN`, and the workbench shows the unavailable state rather than inviting
another refresh.

The Dashboard BFF binds the path identity to authenticated Owner GET `/v1/source-intakes/{request_identity}/readback`, accepts only the
existing strict Source Intake projection, and returns a bounded browser envelope with the filtered fields
above. `Open readback` and `Refresh` are the only network actions and both perform the same
zero-effect point read. Input editing is local presentation state. There is no Source Intake directory and no
inference from Runs, operational jobs, historical custody candidates, or client fixtures. This slice cannot
Submit or Resolve an Intake, create a successor, fetch source content, invoke a provider, mutate the effect
worker, write business state, or authorize trading.

The broader composer, TrialFamily policy, authority-resolution, draft-source, and positive-action panels in
the route registry remain future blueprint content and are not inferred into this workbench.

### Bounded admission: Source to Research typed control

The product has no browser research-submission route. `/rd/intake/new` and `SourceResearchControl` are outside the current admitted product route set; retained transport code is not permission to expose them. The external Agent submits Source/Research through domain MCPs. `/rd` and `/rd/research` keep their independently admitted readback geometry.

Research readback displays the Owner-stated request version, instrument scope and `initial_pit` disposition. Missing or unresolved facts stay unknown; `null` initial PIT does not imply a request version. Invalid scope is the Owner's `INSTRUMENT_SCOPE_NOT_RESOLVABLE`, not a browser-derived inference. Product Edge identity, manifest, authorization, routing-currentness and response-loss semantics remain enforced by the domain request boundary and [R&D contract](../owners/rd/); moving the input out of the browser relaxes none of them.

No Dashboard dispatch, provider call, effect-worker change, production routing cutover or trading is admitted by this section. Future route admission must conform to the read-only research user journey.

### Bounded admission: Develop Composer exact-readback workbench

This slice retains readability and refusals of committed legacy Develop Composer records. Agents author native Strategy in Git without this composer or browser submission.

`DevelopComposerReadbackWorkbench` is the exact `P` surface for `/rd/composer`. It is a bounded
point-read of one previously submitted Develop Composer request, not a composer, editor, runner, resolver, or
Artifact source view. The route uses one full-width `PanelFrame` with no summary strip, table, split
pane, timeline, pagination, or reserved empty height. Its frame header contains the `DEVELOP COMPOSER`
eyebrow, `Composer readback` title, one-line purpose, and one `Refresh` action disabled until a
valid request identity has been opened.

The inset body starts with one horizontal lookup rail containing one flexible `Request identity` input and
`Open readback`. Only that rail wraps at narrow widths. Icons are Lucide only and do not decorate field
labels.

The initial state is a compact prompt. Loading keeps the lookup rail and shows exactly three softly grouped
skeletons. A verified response replaces them with three ordered groups: `Request` contains the
exact request identity and disposition; `Custody` contains the operation receipt identity when
present; `Artifact` contains the Artifact locator, Artifact digest, canonical plan digest, and
design digest only when all four fields are present under `SUCCESS`. For a non-success terminal,
`Artifact` instead contains the exact coordinate and bounded reason when present and never retains
fields from an earlier success.

Group-title surfaces are slightly lighter than the body, labels and values are left aligned, long identities
remain selectable, and separators are subtle rather than a connected grid. The header/body color relationship
follows the standard card system.

The authenticated Owner GET `/v2/develop-composer/runs/{request_identity}/readback` resolves the same identity against the Owner's own Strategy
Input custody as a zero-effect read: it revalidates the stored positive Composer record through the locked
Market Data facade the run itself bound, so a run committed in production reads back in production. This
resolution is `IMPLEMENTATION_ADMITTED / NOT_CUT_OVER`. Neither the route nor its adapter, `PostgresDevelopComposerReadbackOwnerV2`, carries a feature
gate, so a deployed read API serves it for runs the ungated `POST /v2/develop-composer/runs` committed.

It re-derives the run at the Research View and read cut the run recorded when it committed, so the same
identity keeps reading back after that View expires or moves to `ARTIFACT_AVAILABLE` or `EXPLORATION_ACTIVE`.
A run committed before that record existed reads back only while its Research View has not moved past
`INTENT_FROZEN` and the authority it was admitted under is current, and otherwise answers
`UNAVAILABLE` at coordinate `research_custody.run_view_unrecorded`, so the page is not read as the run having vanished.
It accepts no request body and returns the existing strict `DevelopComposerOperationResponseV2`; the Dashboard BFF path-binds
the identity and filters it to the fields above.

`SUCCESS` requires an operation receipt plus the complete four-field Artifact projection. Every
other disposition must carry no receipt or Artifact projection. Unknown keys, identity drift, contradictory
disposition fields, malformed digests, oversized response, missing configuration, permission denial, transport
failure, or failed sealed-custody verification fail closed to one unavailable state and erase stale success
content.

`Open readback` and `Refresh` are the only network actions and perform the same GET. Input
editing is local presentation state. No source, design bytes, canonical plan bytes, Wasm/module bytes, receipt
bytes, request payload, binding request, plugin capsule, principal, policy, outbox, or storage fields cross
this boundary. The workbench has no `Run`, `Resolve`, `Edit`,
`Save`, `Compile`, `Preview`, or provider action and does not render the
read‑only code viewer because this contract carries no source text.

Artifact source remains available only through its separately admitted exact Artifact source route and
identities; an Artifact locator alone is not converted into those identities. This slice cannot mutate the
effect worker, write business state, invoke a provider, or authorize trading. The broader Intake composer and
authority-resolution panels remain future blueprint content.

Existing disposable `POST /api/rd/develop-composer` and `dashboard_develop_composer_action_v2`
are compatibility transports, not Dashboard target capabilities. They retain exact projection equality,
current compatibility/routing admission, operator permission, frozen queue custody and resolve-before-submit.
Submission-start precedes transport; only claim one can submit on the exact Owner absence sentinel.
Response loss, restart and later claims are resolve-only. Existing records and these refusal rules are not
reinterpreted as native package authoring. External Agents use the R&D domain MCP; this readback page gains
no submit, runner, compiler, provider or production authority.

### Bounded admission: verified Research directory and exact readback

Target research records organize projects, hypotheses, native strategy versions, run results and Agent conclusions. This slice retains exact reads of supported historical protocol shapes; old Composer fields/deployment views are not native-route prerequisites.

`ResearchDirectory` is the exact `P` surface for `/rd/research`. The route uses one
full-width `PanelFrame` and does not reserve an empty detail column. Its frame header contains an
eyebrow, title, one-line purpose, and one `Refresh` action. The body contains one horizontal table
toolbar with a `Research history / Current intents` segmented control at the left and search at the right.
`Research history` is the default because it is the complete available request workload;
`Current intents` is the narrower verified-current view.

The verified table has four plain, left-aligned columns in this order: `Research request`,
`State`, `Intent`, and `Updated`. Column headings have no decorative icons
and there is no View/column-chooser button, registered/visible count, multi-level filter popover, row action,
or backend-only field. The table header remains sticky inside the bounded scroll viewport. Loading, valid
empty, unavailable, and partial states preserve the same card geometry; narrow layouts scroll horizontally
rather than inventing a reduced mobile fact.

Both Research views use the shared domain-neutral `EntityReference` atom: the business entity is the primary
label, while its opaque identity is a compact secondary reference with the exact value retained as title and search
key. Default history copy says `Research question`, `Result`, `Recorded`, and user-readable availability; Owner, custody, point-read,
candidate, and wire-state terms remain in the information disclosure or contract.

In `Research history`, activating either the primary research-question reference or the row expands one
shared `DataWorkspaceTable` row-detail directly beneath that source row, without changing the directory URL or
unmounting its filters, search, pagination, or scroll context. The row-detail composes the existing
`ResearchQuestionBrief`, `DetailFactGrid`, `StatusBadge`, and `PanelFrameInfo` atoms.

It shows the verified hypothesis, falsifier, expected observation, `Ready to review / Awaiting result / Result unavailable` availability, and
recorded time already present in the bound directory projections; exact request identity and the independently
observed question/result cuts remain inside the information disclosure. Opening the summary performs no
additional read. When the bound result inventory says that the request is ready or still awaiting an outcome,
an explicit `Review result` or `Check request status` action replaces the summary inside that same
row-detail with an exact read-only result drilldown.

The drilldown reuses the same strict read hook and result-content atoms as `/rd/research/{requestIdentity}`; it does not
mount another dialog, change the directory URL, or expose formation controls. `Back to request summary` restores
the summary and focuses the drilldown trigger. Only a successfully verified exact read exposes
`Open full research workspace`, which remains the transition to the canonical route with read-only evidence and technical custody details. A non-2xx response, identity mismatch, malformed payload, collapse, Back, or
identity change invalidates the in-flight read and retains no positive result or workspace action. Closing
restores focus to the originating reference or row.

Only one row may be expanded. Activating it again collapses it; activating another row replaces it. Sorting,
pagination, page-size, filter, tab, and Refresh changes collapse the detail and invalidate its read. The
detail row spans the table columns without joining pagination counts or sort order. The directory and its
row-detail always use the page viewport as their single vertical scroll owner; expanding or collapsing a row
never switches to a table-owned vertical scroller. At narrow widths the detail keeps one readable content
column inside the existing horizontal table viewport and adds no nested vertical scroll container.

The canonical workspace keeps the same atoms in its wider multi-column composition. In `Current intents`,
activating the primary request reference or its row expands the same shared row-detail directly in exact
read-only result mode. It preserves the `/rd/research/?view=verified` URL, table filters, pagination, sort, scroll and
origin focus; it does not fabricate a History summary or show `Back to request summary`. The read clears prior
positive state before every identity change and rejects late, aborted, non-2xx, malformed or
identity-mismatched responses. Only the explicit `Open full research workspace` action changes to the canonical request
route.

This current-intent preview never enables formation, submit or resolution controls.

The default history view obtains one bounded `rd.research_question_directory.read.v1` projection from the read-only R&D Dashboard
Owner. Question text is admitted only after canonical Research custody verification and may expose exactly
`hypothesis`, `falsification_question`, and `expected_observation`; unsupported historical rows retain only
their directory identity and time with explicit unavailable state. The projection must bind the complete
historical-custody identity and commit-time set before any question text is rendered. The hypothesis then
replaces the generic request label and participates in search; the opaque request identity stays secondary.

Missing legacy meaning is rendered as `Research question unavailable`. It is never inferred from execution or outcome.

The exact `/rd/research/{requestIdentity}` page frames one user task: understand the saved research result and what
can happen next. Its journey and `Result / Strategy / Timing` groups use business copy such as `Needs current review`,
`Not available`, and `Refresh this request`; they do not present quarantine or same-identity terminology as
the task itself. `Raw outcome` and `Raw reason`, together with exact identities and receipts, remain available only
inside the technical information disclosure.

Before that journey, the page may render the verified research question through the shared `SummaryList` atom. It
shows exactly `hypothesis`, `falsification_question`, and `expected_observation` only when the question-directory
item matches the readback's request identity, Owner-receipt `semantic_digest`, and `committed_at_epoch_ms`. Any
mismatch, unavailable question, or missing receipt field withdraws the whole question brief rather than showing
stale meaning. `Refresh` re-reads both projections; neither read authorizes a write.

The existing `EXPLORATION_ACTIVE` readback has two exact, read-only shapes:

- **Schema 2:** carries the build Artifact's `attempt_identity`, `artifact_identity`, `build_receipt_identity` and `artifact_review_identity`, plus the Replay it ran. It has no `composer_artifact`. Identity uses `rd-research-view-v3`; the cut names the Replay seal with `rd-exploration-cut-v1-`.
- **Schema 3:** `composer_artifact` carries all ten Composer facts, from locator/identity digest through family binding receipt and census frontier digest. Only its matching producer can supply these facts; `composer-v3-replay` remains a separate, gated producer admission, not authority granted by this read.
- **Identity verification:** schema 2 is pinned to `product/rd-owner-client/fixtures/research_view_identity_vectors_v3.json`; schema 3 to `product/rd-owner-client/fixtures/research_view_identity_vectors_v4.json`. A schema 2 view carrying Composer facts, or a schema 3 view missing them, is refused. Absence cannot be encoded as presence.
- **Display:** `Availability` is `Exploration active`, `Next step` is `View exploratory run`, and journey is `Exploration is active`. Do not substitute `Strategy is ready for build`, `Intent frozen` or `Awaiting R&D`. A phase or next action outside the four variants each projection maps makes the readback unavailable.
- **Links:** `Exploratory replay` uses only sealed `replay_request_identity` and `replay_request_meaning_digest` at `/backtest?replayRequestIdentity=&meaningDigest=`. `Composer run` appears only for schema 3 and uses sealed `composer_request_identity` at `/rd/composer?requestIdentity=`. The page derives no identity or run.

When the historical-custody Owner projection is available, the route places one shared compact Bento status
card before the directory. It organizes the user's R&D workspace into three thin-shoulder groups:
`research`, `build`, and `families`. When the Research outcome inventory is
complete and identity-bound to that same separately rendered custody set, `research` separates
`results ready` from `waiting`; otherwise it fails back to the raw `requests` total.
The `build` group shows `attempts` and, on the Artifact route when its independent
review inventory is bound, `reviewable`.

The `families` group shows `bindings`. The shared CompactStatusBar recognizes a
`2 / 1 / 1` uneven cut: at wide widths the two-item group occupies the 3-part side while the two
one-item groups stack on the 2-part side; narrower widths return to the ordinary responsive stack. This avoids
stretching one-row data and does not draw a page-local component.

This is a navigation map across independent work queues, not a conversion funnel, lifecycle, verified journey,
or claim that the sets are one-to-one. It disappears when the projection is unavailable and never replaces the
separately verified R&D loop. Refresh on either directory view refreshes the custody projection. Each metric
is one quiet navigation target over the same Owner cut: `results ready` opens `/rd/research/?outcome=ready`,
`waiting` opens `/rd/research/?outcome=awaiting`, fallback `requests` opens `/rd/research/`,
`attempts` opens `/rd/artifacts/`, and `bindings` opens `/rd/artifacts/?kind=bindings`.

Unknown or missing query values fail back to the useful `Request history / All` default; `view=verified`
explicitly selects `Current intents`. The links admit no new read or write contract. Query changes preserve
the mounted directory surface so the table does not flash through another view while the URL settles.

The authenticated Owner GET `/v1/research-goals/directory` returns at most 20 verified V2 request outcomes. It considers
at most 60 receipt candidates per page, ordered by `(committed_at_epoch_ms, request_identity)` descending with PostgreSQL
`C` collation for the bounded ASCII identity, and exposes the same tuple only as an opaque
stable `Load older` cursor. Each candidate is read in its own canonical read-committed transaction
under `FOR SHARE` and passes the existing complete Research custody verifier, including its stored
request, receipt, frozen intent, Research view, authority lineage, independence basis, protected-feedback
projection, and TrialFamily custody.

Legacy or quarantined request schemas are omitted and make the cut explicitly partial. A malformed or changed
candidate fails the entire read unavailable; it is never treated as an empty successful page. The default
all-research view uses authenticated GET `/v1/historical-custodies`, served by the consolidated `strategy-factory-rd-dashboard-read-api`
described below. Its dedicated Owner port opens only `default_transaction_read_only=on` sessions and reads one bounded
repeatable-read transaction. It returns at most 200 request identities with their custody time and the exact
state `POINT_READ_REQUIRED`; it exposes no request meaning, disposition, availability, receipt, authority, or
current/legacy classification.

Truncation is explicit.

Dashboard-only authenticated GET `/api/rd/research/outcome-inventory` composes that bounded custody cut with one existing
identity-bound Research exact read per scanned request, with at most six reads in flight. It distinguishes
`outcome_ready`, `awaiting_outcome`, and `unavailable`; an available read with no outcome is
explicitly awaiting, not unavailable. The projection preserves source and composition observation times,
scanned and source totals, completeness, all three state totals, and each request identity. It is not one
atomic cross-record Owner snapshot and creates no Research-to-Artifact or TrialFamily join.

The browser may show `All / Results ready / Waiting` only after the inventory request-identity set exactly matches the
separately rendered custody set. A mismatch or unavailable composition disables the filtered cuts without
turning the raw candidate directory into an empty result. Only `outcome_ready` rows claim an Owner
outcome; awaiting rows open their exact request status, and unavailable rows offer no false action. Unknown
`outcome` values fail back to `All requests`.

The inventory's `accepted | rejected | quarantined` resolution is Research request admission custody, not a
scientific verdict and not an Iteration Decision. It cannot label a hypothesis active or falsified, populate
`/rd/decisions`, or enable a Decision action. That route may populate only from dedicated typed IterationDecision
Owner reads that bind the exact decision, evidence, result, and lineage identities.

The verified Research directory, Research exact-readback, Artifact exact-readback, Source Intake
exact-readback, Develop Composer exact-readback, and Exploratory Replay V2 exact point-read GETs are packaged
in the consolidated `strategy-factory-rd-dashboard-read-api`.

This first-party Dashboard reader also serves the Artifact directory and source GETs, while its state retains
separate typed `ResearchDirectoryOwnerPort`, `ResearchReadbackOwnerPortV1`, `ArtifactDirectoryOwnerPort`, `ArtifactReadbackOwnerPortV1`,
`ArtifactSourceOwnerPort`, `SourceIntakeReadbackOwnerPort`, and `DevelopComposerReadbackOwnerPortV2`, `ExploratoryReplayReadbackOwnerPortV2`,
`FormationCatalogOwnerPortV1`, `HistoricalCustodyOwnerPortV1`, and `IterationTimelineOwnerPortV1` capabilities rather than collapsing
domain boundaries into a generic repository. Its router exposes only `/health` and fourteen
admitted GETs after adding `GET /v1/formation-catalog`, `GET /v1/trial-families/{trial_family_identity}/iterations`, and `GET /v1/historical-custodies`; no write
route is added.

Historical custody is served here rather than by the write API, so no Dashboard read needs a write-side
credential. Dashboard binds them through the atomically configured `RD_DASHBOARD_OWNER_READ_API_URL` and
`RD_DASHBOARD_OWNER_READ_API_TOKEN` pair. A partial pair fails closed and never borrows the write API's credential. The
adapters reuse the canonical locking verifiers and expose no submit, resolve, sandbox, or mutation port. The
Source Intake adapter additionally binds a read‑only Product Edge admission port and the existing
request-proof digest before projecting terminal custody; missing or incompatible internal configuration
disables only this route.

Composer joins this same process through its own typed read port and adds no per-domain container. Its adapter
owns only an `rd_owner` read pool, reuses the existing sealed routine and current Research/Market
evidence verification, and carries no fact-writer pool or mutation method. Replay delegates through an
independent Dashboard typed point-read port to the existing sealed Replay V2 read port. Its adapter owns only
the same `rd_owner` read pool, never assembles the legacy write-Owner composition root, and exposes
no identify, submit, resolve, run, or result operation.

`GET /v1/formation-catalog` is a bounded, read-only composition of the verified Research and Artifact directory and
exact-readback ports. It returns at most 20 accepted TrialFamilies, ordered by `(research.committed_at_epoch_ms, trial_family_identity)`
descending. Each row contains only the exact Research request/receipt/intent identities, current Research-view
availability and next legal action, the frozen trial budget, the verified consumed budget, and zero or more
current-custody successful Artifact attempts. Successful attempt rows contain their build request, attempt,
Owner receipt, Artifact review, and TrialFamily binding identities plus the Owner commit time.

The existing Artifact directory deliberately withholds failed, rejected, unknown, and in-flight attempts;
therefore any non-empty catalog is explicitly `PARTIAL_UNAVAILABLE`. It never converts a commit time into a
prepared time, and it never invents a negative attempt. A malformed cross-binding, changed identity, verifier
error, or unavailable constituent read makes the whole catalog unavailable rather than silently dropping a
family.

`GET /v1/trial-families/{trial_family_identity}/iterations` is served by a separate typed read-only projection port. It freezes one bounded set of
immutable Decision locators from the requested family, then resolves every locator through the canonical
unified Decision resolver. The response exposes only the verified TrialFamily/census identities, trial and
consumed budgets, observation time, and an ordered list of exact Decision identity/digest, round, request,
Result, attempt, receipt, commit time, canonical `IterationDecisionOutcomeV1`, and its corresponding Product Edge
action class.

The action classes are exactly `SUBMIT_REPAIR_REQUEST`, `CREATE_SUCCESSOR_INTENT`, `STOP_ON_COMMITTED_DECISION`, and
`SUBMIT_SELECTED_CANDIDATE_TO_QUALIFICATION`; the Dashboard does not rename all repairs as Replay repairs or manufacture an evidence
state absent from Owner custody. Duplicate, non-monotonic, cross-family, oversized, malformed, or concurrently
inconsistent cuts fail closed. An empty verified Decision list is valid and means `AWAITING_REPLAY_RESULT`.

The Formation catalog, the Iteration timeline, and the historical custody read stamp `observed_at_epoch_ms` from
the R&D Owner's clock, `pg_catalog.clock_timestamp()` read inside an Owner transaction, which is the clock their commit
times come from. It is compared only with those commit times, never with the Dashboard process's clock, which
can differ from it.

Each of these reads instead carries a fresh 128-bit nonce in the `x-dashboard-read-nonce` request header, and the
read API returns that header unchanged only beside a `200` projection the Owner produced for
that request: a read without exactly one well-formed nonce is refused with `400` before any
Owner call, and a refusal or failure carries none. The BFF accepts an answer only when it echoes that read's
own nonce, and treats any other as `OWNER_RESPONSE_UNAVAILABLE`.

The `/rd/research` surface may render the shared `JourneyProgress` atom only after both the Formation row and its
exact Iteration projection are available and identity-consistent. The Journey summarizes the current loop; it is not
a second business state machine. While either projection is loading, unavailable, partial in a way that removes the
selected family, or malformed, the route preserves its ordinary Research directory and renders no placeholder,
synthetic stages, stale prior Journey, or explanatory filler.

The browser receives only request identity, optional intent identity, accepted or rejected-no-write disposition,
current Research-view availability and phase when accepted, and committed time. Rejected-no-write rows carry no
invented intent or view. Research goal text, sources, principals, policy, authorization, raw receipts, TrialFamily
payloads, ancestry, and storage fields remain withheld. Unknown wire keys, contradictory disposition/view fields,
duplicate identities, future or malformed time, invalid completeness/count, oversized response, transport failure,
or missing configuration all fail closed to `unavailable`.

Verified directory rows link to the identity-bound `/rd/research/{requestIdentity}` route. The detail route uses one
`PanelFrame` with its heading and right-aligned `Back to requests`, `Refresh`, and
technical-info controls on the frame surface, followed by one inset body. Accepted and rejected outcomes use
the shared `FactGroup` atom in the fixed order `Outcome`, `Intent`,
`Timing`. Labels and values are left aligned; values share one typography scale, status meaning is
carried by `StatusBadge`, and long identities truncate visually while retaining their complete
selectable value and title.

Receipt identity, projection identity, source cut, and TrialFamily identity remain behind the technical-info
control instead of appearing as loose explanatory copy. A verified `SUBMITTED_OR_UNKNOWN` readback keeps the
same frame but replaces the groups with one bounded empty state; an invalid identity, configuration failure,
permission denial, malformed or oversized Owner response, identity drift, or transport failure clears prior
content and renders one shape-preserving unavailable state.

Research detail exposes no Artifact Formation, internal model generation or Artifact write action. Strategy authoring uses the domain JSON interface; this page only performs the admitted reads and navigation below.

The Dashboard GET `/api/rd/research/{requestIdentity}` path-binds the identity and reuses the registered `research_goal.shadow_resolve.v1`
Owner GET `/v2/research-goals/{request_identity}/readback`. The BFF returns only the verified outcome, optional current Research view,
committed/observed/valid-through times, and the bounded technical identities named above. It accepts no
request body and does not enqueue a RunStore read. `Refresh`, directory
view/search/sort/pagination, `Load older`, `Open detail`, and local back navigation are the
only actions.

That exception does not change the Product Edge binding and does not authorize a production Owner/provider
write, production cutover, trading, generic Submit, or create-successor. The broader Research admission,
outcome-action, receipt timeline, and S1 custody panels in the route registry remain future blueprint content.

### Bounded admission: verified hypothesis directory

`HypothesisDirectory` is the exact read-only `P` surface for `/rd/hypotheses`. It answers one user task:
compare saved research hypotheses with the observation that would support them and the question that would falsify
them. The route reads only the existing `rd.research_question_directory.read.v1` projection. It does not infer
scientific validity, active/falsified state, an Iteration Decision, or a Research outcome from that projection.

The route uses one full-width `PanelFrame`, the shared compact toolbar, and one `DataWorkspaceTable`.
`All / Verified / Unavailable` filters and text search operate locally over the complete bounded projection. The
business columns are `Hypothesis`, `Falsifier`, `Expected observation`, and
`Recorded`; opaque request identities and semantic digests are absent from the table. Activating a
row expands one inline detail beneath it without changing the URL or mounting a drawer or dialog.

The detail reuses `ResearchQuestionBrief`, `DetailFactGrid`, `StatusBadge`, and `PanelFrameInfo`;
the exact request identity, semantic digest, and source observation time live only in the information
disclosure. One explicit `Open research record` link navigates to the canonical exact Research workspace.
Sorting, pagination, filtering, search, and Refresh collapse the open detail. The page viewport remains the
only vertical scroll owner.

Loading clears prior positive data. A non-2xx response, malformed projection, identity duplication, unknown enum,
future timestamp, unavailable Owner route, or transport failure renders one compact unavailable state and no rows.
An item whose verified question is unavailable remains a visible, explicitly unavailable record with no fabricated
question text. `Verified` means only that the saved question text passed the existing Owner custody contract; it is
not a claim that the hypothesis is true. The route exposes no submit, resolve, successor, formation, decision, edit,
or execution control and cannot affect effect routing.

### Bounded admission: verified Iteration Decision directory

`RdDecisionDirectory` is the exact read-only `P` surface for `/rd/decisions`. It answers one user task: review the
committed result of each research round and understand the Owner-declared next step. The browser first reads the
existing bounded Formation catalog, then reads the exact Iteration timeline for every returned TrialFamily with at
most four requests in flight. A family/timeline identity or trial-budget mismatch, duplicate decision/result/attempt/
receipt identity, unavailable timeline, malformed response, or transport failure withdraws the entire Decision cut.
An available zero-family catalog is a valid empty view and never creates a synthetic Decision.

The route reuses `PanelFrame`, the compact filter/search toolbar, `DataWorkspaceTable`, controlled
inline row detail, `ResearchQuestionBrief`, `DetailFactGrid`, `StatusBadge`, and `PanelFrameInfo`.
The main table shows only `Research question`, `Decision`, `Next step`, and
`Recorded`. `All / Repair / Successor / Ready / Stopped` filters and search are local to the verified cut. Opaque family,
Decision, replay request/result/attempt, receipt, frontier, and digest values remain in the information
disclosure.

When the independently verified saved-question directory contains the Formation row's Research request, its
hypothesis/falsifier/expected observation provide row and detail context; otherwise the Decision remains
visible with explicit unavailable question text rather than invented meaning.

Activating a row expands one detail beneath it without changing URL or creating a drawer, dialog, or nested vertical
scroll owner. The detail reports the committed outcome, round, consumed/frozen trial budget, time, and the precise
outcome-specific reason or target. Its only navigation is `Open research record` to the Formation row's canonical
Research workspace. Refresh clears the prior positive Decision cut before reading again. The route exposes no repair,
successor, stop, qualification, replay, submit, resolve, mutation, or execution control and cannot change the effect worker or
effect routing.

### Bounded admission: verified Artifact directory

Target packages organize exact Git revision/content hash, native Strategy entry, dependencies and reproducible run bindings. This slice retains existing build/attempt compatibility identities; Wasm, build history and shadow resolve add no native-package prerequisite or admission.

`ArtifactDirectory` is the exact `P` surface for `/rd/artifacts`. The route uses one
full-width `PanelFrame` and does not reserve an empty detail column. Its frame header contains the
eyebrow, title, one-line purpose, then one `Refresh` action. Its body contains one horizontal table
toolbar with a `Build history / Current artifacts` segmented control at the left and search at the right.
`Build history` is the default because it exposes the available attempt workload; `Current artifacts` is
the narrower verified-success view. Build history adds one inline `All attempts / Reviewable / Bindings` rail in the same row.

The verified table has four plain, left-aligned columns in this order: `Artifact`,
`Strategy intent`, `Verification`, and `Created`. Column headings have no decorative icons
and there is no View/column-chooser button, registered/visible count, multi-level filter popover, or
backend-only field. Opening the Artifact identity navigates to the exact read‑only source-viewer URL. The
table header is sticky inside the bounded scroll viewport; loading, valid empty, unavailable, and partial
states preserve the same card geometry. At narrow widths the table scrolls horizontally; it does not collapse
identities into invented mobile facts.

The source viewer is a canonical long-content workspace rather than a `DetailSheet`: source folding,
selection, scrolling, copy, WASM evidence, and complete technical inspection remain on the exact build/attempt
route. Its browser read is bound to that identity pair and begins by clearing the prior Artifact identity,
source, WASM preview, and Copy capability. A new identity or unmount aborts and invalidates the prior read.

Only the current request, a successful HTTP response, and the strict existing projection normalizer may
restore positive source; late, aborted, non-2xx, malformed, or transport-failed responses retain the fixed
unavailable viewer geometry and cannot refill an older source. The workspace remains GET-only and exposes no
edit, save, run, build, deploy, or Owner/effect-worker control.

Research and Artifact directories share the domain-neutral `EntityReference` atom. The primary line names
the business entity (`Research request`, `Build request`, `Build attempt`, `Strategy artifact`,
`Strategy intent`, or `Strategy family`); the opaque identity is a compact secondary reference and the
exact value remains available as its title and search key. Default table copy uses
`Result`/`Outcome`, `Recorded`, and user-readable availability; Owner,
custody, point-read, candidate, and wire-state language stays in the information disclosure or contract.

An enabled asynchronous directory read projects its internal first-render `idle` state as
`loading`. The table may be visually quiet during the short loading-delay threshold, but it must
not render an empty/search-empty claim or a zero summary before the first Owner response settles. Only a
completed available read with zero matching rows may render empty; unavailable remains a separate fail-closed
state and never retains the previous route's rows.

In `Build history`, activating the primary build reference or selecting its attempt row opens the same
shared `DetailSheet` without changing the directory URL or unmounting its view, filters, search,
pagination, or scroll position. The compact summary composes the shared `DetailFactGrid`,
`StatusBadge`, and `PanelFrameInfo` atoms and answers only whether a readable build result exists
and when the attempt was prepared. Exact identities and observation cuts stay in the information disclosure.
Only a currently available inventory item that is bound to the same custody cut exposes `Review build result`.

That explicit action switches the same sheet from summary to an exact read-only result drilldown; merely
opening the summary performs no exact point read. The drilldown reuses the canonical historical readback hook
and shared `Build journey` plus `Result / Review / Timing` content, while `Back to build summary` restores focus
to the drilldown trigger. Only a successful HTTP response whose body passes both identity checks exposes
`Open full build workspace`; non-2xx positive-looking bodies, mismatched identities, cancelled reads, and responses
arriving after Back or Close remain fail closed.

An `unavailable` or loading item remains summary-inspectable but exposes neither the result drilldown
nor a canonical action. Closing the sheet restores focus to the originating control or row, and narrow screens
reuse the shared full-viewport sheet geometry. During a refresh, retained rows may preserve table geometry,
but the Bento summary count, primary-reference detail, outcome badge, secondary summary, and footer all switch
to `Checking` or unavailable placeholders; no retained positive review state is presented as
current.

The exact historical-attempt route is titled `Build result` and answers whether the build produced an Artifact.
It consumes the same fail-closed historical readback hook and shared journey plus `Result / Review / Timing` content
as the directory drilldown. Those groups render `Historical only` and a human-readable failure
reason. Exact `Raw result`, `Raw reason`, build request, attempt, and receipt values remain in the information
disclosure; the page does not turn a historical read into a current Artifact or action.

When the historical-custody Owner projection is available, the route reuses the shared compact Bento card
before the directory. Its thin-shoulder groups are `research`, `build`, and
`families`: `research` shows exact `requests`; `build` shows
`reviewable` when the independent review inventory is bound beside exact `attempts`;
`families` shows exact `bindings`. The values are independent work-queue counts and quiet
links to their canonical views; they are not verified Artifact totals, a lifecycle, or a one-to-one flow.

The card disappears on an unavailable projection, and Refresh in either directory view refreshes that same
Owner cut without adding a scheduler, operational write, or Artifact action. `reviewable` opens
`/rd/artifacts/?availability=reviewable`; `bindings` opens `/rd/artifacts/?kind=bindings`.

The Dashboard-only GET `/api/rd/artifacts/review-inventory` composes that bounded custody cut with the existing identity-bound
Artifact readback GETs using at most six concurrent reads. It does not create a new Owner fact or claim one
cross-record snapshot: every candidate retains its own `reviewable | unavailable` point-read result, while the
projection separately preserves the custody observation time, scanned count, total count, and truncation. The
client admits the composition only when the complete candidate identity tuple set still matches its separately
rendered custody cut; drift withdraws the reviewability overlay without hiding the ordinary candidate
directory.

When the complete cut is available, the compact card answers `reviewable / attempts`; its link opens the
canonical `availability=reviewable` build-history view. Only reviewable rows link to Historical build outcome.
Unavailable rows remain visible under `All attempts` but are not presented as actionable links. If the
composition is unavailable, the ordinary candidate directory remains usable and no zero-reviewable claim is
inferred.

The authenticated Owner GET `/v1/artifact-builds/directory` returns at most 20 verified items. It considers at most 60
attempt candidates per page, ordered by `(prepared_at_epoch_ms, build_request_identity)` descending with PostgreSQL `C`
collation for the bounded ASCII identity, and exposes that same tuple only as an opaque stable
`Load older` cursor. Every candidate is checked in its own canonical read-committed transaction by the
existing full Artifact custody verifier.

Only a terminal `SUCCESS` receipt whose Artifact identity exactly matches its sealed Artifact
Review is projected; the browser receives the build request, attempt, Artifact, and strategy-intent
identities, committed time, build target, and explicit `ADMITTED` build security state. Nonterminal
or non-success attempts are withheld and make the page explicitly partial. Any malformed custody,
database/verification error, unknown wire key, contradictory completeness/count, invalid identity/time,
oversized response, or transport/configuration failure makes the affected read unavailable; it never becomes
an empty successful page.

The default build-history view uses the same authenticated GET `/v1/historical-custodies` and read-only Owner cut as
Research. It exposes at most 200 attempt and 200 TrialFamily-binding identities, their custody times, and only
`POINT_READ_REQUIRED`. Counts are custody-index counts, never verified Artifact or valid-binding counts. No
Artifact outcome, binding validity, current authority, raw receipt, payload, or storage field is inferred by
the directory cut. An attempt candidate is a link to an exact historical point read; only that point read may
classify the candidate from its complete stored custody.

The verified-directory, exact-readback, and exact-source GETs are packaged in the consolidated
`strategy-factory-rd-dashboard-read-api` described above. Its Artifact state holds only the typed `ArtifactDirectoryOwnerPort`,
`ArtifactReadbackOwnerPortV1`, and `ArtifactSourceOwnerPort`, never a sandbox or an Artifact mutation port. The exact
readback GET is current-first: an exact current stored shape always enters the existing complete Artifact
verifier, and a current verification failure never downgrades to a historical decoder. An exact non-current
shape may enter the historical quarantine verifier.

Only a terminal `FAILED_NO_ARTIFACT`, `REJECTED_NO_WRITE`, or `OUTCOME_UNKNOWN` receipt with canonical
identity, semantic digest, time, and no-Artifact relations becomes `LEGACY_TERMINAL_QUARANTINED`; historical
`SUCCESS` remains unavailable because it lacks the sealed build-security evidence required by
current Artifact custody. The verified directory omits non-current shapes and marks the cut partial instead of
making verified current rows unavailable. Source reads remain current-only. The adapter never calls
`ArtifactBuildOwnerPort::resolve`; it cannot terminalize an expired attempt, submit a Building candidate, drain legacy
custody, invoke a provider, or otherwise write business state.

The PostgreSQL adapter remains a normal read-committed locking reader because the canonical verifier requires
`FOR SHARE`; changing it to a read‑only transaction would reject the verifier itself. Dashboard binds
these endpoints through the same atomically configured `RD_DASHBOARD_OWNER_READ_API_URL` and `RD_DASHBOARD_OWNER_READ_API_TOKEN` pair. If
either value is present without the other, the read fails closed and never borrows the other credential from
the write API.

`Refresh`, switching the local directory/kind views, local search/sort/pagination,
`Load older`, opening one exact verified Artifact, and opening one exact historical attempt outcome
are the only actions. Historical detail uses the same `PanelFrame`, `FactGroup`,
`FactItem`, `StatusBadge`, and compact filter-button atoms as the other readbacks. It shows
only business-facing outcome, quarantine, reason, and timing facts; exact identities and the Owner receipt
stay behind the existing info affordance.

This directory does not submit or resolve an attempt, build source, run a sandbox/Wasm module, invoke a
provider, mutate the effect worker, write business state, or authorize trading. `WASM_PREVIEW_NOT_RUN` in the
linked source viewer remains unchanged until a separate real Owner-backed preview contract is admitted.

The authenticated GET
`/v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/readback` is admitted as both the exact
Owner-outcome source for the effect-free `artifact_build.shadow_resolve.v1` operational read and the exact source for
the bounded historical quarantine detail above. It preserves strict current Artifact verification and exposes only
verified terminal legacy no-Artifact outcomes to that historical detail. This admission does not extend to Artifact
actions, review, binding, replay, security panels, or any mutation.

## Service and data boundaries

Dashboard owns route/presentation, local session/capability projections, bounded disposable run/worker/progress/result/log views, service logs, append-only control-plane audit, rebuildable frontier/lag caches, and notification presentation/delivery acknowledgement. It never directly reads/writes Owner tables, issues authorization, or owns research, strategy, eligibility, capital, or trading facts. API/BFF consumes source Owner/Product Edge typed public ports only and returns available/stale/partial/unavailable/unknown/rejected/terminal envelopes. Cache entries bind source identity/cut, version, observed time, expiry/rebuild path; cache/job loss never changes business facts.

Research remains read-only. Retained Source/Research/Artifact/Replay mutation transports are outside Dashboard actions. External Agents author and submit bounded tasks through domain MCP; native Strategy and service tasks require no old S1/S2 Composer chain. Dashboard displays exact results and supported historical identities, without research preflight, prepare/candidate/fail or provider dispatch. These seals still govern actual compatibility consumers; source Owners verify internally and BFF cannot reconstruct positive authority.

**Authorization and downstream seam - [Product Edge](../architecture/product-edge/):**

- `AuthorizationAdmissionGateway` orchestrates canonical binding/history, Operator Authorization/Time Evidence/revocation, and content-addressed manifest ports only. Cache never crosses `valid-through` or skips first-write atomic reread. Missing/stale/expired/revoked/ambiguous/self-asserted/local-config/mismatched inputs are non-admitted with zero Owner writes. No Dashboard create/edit/sign/renew/replace/force-active endpoint.
- Backend append-only successor binds prior identity/sequence, unchanged principal/audience/scope, new validity/receipt; changed scope/duplicate sequence conflicts. First downstream mutation uses original binding or immediate equivalent successor only; distance>1 fails closed. BFF reads, never issues or chain-walks. Expired recovery stays unadmitted without Owner API, direct-successor enforcement and PostgreSQL evidence.
- OA custody, PE binding/admission custody and PE→R&D seam are separate. OA/PE receipts cannot invent R&D receipts or turn a missing seam into input rejection. Existing `ProductEdgeDownstreamAdmissionResolverV1` still requires a PE-owned hardened port inside R&D's physical transaction: non-locking normalized hint builds bounded locator plan only; take all sorted/deduplicated OA shared locks before PE binding/history/head/supersession/manifest/admission/receipt/outbox locks. Locator change after hint aborts; no new OA lock after any PE lock.
- SQL returns provenance envelopes, never business admission/write/sealed authority. PE Rust canonical-verifies complete row/digest/receipt/outbox/cross-binding and uses a private non-Deserialize constructor for sealed readback. R&D has schema usage/exact execute only; PUBLIC/unrelated Owners have none. Separate connection, unlocked/raw envelope, direct R&D OA access or BFF reconstruction rejects. Until dynamic migration/ACL/consumer admission, the seam is unavailable and S2/provider effects stay zero.

**Research and protected custody - [R&D](../owners/rd/) / [Qualification](../owners/qualification/):**

- Compatibility S1 V2 FirstMutation needs current PE authority. After write-once basis/head/outbox, exact request/meaning/original admission/digest/cut yields sealed `SEALED_BASIS_PENDING_QUALIFICATION`. Same-identity `resolve_v2` accepts no caller bytes; Historical completion never rewrites/duplicates basis/head/outbox. Changed request/admission conflicts. Stale Q after response loss requires Q-owned linked renewal/successor/typed recovery and fresh locked reread; other participants cannot extend validity.
- Invalid V2 input may write only a separate rejection receipt: zero basis/Q projection/Research/Intent/family/member/head/outbox writes. Positive formation consumes an opaque validated marker. Final scope→request locked cut rereads basis, Q opaque frontier and complete local lineage. Independent Q role owns tables/sequences/writer; R&D has no ownership/raw SELECT/DML, only exact EXECUTE on the narrow SECURITY DEFINER resolver with safe search_path, fully qualified relations and global lock order. Q Rust alone verifies raw envelopes and privately constructs non-Deserialize positive readback.
- Sample final mutation cut adjacent to first write after all OA/PE/Q locks and final Q reread; revalidate OA, binding/manifest and Q half-open validity, and bind identity/receipt. Lock-wait expiry writes nothing. Original admitted binding without R&D receipt may FirstMutation after an equivalent successor only with exact stored lineage/current authority; new admission needs current ACTIVE head and rejects zero-active.
- R&D/Q/Artifact discovery enumerates all bounded supported rows under custody locks, canonical-decodes/full-verifies before filtering verified predicates. Raw JSON selectors/discriminators/caller predicates never choose what deserves verification. Corrupt/missing/orphan/malformed/ambiguous/stale/unavailable rows cannot be skipped to invent `GENESIS_EMPTY` or a positive head. Q permits exact-basis Resolve only, never absence-based repair. Exact replay reuses original basis/receipts, not caller-recomputed authority.
- S1 terminal verifies complete request receipt/View/family root/member/Census graph. Positive graphs are sealed direct R&D output; public Deserialize/DTO/caller/browser cannot confer authority. Missing prerequisites are unavailable. Verified historical ACCEPTED/family survives linked-view expiry as terminal/stale with all positive actions removed, never receipt-less unknown.
- Compatibility S2 SUCCESS binds Artifact, Build Receipt, Review, family binding receipt and Census frontier in one Owner transaction. Request/attempt resolutions are separate same-identity operations, never replacement dispatch or inferred family. Retained Replay transport needs every selected S2 identity/receipt/binding/locator/availability/currentness field; display booleans never authorize RUN. Missing/mismatched/stale/unavailable yields zero dispatch/business writes. Research pages always have no RUN slot.
- Compatibility prepare/candidate/fail proves Owner-cut AVAILABLE View inside the same locked transaction before attempt/Prepared→Building/terminal transitions. STALE or pre-dispatch UNAVAILABLE writes nothing. `now>=valid_through` removes cached positive actions; Owner-returned STALE allows same-identity resolution only. `SUBMITTED_OR_UNKNOWN` may already have written: exact resolution only, no zero-write/preflight/retry claim; recovered Prepared custody is separate. Pre-lock/request/projection timestamps never authorize writes.
- Owner independently verifies no-Artifact receipt identity/attempt/Intent/disposition-failure mapping/commit time. Every duplicated TrialFamily relation field (identity/ordinal/fact/digest/time) matches canonical bytes. Partial comparisons/mismatch/unreadable custody yield unavailable without green ACCEPTED/AVAILABLE/review. Binding/receipt/family/frontier/outbox verify in one protected locked cut; prior READ COMMITTED snapshots cannot stay positive after another transaction changes custody. Receipt identity covers full meaning including `committed_at`; coordinated timestamp changes must alter identity or reject.
- Public Q exposes only `QUALIFIED / CLOSED_NOT_QUALIFIED`. Internal negative categories, reasons, values, timing, counts, notifications and links never leak. Opaque frontier is not dereferenceable. Expiry/revocation are allowed eligibility facts, never subdivisions of a negative terminal. Qualification failure or unloading never automatically restarts R&D.

**Operations, configuration and fact reads:**

- Legacy Portfolio Cache and Risk command/denial enter only `MigrationDiagnostic` without Owner locator; they satisfy no canonical query/summary/action. Missing Owner-local store/direct resolver keeps Portfolio/Risk unavailable. BFF routes untrusted references to their named source Owner; only durable store/outbox reread and private admitted projection restore positive state. Missing port/byte mismatch/storage outage denies elevation/actions.
- No `DeploymentConfigurationAuthority` is admitted. System/live config/routing/cache/env/Settings are transport/install, never PORT_BOUND. BFF may display redacted opaque references only; absent Owner/fact/lifecycle/typed resolver/reread, return `CONFIG_AUTHORITY_UNRESOLVED / INCOMPLETE_FAIL_CLOSED`. Agreement among config values is not authority.
- UI/MCP share version/schema/capability/Owner route/timeout/recovery-identity/operational-read registry. RunStore, Dispatcher, WorkerLeaseStore, BoundedRunLogStore, ServiceLogGateway and OperationAuditStore expose no Owner payload tables. Channels expose no workspace/deployment/preview/arbitrary-script/database/shell/worker-admin/object-storage/secret-management tools.
- Operation available/archived/unavailable binds one content-addressed compatibility envelope: operation/schema/effects, required services/images, App/script-lock hashes, Owner API/schema, channel/source/cut. Multiple services may compose it, but exact expected/observed sets must match; shared Compose/healthy/similar source is insufficient. Mixed source, missing hashes or mismatch is unavailable. Archived removes dispatch/domain actions while preserving exact historical read-only geometry/identity. Only external version-matched deployment and consumer revalidation restores availability. Dashboard never creates envelopes/archive/restore or infers availability from source/history.

## Packaging and deployment target

The Dashboard ships with the Trade image set as the default visual entry and control surface. It must pin frontend
dependencies; produce a content-addressed artifact; run unprivileged with a read‑only filesystem except explicit
caches; expose process readiness without claiming Owner/trading health; accept endpoints and opaque secret
references at runtime; keep credentials out of images, HTML, bundles, URLs, logs, telemetry, and errors; preserve
separate Owner stores/credentials; and include asset manifest, provenance, compatibility declaration, and route
smoke test.

### Research transport and compatibility boundary

External Agents submit research through domain MCP ports. Dashboard reads the owning services' data,
packages, experiments, results and knowledge. It owns no research submission, authoring, repair workflow,
model build or Agent execution. Governance mutations use separately admitted controls and authority.

Existing `POST /api/rd/source-research`, `POST /api/rd/develop-composer`, and
`POST /api/rd/exploratory-replay` routes and their RunStore bindings are disposable compatibility transports.
Their existence grants no target UI action or native strategy prerequisite. They keep the same allowlisted
bodies, exact identities, current compatibility/routing/permission checks, immutable receipts and effect
boundaries. A fresh compatibility submission requires the unique `ACTIVE / TRADE_DASHBOARD` routing head;
zero, stale, ambiguous, malformed, unavailable or `WINDMILL` observations refuse before Owner calls.

For retained attempts, resolve the exact Owner request first. Persist submission-start before transport;
only the first claim on exact absence may submit. Later claims, restart and response loss are resolve-only,
without a replacement identity or dispatcher reselection. Replay identifies and seals exact canonical bytes
and decimal-string unsigned integers; Composer rechecks the exact Owner projection. Source ancestry must be
canonically readable and policy resolution stays inside its Owner; callers supply no `policy_query`.
Artifact Formation is outside the admitted research route. Unknown started provider work needs authoritative
resolution, not retry. These rules preserve existing custody without requiring a native authoring worker.

Transport migration preserves receipts, identity, permission and parity/recovery evidence before a versioned
routing switch. Exact `RESOLVE` is effect-free. Shared or production Owner writes, providers, trading,
publication and cutover retain their separate explicit authority; this design grants none of them.

## Unattended implementation sequence

Follow the [delivery milestones](../architecture/) and exact route/atom admission. Implement each admitted slice within its documented geometry and bounds; see [admission vocabulary](#status-vocabulary-and-evidence-cut).

V0.1 needs R-1 data/Artifact/run/result readback alongside the domain MCP journey. V0.2 extends research comparison, diagnostics, takeover and knowledge views. V0.3 adds separately admitted Governance trial confirmation, selected templates, promotion/operation and exit monitoring. Composition, dynamic discovery and multi-leg views follow their owning milestones; no later-version form or service is a first-release prerequisite.

A UI dependency is usable only when its canonical producer and typed consumer exist at the candidate revision. Missing inputs render the specified unavailable state, not invented account values, allocation, `PORT_BOUND`, eligibility or current authority. Dependencies are added by the slice that actually consumes the public port; absent seams are implementation work in their Owner, never a Dashboard shadow authority.

Verify each changed slice with its real typed consumer, relevant refusal/unknown/recovery states, route/responsive/accessibility gates and the current repository checks. Domain MCP acceptance does not admit browser implementation, and browser rendering does not prove Owner acceptance or production cutover. Preserve provenance, packaging, migration parity and rollback; publication or production cutover needs its own authority.

## Non-goals and kill conditions

The Dashboard is not a notebook, code IDE, general automation builder, observability backend, data warehouse,
secret manager, business database, broker, exchange terminal, or autonomous trading authority. It does not
recreate every capability of the retired shell.

Implementation stops when it needs a second business writer, direct Owner-table write, hidden protected detail,
fabricated freshness, success without a receipt, broad management tool, unresolved effect, unavailable current
Owner contract, or an unauthorized change to documented authority. Explicit user authorization is required only to widen real-money/production-write or Paper/Live admission, change product purpose/the documented user route, or remove a refusal/seal/bound/invariant. Agents decide other corrections with the measurement forcing them; relocated properties remain provable.
