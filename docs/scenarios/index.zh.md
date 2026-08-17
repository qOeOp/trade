# 端到端场景

场景是可观察的产品故事，不是部署模式或实现教程。每条故事都从明确入口开始，经过显式 Owner 边界，
以持久证据结束，并说明哪些转换必须失败关闭。

每个生成场景投影都列出互不重叠的 **PRIMARY** 与 **SUPPORTING** 关系。PRIMARY 是按顺序讲通场景的
业务结果主干；SUPPORTING 是上下文 证明 安全或只读模型流，并在其声明路径适用时成为必需关系。
两者并集构成场景页面与 Flow 的完整 relation coverage，任何关系都不能被静默遗漏或同时出现在两类中。

对 Recovery 这类声明 trigger branch 的场景，顶层 PRIMARY/SUPPORTING 并集只是页面聚合覆盖，并不
表示每个触发都必须同时经过全部关系。真正可执行的必经路径由每个适用 trigger branch 自己的 primary
与 supporting relation 决定。多个原因同时出现时可以在同一 case 合并各自适用 branch membership，
但任一分支都不能制造或要求只属于另一分支的证据。
Recovery 中，`runtime-risk-incident-fence` 把 `runtime-incident-fact` 提交给 Risk，
`execution-risk-drift-fence` 把 `reconciliation-drift-fact` 提交给 Risk。Risk 是 Recovery Fence 唯一
writer；任一 source-only 分支在自身准入后都能创建或加入同一种 Recovery Case，两者同时准入时加入
同一 case 且不合并来源事实。

| 场景                | 入口                                        | 必须取得的证明                              |
| ------------------- | ------------------------------------------- | ------------------------------------------- |
| [全景](./overview/) | 可证伪想法                                  | 产品闭环中已提交的 Owner 事实               |
| [研究](./research/) | 带来源假设                                  | 冻结的 Research Intent 与 Strategy Artifact |
| [回测](./backtest/) | 冻结工件和证据包                            | Intake Receipt 与分支证明                   |
| [扫描](./scan/)     | 定时触发                                    | 可审计提案或有原因的不提案记录              |
| [模拟](./paper/)    | 治理已激活的模拟策略                        | 已对账模拟效果与已结算风险预留              |
| [实盘](./live/)     | 治理已激活的实盘策略                        | 权威场所回读与已对账账户状态                |
| [恢复](./recovery/) | 就绪丢失 Runtime 事故 对账漂移 或 Risk 硬停 | `RecoveryCase.KNOWN_CLOSED`                 |

模拟与实盘共享同一条自动控制链，只在 Execution 适配器处不同。Recovery 是禁止新增风险的独立路径，
不能复用普通交易意图。
