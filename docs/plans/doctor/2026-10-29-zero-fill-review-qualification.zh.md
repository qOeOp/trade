# 2026-10-29 零成交预检评审仍屏蔽后续有成交运行

| Item | Value |
|---|---|
| Sessions | Codex chat `01a1856b-3b36-7503-a066-1922397920cc`，用户批准合并 #1849 后恢复 A 线的同一研究会话；未读转录文件 |
| Audit session | 同一会话内 product-doctor 聚焦诊断；不是完整审计 |
| Checkout / ledger | main `89faf6f1956db80bb43948dbb7bdef74b98f88d3`；登记 `f9s1k2lfbgmtfnnsbqvhd8tt6fa3gkpd`，trial 218 / 报告读取 `ada7c489cftrear0ejcqmu3u5k0jlhkt` |
| Coverage | trial 214/215 的原复核、trial 218 的产品资格输出；`ledger/lines.py`、`qualification/availability.py`、登记引用与重试资格的消费者及相关测试；未读被屏蔽的收益数据、未改检查或研究输入 |
| Time split | main 合并、登记和全窗运行已完成；研究、等待、诊断的准确拆分未知 |
| Invalid trials caused by the product | 本次没有原生 invalid；trial 218 为 passed，但经济证据 unavailable，不能据此作经济结论 |
| Findings by action | authority / fix：20261029-01 的经济资格消费者尚未覆盖；新字段、审计机制和 skill 文字提案均为 0 |
| Recurred items | 20261029-01；#1830 起线与暴露的已实施修复保留，本次是同根因的经济资格消费者 |
| Found by the user first | 本次 0；原项目的用户先发现记录保留 |
| Net change | 建议复用原有三个条件的派生判断，避免在每个消费者再复制一条例外；不去掉零成交零持仓条件，不加存储字段，不改原始 trial、review 或封存审计；资格适用范围改变须用户新授权 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261029-01 | 起线已能忽略经后续有成交预检恢复的纯 activity 失败，但经济资格仍按同源码同镜像任一 failed 屏蔽后续运行。A 线 trial 218 因旧 trial 214 的复核无法给出经济报告 | `replay report --trial-id 218`：stored status passed、审计无 finding、执行捕获完整，availability 唯一原因 `SOURCE_REVIEW_FAILED: source-review-214-52a2ab00a61965c0`；headline/slices/capital 均为 null。`source-review-214-52a2ab00a61965c0`：api/causal/readiness passed，仅 activity unresolved；trial 214 的预检封存无成交和持仓。`source-review-215-7b262d7097ba895c` 与同源码同镜像绑定，后续原生预检有成交且四项通过。`ledger/lines.py:183-203` 已按这些事实忽略前一复核，`qualification/availability.py:256-281` 则仍对任一 failed 一票否决；登记仅绑定 trial 215 的通过复核。因此能选线、登记、执行，最后经济报告仍被屏蔽 | authority：是否将原三个条件共用至经济资格读取；批准后另开代码 PR | 完整全窗 trial 已消耗，收益尚未读取；不能作控制或用于推荐。无需重跑来修复读取资格 | open，未获本项检查变更授权 |

## 移除与收敛

| 机制 | 守护的风险 | 已有覆盖 | 本次证据 | 提案 |
|---|---|---|---|---|
| 任一同源码同镜像失败复核永久使后续运行无经济资格 | 通过换评审人刷掉源码缺陷 | api/causal/readiness 失败仍一票否决；原复核与原捕获不可改写；后续真实成交与独立通过复核由账本事实证明 | 214 只有 activity unresolved，后续 215 已通过；起线政策已经区分此情形 | 共用已批准的三个条件，保持其他失败的否决；不加新字段或用户声明因果的入口 |
| 每个消费者各复制一条豁免 | 同上 | 一个共享的、读取原封存事实的政策函数 | 起线与资格已出现相反结果 | 收敛为同一判断，按各消费者已有身份及可见提交范围提供记录 |

不动规则无法继续读取 A 线现有源码的经济报告；重复复核不会删除旧 failed，单纯重跑也不会解除它，现有登记点已被消费。改名、注释或无实质变化的镜像重建不构成修复。另一条路是保留 trial 218 为诊断，另选不受该失败复核影响的实质新规则，例如原备选 `ema-entrybudget-multiyear@1`；那会改变 A 的起点，且仍须自己的就绪、预检、独立复核与用户选线，不是当前 A 的直接续跑。

## 授权边界与拟议验证

用户此前对 #1830 的授权只明确覆盖暴露与 `line select`。整合评审 P2 的更宽提案（去掉“旧预检零成交零持仓”条件）已被拒，本提案保留该条件，不把旧决定扩大解释为经济资格的新授权。#1849 的合并授权只覆盖 bars 未消费报价的导出修复。

拟共用的三个条件仍是：

1. 旧复核只有 activity failed/unresolved，api、causal、readiness 全部 passed。
2. 旧预检完整封存，fills 与 positions 都为零。
3. 同一源码有更晚、真实成交、存在 passed 且不存在 failed 复核的预检；经济资格仍受其原有镜像身份及读取/封存可见范围约束。

允许后，资格按新的 checker 身份重读已封存 trial 218，不回写原审计、原复核或原结果，不为恢复指标额外重跑。若其他资格条件失败仍保持屏蔽。旧 trial 214 与其 failed 复核保留且不能被登记引用；用户两项目标不变。

验证仅用隔离 Dolt：覆盖三个条件全部满足及分别不满足、后续无成交、后续也有 failed、api/causal/readiness 任一失败、不同镜像及超出封存可见范围；断言单次报告、research status、比较、控制与重试的适用范围一致，原有拒绝仍在。未实现，未声称任何测试通过。后续状态只更新索引，不改本诊断记录。
