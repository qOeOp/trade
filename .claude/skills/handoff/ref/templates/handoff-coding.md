# Handoff — {{feature_name}} (feature build)

> Generated: {{utc_timestamp}} · Continues from: {{prev_handoff_path_or_none}}
> Variant of the general template, tuned for building a feature mid-flight. Read top-to-bottom.

## Metadata
- Project: {{project_path}}
- Git branch: {{git_branch}} · HEAD: {{git_head_short}} · Tree: {{clean_or_dirty}}
- Agent / model: {{agent_model}}

## Current State (read this first)
{{what_compiles_what_runs_what_is_half_done}}
- Blocking right now: {{blocker_or_none}}

## Goal / Acceptance criteria
{{the_feature_and_what_done_means}}
- [ ] {{acceptance_criterion_1}}
- [ ] {{acceptance_criterion_2}}

## Design / Approach (with rationale)
- **{{design_choice}}**: {{why_this_over_alternatives}}

## Progress
### Done — DO NOT REDO ({{quantified eg 4 of 6 endpoints}})
- [x] {{built_and_verified_item_with_path_line}}
### In Progress
- [ ] {{the_one_thing_in_flight_and_its_exact_partial_state}}
### Pending
- [ ] {{remaining_slices_ranked_by_impact}}

## Immediate Next Step
{{the_single_exact_first_action eg implement handler at src/x.ts:42 then run the failing test}}

## Files / Areas Touched
- `{{path}}` — {{what_changed_and_why}}
<read-files>
{{files_read_one_per_line}}
</read-files>
<modified-files>
{{files_modified_one_per_line}}
</modified-files>

## Conventions to match
- {{naming_error_handling_test_layout_pattern_in_this_repo}}

## Tests
- New/affected: `{{test_paths}}`
- Last run: {{pass_fail_counts}} — {{verbatim_failure_if_any}}

## Gotchas / Landmines
- {{trap}} — workaround: {{workaround}}

## Verification (copy-paste, exact)
```bash
{{build_command}}
{{test_command}}
{{lint_or_typecheck_command}}
```
Expected: {{healthy_result}}

## Open Questions (preserve verbatim)
- {{unanswered_user_question_or_NONE}}

## Handoff Chain
- Continues from: {{prev_handoff_path_or_none}}
- This doc: {{this_handoff_path}}
