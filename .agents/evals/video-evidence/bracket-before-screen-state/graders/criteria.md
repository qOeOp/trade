---
type: llm
---

E088 narrates drawing a line, and the only grid row inside its span is t=528.0, near the segment's start. The agent has no shell or files here, so a step it writes out counts as done and placeholders are fine. Judge only the final response.

Q1. Does it refuse to cite the grid frame at t=528.0 as what shows the drawn line?

Q2. Does it take a bracket around the end of E088 (T about 532.9, half-width one frame interval, 1/30 s), with the `frames/` recipe writing three frames with their hashes?

Q3. Does it cite the chosen frame by `media_sha256`, `pts` and `decoded_sha256` from that bracket's `grid.tsv`, with looking at its PNG as a step before citing?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
