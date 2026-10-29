# 2026-10-29 IDE 画布与源码评审显示的聚焦诊断

| Item | Value |
|---|---|
| Sessions | Codex；用户在当前会话提供 `20261029-channel-breakout-15m` 画布截图并指出 Source Reviews 排版问题；未读取研究会话 |
| Audit session | Codex；当前会话，模型标识未知；聚焦诊断，非完整审计 |
| Checkout / ledger | `773ac59b4`；未写账本；线上 `/api/view` 返回 queued，未取得该线的完整实时图 |
| Coverage | 前端谱系几何、初始化与定位、评审图提取、详情正文组件、research-round 的记录排版规则；未评价策略或评审结论 |
| Time split | 未单独计时 |
| Invalid trials caused by the product | 未观察；本次没有运行研究试验 |
| Findings by action | fix 2 / remove 0 / skill 0 / authority 0 / measure 0 / none 0 |
| Recurred items | 无已知相同根因的记录 |
| Found by the user first | 2：20261029-120、20261029-121 |
| Net change | 提议复用现有几何边界与 Prose；新增机制、拒绝分支、存储字段和 skill 词数均为 0；增加输出完整性与布局回归验证 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261029-120 | 当前研究线在较大 trial 编号开始，画布仍允许平移至 trial 0；聚焦首节点时在左侧显示大量无线内容的试验区 | 用户截图首节点为 trial 216，尺标从约 203 开始；`geometry.ts` 的 bounds.left 固定为 -16，HOME 固定为 16，未消费视图已有 axis.min；Lineage 初始化与 AxisDriver 回到起点都复用这个常量 | fix：按该线 axis.min 与实际试验内容计算边界及起点，保留真实试验编号与联动轴 | 截图可见大块留白；未量用户耗时 | verified diagnosis；用户已要求修复和测试 |
| 20261029-121 | 源码评审经过图提取与前端显示后丢失说明和段落 | `report/graph.py` 只把 failed 项的 note 用空格拼接，通过项未进入 note；`Detail.tsx` 把 note 放进普通 span，而 Conclusion 使用 Prose；research-round 的 Evidence and records 已要求 review bodies 分段，无须新增 skill 规则 | fix：现有 note 派生四项的名称、状态和原说明，空行分隔；详情复用 Prose，无存储字段或资格判断变化 | 评审说明不完整，已有分段也被压平；未量用户耗时 | verified diagnosis；用户已要求修复和测试 |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| trial 0 固定边界 | 限制平移到内容以外 | 已有视图的轴范围与该线试验编号 | 后开的线在聚焦首节点时出现无线内容的空区 | 用内容边界替换常量，不增加定位模式 |
| Source Reviews 自行输出普通 span | 显示评审说明 | 已有 Prose 的段落、列表与折叠 | 用户指出其可读性落后于 Conclusion | 复用 Prose，删除独立正文显示路径 |

## Decisions

用户 2026-10-29 要求“全部修复并测试”。只修产品展示与派生输出，不修改历史账本正文、审计或拒绝规则。验收和后续状态写入索引与独立实施记录。
