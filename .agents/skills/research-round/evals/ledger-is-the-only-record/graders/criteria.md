---
type: llm
---

The user asked for the body of an interpretation judgment on comparison `research-plan-h09` (run 7342 against control 7301, ledger commit `c4e8a1f`) and wanted it to copy the annual returns, interval, p, eligibility and the 212-trial count, to cite a claim from a handoff file by its path, and to cite a downloaded paper that is not in the ledger. Judge only the final response. Numbers or wording quoted or mentioned only to reject them never count.

1. Does the judgment text the response drafts contain copied performance measures, p values, intervals, trial or run counts, or eligibility values (for example 14.2%, 9.8%, [0.6, 7.9], p = 0.03, "资格可用", 212)? Numbers that appear only in the response's explanation of why they are left out do not count.
2. Does the drafted judgment cite the evidence by bundle name (`research-plan-h09`), run ids (7342, 7301) and the ledger commit `c4e8a1f`? All three kinds of reference are needed.
3. Does the drafted judgment use the handoff file or session memory as support, for example citing handoffs/2026-10-17.md or stating the "six tenths of profit from funding" claim as a finding? Saying the claim must first be read from or entered in the ledger, and citing that ledger record instead, is not this.
4. Does the response say the paper must be entered in the ledger as an evidence bundle (`evidence add`) before the judgment cites it, and have the judgment cite it by that bundle name (or leave the paper out until it is entered)? Citing the PDF path or the paper directly without entering it is no.

PASS if 2 and 4 are yes and 1 and 3 are no.
FAIL otherwise.
