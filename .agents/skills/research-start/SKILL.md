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
  (`research status`) and the research state (`research state`): its `open_lines`, and for each
  open line its record (`research state --line LINE`), whose `targets` are the user's two research
  targets in force for the line (its own, else the ledger default). `candidate list`, `research
  state` and `research status` print large JSON: redirect each to a file under /tmp and read only
  the keys you need (for example with `jq`), such as `open_lines`, `line`, `targets`, `gates`,
  `unreviewed_trials` and, of `recommendation`, only its `judgment_id` and `body` (its `facts` and
  `subjects` exceed one read), never the whole output. After an interruption, or when
  the user says to continue, continue the line this session works on (the one its Goal names) under
  `research-round` without asking. A new session started with only `research-start` asks once:
  continue an open line (each with its state and next step) or choose another line (Offer lines and
  wait).
  Handoff files and session memory are not records; a conclusion they hold that the ledger does
  not is not used.
- A gate in a line's `research state --line LINE` stops it: tell the user plainly what it blocks and
  what would lift it. `RUNTIME_UNSUPPORTED`: the line's candidates are on a runtime contract this
  product no longer runs, so the line can only be closed and research restarted on the new
  contract (research-round's [changes.md](../research-round/references/changes.md)).
  `MARKET_COMMIT_UNRESOLVED`: no branch of the market database holds the line's pinned commit, so
  the line runs again only once that commit is back; restoring it is the user's market write,
  never a research step you propose. Never continue a gated line, after an interruption included,
  or establish a Goal for it, and never offer keeping it open to wait for what would lift the gate;
  close it once the user has chosen what follows.
- A line stays open until it is closed; selecting another line leaves it open, and several open
  lines are normal. Close a line when the user ends it, or when it cannot continue (a gate above,
  research-round's changes.md) and the user has chosen what follows: read it (`research state
  --line LINE --full`), write its summary as `line close --help` describes and run `line close`.

## Offer lines and wait

Present the latest recommendation and the line options ([recommendation.md](references/recommendation.md)).

- **Every option is a line that can start now:** `research state` lists no gate for it; its start
  can be registered on the chosen window (only a source that has never run, or a candidate whose
  research runs are already on that window and commit: the exposure check refuses a source that has
  already run, whichever line ran it, so a line beside an open one starts from another source); no
  open line has the same market commit and window (`line select` refuses `LINE_DATA_TAKEN`; never
  pin another commit or move the window only to get past it); and `market coverage` at the commit to
  pin has every month the window needs (bars, and quotes for a line that executes on them). Say in
  one line what an option that fails lacks.
  Supplying it (importing months with `market import` or `market import-quotes`, restoring a
  market commit) is a separate public write the user decides, not an option to wait on. A frozen
  rule is tested again only by out-of-sample validation at the user's request (research-round's
  validation), never on earlier months.
- When no existing candidate can start a line, design two or three complete new starts yourself:
  each a source that has never run (a revision with a substantive change, or a root, which needs
  no template authorization), marked not yet replayed, with its window, market commit, execution
  environment (research-round), readiness result and Goal objective, so that one choice approves
  both the line and its Goal. List template roots (research-round's
  [template.md](../research-round/references/template.md)) when the ledger has no candidate or the
  user says to leave every line, each with its first report on the current window or marked not
  yet replayed; a root from a user source is made only when the user gives the source.
- A due line change (research-round) is offered here too, after the ledger reads above: this line
  beside the lines the ledger's other candidates could start (`candidate list`). A loss, an
  insignificant result, a low priority, a review count, a run limit or a fault never brings up
  template roots: give the recommendation and priorities inside the line.
- End with a question once the options are given. Until the user chooses, do not register,
  replay, publish or write a line record, and never treat the first recommendation as chosen.

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
  the user's two targets and research-round's stopping rule: reports, reviews and priorities do
  not end the work; only its stop conditions do. Create it automatically when the host
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
replay. Keep the selected line and its existing authority; do not restart selection or Goal setup
just to answer this check.

## When to read the references

- [readiness.md](references/readiness.md): before the first replay of a line or of a session,
  when a coverage receipt shows a gap, zero volume or missing funding, when a new month of data
  arrives, and before using inferred quotes for a new contract, period or liquidation scenario.
- [recommendation.md](references/recommendation.md): whenever the entry presents the
  recommendation and line options.
- [selection.md](references/selection.md): when the user's choice comes with an idea, a source or
  an authorization for a template.
