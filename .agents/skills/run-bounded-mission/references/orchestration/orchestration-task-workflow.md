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

Reconcile `get_goal`, the request, and the complete replacement checkpoint before every Goal-driven
effect; missing restatement does not remove approved work. In multi-Mission mode:

- no Goal retains the proposal and freezes child, publication, and merge-release effects; only
  explicit overall-Goal authority permits one `create_goal`, followed by a matching observation;
- an ordinary task never reopens or replaces a completed Goal; an explicitly authorized different
  Goal preserves old terminal evidence, uses one replacement `create_goal`, then is observed again;
  never use `update_goal` for reopening or replacement;
- paused or blocked follows the host Goal contract and preserves causal Stop; never overwrite a
  nonmatching unfinished Goal. If persistence is declined, reframe Goal-unbound current-thread work.

The Goal holds only overall Outcome, constraints, and completion boundary. Nodes, identities,
candidates, findings, Stop, and GitHub facts stay in their existing owners. `update_goal` only marks
the matching overall Goal terminal when permitted; Goal use adds no wrapper, retry, ledger, CLI,
lifecycle, or hidden execution.

## Hub replacement checkpoint

Load the shared [Mission replacement checkpoint](orchestration-context-recovery.md) and extend it with
every in-boundary proposed or approved node. Per node retain only the current release slice; approved
prompt and consent/create facts; pressure, findings, rejected candidates, and resume gate; exact task
identities or receipt with unknowns explicit; and pull-request/candidate/terminal facts needed for the
next endpoint effect.

Keep assessment data once at checkpoint level, or bind one immutable locator and hash; never copy it
into nodes. Native tasks own identity, Git and GitHub own repository facts, and labels add no Mission
type or policy. The coherence-window rule below owns replacement timing.

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

Before admission, test the complete proposed `after` edge set for acyclicity. Any cycle returns the
affected graph to hub Plan and permits zero dispatch until an edge or Outcome changes under evidence;
do not leave every node deferred or add a scheduler, helper, or stored graph to break the cycle.

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
candidate. The hub sees only a decision-changing freeze or terminal locator, never lanes or counts.

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
repairing an unrelated defect. In a single-Mission session, retain at most one narrow follow-up
proposal. In an already admitted multi-Mission session, add or revise a node only through the hub's
Plan and re-evaluate direct dependencies and conflicts; do not silently dispatch it. Refactor,
test, documentation, performance, security, removal, and other descriptions use the same admission
contract.

An independent outcome remains proposed while the user edits or withholds approval. Its packet owns
one stable label matching `[A-Z]+-[0-9]{2}` and one title formed exactly as
`<label> · <short description>`. Preserve both across edits and recovery. They identify the user-visible
task only; never interpret the label as a Mission type, priority, lifecycle, route, or scheduling
policy. Keep a packet `deferred` until its frozen label and title satisfy that exact relation. Approval
permits one native create attempt for that exact packet.

## Proposal and consent

Every packet declares the presentation-time fact `ready` or `deferred`, exact prerequisites, immutable
Origin, and the read-only owner surface that revalidates state-sensitive facts. Git-backed `ready`
requires a ref-reachable Origin and no dirty-only evidence. When readiness needs the latest integrated
result, bind its canonical source ref and observed tip and require Origin to equal it; any unmet
prerequisite, unreachable revision, or advanced/mismatched ref makes the packet `deferred`. Final-
release readiness always binds that source ref and observed tip immediately before its one create
attempt and requires Origin equality; a changed or mismatched tip defers creation and every early
slice. Post-merge reconciliation is a release gate for the same child, not a new Origin or consent.

Present a short default summary first: stable label and exact title, `ready | deferred`, why it
matters now, Outcome and scope/non-goals, decisive evidence and Origin, Acceptance, and authority or
external effects.

Retain the complete editable child prompt in the checkpoint. Quote current Frame and Plan projections
with raw evidence locators, never the transcript; keep the raw request or child-accessible locator
canonical. Include label/title, prerequisites/source/revalidation, project/environment, the preflight
below, and remaining five-stage/endpoint instructions.

Freeze one approved endpoint per node. A `merged` node derives child `merge-ready`, freezes hub merge
authority/effect, and follows Critical-path choreography; this projection is no new Goal endpoint.
Pull-request endpoints load [GitHub delivery](../delivery/delivery-pullrequest-workflow.md), and `open`
or `merge-ready` never grants merge. A no-PR endpoint keeps its falsifiable terminal evidence.

