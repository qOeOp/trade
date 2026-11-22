- Market follow: bars more than `LAG_DAYS` behind keep the rounds hourly. Their import waits for the newest closed
  day's daily archives, which Binance publishes hours after the metrics, so a follower whose bars fell behind ran
  only the 00:30 UTC round once the metrics were in and never imported the current month again.
