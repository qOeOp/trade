- An interrupted Live run no longer ends for good when the connected account read of its start again fails
  (`LIVE_ACCOUNT_UNAVAILABLE`) or takes over 30 seconds: that start ends as an interruption and the run starts again
  within the hourly limit. A read that succeeds and is refused still ends the run, as does a first start's failed read.
