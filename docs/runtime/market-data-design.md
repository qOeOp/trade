---
title: Market Data Design
role: runtime-feature-contract
status: active
owner: market-data-products
last_verified: 2026-07-23 CST
---

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

这里的 `depth` 是按需 snapshot / ref 能力；新建的常驻 L2 service 仍是未切 consumer 的 `active-partial` production candidate。连续数据面的 authority、恢复与程序化消费边界见 [L2 Order Book Data Plane](./l2-order-book-data-plane.md)。

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

## Tool 边界

| Tool | 职责 |
| --- | --- |
| `ohlcv-fetch` | 多周期 K 线 |
| `binance-symbol-snapshot` | 单标的当前市场状态 |
| `binance-aggtrades-fetch` | 成交流原材料 |
| `binance-liquidation-zones` | liquidation-like zones |
| `binance-market-scan` | 候选粗筛；不得直接触发 live action |
| `tech-indicators` | 本地 OHLCV 结构、指标与轻量微观结构统计 |
| `market-data-store` | canonical candle owner query；向 Research 导出 content-addressed、immutable candle slice manifest/ref |

Runtime、execution defense 与 R&D 不再用自然语言要求“给我某币的数据”。它们提交封闭版本的 `trade.market-data-demand`：v1 保留 L2 / OHLCV / indicator，v2 才增加 exact half-open funding event window；两版都有稳定 consumer / subject ref、priority、symbol、product requirement 和 bounded lease。Market Data owner 只允许同一语义 identity 延长 lease，保存 prior hash 审计，支持显式 release，并生成无生命周期 authority 的合并 proposal。Flow Projector 已显式投影 active-flow symbol；manager 每轮将仓位 / 未知状态 / 挂单同步为 defensive demand，将待执行 action 同步为 active-plan demand，普通 flow 为 active-flow demand。J03 粗筛候选以 opportunity lease 登记；R&D 只能提交显式 symbol / requirement，不能从论文、hypothesis 或 strategy prose 猜 symbol。

五类 resident worker 消费同一 owner proposal：`market-data-runtime-manager` 将 L2 demand 编译为 bounded per-symbol owner / consumer pair；`ohlcv-demand-worker` 将 OHLCV demand 编译为闭合到 latest closed candle 或半开历史窗口的 aligned coverage target，经 self-hashed owner audit 后只补第一个精确 gap；`funding-demand-worker` 固定访问 Binance USDM funding endpoint，分页保存 bounded raw response，经 owner 验证连续 cursor、终页耗尽、decimal-string event 与 exact window 后才形成 immutable v2 fact，多个同窗 archive 冲突时不自动选最新；`indicator-demand-worker` 只在显式 indicator demand 有兼容 OHLCV demand 且精确窗口零 gap 时，导出 immutable candle slice，以 closed-world flags 调用 Go provider，剔除时间、主机路径和 prose 后形成 deterministic feature artifact，并 create-or-identical admission；`instrument-snapshot-worker` 对 owner-selected symbol 做 bounded public `exchangeInfo` 轮询，复用 15 分钟内成功快照，只把 exact bytes/receipt 写回 owner store。真实 provider 的 `selected_indicators` 是按指标名索引的 bounded object，不得另造数组合同。五者已进入 container profile 的同进程组和 readiness 门，但都不把 demand、进程存活、fetch 或 compute success 冒充 coverage / freshness；OHLCV complete 必须由下一次零 gap audit 证明，funding complete 必须由 owner raw-page audit 证明。Forward 对每个 immutable Dataset Candidate 另发 exact funding demand，窗口用 `[first_open, data_watermark + 1ms)` 保留末根收盘同刻结算；owner 只有在正 mark price、artifact bytes 和 archive lineage 全部闭合时导出 Replay slice，Research 只保存无 Replay authority 的 component binding。

Forward Research 不再直接抓 K 线：认证 Strategy source 先由 Research owner 固定 immutable Observation Program，机械推导严格晚于 freeze 的首根 candle 与 stable demand identity；无网络 resident 仅通过 `market-data.store` owner command 建立/续租 Research-priority OHLCV demand并回写 accepted receipt。第二个无网络 resident 只在 owner subscription plan 确认该 demand active/selected 后，对已闭合 candle 做有界零-gap audit 和 immutable slice export，再把 exact plan/audit/`MarketDataFactRef`/slice 串成 gapless append-only segment chain；分段避免长期进程反复导出累计全历史。segment 仍不是 Replay Dataset Manifest、Reservation 或 Forward Session。

