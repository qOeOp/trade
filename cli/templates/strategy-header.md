# Strategy file header

Every strategy file starts with this docstring: the source line, then one line per duty, 27 in nine
groups. Duty definitions: research-round `references/duty-directory.md`.

```text
"""
<Strategy name>: <one sentence on the return mechanism>
Source: <DOI / arXiv / URL, with version or date>; source bundle <bundle name>

Duty stances: one line each, "id stance | one-sentence reason | source label"
stance in adopted / default / not applicable; source label in source / implementer / researcher
(researcher: a rule from the source carried to another market, timeframe or instrument)

[A Instruments and applicability]
A1 Investable instruments and eligibility: <stance> | <reason> | <source label>
A2 Dynamic selection and replacement: <stance> | <reason> | <source label>
A3 Market-structure / condition filter for the mechanism: <stance> | <reason> | <source label>

[B Forecasting and learning]
B1 Expected return / relative mispricing: <stance> | <reason> | <source label>
B2 Forecast horizon and decay: <stance> | <reason> | <source label>
B3 Signal combination and estimate updating: <stance> | <reason> | <source label>

[C First action and memory]
C1 First entry and trigger: <stance> | <reason> | <source label>
C2 Inaction, re-entry and path dependence: <stance> | <reason> | <source label>

[D Economic structure]
D1 Single-leg / multi-leg structure: <stance> | <reason> | <source label>
D2 Hedging and nonlinear exposure: <stance> | <reason> | <source label>

[E Risk and allocation]
E1 Per-opportunity risk and size: <stance> | <reason> | <source label>  <- hard contract, never not applicable
E2 Portfolio exposure, concentration and common risk: <stance> | <reason> | <source label>
E3 Risk budget after equity changes: <stance> | <reason> | <source label>
E4 Allocation across opportunities / strategies: <stance> | <reason> | <source label>  <- hard contract, never not applicable

[F Position path]
F1 Active scaling in and adding: <stance> | <reason> | <source label>
F2 Active reduction and position path: <stance> | <reason> | <source label>
F3 Dynamic protective / profit boundaries: <stance> | <reason> | <source label>
F4 Full exit, timed exit and post-exit cleanup: <stance> | <reason> | <source label>
F5 Handling existing holdings on membership / model change: <stance> | <reason> | <source label>  <- hard contract, never not applicable

[G Implementation]
G1 Execution style and price: <stance> | <reason> | <source label>
G2 Waiting, refreshing and post-fill feedback: <stance> | <reason> | <source label>
G3 Impact, capacity and implementation speed: <stance> | <reason> | <source label>

[H Capital]
H1 Cash, financing and carry costs: <stance> | <reason> | <source label>
H2 Margin, collateral and buffers: <stance> | <reason> | <source label>  <- hard contract, never not applicable
H3 Short availability and financing disruption: <stance> | <reason> | <source label>

[I Lifecycle and feasibility]
I1 Contract / event lifecycle: <stance> | <reason> | <source label>
I2 Exit feasibility and future resources: <stance> | <reason> | <source label>

"""
```

Write the header line by line from this template, in English: each of the 27 duties with its stance
(`adopted` / `default` / `not applicable`), one reason and its source label (`source` / `implementer` /
`researcher`). The four hard contracts, E1 per-opportunity risk and size, E4 allocation across
opportunities, F5 handling existing holdings on membership change and H2 margin buffer, are never
`not applicable`. A header kept from a parent keeps its unchanged lines byte for byte, whatever
their language.
