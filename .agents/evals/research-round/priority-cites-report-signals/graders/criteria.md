---
type: llm
---

Judge the priority judgment against the supplied report (run 202, ledger commit `e57c1a9`) and the proposed RSI-period change. The report's drawdown and capital slices map to duties such as A3, E1, E2 and E3 in the duty directory.

1. Does the leading action cite the run or ledger commit, a report slice or section, a measure and its observed direction?
2. Does the response draft the priority judgment body for the ledger, and does that body reference the report's readings without copying their values (such as 29.5%, 147, 0.98, 3.4, 14% or 4.1%)? The reply outside the body may show them.
3. Does it name the affected duties by their duty-directory ids (for example A3, E2 or E3) and explain how the policy change could address the observed exposure or drawdown pattern?
4. Does a parameter change have a report-based rationale or is it explicitly exploratory, with the colleague's smoothing preference alone not presented as evidence for its period or priority?
5. Does it blame costs or a single instrument, which the report's fee stress and top-instrument share rule out?

PASS if 1, 2, 3 and 4 are yes and 5 is no. FAIL otherwise. Do not require a signal-table row or a predetermined next rule.
