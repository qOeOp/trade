---
title: Development Convergence Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-29 CST
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
4. 经 PR 交付时，当前 head 的远端 required `quality` 与四语言 CodeQL 全绿；不经 PR 时，与影响面相称的本地 terminal gate 全绿。

新增 package、schema、文档或单元测试本身都不构成功能完成。没有 production consumer 的能力按库存代码处理，下一步应接入、合并或删除。

证据强度从高到低为：服务器可重复运行链路、端到端/集成测试、owner package 测试、静态合同。低层证据不能替代高层证据。

## 3. Agent 与提交约束

- 一个任务围绕一个可验证行为闭环；不按文件、步骤或测试结果连续制造微提交。
- PR 候选完成受影响 owner 定向检查、真实 consumer journey、diff inspection 与 workspace safety 后即可形成一个有意图的 commit / push；本地总闸不是默认前置。
- `main` 的 required `quality` / CodeQL 或候选远端 merge closure 未全绿时不得合并；失败只定向复现对应 owner / leaf，修复红灯优先于新增能力。
- 不经 PR 的交付必须先通过与影响面相称的本地 terminal gate。
- 开工前先指出复用的 owner 和运行入口；若找不到，先判断现有实现应接入、合并还是删除。
- 交付必须报告：用户行为、production consumer、运行证据、删除/新增表面积；不得用代码量、模块量或测试数量代替完成度。

## 4. 无人值守 mission contract

除简单问答、验收显然的微小机械修改和由更具体 skill 完整拥有的流程外，涉及产品或工程判断的非平凡任务走 `.agents/skills/run-bounded-mission/SKILL.md`。具体 skill 若仍需项目级 admission、跨域或终止控制，则与其组合使用。主上下文只持有一个 mission；subagent 可做有界工作或提供证据，但不拥有 scope、合并和完成判定。

只读发现前按 skill 限定暂定 Scope、Authority 和覆盖整个 mission 的总 Stop；完成证据调查与必要对齐后，在 Build 或重大决策前冻结完整七字段合同。项目侧另外要求：

1. Scope 先给出有界发现范围，文件名只作为起点；Build 前必须沿语义依赖闭合受影响边界；
2. 责任面增量不得突破恢复期基线；
3. 每个受影响边界都进入修改面或验收面，直到有证据证明下一层合同兼容。

任务可以按可独立证伪的垂直行为切片，但 slice 只是 Plan 方法，不拥有 lifecycle route。整个 mission 的 candidate 必须闭合真实 consumer；只新增库存代码不得进入下一片。

Stop 覆盖整个 mission，并在开工前冻结。修订计数或连续无进展只触发 revision-pressure 诊断；是否 `revise / replan / blocked` 由结构原因、验收进展和剩余预算共同决定。Agent 不得以“继续优化”绕过预算。

mission 只使用 skill 的 `accept / revise / replan / blocked` 四条 route。`revise / replan` 只在冻结 Stop 内继续且不得重置预算；`accept / blocked` 终止当前 mission，blocked 原因随证据报告，不另造 route。Goal 或 Agent Run 的宿主状态只是投影，不能反向扩张 lifecycle。

代码 mission 应明确交付终点。若终点是 GitHub merge，Handoff 可为当前 candidate 的非 draft PR 启用 squash auto-merge，但只有绑定该 candidate 的必需检查与 review 通过且 GitHub 报告已合并后才能 `accept`。该权限不含修改 ruleset、review 操作、conversation resolution、评论及手动或管理员合并；远程等待和修订仍消耗同一 Stop。

## 5. Codex 能力归位

| 需要 | 直接复用 | 项目边界 |
| --- | --- | --- |
| 模糊方向变成合同 | Plan / working plan + 可选 `mission_planner` | planner 先调查事实并暴露用户选择，再提出七字段合同与受影响边界；主上下文负责准入和冻结 |
| 一个逻辑任务长时续跑 | Goal mode | Goal 负责续跑；mission contract 负责成功、失败和停机，禁止 `until perfect` |
| 有界工作与独立反审 | subagent + 可选 `mission_evaluator` | 受 frozen Stop、风险和宿主容量约束；主上下文唯一裁决 |
| 写入隔离 | Codex worktree + 既有 `agent-workspace-manager` | 一个 mission 同时只有一个可写 winner |
| 可复用流程 | project skill + `AGENTS.md` | lifecycle authority 在 skill；领域事实与仓库 invariant 仍在 docs / owner contract |
| 领域事实与动作 | 既有 MCP / owner tool | Agent 不复制领域判断或写权限 |
| Program 化 Host | Codex SDK / App Server + 既有 `agent-run-contract`、`agent-host-codex` | 不新增 shell 无限循环、第二套 Host 或 memory |
| 周期性反熵 | Scheduled task 的隔离 worktree | 只跑已人工校准的 drift / GC / monitor，不扩展当前 mission |
| 机械阻断 | Codex hook | 只在 evidence receipt 可重放后启用；hook 不替代 verifier，也不强迫永不结束 |

当前先使用 skill、custom agents、现有 worktree/Agent Run、owner 定向检查与远端 required checks。候选 evidence 未绑定真实 receipt 之前，不新增 Stop / PreToolUse hook；否则只是把自证结论机械化。

`.codex/agents/mission-planner.toml` 与 `mission-evaluator.toml` 是当前可选 Codex 宿主投影，不是旧 lifecycle authority；跨宿主语义只以 skill 为准。

## 6. 候选、反审与反熵

- 只有存在 materially distinct 的可行方案且 frozen Stop 允许时才比较有界只读候选；不为制造竞争而扩张方案数。
- 裁决固定看用户结果、owner/consumer 复用、可验证性、责任面增量和可逆性；不得把多个落选方案拼成更大实现。
- evaluator 只接收 mission contract、完整 diff、命令和原始输出，不接收 builder 的自我辩护；它必须尝试证伪用户旅程和设计一致性。
- `verified / strict_improvement` 等调用方结论不构成证据。receipt 必须绑定冻结合同、origin、candidate、精确调用、退出状态和原始输出或 artifact identity，并可由 verifier 重放；具体 identity 由 owner surface 决定，不固定成第二套 schema。
- acceptance oracle 在实现前冻结；实现开始后发生实质改变，当前 candidate evaluation 立即失效并 `replan`，不得改写 oracle 适配实现。
- 新发现分为当前验收必需、后续证据和无关项；只有第一类进入当前 scope。
- 一轮迭代只有在不破坏既有通过项、不增加未批准 authority 的前提下，改善至少一个失败验收信号，才算有效进展。
- 接纳时删除安全可删的旧实现、失败候选和临时兼容层；WIP、探索 artifact 和“以后可能用”的库存不得提交。

## 7. 工厂边界

长期 Factory 可以连续执行大量 mission，但不能把同一高层目标做成无限上下文和无限 patch loop。每个 mission 都有独立合同、隔离 workspace、预算、轨迹、验收和终态；上一个 mission 的证据只能成为下一个 mission 的输入，不能自动扩权。

单主上下文负责方向、合同和最终裁决；subagent 只承担有界工作或证据返回。上下文压缩或重启后只能从仓库合同、任务状态和原始证据恢复，不依赖对话记忆猜测事实。

## 8. 解除条件

恢复期结束由用户明确决定。至少应先满足：`main` 的 required `quality` / CodeQL 稳定全绿、不经 PR 的本地 terminal gate 可重复、目标服务器链路可重复启动和观测、核心功能有端到端证据。解除冻结时再依据真实运行负载修改本合同与基线，不提前设计下一套组织结构。
