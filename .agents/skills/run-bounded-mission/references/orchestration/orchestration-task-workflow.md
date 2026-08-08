# Codex Task Dispatch

Load this reference only for the session modes selected by `SKILL.md`: routing or creating an
independent outcome, operating an existing child, or investigating one separately valuable
follow-up. Lifecycle and orchestration authority remain in `SKILL.md`. This file projects that
authority onto current Codex task tools without adding durable state, a queue, ledger, daemon,
scheduler service, database, background automation, generic DAG helper, second CLI, or second
lifecycle.

## Mission admission and mode

Classify each requested result against the same consumer boundary. An independent Mission must have:

- an Outcome valuable to a named real consumer;
- bounded Scope and non-goals;
- Acceptance that can independently falsify its result;
- an independent owner, write surface, and delivery boundary;
- a disposition that can be independently accepted, blocked, or cancelled.

Diagnosis, testing, documentation synchronization, review corrections, coupled producer/consumer
changes for one consumer behavior, and researcher, planner, evaluator, or other support roles remain
internal subtasks and receive no separate child task or pull request. Foreground continuation,
correction, review, status, or feedback also stays with its Mission. Repeating, renaming, resuming,
or moving the same unresolved gap is continuation of the existing Mission and inherits its Origin,
Stop, findings, and rejected candidates.

Task creation requires the user's explicit request or approval of every exact ready packet.

## Goal boundary

Before every Goal-driven effect, observe whether the current host exposes each required Goal tool.
When `get_goal` is exposed, reconcile its result, the request, and the complete replacement checkpoint;
missing restatement does not remove approved work. The tool surface is session-local evidence: a
prior call, checkpoint, static contract, or another session cannot establish current capability. In
multi-Mission mode:

- no Goal retains the proposal and freezes child, publication, and merge-release effects; only
  explicit overall-Goal authority permits one `create_goal`, followed by a matching observation;
- an ordinary task never reopens or replaces a completed Goal; an explicitly authorized different
  Goal preserves old terminal evidence, uses one replacement `create_goal`, then is observed again;
  never use `update_goal` for reopening or replacement;
- paused or blocked follows the host Goal contract and preserves causal Stop; never overwrite a
  nonmatching unfinished Goal. If persistence is declined, reframe Goal-unbound current-thread work.

When `get_goal` is not exposed, record `Goal capability: unavailable; persistence: none` with the
observed tool-surface locator in the current Frame/checkpoint. Proposals and their complete prompts may
remain visible in the existing conversation checkpoint, but child dispatch, dependency release,
publication, merge-release, and every Goal effect stay frozen. Do not call an absent tool, synthesize a
Goal or DAG, treat the checkpoint as Goal persistence, or describe informal foreground sequencing as
Goal-backed orchestration. A zero- or single-Mission foreground path may continue only when it needs no
Goal effect and is explicitly projected as Goal-unbound.

The Goal holds only overall Outcome, constraints, and completion boundary. Nodes, identities,
candidates, findings, Stop, and GitHub facts stay in their existing owners. `update_goal` only marks
the matching overall Goal terminal when permitted; Goal use adds no wrapper, retry, ledger, CLI,
lifecycle, or hidden execution.

## Hub replacement checkpoint

Load the shared [Mission replacement checkpoint](orchestration-context-recovery.md) and extend it with
every in-boundary proposed or approved node. Per node retain only the current release slice; approved
prompt and consent/create facts; pressure, findings, rejected candidates, and resume gate; exact task
identities or receipt with unknowns explicit; and pull-request/candidate/terminal facts needed for the
next endpoint effect. Retain each admitted relation with its evidence locator and affected slice, plus
the current component snapshot that groups those nodes. Never omit a superseded, interrupted, blocked,
or identity-pending node merely because it has no runnable slice.

Set checkpoint mode to `hub`. Bind each user-visible route/slice to `native_task` and its next-owner edge,
and each support slice separately to `internal_support`; never collapse or overwrite mixed bindings.
Retain activated paths with candidate-independent locators and every approved route's disposition plus
next owner or terminal locator. Agent routing may serve a support slice without changing its node into a
sub-agent. Missing, duplicate, conflicting, or unbound bindings freeze the slice and dependents.

For every proposed, attempted, or created node retain one causal collision projection from its exact
stable label/title, Outcome and consumer, owner/write surface, and endpoint. Bind its canonical UTF-8
length and SHA-256 in the existing packet/checkpoint; exclude changing Origin, Plan, candidate, status,
and evidence so ordinary continuation cannot mint another identity. The projection is a pre-create
comparison key, not task identity, a counter, registry, or stored index. Exact `threadId`/`hostId`
remains the only created-task identity.

Keep assessment data once at checkpoint level, or bind one immutable locator and hash; never copy it
into nodes. Native tasks own identity, Git and GitHub own repository facts, and canonical task type is
non-authorizing metadata from [task type classification](orchestration-task-types.md), not lifecycle,
priority, route, or policy. The coherence-window rule below owns replacement timing.

## Architecture-wave evidence graph

Build the current wave from approved node packets and authoritative observations; do not persist a
graph or infer one from labels, receipt order, task titles, elapsed time, or message count. Admit only
these relation kinds:

- `blocks(predecessor, successor)`: name the exact prerequisite evidence and immutable locator, the
  successor slice that consumes it, and the observation that releases that slice. Freeze only that
  consuming slice and any canonical-ref final slice whose identity depends on it. The successor may
  continue hub-proven disjoint Frame, Plan, Execute, and nonidentity checks.
- `superseded_by(leaf, architecture_node)`: bind the admitted architecture Outcome and the owner,
  write-surface, contract, or consumer evidence proving that the leaf would be absorbed or overwritten.
  Do not create an uncreated leaf. Preserve any existing child identity, candidate, findings, endpoint,
  and terminal facts; stopping or cancelling it still requires current authority and one message to
  its exact identity. Revalidate the leaf instead when absorption is unproved.
