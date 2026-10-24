---
type: llm
---

Context: the root transcribes an EMA 20/50 crossover from a working paper (URL, v3, 2016-03-02, bundle `src-ema-cross-01`) tested on S&P 500 index futures daily bars; the root trades a BTC perpetual on 4h bars. A colleague suggested writing only the lines used and labelling every source "出处" (`source`). Judge only the header in the final response.

1. Does the header start with the source line giving the URL with its version or date (v3 or 2016-03-02) and the bundle name `src-ema-cross-01`?
2. Does the header contain all 27 duty lines — A1 A2 A3 B1 B2 B3 C1 C2 D1 D2 E1 E2 E3 E4 F1 F2 F3 F4 F5 G1 G2 G3 H1 H2 H3 I1 I2 — each with a stance (`adopted` / `default` / `not applicable`), a reason and a source label (`source` / `implementer` / `researcher`)? Check every id; omitting lines or collapsing them ("其余缺省") is no.
3. Is every line whose rule comes from the paper and is applied here to BTC perpetual 4h bars (such as the crossover signal, the entry and the reversal on the opposite cross) labelled `researcher` rather than `source`?
4. Are E1, E4, F5 and H2 each given a stance other than `not applicable`?

PASS if 1, 2, 3 and 4 are all yes.
FAIL otherwise.
