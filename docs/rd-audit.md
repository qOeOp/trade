---
title: R&D Module Audit
updated_at: 2026-07-09 09:19 CST
---

# R&D Module Audit

结论：方向是对的，已明显强于普通“参数搜索 + 漂亮回测”。当前机制适合做**有限假设验证**，不适合扩大成持续自动挖策略；要投入真实策略研发，最关键的是持续守住 holdout、edge margin、shadow 执行归因三道门。

## 修复状态

- 已补：campaign validation 必须与 discovery 保持 locked holdout embargo；默认按 `max(max_hold_bars, factor lookback, funding interval)` 换算。
- 已补：R&D candidate 与 strategy promotion 的 OOS gate 增加 raw/effective sample 与净 edge margin，不再只看正收益。
- 已补：`shadow -> live-small` 只接受 review-derived shadow attribution；手工填 `execution_attribution` 不能补齐 live-small gate。
- 未补：delisted / inactive symbol panel、capacity / market impact 分桶、DSR/PBO 完整统计实现。

## 外部校准

- White 的 Reality Check 重点不是“不要搜索”，而是承认时间序列里数据复用几乎不可避免，必须检验“搜索出来的最好模型是否真的优于基准”。见 [White 2000](https://www.ssc.wisc.edu/~bhansen/718/White2000.pdf)。
- Harvey/Liu/Zhu 对 factor zoo 的结论很硬：大量因子挖掘后，传统 `t > 2` 不够，新因子通常要更高门槛。见 [NBER w20592](https://www.nber.org/system/files/working_papers/w20592/w20592.pdf)。
- Bailey/Lopez de Prado 系列把问题落到 DSR/PBO：Sharpe / 回测表现要同时修正多重测试、样本长度、非正态与选择偏差。见 [DSR](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551) / [PBO](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253)。
- 实盘差异主要来自 reality model：fee、fill、slippage、capacity、market impact 与 broker/live reconciliation。见 QuantConnect [reality modeling](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/key-concepts)、[slippage](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/slippage/key-concepts)、[reconciliation](https://www.quantconnect.com/docs/v2/writing-algorithms/live-trading/reconciliation)。
- 参数优化如果在同一历史段反复找最优再回测，本质就是 look-ahead。见 QuantConnect [optimization parameters](https://www.quantconnect.com/docs/v2/writing-algorithms/optimization/parameters)。

## 当前强项

- `calibration -> R&D -> locked holdout -> evidence -> shadow -> live-small` 的链路边界清楚；R&D ledger 和 strategy evidence 分离，避免失败搜索污染交易事实。
- campaign 有全局 `<=10` trial budget；locked holdout 重复使用会被 `strategy-rnd-ledger` 拦住。
- replay 已固定 next-open、stop-first、gap 更差开盘、双边 fee/slippage、funding coverage gate、fingerprint freshness。
- candidate 必须过 side-flip / entry-lag null；panel R&D 有 asset shuffle null；promotion gate 会挡住缺 funding、panel null、robustness、shadow attribution 的证据。
- 文档明确禁止自动升格和 holdout 失败后继续调参，这是正确的研究纪律。

## P0 缺口

1. **Holdout 只查不重叠，缺 embargo。**（已补）
   `strategy-rnd-campaign.ts` 只要求 discovery / validation manifest 时间范围不重叠；若 validation 紧贴 discovery，仍可能泄漏持仓标签、indicator lookback、funding/market state。  
   整改：新增 `RND-HOLDOUT-EMBARGO`，要求两段之间至少隔开 `max(max_hold_bars, max_feature_lookback, funding_interval)` 对应时间；带 factor report 时 embargo 还要覆盖 factor lookback。

2. **升 shadow 的统计门槛偏低。**（已补基础门槛）
   当前 locked holdout `sample_count >= 10` 且正收益/PF `>=1.05` 可以过 replay 层。对 4H swing 可接受为“影子候选”，但不能证明 edge；在现在的市场里，10 笔很容易被 regime 和执行误差吞掉。  
   整改：增加 `effective_sample_count`、bootstrap 下置信界、DSR/PBO 或等价保守统计；同时要求净 edge 超过成本模型误差缓冲，比如 `avg_r_lower_ci > 0` 且 `net_edge > 2 * execution_error_band`。

3. **Shadow 执行归因还不够自动。**（已补 gate 来源约束）
   roadmap 已标“下一块”：从真实 shadow order/event 自动汇总 fee、slippage、funding。只要这里依赖人工填报，`shadow -> live-small` 就可能被乐观归因放行。  
   整改：live-small 前只接受由 shadow order、mark/last、funding event、exchange fill/reconcile 自动生成的 attribution；人工 notes 只能解释，不能补齐 gate 字段。

## P1 缺口

- **缺 strategy thesis certificate。** 每个 campaign 应预声明：edge 机制、谁在亏钱/为什么会持续、适用 regime、失效条件、预期持仓/换手/成本敏感度、对应 null。否则 bounded composer 仍可能变成“克制版形态百科”。
- **Panel 仍有 survivorship bias。** 20 个当前可交易资产比单 BTC 强，但没有 delisted / 下架样本前，不能声称机制跨周期可靠。
- **Reality model 还缺 capacity/impact 闭环。** 当前不伪造 maker 队列成交概率是正确的；下一步应把 live/shadow slippage 反灌到 replay cost model，按资产流动性和订单占成交量分桶。
- **负对照够实用，但还不够先进。** side-flip、entry-lag、asset-shuffle 是好底线；若以后要“卷”到更高质量，应引入 CPCV/PBO/DSR 或 White Reality Check 风格的全 trial 统计，而不是继续加单点规则。

## 实用流程判定

可投入使用的范围：

- 用 calibration suite 判断数据、成本、funding、panel 是否可靠。
- 用 campaign 做少量预声明假设验证。
- 把 locked holdout 通过者送入 shadow，禁止直接 live-small。
- 用失败 ledger 指导回到数据、成本、regime、样本或假设层，不继续加 trial。

暂不应投入使用的范围：

- 自动连续挖策略。
- 单资产漂亮回测升格。
- 未自动归因的 shadow 样本升 live-small。
- 看完 holdout 后改参数/过滤器继续使用同一 holdout。

## 最小整改队列

1. campaign 输入强制 `thesis_certificate`，空缺则零 trial。
2. calibration panel 增补 delisted / inactive symbol 来源；未完成前在 report 明示 survivor-only。
3. 增加 DSR/PBO 或等价统计报告，替代当前 heuristic edge margin。
4. 把 shadow/live slippage 反灌 replay cost model，形成 capacity / impact 分桶。
