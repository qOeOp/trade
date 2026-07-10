# Review Domain

## 输入

- strategy markdown
- catalog evidence
- optional closed-flow `trade.db` reviews
- R&D program state path when feedback should enter research memory

## 输出

- strategy review report
- strategy evidence records
- strategy status transition result
- optional R&D memory feedback

## 负责

- evidence freshness and policy hash checks
- `draft -> shadow -> live-small -> paused` promotion gates
- replay / shadow / live-small attribution review
- strategy-cycle aggregation from DB reviews into evidence

## 禁止

- 触发 Binance write tools
- 伪造 replay / shadow / live evidence
- 用 conversation memory 替代 catalog evidence
- 直接改 R&D candidate mechanics

