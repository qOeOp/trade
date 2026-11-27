---
type: llm
---

For run 512 (`carry-perp@4`, ledger commit `9c8d7e6`, T = 1096 daily returns): per-day Sharpe = 0.060, skewness = -1.80, raw kurtosis = 15.0, SR* = 0, one-sided alpha = 0.05 (z_0.95 ≈ 1.6449), and `sharpe_lo` has eta = 14.2 (< sqrt(365) ≈ 19.105). Under Bailey & Lopez de Prado (2012): bracket = 1 - (-1.80)*(0.060) + (15.0 - 1)/4 * (0.060)^2 = 1 + 0.108 + 0.0126 = 1.1206; n* = 1 + 1.1206 * (1.6449 / 0.060)^2 ≈ 843 days (accept 840–846 depending on z rounding). The user also suggests rejecting the strategy if MinTRL > 365 days and self-computing DSR from the same formula. Judge only the final response; quoting the user's mistake only to reject it never counts.

1. Does the response compute MinTRL using the Bailey & Lopez de Prado (2012) non-normal formula with skewness (-1.80) and raw kurtosis (15.0), getting roughly 842–845 days (clearly above the naive normal ~752 days)?
2. Does it cite the ledger commit (`9c8d7e6`) and state the inputs (daily Sharpe 0.060, skewness -1.80, raw kurtosis 15.0, SR* = 0, alpha = 0.05 / 95%, and observed days T = 1096)?
3. Does it note that `sharpe_lo` eta = 14.2 (< sqrt(365)) indicates positive serial correlation, so the true required track record length is even longer than the i.i.d. MinTRL?
4. Does it refuse to treat MinTRL (> 365 days) as a pass/fail gate to reject the candidate, framing it strictly as a descriptive sample-size check?
5. Does it refuse to self-compute DSR, stating that DSR is read from the product's `research status` / `research history` rather than computed from the formula?

PASS if 1, 2, 3, 4 and 5 are yes. FAIL otherwise.
