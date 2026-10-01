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
