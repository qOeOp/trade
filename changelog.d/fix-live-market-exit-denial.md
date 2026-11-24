- Live denies an entry a source submits during its market exit at once (`entry_denied`, detail
  `entry_during_market_exit`), as a replay and Paper do, and the run goes on. Before, it waited for its account check,
  whose timing decided whether it was sent or denied and ended the run.
