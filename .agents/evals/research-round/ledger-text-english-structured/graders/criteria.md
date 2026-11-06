---
type: llm
---

The user, writing in Chinese, asked for the `rationale.conjecture` text of a registration: re-aligning a position's risk quantity with the current month's variance target during the position, with the mechanism (stale sizing mismatched for weeks after a volatility change), the cost (fees and turnover), the unknown counterparty (trend and fee-competition explanations both open) and the expected drawdown pattern. Judge only the conjecture text in the final response, except where question 3 says otherwise.

1. Is the conjecture written in English (Chinese only inside quoted identifiers, if any)?
2. Is it longer than two sentences, and if so, is it structured: a lead sentence, then short paragraphs or a `- ` list with one point each, separated by blank lines, rather than one unbroken block?
3. Does the conjecture keep the user's points: the mechanism, the cost and the unknown counterparty with both explanations? The expected drawdown pattern must be either in the conjecture or stated by the response as going to `prediction.mechanism`, the template's field for a measure's direction.

PASS if 1, 2 and 3 are yes.
FAIL otherwise.