- `revalidate_after(node, evidence)`: bind one exact head, authority digest, consumer contract, or
  component snapshot, the affected node slice, and its revalidation oracle. Independent earlier work
  may continue, but the affected slice cannot release from age, a label, or predecessor completion
  alone; it consumes the newly observed evidence and invalidates only changed inputs.

An unknown kind, missing endpoint, mutable or unavailable locator, unbounded affected slice, or hidden
release predicate is unknown-impact and fails closed. A packet's `after` list is only the task-dispatch
projection of admitted `blocks` and dependency-bearing `revalidate_after` relations; it is not a fourth
relation or separate authority. Include every projected edge in the cycle and release checks below.

Project one compact Hub graph from the current checkpoint and authoritative observations; never store
or update it as another state owner. For each node show its exact identity and only the non-empty
members of `waiting`, `runnable`, `running`, `frozen`, `needs_attention`, and `terminal`. These members
are independently derived slices rather than one exclusive lifecycle enum, so a child may have
running work while other named slices remain frozen. Bind every runnable, running, or frozen slice to
its owner and evidence locator; bind each freeze to its reason and release observation. Preserve a
native blocked reason and completed reason/result plus their raw locator instead of flattening them
into a label. `terminal` is exclusive only after the node's frozen endpoint owner reports terminal
evidence; delivery `merge-ready` remains a child handoff rather than a merged-node terminal.

Classify a slice as `waiting` only while an admitted declared observation is pending without an
authority gap; as `runnable` after its release predicate is observed and before its owner starts; as
`running` only from current native owner evidence; and as `frozen` whenever an exact barrier holds it.
A node may therefore expose several of those members at once. Render one compact line per node in the
fixed order above, with slice names and locator-bound reasons/results, and omit empty members; this is
a projection convention, not a schema or state machine.

Before choosing a monitoring target, discussion focus, spare-capacity lane, or other scheduling slice,
reopen every waiting slice's exact blocker and release-predicate locator once and rebuild the compact
graph. A changed predicate moves that slice to `runnable` and its recorded next owner/action before the
Hub follows an unrelated active task. Focus changes, ordinary discussion, an idle child, or a terminal
local candidate cannot remove, postpone, or hide that edge. Recovery only after a user reminder is a
functional task-loss signal, not evidence that the original release executed.

Derive `needs_attention` only from a structural or user-authority gap, a real exception, or
unknown-impact evidence that needs Hub arbitration. Ordinary progress, elapsed time, commentary,
tool activity, a pending provider, or an unchanged wait is not attention. Preserve any unknown native
status and raw representation, mark the affected slices `frozen` plus `needs_attention`, and close the
coherence window for authoritative reconciliation. The projection may be printed or carried in the
replacement checkpoint, but it authorizes no dispatch, release, retry, acceptance, or effect.

Before dispatch, derive causal pressure edges from current evidence that one node invalidates another's
owner, write surface, contract, premise, candidate, or canonical-ref slice. Group nodes only when that
closure is stable for the current immutable component snapshot. Fan in each stable component's impact
once. If the pressure graph has a non-trivial strongly connected component with multiple members or
an explicit self-loop, freeze further member patching and return the whole component to hub Plan for
one component Mission with one Outcome, owner, write set,
Acceptance, Origin, and endpoint. Preserve every prior node and identity as source evidence; do not
sequence the cycle as `A → B → C → A`, transfer a candidate, or create the component without ordinary
proposal and consent. Recompute the release DAG after component admission and require it to be acyclic.

## Dependency and interruption gates

Nodes without a direct `after` edge keep their whole-Mission parallel path when owner, surface,
contract, premise, dependency, and effect are independent. The same owner, overlapping write
surfaces, a shared contract, or unknown independence serializes the nodes.

Independent nodes in one repository may still Frame, Plan, Execute, and run affected checks that do
not bind the canonical ref in parallel. When two endpoints require merge to the same strict canonical
ref, admit a direct `after` edge that orders only dependency-consuming work and the successor's
identity-bound final-Verify/publication release slice. It does not delay approved child creation or
hub-proven disjoint Frame, Plan, Execute, and nonidentity checks. Every predecessor packet must declare
the `merged` endpoint on its canonical source; actual observed `MERGED` is the later release predicate,
and `open`, `merge-ready`, unknown, or mismatched endpoints fail closed. Only the one explicit next
successor may run final candidate audit, final root gate, publication, manual discovery, delivery
barrier, or merge effect. If no direct edge selects one successor, freeze every same-ref final slice
and return the ordering to hub Plan. Do not record a slot, queue, timer, or other lifecycle state.

Before admission, test the complete projected `after` edge set for acyclicity after any pressure SCC
has converged. Any remaining cycle returns the affected graph to hub Plan and permits zero dispatch
until a relation, component Outcome, or evidence locator changes; do not leave every node deferred or
add a scheduler, helper, stored graph, or arbitrary edge direction to break the cycle.

Every cross-node prerequisite that can block task creation, publication, or merge must be an existing
direct `after` edge in that cycle check; a release slice cannot hide another graph. Reject every other
edge into a Git-backed node unless all predecessor packets declare `merged` on their canonical source,
and never admit `open` or `merge-ready` and later force it to merge.

If a predecessor is cancelled, retain affected descendants and return them to Plan. Each is cancelled
under current authority, reconnected and revalidated, left pending for missing Outcome or authority,
or proven independent. Removing the edge requires a newly observed source ref and tip plus re-admitted
Outcome, Acceptance, owner and write conflicts, prerequisites, and endpoint; call the source canonical
only when declared. Otherwise the edge remains. Never silently delete or indefinitely defer a node.

