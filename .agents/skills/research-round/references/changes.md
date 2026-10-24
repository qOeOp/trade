# Identity changes

Read after the runtime image, the engine, the market data or the runtime contract changes, so that
earlier runs no longer share the execution identity of new ones.

For an ongoing out-of-sample validation, follow [validation.md](validation.md); the rebuild
registrations below concern development research, not another validation opportunity.

- Replay the current recommended candidate and its control under the new identity, the control
  first, then recommend again using only comparable, economically available evidence under the
  new identity. Old p values and the old recommendation's reasons stay as history; never carry
  them forward or rewrite them. Add the new recommendation and its trade-offs as a judgment and
  tell the user.
  Use a new `retry_of` registration for each fixed-source runtime rebuild; keep its research
  declarations and source grid, cite fresh matching source reviews, and replace a control with its
  comparable rebuilt source. Same-contract rebuilds keep configuration and input identities unchanged.
  The supported v6-to-v7 bars migration preserves market selection and account terms while pinning
  new export artifacts. When an old control has lost economic evidence, first rebuild its valid
  descendant as an unpaired baseline (`control_trial_id` and `comparison` null); the linked original
  keeps the old comparison declaration. Do not repair or replay a known faulty control just to
  retain a historical comparison, or treat the unpaired baseline as evidence for that comparison.
- A passed engine parity pairing (the same source, inputs, window and account replayed on the old
  and the new image, the native reports equal field by field) holds only for what was paired.
  Write "the engine's behaviour did not change for this pairing"; never extend it to other
  candidates, contracts or windows, call it an endorsement of the strategy or economic evidence, or
  describe an adaptation difference as an economic improvement.
