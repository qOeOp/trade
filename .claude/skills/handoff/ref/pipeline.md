# The handoff pipeline (full detail)

This is the long form of the summary in `SKILL.md`. It mirrors oh-my-pi's handoff-generation
pipeline (`docs/handoff-generation-pipeline.md`, `compaction/prompts/handoff-document.md`) adapted
to a file-writing skill.

Mental model: **gather → structure → write → verify → resume**. You are writing for *another
instance of yourself* that has **no access to this conversation**. If a fact is not in the document,
it does not exist for the next agent.

---

## 0. Preflight guard

Capture the known goal and next action even in an early session. If neither exists, reply
`Nothing to hand off yet`. Never fabricate progress or use message/file counts to reject a useful handoff.

## 1. Gather state mechanically, not from memory

Recall is unreliable for exactly the things a resume depends on: paths, symbol names, counts, error
text. Derive them from evidence instead.

- **Read-set / modified-set.** From your own tool history, list every file you opened (read-set) and
  every file you wrote or edited (modified-set). A file that was only read does not belong in the
  modified-set. oh-my-pi emits these as `<read-files>` / `<modified-files>` tags derived from tool
  calls, not from the model's recollection — do the same.
- **Commands + results.** Capture commands run and their outcomes, especially the last test/build/
  lint run. Quote failures and error messages **verbatim**.
- **Live repo state.** Run read-only probes and record the output:
  ```bash
  git rev-parse --abbrev-ref HEAD   # branch
  git rev-parse --short HEAD        # HEAD commit
  git status --porcelain            # clean vs dirty, untracked
  ```

## 2. Preserve the open thread

Find any unanswered question, request, or imperative still awaiting the user or caller — e.g.
"please run X and paste the output", an unresolved design choice, a pending approval. Capture it
**verbatim**. This is the single most resumption-critical item and the most common cold-resume
failure: the new agent silently drops the thread and does the wrong thing. It goes into **Open
Questions**, and into **Current State** as the blocker if it gates the next step.

## 3. Structure into the fixed template

Fill `ref/templates/handoff.md` section by section, in the fixed order, so a resuming agent always
finds each part in the same place. Section discipline:

- **Current State first.** One paragraph of what is true *right now* + the active blocker. This kills
  the "where was I" re-establishment cost.
- **Done = DO NOT REDO, quantified, with evidence.** "30/90 tests passing", "4 of 6 endpoints done",
  each line with a concrete path:line or command output. Duplicated work is the most expensive
  failure mode; label finished work loudly.
- **One Immediate Next Step.** Not a list — the single exact first action ("run `npm test
  src/auth.test.ts`; it fails at line 42 on a null token — fix `getToken()` in `src/auth.ts:18`").
- **Decisions WITH rationale.** The *why*, not just the *what*, so the next agent does not relitigate
  or silently reverse a settled choice.
- **Concrete over abstract.** Real file:line references, real symbol/type names, exact commands, real
  error text. "Capture exact technical state, not abstractions."

## 4. Self-verify before writing

Run `ref/checklists/quality.md`. Reject and fix the draft if it:
- contains secrets / tokens / keys;
- still has unfilled placeholders (`{{...}}`, `[TODO]`);
- uses vague abstractions instead of concrete paths/commands;
- lacks copy-pasteable verification commands;
- omits a preserved open question that actually exists.

## 5. Write the file

Save to `handoffs/handoff-<UTC-timestamp>.md` **in the working project** (not in this skill's repo).
The timestamp is ISO 8601 with `:` and `.` replaced by `-` — oh-my-pi's `createHandoffFileName`:

```
new Date().toISOString().replace(/[:.]/g, "-")  ->  handoff-2026-05-30T12-00-00-000Z.md
```

Create the `handoffs/` directory if missing. **Chaining:** if a prior handoff exists, set the
Handoff Chain `Continues from` link, and when re-handing-off, *merge* rather than overwrite — keep
all still-relevant prior info, promote In Progress → Done, refresh Next Steps and drop or update
stale pending questions (oh-my-pi's `compaction-update-summary` pattern).

## 6. Emit the resume primitive + report

Print:
1. the absolute saved path, and
2. a one-line summary of the state, then
3. the ready-to-paste resume block (oh-my-pi's `createHandoffContext` wrapper, verbatim):

```
<handoff-context>
…the full handoff document…
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

Do **not** continue the task or answer the conversation's questions. Output only the artifact and
where it lives.

## 7. Auto-continue note (automatic trigger only)

On a threshold/automatic trigger (context near full, no human steering at that moment), append a
short note instructing the resuming agent to **honor the user's latest intent over older recorded
plans**, and to say so briefly if nothing remains rather than inventing busywork. On a manual
trigger, omit this — the user is present and steering.

---

## Cold-resume failure modes (what this pipeline defends against)

| Failure | Cause | Defense in this pipeline |
|---|---|---|
| Redoes finished work | "Done" not labeled / not quantified | Done section, DO NOT REDO, with evidence (step 3) |
| Starts in the wrong place | Vague or multi-item next steps | One Immediate Next Step (step 3) |
| Drops the user's pending request | Open thread not captured | Preserve open thread verbatim (step 2) |
| Reverses a settled decision | Rationale missing | Key Decisions with the *why* (step 3) |
| Edits the wrong files | Blast radius unknown | Mechanical read/modified sets (step 1) |
| Trusts a stale doc | No environment anchor | Metadata git branch/HEAD + `check-staleness.sh` |
| Hallucinated paths/counts | Written from memory | Gather mechanically, never from recall (step 1) |
| Leaks credentials | Pasted raw command output | Quality gate rejects secrets (step 4) |
