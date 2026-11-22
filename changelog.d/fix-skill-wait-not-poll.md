- research-start: while replays or subagents an Agent started run in the background and nothing else can go on,
  it ends the turn and waits for their completion notice, never polling their status or output, and ends a Goal
  continuation that comes before the notice without reading either.
