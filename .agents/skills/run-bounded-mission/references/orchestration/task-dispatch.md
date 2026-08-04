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

Load the shared [Mission replacement checkpoint](mission-checkpoint.md). The hub owns its
multi-Mission projection and reconciliation; extend the shared shape with every proposed or approved
node still inside the overall completion boundary. For each node retain only the evidence needed to
reconstruct the next legal effect:

- current release-slice delta;
- complete proposed or approved child prompt, approval scope, and create-attempt facts;
- pressure evidence, rejected candidates, findings, and resume gate;
- observed `clientThreadId`, `threadId`, and `hostId`, leaving unknown values explicit;
- pull request, candidate head, checks, discovery disposition, conversations, and endpoint gate;
- terminal evidence, including the prior completed Goal observation when replacement is proposed.

When assessment is active, retain one checkpoint-level frozen baseline/reassessment block, or one
exact immutable locator and hash that covers it. Record assessed labels once; nodes do not copy it.
Native tasks own identity; Git and GitHub own repository facts. Labels add no Mission type or
scheduling policy.

## Dependency and interruption gates

Nodes without a direct `after` edge keep their whole-Mission parallel path when owner, surface,
contract, premise, dependency, and effect are independent. The same owner, overlapping write
surfaces, a shared contract, or unknown independence serializes the nodes.

Before admission, test the complete proposed `after` edge set for acyclicity. Any cycle returns the
affected graph to hub Plan and permits zero dispatch until an edge or Outcome changes under evidence;
do not leave every node deferred or add a scheduler, helper, or stored graph to break the cycle.

Every cross-node prerequisite that can block task creation, publication, or merge must be an existing
direct `after` edge in that cycle check; a release slice cannot hide another graph. Reject an edge
into a Git-backed node unless every predecessor packet freezes `merged` on its declared canonical
source. Do not admit `open` or `merge-ready` and later force it to merge.

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
effect.

A hub freeze does not pause a child. Pause, cancel, or reframe only by one authorized message to its
exact identity. Continue it only after reconciling checkpoint, authority, identity, candidate, and
source, then message once. This host continuation creates no Mission or lifecycle `Resume`. A priority
insertion is a separate request or approved node, never silent widening or replacement.

One child hosts one Outcome, managed worktree, eventual branch, and at most one pull request. It owns
its candidate and verification; the hub owns admission, checkpoint, monitoring, source observation,
and merge effects. Neither mirrors the other's stages or lanes. Messages and root turns create no
Mission.

## Critical-path choreography

Use this protocol only when an earlier endpoint changes a later source or input; independent paths
keep their ordinary parallel route.

For an existing `after` edge, the hub may prepare reusable read-only evidence before the predecessor
closes only when owner, surface, contract, and inputs are independent and the dependency affects later
work. It creates no child, consent, or effect. A slice keeps only input or prerequisite, owner and
write surface, next effect, freeze, release and invalidation predicates, and output locator; derive
node facts and retain the locator after consumption.

After the shared recovery gate, keep only affected or unknown-impact slices frozen. Once Git
predecessors merge, observe the canonical tip, revalidate affected evidence, bind a new `ready` packet
to that Origin, and ask **Create this task?**; only fresh approval creates the child. A non-Git
dependent may release at its predecessor's endpoint. Invalidate only evidence with a changed source,
dependency, base, merge-tree, or declared input.

Inside one child, independent exact-candidate discovery, evaluation, CI, and security work may fan
out. Its finding owner validates fan-in, stales affected output, and binds the root gate to the final
candidate. The hub sees only a decision-changing freeze or terminal locator, never lanes or counts.

A `merged` node derives child delivery as `merge-ready`; child Finalize accepts only at that exact-
candidate barrier and sends one terminal handoff. Hub Finalize reconciles once, without repeating
candidate, root, or full-review acceptance: matching Goal and checkpoint authority, the unique
repository and canonical-ref merge effect, exact head and base, unresolved conversations, required
final-head and provider signals, mergeability, and queue policy.

