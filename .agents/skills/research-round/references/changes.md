# Identity changes

Read after the replay image (it changes only with the replay code or its locked dependencies, not
with Paper or Live), the market data, the runtime contract or the line's execution environment (`--execution`), its trade ticks (`--trade-ticks`) or its metrics
(`--metrics`) change, so that earlier runs no longer share the execution identity of new ones.

For an ongoing out-of-sample validation, follow [validation.md](validation.md); the rebuild
registrations below concern development research, not another validation opportunity.

- Move a run before a comparison or recommendation reads it: a control before a registration
  compares against it, the recommended candidate and its control before a recommendation. A run
  nothing reads stays behind, out of the line's comparison table until it moves.
  `research state --line LINE` lists `runs_behind_image` and `current_image`.
  Replay each, one at a time and with memory to spare: `replay reproduce --trial-id T --image <current_image>
  --output <new /tmp directory>`; remove each directory afterwards. On success
  the run has the same fills, positions, exposures and daily returns (`replay reproduce --help`): it
  stays a control, its p values and the recommendation stand, and the replay is no new test. Report `tables_differing` (account and order tables) to
  the user as what changed; they decide nothing.
- A `REPRODUCTION_MISMATCH` saying no semantic fingerprint was recorded or computed compared
  nothing: report its reproduction trial and native and audit exits and diagnose that trial, not a
  changed result or the run as history. Any other means the result changed: list each run and its
  tables for the user. That run is history under the new identity, and so are its p values; never
  carry them forward or rewrite them. Other runs that moved keep their standing.
  `REPRODUCTION_CONFIG_DIFFERS` means the configuration changed: the run stays on its image; a line
  that needs it cannot continue (below).
- When a run needed for the line did not move and the conditions are the same (contract,
  configuration and inputs), rebuild it with a new `retry_of` registration, the control first; keep
  its research declarations, grid, configuration and inputs unchanged, cite fresh matching source
  reviews, and replace a control only with its comparable rebuilt source. Then recommend again from
  comparable, economically available evidence, and add the new recommendation and its trade-offs as
  a judgment and tell the user.
- A source with an earlier precheck and no `retry_of` registers on that precheck's image citing it,
  then moves with `replay reproduce`; a new precheck elsewhere leaves `SOURCE_ALREADY_EXPOSED`.
- Otherwise the line cannot continue: return to `research-start`, which offers a new line under the
  new identity or starts one the user left to you; the old line stays open until the user ends it.
  The new line starts from a template root or a candidate revision with a
  substantive change; never edit unrelated bytes to get past `SOURCE_EXISTS` or the exposure check.
- A passed engine parity pairing holds only for what was paired.
  Write "the engine's behaviour did not change for this pairing"; never extend it to other
  candidates, contracts or windows, call it an endorsement of the strategy or economic evidence, or
  describe an adaptation difference as an economic improvement.
