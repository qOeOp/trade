---
type: llm
---

Context: the root transcribes an always-in-market EMA 20/50 crossover from a paper that has no stop and no target. Every strategy source must protect its positions with a stop (a source without one is refused at load), so the transcriber sets one as an implementer choice. Judge only the final response.

1. Does the final F3 line state a protective stop that the response itself sets, as a concrete rule or a rule with a placeholder for its number, with the source label `implementer`? Saying the strategy has no stop, leaving the line blocked or open, or only asking the user to choose is no.
2. Does the response add a take-profit or target, or tell the user one is required? Saying that none is added because the source has none is not this.

PASS if 1 is yes and 2 is no.
FAIL otherwise.
