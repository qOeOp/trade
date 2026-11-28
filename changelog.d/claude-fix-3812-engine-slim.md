- Paper and Live hold an unsent entry through one shared mechanism (`engine.unsent.Waiting`): a source's cancels and
  market exit reach a waiting entry the same way in both modes, with each mode giving only its store, its connection
  check and what a refused cancel does. Live ends a run after a stop's late flat read in the same block as a clean
  stop, without setting a flag nothing reads. No behavior change.
