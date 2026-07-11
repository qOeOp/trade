# Execution Domain

## 输入

- plan / observe / strategy / account config
- preflight result
- execution contract input
- trigger condition
- explicit live-small authorization for Binance writes

## 输出

- deterministic preflight / trigger gate result
- execution command spec
- audited local `order_fill`
- live-small result shell
- shadow execution event

## 负责

- dry-run / shadow / live-small execution path
- execution contract compilation
- idempotency and trigger-condition gates
- mapping tool results to local `plan_event`

## 禁止

- 生成策略观点
- 绕过 preflight / execution contract
- 让 Binance write tool 直接写 `trade.db`
- 在 R&D/replay 路径触发 live writes

