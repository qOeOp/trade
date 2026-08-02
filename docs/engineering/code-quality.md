---
title: Quality Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-08-01 CST
---

# Quality Contract

质量保障只约束稳定接口和可观察行为，不冻结当前实现形状。

## 公共接口

| 接口 | 保证 |
| --- | --- |
| `bun run check` | 本地完整检查入口 |
| `bun run check:pr-title -- <title>` | PR title 的本地交付检查入口 |
| package `scripts.check` | package 自己签发 compiler、unit/contract/consumer 行为 |
| GitHub `quality` | exact PR head 的稳定 merge context |
| CodeQL contexts | GitHub 签发的静态安全分析 |

中央 runner 只读取 repository-visible `package.json` 的唯一 `name` 和 `scripts.check`，并传播进程退出码。它属于 workspace manager，不预设 package 位于哪个目录、使用什么语言、测试文件叫什么，也不解析测试 runner 的人类输出。Go、Rust、Python owner 与 TypeScript package 使用同一接口；CI 不再复制 owner 的 compiler 或 test 命令。

## 边界

Required merge gate 可以检查：

- compiler、lint 和标准语言工具是否成功；
- package 公开的 check 是否成功；
- 真实 owner/consumer 场景是否成功；
- secret、静态安全和 workspace 副作用；
- release/runtime owner 输出的结构化状态；
- PR delivery contract 公开的 title 结构。

Required merge gate 不检查：

- Markdown 用词、frontmatter、中央文档标题或索引；
- 固定目录、模块数量、文件名、测试名或私有调用顺序；
- 源码是否包含某段文字；
- 手写 import/path 白名单或生成的“当前代码图”；
- package 内部命令的逐字拼写。

架构边界通过公开 contract、schema、CLI 和跨 owner consumer tests 证明。若一个约束只能依赖当前路径或源码文本表达，它是迁移提示或审计工具，不是 required quality gate。

PR title 属于 GitHub 交付元数据。`.github/scripts/validate-pr-title.sh` 拥有精确格式，workflow backstop 与本地 delivery preflight 共同调用该 validator，不复制规则。

## Ownership

- package owner 决定 `scripts.check` 内部如何组合 compiler 与测试；全仓 `--run-all` 在同一 checkout 内串行占用，shard 仍可在隔离 checkout 并行。
- Replay、release 和 runtime owner 保留自己的高成本认证，不复制到中央 runner。
- workflow 只编排上述接口；stable `quality` context 负责 merge，不代表 release 或 runtime 完成。
- 新 package 缺少唯一 `name` 或 `scripts.check` 时 fail closed。
- 影响面未知时执行全部 package contracts；不为提速维护中央路径分类器。

当前仍没有候选不可控的 governance verifier。workflow、quality runner、repository instructions 或 signer policy 的修改只能本地准备和验证，不能表述为已获得独立接纳。

## 新增或删除检查

新增 required check 必须同时给出真实风险消费者、稳定输入输出、失败处置和删除条件。连续没有独特行为收益的检查应删除或退回 owner；不能用测试数量、文件数量、文本快照或目录一致性证明质量。
