- Breaking (replay): a contract whose stored trades halt for at least 7 days and resume is replayed as separate contracts, one
  per span of trading, instead of one spliced price series (BNXUSDT went from 119.93 to 1.579 across its halt). A
  window that meets several spans names them `SYMBOL-E<n>`; entries after a halt wait for the next UTC month. Runs whose
  window or warm-up spans a halt of a contract they trade do not reproduce (`REPRODUCTION_MISMATCH`). Paper and Live, and the replays compared with them, keep the contract whole.
