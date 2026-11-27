- The type check covers `deploy`. Its Paper host's controller steps are `create_controller`, `controller_health` and
  `warm_controller`, no longer overrides of the Web host's `create`, `health` and `warm` with other signatures, and a
  container gone between a release's two inspects fails it with a `RuntimeError` (#3710).
