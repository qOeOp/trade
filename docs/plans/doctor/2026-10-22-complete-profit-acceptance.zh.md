# 2026-10-22 完整收益修复验收

对应[诊断与授权](2026-10-22-complete-realized-profit.zh.md)，交付 PR [#1637](https://github.com/qOeOp/trade/pull/1637)。原生测试及工程回放写入隔离数据库 `profit_parity`，活动研究账本只读，历史封存未重写。

- Ruff、Mypy、compileall、engine.run --help 通过。完整 unittest 在 Dolt 2.4.2 隔离服务通过 464 tests；随后新增的原生部分实现观察回归随本模块 3 tests 通过。最终 PR CI 执行包含该新增测试的全集。
- 三名新鲜独立审阅覆盖消费者／审计、原生观察／存储、Goal／文档。数值与原生路径未发现阻断；审阅发现的历史推导来源丢失及旧文档消费者已修，并由对应审阅者复核 delta。最后剩余 `rule:E.4.1.3` hover 标题也已同步；脚本扫描 Goal 消费者未见旧授权文字。
- `report.run_report(9)` 读出完整五项利润桥；`ledger review` 当前 findings 为空；`tables(9, reproduction=10, directory=...)` 通过已有语义指纹核验恢复原生开放周期，保留来源。配对结果保留历史推导标签。没有修改已记录目标或将开发期点估计变成独立验证。
- Goal 的三条许可分支已修技能、评测题／判据及入口、设计页、图谱和 hover；未运行新的端到端技能评测，也未宣称已替原研究聊天创建 Goal。无跨聊天消息。

## CI 镜像原生配对

固定策略是已有 EMA 交叉单文件 `EmaCross`，SHA-256 `e98cd0730d7e082d30e9116b14d5f536d0b66a04e793f252ebd937755760d10b`；市场提交 `l1kfbo4b2of54ijpjnpn02ijdm175aqd`。参考镜像 `ghcr.io/qoeop/trade-runtime@sha256:bc59d2875d8b05a7e26dcaf8bfd123eae18bb632bc667f16175137ff2a0b141d`；候选由本 PR 的 CI 构建，`sha256:ade46aa68f53cf6bdb7c5a1bbe09d074b2e12f8490dfbc41ac24893974c7712d`，构建提交 `11dff5c2b88487e02131b1df0514bc7c23f5ce4d`。后续提交未改 engine、uv.lock、pyproject 或 Dockerfile；原生执行代码相同。

| 范围 | 结果 |
|---|---|
| BTC/ETH 双品种 pilot，2025-10-01 至 2025-11-01 UTC | 工程比较通过：16 orders、16 fills、6 positions、385 account rows、31 daily returns 两侧相同；两个审计通过 |
| BTC 完整研究输入范围，2025-10-01 至 2026-10-01 UTC | 参考复用已有核验复现 10 的原生缓存；候选在隔离工程库重新执行。比较通过：47 orders、47 fills、14 positions、2236 account rows、365 daily returns 相同；两个审计通过 |
| 原生语义指纹 | 两组的 orders、fills、positions、account、order_events、returns_series 均相同；因新增 realized 观察而改变 exposures 指纹，未把新指纹当作旧封存的复现 |
| 原有敞口列及因果时钟 | 逐行核对 pilot 89,276 行、完整范围 525,587 行：原 timestamp、position ID、notional、MARK unrealized 全部相同；新 realized 列非空 |
| 费用、资金费、账户经济 | 两组原生审计 native_economics 完全相同；订单完整性与保护审计通过。收益记录／拆分修复未改变撮合和结算 |
| 同镜像重放 | pilot 再次执行，全部七组语义指纹相同，压缩 exposures 文件逐字节相同 |
| 新回撤归因 | 双品种及单品种 @3 均有可核对的贡献读数，headline @2 保持一致；旧四列观察仅归因缺失，不丢 headline |

工作副本：`/tmp/trade-profit-parity/acceptance.json`、`pilot-comparison.json`、`full-comparison.json` 及原生目录；本地完整测试 `/tmp/trade-profit-full-tests-final.log`。这些是可再生工程验收缓存，不是新的研究经济证据。未覆盖全部潜在策略、所有离格资金费／结算时钟组合或全部宿主；时钟不一致会明确使新贡献读数不可用，不静默改变旧 headline。
