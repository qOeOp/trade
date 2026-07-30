# Codex Task Dispatch

Load only when an incoming request may introduce an outcome independent of the active Mission, or
when the host exposes task-management tools. This reference projects the lifecycle onto Codex tasks;
`SKILL.md` remains authority.

## Classify the outcome

Keep the message in the current task only when it advances the same frozen Outcome: clarification,
correction, review feedback, CI status, delivery status, or an authorized continuation.

Treat it as independent when it has its own consumer result and can be accepted or blocked without
changing the active Mission's Contract. Shared repository context, the same user, or temporal
proximity do not make two outcomes one Mission.

When uncertain, compare the acceptance oracles: if either outcome can pass while the other fails,
they are distinct.

## Dispatch

For a distinct outcome, use the host's native task creation surface immediately:

1. create one new project task on a new Codex-managed worktree from the project default branch,
   unless the user explicitly names another starting identity;
2. send only the new outcome and necessary stable context; do not transfer the active candidate,
   branch, PR, or uncommitted files;
3. let the new task run its own Mission-Start through Mission-Terminate lifecycle in parallel;
4. return the task identity to the user and keep the current Mission unchanged.

On the Codex app host, this means the native task-creation operation (currently `create_thread`) with
a worktree environment, followed by bounded `wait_threads` observation when coordination is needed.
Do not use `create_thread` for stage-internal evidence packets; those remain subagents.

Use a fork only when the completed conversation history is itself required evidence and the host
permits it. A task/worktree handoff operation changes where a Codex conversation runs; it is not the
Mission Handoff stage, which delivers the candidate through the frozen endpoint.

Do not require trigger phrases such as “new task” or “parallel”. If host policy, capability, or
authority denies proactive task creation, fail closed with `route=blocked`. Do not run the second
Mission serially, reuse the active worktree, create a second branch or PR in the current task, or use
a subagent as a hidden replacement task.

## Ownership and cleanup

The mapping is one-to-one:

```text
Mission identity = Codex task/chat = worktree = branch = zero-or-one PR
```

Mission-Terminate removes mission-owned temporary resources and requests branch/worktree cleanup
after accepted delivery. If the active host cannot remove its own in-use worktree, report that
host-owned residual explicitly and use the native archive/cleanup surface when authorized; never
claim cleanup that was not observed.
