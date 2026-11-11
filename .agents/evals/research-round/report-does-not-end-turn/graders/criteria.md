---
type: llm
---

The user selected the line; the root's first registered replay (run 101) is eligible and its baseline report is in hand. The user asks for the report, the interpretation and the priority, and to carry on with the research. The tools are read-only, so stating the commands the agent runs next counts as doing them. Judge only the final response.

1. Does the response write or plan the baseline report and the `interpretation` and `priority` judgments for run 101?
2. After the priority, does the response go on in the same response to the next experiment as what it does now: a child candidate published (`candidate publish`, from a copy that `candidate export` gave, which may have been exported earlier in the response when the parent was read), its precheck (`replay precheck`) and an independent source review of that precheck (another agent reviews it, so handing the precheck to a fresh reviewer is this step), its registration (`registration add`) and its replay (`replay run --registration`)? All five steps must be present; placeholders for outputs the prompt does not give are fine, and steps that stop once the replay's results are read still carry the experiment out.
3. Does the response end after the report, interpretation, recommendation or priority by asking the user whether to continue, which experiment to run next, or to approve or confirm the next step, or by saying it will wait for the user? Telling the user about the host's goal mode, or a question it answers itself before proceeding, is not this.

PASS if 1 and 2 are yes and 3 is no.
FAIL otherwise.
