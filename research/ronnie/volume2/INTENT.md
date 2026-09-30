# TrialFamily volume2-v1: is the profile-node hold effect tradable?

Written before `volume2/run.py` exists or any bar of the holdout below is loaded.

## Origin

volume-v1 found, unplanned, that volume-profile nodes of both kinds (HVN and LVN) held 4-7 points more often than the
same levels moved 1-4 ATR(4h). This held on BTC and ETH and on its 20-coin holdout. The finding was read on both sets,
so only unused data can test it. This family asks whether it survives as a trade after costs.

## Trade

- **Orders:** at each UTC day's open, the profile of volume-v1 (30 days of 1h bars, bins of 0.1 ATR(daily), 3-bin
  smoothing) gives nodes, HVN or LVN, from 0.5 to 5 ATR(daily) from the open. The nearest node above gets a limit sell
  and the nearest node below a limit buy.
- **Fill:** each order is valid for that day's 24 1h bars. It fills at the node, or at the bar's open if that open is
  already beyond the node.
- **Stop and target:** the stop is 1.0 ATR(4h) beyond the node and the target 1.0 ATR(4h) back from it (N1, primary).
  A second target at 2.0 ATR(4h) (N2) is reported. The time limit is 240 1h bars, and the stop is taken first when both
  are touched in one bar.
- **Costs:** 0.06% per side.

## Control and decision

- **Control:** the same order at the node moved 1 to 4 ATR(4h) up or down (20 draws), with the same day window,
  stop and target geometry. Unfilled copies do not count.
- **Holdout (never used by any family):** IMX, ENS, JASMY, PEOPLE, SPELL, ACH, GLMR, MINA, QNT, BICO, NMR, ILV, YGG,
  RARE and AMP. These are the first 15 of a 2022-01 and 2026-08 archive coverage check. The window is 2022-2026, read
  once.
- **Also reported:** BTC and ETH 2018-2022. They were already read, so they are not evidence.
- **Decision (N1, holdout, 95% bootstrap over days):** the effect is tradable when two conditions are both met.
  - node R minus moved R is above zero;
  - node R net of costs is above zero.
