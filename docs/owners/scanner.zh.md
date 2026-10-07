# Scanner

## 产品职责

产品不保留独立 Scanner 服务、周期提案或 Scanner 台账。普通找币使用 Market Data 查询；需要历史路径的信号用冻结原生 Backtest，需沉淀时由 [R&D](./rd.zh.md#on-demand-read-only-opportunity-discovery) 保存任务/结论引用。Governance 根据资格、账户和冻结条件决定排队、转正、退出及真实仓位保护。

旧 `ScannerConditional` 明确返回 `ConditionalScannerNotAdmitted`；取消目标部门不将它改为无条件激活。条件迁移仍须版本化并保留原资格、授权、资金、恢复和真实效果边界。

## 封存兼容合同

`crates/scanner` 留有纯确定性核心与 `TerminalReceiptStore` / `ProductEdgeTerminalReceiptReader` port，测试证明局部失败关闭形状。唯一外部使用为 `crates/testkit/tests/f1_current_workspace.rs` 的类型导入。没有调度器、生产准入构造器、Loader/MarketSnapshot/Capacity 输入、数据库角色/schema、持久回执或 Governance/Product Edge 消费者。本文不准入新的调度、提案、重建读口或存储建设。

### 旧身份与记录

- Schedule Definition 的版本、准确 scan-scope 身份/版本与规范无歧义 due-slot boundary 唯一派生 AttemptId/ScheduledScanId。clock epoch 不进入身份；重复、并发、重启和迟到汇合原 attempt。cadence/calendar/time-zone/fold/gap/misfire/backfill 变化创建后继定义；无 continuity 或 scope/slot 冲突不造 attempt，墙钟重试不造新槽。
- 每成员仅 MATCHED / NO_MATCH / INSUFFICIENT_DATA / INPUT_UNAVAILABLE / CONDITION_FAILED，绑定 ArtifactRef、条件版本及实际输入；FAILED 不是成员状态。来源成员无法解析不编造 expected 或 missing 集，不能从先前或部分前沿补齐。
- 每 attempt 唯一终态 PROPOSED / NO_MATCH / INSUFFICIENT_DATA / COMPLETED_NO_PROPOSAL / FAILED。优先级为独立 batch FAILED、完整 PROPOSED、完整 COMPLETED_NO_PROPOSAL、INSUFFICIENT_DATA、NO_MATCH；无匹配但有本地 CONDITION_FAILED 为 COMPLETED_NO_PROPOSAL。其他成员负面事实仍保留。
- PROPOSED 只含完整匹配集合。FAILED 只限 INCOMPLETE_FAILED 或有独立证据的 BATCH_OPERATIONAL_FAILED；后者保留 SCHEDULER_ORCHESTRATION_FAILURE / SCANNER_SERVICE_FAILURE / SHARED_DEPENDENCY_OPERATIONAL_FAILURE、failure identity、source cut 和 Time Evidence，任何失败分支不含提案。
- 完整 expected/observed 相等；不完整已知集合保留 missing = expected − observed，未知集合保留权威未解析 disposition、observed 和 missing-members-unavailable，不渲染为空或完整。

### 旧读口与拒绝

读取只返回请求身份的准确唯一终态；缺回执、wrong-attempt、semantic-conflict、store-unavailable 分别拒绝，中间两项是 custody fault，不能改成未知。终态读回不重跑当前时钟准入；只复验记录持有的 source/frontier/scope/requirements、market/capacity cross-cut、due boundary，以及同槽全部事实相同 clock epoch/Time Evidence，不推导缺失对侧。

只有 AVAILABLE 且准确匹配 PIT/Universe Selection/Instrument Master/calendar/session/time-zone/corporate-action/membership/semantics 的输入可 MATCHED。INSUFFICIENT 为成员 INSUFFICIENT_DATA，其余负态或缺回答为 INPUT_UNAVAILABLE；不补缺口、不换相邻截面、不以负态推断无不利事实。仅冻结条件要求容量时读取同 Capacity Scope、账户/估值/流动性、方法/假设、测量与有效期的 AVAILABLE view；跨 mode、策略特定 scope、重叠未知或缺字段不得匹配。

回执构造保持 crate 私有、无公共 Deserialize；外部字节不能铸造权威。提案只是证据，不创建授权、修改 Registry/资格/资金、启动 Runtime、生成 Trade Intent/Risk Decision/Reservation/订单或生产效果。旧 matched member 必须精确匹配策略、ArtifactRef 和条件版本，并在原无人值守授权血缘内经独立 Governance 决定；当前该条件路径仍拒绝。

### 当前持久化边界

当前没有持久 Scanner 历史记录或可达终态读消费者。已记录的旧身份、回执和拒绝含义不可重写；本页不要求新增 schedules/attempts/proposals 数据库或测试流程。新发现保存 Backtest job 与 R&D 结论引用，冻结条件由 Governance 消费已有来源事实；这些引用本身不授交易许可。