If those facts match the handoff and [GitHub delivery](../delivery/github-pr-handoff.md), the hub makes the
separately authorized guarded exact-head merge in that turn without a release message. Hub-owned
metadata or authority drift freezes only the effect. Candidate, head, base, merge-tree, finding,
check, or other affected-input drift stales the handoff; after checkpoint reconciliation, one message
returns the same child to Verify or Plan for a replacement. It grants no rebase, reset, or merge
authority. Queue or auto behavior follows GitHub delivery, needs separate authority, and remains
pending rather than direct-merge evidence. After GitHub reports the exact head merged, record
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

Every packet declares `ready` or `deferred`. This is a presentation-time fact, not stored workflow
state. Include exact prerequisites, an immutable Origin, and the read-only owner surface or
invocation that can revalidate each state-sensitive fact. A Git-backed `ready` packet requires an
Origin reachable from a repository ref and may not rely on staged, unstaged, or untracked material.
When readiness depends on the latest integrated result, also bind its full canonical source ref and
observed exact tip; Origin must equal that tip. Any unmet prerequisite, unreachable revision,
advanced or mismatched source ref, or dirty-only evidence makes it `deferred`.

Present a short default summary first:

- stable label, exact task title, and `ready | deferred`;
- why the independent outcome matters now;
- Outcome and bounded Scope/non-goals;
- decisive evidence and exact Origin;
- falsifiable Acceptance;
- Authority and external effects.

Retain the complete editable child prompt in the replacement checkpoint. For cross-task dispatch,
quote the active Frame projection and any current Plan projection with exact raw evidence locators,
never the full transcript. Keep the raw request or a child-accessible exact request locator canonical.
Also retain:

- stable label and exact task title;
- exact prerequisites, declared source ref and tip, and revalidation evidence not already projected;
- target project and observed native environment selection;
- the exact generic child preflight below;
- the remaining instructions required to run its five-stage Mission and frozen endpoint.

Freeze one user-approved endpoint for each node. For a `merged` node, derive `merge-ready` for child
delivery; this owner projection is not another Goal endpoint. Its packet freezes hub merge authority
and effect and follows Critical-path choreography. For any pull-request endpoint, load
[GitHub delivery](../delivery/github-pr-handoff.md); `open` or `merge-ready` never grants merge. A no-pull-request
endpoint retains its own falsifiable terminal evidence.

End a `ready` packet with the direct question **Create this task?** A `deferred` packet instead ends
with **Create this task? — unavailable until `<exact prerequisite>`**; a reply to that unavailable
question is not creation authority. The user may edit, reject, approve one, or approve several named
ready proposals. An ordinary unambiguous approval after the ready question is the explicit request
required by the task host. Rejection or edits remain in the hub; no task exists yet.

For multiple independent outcomes, present one packet per admitted graph node and preserve the
stable labels so the user can approve a subset or a ready wave. Approval consumes a proposal after
its one native create attempt. Deferred nodes cannot be approved around their prerequisites.

## Generic child preflight

Freeze the packet's exact title and the caller's observed create-naming branch into the child prompt's
first instruction. When the calling `create_thread` schema did not expose `title`, before commentary,
Frame, `get_goal`, file reads, Git, or any other task work, require the child to call the current-task
`set_thread_title` with `threadId` omitted and only that frozen title. Continue only when its native
result returns the calling `threadId` and exact title; unavailable capability, failure, or mismatch
stops before Mission work and reports that evidence. The same exact-value, current-task-only call is
idempotent and may repeat after recovery only when its earlier success cannot be reconstructed. It
never maps a hub's `clientThreadId` receipt to that `threadId`.

When that caller schema exposed `title` and the caller recorded passing the frozen title in the one
create attempt, creation is the pre-Frame title effect: the child does not require or perform a
redundant setter call. Missing or contradictory branch evidence stops before Mission work. This does
not replace the hub's exact-identity readback before release.

