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

For multi-Mission work, keep one complete replacement checkpoint in the current hub conversation.
Replace it as a whole after any node or evidence change; never append an update that can drop older
facts. Reconcile it with current Goal, native task, Git, and pull-request facts before every effect,
overall completion, or recovery.

Preserve every proposed or approved node still inside the overall completion boundary. For each node
retain only the evidence needed to reconstruct the next legal effect:

- stable session label, Outcome and consumer, Scope and non-goals, and falsifiable Acceptance;
- owner and write surface, direct `after` predecessors, Authority and external effects, and endpoint;
- source ref, observed exact tip, prerequisites, and the checks that revalidate them;
- complete proposed or approved child prompt, approval scope, and create-attempt facts;
- current Stop predicates, pressure evidence, rejected candidates, findings, and resume gate;
- observed `clientThreadId`, `threadId`, and `hostId`, leaving unknown values explicit;
- pull request, candidate head, checks, discovery disposition, conversations, and endpoint gate;
- terminal evidence, including the prior completed Goal observation when replacement is proposed.

When assessment is active, retain one checkpoint-level assessment block outside the per-node list.
It contains either the complete frozen object, rows, baseline scores, maturity, evidence locators,
targets, weight rationales, critical floors, comparison/scenario controls, cost methods, and required
endpoint-bound reassessment, or one exact immutable content locator plus hash covering those fields.
Record assessed node labels once in that block; nodes do not copy the report or its metadata.

The checkpoint is conversation evidence, not Goal prose, repository state, a registry, status model,
queue, ledger, daemon, scheduler, database, retry engine, or lifecycle. Native task tools own task
identity; Git and GitHub own repository facts. Labels create no scheduling policy.

This repository does not provide a runtime Goal, DAG, task-identity, or endpoint enforcer. These
contracts are therefore static and unproved by repository execution; reconcile each live use with
raw Goal, native task, Git, and GitHub facts. A fresh-context trace is adversarial evidence, not a
runtime guarantee, and must not substitute for those owners.

## Dependency and interruption gates

Nodes with a direct `after` edge, the same owner, overlapping write surfaces, or a shared contract
serialize. Parallel preparation requires proven independence across owner, surface, contract,
premise, dependency, and effect; unknown independence returns affected nodes to Plan.

Before admission, test the complete proposed `after` edge set for acyclicity. Any cycle returns the
affected graph to hub Plan and permits zero dispatch until an edge or Outcome changes under evidence;
do not leave every node deferred or add a scheduler, helper, or stored graph to break the cycle.

Also reject any direct `after` edge into a Git-backed node unless every predecessor packet freezes a
`merged` endpoint on that node's declared canonical source. Do not admit an `open` or `merge-ready`
predecessor and later force it to merge.

A downstream node remains serial until every direct predecessor reaches its exact endpoint and its
premises still hold. For a Git-backed downstream node, a direct `after` edge also requires every
predecessor candidate to be merged into its declared canonical source; `open` or `merge-ready` does
not imply merge. Observe the new canonical tip and create the child only from that exact tip. A
non-Git dependent without integrated source may release at the predecessor's exact endpoint.

If a predecessor is cancelled, keep every affected descendant in the replacement checkpoint and
return it to Plan. For each, either cancel under current authority, reconnect to a proven alternative
and revalidate, remain pending for missing Outcome or authority, or prove that the descendant no
longer depends on the cancelled predecessor. That fourth disposition removes only the evidenced
edge, binds the node to its newly observed required source ref and exact tip, and re-admits and
revalidates its Outcome, Acceptance, owner and write conflicts, prerequisites, and endpoint. Call
that source canonical only when it is the node's declared canonical source. Without that complete
evidence, edge removal fails and the node stays in one of the other dispositions. Never silently
delete a required node, erase an edge without evidence, or leave it permanently deferred.

