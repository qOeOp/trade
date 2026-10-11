---
name: research-start
description: Starts a strategy research goal with the user in this repository - gathers the ledger, census, data and code state, asks only for the goal (three targets, market, initial capital, an optional idea) and opens the round. Use when the user asks to start, restart or set up strategy research, or gives a research direction or targets while no round is open.
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
- **Census and knowledge list** for the market and data window
  ([knowledge.md](../research-round/references/knowledge.md)): the latest version, whether its
  frontier holds census points, its excluded classes, and the exposure stated by earlier goals
  (`ledger sql --at closed/GOAL-ID "SELECT known_exposure FROM goal"`).
- **Data**: which market data the runner can read and up to when. The census needs USDT perpetuals
  from 2020-01 with the monthly coin pool; if the product cannot report that, say so.
- **Code**: `git fetch origin` and `git merge-base --is-ancestor origin/main HEAD`; work from a
  checkout that has origin/main.

## 2. The census comes before the loop

- **A census exists**: show the user the frontier and the knowledge list, say that a development
  frontier is not a promise and acceptance rests on confirmation, then ask for the goal (step 3).
- **No census**: two rounds of questions. First confirm only the market, the data window and the
  initial capital, run the census, and record it in the knowledge list; then show the frontier and
  ask for the three targets.
- **The census cannot run** (no multi-year data with the monthly pool): stop at this step, tell the
  user why and what it waits for, and open no round. Do not substitute a shorter or hand-picked
  data set.

## 3. Ask only for the goal

Use your client's question tool if it has one, otherwise one plain message:

- the three targets: maximum drawdown (native MARK equity), minimum annual return (higher is
  better; no upper bound), minimum plan win rate (per trading plan, net of fees and funding; a
  breakeven or still-open plan is not a win);
- the market: USDT perpetuals, coin pool taken each month from the top 50 by 30-day traded value
  (the data layer's rule; not chosen per goal);
- the initial capital. The runner trades a fixed 100,000 USDT; if the user names another amount,
  say so before the round opens and let the user decide;
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
