# Post-mission meta loop

Load only after the object mission terminates or when changing this skill package.

Run one bounded retrospective. Do not reopen implementation, alter the object terminal, or create another mission.

## Inputs

Use only:

- frozen contract and terminal;
- complete accepted or rejected diff;
- raw consumer, quality, and evaluator evidence;
- observed workflow friction or missed signals.

## Classify findings

Classify findings as:

- `task_local`: report it with the mission; do not persist it in the skill;
- `project_specific`: leave it to project authority or a separately admitted follow-up;
- `generic_workflow_defect`: eligible for a skill candidate;
- `unsupported`: discard it.

Default to `no_change`. One weak project oracle remains project-specific; a repeatable failure to audit authority, proxies, duplicated truth, candidate-controlled acceptance, or trigger coverage is a generic workflow defect.

## Candidate admission

Before editing, freeze a minimal behavior scenario and reproduce the defect with the current skill. Admit at most one candidate, which must:

- fix that replayable generic failure;
- remain useful without the triggering repository, document layout, tools, or domain vocabulary;
- change reusable capability or procedure;
- make the smallest justified instruction or resource change instead of appending a special case;
- give every new resource a distinct loading or execution lifecycle;
- report instruction, resource, default-context, and maintenance deltas as evidence, never as the verdict;
- keep project and user authority outside the skill.

Object and meta changes must remain separate. A project candidate cannot carry a skill edit.

## Evaluation

Freeze the candidate. Compare old and new skills on:

- the failing scenario, one valid-oracle control, and one different task shape;
- trigger accuracy, authority preservation, genericity, and prior passing behavior;
- behavioral gain against context and maintenance cost without fixed size quotas.

Use a fresh evaluator that has not seen the edit rationale. Preserve task, trajectory, verdict, and bounded cost evidence. Reject candidates that improve only a proxy, change the oracle, specialize the package, hide growth by moving text, or lack strict improvement.

The candidate cannot define acceptance, approve itself, or rewrite evidence. External adoption affects only later missions.

## Output

Return exactly one meta outcome:

- `no_change`: no generic defect or no strict improvement;
- `candidate_proposed`: one bounded external proposal with evidence and instruction-surface delta;
- `blocked`: required independent evidence or adoption authority is unavailable.

Improve by becoming clearer and more general, never by accumulating project history.
