- An interrupted Live run no longer ends for good when a socket disconnects during its start again, before the
  connected account read is verified: that start ends as an interruption and the run starts again within the hourly
  limit. A disconnect on a first start still ends the run; one after verification still only closes entries.