A rejected candidate stays with its existing child and inherited Frame, findings, Stop predicates,
and endpoint. Local corrections remain there; causal pressure follows the main skill inside that
Mission and authorizes no successor, transfer, or Goal replacement. A true block freezes only
dependent descendants.

After the shared recovery gate releases the hub, apply the slice contract below before another
effect. A hub freeze does not pause a child. Pause, cancel, reframe, or continue it only by one
authorized message to its exact identity after checkpoint, authority, candidate, and source
reconciliation. That continuation creates no Mission or lifecycle `Resume`; a priority insertion is
a separate request or approved node.

One child hosts one Outcome, managed worktree, eventual branch, and at most one pull request. It owns
its candidate and verification; the hub owns admission, checkpoint, monitoring, source observation,
and merge effects. Neither mirrors the other's stages or lanes. Messages and root turns create no
Mission.

## Critical-path choreography

Use this protocol only when an earlier endpoint changes a later source or input; independent paths
keep their ordinary parallel route.

For an ordinary dependency edge, the hub may release only bounded read-only preparation through
[agent lane routing](orchestration-agent-routing.md) before the predecessor closes when immutable
inputs plus owner, surface, contract, and writes are disjoint. It creates no Mission, consent, or
external effect; every dependency-consuming write or effect stays frozen at that barrier.

For the identity-bound final-release edge above, an already approved packet may create its one
successor child once through Native dispatch before the predecessor closes only after binding the
canonical source ref and its observed tip immediately before that attempt and requiring immutable
Origin to equal the tip. Its preflight below reports the exact child-worktree HEAD before substantive
work. Before any early slice releases, the hub freshly observes the canonical source-ref tip and
requires both that tip and the child HEAD to equal frozen Origin. Missing, unavailable, advanced, or
mismatched evidence freezes every early, dependency-consuming, and final slice and returns the same
child to Plan without replacement, duplicate creation, new consent, or integration. Release only hub-
proven disjoint Frame, Plan, Execute, and nonidentity checks; dependency-consuming work and the
identity-bound final slice stay frozen. After
[GitHub delivery](../delivery/delivery-pullrequest-workflow.md) reports the verified exact predecessor
head `MERGED`, close the coherence window, observe the latest canonical tip, recover the exact child
identity in its same worktree, integrate or rebase once, and revalidate affected evidence before
releasing those slices. Identity mismatch, conflict, changed input, or lost independence returns that
same child to Plan. Once that integration is consumed, any later drift, changed input, identity
mismatch, conflict, or lost independence also returns the same child to Plan without another
integration; never replace it or create a duplicate.

Only an ordinary dependent ineligible for that early creation waits for predecessor merge, canonical-
tip observation, a new `ready` packet, and fresh approval before creation. A non-Git dependent may
release at its predecessor's endpoint. Invalidate only evidence with a changed source, dependency,
base, merge-tree, or declared input.

Inside one child, independent exact-candidate discovery, evaluation, CI, and security work may fan
out. Its finding owner validates fan-in, stales affected output, and binds the root gate to the final
candidate. It owns all five stages and ordinary local correction through its endpoint. The hub sees
only Goal/DAG/authority/locator/effect/terminal facts, a component impact that changes those facts, a
structural or user-authority gap, or a terminal locator; never child stages, lanes, local findings,
correction turns, or counts.

A `merged` node derives child delivery as `merge-ready`; child Finalize accepts only at that exact-
candidate barrier and sends one terminal handoff. Hub Finalize reconciles once, without repeating
candidate, root, or full-review acceptance: matching Goal and checkpoint authority, the unique
repository and canonical-ref merge effect, exact head and base, unresolved conversations, required
final-head and provider signals, mergeability, and queue policy.

If those facts match the handoff and [GitHub delivery](../delivery/delivery-pullrequest-workflow.md), the hub makes the
separately authorized guarded exact-head merge in that turn without a release message. Hub-owned
metadata or authority drift freezes only the effect. Candidate, head, base, merge-tree, finding,
check, or other affected-input drift stales the handoff; after checkpoint reconciliation, one message
returns the same child to Plan. It grants no second integration or rebase, reset, replacement child,
or merge authority. Queue or auto behavior follows GitHub delivery, needs separate authority, and
remains pending rather than direct-merge evidence. After GitHub reports the exact head merged, record
`MERGED`, candidate head, merge commit, and canonical tip; dependents wait for that observation.
Later hygiene belongs to a separately approved Mission.

## Outcomes discovered during a Mission

When Mission evidence reveals another outcome, preserve it without widening the current Frame or
repairing an unrelated defect. Once a diagnosis satisfies the independent-Mission admission threshold,
give it one checkpoint disposition before the current turn boundary: add a proposed or approved node
to the existing hub inventory and re-evaluate direct dependencies and conflicts; bind `deduplicated`
to one exact existing node and equivalent Outcome; or bind `rejected` to explicit user authority. In a
single-Mission session, the checkpoint may retain at most one narrow `proposed - Goal persistence
unavailable` follow-up and must freeze its dispatch and current-Mission Finalize until the user routes,
deduplicates, or rejects it. A diagnosis in commentary, a future-work promise, or an unlocated note is
not a disposition and may not disappear at compaction. Do not silently dispatch it. Refactor, test,
documentation, performance, security, removal, and other descriptions use the same admission contract.

An independent outcome remains proposed while the user edits or withholds approval. Before assigning
its label, load [task type classification](orchestration-task-types.md) and classify exactly one
canonical owner domain from Outcome, consumer, owner, and Acceptance. Missing, ambiguous, unknown, or
stale classification keeps the packet `deferred` and returns the decision to main; never mint a code
from wording or a legacy prefix.

