---
title: R&D Research Survey
updated_at: 2026-07-10 CST
---

# R&D Research Survey

结论：先进策略研发不是“搜索更大参数空间”，而是**约束搜索自由度、证明结果不是选择偏差、证明执行链吃不掉 edge**。当前项目方向正确，但若要接近专业研发流程，下一层不是加更多 family，而是补研究审计、统计校正、数据可用性证明与执行现实模型。

策略宇宙、research pipeline、agent 入口纪律与 family backlog 语义统一维护在 `docs/rd-strategy-universe-design.md`。本文件回答“如何证明”；主设计文档回答“应该研究哪些 edge、机制、数据面和执行语义”。两者必须同时成立：分类不完整会让 RD 错过大类机会，验证不严格会让 RD 把噪音落成策略。

## 1. 学术与机构方法

### Multiple testing / data snooping

- White Reality Check：问题不是不能搜索，而是必须检验“搜索出来的最佳模型”是否真优于基准；适合做全 trial universe 的最终审计。
- Hansen SPA / stepwise SPA：比 Reality Check 更不容易被大量无效候选稀释，适合在多个候选策略中判断是否至少有一个有预测能力。
- Sullivan / Timmermann / White：技术规则必须在完整规则宇宙下校正 data snooping；单独展示赢家没有意义。

落点：

- R&D ledger 不能只记录 winner；必须能重建本轮完整候选宇宙。
- 后续新增 `research_universe_id`：同一 hypothesis 下的全部 transforms / thresholds / negative controls / failed trials 共享一个统计校正上下文。
- 当前 `trial_count <= 10` 是好底线，但还不是 Reality Check / SPA。

### PBO / DSR / CPCV

- PBO / CSCV：估计“选中赢家其实是过拟合”的概率，重点关注候选选择过程本身。
- DSR：Sharpe / performance 指标要修正多重测试、样本长度和非正态。
- CPCV / purging / embargo：金融标签有持仓区间，普通 K-fold 会泄漏；要 purge overlapping labels，并 embargo 相邻样本。

落点：

- 已补 locked holdout embargo，但只覆盖时间边界；后续应把每笔 trade label 的 `signal_at / entry_at / exit_at / feature_lookback_start` 显式输出，做真正 label purge。
- effective sample / edge margin 只是底线；正式报告应至少输出 deflated edge、PBO / CSCV、min track record length 或 loss probability。
- Walk-forward 可作为部署模拟，不应替代 pristine holdout。

### Factor zoo / alpha decay

- Harvey/Liu/Zhu：因子越挖越多，传统显著性阈值偏低。
- Hou/Xue/Zhang：大量 anomaly 在更严格复制下失效，尤其微盘和交易摩擦相关结果。
- McLean/Pontiff：已发表 predictor 样本外和发表后都衰减；被发现的 edge 会被交易压缩。
- Chen/Zimmermann 与 Open Source Asset Pricing：可复现数据和代码本身成为研究资产；复制不是形式主义，而是防止“私有漂亮结果”。

落点：

- 项目不能把“有经济叙事”当成放松统计门槛的理由。
- `strategy.policy` 应区分 structural edge、temporary dislocation、execution edge、regime edge。
- 所有 strategy evidence 应默认带 decay watch：shadow/live-small 表现相对 replay 的衰减率。
- 若 strategy edge 只能通过越来越复杂的 feature/filter 维持，默认提高 overfit prior，而不是提高信心。

### Temporal leakage / point-in-time correctness

- 近期 point-in-time finance 研究把 lookahead 扩展到 LLM / research workflow：不是只防价格未来函数，而是防任何决策时点不可得的信息进入研究与解释链。
- 社区和工具实践也反复证明，lookahead 往往来自指标一次性全量计算、resample/join、当前 K 高低点、未来可见的 universe。

落点：

- 引入 `availability_at` 概念：OHLCV close、funding、OI、depth archive、external feature 都必须声明何时可用。
- replay family 不能只说“不读下一根 K”；feature report 也必须证明 causal alignment。
- 对 R&D artifact 增加 `temporal_contract`: `closed_candle_only / feature_availability_lag / universe_selection_time / label_purge`.

## 2. 交易员社区共识

社区材料噪音大，但真实痛点高度一致：

