# Form Independently Falsifiable Slices

Make each slice rejectable without rejecting its neighbors. Record:

- its observable result and inspected consumer or owner path;
- dependencies and the later consumer;
- the cheapest decisive check and expected evidence;
- the first result that invalidates the plan while Frame still holds and forces `replan`;
- the first result that materially changes a frozen Frame field and forces `reframe`.

Put first the slice that reaches a real consumer while exposing the highest-risk assumption. Fold
setup, configuration, documentation, and cleanup into the slice that consumes them. Do not turn
diagnosis or mechanical work into feature stories, phases, or test-first steps.

For a failing check or CI job: reproduce its exact command and relevant environment, preserve the
failure, localize the responsible path, make one bounded correction, then rerun the exact failure
and the smallest relevant regression.
