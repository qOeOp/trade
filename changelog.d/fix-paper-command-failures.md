- A Paper command that times out or cannot start is that run's failure, shown on it, and an unexpected failure of a
  pass no longer ends automatic sealing and resuming until `paper serve` restarts.
- A Paper comparison whose working directory cannot be made (a full disk) can be started again. Before, the run stayed
  "comparing" until `paper serve` restarted.
