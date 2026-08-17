# 设计证据

外部证据用于挑战本流程，不用于宣称 VibeTrader 已经盈利、可投产或等同于其他平台。Owner 命名、
绑定 permit 的命令协议、唯一 Recovery Case 闭合写入者以及 14 分组加一个通道 / 5 模块上限，仍是本项目的设计选择。

## 引擎边界与唯一交易路径

[NautilusTrader 架构](https://nautilustrader.io/docs/latest/concepts/architecture/)分离市场数据、风控、执行、
缓存和组合职责。其订单路径在路由到场所前验证风险，再把执行事实返回策略和组合状态。
[QuantConnect LEAN Algorithm Framework](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/overview)
用类型化交接分离标的选择、信号生产、组合构建、风险管理和执行。这些成熟设计支持明确所有权和
唯一可观察交易路径，但不能证明 VibeTrader 的具体 Owner 切分或 permit 协议。

## 研究主张与保护性评估

[The Probability of Backtest Overfitting](https://escholarship.org/uc/item/4w1110bb)把在历史数据上反复筛选
策略视为多重测试问题，并提出估计过拟合概率。[The Deflated Sharpe Ratio](https://papers.ssrn.com/sol3/Delivery.cfm/SSRN_ID2460551_code87814.pdf?abstractid=2460551)
对选择偏差和非正态收益下的表现做校正。它们共同支持记录试验族、在保护评估前冻结资格规则、
禁止保护结果反馈同一研发循环。单次 holdout 或单一指标不足以证明经济有效性。

## 回测 模拟与实盘递进

[Freqtrade 策略测试](https://www.freqtrade.io/en/stable/strategy-101/)区分历史回测与实时 dry run，并说明
两者结果为何不同。[NautilusTrader 环境](https://nautilustrader.io/docs/latest/concepts/architecture/)
在共用交易组件周围提供历史模拟、实时模拟和实盘上下文。这些实践支持在回测、模拟和实盘之间
保持 Runtime、Risk 和 Execution 语义稳定，只改变适配器和证据强度。

## 恢复与外部事实

[NautilusTrader 实盘对账](https://nautilustrader.io/docs/latest/concepts/live/)用场所回读对齐内部订单和
持仓状态，并持久化执行事件以支持恢复。这支持让 Execution 拥有外部效果和对账、显式保留不确定性、
在恢复闭合前必须获得场所证据。VibeTrader 的 Recovery Case 汇总和 `KNOWN_CLOSED` 仍是自身的失败关闭设计。

## 后续实现必须证明什么

- 研究凭证绑定来源身份、试验族、点时输入、成本和容量假设。
- Qualification 独立于研究，并可拒绝、撤销或要求更多证据。
- 模拟与实盘共享意图、风控、执行和记账语义，只更换效果适配器。
- 每个正常新增风险效果绑定当前终态 Risk Decision 和一次性 Reservation。正常 decrease-only 效果绑定
  明确 decrease-only Risk Decision 及 adapter admission/outcome，但不创建 Reservation 或 claim。Recovery
  仍使用独立围栏路径。
- 盈利性、实盘风险控制和场所正确性必须由项目测试与运行证据证明，引用不能代替它们。风险暴露上限和控制也不能保证最大实际亏损，因为跳空、流动性、滑点和未知外部效果仍可能发生。
