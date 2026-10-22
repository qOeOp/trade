---
name: research-start
description: Starts or resumes strategy research in this repository - reads the ledger first and continues a selected research line, otherwise presents the latest recommendation and line options (template roots only when there is no candidate or the user leaves every line), waits for the user's choice and records it, and checks readiness before the first replay or when new data arrives. Use at the start of every research session or after an interruption, whenever the user asks to start, restart or change research direction, and when work inside a line decides the line should change.
---

# Research start

Commands are the product CLI (`uv run --frozen python -m cli.main <noun> <verb>`, see `research-round`).
A research line is a starting candidate, a development window and a pinned market commit the user
selected (`line select`); everything inside it follows `research-round`.

## Read the ledger first

- At every start or return from an interruption, read the ledger before anything else: whether
  the service is up (`ledger service status`), the candidates (`candidate list`), the counts
  (`research status`), the research state and the current line record (`research state`). When a
  line record exists the user has chosen: continue it under `research-round` without asking again,
  taking the user's two research targets from its note.
  Handoff files and session memory are not records; a conclusion they hold that the ledger does
  not is not used.
- When `research state` lists `unclosed_lines`, close them without waiting: hand them to a
  background sub-agent (on a host without one, do it before the session ends). For each line, read
  it as it ended (`research state --line LINE --at COMMIT`, the commit the list gives), write its
  summary as `line close --help` describes and close it; a failure is retried at the next start.

## Offer lines and wait

Present the latest recommendation and the line options ([recommendation.md](references/recommendation.md)).

- End with a question once the options are given. Until the user chooses, do not register,
  replay, publish or write a line record, and never treat the first recommendation as chosen.
- List template roots (research-round's [template.md](../research-round/references/template.md))
  only when the ledger has no candidate or the user says to leave every existing line, each with
  its first report on the current development window or marked not yet replayed. A loss, an
  insignificant result, a low priority, a review count, a run limit or a fault never brings up
  roots: give the recommendation and priorities inside the line. A root from a user source is made
  only when the user gives the source.

When the user chooses, check readiness ([readiness.md](references/readiness.md)); a new root is
then published, prechecked and reviewed (research-round's template.md, First report). Record the
choice once with `line select` (`--help`), its note stating the user's two research targets.
The targets are the reference for reading reports; ask for nothing else (no coins, sizing,
budgets or stages).

- Before continuing into `research-round`, establish the host Goal for the selected line. Reuse
  an active Goal for this line. Otherwise compose the objective yourself from its bundle/start,
  the user's two targets and the stopping rule: reports, reviews and priorities do not end the
  work; only the user or a line that cannot continue does. Create it automatically when the host
  permits it. If creation needs explicit user authorization, present that concrete objective and
  ask for authorization; create after approval, never infer approval from silence. If no Goal
  tool exists, ask the user to activate the exact `/goal <objective>` (Codex) or `/loop <objective>`
  (Claude Code) command and verify activation before research. Never set a token budget unless
  requested. Confirm the active Goal in one line; do not mark it complete while the line can continue.

## When to read the references

- [readiness.md](references/readiness.md): before the first replay of a line, when a coverage
  receipt shows a gap, zero volume or missing funding, and when a new month of data arrives.
- [recommendation.md](references/recommendation.md): whenever the entry presents the
  recommendation and line options.
- [selection.md](references/selection.md): when the user's choice comes with an idea, a source or
  an authorization for a template.
