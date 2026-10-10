# Quality checklist — run BEFORE writing the handoff file

A handoff that looks complete but fails one of these is worse than none: it gives the next agent
false confidence. Reject and fix the draft until every box is true.

## Safety
- [ ] No secrets, tokens, API keys, passwords, or private URLs anywhere in the document.
- [ ] No raw credential-bearing command output pasted in (redact before including).

## Completeness
- [ ] Every `{{placeholder}}` is filled or the line is removed — no `{{...}}`, no `[TODO]` left.
- [ ] Current State is one concrete paragraph describing what is true RIGHT NOW.
- [ ] Done items are quantified and labeled DO NOT REDO, each with evidence (path:line or output).
- [ ] There is exactly ONE Immediate Next Step, and it is a concrete action — not a list.
- [ ] Every Key Decision has its rationale (the *why*).

## Concreteness (no abstractions)
- [ ] File references are real `path:line`, not "the auth file".
- [ ] Symbol/type/function names are the real ones from the code.
- [ ] Commands are exact and copy-pasteable, not paraphrased.
- [ ] Error text is quoted verbatim, not summarized.

## Resumability
- [ ] The mechanically-derived `<read-files>` / `<modified-files>` reflect actual tool history.
- [ ] Metadata records the live git branch + HEAD + clean/dirty (from `git rev-parse`/`status`).
- [ ] The Verification block has commands a fresh agent can run immediately, plus expected result.
- [ ] Any unanswered user/caller question is preserved VERBATIM in Open Questions.
- [ ] If a prior handoff exists, the Handoff Chain `Continues from` link is set and content merged.

## Discipline
- [ ] The document does NOT continue the task or answer the conversation's questions.
- [ ] Output is the artifact + its path only (plus the `<handoff-context>` resume block).