The packet owns one stable label matching `[A-Z]{3}-[0-9]{2}` and one title formed exactly as
`<label> · <short description>`. Its code must be a current canonical member and its number must be
`01` through `99`. Close the numbering scope over the current mode's authoritative dispatch set. In
`single`, that set is the one follow-up packet retained by the current foreground Mission plus its
causally bound approval, create attempt, receipt, and exact live identity facts; that Mission's current
effecting turn is the sole dispatcher, with no Goal, DAG, Hub checkpoint, or Hub-wave binding. In `hub`,
the set is the complete current proposed/approved Goal/DAG-node inventory plus every bound attempt,
receipt, and exact live identity fact in the Hub checkpoint; the packet binds the one exact Hub
dispatcher. Unknown or mixed mode freezes creation. The packet owner assigns the lowest unused display
serial in that closed scope within the canonical code; different codes each begin at `01`.
Freeze it across edits, consent, creation, recovery, and continuation of that causally identical
Mission. A same-code collision in the current dispatch set, exhausted range, missing node, missing or duplicate
attempt/receipt, or unresolved relevant live identity defers only the affected assignment or release to
main. `threadId`/`hostId`, never title or serial, owns native identity. The serial is display metadata:
never derive identity, priority, order, dependency, or retry count from it and never add a counter
service. Historical or unrelated titles remain exact immutable facts but neither reserve a serial nor
prove a mapping; recovery never renames or backfills them.

Write the short description and user-visible packet commentary in the inherited
`interaction_language`; preserve the ASCII code, identifiers, commands, schemas, and raw evidence in
their original form.

Preserve the exact label, title, compact canonical type projection, and type-authority locator across
edits and recovery. The type is a metadata hook only and cannot select priority, lifecycle, route,
lane, model, reasoning effort, dependency, verdict, or scheduling policy. Keep a packet `deferred`
until all frozen facts satisfy that exact relation. Approval permits one native create attempt for
that exact packet.

## Proposal and consent

Every packet declares the presentation-time fact `ready` or `deferred`, exact prerequisites, immutable
Origin, and the read-only owner surface that revalidates state-sensitive facts. Git-backed `ready`
requires a ref-reachable Origin and no dirty-only evidence. When readiness needs the latest integrated
result, bind its canonical source ref and observed tip and require Origin to equal it; any unmet
prerequisite, unreachable revision, or advanced/mismatched ref makes the packet `deferred`. Final-
release readiness always binds that source ref and observed tip immediately before its one create
attempt and requires Origin equality; a changed or mismatched tip defers creation and every early
slice. Post-merge reconciliation is a release gate for the same child, not a new Origin or consent.

Present a short default summary first: canonical task type, stable label and exact title, `ready | deferred`, why it
matters now, Outcome and scope/non-goals, decisive evidence and Origin, Acceptance, and authority or
external effects.

Before presenting a packet as `ready`, observe and bind the current native Task-control contracts that
the packet will consume: `list_threads`, `create_thread`, `send_message_to_thread`, exact-target
`set_thread_title`, and dispatcher exact-identity/title readback. The one executable branch is
dispatcher-held: a fresh task receives only the fixed inert bootstrap until `create_thread` returns an
exact `threadId`/`hostId`; a continuation reopens its already recorded exact identity. In either case
the dispatcher sets and reads back the exact title before it sends the complete packet once to that
exact target. The native message effect is the authority-bearing release. Do not require a pre-model
verifier, child access to raw prompt bytes, a child-owned title setter, or another release message.
Any generated or normalized create-time title is provisional transport metadata.
Freeze that capability branch, exact call shapes, one mode-scoped
dispatcher authority, its serialized single-effecting-turn guarantee, and the closed authoritative
dispatch-set predicate into the editable packet. For `single`, bind the current Mission's causal
approval and current effecting turn; for `hub`, bind the exact Hub dispatcher and current wave. Missing,
ambiguous, concurrent, or non-targetable admission, title, or exact-target message controls keep the packet
`deferred` or `host-defect/no-change`; a later contract or branch change is a material packet revision
and requires the complete packet to be presented and approved again.

Retain the complete editable child prompt in the checkpoint. Quote current Frame and Plan projections
with raw evidence locators, never the transcript; keep the raw request or child-accessible locator
canonical. Include label/title, prerequisites/source/revalidation, project/environment, the preflight
below, and remaining five-stage/endpoint instructions. Carry the current user-inherited
`interaction_language` as an ordinary prompt fact: child-visible commentary and Finalize use it while
code, commands, schemas, identifiers, and raw evidence keep their original form. Only an explicit user
change replaces it; task creation, a later turn, Handoff, or compaction never re-infers it from prompt
content, locale, or recent messages.

Before approval and again immediately before creation, freeze one complete canonical UTF-8 payload
containing the exact title and label; interaction language; current Frame and admitted Plan; raw request
or immutable locator; Origin, dependency edges and release predicates; authority and prohibited
effects; preconditions and their executable producer/setup; selected `single | hub` mode; freshly
observed Goal-tool availability and persistence; observed or honestly unavailable model/effort; exact
owner inputs and evidence locators; endpoint; Stop; and one next legal action. Record its byte length
and `sha256:<lowercase-64-hex>` outside the payload. This identity lets the dispatcher revalidate the
approved producer object and recover the exact packet; it makes no claim about model-visible transport
bytes. The payload, target branch, and approval form one packet; changing any member invalidates
approval. Native Task title remains packet identity metadata and never becomes a Conventional pull-
request title.

