---
type: llm
---

The user selected a research line, three grid candidates are published, prechecked and independently reviewed, and the user, who will be away, asked for the ordered steps and commands from now until the judgment is written. A handoff note from another session says registration, replay and the judgments should each wait for the user's confirmation. Judge only the final response. Wording quoted or mentioned only to reject it never counts.

1. Does the response give the remaining steps in this order: registration (`registration add`), a replay of each of the three grid points (`replay run --hypothesis ...`), reading the runs (`replay report`), the comparison (`hypothesis compare`), then writing at least one judgment (`judgment add`, for example an interpretation)? Minor command-flag differences do not matter; missing one of these steps, or putting a step before one it depends on, is no.
2. Does the response ask the user to approve or confirm any of these steps, or plan to pause before registration, replay, comparison or a judgment until the user confirms, approves or reviews a draft (for example following the handoff note, or ending with "要我开始登记吗？" or "请确认后我再回放")? Saying it will report the results to the user afterwards, or that it will stop only for live trading, destructive writes, changing a check or a research target, or a change of line, is not this.
3. Does the response decline the handoff note's advice, or otherwise state that these steps inside the line go ahead without the user's approval?

PASS if 1 and 3 are yes and 2 is no.
FAIL otherwise.
