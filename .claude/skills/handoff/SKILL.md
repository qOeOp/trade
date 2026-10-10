---
name: handoff
description: Save task state in a structured Markdown handoff for a fresh-context agent. Use when asked to hand off, save state, or prepare a session for continuation.
---

# handoff

Write the document your next agent opens before it works. A handoff compacts everything that
matters about a long-running task into one structured markdown file, so an agent with an empty
context window resumes exactly where you left off — without re-reading the conversation.

## When to use

**Manual** — the user asked: a handoff / state save / "next plan of action". Write the file.
**Automatic checkpoint** — when the host requests a context handoff, write the file and append the auto-continue note (step 7). A file-edit count alone is not a reason to interrupt authorized work.

## Pipeline (summary)

**gather → structure → write → verify → resume**. Full detail in
[ref/pipeline.md](ref/pipeline.md).

0. **Preflight.** Capture the known goal and next action even if little work has happened. If neither exists, say "Nothing to hand off yet"; never fabricate progress.
1. **Gather mechanically.** Derive read/modified sets from tool history; capture commands, test output, and error text verbatim; confirm git branch/HEAD/dirty via read-only probes. Never trust recall.
2. **Preserve the open thread.** Capture any unanswered user question VERBATIM (the most-failed item) → Open Questions, and Current State if it blocks the next step.
3. **Structure.** Fill `ref/templates/handoff.md` — `-coding.md` for a feature build, `-debugging.md` for an investigation — in order: Current State first; Done labeled "DO NOT REDO" + quantified; ONE next step; decisions with rationale; concrete file:line / commands / real errors.
4. **Self-verify.** Run `ref/checklists/quality.md`; fix any secret, placeholder, vagueness, missing verify command, or dropped open question before writing.
5. **Write.** Save `handoffs/handoff-<UTC>.md` in the working project (ISO 8601, `:`/`.` → `-`, e.g. `handoff-2026-05-30T12-00-00-000Z.md`); chain and merge a prior handoff if one exists.
6. **Emit + report.** Print the path + a one-line summary, then the doc wrapped in `<handoff-context>…</handoff-context>` (exact wrapper in [ref/pipeline.md](ref/pipeline.md)) as the paste-ready resume block.
7. **(Auto trigger only)** Add the auto-continue note: honor the user's LATEST intent; say so if nothing remains.

## Reference files

- [ref/pipeline.md](ref/pipeline.md) — the full step-by-step pipeline and cold-resume failure modes
- [ref/templates/handoff.md](ref/templates/handoff.md) — the document template (general)
- [ref/templates/handoff-coding.md](ref/templates/handoff-coding.md) — feature-build variant
- [ref/templates/handoff-debugging.md](ref/templates/handoff-debugging.md) — bug/debug variant
- [ref/checklists/quality.md](ref/checklists/quality.md) — pre-write self-verification gate
- [ref/checklists/resume.md](ref/checklists/resume.md) — what the RESUMING agent does first
- [examples/](examples/) — filled handoffs you can imitate
- [scripts/check-staleness.sh](scripts/check-staleness.sh) — validate a handoff before trusting it

## Hard rules

- Capture exact technical state, not abstractions — paths, symbols, commands, real errors.
- Never include secrets, tokens, or keys.
- Producing the artifact is the whole job: reply with it and where it lives, and route the conversation's own questions into Open Questions rather than answering them.
- The file is the source of truth; the `<handoff-context>` block is its transport.
