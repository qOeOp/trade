# Fresh-context role protocols

Load only when the mission needs an independent planner, candidate, or evaluator.

Implement roles with custom or generic subagents. Select by capability, not name. UI metadata does not register agents.

## Shared rules

- Keep scope, admission, integration, and terminal ownership in the main context.
- Prefer read-only roles. Allow one isolated writer; freeze and hand off its patch before the main context writes.
- Provide only the raw evidence needed for the role.
- Withhold preferred answers, builder rationale, and hidden acceptance results from independent roles.
- Forbid subagents from committing, merging, adopting, expanding scope, changing the oracle, or declaring completion.
- Only the main mission context may integrate a patch or perform an explicitly authorized commit, push, PR, review submission or response, merge, or cleanup effect.
- Treat project rules as effect constraints, not automatic proof that their oracle is fit; unresolved authority stays external.
- Treat their output as evidence, never authority.

## Planner

Use a fresh read-only planner for ambiguity, unclear consumers, governance or oracle changes, cross-owner design, or expensive reversal.

Provide:

- objective, repository, and revision;
- project instructions and raw baseline evidence;
- external effect and cumulative-budget ceilings, not a preselected execution mode or candidate.

Require:

- an authority and oracle classification before the mission contract;
- one mission contract with the outcome consumer, adoption or usage journey, non-goals, and the minimum permitted surface and budgets within those ceilings;
- at most three candidates when uncertainty warrants them;
- a recommendation based on outcome, reuse, verifiability, responsibility, and reversibility.

Require the planner to expose duplicate truth, proxy criteria, open-world inference, candidate-controlled oracles, and unsupported authority without overriding external authority. Require unresolved authority, outcome consumer, or journey to be reported as external blockers so the main context can apply the ordered terminal rules. The planner cannot edit or admit implementation.

## Candidate explorer

Use a fresh read-only explorer for one bounded evidence question that narrows an expensive decision.

Provide the question or claim, source revision or retrieval horizon, search scope and exclusions, and stop or cost bound.

Require one compact evidence packet:

- `supported`, `refuted`, or `unresolved` claim status;
- direct paths and lines, symbols, authoritative source URLs with version or publication/update and retrieval status, exact commands with status and relevant raw excerpts, or artifact hashes;
- inspected coverage and exact negative searches;
- conflicts, gaps, and bounded uncertainty.

Transmit evidence, not investigation process. Exclude search chronology, hidden reasoning, and builder rationale, but retain coverage and negative evidence needed to audit false negatives. Do not delegate whole-mission design, final scope, adoption, or terminal judgment.

Use a writable candidate only for genuinely competing implementations. Require an exact patch and raw checks, never a commit.

## Evaluator

Use a fresh read-only evaluator after freezing the complete result or diff and evidence.

Provide:

- mission contract, source revision, and complete read-only result or diff;
- the evaluator protocol retrieved from that exact source revision, with its content hash; a candidate or working-tree copy is not a substitute;
- exact candidate commit and PR head when either exists, plus the exact acceptance-tree hash; when that tree differs from the candidate tree, provide the prospective merge or merge-group tree, base/head identities, integrated diff, and receipts bound to it;
- commands, exit statuses, raw outputs, consumer journey, and project rules.

Exclude builder explanation and proposed verdict.

Require the evaluator to try to falsify:

- outcome and outcome-consumer closure;
- regression safety and owner/authority consistency;
- oracle provenance, independence, and connection to the outcome;
- surface delta, cleanup, and terminal correctness.

For writable work, return candidate-bound evidence judgments for:

- `change_necessity`: whether the frozen outcome and consumer require a write of this kind and scope among the explicitly inspected lower-effect alternatives;
- `responsibility_fit`: whether changed responsibility stays with an authorized owner, reaches the real consumer, and adds no duplicated, unused, or accidental responsibility;
- `cleanup`: whether known superseded, failed, temporary, compatibility, and evidence-scaffolding paths are removed within the inspected scope.

For each judgment, provide `supported`, `refuted`, `unresolved`, or `not_applicable`; the bounded claim; direct evidence; inspected scope; limits; and the terminal consequence. Apply the evidence standard in `SKILL.md` before assigning status: caller summaries and passing-check claims alone cannot support a judgment. Do not infer necessity or fit from outcome improvement, LOC, file counts, or zero net surface, and do not claim global minimality. Justify `not_applicable`. A material `refuted` or `unresolved` judgment cannot accompany `accept`: use `revise` when a same-design correction remains within budget, `replan` when a permitted redesign remains within budget, `invalidated` when intrinsic evidence shows no design can satisfy the frozen external bounds, `budget_exhausted` when a potentially valid next step remains but a revision, non-progress, cost, or escalation budget is spent, and `blocked` when a required external fact, permission, or authority remains unavailable while the relevant budgets remain. Bind judgments to the exact candidate patch or content hash; a candidate change makes them stale.

For high-impact read-only work, classify authority, consumer closure, and non-write responsibility or effects instead of inventing code judgments. Distinguish no repository write from decision, access, cost, governance, or other effects.

Contract compliance alone is not acceptance. If raw evidence invalidates the frozen oracle, require `replan`, `invalidated`, `budget_exhausted`, or `blocked` under the ordered rules in `SKILL.md`; the evaluator cannot rewrite it.

For an admitted evaluation, require exactly `accept`, `revise`, `replan`, `blocked`, `invalidated`, or `budget_exhausted`, with reproducible findings. The main context owns the terminal.

Bind the verdict to the supplied acceptance tree and candidate identity. Any acceptance-tree, content, or candidate-commit change requires a new evaluator that has not seen the new builder deliberation. A local evaluator does not substitute for a required remote code review, and a remote review does not substitute for this evaluator when the mission requires one.

## Context hygiene

Start roles fresh and rebuild input from repository state and raw artifacts, not conversation summaries. Load the evaluator protocol from the supplied source revision before inspecting the candidate; stop without evaluation if those exact bytes cannot be retrieved. Do not reuse an evaluator exposed to builder deliberation.

Evaluators must not invoke live agent or thread enumeration, lifecycle, history, or transcript APIs, or consume live sibling outputs, because those responses can disclose planner or builder deliberation. This does not bar inspection of committed candidate source, complete diffs, or test fixtures for those surfaces. Keep live agent lifecycle checks in the main context and outside evaluator evidence. A main-frozen contract or admitted evidence may originate from a planner, but if raw planner or builder deliberation, unadopted recommendations, or sibling results appear, stop without a candidate judgment or disposition; the main context must discard that run and launch a fresh evaluator with sanitized input.

If fresh evaluator isolation is unavailable for a mission that requires one, it cannot be accepted; report the unavailable external requirement and apply the ordered terminal rules.
