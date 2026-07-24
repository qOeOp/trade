---
name: run-bounded-mission
description: Run one bounded, evidence-driven mission for material questions or changes about agent workflows, skill behavior, evidence sourcing, autonomy, acceptance, or termination, including current-behavior questions. Also use for non-trivial product or engineering work requiring project context, judgment, multiple steps, or an adoptable result, including analysis and design, planning, implementation, organization, simplification, refactoring, optimization, migration, architecture, governance, or acceptance-oracle audit. The workflow covers authority and oracle audit, contract formation, execution or analysis, independent verification, termination, and post-mission learning. Do not use for simple, stable self-contained factual answers, tiny mechanical edits with obvious acceptance, or workflows fully owned by a more specific skill. Combine with a specific skill when project-level admission, cross-cutting change, or termination control remains needed.
---

# Run a Bounded Mission

Run one bounded project mission. Treat the prompt as an objective, not permission to continue.

Discover project instructions, owners, consumers, gates, and authority. They constrain effects but do not prove that a proposed design or oracle is fit.

Use native planning, isolation, tools, and gates; do not build another orchestrator.

## Package resources

- Read [references/roles.md](references/roles.md) during discovery when ambiguity, unclear consumers, governance or oracle changes, cross-owner design, expensive reversal, noisy investigation, or required independence may justify a fresh role; always read it before using one.
- Read [references/post-mission-review.md](references/post-mission-review.md) only after the mission terminates or when changing this skill package.

## Mission workflow

### 1. Discover

Inspect the worktree, contracts, runtime, and tests. Discover authority; preserve unrelated changes.

Separate objective, project authority, evidence, and defaults. Keep project facts out of the skill.

Classify the evidence horizon for each material claim as stable and self-contained, deterministic local, current external, or private connected. Use the owning local artifact for local claims and the most direct authoritative or connected source for material current or external claims. If required evidence is unavailable, disclose bounded uncertainty and terminate `blocked` only when it prevents acceptance. Do not browse for locally closed questions, substitute model memory for current evidence, or let external evidence override user or project authority. Decide delegation separately from evidence horizon: use a bounded read-only explorer only when noisy investigation, parallel evidence, or required independence justifies its token and coordination cost; keep localized sequential reads, synthesis, and integration in the main context.

Trace each material rule to user or project authority and classify it as binding authority, an evidence-backed invariant, a heuristic or default, or conflicting or unsupported. Audit whether each proposed oracle measures the outcome, duplicates another truth, depends on open-world inference, or can be changed by its candidate. Prefer capability and adoption boundaries over proxy quotas or scanners when they make invalid states unreachable.

For analysis, product or technical design, planning, or audit, name the decision owner, outcome consumer, and adoption journey. For implementation, name the production consumer and exact usage journey. If authority, consumer, or journey is missing or conflicting, investigate read-only and terminate `blocked`; never resolve external authority by assertion.

### 2. Contract

Only after the authority and oracle audit, freeze one mission in the working plan:

- outcome and current failure;
- named outcome consumer and exact adoption or usage journey;
- scope, non-goals, acceptance signals, and owners to reuse;
- permitted effects and responsibility delta;
- revision, non-progress, cost, and escalation budgets.

Treat user and project authority, the outcome, consumer journey, effect ceiling, and cumulative budgets as external bounds. Select the minimum permitted effects within them; do not preselect a read-only or writable mode before a required planner.

Use project budgets when present. Otherwise allow three candidates per uncertain decision, one writable context, three revisions per slice, two non-progress cycles before replanning, and six accepted slices before recontracting.

An explicit replan may refreeze mission-selected design, effects, and a falsified mission-selected oracle only within the original authority, outcome, consumer journey, externally imposed acceptance requirements, effect ceiling, and cumulative budgets. Candidates and evaluators cannot change or weaken the oracle. Do not reset budgets through a new context, renamed request, persistent goal, recurring run, or replan. Expanding an external bound requires external admission and a new mission.

### 3. Design

Choose analysis, a decision artifact, or implementation according to the outcome. Challenge implementation necessity. Prefer wiring, consolidation, simplification, or deletion when sufficient.

Select the design that reaches the consumer, reuses an owner, is directly verifiable, adds the least responsibility, and remains reversible.

When implementation is required, build dependency-ordered vertical slices. Close each through the consumer, keep one in progress, and admit only discoveries required for acceptance.

For read-only analysis, design, planning, or audit, use bounded decision steps and preserve independently reviewable evidence without inventing an implementation slice.

### 4. Execute

For each decision step or implementation slice:

1. Reproduce the baseline and preserve replayable evidence.
2. Produce the smallest coherent decision artifact or behavior change.
3. Inspect the complete result or diff for fake success, duplicated authority, unused work, weakened checks, and accidental scope.
4. Run focused checks and the outcome-consumer journey; capture exact commands, status, and raw before/after evidence.
5. Use a fresh evaluator before terminating `completed` for any writable mission or high-impact read-only audit. Treat a read-only audit as high-impact when its requested outcome could cause a governance rule, architecture or ownership boundary, authority, safety control, or acceptance oracle to be adopted, removed, or weakened. Simple factual answers and ordinary low-impact read-only analysis do not require an evaluator.
6. Accept, revise, replan, or terminate from frozen signals and budgets.

Count progress only when a failing signal improves without regressions or new unapproved authority. Do not weaken an oracle, bless the candidate with new tests, or create speculative layers.

Contract compliance is insufficient when new evidence shows that an oracle is proxy-only, duplicated, circular, candidate-controlled, or disconnected from the consumer. Replan or terminate rather than faithfully extending it.

Reject caller-declared success. Receipts must bind the mission and source revision to the exact command or tool invocation, status, and raw output or artifact hash. When a candidate exists, also bind its patch or content hash.

Keep effects within user authorization, project policy, and the mission contract. Tools and role labels do not grant authority to commit, merge, push, deploy, schedule, access secrets, mutate owner stores, or change shared infrastructure.

For writable work, remove superseded implementations and temporary compatibility paths when safe. Do not retain failed candidates, orphan paths, or evidence scaffolding as product code.

### 5. Terminate

End in exactly one state:

- `completed`: every acceptance check passes through the real outcome consumer;
- `blocked`: an external fact, permission, or missing authority prevents progress;
- `invalidated`: evidence shows the objective or design is wrong;
- `budget_exhausted`: the revision or non-progress budget is spent.

Report the outcome, consumer journey, evidence, quality results, responsibility delta, and gaps. Do not claim completion from document or code volume, unit tests, or static gates alone.

## Post-mission learning review

After the terminal report, load and run [references/post-mission-review.md](references/post-mission-review.md) once. Audit learning rules by the same authority and oracle standard; never reopen the mission.

For scheduled, hosted, or repeated execution, treat each invocation as an independent mission. Discover admission, isolation, concurrency, receipt, adoption, and retention rules. Cadence grants no deadline extension, retry, or new work.
