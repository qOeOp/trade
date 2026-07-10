# Research Domain

## 输入

- OHLCV / funding / benchmark manifest
- strategy R&D payload
- `rd_program_state`
- strategy markdown 的 `Trade Contract`
- catalog refs / prior failure memory

## 输出

- replay / benchmark / calibration / panel R&D result
- R&D artifact under `tmp/artifacts`
- catalog run / artifact records
- draft strategy only when promotion gates allow it
- `rd_program_state` usage / lessons / next plan

## 负责

- strategy replay / signal evaluation
- R&D loop / campaign / panel validation
- family discovery and candidate evaluation
- negative controls, holdout, OOS, robustness gates
- forward holdout and shadow tracker research artifacts

## 禁止

- 写 `trade.db`
- 调 Binance write tools
- 把候选或 market scan 直接变成 live action
- 修改 account / notify config

