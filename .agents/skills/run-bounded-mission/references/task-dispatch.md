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
changes for one behavior, and support roles remain internal and receive no separate task or pull
request. Foreground continuation, correction, review, status, or feedback also stays with its
Mission. Repeating, renaming, resuming, or moving the same unresolved gap is continuation of the
existing Mission and inherits its Origin, Stop, findings, and rejected candidates.

## Hub checkpoint

Keep one complete replacement checkpoint in the current hub thread. Before every mode, dispatch,
identity, monitoring, source, merge, continuation, or recovery gate, reconcile it with the Goal as
required by `SKILL.md` and with current native task and Git facts. The checkpoint is conversation
evidence, not repository state, a task registry, or another lifecycle.

Every replacement preserves all approved or admitted nodes still inside the overall completion
boundary until the hub legally terminates. For each node retain:

- stable label; Outcome and real consumer; Scope and non-goals; falsifiable Acceptance;
- owner and write surface; only direct `after` predecessors; Authority and external effects;
- source ref and observed exact tip;
- approval and create-attempt facts;
- finite Stop and consumed evidence or backward-route facts;
- `clientThreadId`, `threadId`, and `hostId`, or `unknown` for each absent identity;
- pull request and exact head, or the authorized no-PR/non-Git endpoint;
- next gate; terminal, blocked, rejected, or superseded evidence.

Do not copy the complete prompt into the checkpoint, assign priority or retry counts, add workflow
enums, or append partial updates that could drop older nodes. Goal prose holds only the overall
completion contract; native task/thread and Git/PR hosts remain authoritative for identities and
candidates.

Nodes with a direct `after` edge, the same owner, overlapping write surfaces, or a shared contract
serialize. Only a ready wave with provably independent owners, write surfaces, contracts, premises,
and dependencies may prepare in parallel. Unknown overlap returns affected nodes to Plan. A
downstream node stays deferred until every direct predecessor is integrated and its premises remain
valid.

One child task hosts one independent Outcome. A Git-backed child owns one managed worktree, one
eventual branch, and at most one pull request. The child owns its Mission candidate and verification;
the hub owns admission, the checkpoint, source observation, bounded monitoring, and merge release.
Every multi-Mission child packet stops at a Ready pull request and withholds merge authority.

Child candidate rejection or verification failure preserves the node and does not block the overall
Goal. While the original Frame, task, Stop, and endpoint still allow another candidate, continue in
the same child thread through its normal replan route. Do not automatically create a replacement
task. Return to the user before another task-creation effect or a material change to Frame, Stop,
endpoint, or authority. When Stop is exhausted, retain that terminal candidate/Plan evidence and
freeze direct successors. A true external child block also freezes descendants; independent nodes
may continue only when its premise cannot affect them.

Parallel children may prepare pull requests, but release at most one exact head for merge. The
released child must refetch, revalidate, and match that head. After every merge the hub fetches and
observes the canonical source tip; revalidate every other open pull request bound to that ref before
another release. Create a dependent child only from the newly observed tip. A closed or superseded
pull request preserves node evidence and routes through the same child rather than a replacement.
User insertion or source drift freezes undispatched effects until Goal, checkpoint, source, and
authority reconcile again.

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
or dispatch policy. Approval permits one native create attempt for the exact labeled packet. A
returned identity consumes the proposal; a missing capability or failed attempt preserves the
approved prompt for manual fallback. A retry needs fresh authority.

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

Then retain the complete editable child prompt containing every dispatch field:

- outcome and consumer;
- scope and explicit non-goals;
- authority and required external effects;
- falsifiable acceptance;
- exact Origin, prerequisites, declared source ref/tip when applicable, and revalidation evidence;
- target project and observed native environment selection;
- a pre-mutation dependency and tool preflight derived from that repository's current owner manifests
  and lockfile;
- the complete initial child prompt, including its five-stage Mission and endpoint.

The preflight names exact checks. When required dependencies are absent, the packet authorizes the
repository-evidenced, non-interactive locked install command before substantive reads or mutation,
with credentials, secret acquisition, scripts or live effects excluded as required by the repository.
If current owner and lockfile evidence does not admit a safe deterministic command, the child reports
the exact missing tool or dependency and stops before mutation. Do not invent package-manager policy
or assume a repository environment file is active unless native creation carries or observes its
selected environment path.

