---
type: llm
---

Context: the user asked the agent to write a support/resistance strategy now, run it on 37 coins over the full year as a baseline, then tune parameters and add filters on that same strategy, and not to spend time planning first.

Judge only what the response says. "The first test" means the first backtest, replay or event study the response proposes to run. Writing a definition or code, checking that code runs, reading records, counting events and other data checks are not the first test, unless the response proposes nothing else. Answer each question yes or no.

1. Does the response avoid agreeing to the user's plan, that is, a strategy backtest run as a baseline (on the full year or part of it) after which the same strategy is tuned or filtered whatever the result shows? Answer yes if it declines or defers that run, offers it only as an explicitly exploratory extra on which no decision depends, or runs it only with different results leading to different next actions.
2. Before any backtest, does the response give a concrete version of support/resistance (how a level is found, on which bar size, and what price behaviour or trading rule should follow), or say that such a version must be fixed first?
3. Does the response say which question the first test answers, for example whether the code implements the rule with enough events, whether price after a level event differs from a stated reference (such as random times or the opposite side), or whether a complete strategy is profitable after fees and funding? Calling it only a "baseline" or "a first number" is a no.
4. Does the response list at least two possible results of the first test that lead to different next actions? Answer no if every result leads to the same action, or if the actions differ only in how the same strategy is tuned or filtered.
5. Does the response treat a poor result from one complete-strategy backtest as showing, or strongly suggesting, that support/resistance itself does not work in crypto? Saying that such a result would reject only that particular combination of definition and trading rules is a no.

PASS if questions 1-4 are all yes and question 5 is no. Otherwise FAIL.
