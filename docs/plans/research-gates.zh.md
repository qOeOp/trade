# 持久化绑定命令与登记前置门：存储字段评审

日期：2026-10-18。依据用户 10-18 的决定：需要持久化的记录绑在命令上，不靠 skill 提醒，门要硬；以及 AGENTS.md「新增存储字段前须经独立子代理评审并记录于 docs/plans/」。

## 决定

- 导出工作副本与生成脚手架的命令，把工作目录说明 AGENTS.md 与文件头模板写进同一目录。
- 每个拒绝码在拒绝码目录里有修法，拒绝信息的 next_actions 由它给出；账本每张表与字段带 COMMENT；登记体按 JSON Schema 校验，失败时返回字段说明。
- 来源原件随登记在同一事务入账，引了外部依据却没有原件即拒绝（SOURCES_REQUIRED）。
- 多重比较的 N 取路线内全部研究试验数（含无效与中断），由账本派生（ledger.line_trials），研究状态视图展示。
- 同一路线的下一次登记有三道前置门：已完成的试验都有 interpretation（INTERPRETATION_REQUIRED）；复盘到期时已有新 recommendation（REVIEW_DUE）；派生登记前已声明复盘节奏（REVIEW_CADENCE_REQUIRED）。
- judgment 新增 cadence_trials：仅 review_cadence 必填，≥1，取代时不得调高（REVIEW_CADENCE_RAISED）。

## 评审结论（独立子代理）

| 提案 | 结论 |
|---|---|
| 暴露日志表 exposure_log（读取命令自动记录） | 否决。只读查询不进 Dolt 历史，读账号可直接 SELECT、探索报告可绕开账本，最该记的自选统计量恰在覆盖之外；且每次读都要写提交、读命令要拿写账号。替代：路线内全部研究试验数作为 N，账本派生，是不依赖记忆的保守上界。 |
| judgment.cadence_trials | 附修改批准。节奏是 Agent 的选择，推不出；代码判定不读正文，须类型化列。计数口径与研究状态视图共用一个账本函数；CHECK 约束取值；只对派生登记要求节奏。是否禁止调高属收紧检查，按用户 10-18「要很硬」定为禁止。 |
| INTERPRETATION_REQUIRED | 附修改批准，不需新字段。「已完成」指有 run 行（passed 或 invalid）或已被 recovery 结案；被取代的解释也算覆盖；skill 规则同步改为每个登记至少一条解释。 |

门在登记写事务内按当前头求值，registration 只调 ledger 查询、不调 report。
