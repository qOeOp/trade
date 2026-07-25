# Post-mission learning review

Load only after the mission terminates or when changing this skill package.

Run one bounded learning review. Do not reopen implementation, alter the mission terminal, or create another mission.

## Inputs

Use only:

- frozen contract and terminal;
- complete accepted or rejected diff;
- raw consumer, quality, and evaluator evidence;
- publication, current-head check, review, merge, and cleanup receipts when the mission included them;
- observed workflow friction or missed signals.

## Classify findings

Classify findings as:

- `task_local`: report it with the mission; do not persist it in the skill;
- `project_specific`: leave it to project authority or a separately admitted follow-up;
- `generic_workflow_defect`: eligible for a skill candidate;
- `unsupported`: discard it.

Default to `no_change`. One weak project oracle remains project-specific; a repeatable failure to audit authority, proxies, duplicated truth, candidate-controlled acceptance, or trigger coverage is a generic workflow defect.

## Handoff admission

Before emitting `candidate_proposed`, freeze a minimal behavior scenario and reproduce the defect with the current skill. Prepare at most one handoff, which must:

- describe a minimum candidate that would fix that replayable generic failure;
- remain useful without the triggering repository, document layout, tools, or domain vocabulary;
- change reusable capability or procedure;
- make the smallest justified instruction or resource change instead of appending a special case;
- give every new resource a distinct loading or execution lifecycle;
- report instruction, resource, default-context, and maintenance deltas as evidence, never as the verdict;
- keep project and user authority outside the skill.

Mission changes and proposal-candidate changes must remain separate. A project candidate cannot carry a skill edit.

## Proposal mission evaluation

Only a separately admitted learning-proposal mission may write and freeze the candidate. Compare old and new skills on:

- the failing scenario, one valid-oracle control, and one different task shape;
- trigger accuracy, authority preservation, genericity, and prior passing behavior;
- behavioral gain against context and maintenance cost without fixed size quotas.

Use a fresh evaluator that has not seen the edit rationale. Preserve task, trajectory, verdict, and bounded cost evidence. Reject candidates that improve only a proxy, change the oracle, specialize the package, hide growth by moving text, or lack strict improvement.

The candidate cannot define acceptance, approve itself, or rewrite evidence. If strict improvement is absent, reject the candidate and end the proposal mission without publication; do not reinterpret the source review outcome. External adoption affects only later missions.

## Output

Return exactly one learning outcome:

- `no_change`: no generic defect;
- `candidate_proposed`: one bounded external proposal handoff with the source revision, replayable generic failure, frozen failing scenario, valid-oracle control, different task shape, minimum candidate scope and effect ceiling, available standing authority, and expected instruction, resource, default-context, and maintenance deltas;
- `blocked`: evidence or authority required by the current requested terminal is unavailable; missing optional standing authority for a later proposal mission does not block a read-only `candidate_proposed` handoff.

The review ends after emitting the outcome and never writes the candidate. A main context may consume a `candidate_proposed` handoff in one separate, non-recursive learning-proposal mission only when external standing authority already covers the exact effects. That mission must freeze the candidate, compare old and new behavior on all three scenarios, use a fresh evaluator, and satisfy project gates. Standing authority may allow commit, push, and one Draft PR; it does not imply Ready, merge, deployment, provider-setting changes, or external-authority changes. Without matching authority, preserve the handoff and stop.

Improve by becoming clearer and more general, never by accumulating project history.
