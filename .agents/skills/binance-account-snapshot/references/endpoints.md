# Binance Account Endpoints

这个 skill 只做只读查询，只覆盖 USDM 永续。

## U 本位合约

- `GET /fapi/v3/account`
  - 读取合约账户资产汇总。
  - 使用 `assets` 做余额摘要。
- `GET /fapi/v3/positionRisk`
  - 读取合约持仓风险信息。
  - 用于展示 `positionAmt`、`entryPrice`、`markPrice`、`unRealizedProfit`、`liquidationPrice`。
- `GET /fapi/v1/openOrders`
  - 读取合约未成交订单。
  - 允许通过 `symbol` 缩小范围。
- `GET /fapi/v1/openAlgoOrders`
  - 读取合约未触发的条件单。
  - 允许通过 `symbol` 缩小范围。
  - 自 2025-12-09 起，`STOP_MARKET` / `TAKE_PROFIT_MARKET` / `STOP` / `TAKE_PROFIT` / `TRAILING_STOP_MARKET` 已迁移到这组 Algo 接口。
- `GET /fapi/v1/allOrders`
  - 读取合约历史普通订单。
  - 需要 `symbol`。
- `GET /fapi/v1/allAlgoOrders`
  - 读取合约历史条件单。
  - 需要 `symbol`。

## 保护性订单分类

视为保护性订单的条件：

- `closePosition=true`
- 或者 `reduceOnly=true`
- 或者在 Hedge Mode 下：
  - `positionSide=LONG` 且 `side=SELL`
  - `positionSide=SHORT` 且 `side=BUY`
- 仅 `type` 命中条件单家族还不够；`BUY STOP_MARKET + positionSide=LONG + reduceOnly=false` 这类突破开仓单应继续归在普通挂单侧

## 失败处理

- 某个接口报错时，保留其它接口结果，不要整体失败。
- 常见情况是：
  - API key 不能读某些字段
  - 账户本身未开通某类业务

## Best Practice

- 当前未完成订单快照：`openOrders + openAlgoOrders`
- 历史订单查询：`allOrders + allAlgoOrders`
- 如果输出需要排障友好，建议保留订单来源字段，例如 `source=openAlgoOrders`、`sourceType=algo`。
