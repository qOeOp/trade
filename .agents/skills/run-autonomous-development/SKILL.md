---
name: run-autonomous-development
description: Turn a broad product direction, ambiguous engineering request, cross-module change, or unattended coding assignment into bounded vertical slices that are designed, implemented, independently evaluated, corrected, and delivered with runtime evidence. Use for long-running or autonomous development, vague idea-to-code requests, multi-step features, migrations, architectural corrections, repeated agent iteration, black-box factory development, or requests to plan and execute the whole task without human decomposition. Do not use for a small explicit edit, a read-only explanation, or the repository's strategy R&D workflow.
---

# Run Autonomous Development

Treat the user's prompt as an objective, not as permission for unlimited implementation. Keep one main context as the sole owner of scope, state, candidate selection, and integration. Use subagents as disposable search or evaluation contexts; never let them redefine the objective or merge independently.

Read `AGENTS.md`, `docs/README.md`, and `docs/engineering/development-convergence.md` before changing code.

Use Codex's native surfaces instead of building another loop:

- use the working plan to synthesize and track the mission contract;
- when the user explicitly starts a persistent Goal, let Goal mode continue the mission, but keep this skill's budgets and terminal states authoritative;
- prefer the project `mission_planner` and `mission_evaluator` custom agents;
- use subagents for bounded read-heavy search and falsification, and an isolated worktree for any competing writable candidate;
- use existing owner MCP tools for domain actions;
- for hosted execution, reuse `agent-run-contract`, `agent-host-codex`, and `agent-workspace-manager`.

Do not use a Stop hook, scheduled task, or shell loop to force the same mission to continue forever. Scheduled tasks are suitable for tested recurring drift scans, garbage collection, or monitoring, not for silently expanding one coding objective.

## Community workflow adapters

Do not recreate a generic coding methodology inside this repository. When available:

- use Superpowers for brainstorming, worktree setup, TDD, task-level review, and verification discipline;
- evaluate BMad Method / bmad-loop for deterministic story orchestration, fresh implementation and review contexts, retry budgets, and resumable run state.

Treat both as candidate producers, never as acceptance authority. Before adopting or upgrading either one, run one bounded mission bake-off against this skill's frozen consumer journey and compare completion quality, responsibility delta, retries, and removable code. Reject any integration that creates a second product contract, lifecycle owner, task database, quality oracle, or merge authority. During the convergence recovery period, do not install a repository-wide orchestrator or its hooks without explicit user approval.

## 1. Establish the baseline

Inspect the worktree, applicable contracts, current runtime entry, and relevant tests. Preserve unrelated dirty changes.

Write a concise mission contract in the working plan:

- objective and user-observable outcome;
- current observed failure or missing behavior;
- production consumer and exact runtime, CLI, or server journey;
- in-scope and out-of-scope paths or behavior;
- acceptance checks with observable pass signals;
- owner surfaces to reuse and maximum permitted surface delta;
- iteration budget and escalation conditions.

If the mission may cross compaction, restart, or six slices, persist only its contract, progress, decisions, and raw evidence under ignored `tmp/autonomous-development/<task-id>/`. Treat those files as resumable run state, never as product or architecture authority.

Default budgets unless the task clearly needs tighter limits:

- at most 3 design candidates at a decision point;
- one editing agent at a time;
- at most 3 implementation revisions per vertical slice;
- replan after 2 consecutive cycles without acceptance progress;
- at most 6 accepted slices before recontracting the remaining objective.

Do not implement while the production consumer or acceptance journey is unknown. Run a bounded investigation instead. If no existing consumer can own the behavior, choose among wiring, consolidation, or deletion; adding an owner requires explicit user approval.

## 2. Challenge the request and design

Check whether the stated solution is necessary and whether the same outcome can be reached by wiring or deleting existing inventory. Look for contradictions among product, architecture, runtime, and module contracts.

Use 2–3 independent read-only subagents only when a decision is expensive to reverse, crosses owners, or has meaningful design uncertainty. Prefer `mission_planner` for contract/design work. Give each the objective and raw repository evidence, not the preferred answer. Ask for distinct candidates or an adversarial review.

