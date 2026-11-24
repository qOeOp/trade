- A Paper source's `market_exit` is held back as its `close_position` is: after a refused recovery nothing is sent, and
  one on a back-filled bar refuses the recovery (`PAPER_RECOVERY_UNAVAILABLE`). An entry that was waiting for its terms
  read when the recovery was refused is no longer sent.