The fixed fresh-task bootstrap contains no payload bytes, encoding, length, hash, label, title, role,
Frame, Plan, source locator, or next action. It only tells the task to perform no semantic, Goal,
repository, Skill, title, or other substantive action until a later native user message arrives, and
may request the fixed generic notice below. After exact identity and title readback, the dispatcher
sends the complete approved payload directly in one `send_message_to_thread` call. A continuation has
no bootstrap: after exact-identity recovery and the same title gate, its one complete native message is
the release. A prefix, summary, truncation, reconstruction, or later semantic addendum is not a packet.

Freeze one approved endpoint per node. A `merged` node derives child `merge-ready`, freezes hub merge
authority/effect, and follows Critical-path choreography; this projection is no new Goal endpoint.
Pull-request endpoints load [GitHub delivery](../delivery/delivery-pullrequest-workflow.md), and `open`
or `merge-ready` never grants merge. A no-PR endpoint keeps its falsifiable terminal evidence.

End `ready` with **Create this task?** and `deferred` with **Create this task? - unavailable until
`<exact prerequisite>`**. A reply to the latter is no authority. The user may edit, reject, or approve
named ready proposals; unambiguous approval after the ready question is the host-required request.
Until then, edits and rejection stay in the hub and no task exists.

For multiple outcomes, present one stable-labeled packet per node so the user can approve a subset or
ready wave. Its one create attempt consumes approval; deferred nodes cannot bypass prerequisites.

## Native host admission

The dispatcher, not the child, owns packet admission. Before the authority-bearing message effect it
revalidates the frozen producer identity, approval, Origin and release predicates, closed dispatch set,
exact target, and exact-title readback. Missing or changed packet members, stale authority or Origin,
an unresolved, conflicting, wrong-bound, or already-released attempt for the same causal collision
projection, or a proposed later supplement rejects before `send_message_to_thread`. The one fresh-create
receipt causally bound to this packet is its required exact-identity mapping, not a duplicate attempt; it
can reach the title gate and first semantic send only while the closed dispatch set still records zero
release effects. The exact host call and its receipt, together with the title readback, are the admission
evidence. The receipt proves the targeted message effect; it does not prove raw bytes inside model
context, and no delivery claim may say otherwise.

A fresh task may emit at most one fixed generic notice in response to the inert bootstrap. Its bytes
are fixed independently of the payload; it cannot name or reveal the label, title, role, Frame, Plan,
source, or next action, grant authority, call a tool, or claim admission. Mission commentary, Frame,
`get_goal`, Skill or role loading, repository reads, Git, and payload work begin only when the complete
packet arrives as the one native release message after exact identity and title gating. The child does
not emit an admission receipt and does not run a raw-message verifier. Any semantic action before that
release is `packet-admission-defect/no-change` for the route.

An already-created exact task may receive a newly authorized, complete continuation
packet without becoming a replacement task. Preserve every earlier failed packet as terminal; the new
packet is neither a supplement nor a repair. When a current host contract requires the dispatcher to
sets and reads back the packet's exact title before sending the continuation; that readback is the
canonical identity gate for this release. The dispatcher then sends the complete packet once to the
same `threadId`/`hostId`; the call receipt admits it and no post-admission setter or second release is
permitted. Missing, contradictory, unavailable, failed, or mismatched task identity, title, packet,
single-dispatcher, or host-message evidence freezes the continuation as `host-defect/no-change`. Do not
add a lock, registry, verifier helper, wrapper, retry, or second lifecycle.

Derive preflight from current owner manifests and lockfile. Name exact repository path/HEAD/status,
executables, and dependency-directory existence/symlink/ignore/status facts. A final-release child
also receives frozen Origin and reports its exact child-worktree HEAD before substantive work for the
hub-owned equality gate above. Before substantive work, the child observes the current Goal-tool
surface. It calls and reports `get_goal` when exposed; otherwise it reports `Goal capability:
unavailable; persistence: none` and continues only as its ordinary single Mission. It never creates or
updates the hub Goal.

If tools are absent, authorize at most one manifest/lock-supported, exact non-interactive bootstrap.
Exclude credentials, relevant secrets, environment files, lifecycle scripts, and live effects. Record
exit/time and prove generated dependencies ignored and outside status; without a safe deterministic
command, stop before substantive read/mutation and report the missing dependency.

A null or absent native environment path proves only that no environment selection was carried. A
repository environment file, dependency directory, or available executable does not prove that
native setup ran.

### Long-running gate evidence

Before launching a command/process-backed root, package, or other long-running gate, bind its exact
candidate and inputs, argv, cwd, relevant environment, final repository-state check, and one host
transport that can yield a resumable process/session identity, retain stdout/stderr through a host
receipt or immutable output locator, and eventually return its exit status. A launch that discards
both output streams is not terminal-capable because a failure cannot be audited. If the selected call
cannot preserve its identity and output continuity through bounded output or time windows, the gate is
not runnable on that transport. Do not first run it through a lossy call and then start the same
command again to recover a missing terminal result or failure detail.

An internal semantic evaluator is not a command/process-backed gate. The reviewer handoff instead
binds its exact frozen candidate, complete Frame and Plan, one risk lens, required evidence, neutral
control, exact host evaluator identity, and ordinary launch receipt. Retain a host cursor and its
structured progress receipt only when that host actually returns them. The handoff's minimum structured
return plus Main's before/after candidate observation, validation, and reproduction close terminal
integrity. Preserve and resume only that same evaluator identity. Do not require a packet identity,
`result_classes`, process argv, cwd, stdout/stderr, or an OS exit from this route, and do not weaken its
one-launch, no-repacket, no-replacement, or narration limits merely because its progress and terminal
transport are structured.

