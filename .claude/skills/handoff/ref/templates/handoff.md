# Handoff — {{title}}

> Generated: {{utc_timestamp}} · Continues from: {{prev_handoff_path_or_none}}
> Read this top-to-bottom. It is written so you can resume WITHOUT access to the prior conversation.

## Metadata
- Project: {{project_path}}
- Git branch: {{git_branch}} · HEAD: {{git_head_short}} · Tree: {{clean_or_dirty}}
- Agent / model: {{agent_model}}

## Current State (read this first)
{{one_paragraph_of_what_is_true_right_now}}
- Blocking right now: {{blocker_or_none}}

## Goal
{{specific_measurable_objective_the_user_wants}}

## Constraints & Preferences
- {{constraint_or_preference_1}}
- {{constraint_or_preference_2}}

## Progress
### Done — DO NOT REDO ({{quantified_progress eg 30/90 tests passing}})
- [x] {{done_item_with_specifics_and_evidence eg path:line, command output}}
### In Progress
- [ ] {{current_work_in_flight_and_exact_partial_state}}
### Pending
- [ ] {{mentioned_but_not_started_ranked_by_impact}}

## Immediate Next Step
{{the_single_exact_first_action_to_take eg run X / edit file:line to do Y}}

## Key Decisions
- **{{decision_1}}**: {{rationale_why_this_over_alternatives}}
- **{{decision_2}}**: {{rationale}}

## Files / Areas Touched
- `{{path_1}}` — {{purpose_and_what_changed}}
- `{{path_2}}` — {{purpose_and_what_changed}}
<read-files>
{{files_read_one_per_line}}
</read-files>
<modified-files>
{{files_modified_one_per_line}}
</modified-files>

## Key Patterns / Conventions
- {{convention_or_pattern_discovered_in_this_codebase}}

## Gotchas / Landmines
- {{known_issue_or_trap}} — workaround: {{workaround}}

## Verification (copy-paste, exact)
```bash
{{exact_command_1 eg npm test -- path/to.test}}
{{exact_command_2 eg git status}}
```
Expected: {{what_a_healthy_result_looks_like}}

## Open Questions (preserve verbatim)
- {{unanswered_user_or_caller_question_or_NONE}}

## Handoff Chain
- Continues from: {{prev_handoff_path_or_none}}
- This doc: {{this_handoff_path}}
