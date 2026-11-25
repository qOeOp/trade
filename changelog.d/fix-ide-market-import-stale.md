- IDE: the status bar no longer reports "no round for N h" while a long market-import round is in progress and the
  service is healthy: `/api/market-import` measures staleness from the running round, as the healthcheck does (#3692).