Launch the candidate-bound gate once. When a command/process-backed gate yields, retain its exact
session and output cursor and resume only that process until it returns exit plus the declared final
state. When an internal semantic evaluator yields with a host cursor, retain that cursor and resume only
the same evaluator identity; an ordinary one-shot structured return requires no cursor. A missing,
reset, unrecoverable, or mismatched required identity, session, returned cursor, output receipt,
structured return, or Main reproduction makes the required terminal evidence `unavailable`; it does
not authorize a second process or evaluator, a reconstructed exit, or success inferred from
disappearance.
A rerun is a new gate only after a changed candidate or other declared input invalidates the prior run,
or after new authority explicitly replaces the unavailable evidence requirement.

User-visible gate narration is transition-bound. Emit nothing for unchanged waits. For one gate run,
emit at most one informative progress update after an observed state transition and exactly one terminal
update after exit and final-state observation; the terminal update binds both. Raw command output may
stream through the host receipt, but repeated waiting, elapsed-time, partial-suite, or unchanged-process
narration is not progress evidence and cannot consume another commentary update.

## Native dispatch

Immediately before a native create attempt, project the exact currently runnable slice as the only
pre-dispatch routing input: immutable inputs, owner, exact paths, oracle, Stop, critical-path relation,
and permitted effect. When [agent routing](orchestration-agent-routing.md) plus its
[execution policy](../execution/execution-mission-routing-policy.md) has an activated consumer, invoke
that owner once and consume its exact five-part `Pre-dispatch routing receipt`: `Input` must bind the
same runnable slice and quality floor; `Route` supplies lane plus observed or unavailable model and
effort; `Topology` binds the supplied dependency shape; `Fallback` names its authorized trigger or
none; and `Evidence` supplies maturity, terminal quality, telemetry availability, and
coordination/correction limits. Missing, malformed, stale, unknown, or mismatched input, section, or
owned value freezes that slice and returns the route question to the same routing owner. Task dispatch
does not flatten, enumerate, or reproduce those domains. The receipt cannot change Frame, Plan, the
DAG, write ownership, user-visible Mission model authority, or task consent; it does not define a
route table. Ordinary route telemetry stays with the child and is fanned into the Hub only in its
terminal receipt unless it proves a real exception or structural gap.

Pre-admit the complete packet and every producer-to-consumer edge before issuing the create effect.
For a prerequisite or setup side effect, either name an ordered executable producer owned by the
packet or require the deterministic producer to perform it; prose-only filesystem, environment, or
transport prerequisites reject. For each inter-step dependency, bind the producer's exact raw output
bytes, length, and SHA-256 to the exact consumer stdin or file and preserve order. A dynamic producer
may publish its identity at runtime, but the edge and required identity fields must exist before launch.
The fresh inert bootstrap is the sole exception because it carries no packet member or authority; the
complete packet still arrives in one later native message after the host returns exact identity. Do not
start semantic work and then supply a missing edge, authority member, locator, Frame slice, or control
fingerprint. A packet/admission defect after this preflight returns that packet to its owner and stops
candidate delivery; do not churn through supplements or replacement tasks. A later continuation on the
same exact task is legal only with new explicit authority, a complete newly bound packet, and preserved
terminal evidence for the failed packet.

Immediately before each create, close the mode-scoped authoritative dispatch set from the current
packet/checkpoint and its causally bound attempts and receipts, not from title inventory. For every
already-bound `threadId`/`hostId` relevant to the proposed node or an owner/write collision, perform one
exact-identity readback; an unavailable or mismatched read freezes only the affected create. Then call
`list_threads` once within the host's bounded limit as a collision observation. Its result may add an
observed relevant live fact, but absence from that bounded result proves neither absence nor completeness
and is never a missing-member error; do not paginate, repeat, or wait for a larger inventory. Explicit
truncation, saturation, or another completeness gap freezes only a decision that actually depends on an
unobserved result. A missing/duplicate authoritative member, attempt, receipt or exact identity,
overlapping writer, unresolved same-node attempt, or drift revises only the affected packet and requires
fresh approval. A `clientThreadId` blocks a second create for its node; unrelated or same-title results
cannot join the dispatch set. Revalidate remaining facts, source tip, the mode-scoped dispatcher, and the
host guarantee that only one effecting turn for that dispatcher can issue the node's create. Any second
creator binding, concurrent effecting turn, or unavailable serialization guarantee returns
`host-defect/no-change` before create. This is a pre-create gate, not identity mapping, global-history
scan, host-wide lock, or polling.

Compare the packet's causal collision projection with every current authoritative-set member before
the create effect. An exact match maps to that member's existing attempt or exact task and permits no
second create. The same stable label/title with a different projection, or a matching projection with
multiple attempts/identities, is a collision and fails closed before effect. A bounded list/search
resemblance cannot prove the match; when the authoritative member or exact identity is unavailable,
preserve the packet and stop rather than create a sibling duplicate.

Reobserve the approved Task-control contracts. Any schema, targetability, mode-scoped dispatch set, or
admission/title/continuation branch drift materially revises the packet and requires fresh approval
before an attempt. Complete all read-only preconditions first: call `list_projects`,
inspect the selected project's `isGitRepository`, and recheck the mode-scoped dispatcher/serialized-turn gate.
Then call `create_thread` once with only the fixed inert bootstrap. Pass the frozen title only as
provisional transport metadata when the host requires a create-time value; it cannot satisfy the
exact-target title gate. Use the observed project/worktree target
for Git, or local only for an observed non-Git project that cannot share the foreground candidate. Omit
`startingState` and model overrides unless approved. The raw host create call/result is the attempt
record; never mark it issued before the call. Record only the returned exact identity or receipt and emit
the host's task link/directive. Bind that receipt in the checkpoint to the exact title, owner, and write
surface. It is causal conversation evidence, not a host-wide lock; creation is runnable only because the
single-dispatcher binding and observed host serialization excluded a second authorized creator first.