An absent or null native environment path is evidence that no environment selection was carried,
not that repository setup ran; the child prompt's preflight remains the only admitted next effect.

For a multi-Mission node, the endpoint is `merge-ready`; the packet explicitly withholds merge until
the hub later sends a separately authorized exact-head release.

End a `ready` packet with the direct question **Create this task?** A `deferred` packet instead ends
with **Create this task? — unavailable until `<exact prerequisite>`**; a reply to that unavailable
question is not creation authority. The user may edit, reject, approve one, or approve several named
ready proposals. An ordinary unambiguous approval after the ready question is the explicit request
required by the task host. Rejection or edits remain in the hub; no task exists yet.

For multiple independent outcomes, present one packet per admitted graph node and preserve the
stable labels so the user can approve a subset or a ready wave. Approval consumes a proposal after
its one native create attempt. Deferred nodes cannot be approved around their prerequisites.

## Native dispatch

After consent:

1. re-run the packet's declared read-only checks against the same owner surfaces and verify every
   prerequisite, decisive fact, exact Origin, and applicable source ref/tip still matches;
2. if any fact drifted, do not create a task; refresh the packet as `deferred` or materially revised,
   preserve its label, and require fresh approval after any material revision;
3. replace the hub checkpoint with the approved effect and `create attempt: pending` before calling
   the host;
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

A normal return containing only `clientThreadId` consumes the create attempt but does not provide an
operable task identity. At the next identity-dependent gate, perform one bounded reconciliation:
call `list_threads` once to locate candidates, then use exact `read_thread` prompt, source,
project, and worktree facts to confirm one mapping. Never match only by title or summary, pass
`clientThreadId` to wait/read/send, or repeat `create_thread`. If the mapping remains missing or
ambiguous, retain the Outcome and freeze only the identity-dependent effect.

Creation is non-blocking. Outside an admitted multi-Mission orchestration session, return after
creation without babysitting setup or child commentary. Inside that mode, the hub may use bounded
native monitoring only for the current ready wave or next merge gate. It must use exact `threadId`
and `hostId` facts and must not poll a queued `clientThreadId`.

The child independently owns `Frame → Plan → Execute → Verify → Finalize`, its candidate, branch,
zero-or-one pull request, publication, review closure, and cleanup. In multi-Mission mode its
Finalize stops at `merge-ready` unless the hub supplies the exact-head merge release. The parent does
not run or mirror the child's stages.

## Child controls

Operate on a child when the user asks, or when an admitted multi-Mission checkpoint names that child
at the current monitoring or merge gate:

- status or one-time monitoring: use one `wait_threads` call with `timeoutMs: 0`;
- status for up to eight named children: use one bounded snapshot with all targets;
- feedback or continuation: call `send_message_to_thread` once with `threadId`, optional `hostId`,
  and the feedback in `prompt`, then return immediately;
- additional history needed for the request: use a bounded `read_thread`.

Use returned cursors for later snapshots when available. Commentary is never a reason to poll. A
true external child block freezes its descendants under the checkpoint rule; it does not authorize a
retry, replacement, or host transfer.

## Completion

Complete the overall Goal only after every required Outcome and the final evidence handoff are
closed. For a pull-request endpoint, terminal completion requires the exact verified candidate head
to be merged. For an authorized no-PR, no-op, or non-Git endpoint, retain its terminal acceptance
evidence instead of manufacturing an empty pull request. A child Ready pull request, rejected
candidate, closed pull request, or blocked node is evidence for the next checkpoint gate, not overall
completion by itself.

## Capability fallback

If the native task host is unavailable or creation fails, preserve the approved packet and report
the exact missing capability or failure. Offer the complete prompt for manual task creation. The
independent outcome remains undispatched, but the foreground Mission is not blocked merely because
the hub cannot create a child.

Do not serialize the outcome in the current worktree, create another branch or pull request there,
hide it in a subagent, or claim a task identity that the host did not return. Host unavailability
never authorizes an automatic retry, replacement, or host transfer.

## Handoff boundaries

- Parent hub routing creates or operates a separate child identity.
- Codex chat Handoff moves the same chat and git state between Local and Worktree; it does not create
  a new Mission or deliver a candidate.
- A child Mission's GitHub delivery belongs to its own Finalize.

Use `fork_thread`, `handoff_thread`, archival, pinning, and renaming only under their separate current
host contracts. They are not substitutes for proposal-to-`create_thread` dispatch.
