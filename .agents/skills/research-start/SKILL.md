---
name: research-start
description: Starts or resumes strategy research in this repository - reads the ledger first, continues a selected research line after an interruption and offers it beside the other lines at a new session, otherwise presents the latest recommendation and line options (template roots only when there is no candidate or the user leaves every line), waits for the user's choice and records it, and checks readiness before the first replay or when new data arrives. Use at the start of every research session or after an interruption, whenever the user asks to start, restart or change research direction, when work inside a line decides the line should change, and when checking coverage gaps or whether low-activity inferred quotes support a selected contract, period and liquidation scenario.
---

# Research start

Commands are the product CLI (`uv run --frozen python -m cli.main <noun> <verb>`, see `research-round`).
A research line is a starting candidate, a development window and a pinned market commit the user
selected (`line select`); everything inside it follows `research-round`.

## Read the ledger first

- At every start or return from an interruption, read the ledger before anything else: whether
  the service is up (`ledger service status`), the candidates (`candidate list`), the counts
  (`research status`), the research state and the current line record (`research state`), whose
  `targets` are the user's two research targets in force for the line (its own, else the ledger
  default). `candidate list`, `research state` and `research status` print large JSON: redirect
  each to a file under /tmp and read only the keys you need (for example with `jq`), such as
  `line`, `targets`, `gates`, `unclosed_lines`, `recommendation` and `unreviewed_trials`, never
  the whole output. After an interruption, or when the user
  says to continue, continue that line under `research-round` without asking. A new session started
  with only `research-start` asks once: continue the current line (its state and next step) or
  choose another line (Offer lines and wait).
  Handoff files and session memory are not records; a conclusion they hold that the ledger does
  not is not used.
- When `research state` lists a `RUNTIME_UNSUPPORTED` gate, the line's candidates are on a
  runtime contract this product no longer runs. Tell the user plainly that the line is on the old
  contract and can only be closed and research restarted on the new one; never offer to continue
  it, continue it after an interruption, or establish a Goal for it. Closing it is leaving the
  line (Offer lines and wait); the new line's `line select` ends it for `line close`. Research
  restarted on the new contract begins as a root ([template.md](../research-round/references/template.md)):
  published without a parent and registered with no parent, no control and empty `changed_duties`,
  its rationale carrying the old candidate's idea. An old-contract candidate is never its parent,
  since its runs can be neither replayed nor compared. An option that restarts from an
  old-contract candidate tells the user three things: the restart is a new rule, not the old one
  run again; its first report has no control; the old rule's results cannot be tested again.
- When `research state` lists `unclosed_lines`, close them without waiting: hand them to a
  background sub-agent (on a host without one, do it before the session ends). For each line, read
  it as it ended (`research state --line LINE --at COMMIT --full`, the commit the list gives), write its
  summary as `line close --help` describes and close it; a failure is retried at the next start.

## Offer lines and wait

Present the latest recommendation and the line options ([recommendation.md](references/recommendation.md)).

- End with a question once the options are given. Until the user chooses, do not register,
  replay, publish or write a line record, and never treat the first recommendation as chosen.
- A due line change (research-round) is offered here too, after the ledger reads above: this
  line beside the lines the ledger's other candidates could start (`candidate list`), each with
  the readings recommendation.md lists. New scopes or starting points inside this line are only
  some of the options.
- List template roots (research-round's [template.md](../research-round/references/template.md))
  only when the ledger has no candidate or the user says to leave every existing line, each with
  its first report on the current development window or marked not yet replayed. A loss, an
  insignificant result, a low priority, a review count, a run limit or a fault never brings up
  roots: give the recommendation and priorities inside the line. A root from a user source is made
  only when the user gives the source.

When the user chooses, check readiness ([readiness.md](references/readiness.md)); a new root is
then published, prechecked and reviewed (research-round's template.md, First report). Record the
choice once with `line select` (`--help`), with the user's two research targets as
`--max-drawdown` and `--annual-return` when the user states targets for this line; otherwise the
line reads the ledger default. When neither exists, ask the user for them. Record a later change
the user states with `line targets`, and never change targets on your own. Line notes and summaries
follow research-round's rule for ledger text (English, structured). The targets are the reference
for reading reports; ask for nothing else (no coins, sizing, budgets or stages).

- Before continuing into `research-round`, establish the host Goal for the selected line. Reuse
  an active Goal for this line. Otherwise compose the objective yourself from its bundle/start,
  the user's two targets and the stopping rule: reports, reviews and priorities do not end the
  work; only the user, a line that cannot continue or a due line change (research-round) does. Create it automatically when the host
  permits it. If creation needs explicit user authorization, present that concrete objective in
  the same question as the line choice; choosing to continue approves it. Create after approval,
  never infer approval from silence. If no Goal tool exists, ask the user to activate the exact
  `/goal <objective>` (Codex) or `/loop <objective>` (Claude Code) command and verify activation
  before research. Never set a token budget unless
  requested. Confirm the active Goal in one line; do not mark it complete while the line can continue.
- An active Goal continues a turn that ends with a question without waiting for the user. Under it,
  ask only what blocks the line (a due line change, an authority item, a data/scope choice that
  readiness.md calls for); decide anything else within
  your authority and say so in one line. Use the host's pause tool before asking only if it
  exists and the host currently permits it, including any required explicit user request; a tool
  is not permission. Otherwise combine the pause request/instructions and the blocking choice in
  one question and end the turn. On an unanswered continuation, keep that question pending and
  do no work depending on its answer. Apply only Goal state changes allowed by the host's
  permissions and thresholds (including `blocked`), then end the turn. Do not complete/recreate
  the Goal or add polling loops to evade those limits. Report a pause only after it succeeds.
  Never state an approval that no user message gives.

## Input checks inside an existing line

A coverage/readiness question within a selected line is not a new research session. Read
[readiness.md](references/readiness.md) and return its full coverage disposition, including the
runnable range and, when it calls for one, the final data/scope choice, even after a completed
replay. Keep the current line and its existing authority; do not restart selection or Goal setup
just to answer this check.

## When to read the references

- [readiness.md](references/readiness.md): before the first replay of a line, when a coverage
  receipt shows a gap, zero volume or missing funding, when a new month of data arrives, and
  before using inferred quotes for a new contract, period or liquidation scenario.
- [recommendation.md](references/recommendation.md): whenever the entry presents the
  recommendation and line options.
- [selection.md](references/selection.md): when the user's choice comes with an idea, a source or
  an authorization for a template.