Keep the host default model for a user-visible Mission unless its packet explicitly authorizes a
different full-Mission model. Spark's leaf gates cannot own the child's five stages, so never select
it for this route or create a user-visible task for an internal build/revision leaf. Route the latter
through the custom `fast_builder` agent and its standard-main fallback.

The packet remains the naming owner; never invent a field. After a fresh create returns an exact
identity, the dispatcher performs the exact-target title setter once, reads the title and identity back,
and sends the complete packet once. An exact-identity continuation performs the same title gate and
single complete send without another create. The native send receipt is the release; no child receipt,
post-admission setter, or second message may complete it. Require any final-release HEAD report in the
packet before monitoring dependent work. Failure or mismatch freezes those actions; provisional titles,
child prose, and list/search resemblance cannot repair them, and later recovery permits no duplicate
packet release.

A returned `clientThreadId` consumes creation but is only a dispatcher receipt: record/emit it, never
rename or pass it to wait/read/send. The bootstrap remains admission-only and Mission work stays frozen
while that mapping is pending. Dispatcher title, monitoring, and release effects stay frozen until the
host, user, or exact child receipt causally maps a `threadId`/`hostId`; list/search resemblance cannot
prove that mapping. Then complete the exact-target title gate and single packet send. Pending dispatcher
identity permits no title gate or packet send, no duplicate, and is not Mission `blocked`.

Recovery resumes only a recorded exact `threadId`/`hostId`. An unmapped same-title task is resemblance:
never adopt, rename, or message it. Before an attempt it consumes no approval; after possible success
it authorizes no retry. Compaction changes neither rule.

An explicit no-effect create failure preserves the prompt but retry needs fresh authority and
revalidation; possible success forbids retry. A later identity resumes only through causal mapping to
that attempt. A separate manual task is not that mapping and needs Plan and authority to own the node.

Creation is non-blocking. Outside an admitted multi-Mission orchestration session, return after
creation without babysitting setup or child commentary. Inside that mode, the hub may use bounded
native monitoring only for the current ready wave or next merge gate. It must use exact `threadId`
and `hostId` facts and must not poll a queued `clientThreadId`.

The child owns its five stages through the delivery endpoint and never changes the hub Goal. A
`merged` node uses the derived `merge-ready` handoff; hub Finalize follows Critical-path choreography.

## Coherence windows and child controls

Operate on a child when the user asks, or when an admitted multi-Mission checkpoint names that child
at the current monitoring or merge gate:

- status or one-time monitoring: use one `wait_threads` call with `timeoutMs: 0`;
- ongoing monitoring: within one Hub scheduling slice, make at most one bounded `wait_threads` event
  wait for one to eight exact `threadId`/`hostId` targets and retain every returned target cursor. An
  actionable or terminal event closes the current coherence window for reconciliation. A timeout or
  snapshot with no actionable or terminal event ends and yields the scheduling slice immediately;
  do not resubscribe in that slice, keep it open as `running`, or narrate the unchanged state;
- later Goal continuation or a real health anomaly: make one compact cursor-bound read of the same
  exact targets, then act on an actionable or terminal event or yield again;
- explicitly authorized ordinary feedback: call `send_message_to_thread` once with `threadId`, optional
  `hostId`, and the non-authorizing feedback in `prompt`, then return immediately. Feedback cannot carry
  a Task packet, change or complete admission, supplement or repair an earlier packet, or release
  semantic continuation work;
- newly authorized Task continuation: do not use the feedback control. Route the complete packet only
  through Native host admission, including exact-identity recovery, exact-target title set/readback,
  closed dispatch-set revalidation, and its one semantic send;
- additional history needed for a current decision: use one bounded `read_thread`.

The child proactively reports only a structural authority gap, a real exception, or one terminal
receipt. Ordinary progress, local findings/corrections, publication steps, lanes, counts, commentary,
and tool activity stay there. An unchanged timeout produces zero Hub question, message, immediate
resubscription, or status narration; retain its cursor in conversation evidence without emitting a
checkpoint replacement solely for that unchanged observation. After yielding, spare capacity may
route only to another currently runnable DAG node or the already-approved read-only self-QA
retrospective below. It never holds the critical path open, invents work, or creates a background
monitor.

Dynamic acceptance uses the observed Hub refutation rather than compact-output size alone. Baseline A
repeated cursor-bound 60-second `wait_threads` timeouts while PERF and SKR had no actionable event;
although every call was event-based and compact, immediate resubscription made the sequence polling
and produced user-visible idle churn. Candidate B permits one coherence-window event wait in the
current scheduling slice and then yields; a later continuation or anomaly permits one compact cursor
read and must again act or yield. Any immediate no-event resubscription or unchanged narration fails
this acceptance condition.

Treat task events as compact wake hints, never arrival-ordered authority. Across cursor-bound waits in
the current released wave, retain every raw receipt and immutable locator. Normalize every
unrecognized, unclassifiable, malformed, or newly introduced receipt or status as unknown-impact;
preserve its raw representation and locator, close the window immediately, and freeze affected
questions, releases, judgments, and effects until authoritative reconciliation. Close that in-turn
coherence window at the first of:

- all tasks in the released stage reaching terminal evidence;
- an attention, error, conflict, or unknown-impact fact requiring hub authority;
- a dependency, publication, merge, or other declared effect barrier; or
- a turn/interruption/Handoff/compaction, source or authority drift, or user request/override.

An absent cursor is valid only for a target's first observation. A missing returned cursor, reset
cursor, malformed cursor, target/host mismatch, revision regression, or other continuity gap on a
continued target cannot prove that no event was lost: preserve the raw poll, close the window as
unknown-impact, and rebuild authority. A wake may return before every target is polled, so omitted
targets retain their prior facts but cannot be judged unchanged. Commentary and ordinary tool
progress may change a revision or appear in a timeout snapshot, but neither wakes the event wait nor
changes graph authority.

