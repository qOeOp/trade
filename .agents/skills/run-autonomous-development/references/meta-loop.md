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

Default to `no_change`. Missing context, a weak project oracle, a local bug, or one-repository preference is not generic.

## Candidate admission

Before editing, freeze a minimal behavior scenario and reproduce the defect with the current skill. Admit at most one candidate, which must:

- fix that replayable generic failure;
- remain useful without the triggering repository, document layout, tools, or domain vocabulary;
- change reusable capability or procedure;
- replace, compress, or delete guidance instead of appending a special case;
- add no reference file and not increase the total word count of `SKILL.md` plus `references/*.md`;
- keep project and user authority outside the skill.

Object and meta changes must remain separate. A project candidate cannot carry a skill edit.

## Evaluation

Freeze the candidate. Compare old and new skills on:

- the failing scenario and one different task shape;
- deterministic structural checks and exact instruction/file-count delta;
- trigger accuracy, genericity, and prior passing behavior.

Use a fresh evaluator that has not seen the edit rationale. Preserve task, trajectory, verdict, and bounded cost evidence. Reject candidates that improve only a proxy, change the oracle, specialize the package, hide growth by moving text, or lack strict improvement.

The candidate cannot define acceptance, approve itself, or rewrite evidence. External adoption affects only later missions.

## Output

Return exactly one meta outcome:

- `no_change`: no generic defect or no strict improvement;
- `candidate_proposed`: one bounded external proposal with evidence and instruction-surface delta;
- `blocked`: required independent evidence or adoption authority is unavailable.

Improve by becoming clearer and more general, never by accumulating project history.
