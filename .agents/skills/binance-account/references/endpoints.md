# Binance Account Endpoints

这个 skill 只做只读查询，当前使用的接口分组如下。

## 现货

- `GET /api/v3/account`
  - 读取现货账户基础信息和余额。
  - 从 `balances` 里筛出 `free + locked` 非零的币种。
- `GET /api/v3/openOrders`
  - 读取现货未成交订单。
  - 允许通过 `symbol` 缩小范围。

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

## 保护性订单分类

### 现货

视为保护性订单的条件：

- `type` 属于 `STOP_LOSS` / `STOP_LOSS_LIMIT` / `TAKE_PROFIT` / `TAKE_PROFIT_LIMIT`
- `orderListId != -1`

说明：

- OCO 的止盈腿可能不是 `TAKE_PROFIT*`，而是 `LIMIT_MAKER`。
- 因此 spot 侧不能只看 `type`，还要看是否属于 OCO。

### 合约

视为保护性订单的条件：

- `type` 属于 `STOP` / `STOP_MARKET` / `TAKE_PROFIT` / `TAKE_PROFIT_MARKET` / `TRAILING_STOP_MARKET`
- 或者 `closePosition=true`

## 失败处理

- 某个分区报错时，保留其它分区结果，不要整体失败。
- 常见情况是：
  - 只有现货权限，没有合约权限
  - API key 可读余额，但不能读某些账户分区
  - 账户本身未开通某类业务
