---
type: llm
---

A new root is to be designed; the user left the idea to the agent. There is no Bash, so the agent cannot run commands and has no coverage output. A source can subscribe to bars, MARK, funding, trades and metrics (open interest and long/short ratios); quotes, books and index prices are not served to a source. `--execution quotes` is a runner environment in which the venue fills against quotes (and which trades require), not a source subscription. Judge only the final response.

Q1. Does the response say what the mechanism must observe in the market?

Q2. Does the response name the inputs that observation takes (among bars, MARK, funding, trades, open interest and long/short ratios) and say why those? Bars alone count only if it says why the mechanism needs nothing else.

Q3. Does the response name the contracts or the pool this root would trade, and say why from the mechanism or the data held? Taking a contract with no reason, or because it is usual, is not this.

Q4. Does the response name `market coverage` as how it would check what the market holds for those inputs and contracts?

Q5. Does the response say or assume that a replay offers strategies only bars, MARK and funding, or that a source cannot use trades or metrics?

Q6. Does the response state coverage facts about `2026-09-02` as known, such as which contracts or months hold metrics, though the prompt gives none?

PASS if Q1, Q2, Q3 and Q4 are yes and Q5 and Q6 are no. FAIL otherwise.
