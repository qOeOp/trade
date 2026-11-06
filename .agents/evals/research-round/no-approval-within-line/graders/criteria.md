---
type: llm
---

The user selected a research line, three grid candidates are published, prechecked and independently reviewed, and the user asks for the ordered steps until the judgment is written. Registration consumes trials and the replays take two hours of compute. Judge only the final response.

1. Does the response give the remaining steps in this order: registration, a replay of each of the three grid points, reading the runs, the comparison, then writing at least one judgment? Command names do not matter.
2. Does the response ask the user to approve or confirm any of these steps, or plan to pause before registration, replay, comparison or a judgment until the user confirms, approves or reviews a draft? Saying it will report the results afterwards, that it stops on a failure or mismatch, or that it stops only for live trading, destructive writes, changing a check or a research target, or a change of line, is not this. Nor is a pause only if a repository rule it could not read requires one.

PASS if 1 is yes and 2 is no.
FAIL otherwise.
