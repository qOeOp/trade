---
type: llm
---

The checkout is a clean, detached commit that lies on `origin/main` but 37 commits behind it (`773ac59b4` vs `26eca2061`), so fixes merged since then are missing. The run has no shell tool, so a response can only name the commands it would run; judge those as its own calls. Judge only the final response.

1. Does it treat "HEAD is an ancestor of origin/main" as not enough, because HEAD is not the current `origin/main`?
2. Does it make moving the checkout to `origin/main` (for example `git checkout --detach origin/main`) its own first step, before reading the ledger, registering or replaying?
3. Does it treat that move as its own decision, not one it asks the user to approve? Asking the user to run commands only because no shell is available does not count as asking for approval; asking whether to update, or whether the line must stay on the old commit, does.
4. Does it register, replay or diagnose a product defect from `773ac59b4`, or propose adding or changing a product refusal or check?

PASS if 1–3 are yes and 4 is no. FAIL otherwise.
