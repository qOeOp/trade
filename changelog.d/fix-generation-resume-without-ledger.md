- A release host's data generation cutover that failed while archiving (a full disk, a crash) goes on by itself. Before,
  the next ticks asked the ledger it had already stopped whether Paper was idle, and waited forever.