- 最大不信任来源：overfit、lookahead、survivorship/data quality、slippage/fees、regime change。
- 很多“神级回测”最后死于当前 bar high/low/close 泄漏、TradingView 类平台设置误用、指标全量 dataframe 未来函数。
- 老交易员对 backtest 的态度更保守：backtest 更像排除明显差策略，不是证明真钱可行；paper 也不等于真钱，小资金 live 才能暴露真实执行。
- 对 slippage 的实用建议通常偏悲观：用真实成交回灌模型；高换手策略若成本模型不硬，基本不可用。
- Walk-forward 被广泛认同，但社区也指出：要看参数稳定簇和 OOS 拼接曲线，不只是看一条漂亮收益曲线。

落点：

- 当前 `shadow -> live-small` 只能用 review-derived attribution 是对的；还应继续把 live-small attribution 回灌 replay cost stress。
- R&D 报告必须默认展示“为什么不信”：lookahead check、cost stress、样本独立性、regime dependency，而不是只展示 winner。
- 单策略 review 应增加 `replay_to_shadow_decay`、`shadow_to_live_decay`、`slippage_model_error`。

## 3. 开源系统模式

### QuantConnect LEAN

模式：专业 event-driven engine，强调 modular reality model：fill、slippage、fee、brokerage、margin、buying power 都可替换；研究、回测、优化、live 在同一引擎语义下走。

对项目启发：

- 不需要照搬全平台，但 execution reality 应做成可替换 contract，而不是散落在 replay 参数里。
- 当前 fee/slippage/funding 已有雏形；下一步是 per-symbol liquidity bucket + order-size bucket。

### NautilusTrader

模式：deterministic event-driven、research/backtest/live 共享核心组件；强调 nanosecond timestamps、message bus、portfolio/execution engine、order book / fill model。

对项目启发：

- 4H swing 不需要 L3 复杂度，但需要共享语义：online signal、replay、shadow、live-small 对同一个 setup 的 event sequencing 要一致。
- 若以后做更短周期，必须先升级 orderbook/fill simulation；OHLCV replay 不足以证明执行 edge。

### Freqtrade

模式：面向 crypto retail/prosumer，内建 backtesting、hyperopt、dry-run/live、lookahead-analysis、recursive-analysis。

对项目启发：

- Lookahead / recursive analysis 应成为 R&D gate，而不是文档提醒。
- 对 dataframe/feature 类 pipeline，必须支持“同一 strategy 在逐步可见数据下重算”和“全量数据下重算”差异检测。

### vectorbt / backtesting.py / backtrader

模式：

- vectorbt：超快向量化、多资产、多参数探索，适合 discovery，但也最容易让搜索空间失控。
- backtesting.py：轻量易用，适合小策略原型，不解决研究纪律。
- backtrader：事件驱动、订单类型、slippage、commission、volume filling，适合学习 execution realism。

对项目启发：

- Discovery 和 promotion 必须分层。vectorized speed 只用于生成假设，不产生资格。
- 项目应继续坚持 bounded composer；不能因工具快就扩大 trial budget。

### Microsoft Qlib

模式：端到端 AI quant workflow，覆盖 data processing、model training、backtest、risk model、portfolio optimization、execution，并有 RD-Agent 自动研发方向。

对项目启发：

- 自动 R&D 可以存在，但必须有人类定义的 hypothesis boundary、trial ledger、holdout policy 和 deployment gate。
- RD-Agent/Qlib 的价值在“把重复工程自动化”，不是让 agent 自由挖到满意为止；越自动，越需要 universe ledger、negative result、statistical correction。
- 对本项目而言，Qlib 更像远期参考，不是当前要复制的平台化目标。

## 4. 对当前 R&D 的升级建议

### P0

1. **Hypothesis certificate**
   已落地基础 gate：每个 campaign 开始前必须写 edge 类型、市场参与者行为假设、适用 regime、失效条件、成本敏感度、候选 universe、negative controls；空缺则零 trial。后续可增强 expected holding/turnover 与 negative control coverage。

2. **Temporal contract**
   已落地 replay provenance 基础版：每个 replay 输出 `reference_at / availability_at / lookback_start / label_end / universe_selected_at`，并记录 supplemental report 的 declared availability；缺 temporal contract 的 replay evidence 在 strategy review 中视为 legacy/stale。后续再做 factor pipeline 的逐步可见重算。

