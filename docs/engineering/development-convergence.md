---
title: Development Convergence Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-23 CST
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

## 4. 解除条件

恢复期结束由用户明确决定。至少应先满足：本地与 CI 总闸稳定全绿、目标服务器链路可重复启动和观测、核心功能有端到端证据。解除冻结时再依据真实运行负载修改本合同与基线，不提前设计下一套组织结构。
