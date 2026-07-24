---
name: run-autonomous-development
description: Run one bounded autonomous development or governance-audit mission through an object loop and a post-mission meta loop. Use for broad product directions, ambiguous or unattended implementation, cross-module changes, migrations, architectural corrections, and read-only audits of development governance, acceptance oracles, or autonomous workflows. Do not use for small explicit edits, ordinary read-only explanations, or domain-specific research workflows.
---

# Run Autonomous Development

Run one mission. Treat the prompt as an objective, not permission to continue.

Discover project instructions, owners, consumers, gates, and authority. They constrain effects but do not prove that a proposed design or oracle is fit.

Use native planning, isolation, tools, and gates; do not build another orchestrator.

## Package resources

- Read [references/subagents.md](references/subagents.md) before using a fresh planner, candidate, or evaluator.
- Read [references/meta-loop.md](references/meta-loop.md) only after the object mission terminates or when changing this skill package.

## Object workflow

### 1. Discover

Inspect the worktree, contracts, runtime, and tests. Discover authority; preserve unrelated changes.

Separate objective, project authority, evidence, and defaults. Keep project facts out of the skill.

Trace each material rule to user or project authority and classify it as binding authority, an evidence-backed invariant, a heuristic or default, or conflicting or unsupported. Audit whether each proposed oracle measures the outcome, duplicates another truth, depends on open-world inference, or can be changed by its candidate. Prefer capability and adoption boundaries over proxy quotas or scanners when they make invalid states unreachable.

For a governance audit, name the decision owner and adoption journey. For delivery, name the production consumer and exact journey. If authority, consumer, or journey is missing or conflicting, investigate read-only and terminate `blocked`; never resolve external authority by assertion.

### 2. Contract

Only after the authority and oracle audit, freeze one mission in the working plan:

- outcome and current failure;
- named production or decision consumer and exact journey;
- scope, non-goals, acceptance signals, and owners to reuse;
- permitted effects and responsibility delta;
- revision, non-progress, cost, and escalation budgets.

Use project budgets when present. Otherwise allow three candidates per uncertain decision, one writable context, three revisions per slice, two non-progress cycles before replanning, and six accepted slices before recontracting.

Do not reset budgets through a new context, renamed request, persistent goal, or recurring run. Only external admission can start another mission.

### 3. Design

Challenge implementation necessity. Prefer wiring, consolidation, simplification, or deletion when sufficient.

Select the design that reaches the consumer, reuses an owner, is directly verifiable, adds the least responsibility, and remains reversible.

Build dependency-ordered vertical slices. Close each through the consumer, keep one in progress, and admit only discoveries required for acceptance.

For a read-only governance audit, preserve the audit and independent review evidence without inventing an implementation slice.

### 4. Execute

For each slice:

1. Reproduce the baseline and preserve replayable evidence.
2. Implement the smallest coherent behavior change.
3. Inspect the full diff for fake success, duplicated authority, unused code, weakened checks, and accidental scope.
4. Run focused checks and the consumer journey; capture exact commands, status, and raw before/after evidence.
5. Use a fresh evaluator before accepting any writable mission.
6. Accept, revise, replan, or terminate from frozen signals and budgets.

Count progress only when a failing signal improves without regressions or new unapproved authority. Do not weaken an oracle, bless the candidate with new tests, or create speculative layers.

Contract compliance is insufficient when new evidence shows that an oracle is proxy-only, duplicated, circular, candidate-controlled, or disconnected from the consumer. Replan or terminate rather than faithfully extending it.

Reject caller-declared success. Receipts must bind the mission and source revision to the exact command or tool invocation, status, and raw output or artifact hash. When a candidate exists, also bind its patch or content hash.

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

After the terminal report, load and run [references/meta-loop.md](references/meta-loop.md) once. Audit meta rules by the same authority and oracle standard; never reopen the object mission.

For scheduled, hosted, or repeated execution, treat each invocation as an independent mission. Discover admission, isolation, concurrency, receipt, adoption, and retention rules. Cadence grants no deadline extension, retry, or new work.
