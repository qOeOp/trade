# Autonomous R&D loop: protocol

Written before the first loop runs. The user asked for an R&D system that, for a strategy family, starts from the
hypothesis that the strategy works, researches papers and trader-community practice, tests, attributes a failure,
adjusts without overfitting, and loops on its own, reporting each loop, until the bar is met. The user also uses this
run to test the workflow itself: problems met while running it are recorded in `loop/WORKFLOW_NOTES.md` as input to
the product's R&D system.

## Data tiers

| Tier       | Coins                                                                 | Period              | Use                                                 |
| ---------- | --------------------------------------------------------------------- | ------------------- | --------------------------------------------------- |
| iteration  | the 17 majors                                                         | 2018-01 to 2022-12  | every loop; free to inspect and attribute           |
| validation | the 20 large caps of range-v4                                         | 2023-01 to 2026-08  | once per candidate that passes the iteration gate   |
| final      | TON, RENDER, JUP, ENA, BONK, WIF, FLOKI, PYTH, ORDI, CFX, TAO, STRK (never used in this research) | listing to 2026-08 | once, for the final candidate only                  |

## A loop

1. **Hypothesis** (assume the strategy works): state it with its source (paper, community practice, or the previous
   loop's attribution) and the single change from the previous loop.
2. **Register** the loop in `loop/LOG.md` and commit before running.
3. **Run** on the iteration tier: R minus a matched random control (`loop/engine.py`).
4. **Iteration gate:** pooled edge above zero at 95% (coin-then-trade bootstrap) and positive in both halves
   (2018-2020 and 2021-2022).
5. **If it fails, attribute:** split the loop's trades on the iteration tier by descriptive features (regime, side,
   distance to levels, volatility, time to stop) to find where the edge is lost; the next loop's single change must
   follow from that attribution or from a cited source. No parameter grids: one change per loop, with a reason.
6. **If it passes, validate** once on the validation tier at a deflated level: 95% two-sided with Bonferroni over the
   candidates validated so far (level = 100 - 5/k). A pass sends the candidate to the final tier once.
7. **Report** the loop: hypothesis, change, result, attribution, next step, and any workflow problem met.

## Stop rules

- **Success:** a candidate passes iteration, validation and final.
- **Family budget:** at most 8 loops per family. When a family exhausts its budget, the attribution of its loops picks
  the next family; that switch is recorded with its reason.
- **Overfitting guard:** every scored trial is in `loop/census.csv`; the validation level tightens with each
  validated candidate; the validation and final tiers are never used for attribution.

## Amendment 1 (written before loop C-4)

- **What:** for rare-event families, the iteration tier may be extended once, by a coin list fixed before the
  extension is scored.
- **Why:** capitulations happen about 30-40 times on the 17 majors over 2018-2022. At that size, only edges above
  about 0.35R can pass the gate, whatever the rule (workflow note 11).
- **The list:** `engine.ITER_EXT_COINS`, 36 mid and large caps over 2018-2022. Earlier families used them for other
  entries, never for an oversold or capitulation rule, and none is in the validation or final tier.
- **Unchanged:** the validation and final tiers. For Family C validation is the final tier only (LOG, Family C).

## Amendment 2 (written before loop A9)

- **What:** a closed family may be reopened once, for at most 3 loops, when the systematic attribution
  (`loop/attrib.py`, introduced after the family closed) flags a reliable feature that the old attribution could not
  see. Each reopened loop's change must be a flagged feature, cut at a natural threshold, not at a bucket boundary.
- **Unchanged:** the validation level keeps tightening with every validated candidate.

## Amendment 3 (written before the ledger-driven loops; the user's instruction: no budget, iterate until done)

- **No loop budget.** A family loops until a candidate passes iteration, validation and final, or until the ledger
  offers no admissible change and no cited source remains (a terminal state, recorded with its reason).
- **Admissible change.** A change must be one of:
  - a factor in the cross-loop factor ledger (`loop/ledger.csv`), flagged reliable in at least 2 loops of the family,
    with the same IC sign in every loop where it is flagged and no opposite-sign flag, cut at a natural threshold;
  - a mechanism from a cited paper or community practice, with the loss decomposition pointing at the part it fixes.
- **Guards replacing the budget:**
  - the validation level tightens with every validated candidate (Bonferroni over k);
  - the validation report carries a haircut for the number of iteration loops (the raw and the deflated edge);
  - validation and final are read once each and never used for attribution;
  - every loop and every rerun is in the census.
- **Refinement (written after the first ledger, before it drives any loop):** an admissible factor's mean IC across all
  loops of the family must have the flagged sign. The first ledger showed the volatility ratio flagged twice (+) while
  its mean IC was negative and its sign agreed in only 40% of loops: noise that passes a per-loop flag (note 26).
- **Rare-event families (no per-year ICIR):** a factor is admissible when its IC has one sign in every loop of the
  family (at least 4 loops) and its pooled Q5-Q1 interval on the latest loop excludes zero.
- **Sample expansion:** any family may run its current best rule once on the extended iteration tier
  (`engine.ITER_EXT_COINS`, amendment 1), registered before scoring, when the gate fails for power (pooled interval
  wider than +-0.3R).
