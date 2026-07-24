---
name: run-autonomous-development
description: Run one bounded autonomous development mission through an object loop and a post-mission meta loop. Use for broad product directions, ambiguous engineering requests, cross-module changes, migrations, architectural corrections, or unattended implementation that must discover project context, deliver through a real consumer, verify independently, terminate explicitly, and learn without specializing the workflow to one project. Do not use for small explicit edits, read-only explanations, or domain-specific research workflows.
---

# Run Autonomous Development

Run one mission. Treat the prompt as an objective, not permission to continue.

Discover project instructions, owners, consumers, gates, and authority; they outrank this workflow.

Use native planning, isolation, tools, and gates; do not build another orchestrator.

## Package resources

- Read [references/subagents.md](references/subagents.md) before using a fresh planner, candidate, or evaluator.
- Read [references/meta-loop.md](references/meta-loop.md) only after the object mission terminates or when changing this skill package.

## Object workflow

### 1. Discover

Inspect the worktree, contracts, runtime, and tests. Discover authority; preserve unrelated changes.

Separate objective, project authority, evidence, and defaults. Keep project facts out of the skill.

If authority, a consumer, or an acceptance journey is missing, investigate read-only and terminate `blocked`.

### 2. Contract

Freeze one mission in the working plan:

- outcome and current failure;
- named production consumer and exact journey;
- scope, non-goals, acceptance signals, and owners to reuse;
- permitted effects and responsibility delta;
- revision, non-progress, cost, and escalation budgets.

Use project budgets when present. Otherwise allow three candidates per uncertain decision, one writable context, three revisions per slice, two non-progress cycles before replanning, and six accepted slices before recontracting.

Do not reset budgets through a new context, renamed request, persistent goal, or recurring run. Only external admission can start another mission.

### 3. Design

Challenge implementation necessity. Prefer wiring, consolidation, simplification, or deletion when sufficient.

Select the design that reaches the consumer, reuses an owner, is directly verifiable, adds the least responsibility, and remains reversible.

Build dependency-ordered vertical slices. Close each through the consumer, keep one in progress, and admit only discoveries required for acceptance.

### 4. Execute

For each slice:

1. Reproduce the baseline and preserve replayable evidence.
2. Implement the smallest coherent behavior change.
3. Inspect the full diff for fake success, duplicated authority, unused code, weakened checks, and accidental scope.
4. Run focused checks and the consumer journey; capture exact commands, status, and raw before/after evidence.
5. Use a fresh evaluator before accepting any writable mission.
6. Accept, revise, replan, or terminate from frozen signals and budgets.

Count progress only when a failing signal improves without regressions or new unapproved authority. Do not weaken an oracle, bless the candidate with new tests, or create speculative layers.

Reject caller-declared success. Receipts must bind mission hash, source revision, patch hash, exact command, exit status, and output or artifact hash.

Keep effects within user authorization, project policy, and the mission contract. Tools and role labels do not grant authority to commit, merge, push, deploy, schedule, access secrets, mutate owner stores, or change shared infrastructure.

Remove superseded implementations and temporary compatibility paths when safe. Do not retain failed candidates, orphan paths, or evidence scaffolding as product code.

### 5. Terminate

End in exactly one state:

- `completed`: every acceptance check passes through the real consumer;
- `blocked`: an external fact, permission, or missing authority prevents progress;
- `invalidated`: evidence shows the objective or design is wrong;
- `budget_exhausted`: the revision or non-progress budget is spent.

Report behavior, consumer journey, evidence, quality results, responsibility delta, and gaps. Do not claim completion from code volume, unit tests, or static gates alone.

## Post-mission phase

After the terminal report, load and run [references/meta-loop.md](references/meta-loop.md) once. Never reopen the object mission.

For scheduled, hosted, or repeated execution, treat each invocation as an independent mission. Discover admission, isolation, concurrency, receipt, adoption, and retention rules. Cadence grants no deadline extension, retry, or new work.
