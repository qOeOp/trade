- An interrupted Live run no longer ends for good when the first account read of its start again succeeds only after
  retries that together take over 30 seconds (`LIVE_OBSERVATION_STALE`): that read's age counts from its last answer.
  Every other account check is unchanged.
