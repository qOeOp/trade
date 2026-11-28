- Breaking (research): runner arguments must choose the contracts, `--symbols S ...` or `--universe pool`; omitting
  both no longer selects the whole pool (#3816). An abbreviated runner option (`--univ`, `--sym`), which the runner
  refuses, is refused at registration and replay too (#3791). A line's history replay of a pool run names
  `--universe pool` itself. A command that left out the scope has to add it.
