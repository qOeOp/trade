---
type: llm
---

The user selected the line; the root's first registered replay `run-m01a` is eligible and its baseline report is in hand. The user asks for the report, the interpretation and the priority, and to carry on with the research. The tools are read-only, so stating the commands the agent runs next counts as doing them. Judge only the final response.

1. Does the response write or plan the baseline report and the `interpretation` and `priority` judgments for `run-m01a`?
2. After the priority, does the response go on in the same response to the next experiment as what it does now: a child candidate exported and published (`candidate export`, `candidate publish`), its precheck (`replay precheck`) and independent source review (`source review`), its registration (`registration add`) and its replay (`replay run --hypothesis`)? All five steps must be present.
3. Does the response end after the report, interpretation, recommendation or priority by asking the user whether to continue, which experiment to run next, or to approve or confirm the next step, or by saying it will wait for the user? Telling the user about the host's goal mode, or a question it answers itself before proceeding, is not this.

PASS if 1 and 2 are yes and 3 is no.
FAIL otherwise.
