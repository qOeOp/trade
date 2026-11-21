- Ledger connections (`ledger.db.connect`): a service that may be running but does not answer or accept a
  connection (no greeting, connection refused or lost, too many connections) is tried again after pauses of 5, 10,
  20, 25 and 30 s while the wait stays within about 90 s; only then is it `LEDGER_UNAVAILABLE`, whose message says
  how often and how long it tried. An account or branch error, and a socket service whose server this host does not
  run (a stopped one), are refused at once as before.
