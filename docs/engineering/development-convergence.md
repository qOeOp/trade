---
title: Development Convergence Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-31 CST
---

# Development Convergence Contract

## 定位

当前优先让已有能力形成可运行链路，再扩张责任面。收敛判断基于语义 owner、真实 consumer
和运行证据，不使用 module、tool 或合同文件数量作为设计配额。

## 责任面原则

- 开工前确认现有 owner 和入口；语义相同则直接复用，语义不同则不得为维持计数把职责塞进旧模块。
- 新 owner、tool、domain、store、job 或 rail 必须服务当前结果，并进入对应 architecture/toolset owner；“以后可能需要”不是理由。
- package、schema、文档和单元测试是支持证据，不能单独证明新增功能完成。
- 删除旧实现前确认没有 production consumer、兼容合同或恢复路径仍依赖它。
- `bun scripts/check-convergence-budget.ts` 只报告相对快照变化，不阻断质量、签发设计结论或要求通过删除别处换取新增。

`docs/engineering/convergence-baseline.json` 是 2026-07-23 的观测快照。字段名保留 v1 兼容，
`recovery_freeze=false` 表示它不再是 hard gate。

## 完成证据

宣称新增或完成用户功能时，至少需要：

1. 用户或 operator 可观察的行为；
2. 既有 runtime、CLI 或 server consumer 实际消费；
3. 与影响面匹配的 owner、边界或 integration 证据；
4. 对应交付路径的本地或远端 gate。

文档修正、局部 bug、测试维护和内部清理按实际影响面验证，不强制制造跨 owner 链路或
服务器运行证据。

## 开发与交付

- 一个候选围绕一个可验证结果，不按文件或测试步骤制造微提交。
- 语义依赖必须进入修改面或验收面，直到下一层有兼容证据；不沿假设依赖无限扩张。
- `main` 为红时优先修复对应失败面；它不自动禁止与失败无关的工作，但不得绕过 required merge closure。
- 经 PR 交付时使用受影响 owner、真实 consumer、完整 diff 和 workspace safety 作为本地证据，远端 required checks 收口。
- 不经 PR 的交付必须通过与影响面相称的本地 terminal gate。
- 交付报告用户行为、production consumer、运行证据以及新增、删除或转移的责任；不用代码量、模块量或测试数量代替完成度。
