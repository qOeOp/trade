# 架构边界

全局图包含十个权威 Owner 和三个可见边界。边界让产品容易理解，但不会为交易事实再创建一个写入者。

## 权威规则

每个可变业务事实只有一个 Owner。Product Edge、Strategy Factory 和 Observability 可以展示、协调或隔离事实，但绝不能成为第二个业务权威。R&D 是一个真实 Owner，内部包含 Research 与 Develop 能力。Event Rail 作为独立通道只传输已提交的唤醒提示。

## 可见边界

- [Product Edge](./product-edge/) 是以 Windmill 为默认工作台的应用与 MCP 准入边界。
- [Strategy Factory](./strategy-factory/) 是 R&D Backtest Qualification 价值流。
- [Observability](./observability/) 采集遥测、生成全局状态投影并路由告警。

## 通道

[Event Rail](./event-rail/) 广播已提交事件。它是传输通道，不是边界或业务权威。

## 阅读全局图

Owner 边框表示职责，带方向的连线表示有类型的交接。场景标签只隐藏无关路径，不会改变底层架构。节点描述说明能力边界，而不是实现类或 API。

## 实现采用

[能力采用](./capability-adoption/) 将每个现有 workspace crate 和支撑能力映射到目标 Owner 或非权威基础设施。它记录复用和迁移边界，但不会向全局图增加新的方框。

## 冻结条件

新增 Owner 必须证明存在新的独立业务权威。新增模块必须证明职责无法放入现有模块。Overview 最多保留十三个可见分组，每个分组最多五个模块。
