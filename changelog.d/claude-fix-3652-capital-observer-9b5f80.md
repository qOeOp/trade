- A replay's exposure row labelled with bar time T now holds each position as it stood at T (its fills and funding
  stamped at or before T), as the account row the mark-equity path reads at or before T does. A position closed or
  opened on a fill between two bars (resting limits and stops under `--execution quotes`) was valued after that fill,
  so a mark drawdown at T could vanish and a later entry leak into T; a HEDGING position ID closed and reopened is
  held in the cycle open at T. A funding settlement stamped just after a label now shows in the next row's
  `realized_pnl`, and the drawdown split counts a closed cycle from the first label at or after its close. Runs
  sealed before keep the numbers sealed with them (#3652).
