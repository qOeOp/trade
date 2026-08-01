---
title: Documentation
role: documentation-index
status: active
owner: architecture
last_verified: 2026-08-01 CST
---

# Documentation

`docs/` 解释产品边界、跨模块语义、架构决策和运行方式。它不是第二套类型系统，也不通过逐字文本、frontmatter、索引或固定目录来签发代码质量。

## 入口

| 目录 | 内容 |
| --- | --- |
| [product](./product/) | 产品目标、PRD、用户故事 |
| [architecture](./architecture/) | 当前系统边界、通信、数据与迁移设计 |
| [runtime](./runtime/) | 运行配置、交易、市场数据和部署合同 |
| [research](./research/) | R&D 架构、策略空间和可靠性材料 |
| [engineering](./engineering/) | 工程质量、数据卫生和维护说明 |
| [history](./history/) | 已完成计划、审计记录和被替换设计 |

关键入口：

- 当前产品：[product/prd.md](./product/prd.md)
- 当前架构：[architecture/design-architecture.md](./architecture/design-architecture.md)
- 工具接口：[architecture/tool-layout.md](./architecture/tool-layout.md) 与 `toolset.json`
- 质量接口：[engineering/code-quality.md](./engineering/code-quality.md)
- 运行合同：[runtime](./runtime/)
- R&D 合同：[research](./research/)

## Authority

优先级为：用户结果与产品/runtime 合同 > owner `CONTRACT.md` 和公开 schema/CLI > consumer 行为 > 文档说明 > 历史记录。

- 文档描述稳定语义，不冻结实现排版、源码字符串、私有函数、测试名或仓库拓扑。
- 模块移动、重命名或内部重写不需要更新中央文档索引；只有公开行为、owner 或跨模块合同改变时才更新相关文档。
- 机器可消费的约束使用 package `scripts.check`、schema、CLI 输入输出和退出码，不从 Markdown 反向推导。
- `history/` 只保留背景，不定义当前实现。

## 维护

- 新文档只在存在稳定读者和 owner 时创建；短期施工记录优先写入已有计划或 issue/PR。
- 单模块细节留在模块附近，避免复制到多个总文档。
- 失效内容直接删除或移入 `history/`，不保留兼容索引、路径 tombstone 或逐字防回归测试。
- 相对链接应可读；链接失效由修改者在相关文档变更中修复，不作为所有代码候选的 required gate。
