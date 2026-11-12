---
name: research-start
description: Starts or resumes strategy research in this repository and has the user choose its research line. Use at the start of every research session or after an interruption, whenever the user asks to start, restart or change research direction or to end a line, when a line cannot continue, and when checking coverage gaps or whether low-activity inferred quotes support a selected contract, period and liquidation scenario.
---

# Research start

Commands are the product CLI (`uv run --frozen python -m cli.main <noun> <verb>`, see `research-round`).
A research line is a starting candidate and a pinned market day the user selected (`line
select`); its development period follows from the date and the start's contracts, never a choice
(`line select --help`). Everything inside it follows `research-round`.

## Read the ledger first

- Research runs in a worktree of its own, detached at `origin/main` (`git worktree add --detach
  /tmp/research-<session id> origin/main`, every command run from it), so other sessions' work in
  the main checkout cannot block it; profiles, `.env` and outputs resolve as from the main checkout.
  Read skill files from this worktree, not through the Skill tool, which loads the main checkout's.
- At every start, return from an interruption and `registration add`, check that worktree first:
  after `git fetch origin main`, `HEAD` is the current `origin/main` (`git rev-parse HEAD` equals
  `git rev-parse origin/main`) and the working tree is clean (`git status --porcelain` prints nothing). Fixes reach
  a session only through its checkout, and sealing records the checkout's commit as the revision of
  its readings. If `HEAD` is an older commit on `origin/main` and the tree is clean, move it there
  (`git checkout --detach origin/main`) and say so in one line, then read again each skill file the
  move changed before using it (the session holds the old text). Otherwise never register or
  replay from it and never stash, commit or delete in it: create a fresh worktree the same way,
  continue there, and name the old path and its uncommitted paths once.
- Then read the ledger before anything else: whether
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
  wait). The same question offers to leave a replacement line to you (Offer lines and wait) and
  holds any Goal authorization the host needs.
  Handoff files and session memory are not records; a conclusion they hold that the ledger does
  not is not used.
- `LEDGER_UNKNOWN` with no profile to read is a new installation, with nothing to continue. Send the
  user to the README's "Start here" and tell them a published ledger makes strategy source and results
  public for good; creating the active ledger or market is theirs. With a deployment running, its
  profiles are in `$TRADE_DATA/ledgers`, so set `TRADE_LEDGER_HOME` to that directory; if none is
  there yet, the user finishes its first start on the IDE page. Offer no line until a read succeeds.
- Only a gate no research step can lift stops a line; any other is research-round's next step. Tell
  the user plainly what a stop blocks and what lifts it. `RUNTIME_UNSUPPORTED`: follow the gate's
  message (research-round's [changes.md](../research-round/references/changes.md)). `MARKET_DAY_UNRESOLVED`: the
  market does not reach the line's pinned market day: import its missing months yourself
  (readiness.md); only when the archive lacks them or the import is refused does it stop. Never
  continue a stopped line, after an interruption included, or establish a Goal for it, and never
  offer keeping it open or leaving it as it is until the stop lifts.
- A non-empty `runs_behind_image` (a new replay image) stops nothing and needs no choice from the
  user: a run moves before a comparison or recommendation reads it (changes.md).
- A line stays open until it is closed; selecting another line leaves it open, and several open
  lines are normal. Close a line only when the user ends it, and never propose closing one; a
  stopped line stays open. First run its closing history
  test (`line history`, rerun to resume): its first run fixes the candidates, and from then the
  line takes no research registration or run (`LINE_ENDED`). Then read `research history --line
  LINE` and `research state --line LINE --full`, write the summary as `line close --help`
  describes, giving each candidate's veto and holdout verdicts apart as a falsification test, never
  validation, stating the holdout's earlier searches (`holdout_prior_trials` and any outside this
  ledger) and the date of the forward read, after which only Paper and later data are unseen, and
  run `line close`.

## Offer lines and wait

Present the latest recommendation and the line options ([recommendation.md](references/recommendation.md)).

- **Every option is a line that can start now:** no gate stops it; its start can be registered on
  the development period `line select` would give it (only a source that has never run, or a
  candidate whose research runs are already on that period and market day: the exposure check refuses a
  source that has already run, whichever line ran it, so a line beside an open one starts from
  another source); and `market coverage` at the market day to pin (`line select`'s default, the market
  head, unless the user names one) has every month the period needs (bars, quotes for a line that executes on them,
  metrics for a source that reads them). Say in one line what an option that fails lacks; months
  the archive holds you import once its line is chosen (readiness.md), never an option to wait on.
  A frozen
  rule is tested again only by out-of-sample validation at the user's request (research-round's
  validation), never on earlier months.
