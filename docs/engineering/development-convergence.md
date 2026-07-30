---
title: Development Convergence Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-30 CST
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
- 变更涉及的语义依赖必须闭合；每个受影响边界须进入修改面或验收面，直到有证据证明下一层合同兼容。
- 交付必须报告：用户行为、production consumer、运行证据、删除/新增表面积；不得用代码量、模块量或测试数量代替完成度。

## 4. Codex 能力归位

| 需要 | 直接复用 | 项目边界 |
| --- | --- | --- |
| 写入隔离 | Codex worktree + 既有 `agent-workspace-manager` | 同一任务只保留一个可写 workspace |
| 领域事实与动作 | 既有 MCP / owner tool | Agent 不复制领域判断或写权限 |
| Program 化 Host | Codex SDK / App Server + 既有 `agent-run-contract`、`agent-host-codex` | 不新增 shell 无限循环、第二套 Host 或 memory |
| 周期性反熵 | Scheduled task 的隔离 worktree | 只跑已人工校准的 drift / GC / monitor，不扩展责任面 |
| 机械阻断 | Codex hook | 只执行已有 policy 的确定性投影，不创建新 authority |

## 5. 收敛裁决

- 裁决固定看用户结果、owner/consumer 复用、可验证性、责任面增量和可逆性；不得把多个落选方案拼成更大实现。
- 接纳时删除安全可删的旧实现、失败候选和临时兼容层；WIP、探索 artifact 和“以后可能用”的库存不得提交。

## 6. 工厂边界

长期 Factory 不得绕过 Convergence Baseline、production consumer 或交付证据要求。跨任务证据
不能自动批准新的责任面。

## 7. 解除条件

恢复期结束由用户明确决定。至少应先满足：`main` 的 required `quality` / CodeQL 稳定全绿、不经 PR 的本地 terminal gate 可重复、目标服务器链路可重复启动和观测、核心功能有端到端证据。解除冻结时再依据真实运行负载修改本合同与基线，不提前设计下一套组织结构。