Select with a predeclared rubric:

1. directly produces the user outcome;
2. reuses an existing owner and production consumer;
3. is verifiable through the real journey;
4. has the smallest responsibility and maintenance delta;
5. is reversible and leaves no parallel authority.

Record why rejected candidates lost. Do not combine their features into a larger compromise unless the evidence requires it.

## 3. Build a vertical task graph

Decompose the objective into dependency-ordered vertical slices. Each slice must end in an observable behavior through a real consumer; a package, schema, helper, document, mock, or unit test alone is not a slice.

Prefer the first slice that closes the thinnest end-to-end path. Put only one slice in progress. A discovered improvement is not automatic scope: classify it as:

- required for current acceptance;
- follow-up evidence for later prioritization;
- rejected as irrelevant or unjustified.

Only the first class may expand the active slice.

Before editing a slice, state:

- baseline reproduction;
- intended behavior delta;
- expected files or owner surfaces;
- consumer verification;
- regression checks;
- explicit non-goals.

## 4. Run the implementation loop

For each slice:

1. Reproduce the baseline or demonstrate the missing connection.
2. Implement the smallest coherent change.
3. Inspect the complete diff for stubs, fake success, duplicated authority, unused production code, and accidental scope.
4. Run focused checks, then exercise the production consumer and capture the observable result.
5. Give `mission_evaluator` the task contract, diff, commands, and raw outputs. Do not give it the builder's justification. Require it to try to falsify completion and inspect design consistency.
6. Decide:
   - accept when every criterion passes;
   - revise for a localized implementation defect;
   - replan when the same root cause recurs or evidence does not improve twice;
   - stop when authority, safety, or objective ambiguity requires the user.

Never respond to a failed cycle by adding speculative layers, tests that only bless the current implementation, or another module. A replan may replace or delete the attempted implementation.

After a slice is accepted, run the applicable changed gate. Run the repository submission gate only when the complete behavior closure is ready, as required by `AGENTS.md`.

## 5. Enforce anti-entropy

Count responsibility and runtime surface, not productivity by commits, files, tests, or lines.

- Keep module owner, tool, domain, store, job, and rail counts within the frozen baseline.
- Require every new production symbol or path to be reached by the named consumer.
- Delete superseded implementations and temporary compatibility paths in the same closure when safe.
- Do not commit work in progress, failed candidates, generated exploration, or evidence-only scaffolding.
- Do not raise a quality threshold or weaken an acceptance check to make the implementation pass.
- Freeze acceptance before implementation. Changing an oracle invalidates the candidate and requires contract review outside the writable implementation context.
- Never accept caller-supplied `verified` or `strict_improvement` booleans. Bind receipts to the mission hash, source revision, patch hash, exact command, exit status, and output or artifact hash.
- Keep temporary plans and candidate artifacts out of long-term product memory.

An iteration is valid only if it improves at least one failing acceptance signal without regressing a passing one or increasing unapproved authority. Otherwise it consumes the non-progress budget.

## 6. Terminate correctly

Do not run an unbounded “until perfect” loop. A factory may complete many bounded mission contracts; one mission must end in exactly one of:

- `completed`: all acceptance checks pass through the real consumer;
- `blocked`: an external fact, permission, or missing authority prevents progress;
- `invalidated`: evidence shows the objective or selected design is wrong;
- `budget_exhausted`: the revision or non-progress budget is spent.

`invalidated` and `budget_exhausted` are honest outcomes, not prompts to continue silently. Recontracting requires a new evidence-based design or user decision.

## 7. Deliver the evidence packet

Report:

- user-observable behavior delivered;
- production consumer and exact exercised journey;
- before/after evidence and quality results;
- accepted design and rejected alternatives;
- responsibility surface added, reused, and deleted;
- unresolved gaps, blockers, or follow-up evidence.

Do not claim completion from a green unit test, code volume, number of iterations, or quality-gate pass without the runtime journey.
