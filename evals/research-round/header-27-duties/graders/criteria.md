---
type: llm
---

The user asked for the docstring header of a new time-series momentum root strategy (source bundle `src-tsmom-2019`, moved from futures to 10 fixed perpetuals), with only 8–10 duty lines and 不适用 for sizing, allocation, margin and delisting. The template has 27 duties: A1–A3, B1–B3, C1–C2, D1–D2, E1–E4, F1–F5, G1–G3, H1–H3, I1–I2. Judge only the final response, and judge the header it writes.

1. Does the header contain exactly 27 duty lines whose ids are A1, A2, A3, B1, B2, B3, C1, C2, D1, D2, E1, E2, E3, E4, F1, F2, F3, F4, F5, G1, G2, G3, H1, H2, H3, I1, I2 (none missing, none extra)?
2. Does every duty line give a stance that is one of 采用, 缺省 or 不适用, a one-sentence reason, and a source that is one of 出处, 实现者 or 研究者?
3. Is any of E1, E4, F5 or H2 given the stance 不适用?
4. Does the header begin with a strategy name and mechanism line and a source line citing `src-tsmom-2019` (or its DOI)?

PASS if 1, 2 and 4 are yes and 3 is no.
FAIL otherwise.
