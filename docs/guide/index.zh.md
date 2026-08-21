# 产品指南

VibeTrader 是把可证伪市场想法转化为受治理自动交易的闭环产品。它不是引擎 API 的集合，
产品对外形态由全局架构 Flow 中的 Owner 与交接关系定义。

## 建议阅读顺序

1. [安装](./install/)建立可复现的本地基础，但不会授予交易权限。
2. [快速开始](./quickstart/)走通最短且安全的产品旅程。
3. [产品闭环](./product-loop/)说明证据、策略、资金、执行和反馈如何连接。
4. [架构规则](./architecture-rules/)定义后续实现必须守住的不变量。
5. [设计证据](./design-evidence/)区分成熟平台和研究支持的部分与本项目的自主选择。
6. [开发切片契约](./development-chunk-contract/)把一条架构契约转成有界 Agent 实现循环。
7. [Agent 实现指南](./agent-implementation/)把有界切片连接到经过验证的当前引擎参考，同时不会把旧正文恢复成权威。
8. [研究来源接入指南](./source-intake/)为 Research 提供高 ROI 且 provider-neutral 的外部来源接纳基线。
9. [市场数据接入指南](./market-data-intake/)把 credential 与 provider endpoint 转成有权利约束且 PIT 正确的事实。
10. [可观测性接入指南](./observability/)定义 trace、telemetry、outbox、持久化与 Dashboard 投影，同时避免创建第二业务权威。
11. [Trade Dashboard](./dashboard/)定义未来第一方可视化外壳、导航、组件系统与最小 Windmill 替代边界。
12. [架构边界](../architecture/)区分权威 Owner 与产品壳 阶段和通道。
13. [Owners](../owners/)定义十个业务事实写入者。
14. [场景](../scenarios/)说明七条可观察的端到端产品故事。

## 如何理解架构 Flow

Flow 是本文档的全局投影。框可以是业务 Owner，也可以是产品边界、通知渠道、内部阶段或
价值流边界。箭头是有方向的契约，分别表达请求、事实、政策、提案、意图、命令、效果、
交接、事件或只读投影。

顶层图固定为 13 个分组，另有一个不拥有业务事实的 Event Rail 通道节点；每个分组最多五个模块。不改变权威或 Owner 交接的细节应写进
对应正文，不进入全景图。

## 本指南不冻结什么

文档冻结产品职责和可观察契约，但不冻结类名、数据库结构、网络协议、部署拓扑或实现语言。
现有引擎能力只有被归入对业务结果负责的 Owner 后，才能进入新产品骨架。
