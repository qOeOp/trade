# Research knowledge ledger: first entries (draft for review)

Source: `refs/archive/research/ronnie-2026-10-02` (b68818fc6), paths under `research/ronnie/`. Every entry is outside
evidence (one Research Source Provenance Record per cited file and line range), so its closures are lifted by an
in-product replication, not only by a new mechanism. The replication registers its SESOI before it runs, is counted in
the census, and has a detectable edge no larger than the closure's; one with less power leaves the closure in place.

Leak rule applied: only development-side figures are carried. The research's validation ("holdout"), reserve, final
and majors-2023-2026 tiers were gatekeeper-held, the role Qualification's holdout plays in the product. Their figures
are named below as EXCLUDED and not reproduced; only the pass/not-pass bit is kept, as the analogue of a public
phase, and it never sets a status by itself.

Scope labels use the research's buckets; on import they map to stratum policy v1 of the data-read ledger (majors =
17 largest, large caps = next 20, new listing < 365 days). Periods are half-open years.

## Findings

F1. **Fibonacci ratios carry nothing beyond nearby non-Fibonacci ratios.**

- Conditions: ratios used as entry layers (S4), filter, stop or target (R-F variants); crypto 53 coins 2018-2022.
- Evidence: S4 with placebo ratios 0.30/0.45/0.70 +0.056 [+0.012, +0.099] vs +0.060 with Fibonacci, inside the
  registered +-0.03 (`loop/LOG.md:1762-1764`); variant minus placebo -0.28 to +0.02 across R-F, PBO 0.01
  (`loop/LOG.md:2078-2081`); cycle-swing Fibonacci targets +0.020 [-0.007, +0.044], below SESOI
  (`loop/LOG.md:2213`, `RONNIE_2024_RULES.md:183-187`); outside: Tsinaslanidis et al. 2021 via search snippets only
  (`loop/LOG.md:2137-2139`).
- Construct: `fibonacci_ratio_set` -> CLOSED as a component, scope crypto majors + mid caps 2018-2022.

F2. **Limit orders resting at real structure levels are adversely selected.**

- Evidence: S1+S3 trades on the drawn zone map -0.05 to -0.12R against zone-placebo medians +0.11 to +0.19R; all 30
  placebo runs beat the calibrated map (`README.md:89-93`); S6 zone x trend-line intersection -0.21, worse than 95% of
  random entries (`README.md:21`); with a fidelity-checked line drawer, R-1 orders at a trend-line confluence -0.29R
  [-0.51, -0.06] on 3% of trades (`loop/LOG.md:2210`, `:2215-2217`).
- Note: the confluence filter itself is IMMATERIAL (under 10% of trades); the finding is about resting orders at
  structure, not about that filter.
- Construct: `resting_limit_at_structure_level` -> effect negative, development, crypto 2018-2022.

F3. **Trend lines and channels: a line through two pivots is not the source's technique; with a faithful drawer the
confluence is harmful and the channel target is only a distance effect.**

- Evidence: two-pivot lines reproduce 0-3% of his lines, a calibrated drawer 23-26% (`loop/WORKFLOW_NOTES.md:306-311`,
  `RONNIE_2024_RULES.md:183-184`); channel far rail as target +0.212R passes as registered but a fixed 6R target on the
  same trades earns the same (+0.402 vs +0.406) (`loop/LOG.md:2212`, `:2218-2220`); recent break of a line L2'
  -0.004 [-0.105, +0.108], parked (`loop/LOG.md:2211`); line quality features carry no information, all |t| < 1.4
  (`STRATEGIES.md:107`, `:206`).
- Constructs: `trendline_confluence_calibrated_drawer` -> harmful, immaterial as a filter; `channel_far_rail_target`
  -> ABSORBED into `target_distance`; `trendline_quality_features` -> CLOSED as a filter.
- Mechanism `trendline_two_pivot_encoding` -> PARKED for the source technique, revisit trigger = fidelity gap
  (`loop/CRITERIA.md:78-83`).