End `ready` with **Create this task?** and `deferred` with **Create this task? — unavailable until
`<exact prerequisite>`**. A reply to the latter is no authority. The user may edit, reject, or approve
named ready proposals; unambiguous approval after the ready question is the host-required request.
Until then, edits and rejection stay in the hub and no task exists.

For multiple outcomes, present one stable-labeled packet per node so the user can approve a subset or
ready wave. Its one create attempt consumes approval; deferred nodes cannot bypass prerequisites.

## Generic child preflight

Freeze the exact title and observed create-naming branch into the child prompt. If `create_thread`
exposed `title`, pass it once and record creation as the pre-Frame title effect. Otherwise the prompt's
first instruction—before commentary, Frame, `get_goal`, reads, Git, or other work—calls current-task
`set_thread_title` with only that title and requires the returned calling `threadId` plus exact title.
Missing, contradictory, unavailable, failed, or mismatched branch evidence stops before Mission work.
The setter may repeat after recovery only when prior success cannot be reconstructed and never maps a
`clientThreadId` to task identity.

Derive preflight from current owner manifests and lockfile. Name exact repository path/HEAD/status,
executables, and dependency-directory existence/symlink/ignore/status facts. A final-release child
also receives frozen Origin and reports its exact child-worktree HEAD before substantive work for the
hub-owned equality gate above. Before substantive work, the child calls and reports `get_goal` and
never creates or updates the hub Goal.

If tools are absent, authorize at most one manifest/lock-supported, exact non-interactive bootstrap.
Exclude credentials, relevant secrets, environment files, lifecycle scripts, and live effects. Record
exit/time and prove generated dependencies ignored and outside status; without a safe deterministic
command, stop before substantive read/mutation and report the missing dependency.

A null or absent native environment path proves only that no environment selection was carried. A
repository environment file, dependency directory, or available executable does not prove that
native setup ran.

## Native dispatch

After consent, revalidate every packet fact and source tip; drift makes it `deferred` or materially
revised and requires fresh approval. Mark the create attempt issued, call `list_projects`, and inspect
the selected project's `isGitRepository`. Call `create_thread` once with the approved prompt and the
observed project/worktree target for Git, or local only for an observed non-Git project that cannot
share the foreground candidate. Omit `startingState` and model overrides unless approved. Record only
the returned exact identity or receipt and emit the host's task link/directive.

Keep the host default model for a user-visible Mission unless its packet explicitly authorizes a
different full-Mission model. Spark's leaf gates cannot own the child's five stages, so never select
it for this route or create a user-visible task for an internal build/revision leaf. Route the latter
through the custom `fast_builder` agent and its standard-main fallback.

The packet remains the naming owner. Follow its frozen branch above, never invent a field or perform a
routine post-create rename. Once an exact `threadId`/`hostId` is causally known, read only that task
and require the exact title plus any final-release preflight HEAD report before release; unavailable
or mismatched readback freezes identity-dependent effects, and list or search cannot repair it.

A returned `clientThreadId` consumes creation but is only a receipt: record/emit it, never rename or
pass it to wait/read/send, and freeze identity effects until the host or user causally maps an exact
`threadId`/`hostId`. List/search resemblance cannot prove that mapping. Then verify the title before
monitoring/release; pending identity permits no duplicate and is not Mission `blocked`.

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
- ongoing monitoring: use one bounded `wait_threads` event wait for up to eight named children and
  carry every returned cursor into the next wait;
- feedback or continuation: call `send_message_to_thread` once with `threadId`, optional `hostId`,
  and the feedback in `prompt`, then return immediately;
- additional history needed for a current decision: use one bounded `read_thread`.

The child proactively reports only material replan, required user authority, endpoint-changing
publication, terminal handoff/state, or an exception. Ordinary progress stays there; the hub does not
mirror commentary, lanes, counts, or unchanged timeouts.

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

At the window, reconcile exact Goal, task, Git, GitHub, dependency, and authority facts once; arbitrate
terminal conflicts by those owners; perform at most one stage-wide global judgment inside that
reconciliation; derive one hub position and next operation; and emit one complete checkpoint. Only
after that checkpoint may the hub issue a question/message or release an independent next stage or
declared effect. A dependent release, endpoint judgment, or other effect may not precede the
checkpoint. One receipt never resets the wave, starts a dependent, or triggers a global pass. A
blocked child is not retried, replaced, or transferred without new authority.

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
