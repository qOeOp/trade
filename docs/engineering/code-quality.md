---
title: Quality Assurance System Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-31 CST
---

# Quality Assurance System Contract

## 定位

本文是项目质量保障的 policy owner：定义层级、风险、authority 和 hard gate 原则。具体命令
只在 [Check Contract](./check-contract.md) 登记；领域行为由 owner `CONTRACT.md` 与 runtime
合同定义。

质量目标是尽早发现真实回归，并让 merge、release 和 runtime 结论由对应 owner 签发。规则
数量、测试数量、覆盖率或代码行数都不是目标。

## Authority

| Surface | 负责 | 不负责 |
| --- | --- | --- |
| 本合同 | 质量层级、风险分类、required 原则 | owner 命令目录 |
| [Check Contract](./check-contract.md) | 改动到可执行检查的路由 | merge/release authority |
| [Development Convergence](./development-convergence.md) | owner/consumer 复用与责任面判断 | 固定数量配额 |
| owner contract/package | 领域行为、直接测试和 consumer acceptance | 项目级 merge 签发 |
| checker | 一个可复现的机械边界 | 创造产品或组织 policy |
| GitHub workflow/ruleset | 隔离执行与 merge 条件 | 替代真实 runtime 验收 |
| release/runtime owner | artifact、环境、smoke、回退和运行事实 | 用 PR 绿灯代替上线事实 |

产品/runtime 安全合同在其行为边界内优先。质量内部优先级为：本合同 > Check Contract >
workflow/checker 投影。

## 质量层级

| 层 | 目的 | 证据 | Authority |
| --- | --- | --- | --- |
| Q0 Admission | 非平凡改动先明确结果、风险与 consumer | owner、scope、acceptance | 当前任务 |
| Q1 Local | 快速发现直接错误 | diff、owner test/typecheck、最小 consumer | 本地反馈，不签发 merge |
| Q2 PR | 证明候选可集成 | policy、owner/integration、CodeQL | required checks |
| Q3 Governance | 防止候选修改并自证裁判 | 候选不可控的独立复核 | 外置或中立 owner |
| Q4 Release | 证明 immutable artifact 可发布 | provenance、certification、部署 smoke | release owner |
| Q5 Runtime | 证明真实环境可观测、可回退 | health、shadow/canary、reconciliation | runtime/operator |

低层绿灯不能代替高层证据。Q2 不执行真实交易写动作；Q4/Q5 只为已经存在的 artifact 和
runtime consumer 建立。

## 风险路由

| 类别 | 典型改动 | 最低闭包 |
| --- | --- | --- |
| R0 文档/元数据 | 不改变 runtime 或 authority | doc/diff；PR 时 policy |
| R1 单 owner | 局部实现与合同 | owner check + 直接 consumer |
| R2 跨 owner/runtime | shared contract、schema、store、rail | 所有受影响边界 + integration/architecture |
| R3 交易/资金/凭证/迁移 | 高后果或不可逆行为 | R2 + 独立安全证据 + 必要 release/runtime |
| R4 governance | instruction、workflow、judge、ruleset、签发 policy | 与普通实现分离；不得由候选自签 |

按改变的语义分类，文件路径只作输入。未知 owner、shared contract、跨语言或 planner/judge
自身改动不能被静默降级。

## Hard gate 原则

- 每个 hard gate 必须有 owner、明确失败处置和删除条件；没有真实消费者或高后果依据的检查不进入 required 集合。
- 不设置全仓覆盖率、复杂度、LOC、测试数量或表面积计数硬阈值；这些只能作调查信号。
- 本地检查用于反馈，远端 required checks 签发 merge；PR 绿灯不签发 release/runtime。
- 普通实现候选不得同时修改其 workflow、judge 或签发 policy。
- 当前仓库没有候选不可控的 Q3 verifier。治理候选可以本地准备和验证，但缺少独立 authority 时不得表述为已独立接纳。
- compiler、lint、test 或 vet warning 不能被当作噪声；不能在当前范围修复时必须说明影响。

## 测试有效性

权威顺序是：当前用户结果与产品/runtime 合同 > 真实 consumer 行为 > owner/边界合同 >
测试及其 fixture、mock、snapshot。

- 红灯先分类为真实回归、过期断言、实现耦合、场景/oracle 缺口、路由缺口、mock 失真、环境/并发/时间问题或 flake/infra，再决定改代码还是改测试。
- 绿灯不能替代未执行的 consumer；红灯也不能授权劣化正确生产行为。
- escaped defect 优先加强或替换已有 oracle；“一个 bug 新增一个测试”不是默认结论。
- 不把自然语言正文、脚本、package script 或 workflow 源码的字符串与排版快照当行为 oracle；机器合同解析结构，流程测试执行真实入口。
- 删除或重写测试必须证明其独特行为价值已由更高层证据承接；静态重复、规模和命名不足以证明可删。
- 测试治理复用现有 owner 和 quality leaf，不在 `.agents` 中建立第二套 policy authority。

## 当前 merge 边界

`main` 当前 required contexts 为稳定 `quality` aggregate 与 JavaScript/TypeScript、Python、
Rust、Go CodeQL，且要求最新 base 和 review thread resolution。普通候选不默认增加人工
approval、CODEOWNER、last-push approval 或 manual exact-SHA gate。修改这些 trust surfaces
必须作为独立 governance candidate 处理。
