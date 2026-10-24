# 2026-10-25 固定源码迁到 v7 的比较重建

| Item | Value |
|---|---|
| Sessions | Codex local，`01a16f63-bdeb-7af3-b4c8-a9a557e46116`；2026-10-25 |
| Audit session | 聚焦迁移准入诊断与用户授权实现，不是研究会话整体审计 |
| Checkout / ledger | `a501d7c86` 复现，交付基线 `b367113d0`；活动账本 `digabm8fnl2uepd15c86i43ersd340id` 未改 |
| Coverage | source ABI 准入、retry_of 技术连续性、旧对照撤回后的基线恢复、源审查/暴露/绑定消费者；不涉及验证登记或历史研究结论复审 |
| Time split | 未完整归因；已完成 14 项针对性隔离测试、Ruff、Mypy 与一次两日原生预检；全量与交付状态记索引 |
| Invalid trials caused by the product | 0 个活动 trial；工程事实只写独立临时账本 |
| Findings by action | fix 1；skill 为同一迁移的消费说明；不新增存储字段、命令或迁移表 |
| Recurred items | 复用 20261022-03 的连续性主题；其先前交付只覆盖同契约换镜像，不称本次是该范围的回归 |

## Findings

| id | Finding | Evidence and consumer | Action | Status |
|---|---|---|---|---|
| 20261022-03 | 固定源码从 v6 迁到仅支持 v7 的产品时，没有技术重建路径 | `runtime.image.layout(v6)` 拒绝；`replay.precheck/seal` 与登记网格要求旧 candidate 契约完全相同；`_runtime_transition` 要求契约和全部产物身份不变；相同源码重发被 `SOURCE_EXISTS` 拒绝。真实新旧探针只在契约、v7 bars 显式默认值、导出器与产物摘要上不同。用户因此无法继续同线比较 | fix：显式 v6→v7 源码 ABI 准入与 bars 迁移；重新固定新产物，恢复同身份下的基线和比较 | open；交付与真实迁移消费验证记索引 |

## Removal list

| Mechanism | Proposal |
|---|---|
| 多处候选契约严格等号 | 共用源码 ABI 准入函数，仅支持相同契约或 v6→v7；不使 v6 镜像重新可执行 |
| 同契约技术重建的严格配置/输入身份 | 保留 |
| 经济比较的镜像/配置/全部输入身份 | 保留，不调用技术连续性匹配代替经济可比性 |
| v6→v7 产物摘要必须相同 | 固定原市场库、提交、成员、范围和窗口；新导出器与产物摘要重新固定。仅 bars 默认配置可显式补齐；quotes、清算、保证金和账户资本改变不属于此迁移 |
| 必须重建已撤回的旧对照才能建立基线 | 原对照失去经济证据时，可保留原登记链接并建立无对照基线；置空 control_trial_id/comparison，其余研究声明和网格不变；没有该比较的经济结论 |
| 新字段、源码重复发布、旧记录变更 | 不添加或执行；既存 candidate、registration、precheck 和 trial 足够表达 |

## Decisions and validation

用户在解释清楚后回复“迁移吧”，明确授权整套比较迁到 v7 及对应准入调整。没有将原研究授权
扩张成先前未给出的迁移权限；没有改目标、审计、live 或样本外范围。

迁移依赖 [20261025-01 旧提交导出修复](2026-10-25-historical-quote-export.zh.md)，该问题独立交付。
当前链应先将 `ema-entrynotional@2` 重建为无对照基线（旧 control trial 6 的经济证据已撤回），
再重建 `ema-fixed-dailyspec@1` 对它的比较，最后重建 `ema-entryvar@2` 对新固定量的比较。
保留旧研究声明和原登记引用；实际执行身份来自新镜像探针，不从旧正文复制。

隔离消费者测试覆盖 v6 root/child 的新审查、登记、绑定，拒绝旧镜像对照、修改声明/网格、
更改窗口/账户/市场成员与同契约产物变化；只有已撤回旧对照可置空。现有同镜像成功重试、
无关探索、未引用预检、非同源码重建对照和指纹失败的拒绝测试继续执行。

原 `ema-entryvar@2` 字节在独立临时账本中用既有 CI v7 镜像进行了两日原生预检，fresh 审查件
`source-review-1-8f5ef693bccedbc5` 对 api、causal、activity、readiness 均 passed。
只观察一次入场及停止时 reduce-only 全平；反向、做空、风险减量、月界、部分成交、规格不足
和生命周期分支未观察。此审查不转移到活动账本，不证明经济改进、parity 或完整生命周期安全。
活动迁移须待实现交付 main 后，新预检、新审查、新登记、新回放并重新解释与推荐。
