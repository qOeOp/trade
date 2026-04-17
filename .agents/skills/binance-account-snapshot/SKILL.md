name: binance-account-snapshot
description: 使用系统环境变量 `BINANCE_API_KEY` 和 `BINANCE_API_SECRET` 只读读取 Binance 账户状态。适合查看余额、持仓、普通挂单、保护单，以及必要时按 symbol 补历史订单。
---

# Binance Account Snapshot

读取账户全景快照，不下单、不撤单、不改保护。

## 快速开始

1. 先确认环境变量：

```bash
cd .agents/skills/binance-account-snapshot
./scripts/main.ts --check-env
```

2. 拉完整账户快照：

```bash
cd .agents/skills/binance-account-snapshot
./scripts/main.ts
```

3. 只看某个 symbol：

```bash
cd .agents/skills/binance-account-snapshot
./scripts/main.ts --symbol BTCUSDT
```

4. 只看现货或只看合约：

```bash
cd .agents/skills/binance-account-snapshot
./scripts/main.ts --spot-only
./scripts/main.ts --futures-only
```

5. 需要时补历史订单：

```bash
cd .agents/skills/binance-account-snapshot
./scripts/main.ts --symbol BTCUSDT --include-history
./scripts/main.ts --symbol BTCUSDT --include-history --history-limit 50
```

## 使用边界

- 这是只读 skill。
- 它负责账户体检，不负责执行交易动作。
- 输出重点是余额、持仓、普通挂单、保护单、分区级错误。
- 若要执行动作，切到：
  - `binance-order-preview`
  - `binance-order-place`
  - `binance-order-cancel`
  - `binance-position-protect`

## 脚本约定

- 入口源码是 [main.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-account-snapshot/scripts/main.ts)。
- 当前本 skill 的脚本 helper 已内联在 [main.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-account-snapshot/scripts/main.ts)。
- 依赖定义在 [package.json](/Users/vx/WebstormProjects/trade/.agents/skills/binance-account-snapshot/package.json)。
- 依赖 `binance-api-node`。
- 优先直接执行 `./scripts/main.ts`；只有本机首次运行或提示依赖缺失时再执行 `bun install`，不要每次都先装一遍。
- 脚本只返回 JSON。
- `--include-history` 必须配合 `--symbol` 使用。
- 默认会隐藏零余额，并把普通挂单与保护单分开整理。
- 合约保护单会同时读取普通挂单接口和 Algo 条件单接口。
- 当期货母单出现 `strategyType=OTO` 或 `OTOCO` 时，公共 API 可能读不到附带 TP/SL 明细；出现 `manualTpSlRequired=true` 时，要明确告诉用户需要手动提供价格。

## 输出建议

- 先看非零余额，再看持仓，再看普通挂单与保护单。
- 优先指出裸仓无保护、保护方向错误、持仓和 TP/SL 数量不匹配。
- 若某个分区失败，不要让整次分析报废，要明确缺了哪一块。

## 参考

- 端点和分类说明见 [references/endpoints.md](references/endpoints.md)。
- 本 skill 只收敛到账户快照，不承担“所有 Binance API 的总入口”。
