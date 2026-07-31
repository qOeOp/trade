# Codex Task Dispatch

Load this reference only when a long-lived hub may route an independent outcome or operate an
existing child task. Lifecycle authority remains in `SKILL.md`; this file projects it onto current
Codex task tools without adding a queue, ledger, daemon, coordinator, or second lifecycle.

## Routing invariants

Classify each outcome independently:

- foreground continuation, correction, review, status, or feedback stays in the hub;
- status or feedback naming an existing child routes to that child;
- every independent outcome becomes an editable proposal before any task is created.

One hub may retain one foreground Mission and multiple proposals or child identities. Conversation
context and host-returned identities are sufficient; do not persist another orchestration model.
One child owns one outcome and task/chat. A Git-backed child also owns its managed worktree,
eventual branch, and at most one pull request. Do not claim a worktree or branch for a non-Git
project. Messages and root turns do not create additional Missions.

An independent outcome remains proposed while the user edits or withholds approval. Approval permits
one native create attempt. A returned identity consumes the proposal; a missing capability or failed
attempt leaves the approved prompt available for fallback. After dispatch, only a user-requested
snapshot or message re-enters the parent's work.

## Proposal and consent

Prepare a reviewable packet containing:

- outcome and consumer;
- scope and explicit non-goals;
- authority and required external effects;
- falsifiable acceptance;
- target project and default environment;
- the complete initial child prompt, including its five-stage Mission and endpoint.

End with a direct consent question such as “Create this task?”. The user may edit, reject, approve
one, or approve several named proposals. An ordinary unambiguous approval after that question is the
explicit request required by the task host. Rejection or edits remain in the hub; no task exists yet.

For a message with multiple independent outcomes, present one packet per outcome and preserve a
stable label so the user can approve a subset. Approval consumes that proposal after one create
attempt; retrying a failed attempt requires fresh user authority.

## Native dispatch

After consent:

1. call `list_projects` before project-backed creation;
2. resolve the intended saved project and inspect `isGitRepository`;
3. for a Git project, call `create_thread` exactly once for each approved proposal with
   `target.type=project`, the resolved `target.projectId`, and
   `target.environment.type=worktree`;
4. for a non-Git project, use `target.environment.type=local` only when the resolved saved project
   cannot share the foreground candidate; otherwise use capability fallback because the host cannot
   provide the required independent workspace;
5. omit `model`, `thinking`, and `startingState` overrides unless the user explicitly requested them;
6. pass the approved child prompt without silently expanding its outcome or authority;
7. immediately return the host-provided `threadId`/`hostId` or queued `clientThreadId`, then follow
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
