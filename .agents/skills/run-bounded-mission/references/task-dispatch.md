# Codex Task Dispatch

Load this reference only when a long-lived hub may route an independent outcome or operate an
existing child task. Lifecycle authority remains in `SKILL.md`; this file projects it onto current
Codex task tools without adding a queue, ledger, daemon, coordinator, or second lifecycle.

## Routing invariants

Classify each outcome independently:

- foreground continuation, correction, review, status, or feedback stays in the hub;
- status or feedback naming an existing child routes to that child;
- every independent outcome becomes an editable proposal before any task is created.

Task creation is only for a genuinely independent outcome. Repeating, renaming, resuming, or moving
the same unresolved outcome gap to another task is continuation of its existing Mission and inherits
its Origin, Stop, structural findings, and rejected candidates; route it to the current owner
instead of creating a child while that owner is available. If the owner is demonstrably deleted,
inaccessible, or unable to accept messages, explicit host-transfer authority may move the same
Mission through a native host operation; preserve its Mission identity, Origin, consumed Stop, and
applicable findings. Host transfer creates neither a successor Mission nor a fresh Stop. If transfer
authority or capability is unavailable, report that blocker instead of inventing a host. After
`accept`, a regression, correction, or changed requirement is a new Mission only when new post-accept
evidence defines a new gap and binds the accepted predecessor; mere repetition or relabeling remains
no new work.

One hub may retain one foreground Mission and multiple proposals or child identities. Conversation
context and host-returned identities are sufficient; do not persist another orchestration model.
One child task/chat is the host owner for one independent outcome. A Git-backed child also owns its
managed worktree, eventual branch, and at most one pull request. Do not claim a worktree or branch
for a non-Git project. Messages and root turns do not create additional Missions.

An independent outcome remains proposed while the user edits or withholds approval. Each proposal
has one stable, session-only label such as `G1`, `R1`, or `F1`, including when only one proposal is
visible. Preserve it across edits so the user can name the packet. Do not persist labels or interpret
their prefixes, or words such as `governance`, `refactor`, `research`, `fix`, or `migration`, as a
Mission type, priority, lifecycle, route, template, or dispatch policy.

Approval permits one native create attempt for the exact labeled packet. A returned identity
consumes the proposal; a missing capability or failed attempt leaves the approved prompt available
for fallback. After dispatch, only a user-requested snapshot or message re-enters the parent's work.

## Outcomes discovered during a Mission

When Plan, Execute, Verify, or Finalize evidence reveals an independent outcome, preserve its
evidence without widening the current Frame, repairing an out-of-scope pre-existing defect, or
attributing a non-candidate failure to the current candidate. Propose it only when it has an
independent consumer and Acceptance. If it is a true prerequisite for the current Plan, record the
exact blocker and use the existing Mission route; do not create a dependency graph, pre-create
downstream work, order tasks automatically, or wait on a child.

For follow-up discoveries made while running one Mission, present at most the highest-value narrow
proposal in the current interaction. Refactor, test, documentation, performance, security, removal,
and other descriptions all use this same protocol. Inbound user requests that already contain
multiple independent outcomes may still receive one labeled packet per outcome.

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

End a `ready` packet with the direct question **Create this task?** A `deferred` packet instead ends
with **Create this task? — unavailable until `<exact prerequisite>`**; a reply to that unavailable
question is not creation authority. The user may edit, reject, approve one, or approve several named
ready proposals. An ordinary unambiguous approval after the ready question is the explicit request
required by the task host. Rejection or edits remain in the hub; no task exists yet.

For a message with multiple independent outcomes, present one packet per outcome and preserve a
stable label so the user can approve a subset. Approval consumes that proposal after one create
attempt; retrying a failed attempt requires fresh user authority.

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
9. immediately return the host-provided `threadId`/`hostId` or queued `clientThreadId`, then follow
   the host contract to emit its created-task link or directive; never invent a URL.

Creation is non-blocking. Do not call `wait_threads`, babysit setup, wait for commentary, or wait for
child completion before returning. A `clientThreadId` is a queued identity and must not be passed to
operations that require `threadId`.

The child independently owns `Frame → Plan → Execute → Verify → Finalize`, its candidate, branch,
zero-or-one pull request, review closure, delivery, and cleanup. The parent does not run or mirror
those stages.

## Child controls

Operate on a child only when the user asks:

- status or one-time monitoring: use one `wait_threads` call with `timeoutMs: 0`;
- status for up to eight named children: use one bounded snapshot with all targets;
- feedback or continuation: call `send_message_to_thread` once with `threadId`, optional `hostId`,
  and the feedback in `prompt`, then return immediately;
- additional history needed for the request: use a bounded `read_thread`.

Use returned cursors for later snapshots when available. Commentary does not wake `wait_threads` and
is never a reason to poll. If a child is blocked, report that child's state; do not block the
foreground Mission, retry it, revise its candidate, or create a replacement without new authority.

## Capability fallback

If the native task host is unavailable or creation fails, preserve the approved packet and report
the exact missing capability or failure. Offer the complete prompt for manual task creation. The
independent outcome remains undispatched, but the foreground Mission is not blocked merely because
the hub cannot create a child.

Do not serialize the outcome in the current worktree, create another branch or pull request there,
hide it in a subagent, or claim a task identity that the host did not return.

## Handoff boundaries

- Parent hub routing creates or operates a separate child identity.
- Codex chat Handoff moves the same chat and git state between Local and Worktree; it does not create
  a new Mission or deliver a candidate.
- A child Mission's GitHub delivery belongs to its own Finalize.

Use `fork_thread`, `handoff_thread`, archival, pinning, and renaming only under their separate current
host contracts. They are not substitutes for proposal-to-`create_thread` dispatch.