F4. **The exit carries more of the result than the entry.**

- Evidence: daily trend: random entries with the same exits also earned in 2018-2022; much of the result is the exit
  that lets winners run (`README.md:544-545`, `STRATEGIES.md:47`); time-only exit X4 dev +0.322 vs baseline +0.174
  [+0.065, +0.302] (`exits/result.txt:9`); farther targets raise mean R on R-1u (2R +0.219 to 6R +0.421) but lower win
  rate and weekly Sharpe (`loop/LOG.md:2221-2222`); Family B's return is trend exposure, absorbed into the trend book
  (`loop/RETROSPECTIVE.md:93-96`, `STRATEGIES.md:190`).
- EXCLUDED: X4 holdout figures (`exits/result.txt:9`, right column).
- Construct: `time_only_exit` -> effect positive, development; `entry_timing_over_random` -> finding scope note.

F5. **A factor that also predicts random entries is market timing, not skill.**

- Evidence: BTC trend flagged in 4 loops with a stable sign, and random entries showed the same bucket pattern
  (`loop/WORKFLOW_NOTES.md:129-139`); ledger: btc_trend ADMISSIBLE in Family A (`loop/ledger.txt:6`).
- Construct: `btc_trend_at_entry` -> REGIME (offered as a regime filter, never as entry skill).

F6. **"Touches" has opposite signs for range edges and swing levels; one name is two constructs.**

- Evidence: `loop/WORKFLOW_NOTES.md:203-205`; touches -0.11 in A3 and A9 (`loop/ledger.txt:13`).
- Constructs: `touches_swing_level` (negative, Family A), `touches_range_edge` (positive, E-1).

## Mechanism statuses (from `STRATEGIES.md:166-216`, development side only)

- **Carry K1, conditional cash and carry:** ACTIVE; scope crypto majors 2020-2022.
  - Development evidence carried: +20.9% a year [+15.7, +26.4], worst week -0.61% (`carry/result.txt:7-8`).
  - Excluded: holdout and final figures and per year decay 2023-2026 (`carry/result.txt:15-16`,
    `carry/final.txt:3-4`); keep only "final: PASS".
- **Carry K1b, K1p:** CLOSED as variants; scope as K1.
  - Development evidence carried: K1p -9.4% a year vs K1 (`STRATEGIES.md:177`).
  - Excluded: none.
- **Carry K2:** PARKED; scope crypto 2023-2026.
  - Development evidence carried: none on development.
  - Excluded: the closing figure is a holdout read (`STRATEGIES.md:178`). The original research closed it on a held-
    out read; in the product the closure must be established again from development-side evidence.
- **Trend B3 book, T0:** ACTIVE; scope crypto majors 2018-2022.
  - Development evidence carried: B3 Sharpe 1.45 vs 1.04 regime book, difference +0.46 [+0.10, +0.80]
    (`STRATEGIES.md:52-53`).
  - Excluded: validation 2023-2026 read (`STRATEGIES.md:55`).
- **Box break D-1:** ACTIVE; scope crypto 4h 2018-2022.
  - Development evidence carried: development +0.31; lookback plateau, pooled +0.14 [+0.03, +0.26]
    (`STRATEGIES.md:72`, `:83-85`).
  - Excluded: 14 unused coins, large caps, final, majors (`STRATEGIES.md:73-76`).
- **Box retest G-2:** ABSORBED into D-1; scope as D-1.
  - Development evidence carried: correlation +0.39 (`STRATEGIES.md:182`).
  - Excluded: reserve read.
- **Trend-line break F-1/F-2:** ACTIVE; scope crypto 4h 2018-2022.
  - Development evidence carried: iteration +0.23 [+0.11, +0.35] on 994 trades (`STRATEGIES.md:100-101`).
  - Excluded: reserve, majors, P-1 pooled holdout.
