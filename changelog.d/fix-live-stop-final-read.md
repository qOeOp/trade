- A Live STOP whose closes leave only what Binance no longer held in the native cache now ends `venue_flat` on an
  account read taken after the node stops, and refuses `LIVE_ACCOUNT_NOT_FLAT` (the account slot stays held) when
  Binance still holds a position or order; before, it kept the read taken before its first close (#3727).
