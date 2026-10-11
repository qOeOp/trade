---
name: research-start
description: Starts a strategy research goal with the user in this repository - gathers the ledger, knowledge list, data and code state, finds a starting point with a frontier scan when there is none, asks only for the goal (three targets, market, initial capital, an optional idea) and opens the round. Use before opening a round, and before answering any request to start, restart, set up or open another round of strategy research, or a research direction or targets given while no round is open.
---

# Research start

The loop that follows runs long without the user, so everything the goal needs is settled here.
Ask the user only for the goal; the research direction is yours, chosen from the frontier's gaps
(`research-round` skill). The product has no interactive code: you ask.

## 1. Gather the context first

Run from the repository root; ask nothing yet.

- **Ledger**: `uv run --frozen python -m research.records.cli ledger status`, then `round status`.
  With a round open, continue it under `research-round`; only the user decides to close it for a new
  goal (`round close`).
- **Knowledge list** for the market and data window
  ([knowledge.md](../research-round/references/knowledge.md)): the latest version, its frontier,
  its cards by status, and the exposure stated by earlier goals
  (`ledger sql --at closed/GOAL-ID "SELECT known_exposure FROM goal"`).
- **Data**: which market data the runner can read and up to when. A frontier scan needs USDT
  perpetuals from 2020-01 with the monthly coin pool; if the product cannot report that, say so.
- **Code**: `git fetch origin` and `git merge-base --is-ancestor origin/main HEAD`; work from a
  checkout that has origin/main.

## 2. Find the starting point before the loop

Research starts from the knowledge list, never from a direction the user names. There is a starting
point when the list holds a draft or open card. Without one, find it before the loop, by the first
case that holds:

- **No list, or no frontier** (first use): run the frontier scan
  ([knowledge.md](../research-round/references/knowledge.md)), record it, and draft the first cards
  from its gaps.
- **Every card excluded or rejected, none finished**: rerunning the same baselines on the same
  window adds nothing. Extend the scan with classes the list neither covers nor excludes (found
  with `research-sources`), run them and record them. If no such class is left, stop and bring the user the frontier, the excluded
  classes and a recommendation (another market, more data, or a target to reconsider).
- **Only finished strategies left** (passed freezes or confirmations, nothing in progress): the
  user chooses the direction, asked as its own question with the goal (step 3): raise the same
  frontier further, or find strategies with low correlation to the finished ones that combine with
  them in one account. Name both; never fold the choice into the optional idea or pick one
  yourself.

With a scan done, show the user the frontier and the knowledge list and say that a development
frontier is not a promise and acceptance rests on confirmation. Without a scan yet, ask in two
rounds: first only the market, data window and initial capital, then the scan, then the three
targets with the frontier in view. When the scan cannot run (no multi-year data with the monthly
pool), stop at this step, tell the user why and what it waits for, and open no round; never
substitute a shorter or hand-picked data set.

## 3. Ask only for the goal

Use your client's question tool if it has one, otherwise one plain message:

- the three targets: maximum drawdown (native MARK equity), minimum annual return (higher is
  better; no upper bound), minimum plan win rate (per trading plan, net of fees and funding; a
  breakeven or still-open plan is not a win);
- the market: USDT perpetuals, coin pool taken each month from the top 50 by 30-day traded value
  (the data layer's rule; not chosen per goal);
- the initial capital. The runner trades a fixed 100,000 USDT; if the user names another amount,
  say so before the round opens and let the user decide;
- only when nothing but finished strategies is left: which of the two directions in step 2;
- optionally, an idea the user wants tested. It becomes a hypothesis card marked as the user's
  and takes its place by prior ([hypotheses.md](../research-round/references/hypotheses.md)).

Never ask for a research direction, sources, stages, budgets, coins, sizing or risk limits. An idea
in the user's prompt, a strategy or a source to reproduce included, is that optional card, not the
research question.

## 4. Open the round

Write the goal file ([feasibility.md](../research-round/references/feasibility.md)) with the user's
three targets, the development window and the known exposure, then
`round open --goal /tmp/RUNDIR/goal.json`. From here follow `research-round`. Come back to the
user only for a progress-check hand-off, for something that needs their authority, or when the
goal is clearly out of reach.
