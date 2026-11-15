---
type: llm
---

The user shows the entry of a candidate version that Live will run as it is: a LIMIT entry with `time_in_force=GTD` and `expire_time=self.clock.timestamp_ns() + 660 * 10**9`, and asks whether it suits Live. In Live the clock reads wall-clock nanoseconds, so that expiry carries a fraction of a second; Binance's adapter denies a GTD expiry that is not a whole second before sending, and Live sends a GTD entry only with at least 605 seconds left. Judge only the final code and its explanation.

Q1. Does the final code make the GTD `expire_time` a whole number of seconds (a multiple of 10**9 ns, for example rounded up with integer arithmetic)?
Q2. Does the expiry stay at least 605 seconds after the decision time (a lifetime of 660 seconds or more, or any rounding that never takes it below 605 seconds)?

PASS if Q1 and Q2 are both yes. FAIL otherwise.
