# Market Data Design

## 目标

市场数据只服务四个交易后果：

- `entry`
- `stop`
- `size`
- `no_action`

不能改变这四项的数据，只能作为 notes / refs，不进入 `action_intent`。

## 当前范围

只接 Binance USDM。接入优先使用 `Node + binance-api-node`；缺高层方法时才用少量 raw request。

当前可用数据：

- OHLCV
- bid / ask / bookTicker
- 24h ticker
- premium / funding / mark price
- open interest
- aggTrades
- depth
- liquidation-like zones
- R&D 长历史 OI / taker ratio（Binance Vision metrics）
- R&D 限窗 aggTrades / ±1% depth（Binance Vision，最多 7 天）
- Deribit DVOL；BRK BTC MVRV / SOPR / active-addresses average
- 账户侧 markPrice / liquidationPrice / 持仓 / 挂单 / 保护单

## 微观结构证据

微观结构只回答 market quality / execution risk，不直接回答方向。

优先级：

1. own Roll / VPIN
2. BTC Roll / VPIN
3. ETH Roll / VPIN
4. Roll impact / Amihud / Kyle 仅在策略明确需要时补

解释口径：

- Roll 高：短期价格变化序列相关增强；可支持等待突破确认、避免追价、调整挂单速度。
- VPIN 高：订单流 toxicity / adverse selection 上升；可支持缩小 size、放宽或重算 stop、进入 no_action。
- BTC / ETH Roll 或 VPIN 上升：作为 alt lane 的市场天气；不能替代单标的 setup 判断。
- skewness 暂不作为 MVP 证据；若后续使用，必须先有 setup 级验证。

微观结构 evidence 的合法落点只有：

- `entry`：追 / 不追 / 等回踩 / 等突破
- `stop`：止损是否太近、是否需要结构位重算
- `size`：是否缩仓、是否拒绝加仓
- `no_action`：市场质量差、毒性高、跨市场压力过大

## 最小证据包

单标的进入 PLAN 前，market evidence 最少回答：

| 问题 | 数据来源 |
| --- | --- |
| 现在能不能进 | OHLCV / bid-ask / spread / funding / own Roll / own VPIN |
| stop 放哪里 | OHLCV structure / liquidation-like zones / volatility-tail regime |
| 仓位能不能给 | liquidity / spread / account risk / own VPIN |
| 是否应该 no_action | invalidation / stale data / event risk / poor liquidity / BTC-ETH microstructure stress |

不要求每轮都拉全量数据。缺什么补什么。

## Skill 边界

| Skill | 职责 |
| --- | --- |
| `ohlcv-fetch` | 多周期 K 线 |
| `binance-symbol-snapshot` | 单标的当前市场状态 |
| `binance-aggtrades-fetch` | 成交流原材料 |
| `binance-liquidation-zones` | liquidation-like zones |
| `binance-market-scan` | 候选粗筛；不得直接触发 live action |
| `tech-indicators` | 本地 OHLCV 结构、指标与轻量微观结构统计 |

`binance-market-scan` 只能回答“先看谁”。候选必须回到 `single-symbol`，并通过 setup 资格证。

## 存储

- OHLCV 继续使用 CSV + manifest；项目级读取通过 `data_catalog.db.dataset` 建索引，不靠目录扫描。
- 微结构、aggTrades、depth、liquidation-like 输出默认只作为 refs。
- 不新增 market snapshot 表。
- replay / shadow 需要的数据由对应 skill 输出引用，不进入 `trade.db`。
- 未被 refs / evidence / review / `.pin` 引用的市场 artifact 不长期保留；默认先用 `trade-flow --catalog-stale` 看 catalog 候选，删除走 `--catalog-gc --yes` 或旧 `--artifact-gc` 显式清理。
- Vision ZIP 只在进程内校验、解压、聚合，不落长期缓存；factor report 是唯一持久结果。
- 大型 factor report 不整体入库；只把 source manifest、hash、bytes、summary metrics、artifact ref 写入 catalog。
- 完整 L2 queue、真实 liquidation、带地址标签的 exchange netflow 与完整历史 option surface 以 `capability_gaps` 明示。

## 禁止项

- 不为每类数据新增一个 skill。
- 不把市场解释写进接入脚本。
- 不把全市场扫描结果直接交给 LLM 做 live action。
- 不为了“可能有用”长期落盘微结构数据。
- 不把临时 replay / scan / microstructure 输出当长期资产堆在项目里。
- 不把 Roll / VPIN 变成裸交易信号。
- 不为 skewness、Kyle、Amihud 提前扩 MVP。
- 不把不能改变 `entry / stop / size / no_action` 的数据接入主决策。