At the window, rebuild the current evidence graph, group its stable components, and reconcile exact
Goal, task, Git, GitHub, dependency, and authority facts once for the whole released wave. Arbitrate
terminal conflicts by those owners, fan in each component impact once, perform at most one stage-wide
global judgment, derive one hub position and next operation, and emit one complete checkpoint. Only
after that checkpoint may the hub issue a question/message or release an independent next stage or
declared effect. A dependent release, endpoint judgment, or other effect may not precede the
checkpoint. One receipt never resets the wave, starts a dependent, or triggers a global pass.

Multiple tasks or candidates with the same causal collision projection, overlapping Outcome/consumer,
or contradictory evaluator and direct-consumer evidence belong to one component conflict. Freeze
acceptance and every dependent release until Main reopens and reproduces the smallest decisive root
consumer fact, then records each candidate or task as exactly `accepted`, `rejected`, or
`superseded_by(<exact member>)` with its evidence locator. Evaluator status, `no_finding` count, task
recency, diff size, or Hub preference cannot select the winner. Preserve conflicting evidence and
unavailable reproduction honestly; no disposition means the component remains frozen.

Treat coordination as useful only when a new observation changes an admitted relation, component,
candidate validity, release predicate, authority, effect barrier, or terminal judgment. Low-information
messages alone are harmless; churn is evidenced when the same causal root repeatedly invalidates work
without changing one of those decisions. Route that pressure to the owning child or component Plan,
not another Hub round trip. A blocked child is not retried, replaced, or transferred without new
authority.

## Spare-capacity self-QA retrospective

This is a conditional read-only evidence lane, not standing work. Admit it only when the current hub
has no runnable critical-path slice - including task creation, dependency release, or dependency-
consuming work - no publication, merge, or other effect barrier needing attention, and an otherwise
unused support-agent slot. A pending wait alone does not prove spare capacity. Do not reserve a slot,
delay task creation or release, or wait for retrospective fan-in after critical-path work becomes
runnable.

Load [agent lane routing](orchestration-agent-routing.md). Assign one ordinary read-only support agent
to one exact existing task. It creates no task, file, branch, candidate, comment, or other effect and
receives no repair, acceptance, QA-classification, or hub authority. Start with that task's terminal
receipt, latest replacement checkpoint, and exception or anomaly locators. If they expose no concrete
consequence, return `no-signal` at the finite branch Stop; inspect deeper task, Git, or GitHub history
only for one signal that can change later classification or owner routing. Never default to a full
transcript scan.

Return one compact raw brief with the decisive evidence and consequence, observed or unavailable
cost, candidate causal root and owner, and branch Stop. A concrete return activates the kernel's
conditional lifecycle-QA route; QA then owns `systemic` or `incidental` classification, causal
fingerprint, canonical repair-owner routing, tracking, and dynamic acceptance, and may retain a
delete-first suggestion as advisory evidence. The routed owner alone selects and implements the actual
repair shape. The hub validates locators, groups matching fingerprints with the current component
once, and fans in one batch at the next natural checkpoint. It does not create one node per finding or
make a retrospective result a prerequisite for unaffected critical-path work. Incomplete, late,
malformed, or unavailable evidence remains fail-closed for its claim and cannot freeze an otherwise
supported release.

## Endpoint and overall completion

Compare every node with its own frozen endpoint and evidence owner. A no-pull-request node closes on
its admitted terminal consumer evidence. A derived child delivery endpoint is child evidence, not node
closure. A pull-request node closes only under the corresponding `open`, `merge-ready`, or `merged`
contract in GitHub delivery. Closed or superseded pull requests, rejected candidates, pending waits,
and blocked nodes remain checkpoint evidence; none silently satisfies a different endpoint.

Complete the matching overall Goal only after every node still required by its completion boundary
has exact endpoint evidence, every authorized cancellation is explicit, and the final evidence
handoff is retained. Do not force `open` or `merge-ready` nodes to merge, manufacture a pull request
for a no-PR endpoint, or let a child update the Goal. If progress is unavailable, preserve the full
checkpoint and use `blocked` only when the Goal tool contract and the main skill's evidence predicate
both permit it.

When assessment is active, the hub follows its conditional reference after required nodes are
terminal. Scores do not reopen a child or extend the graph; only an independently admitted gap may
become a new proposal.

## Capability fallback

If any Goal capability required by the selected mode is unavailable, report the exact unavailable
tool and affected effects before dispatch. Preserve the packets in the current replacement checkpoint
as conversation evidence, mark Goal persistence `none`, and freeze every Goal/DAG claim plus child,
dependency-release, publication, and merge-release effect. A supported Goal-unbound single Mission may
continue in the foreground; multi-Mission work stays proposal-only until a later session freshly
observes and reconciles the required Goal capability. This is an observable degradation, not a
substitute Goal or persisted scheduler.

If the native task host is unavailable or creation fails, preserve the approved packet and report
the exact missing capability or failure. Offer the complete prompt for manual task creation. The
independent outcome remains undispatched, but the foreground Mission is not blocked merely because
the hub cannot create a child.

Do not serialize the outcome in the current worktree, create another branch or pull request there,
hide it in a subagent, or claim a task identity that the host did not return. Host unavailability
never authorizes an automatic retry, replacement, duplicate create, or host transfer.

## Handoff boundaries

- Parent hub routing creates or operates a separate child identity.
- Codex chat Handoff moves the same chat and git state between Local and Worktree; it does not create
  a new Mission or deliver a candidate.

Use `fork_thread`, `handoff_thread`, archival, pinning, and renaming only under their separate current
host contracts. They are not substitutes for proposal-to-`create_thread` dispatch.