- **Capitulation O3/C-6:** PARKED, power capped; scope crypto daily.
  - Development evidence carried: C-6 iteration +0.58 [+0.30, +0.85] on 30 trades (`STRATEGIES.md:118`).
  - Excluded: O3 holdout, C-6 final (`STRATEGIES.md:117`, `:119`); data needed: a broader post-2022 universe
    (`STRATEGIES.md:128`).
- **Support bounces, family A:** CLOSED; scope crypto majors and mid caps, daily FX; intraday FX untested.
  - Development evidence carried: A12 equivalent-null on 1,189 trades (`STRATEGIES.md:191`).
  - Excluded: none.
- **Weekly support bounce A8:** PARKED; scope crypto daily.
  - Development evidence carried: +0.41 on 51 trades, a near miss (`STRATEGIES.md:162-164`).
  - Excluded: A8x new-coin retest (`STRATEGIES.md:163-164`). Who read A8x (the iterator or the gatekeeper) cannot be
    settled from the archive, so it is not carried; the original research closed A8 on it, and in the product the
    closure must be established again from development-side evidence.
- **Range and box fades:** CLOSED; scope crypto majors and mid caps; small caps untested.
  - Development evidence carried: E-4 equivalent-null (`STRATEGIES.md:192`).
  - Excluded: none.
- **Fading breaks G-1:** CLOSED; scope crypto.
  - Development evidence carried: -0.38 [-0.60, -0.12] (`STRATEGIES.md:193`).
  - Excluded: none.
- **Wedges and triangles:** CLOSED; scope crypto.
  - Development evidence carried: equivalent-null (`STRATEGIES.md:195`).
  - Excluded: none.
- **MTF alignment:** CLOSED; scope crypto.
  - Development evidence carried: M1, M3 equivalent-null, M2 harmful (`STRATEGIES.md:196`).
  - Excluded: none.
- **Shorts, short-v1:** CLOSED; scope crypto.
  - Development evidence carried: S1, S2, S4 harmful (`STRATEGIES.md:197`).
  - Excluded: none.
- **Pairs, family H:** CLOSED at 1h and above, PARKED intraday; scope crypto.
  - Development evidence carried: 4h -0.42%, 1h -0.19% net (`loop/WORKFLOW_NOTES.md:261-262`).
  - Excluded: none; revisit trigger: an execution simulator at the horizon.
- **Breakout funding veto S-2:** IMMATERIAL; scope crypto 4h.
  - Development evidence carried: touches 2% of trades (`STRATEGIES.md:205`).
  - Excluded: none.
- **Ronnie plan S1 zone bounce, S3 range play:** CLOSED; scope 53 crypto coins 2018-2022.
  - Development evidence carried: S1 -0.058 [-0.13, +0.01] on 6,656 trades (`STRATEGIES.md:209`).
  - Excluded: none.
- **Ronnie plan S4 layered pullback:** PARKED, below SESOI; scope 53 crypto coins 2018-2022.
  - Development evidence carried: +0.06 [+0.01, +0.10] on about 5,000 trades; not Fibonacci (F1)
    (`STRATEGIES.md:210`).
  - Excluded: none.
- **Role-reversal retest R-1u:** ACTIVE; scope 53 crypto coins 2018-2022.
  - Development evidence carried: +0.221 [+0.142, +0.297] on 4,300 trades after the fill-order fix
    (`STRATEGIES.md:213`).
  - Excluded: 69-coin holdout read; keep "stage 2: PASS".

Rulings (Lane 3, 2026-10-03):

1. A row whose only closing evidence is a held-out read is imported as PARKED, with the note "the original research
   closed it on a held-out read; in the product the closure must be established again from development-side
   evidence". A8 is treated the same, because who read A8x cannot be settled.
2. Per-year decay figures for K1 and the D-R decay diagnosis (`loop/decay_diagnosis.txt`) compare 2018-2022 with
   2023-2026, and 2023-2026 was a held-out tier there; they are excluded, not carried as construct decay.
