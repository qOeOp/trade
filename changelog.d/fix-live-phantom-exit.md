- Live STOP path (re-judge C-140, doctor 20261114-25): before its first close it reads Binance once and closes each
  position only for what Binance still holds of its leg; a position closed outside the run (by hand, a liquidation)
  is journalled `venue_closed` instead of closed from the cache, its orphan stop is canceled, and the run ends
  `venue_flat` instead of `unresolved`. Decided under the user's delegation of 2026-11-21.
