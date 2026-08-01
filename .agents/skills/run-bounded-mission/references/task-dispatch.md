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

Mode and Goal selection remain in `SKILL.md`. Task creation still requires the user's explicit
request or approval of every exact ready packet.

## Hub replacement checkpoint

For multi-Mission work, keep one complete replacement checkpoint in the current hub conversation.
Replace it as a whole after any admission, approval, create attempt, identity observation, candidate
result, dependency ruling, source change, or endpoint observation; never append a partial update
that can drop an older node. Before every dispatch, monitoring, continuation, publication, merge
release, completion, or recovery effect, reconcile it with the current Goal, native task facts, and
Git or pull-request facts.

Preserve every proposed or approved node still inside the overall completion boundary. For each node
retain only the evidence needed to reconstruct the next legal effect:

- stable session label, Outcome and real consumer, Scope and non-goals, and falsifiable Acceptance;
- owner and write surface, direct `after` predecessors, Authority and external effects, and the
  exact endpoint;
- source ref, observed exact tip, prerequisites, and the checks that revalidate them;
- the complete proposed or approved child prompt, approval scope, and create-attempt facts;
- finite Stop, consumed attempts or backward routes, rejected candidates, findings, and resume gate;
- observed `clientThreadId`, `threadId`, and `hostId`, leaving unknown values explicit;
- pull request, exact candidate head, checks, discovery disposition, conversation state, and next
  endpoint gate when applicable;
- terminal acceptance, cancellation, block, or other evidence that changes the overall boundary.

The checkpoint is conversation evidence, not Goal prose, repository state, a task registry, status
model, queue, ledger, daemon, scheduler, database, retry engine, or second lifecycle. Native task
tools remain authoritative for task identity; Git and GitHub remain authoritative for source,
candidate, and pull-request facts. Do not assign priority or infer scheduling policy from labels.

## Dependency and interruption gates

Nodes with a direct `after` edge, the same owner, overlapping write surfaces, or a shared contract
serialize. Only a ready wave with provably independent owners, write surfaces, contracts, premises,
dependencies, and external effects may prepare in parallel. Unknown overlap or premise independence
returns the affected nodes to the hub's Plan.

A downstream node is released only after every direct predecessor reaches its own exact frozen
endpoint and the downstream premises still hold. If the downstream consumes integrated source, its
dependency must require and verify that integrated source; an `open` or `merge-ready` predecessor
does not imply a merge. Create a dependent child only from the newly observed source tip required by
that dependency.

If a predecessor is cancelled, keep every affected descendant in the replacement checkpoint and
return it to Plan. Re-admit exactly one evidence-backed disposition for each: cancel it under the
current Outcome and authority, reconnect it to a proven alternative predecessor and revalidate its
premises, or keep it pending because required Outcome or authority is missing. Never silently delete
an in-boundary node, erase an edge without replacement evidence, or leave the branch permanently
deferred.

A rejected candidate stays with its existing child and inherited Frame, Stop, findings, and endpoint;
continue only through that Mission's legal backward route. Stop exhaustion preserves the rejected
candidate evidence and returns affected descendants to Plan. An external wait or true block keeps
the node pending and freezes only descendants whose premises depend on it. None of these states
authorizes a replacement task, automatic retry, or host transfer.

A new turn, user insertion, compaction, or source drift freezes every unissued effect until a full
replacement checkpoint reconciles again. Parallel pull requests may prepare, but the hub releases
at most one exact head for merge. After a merge, fetch and observe the canonical tip and revalidate
every other open pull request bound to that source ref before another release. Nodes on another ref
remain unchanged only after their own ref and tip are observed.

One child task hosts one independent Outcome. A Git-backed child owns one managed worktree, one
eventual branch, and at most one pull request. The child owns its Mission candidate and verification;
the hub owns admission, checkpoint replacement, bounded monitoring, source observation, and exact-
head merge release. Messages and root turns do not create additional Missions.

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

Derive the child preflight from the current repository owner manifests and lockfile before dispatch.
The packet names exact observations for repository path, HEAD and status, required executables, and
the dependency directory's existence, symlink, ignore, and repository-status facts. It also requires
the child to call `get_goal` before substantive repository work, report the observed value, and never
create or update the hub Goal.

If required tools are absent, authorize at most one exact non-interactive locked bootstrap command
that current manifest and lockfile evidence support. Exclude credential acquisition, relevant secret
variables, environment-file loading, lifecycle scripts, and live or production effects. Record its
exit code and elapsed time, then prove generated dependencies remain ignored, uncommitted, and
outside repository status. If no safe deterministic command can be derived, stop before substantive
read or mutation and report the missing dependency.

A null or absent native environment path proves only that no environment selection was carried. A
repository environment file, an existing dependency directory, or available executables do not by
themselves prove that native setup ran.

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

A returned `clientThreadId` consumes the create attempt but is not a task identity and must never be
passed to wait, read, or send operations. At the next identity-dependent gate, perform one bounded
reconciliation: call `list_threads` once, then use bounded `read_thread` evidence to match the exact
approved prompt, project, source, and worktree. Record a mapping only when exactly one `threadId` and
`hostId` match. A missing or ambiguous mapping preserves the approved packet and freezes the
identity-dependent effect; it never authorizes another create attempt.

An explicit create failure with proof that no task effect occurred also preserves the exact approved
prompt. Retrying requires fresh authority and revalidation; when prior creation may have succeeded,
do not retry. Host-provided exact identity or user-owned manual creation can resume the same node
without inventing an identity.

Creation is non-blocking. Outside an admitted multi-Mission orchestration session, return after
creation without babysitting setup or child commentary. Inside that mode, the hub may use bounded
native monitoring only for the current ready wave or next merge gate. It must use exact `threadId`
and `hostId` facts and must not poll a queued `clientThreadId`.

The child independently owns `Frame → Plan → Execute → Verify → Finalize`, its candidate, branch,
zero-or-one pull request, publication, review closure, and cleanup. In multi-Mission mode its
Finalize stops at its frozen endpoint, except that `merged` waits at the merge-ready barrier until
the hub supplies the exact-head merge release. The parent does not run or mirror the child's stages,
and the child does not create or update the hub Goal.

## Child controls

Operate on a child when the user asks, or when an admitted multi-Mission checkpoint names that child
at the current monitoring or merge gate:

- status or one-time monitoring: use one `wait_threads` call with `timeoutMs: 0`;
- status for up to eight named children: use one bounded snapshot with all targets;
- feedback or continuation: call `send_message_to_thread` once with `threadId`, optional `hostId`,
  and the feedback in `prompt`, then return immediately;
- additional history needed for the request: use a bounded `read_thread`.

Use returned cursors for later snapshots when available. Commentary is never a reason to poll. If a
child blocks, apply the replacement checkpoint and dependency rules; do not retry, replace, or
transfer it without new authority.

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
checkpoint and use `blocked` only when the current Goal tool contract permits it.

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
