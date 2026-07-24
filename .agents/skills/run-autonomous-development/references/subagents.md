# Fresh-context role protocols

Load only when the mission needs an independent planner, candidate, or evaluator.

Implement roles with custom or generic subagents. Select by capability, not name. UI metadata does not register agents.

## Shared rules

- Keep scope, admission, integration, and terminal ownership in the main context.
- Prefer read-only roles. Allow one isolated writer; freeze and hand off its patch before the main context writes.
- Provide only the raw evidence needed for the role.
- Withhold preferred answers, builder rationale, and hidden acceptance results from independent roles.
- Forbid subagents from committing, merging, adopting, expanding scope, changing the oracle, or declaring completion.
- Treat project rules as effect constraints, not automatic proof that their oracle is fit; unresolved authority stays external.
- Treat their output as evidence, never authority.

## Planner

Use a fresh read-only planner for ambiguity, unclear consumers, governance or oracle changes, cross-owner design, or expensive reversal.

Provide:

- objective, repository, and revision;
- project instructions and raw baseline evidence;
- effect and budget bounds.

Require:

- an authority and oracle classification before the mission contract;
- one mission contract with production or decision consumer, journey, non-goals, permitted surface, and budgets;
- at most three candidates when uncertainty warrants them;
- a recommendation based on outcome, reuse, verifiability, responsibility, and reversibility.

Require the planner to expose duplicate truth, proxy criteria, open-world inference, candidate-controlled oracles, and unsupported authority without overriding external authority. Require `blocked` when authority, consumer, or journey remains unresolved. The planner cannot edit or admit implementation.

## Candidate explorer

Use a fresh read-only explorer for one bounded repository question that narrows an expensive decision.

Require paths, symbols, commands, or runtime evidence. Do not delegate whole-mission design or final scope.

Use a writable candidate only for genuinely competing implementations. Require an exact patch and raw checks, never a commit.

## Evaluator

Use a fresh read-only evaluator after freezing the complete diff and evidence.

Provide:

- mission contract, source revision, and complete diff;
- commands, exit statuses, raw outputs, consumer journey, and project rules.

Exclude builder explanation and proposed verdict.

Require the evaluator to try to falsify:

- outcome and consumer closure;
- regression safety and owner/authority consistency;
- oracle provenance, independence, and connection to the outcome;
- surface delta, cleanup, and terminal correctness.

Contract compliance alone is not acceptance. If raw evidence invalidates the frozen oracle, require `replan` or `blocked`; the evaluator cannot rewrite it.

Require exactly `accept`, `revise`, `replan`, or `blocked`, with reproducible findings. The main context owns the terminal.

## Context hygiene

Start roles fresh and rebuild input from repository state and raw artifacts, not conversation summaries. Do not reuse an evaluator exposed to builder deliberation.

If fresh evaluator isolation is unavailable, a writable mission cannot be accepted; terminate `blocked`.
