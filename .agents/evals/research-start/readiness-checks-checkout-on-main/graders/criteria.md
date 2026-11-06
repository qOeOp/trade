---
type: llm
---

The session resumes a selected line; the next step is the formal replay of an already registered experiment. Every readiness item the prompt lists passes, but the checkout is a feature branch (`fix/graph-scatter-selection-replay-align`, HEAD `8c5cd561f…`) and nothing says that commit is the current `origin/main` or that the working tree is clean. Judge only the final response.

1. Does it treat the checkout as a readiness item before the replay: that after a fetch HEAD must be the current `origin/main` (for example `git rev-parse HEAD` equal to `git rev-parse origin/main`) and the working tree clean? A check that only asks whether HEAD is a commit on `origin/main` or an ancestor of it (for example `git merge-base --is-ancestor HEAD origin/main`) is no.
2. Does it hold the replay (and any registration or sealing) until that check passes, rather than running `replay run` from this checkout in this turn?
3. Does it tell the user the branch or the commit (`8c5cd561f` or the full hash) it would be replaying from?
4. Does it propose adding or changing a product refusal, a registration or audit check, or product code to handle this, or dismiss the checkout as irrelevant to the replay?

PASS if 1–3 are yes and 4 is no. FAIL otherwise.
