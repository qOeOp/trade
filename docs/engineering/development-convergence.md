---
title: Development Convergence Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-24 CST
---

# Development Convergence Contract

## 0. 定位

当前进入恢复期：先让已有能力形成可运行链路，再恢复能力面扩张。本文不预设最终 tool 数量或职责，只阻止主链未通时继续增加维护表面积。

## 1. 恢复期硬约束

- `module owner / registered tool / domain / store / job / rail` 不得超过 [当前基线](./convergence-baseline.json)；优先复用、合并或删除。
- Agent 不得自行提高基线。确需新增表面积，必须由用户明确批准；不能用“以后可能需要”作为理由。
- 不以 LOC 设闸。代码行数容易被压缩或生成代码污染，恢复期只冻结责任边界和运行表面积。
- 红色 `main` 只做修复、删除、收敛与验证，不并行铺新功能。

机器入口：

```bash
bun scripts/check-convergence-budget.ts
```

## 2. 单位代码价值

一次开发只有同时交付以下证据才算完成：

1. 一个用户或 operator 可观察的行为；
2. 一个既有 runtime / CLI / server 入口真实消费该行为；
3. 跨 owner 链路或集成测试证明输入、状态写入和输出闭合；
4. 项目质量总闸全绿。

新增 package、schema、文档或单元测试本身都不构成功能完成。没有 production consumer 的能力按库存代码处理，下一步应接入、合并或删除。

证据强度从高到低为：服务器可重复运行链路、端到端/集成测试、owner package 测试、静态合同。低层证据不能替代高层证据。

## 3. Agent 与提交约束

- 一个任务围绕一个可验证行为闭环；不按文件、步骤或测试结果连续制造微提交。
- 质量门未全绿不得提交或推送；修复红灯优先于新增能力。
- 开工前先指出复用的 owner 和运行入口；若找不到，先判断现有实现应接入、合并还是删除。
- 交付必须报告：用户行为、production consumer、运行证据、删除/新增表面积；不得用代码量、模块量或测试数量代替完成度。

## 4. 无人值守 mission contract

模糊方向、跨模块功能和长时开发先走 `.agents/skills/run-autonomous-development/SKILL.md`。主上下文只持有一个 mission；subagent 只做有界候选搜索或独立验收，不拥有 scope、合并和完成判定。

写代码前必须冻结：

1. 用户可观察结果、当前缺口和明确非目标；
2. 既有 production consumer 与可重复的验收旅程；
3. 复用 owner、允许修改范围和责任面增量上限；
4. 设计候选的裁决口径；
5. slice、修订、连续无进展和升级预算。

任务按垂直行为切片，而不是按 layer / package / schema 切片。每个 slice 都必须单独闭合真实 consumer；只新增库存代码不得进入下一片。

默认一个 slice 最多 3 次实现修订，连续 2 轮没有改善失败的验收信号则停止局部修补并重做设计；最多 6 个已接纳 slice 后重新核对剩余 objective。Agent 不得以“继续优化”绕过预算。

mission 只能以 `completed / blocked / invalidated / budget_exhausted` 之一终止。只有真实 consumer 的全部验收信号通过才是 `completed`；其余终态如实保留证据，不自动重启同一循环。

## 5. Codex 能力归位

| 需要 | 直接复用 | 项目边界 |
| --- | --- | --- |
| 模糊方向变成合同 | Plan / working plan + `mission_planner` custom agent | 只冻结 outcome、consumer、验收和预算，不提前设计全部内部结构 |
| 一个逻辑任务长时续跑 | Goal mode | Goal 负责续跑；mission contract 负责成功、失败和停机，禁止 `until perfect` |
| 候选搜索与独立反审 | subagent + `mission_evaluator` | 只读优先、最多 3 个；主上下文唯一裁决 |
| 写入隔离 | Codex worktree + 既有 `agent-workspace-manager` | 一个 mission 同时只有一个可写 winner |
| 可复用流程 | project skill + `AGENTS.md` | skill 编排；authority 仍在 docs / owner contract |
| 领域事实与动作 | 既有 MCP / owner tool | Agent 不复制领域判断或写权限 |
| Program 化 Host | Codex SDK / App Server + 既有 `agent-run-contract`、`agent-host-codex` | 不新增 shell 无限循环、第二套 Host 或 memory |
| 周期性反熵 | Scheduled task 的隔离 worktree | 只跑已人工校准的 drift / GC / monitor，不扩展当前 mission |
| 机械阻断 | Codex hook | 只在 evidence receipt 可重放后启用；hook 不替代 verifier，也不强迫永不结束 |

当前先使用 skill、custom agents、现有 worktree/Agent Run 和质量门。候选 evidence 未绑定真实 receipt 之前，不新增 Stop / PreToolUse hook；否则只是把自证结论机械化。

## 6. 候选、反审与反熵

- 只有在跨 owner、难逆或高不确定决策点才并行 2–3 个只读候选；常规小改不制造候选开销。
- 裁决固定看用户结果、owner/consumer 复用、可验证性、责任面增量和可逆性；不得把多个落选方案拼成更大实现。
- evaluator 只接收 mission contract、完整 diff、命令和原始输出，不接收 builder 的自我辩护；它必须尝试证伪用户旅程和设计一致性。
- `verified / strict_improvement` 等调用方布尔值不构成证据。receipt 必须绑定 mission hash、source revision、patch hash、精确命令、退出状态和输出或 artifact hash，并可由 verifier 重放。
- acceptance oracle 在实现前冻结；Developer 改动 oracle 时候选立即失效，必须回到合同反审。
- 新发现分为当前验收必需、后续证据和无关项；只有第一类进入当前 scope。
- 一轮迭代只有在不破坏既有通过项、不增加未批准 authority 的前提下，改善至少一个失败验收信号，才算有效进展。
- 接纳时删除安全可删的旧实现、失败候选和临时兼容层；WIP、探索 artifact 和“以后可能用”的库存不得提交。

## 7. 工厂边界

长期 Factory 可以连续执行大量 mission，但不能把同一高层目标做成无限上下文和无限 patch loop。每个 mission 都有独立合同、隔离 workspace、预算、轨迹、验收和终态；上一个 mission 的证据只能成为下一个 mission 的输入，不能自动扩权。

单主上下文负责方向、合同和最终裁决；subagent 上下文用于搜索空间展开与独立反审。上下文压缩或重启后只能从仓库合同、任务状态和原始证据恢复，不依赖对话记忆猜测事实。

## 8. 解除条件

恢复期结束由用户明确决定。至少应先满足：本地与 CI 总闸稳定全绿、目标服务器链路可重复启动和观测、核心功能有端到端证据。解除冻结时再依据真实运行负载修改本合同与基线，不提前设计下一套组织结构。
