---
name: binance-account
description: 使用系统环境变量 `BINANCE_API_KEY` 和 `BINANCE_API_SECRET` 只读查询 Binance 账户状态。用于查看现货余额、现货挂单、U 本位合约余额、持仓、普通挂单，以及止盈止损/追踪止损等保护性订单；适合用户要求“看看我币安账户现在是什么状态”“查持仓/挂单/止盈止损”这类场景。
---

# Binance Account

## Overview

用这个 skill 生成 Binance 账户的只读 JSON 快照。它不会下单、撤单或修改订单，只负责读取账户、持仓和订单信息。

## 快速开始

1. 先确认环境变量已经存在：

```bash
./scripts/build-skills.sh
./.agents/skills/binance-account/scripts/binance-account --check-env
```

2. 拉取完整快照：

```bash
./.agents/skills/binance-account/scripts/binance-account
```

3. 只看某个交易对：

```bash
./.agents/skills/binance-account/scripts/binance-account --symbol BTCUSDT
./.agents/skills/binance-account/scripts/binance-account
```

4. 只看现货或只看合约：

```bash
./.agents/skills/binance-account/scripts/binance-account --spot-only
./.agents/skills/binance-account/scripts/binance-account --futures-only
```

## 工作流

### 1. 保持只读

- 把这个 skill 当成“账户体检”和“风险盘点”工具来用。
- 不要在这个 skill 里下单、撤单、改止盈止损。
- 如果用户下一步要执行交易操作，先单独确认，再切到别的工作流。

### 2. 运行 CLI

- 先运行项目根目录的 [scripts/build-skills.sh](/Users/vx/WebstormProjects/trade/scripts/build-skills.sh) 构建二进制。
- skill 入口是 [binance-account](/Users/vx/WebstormProjects/trade/.agents/skills/binance-account/scripts/binance-account)。
- Go 实现在 [cmd/binance-account/main.go](/Users/vx/WebstormProjects/trade/cmd/binance-account/main.go)。
- CLI 始终只返回 JSON；`--check-env` 也返回 JSON。
- 默认会读取：
  - 现货账户余额
  - 现货未成交挂单
  - U 本位合约账户资产
  - U 本位合约持仓风险信息
  - U 本位合约未成交挂单
- 默认会隐藏零余额，并把“普通挂单”和“保护性挂单”分开整理。

### 3. 解读 JSON 输出

- 先看余额：
  - 现货余额只保留 `free + locked` 非零的币种。
  - 合约资产只保留 `walletBalance`、`availableBalance`、`unrealizedProfit` 等字段非零的资产。
- 再看持仓：
  - 只保留 `positionAmt != 0` 的合约持仓。
  - 重点关注 `entryPrice`、`markPrice`、`unRealizedProfit`、`liquidationPrice`。
- 最后看挂单：
  - 把普通限价/市价相关挂单和保护性订单分开。
  - 保护性订单单独强调，避免漏看止盈止损覆盖情况。

### 4. 处理权限或接口失败

- 任何一个分区接口失败都不要直接让整次查询报废。
- 把失败限制在对应分区，例如“现货可读、合约权限不足”。
- 汇总时清楚写出缺失部分和报错原因。

## 保护性订单判定

- 现货保护性订单：
  - `STOP_LOSS`
  - `STOP_LOSS_LIMIT`
  - `TAKE_PROFIT`
  - `TAKE_PROFIT_LIMIT`
  - 属于 OCO 的挂单腿（`orderListId != -1`）
- 合约保护性订单：
  - `STOP`
  - `STOP_MARKET`
  - `TAKE_PROFIT`
  - `TAKE_PROFIT_MARKET`
  - `TRAILING_STOP_MARKET`
  - `closePosition=true` 的平仓保护单

## 输出建议

- 给用户的自然语言总结优先覆盖：
  - 非零余额
  - 当前持仓
  - 所有未成交普通挂单
  - 所有止盈止损/追踪止损单
  - 明显风险点：裸仓无保护、保护单方向不对、持仓有但没有对应 TP/SL
- CLI 默认返回 JSON，优先直接基于 JSON 继续分析。

## 参考

- 端点和分类说明见 [references/endpoints.md](references/endpoints.md)。
- 公开生态里最接近的现成实现包括：
  - `jkpark/agent-skills@binance-api-usage`
  - `ticruz38/skills` 里的 `binance` / `binance-auth`
  - `sundial-org/awesome-openclaw-skills@binance`
- 这些实现分别偏向示例、认证层或通用交易入口；本 skill 则专门收敛到“用现成环境变量做只读账户快照”。
