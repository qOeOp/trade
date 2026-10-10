# Confirmation

The clean test for an Agent-developed candidate is market data that did not exist when it was
frozen. Nothing needs to be collected in advance: a window is independent because the confirmation
attempt was published before the window began.

1. **Freeze.** Pass review ([review.md](review.md)). Publish a pending confirmation attempt that binds
   the frozen strategy and states in its plan the freeze review's material ID, the configuration,
   image, cost model, window length and preregistered decision ranges. Exposure honestly lists the development runs.
2. **Wait** until the window has passed.
3. **Build inputs** for that window with a data recipe and record their input identity.
4. **Run once**, then `artifacts register --evidence-grade independent --dry-run`, then register for
   real. Register every sealed run of the attempt.
5. **Decide** against the preregistered ranges. A short window can refute an obvious failure but
   cannot establish a high return.

Code checks only the strategy binding and the time order; review checks the rest. A used window is
development-exposed afterwards. Data from before the attempt's publication is never independent.
