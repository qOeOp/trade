# Recovery Domain

## 输入

- local flow id / `chain_id`
- local `plan_event` history
- Binance account snapshot JSON
- optional safe apply authorization

## 输出

- reduced flow state
- reconcile drafts
- optional local reconcile events
- `needs_review` events for unmatched facts

## 负责

- local flow reduction
- exchange-fact reconciliation
- unknown / partial / unmatched fact classification
- conservative recovery before further action

## 禁止

- 开新风险
- 调 Binance write tools
- 把 foreign orders 强行归属当前 flow
- 用 research artifact 覆盖 exchange facts