Forward status/spec 不复用历史 Replay 的完整归档认证，也不把一次 `exchangeInfo` 当前值写成历史真相。Current Snapshot Provider 从成功 owner receipt/raw payload 机械生成 status、spec 与 accounting evidence；Research 使用独立 capability certification，只在序列首观测位于 freeze 与首根 bar 之间、末观测覆盖 watermark、相邻观测不超过 20 分钟时写 append-only component binding。Readiness v3 可据此移除 status/spec blocker，但必须保留 `inter_sample_history_claim=not_proven`；venue risk tier、maintenance margin 与 liquidation policy 由后续私有风险证据单独闭合。

下游不直接把进程状态、demand 或裸路径当市场事实。`trade.market-data-fact-ref.v1` 保持 L2 / OHLCV / indicator，v2 增加 funding；两版都绑定 product requirement、排序后的 demand ids、source plan hash、owner source ref/content hash、point/half-open coverage 和 live/immutable freshness，且 `domain_authority=none`。L2 只有 wrapper 实测 age 未超过 consumer TTL 的 live point 才能生成；OHLCV 只有 zero-gap audit 才能生成 complete fact；funding 只有 exact-window raw-page audit 才能生成；indicator 只有已登记的 deterministic artifact 才能生成。该 ref 证明“哪份 owner evidence 满足哪批需求”，仍不授予策略、下单、Replay 或生命周期 authority。

当前无多个 durable consumer 对同一高速流形成可量化 backlog，进程间控制量也已有 owner store / ref 合同，因此不引入 Kafka。只有出现持续 fan-out、独立 offset/replay 与无法由现有 bounded owner reads 解决的积压证据，才重开 broker 采用决策。

`binance-market-scan` 只能回答“先看谁”。候选必须回到 `single-symbol`，并通过 setup 资格证。

## 存储

- OHLCV canonical candles 写入 `ohlcv_store.canonical_candle`，由 `ohlcv-fetch` 按 latest candle 增量 upsert；CSV / manifest 不再作为事实源或 durable 存储方式。
- 正式 funding acquisition 把原始 REST page、request window、response hash、decimal-string event 和覆盖 audit 写入 append-only archive；既有可 upsert calibration funding row 只保留兼容用途，不能满足 Forward / Replay 的正式 exact-event gate。
- Research 不得跨域直读 `canonical_candle`。`data-split` 通过 `market-data.store` owner port 请求有界 candle slice，并只消费 `market-data://candle-slice/<sha256>` manifest/ref；CSV 是该不可变导出物的 payload，不是第二事实源。
- 微结构、aggTrades、depth、liquidation-like 输出默认只作为 refs。
- 不新增 market snapshot 表。
- replay / shadow 需要的数据由对应 tool 输出引用，不进入 `trade.db`。
- 未被 refs / evidence / review / `.pin` 引用且可重建的市场 artifact 不长期保留。当前入口仍先用 `modules/artifact-knowledge/artifact-catalog --catalog-stale` 看候选，删除走 `--catalog-gc --yes` 或 `--artifact-gc`；目标由 Program 周期触发 owner-authorized GC，不以磁盘不足作为日常人工阻断。
- 自动 GC 只能删除 owner 分类为已过 retention、无引用 / pin 且可重建的对象。Agent 可以解释未知大文件并提出候选，不能绕过 lineage / reference closure / release gate 删除；active flow、冻结研究 source、review evidence、durable store 和 incomplete incident 必须保留。
- L2 raw、manifest 和 Parquet 使用独立 retention authority；finalize / compaction、全部 consumer 引用闭包和 release 未完成前，通用 artifact GC 不得触碰。
- Vision ZIP 只在进程内校验、解压、聚合，不落长期缓存；factor report 是唯一持久结果。
- 大型 factor report 不整体入库；只把 source manifest、hash、bytes、summary metrics、artifact ref 写入 catalog。
- 常驻完整 L2、完整 L2 queue、真实 liquidation、带地址标签的 exchange netflow 与完整历史 option surface 以 `capability_gaps` 明示。

## 禁止项

- 不为每类数据新增一个 tool。
- 不把市场解释写进接入脚本。
- 不把全市场扫描结果直接交给 LLM 做 live action。
- 不为了“可能有用”长期落盘微结构数据。
- 不把临时 replay / scan / microstructure 输出当长期资产堆在项目里。
- 不把 Roll / VPIN 变成裸交易信号。
- 不为 skewness、Kyle、Amihud 提前扩 MVP。
- 不把不能改变 `entry / stop / size / no_action` 的数据接入主决策。
