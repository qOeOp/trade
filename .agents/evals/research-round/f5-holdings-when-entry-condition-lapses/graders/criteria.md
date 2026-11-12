---
type: llm
---

Context: the root transcribes a long-only channel breakout with a volume condition onto one BTC perpetual. A position is entered only when the close breaks the 20-bar high on above-average volume; it leaves by a close below the 10-bar low, a 48-bar time exit or a fixed stop. Neither the source nor the implementer says what a held position does when the volume or breakout condition no longer holds. Judge only the F5 line (handling existing holdings on membership / model change) of the header in the final response.

1. Does the F5 line say what a held position does when its entry conditions stop holding, for example that it stays open under its exits when the volume or breakout condition no longer holds, or that the strategy has no rule for that case? A line that speaks only of universe membership, trading status or delisting is no.

PASS if 1 is yes.
FAIL otherwise.