A rejected candidate stays with its existing child and inherited Frame, findings, Stop predicates,
and endpoint. Local corrections remain there; causal pressure follows the main skill inside that
Mission and authorizes no successor, transfer, or Goal replacement. A true block freezes only
dependent descendants.

A new turn, user insertion, compaction, or source drift freezes every unissued effect until a full
checkpoint reconciles. The hub releases one exact merge head at a time. After merge, observe the
canonical tip and revalidate open pull requests on that ref; nodes on other refs require their own
ref/tip observation.

A hub freeze does not pause a running child. Pause, cancel, or reframe only by one authorized message
to the exact child, then reconcile its candidate and dependents. To continue an explicitly paused
child, reconcile the complete checkpoint, authority, identity, candidate, and source, then message
that child once; it re-enters its existing Mission at the stage current facts warrant. This host
continuation creates no Mission and is not the lifecycle's temporary-blocker `Resume` record unless
that separate predicate holds. A priority insertion is a separate request or approved graph node,
never a silent widening or replacement.

One child hosts one Outcome, managed worktree, eventual branch, and at most one pull request. It owns
its candidate and verification; the hub owns admission, checkpoint, monitoring, source observation,
and exact-head release. Messages and root turns create no Mission.

## Critical-path choreography

Use this choreography only when an earlier authorized merge changes a later candidate's source or
dependency input. Independent endpoints whose evidence remains valid across sibling delivery keep
their ordinary parallel path; unknown validity returns ordering to Plan.

Within such an integration wave, independent children may build, exercise real consumers, and freeze
separate recoverable candidates in parallel, but publication remains unmet until the hub grants one
release slot. A Git-backed dependent is not created or prepared until every direct predecessor is
merged; its Origin is the freshly observed canonical tip, never an `open` or `merge-ready` head.

For each slot, the hub observes the canonical ref and tip and messages one exact child. That child
keeps its Mission, reframes and integrates if Origin changed, revalidates affected owner/consumer
evidence, runs the root gate on that final integration candidate, and publishes its one PR. An `open`
endpoint reports that published head immediately. A `merge-ready` or `merged` endpoint first closes
CI, opening discovery, and findings, then reports the exact head. The hub observes the endpoint; for
`merged`, it separately releases the authorized exact-head merge and observes the new canonical tip
before the next slot. `open` or `merge-ready` closes without a manufactured merge and releases only
the next independent slot; dependent descendants still wait for merge.

Before release, candidate-local revisions rerun only affected targeted/consumer evidence. Reuse
requires identical evidence-specific affected inputs, source, dependency, consumer closure,
configuration, toolchain, and environment; track a changed whole-candidate locator separately. A
changed final integration candidate or corrected gate invalidates root and final-head evidence;
counts never decide reruns. The hub classifies staleness but never mirrors child gates, discovery, or
finding disposition.

## Outcomes discovered during a Mission

When Mission evidence reveals another outcome, preserve it without widening the current Frame or
repairing an unrelated defect. In a single-Mission session, retain at most one narrow follow-up
proposal. In an already admitted multi-Mission session, add or revise a node only through the hub's
Plan and re-evaluate direct dependencies and conflicts; do not silently dispatch it. Refactor,
test, documentation, performance, security, removal, and other descriptions use the same admission
contract.

An independent outcome remains proposed while the user edits or withholds approval. Each proposal
has one stable, session-only label such as `G1`, `R1`, or `F1`. Preserve it across edits, but do not
persist labels or interpret their prefixes as a Mission type, priority, lifecycle, route, template,
or dispatch policy. Approval permits one native create attempt for the exact labeled packet.

## Proposal and consent

Every packet declares `ready` or `deferred`. This is a presentation-time fact, not stored workflow
state. Include exact prerequisites, an immutable Origin, and the read-only owner surface or
invocation that can revalidate each state-sensitive fact. A Git-backed `ready` packet requires an
Origin reachable from a repository ref and may not rely on staged, unstaged, or untracked material.
When readiness depends on the latest integrated result, also bind its full canonical source ref and
observed exact tip; Origin must equal that tip. Any unmet prerequisite, unreachable revision,
advanced or mismatched source ref, or dirty-only evidence makes it `deferred`.

