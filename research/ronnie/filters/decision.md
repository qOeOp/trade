# Iteration decision: filters-v1, iteration 1

Decision: FALSIFIED -> STOP. No further filters are searched on this base signal.

- The run behind this decision followed one repair. The first run stopped before scoring any filter on a code defect:
  FXCM prices were object-typed. It was repaired by strict float conversion in `tv_hourly.fxcm`.
- Base events: 2,796 over 11 markets (train 1,120, validation 603, test 1,073). Unfiltered avgR: train -0.169,
  validation -0.120, test -0.135.
- Selected by the registered rule: resonance + tested + strong_candle. It made +0.375 on train (46 trades), +0.403 on
  validation (23), and -0.326 on test (44).
- Placebo-selected test avgR over 47 of 50 sets (3 had no eligible combination): median -0.299, 95th percentile +0.027.
- Falsifier: the selected combination beats neither the base's test avgR nor the placebo 95th percentile.
- Secondary permutation check, added and not registered: after shuffling outcomes within market and segment, selection
  finds a best validation avgR with median +0.162 and 95th percentile +0.561. The real +0.403 lies inside that range.
- Census: `census.csv` scores every one of the 176 trials on train and validation. The test segment was read only for
  the selected combination and the base, and for each placebo set's selected combination.
