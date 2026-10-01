# TrialFamily rangex-v1: are range-bound assets (oil) better for box fades than trending ones (gold)?

Written before `rangex/run.py` exists or any signal below is scored. The user widened this one test beyond crypto to
check the instrument-character idea where characters differ most.

## Assets (TradingView daily bars)

| Class | Symbols |
| --- | --- |
| commodities | TVC:UKOIL (Brent), TVC:GOLD, TVC:SILVER, NYMEX:NG1! (natural gas, continuous), COMEX:HG1! (copper, continuous) |
| FX | FX:EURUSD, FX:USDJPY, FX:GBPUSD, FX:AUDUSD, FX:USDCAD, FX:USDCHF |
| index | TVC:NDQ (Nasdaq 100), TVC:DXY (dollar index) |
| crypto | BITSTAMP:BTCUSD, BITSTAMP:ETHUSD |

- **WTI excluded:** WTI (TVC:USOIL) printed a negative price in April 2020, so Brent stands for oil.
- **Roll gaps:** the continuous futures include roll gaps. This is a known caveat.

## Rules (daily bars; unchanged from earlier families)

- **Box:** the range-v2 box: 60 bars, 4-15 ATR wide, two touches per edge, sideways.
- **FADE:** range-v2 C, the rejection close at an edge, stop 0.5 ATR beyond, target the far edge.
- **BREAK:** range-v3 X1, the close beyond an edge, stop at the box middle, target one box width.
- **Common:** time limit 30 bars, stop first, against 20 random entries matched on year, side, stop in ATR and target in
  R. Costs are 0.03% per side outside crypto and 0.06% for crypto.

## Character and periods

- **Formation:** 2007-2018 (crypto from its first bar). It gives each asset's HOLD: the share of first box-edge tests
  that reached the box middle before a close 1 ATR beyond the edge.
- **Test:** 2019-01 to 2026-08, read once.

## Decisions

- **T1, reported (14 assets give little power):** the Spearman correlation across assets between formation HOLD and
  test-period FADE edge.
- **T2, decided:** assets with formation HOLD above the median form the range type, the rest the trend type.
  - **FADE:** holds when range-type assets have test-period edge above zero (95% asset-then-signal bootstrap) and above
    trend-type FADE edge.
  - **BREAK:** reported by type, the mirror of FADE.
- **Also reported:** oil against gold specifically, as the user's example: HOLD, FADE edge and BREAK edge.
