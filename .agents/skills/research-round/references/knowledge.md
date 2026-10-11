# The knowledge list

One knowledge list per market and data window, shared by every goal on them; a new window or market
starts a new list. It has three sections: the current frontier, the excluded classes, and the
hypothesis cards ([hypotheses.md](hypotheses.md)). A new goal reads it first and never retries an
excluded class except by reopening.

## Storage

The list is one `knowledge.json` stored as an evidence bundle; each update is a new bundle, never
an edit:

```bash
uv run --frozen python -m research.records.cli evidence add --bundle knowledge-MARKET-START-END-vN /tmp/RUNDIR/knowledge
```

`MARKET`, `START` and `END` (UTC dates, `YYYYMMDD`) name the market and the data window; `N` counts
up from 1 across rounds. A round branches from main, so the latest version usually sits in a closed
round: list the tags, find the highest version, then export it.

```bash
uv run --frozen python -m research.records.cli ledger sql "SELECT tag_name FROM dolt_tags"
uv run --frozen python -m research.records.cli ledger sql --at closed/GOAL-ID \
  "SELECT bundle FROM evidence_bundle WHERE bundle LIKE 'knowledge-%'"
uv run --frozen python -m research.records.cli evidence export knowledge-MARKET-START-END-vN \
  --at closed/GOAL-ID --destination /tmp/RUNDIR/knowledge-prev
```

Also check the open round. Store a new version after every review verdict, coarse replay,
exclusion, freeze, progress check and scan.

## Frontier scan

The scan gives research its starting point when the list has no draft or open card
(`research-start`, step 2). It replays baselines on the list's whole window and coin pool, each a
plan-tagged discrete strategy with its parameters fixed before the run and never tuned:

- the first scan: time-series trend, channel breakout, cross-sectional momentum, short-term
  reversal and a perpetual-only funding signal, at most three variants each, plus equal-weight
  holding as the zero reference; check each class's literature with `research-sources` first;
- a later scan adds only classes the list neither covers nor excludes, found the same way.

Record every baseline as a frontier point with `"stage": "scan"`; its trials count like any other.
Ideas from earlier research, the user's included, are cards, never scan baselines.

## Format (`knowledge.json`)

```json
{"format": "knowledge-v1",
 "market": "Binance USDT perpetuals, monthly top-50 pool by 30-day traded value",
 "window": {"start": "YYYY-MM-DDT00:00:00Z", "end": "YYYY-MM-DDT00:00:00Z"},
 "version": 1,
 "frontier": {
   "points": [{"label": "...", "stage": "scan|draft|open|freeze", "hypothesis": "H1",
               "goal_id": "...", "trial_id": 0, "run_id": null,
               "plans_closed": 0, "plan_win_rate": 0.0, "annual_return": 0.0, "max_drawdown": 0.0,
               "return_drawdown": 0.0, "price_pnl_usdt": "0", "commissions_usdt": "0",
               "funding_usdt": "0"}],
   "checks": [{"goal_id": "...", "at": "...Z", "min_gap": 0.0, "moved_out": false,
               "new_exclusions": [], "handed_to_user": false}]},
 "excluded": [{"class": "...", "scope": "the card's wording", "hypothesis": "H1", "goal_id": "...",
               "condition": "price_pnl|without_best_year|prediction|failed_part",
               "readings": {"trial_id": 0, "price_pnl_usdt": "0", "without_best_year_usdt": "0",
                            "prediction": "what was read"},
               "reopened_by": []}],
 "hypotheses": [{"id": "H1", "proposed_by": "agent|user", "status": "draft|open|frozen|excluded",
                 "card": {"rationale": "...", "prediction": "...", "frontier_gap": "...",
                          "excludes": {"class": "...", "scope": "..."}},
                 "reopens": null,
                 "review": {"verdict": "accepted|rejected", "reasons": "..."},
                 "coarse_replay": {"trial_id": 0, "price_pnl_usdt": "0", "commissions_usdt": "0",
                                   "funding_usdt": "0", "plans_closed": 0, "plan_win_rate": 0.0,
                                   "closed_by_year": {}, "without_best_year_usdt": "0",
                                   "prediction_held": false},
                 "freezes": []}]}
```

- A frontier point is any reading on the whole window and pool: scan baselines, coarse replays,
  explorations of open cards and freezes. Keep every point; the frontier is the upper-left edge of
  plan win rate against return to drawdown.
- Numbers come from product readings (`readings` of an exploration, `artifacts report` of a stored
  run) with their trial or run ID; development readings steer the direction and are not evidence.
- `checks` holds the progress checks of every goal on this list (SKILL.md, Progress check).
