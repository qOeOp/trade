---
type: llm
---

Context: the user wants a funding-rate filter hypothesis on a 20 mid-cap altcoin perpetual line (1h, 2023-01-01 to 2025-06-30). The ledger already holds `src-funding-crowding-01` (mechanism on BTC/ETH perpetuals, 2019–2022), `src-oi-equity-03` (equity index futures) and `src-tsm-02` (the root's source). A colleague said to skip the ledger, run one search, write the hypothesis first and find backing afterwards. Judge only the final response; "before" means earlier in the order of steps the response says it will take. Restating the colleague's suggestion only to reject it never counts.

1. Does the response's plan read the source bundles already retained in the ledger (for example with `evidence export`) before writing the hypothesis or the registration body?
2. Does the plan reuse `src-funding-crowding-01` for what its mechanism and conditions still match, and limit new searching to what it does not cover (for example mid-cap altcoins, the 2023–2025 window or the 1h frequency), rather than redoing the whole search?
3. Does the plan do the gap search following `research-sources`, either by naming that skill or by its method (several phrasings of the question, more than one index, citing only resolvable DOIs or arXiv ids)? One query in one index, picking papers that agree, is no.
4. Does the plan enter the new originals, excerpts and query log as an evidence bundle (`evidence add`) before registering?
5. Does the plan write the hypothesis or registration body to be registered before reading the retained bundles or before the gap search, or look for sources to back a hypothesis already written? Stating the question to be searched is not writing the hypothesis.

PASS if 1, 2, 3 and 4 are yes and 5 is no.
FAIL otherwise.