Present a short default summary first:

- stable label and `ready | deferred`;
- why the independent outcome matters now;
- Outcome and bounded Scope/non-goals;
- decisive evidence and exact Origin;
- falsifiable Acceptance;
- Authority and external effects.

Retain the complete editable child prompt in the replacement checkpoint with every dispatch field:

- outcome and consumer;
- scope and explicit non-goals;
- authority and required external effects;
- falsifiable acceptance;
- exact Origin, prerequisites, declared source ref/tip when applicable, and revalidation evidence;
- target project and observed native environment selection;
- the exact generic child preflight below;
- the complete initial child prompt, including its five-stage Mission and endpoint.

Freeze the endpoint independently for each node. For a pull-request endpoint, load
[GitHub delivery](github-pr-handoff.md). An `open` or `merge-ready` packet never grants merge. A
`merged` packet still withholds merge until the hub later supplies separately authorized release for
one exact verified head. A no-pull-request endpoint retains its own falsifiable terminal evidence.

End a `ready` packet with the direct question **Create this task?** A `deferred` packet instead ends
with **Create this task? — unavailable until `<exact prerequisite>`**; a reply to that unavailable
question is not creation authority. The user may edit, reject, approve one, or approve several named
ready proposals. An ordinary unambiguous approval after the ready question is the explicit request
required by the task host. Rejection or edits remain in the hub; no task exists yet.

For multiple independent outcomes, present one packet per admitted graph node and preserve the
stable labels so the user can approve a subset or a ready wave. Approval consumes a proposal after
its one native create attempt. Deferred nodes cannot be approved around their prerequisites.

## Generic child preflight

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

After consent:

1. re-run the packet's declared read-only checks against the same owner surfaces and verify every
   prerequisite, decisive fact, exact Origin, and applicable source ref/tip still matches;
2. if any fact drifted, do not create a task; refresh the packet as `deferred` or materially revised,
   preserve its label, and require fresh approval after any material revision;
3. replace the checkpoint with the approved prompt and `create attempt issued` before calling the
   host;
4. call `list_projects` before project-backed creation;
5. resolve the intended saved project and inspect `isGitRepository`;
6. for a Git project, call `create_thread` exactly once for each approved proposal with
   `target.type=project`, the resolved `target.projectId`, and
   `target.environment.type=worktree`;
7. for a non-Git project, use `target.environment.type=local` only when the resolved saved project
   cannot share the foreground candidate; otherwise use capability fallback because the host cannot
   provide the required independent workspace;
8. omit `model`, `thinking`, and `startingState` overrides unless the user explicitly requested them;
9. pass the approved child prompt without silently expanding its outcome or authority;
10. record the host-provided `threadId`/`hostId` or queued `clientThreadId`, then follow the host
   contract to emit its created-task link or directive; never invent a URL.

A returned `clientThreadId` consumes the create attempt but is only its receipt, not a task identity.
Record it, emit the host-required created-task directive, and never pass it to wait, read, or send
operations. Freeze dependent dispatch, release, and endpoint effects until the host or user supplies
an exact immutable `threadId`/`hostId` causally mapped to that receipt. `list_threads` and bounded
`read_thread` may diagnose candidates or ambiguity, but cannot establish or authorize that mapping:
even the first otherwise identical task observed after the receipt could be a concurrent or manual
creation. Until an exact causal mapping arrives, preserve the node as pending identity, keep the
create attempt consumed, and never duplicate it. Pending identity does not by itself block the
Mission; `blocked` still requires the main skill's evidence predicate, including no viable path after
a completed replan when that identity is required for completion. A direct `create_thread` return
containing `threadId` and `hostId` is usable without discovery inference.