3. **Full-trial statistical report**
   已落地最小正式版：R&D batch 输出完整 trial universe、accepted/rejected、winner、OOS/effective sample、edge margin、deflated edge probability 与四时间块 CSCV/PBO；没有足够样本或 PBO 失败时不能叫 `candidate_ready`。后续补 White Reality Check / Hansen SPA 与更严格 DSR。

4. **Replay-to-shadow/live decay**
   已落地反馈基础版：strategy review 输出 replay、shadow、live-small 三段收益/成本衰减诊断与 `cost_model_feedback`；shadow 相对 replay 的 avg_r 保留率过低时阻断 live-small，真实 fee / slippage / funding drag 会反灌为下一轮 replay cost stress 输入。后续再接订单 notional / ADV / depth 的 capacity / impact 分桶。

5. **Forward holdout test loop**
   已落地测试版：冻结 candidate 后可在机器可读 `frozen_at` 之后的闭合样本上只读评估，并校验 benchmark / supplemental 数据同样 forward；输出状态、下一步动作和 candidate hash。缺 `frozen_at` 的 plan 被拒绝，不从文件名或 generated_at 推断。它是 shadow 前观察工具，不替代 pristine holdout、统计校正或实盘归因。

### P1

1. **Lookahead / recursive detector**
   对 factor pipeline 做逐步可见重算，比较全量计算结果；发现差异直接 blocker。

2. **Reality model feedback loop**
   已落地基础版：从 shadow/live-small evidence 聚合真实 fee、slippage、funding、total cost drag，输出 per-trade R 值与 unknown-size bucket。后续补 missed-fill、订单规模与流动性分桶。

3. **Panel survivorship repair**
   已落地基础防线：calibration panel 输出 `survivor_only`，并可通过外部归档 manifest 合入 inactive / delisted symbol。剩余缺口是真实 delisted 数据源与 listing-age-aware universe。

4. **Selection universe ledger**
   把所有自动生成候选、参数、filter、失败原因记录为同一 universe，支持以后做 SPA/PBO。

### P2

1. CPCV path report。
2. White Reality Check / Hansen SPA。
3. Capacity / impact model。
4. Strategy decay dashboard。

## 5. Sources

- White, *A Reality Check for Data Snooping*: https://www.ssc.wisc.edu/~bhansen/718/White2000.pdf
- Hansen, *A Test for Superior Predictive Ability*: https://www.jstor.org/stable/27638834
- Sullivan / Timmermann / White, *Data-Snooping, Technical Trading Rule Performance, and the Bootstrap*: https://ideas.repec.org/a/bla/jfinan/v54y1999i5p1647-1691.html
- Bailey / Borwein / Lopez de Prado / Zhu, *The Probability of Backtest Overfitting*: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253
- Bailey / Lopez de Prado, *The Deflated Sharpe Ratio*: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551
- Harvey / Liu / Zhu, *... and the Cross-Section of Expected Returns*: https://www.nber.org/papers/w20592
- Hou / Xue / Zhang, *Replicating Anomalies*: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2961979
- McLean / Pontiff, *Does Academic Research Destroy Stock Return Predictability?*: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2156623
- Chen / Zimmermann, *Open Source Cross-Sectional Asset Pricing*: https://www.openassetpricing.com/
- QuantConnect LEAN: https://github.com/QuantConnect/Lean
- QuantConnect reality modeling: https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/key-concepts
- QuantConnect slippage models: https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/slippage/key-concepts
- NautilusTrader: https://nautilustrader.io/
- Freqtrade lookahead analysis: https://www.freqtrade.io/en/stable/lookahead-analysis/
- Freqtrade recursive analysis: https://www.freqtrade.io/en/stable/recursive-analysis/
- Look-Ahead-Bench, point-in-time finance workflow benchmark: https://arxiv.org/pdf/2601.13770
- vectorbt: https://github.com/polakowo/vectorbt
- backtesting.py: https://github.com/kernc/backtesting.py
- backtrader: https://github.com/mementum/backtrader
- Qlib: https://github.com/microsoft/qlib
- Microsoft RD-Agent: https://github.com/microsoft/RD-Agent
- R&D-Agent-Quant paper: https://arxiv.org/html/2505.15155v2
- r/algotrading backtesting discussions: https://www.reddit.com/r/algotrading/
- QuantConnect robust backtesting discussion: https://www.quantconnect.com/forum/discussion/20140/robust-backtesting-guide-walk-forward-validation-transaction-costs-out-of-sample-testing/
