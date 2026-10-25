# Identity changes

Read after the runtime image, the engine, the market data, the runtime contract or the line's
execution environment (`--execution`) changes, so that earlier runs no longer share the execution
identity of new ones.

For an ongoing out-of-sample validation, follow [validation.md](validation.md); the rebuild
registrations below concern development research, not another validation opportunity.

- When earlier runs cannot be rebuilt under the new identity by a `retry_of` registration with
  the same conditions (the runtime contract, the execution environment, the exported content or the market data changed),
  the line's runs are history: never rebuild them across identities or adapt a registration to
  fit. The line cannot continue; return to `research-start` to offer a new line under the new
  identity. Selecting it (`line select`) ends the old line, which `research-start` then closes. The new line starts from a template root or a candidate revision
  with a substantive change; never edit unrelated bytes to get past `SOURCE_EXISTS` or the
  exposure check.
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
