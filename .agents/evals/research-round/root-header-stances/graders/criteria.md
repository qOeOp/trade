---
type: llm
---

Context: the root transcribes a long-only channel breakout onto one BTC perpetual. The source and the implementer state an entry, a full exit, a size (20% of equity), a fixed stop (the 10-bar low) and an order price (a limit 0.5% through the last minute close), and nothing else. A market filter, a second signal, adding and partial reduction are methods the strategy leaves unused, though each could be used on this contract. It has no funding rule, so the engine settles funding on its own. Judge only the duty lines of the header in the final response.

1. Are the A3, B3, F1 and F2 lines each given a stance other than `not applicable`?
2. Are the E1 line (the size) and the G1 line (the order price) each given the stance `adopted`? `default` on a line that states one of these rules is no.
3. Is the H1 line (cash, financing and carry costs) given the stance `default`?

PASS if 1, 2 and 3 are all yes.
FAIL otherwise.