An explicit create failure with proof that no task effect occurred also preserves the exact approved
prompt. Retrying requires fresh authority and revalidation; when prior creation may have succeeded,
do not retry. A later `threadId`/`hostId` resumes the node only when the host or user causally maps it
to the recorded attempt. A separately created manual task is not that mapping and requires Plan and
authority before it can own the node.

Creation is non-blocking. Outside an admitted multi-Mission orchestration session, return after
creation without babysitting setup or child commentary. Inside that mode, the hub may use bounded
native monitoring only for the current ready wave or next merge gate. It must use exact `threadId`
and `hostId` facts and must not poll a queued `clientThreadId`.

The child independently owns `Frame → Plan → Execute → Verify → Finalize`, its candidate, branch,
zero-or-one pull request, publication, review closure, and cleanup. In multi-Mission mode its
Finalize stops at its frozen endpoint. In a serialized integration wave it prepares locally until
the hub releases its publication slot; a `merged` endpoint then waits at the merge-ready barrier for
the exact-head merge release. The parent does not run or mirror the child's stages, and the child
does not create or update the hub Goal.

## Child controls

Operate on a child when the user asks, or when an admitted multi-Mission checkpoint names that child
at the current monitoring or merge gate:

- status or one-time monitoring: use one `wait_threads` call with `timeoutMs: 0`;
- ongoing monitoring: use one bounded `wait_threads` event wait for up to eight named children and
  carry every returned cursor into the next wait;
- feedback or continuation: call `send_message_to_thread` once with `threadId`, optional `hostId`,
  and the feedback in `prompt`, then return immediately;
- additional history needed for a current decision: use one bounded `read_thread`.

The child proactively reports only Frame freeze, material replan, required user authority, candidate
publication, terminal state, or an exception; while actively working it still provides concise
user-visible progress under the host's timing contract. The hub does not mirror unchanged commentary
or treat an unchanged timeout snapshot as progress. Events are wake hints: reconcile raw Goal, task,
Git, and GitHub facts before any effect. If a child blocks, apply the replacement checkpoint and
dependency rules; do not retry, replace, or transfer it without new authority.

## Endpoint and overall completion

Compare every node with its own frozen endpoint and evidence owner. A no-pull-request node closes on
its admitted terminal consumer evidence. A pull-request node closes only under the corresponding
`open`, `merge-ready`, or `merged` contract in GitHub delivery. Closed or superseded pull requests,
rejected candidates, pending waits, and blocked nodes remain checkpoint evidence; none silently
satisfies a different endpoint.

Complete the matching overall Goal only after every node still required by its completion boundary
has exact endpoint evidence, every authorized cancellation is explicit, and the final evidence
handoff is retained. Do not force `open` or `merge-ready` nodes to merge, manufacture a pull request
for a no-PR endpoint, or let a child update the Goal. If progress is unavailable, preserve the full
checkpoint and use `blocked` only when the Goal tool contract and the main skill's evidence predicate
both permit it.

When the overall Plan activated an evidence assessment, the hub runs its reassessment only after the
required nodes are terminal. Use one named integrated head only when every assessed node merged into
the same declared canonical source and the observed head contains every candidate; otherwise use the
complete exact terminal candidate-locator set and make no singular integrated-head claim. Use the
exact PR head for `open`/`merge-ready`, or an exact commit, complete
preserved diff, or immutable artifact for local/no-PR endpoints. A low score does not reopen an
accepted child or extend the graph. Preserve each independently valuable gap as a proposal under the
ordinary admission and consent contract; discard unsupported aggregate gaps.

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
- A child Mission's GitHub delivery belongs to its own Finalize.

Use `fork_thread`, `handoff_thread`, archival, pinning, and renaming only under their separate current
host contracts. They are not substitutes for proposal-to-`create_thread` dispatch.
