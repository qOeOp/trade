---
name: run-bounded-mission
description: Run a bounded, evidence-driven mission for material questions or changes about agent workflows, skill behavior, evidence sourcing, autonomy, acceptance, termination, or current behavior. Also use for non-trivial product/engineering work needing project context, judgment, multiple steps, or an adoptable result, including analysis, design, planning, implementation, organization, simplification, refactoring, optimization, migration, architecture, governance, acceptance-oracle audit, and explicitly authorized GitHub PR publication, review, or merge. Covers authority/oracle audit, contracting, isolated execution or analysis, independent verification, bounded review/fix iteration, termination, cleanup, and learning. Do not use for simple stable self-contained facts, tiny mechanical edits with obvious acceptance, or workflows fully owned by a more specific skill. Combine with domain/provider skills while retaining project-level admission, cross-cutting change, and terminal control.
---

# Run a Bounded Mission

Run one bounded project mission. Treat the prompt as an objective, not permission to continue.

Discover project instructions, owners, consumers, gates, and authority. They constrain effects but do not prove that a proposed design or oracle is fit.

Use native planning, isolation, tools, and gates; do not build another orchestrator.

## Package resources

- Read [references/roles.md](references/roles.md) during discovery when ambiguity, unclear consumers, governance or oracle changes, cross-owner design, expensive reversal, noisy investigation, or required independence may justify a fresh role; always read it before using one.
- A `covered GitHub PR lifecycle terminal` means publishing a GitHub PR, carrying it through review, or merging it. Read [references/github-publication.md](references/github-publication.md) only when the requested outcome explicitly includes one. Ordinary read-only PR inspection is not a covered terminal unless the outcome requests lifecycle progress. Do not load or apply the reference to patch-only, local-only, other read-only, or non-GitHub missions.
- Read [references/post-mission-review.md](references/post-mission-review.md) only after the mission terminates or when changing this skill package.

## Mission workflow

### 1. Discover

Inspect the worktree, contracts, runtime, and tests. Discover authority; preserve unrelated changes.

Separate objective, project authority, evidence, and defaults. Keep project facts out of the skill.

Classify the evidence horizon for each material claim as stable and self-contained, deterministic local, current external, or private connected. Use the owning local artifact for local claims and the most direct authoritative or connected source for material current or external claims. If required evidence is unavailable, disclose bounded uncertainty and apply the ordered terminal rules; external unavailability is `blocked` only while the relevant budgets remain. Do not browse for locally closed questions, substitute model memory for current evidence, or let external evidence override user or project authority. Before broad evidence collection, forecast separable evidence bundles and likely raw-output volume against the main context needed for synthesis; use that forecast as evidence in the separate delegation decision, not as a delegation command. Use a bounded read-only explorer only when an independently auditable claim and noisy investigation, useful parallelism, or required independence justify its token and coordination cost; keep localized sequential reads, synthesis, and integration in the main context.

Trace each material rule to user or project authority and classify it as binding authority, an evidence-backed invariant, a heuristic or default, or conflicting or unsupported. Audit whether each proposed oracle measures the outcome, duplicates another truth, depends on open-world inference, or can be changed by its candidate. Prefer capability and adoption boundaries over proxy quotas or scanners when they make invalid states unreachable.

For analysis, product or technical design, planning, or audit, name the decision owner, outcome consumer, and adoption journey. For implementation, name the production consumer and exact usage journey. If authority, consumer, or journey is missing or conflicting, investigate read-only and apply the ordered terminal rules; never resolve external authority by assertion.

### 2. Contract

Only after the authority and oracle audit, freeze one mission in the working plan:

- outcome and current failure;
- named outcome consumer and exact adoption or usage journey;
- scope, non-goals, acceptance signals, and owners to reuse;
- permitted effects and responsibility delta;
- exact source revision and, when applicable, publication target, terminal effect, and required remote evidence;
- revision, non-progress, cost, and escalation budgets.

Treat user and project authority, the outcome, consumer journey, effect ceiling, and cumulative budgets as external bounds. Select the minimum permitted effects within them; do not preselect a read-only or writable mode before a required planner.

After freezing writable effects, establish one mission-only worktree at the exact source revision before the first candidate write or branch/index mutation, and perform every mutation-capable action there. Truly read-only missions may remain in the starting checkout. Switching branches in an existing checkout is not isolation; do not carry unrelated dirty state into the worktree. If the current context can neither address nor hand off to the isolated worktree, apply the ordered terminal predicates before writing.

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

### GitHub PR lifecycle

If and only if the frozen outcome explicitly includes a covered GitHub PR lifecycle terminal, load and execute [references/github-publication.md](references/github-publication.md). The main mission context owns integration, lifecycle effects, and terminal judgment; a writer or evaluator never gains commit, push, PR, or merge authority.

Keep mission progress in the working plan and recover current facts from Git, the PR, checks, and reviews. Do not create a lifecycle ledger, project state machine, daemon, hook, or second orchestrator. A changed candidate invalidates evidence that is not bound to its current identity.

### 5. Terminate

End in exactly one state. Apply these predicates in order:

- `completed`: every acceptance check passes through the real outcome consumer;
- `invalidated`: evidence intrinsic to the objective or design shows it is wrong or cannot satisfy the frozen external bounds, rather than a required external fact, permission, or authority being unavailable;
- `budget_exhausted`: a potentially valid next step remains, but a revision, non-progress, cost, or escalation budget is spent;
- `blocked`: a required external fact, permission, or authority remains unavailable while the relevant mission budgets remain.

Report the terminal state, outcome, consumer journey, evidence, quality results, responsibility delta, and gaps. When evaluation was required, surface each current candidate-bound material judgment by name, status, bounded claim, inspected scope, limit, and terminal consequence—including `change_necessity`, `responsibility_fit`, and `cleanup` for writable work; do not replace them with an aggregate verdict, recompute or strengthen them, and treat them as stale after a candidate change. A material `refuted` or `unresolved` judgment precludes `completed`. For high-impact read-only work, distinguish no repository write or runtime-surface delta from decision, authority, access, cost, or other effects. Do not claim completion from document or code volume, unit tests, or static gates alone.

When a covered GitHub PR lifecycle terminal is part of the frozen outcome, `completed` also requires reaching that exact terminal effect through the current candidate and performing its required cleanup. Reaching an earlier milestone such as a local patch, commit, PR, or green check is not completion when the frozen outcome names a later terminal.

## Post-mission learning review

After the terminal report, load and run [references/post-mission-review.md](references/post-mission-review.md) once. Audit learning rules by the same authority and oracle standard; never reopen the mission.

For scheduled, hosted, or repeated execution, treat each invocation as an independent mission. Discover admission, isolation, concurrency, receipt, adoption, and retention rules. Cadence grants no deadline extension, retry, or new work.