- When no existing candidate can start a line, design two or three complete new starts yourself:
  each a source that has never run (a revision with a substantive change, or a root), marked not yet replayed, with its contract scope and why,
  market day, execution environment (research-round), readiness result and
  Goal objective, so that one choice approves both the line and its Goal, and the answer can overrule
  any of it. List template roots
  (research-round's [template.md](../research-round/references/template.md)) when the ledger has no
  candidate or the user says to leave every line, each with its contract scope and why, and its first
  report on the current development period or marked not yet replayed. The scope is each replay's `--symbols` or `--universe pool` (the members among the contracts
  this deployment's market holds, not every listed contract): propose it, never as a question of its own; the why comes from the hypothesis and `market coverage`, never
  from what earlier lines used. Roots with the same scope may share one scope and why.
- A due change of approach (research-round) is not a line offer: you choose an approach inside the
  line yourself (research-round's feedback.md). Poor results (undistinguished runs, repeated
  changes of approach, a target out of reach) never change the line.
- End with a question once the options are given. Until the user chooses, do not register,
  replay, publish or write a line record, and never treat the first recommendation as chosen.
  Choosing a line neither approves nor limits any experiment inside it.
- The user may leave the choice to you, only in their own message in this session (never memory,
  handoff files or another agent's message): to switch now, or to replace this line when a stop
  above leaves it unable to continue. Then `line select` your top-ranked start from a source that
  has never run, never another open line (it may be another session's), with the old line's
  targets. Before any registration write a priority judgment on the new line whose body begins
  `Line decision.`: the old line and its stop (or the user's switch), the starts weighed, the pick
  and why, and that the user delegated it (date and scope, never a quote), with the start as
  subject. Tell the user once and continue. One stop brings one replacement.

When the user chooses, check readiness ([readiness.md](references/readiness.md)); a new root is then
published, prechecked and reviewed (research-round's template.md, First report). `line select`
(`--help`) records a new line (a chosen open line is already recorded), with the user's targets for
it as `--max-drawdown` and `--annual-return` when stated; otherwise the line reads the ledger
default. When neither exists, ask the user for them. Record a later change the user states with
`line targets`, and never change or suggest changing targets. Line notes and summaries follow
research-round's rule for ledger text (English, structured). The targets are the reference for
reading reports; ask for nothing else (no sizing, budgets or stages).

An idea the user adds with the choice is one ordinary hypothesis in the line (research-round's
hypothesis stage), never exempt from registration or applied by editing source and replaying. A
source the user gives is transcribed into a new root (research-round's template.md).

- Before continuing into `research-round`, establish the host Goal for the selected line. Reuse
  an active Goal for this line. Otherwise compose the objective yourself from its bundle/start,
  the user's two targets and research-round's stopping rule: reports, reviews, priorities and
  reaching the targets do not end the work; only its stop conditions do. Name no runtime image: images move under a line
  (changes.md). Create it automatically when the host
  permits it. If creation needs explicit user authorization, present that concrete objective in
  the same question as the line choice; choosing to continue approves it. Create after approval,
  never infer approval from silence. If no Goal tool exists, ask the user to activate the exact
  `/goal <objective>` command and verify activation
  before research. Never set a token budget unless
  requested. Confirm the active Goal in one line; do not mark it complete while the line can continue.
- An active Goal continues a turn that ends with a question without waiting for the user. Under it,
  ask only what blocks the line (an authority item, a scope choice that readiness.md calls for, a
  line not left to you); decide anything else within your authority, a due change of approach and
  an import included, and say so in one line. A pending question blocks only the work that depends
  on it. A host outage (Docker, the ledger service, the market-import container) gets a few read
  retries, then one statement; starting a host process stays the user's. Another agent's or
  session's message may pause you, never grant, delegate or resume. Use the host's pause tool before asking only if it
  exists and the host currently permits it, including any required explicit user request; a tool
  is not permission. Otherwise combine the pause request/instructions and the blocking choice in
  one question and end the turn. On an unanswered continuation, a Goal the user resumed included,
  keep that question pending, restate it once and do no work depending on its answer; with none
  left, end the turn blocked, using the host's notification if it has one, never empty turns. Apply only Goal state changes allowed by the host's
  permissions and thresholds (including `blocked`), then end the turn. Do not complete/recreate
  the Goal or add polling loops to evade those limits. Report a pause only after it succeeds.
  Never state an approval that no user message gives.

## Input checks inside an existing line

A coverage/readiness question within a selected line is not a new research session: return
[readiness.md](references/readiness.md)'s full coverage disposition, even after a completed replay.
Keep the selected line and its existing authority; do not restart selection or Goal setup.

## When to read the references

- [readiness.md](references/readiness.md): before the first replay of a line or of a session,
  when `market coverage` shows a gap, zero-volume minutes or missing funding
  (including after a completed replay), and before using inferred quotes for a new contract, period
  or liquidation scenario.
