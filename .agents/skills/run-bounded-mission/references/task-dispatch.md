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

With zero independent Missions, handle the request directly. With one, execute it in the current
session unless the user explicitly requests creation or routing of a separate task; that request
continues through proposal and native dispatch. With two or more, the hub admits the minimal session
graph below. Task creation still requires the user's explicit request or approval of every exact
ready packet.

## Minimal session graph

Keep the graph only in conversation prose or a compact checkpoint. For each node retain exactly the
facts needed to resume and make the next gate decision:

- stable session label;
- Outcome and real consumer;
- Scope and non-goals;
- falsifiable Acceptance;
- owner and write surface;
- `after`, listing only direct predecessors;
- Authority and external effects;
- source ref and observed exact tip;
- host identity and next gate.

Do not persist these fields, assign priority, add workflow state enums, or infer scheduling policy
from labels. Unknown shared write surface returns the affected nodes to the hub's Plan before
dispatch. Nodes with a direct `after` edge, the same owner, overlapping write surfaces, or a shared
contract serialize. Only a ready wave with mutually independent owners, write surfaces, contracts,
premises, and dependencies may prepare in parallel. A downstream node stays deferred until every
direct predecessor is integrated and its premises remain valid. Premise independence must be
provable from the retained Outcome, Scope, Acceptance, Authority, and source facts at every dispatch
or resume gate; otherwise return the affected nodes to Plan instead of adding graph fields.

One child task/chat hosts one independent Outcome. A Git-backed child owns one managed worktree, one
eventual branch, and at most one pull request. The child owns its Mission candidate and verification;
the hub owns graph admission, source observation, bounded monitoring, and merge release. Every
multi-Mission child packet stops at a Ready pull request and explicitly withholds merge authority.
Messages and root turns do not create additional Missions.

Parallel children may prepare pull requests, but the hub releases at most one exact candidate head
for merge. The released child must refetch, revalidate, and match that head before merging; no other
child receives merge authority. After every merge the hub independently fetches and observes that
node's canonical source tip. Every other open pull request bound to the same source ref then has base
drift and must be revalidated from that observed tip before a later release. Nodes bound to another
source ref remain unchanged only after their own ref/tip facts are observed. A dependent child may
be created only from its newly observed source tip, never from its predecessor's old base.

If a child blocks, freeze its descendants; independent nodes may continue only when the blocked
premise cannot affect them. If a predecessor is cancelled, freeze its descendants and return that
branch to Plan; do not remove the edge or leave the branch permanently deferred. A user override
freezes undispatched nodes and every unissued merge release while the hub re-admits the graph. Do not
automatically retry, create a replacement, or transfer a host.

After conversation compaction, reconstruct only from exact thread, host, pull-request head, and
source-ref/tip facts. If an identity cannot be recovered exactly, fail closed at its next operation.
A queued `clientThreadId` is not a task identity and cannot be passed to wait or send operations.

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
- target project and default environment;
- the complete initial child prompt, including its five-stage Mission and endpoint.

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
3. call `list_projects` before project-backed creation;
4. resolve the intended saved project and inspect `isGitRepository`;
5. for a Git project, call `create_thread` exactly once for each approved proposal with
   `target.type=project`, the resolved `target.projectId`, and
   `target.environment.type=worktree`;
6. for a non-Git project, use `target.environment.type=local` only when the resolved saved project
   cannot share the foreground candidate; otherwise use capability fallback because the host cannot
   provide the required independent workspace;
7. omit `model`, `thinking`, and `startingState` overrides unless the user explicitly requested them;
8. pass the approved child prompt without silently expanding its outcome or authority;
9. record the host-provided `threadId`/`hostId` or queued `clientThreadId`, then follow the host
   contract to emit its created-task link or directive; never invent a URL.

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

Use returned cursors for later snapshots when available. Commentary is never a reason to poll. If a
child blocks, freeze its descendants and apply the session graph rule; do not revise its candidate,
retry it, replace it, or transfer its host without new authority.

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