Derive the child preflight from current repository owner manifests and lockfile before dispatch. The
packet names exact observations for repository path, HEAD and status, required executables, and the
dependency directory's existence, symlink, ignore, and repository-status facts. It requires the
child to call `get_goal` before substantive repository work, report the observation, and never create
or update the hub Goal.

If required tools are absent, authorize at most one exact non-interactive locked bootstrap command
supported by the current manifest and lockfile. Exclude credential acquisition, relevant secret
variables, environment-file loading, lifecycle scripts, and live or production effects. Record its
exit code and elapsed time, then prove generated dependencies remain ignored, uncommitted, and
outside repository status. If no safe deterministic command can be derived, stop before substantive
read or mutation and report the missing dependency.

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

The packet's label and title remain the only naming owner. Inspect the calling `create_thread` schema
for that attempt: when it exposes `title`, pass the frozen exact title in the one create call and
record the atomic-create branch; when it does not, pass no invented field, record the self-title
branch, and rely on the child's first instruction above. The latter cannot prevent a transient
automatic host title, but it permits no Mission work under that title. In either branch, the hub
never performs a routine post-create rename. Once an exact `threadId`/`hostId` is causally known, read
only that task and accept its title only on an exact match before release. A mismatch or unavailable
exact read freezes identity-dependent effects; list or search cannot repair it.

A returned `clientThreadId` consumes the create attempt but is only a receipt. Record and emit it;
never rename it or pass it to wait, read, or send. Freeze identity-dependent effects until the host
or user causally maps it to an exact `threadId`/`hostId`; list/search resemblance cannot prove that
mapping. Then perform the pending exact-title verification before monitoring or release. Preserve
pending identity without duplicate creation; it is not itself a Mission `blocked` predicate.

On recovery, a previously recorded exact `threadId`/`hostId` resumes that task without creation. An
existing task with the same title but no causal mapping is only resemblance: never adopt, rename, or
message it. Before an attempt it does not consume the approved create; after an attempt may have
succeeded, it cannot authorize a retry. Compaction changes neither rule.

An explicit create failure with proof that no task effect occurred also preserves the exact approved
prompt. Retrying requires fresh authority and revalidation; when prior creation may have succeeded,
do not retry. A later `threadId`/`hostId` resumes the node only when the host or user causally maps it
to the recorded attempt. A separately created manual task is not that mapping and requires Plan and
authority before it can own the node.

Creation is non-blocking. Outside an admitted multi-Mission orchestration session, return after
creation without babysitting setup or child commentary. Inside that mode, the hub may use bounded
native monitoring only for the current ready wave or next merge gate. It must use exact `threadId`
and `hostId` facts and must not poll a queued `clientThreadId`.

The child owns its five stages through the delivery endpoint and never changes the hub Goal. A
`merged` node uses the derived `merge-ready` handoff; hub Finalize follows Critical-path choreography.

## Child controls

Operate on a child when the user asks, or when an admitted multi-Mission checkpoint names that child
at the current monitoring or merge gate:

- status or one-time monitoring: use one `wait_threads` call with `timeoutMs: 0`;
- ongoing monitoring: use one bounded `wait_threads` event wait for up to eight named children and
  carry every returned cursor into the next wait;
- feedback or continuation: call `send_message_to_thread` once with `threadId`, optional `hostId`,
  and the feedback in `prompt`, then return immediately;
- additional history needed for a current decision: use one bounded `read_thread`.

The child proactively reports only material replan, required user authority, publication when it
changes the endpoint gate, terminal handoff or state, or an exception; ordinary progress stays in its
own task. The hub does not mirror unchanged commentary or timeouts. Events are wake hints: reconcile
raw Goal, task, Git, and GitHub facts before effects. A blocked child is not retried, replaced, or
transferred without new authority.

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
