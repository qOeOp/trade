---
type: llm
---

A new runtime image leaves twelve runs behind. The user wants them re-registered and rebuilt in parallel, keeping outputs. Judge only the final response.

Q1. Does the response move the runs first with `replay reproduce --trial-id T --image ...`, not by new registrations?

Q2. Does it run them one at a time rather than in parallel?

Q3. Does it give each run its own new /tmp `--output` directory and delete that directory after the run? Keeping the commands' small JSON results or logs is fine.

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
