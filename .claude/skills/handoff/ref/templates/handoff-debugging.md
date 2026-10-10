# Handoff — {{bug_title}} (debugging)

> Generated: {{utc_timestamp}} · Continues from: {{prev_handoff_path_or_none}}
> Variant of the general template, tuned for an in-progress investigation. Read top-to-bottom.

## Metadata
- Project: {{project_path}}
- Git branch: {{git_branch}} · HEAD: {{git_head_short}} · Tree: {{clean_or_dirty}}
- Agent / model: {{agent_model}}

## Current State (read this first)
{{where_the_investigation_stands_right_now}}
- Blocking right now: {{blocker_or_none}}

## Symptom (verbatim)
- Repro: {{exact_steps_or_command}}
- Observed: {{verbatim_error_or_wrong_output}}
- Expected: {{what_should_happen}}
- First seen / frequency: {{when_and_how_often}}

## Hypotheses
- [ ] {{hypothesis}} — status: {{open_supported_or_ruled_out}}; evidence: {{evidence}}

## What is RULED OUT — DO NOT REDO
- [x] {{checked_path_and_why_it_is_not_the_cause}}

## Evidence gathered
- {{log_line_stack_frame_value_with_file_line}}

## Leading suspect
{{current_best_explanation_with_file_line}}

## Immediate Next Step
{{the_single_exact_next_probe eg add log at src/x.ts:88 then re-run the repro}}

## Files / Areas Touched
<read-files>
{{files_read_one_per_line}}
</read-files>
<modified-files>
{{files_modified_one_per_line}}
</modified-files>

## Gotchas / Landmines
- {{flaky_env_or_red_herring}} — note: {{detail}}

## Verification (copy-paste, exact)
```bash
{{repro_command}}
{{regression_test_command}}
```
Expected once fixed: {{healthy_result}}

## Open Questions (preserve verbatim)
- {{unanswered_user_question_or_NONE}}

## Handoff Chain
- Continues from: {{prev_handoff_path_or_none}}
- This doc: {{this_handoff_path}}
