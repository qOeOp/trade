# Identity changes

Read after the runtime image, the engine, the market data, the runtime contract or the line's
execution environment (`--execution`), its trade ticks (`--trade-ticks`) or its metrics
(`--metrics`) change, so that earlier runs no longer share the execution identity of new ones.

For an ongoing out-of-sample validation, follow [validation.md](validation.md); the rebuild
registrations below concern development research, not another validation opportunity.

- Move the line's runs first. `research state --line LINE` lists `runs_behind_image`. Replay each,
  one at a time and with memory to spare: `replay reproduce --trial-id T --image <the current image's
  digest reference> --output <new /tmp directory>`; remove each directory afterwards. On success
  the run has the same fills, positions, exposures and daily returns and also holds the new image,
  configuration and inputs: it stays a control, its p values and the recommendation stand, and the
  replay is no exposure and no new test. Report `tables_differing` (account and order tables) to
  the user as what changed; they decide nothing. A contract change takes the same path while the
  old source still runs.
- `REPRODUCTION_MISMATCH` means the result changed: list each run and its tables for the user. That
  run is history under the new identity, and so are its p values; never carry them forward or
  rewrite them. Other runs that moved keep their standing.
- When a run needed for the line did not move and the conditions are the same (contract,
  configuration and inputs), rebuild it with a new `retry_of` registration, the control first; keep
  its research declarations, grid, configuration and inputs unchanged, cite fresh matching source
  reviews, and replace a control only with its comparable rebuilt source. Then recommend again from
  comparable, economically available evidence, and add the new recommendation and its trade-offs as
  a judgment and tell the user.
- A source with an earlier precheck and no `retry_of` registers on that precheck's image citing it,
  then moves with `replay reproduce`; a new precheck elsewhere leaves `SOURCE_ALREADY_EXPOSED`.
- Otherwise the line cannot continue; return to `research-start` to offer a new line under the new
  identity. Close the old line (`line close`, as research-start describes), then select the new
  one (`line select`). The new line starts from a template root or a candidate revision with a
  substantive change; never edit unrelated bytes to get past `SOURCE_EXISTS` or the exposure check.
- When the old source cannot run on the new contract, research restarts as a root
  ([template.md](template.md)) published and registered with no parent, no control and empty
  `changed_duties`, its rationale carrying the old candidate's idea. An option offering such a
  restart tells the user that it is a new rule, not the old one run again; its first report has no
  control; the old rule's results cannot be tested again.
- A passed engine parity pairing (the same source, inputs, window and account replayed on the old
  and the new image, the native reports equal field by field) holds only for what was paired.
  Write "the engine's behaviour did not change for this pairing"; never extend it to other
  candidates, contracts or windows, call it an endorsement of the strategy or economic evidence, or
  describe an adaptation difference as an economic improvement.
