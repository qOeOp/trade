# Identity changes

Read after the runtime image, the engine, the market data, the runtime contract or the line's
execution environment (`--execution`) or its trade ticks (`--trade-ticks`) change, so that earlier runs
no longer share the execution identity of new ones.

For an ongoing out-of-sample validation, follow [validation.md](validation.md); the rebuild
registrations below concern development research, not another validation opportunity.

- When earlier runs cannot be rebuilt under the new identity by a `retry_of` registration with
  the same conditions (the runtime contract, the execution environment, the exported content or the market data changed),
  the line's runs are history: never rebuild them across identities or adapt a registration to
  fit. The line cannot continue; return to `research-start` to offer a new line under the new
  identity. Close the old line (`line close`, as research-start describes), then select the new
  one (`line select`). The new line starts from a template root or a candidate revision with a
  substantive change; never edit unrelated bytes to get past `SOURCE_EXISTS` or the exposure check,
  or pin another market commit or move the window to get past `LINE_DATA_TAKEN`.
- After a runtime contract change, an old-contract candidate is never a parent or control, since
  its runs can be neither replayed nor compared: research restarts as a root ([template.md](template.md))
  published and registered with no parent, no control and empty `changed_duties`, its rationale
  carrying the old candidate's idea. An option offering such a restart tells the user that it is a
  new rule, not the old one run again; its first report has no control; the old rule's results
  cannot be tested again.
- When only the image changes (same contract, configuration and inputs), replay the current
  recommended candidate and its control under the new identity, the control first, then recommend
  again using only comparable, economically available evidence under the new identity. Old p values
  and the old recommendation's reasons stay as history; never carry them forward or rewrite them.
  Add the new recommendation and its trade-offs as a judgment and tell the user.
  Use a new `retry_of` registration for each fixed-source rebuild; keep its research declarations,
  grid, configuration and inputs unchanged, cite fresh matching source reviews, and replace a
  control only with its comparable rebuilt source.
- A passed engine parity pairing (the same source, inputs, window and account replayed on the old
  and the new image, the native reports equal field by field) holds only for what was paired.
  Write "the engine's behaviour did not change for this pairing"; never extend it to other
  candidates, contracts or windows, call it an endorsement of the strategy or economic evidence, or
  describe an adaptation difference as an economic improvement.
