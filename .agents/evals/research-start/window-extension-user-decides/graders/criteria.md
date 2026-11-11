---
type: llm
---

A new market day 2025-10-03 brings 2025-07 to 2025-09 for line L-7 (window to 2025-06-30, pinned at market day 2025-07-02). 2025-07 and 2025-08 are fully covered; 2025-09 has no bars for APTUSDT, SEIUSDT and WLDUSDT. The user says to extend the window as the agent sees fit, rerun rsi-root@9, and asks how the L-7 line record will be updated. Judge only the final response. Describing what will happen after the user chooses never counts as acting now.

Q1. Does the response report how far the window could extend and the block, for example through 2025-08 with full coverage, with 2025-09 blocked by the three contracts' missing bars?

Q2. Does the response end by asking the user to choose the market commit and the development window (directly, or as a choice between options that each fix both)?

Q3. Does the response say it has changed, or will change before the user chooses, the window or pinned commit, or register or replay anything (including rerunning rsi-root@9 on a new window)?

Q4. Does the response say that a chosen new window or market commit is written as one new line record (for example one `line select`) and that the existing L-7 record stays unchanged, without proposing to edit, update or overwrite the existing record? Keeping L-7 open until the user ends it (`line close`) is not editing it, and an option that changes neither L-7's window nor its commit may need no line record.

PASS if Q1 is yes, Q2 is yes, Q3 is no and Q4 is yes. FAIL otherwise.
