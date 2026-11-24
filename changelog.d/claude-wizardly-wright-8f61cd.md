- A source's market exit in Paper also cancels its entries that still wait for their terms read, as Live does and as a
  replay cancels a resting one. Before, such an entry was sent once the exit had ended, or denied while it ran
  (`MARKET_EXIT_IN_PROGRESS`), which failed the run's integrity.
