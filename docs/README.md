---
title: Documentation Contract
role: documentation-index
status: active
owner: architecture
last_verified: 2026-07-22 CST
---

# Documentation

`docs/` 是项目 L1 contract 层。它先定义产品边界、责任域、运行语义和大功能合同，再由 CLI/schema/event contract 与代码实现承接。

## 目录

| 目录 | 负责 | 不负责 |
| --- | --- | --- |
| [product](./product/) | vision、PRD、用户故事、高价值产品素材 | 技术拓扑、实施计划 |
| [architecture](./architecture/) | 当前顶层架构、domain/store/rail ownership、机器 manifest、图和迁移设计 | 具体策略实验、临时施工记录 |
| [runtime](./runtime/) | 交易配置、执行工具、市场数据等大功能运行合同 | 顶层产品边界、R&D 证据 |
| [research](./research/) | R&D architecture、strategy universe、可靠性、research sources | live 授权、真钱事实 |
| [engineering](./engineering/) | check、code quality、data hygiene | 产品或业务规则 |
| [history](./history/) | 已完成施工图、一次性审查和被替换的 legacy contract | 当前产品、架构或运行真相 |

## Authority

| 问题 | 入口 |
| --- | --- |
| 为什么做、做什么 | [product/vision.md](./product/vision.md) → [product/prd.md](./product/prd.md) |
| 用户如何使用 | [product/user-story.md](./product/user-story.md) |
| 系统当前如何分域 | [architecture/design-architecture.md](./architecture/design-architecture.md) |
| 当前模块、job、store、rail | [architecture/architecture-manifest.json](./architecture/architecture-manifest.json) |
| 代码与蓝图是否漂移 | [architecture/generated/architecture-drift-report.md](./architecture/generated/architecture-drift-report.md) |
| 一个模块如何调用 | [architecture/tool-layout.md](./architecture/tool-layout.md) → `toolset.json` → module `CONTRACT.md` |
| 一个大功能如何运行 | [runtime](./runtime/) 下对应合同 |
| R&D 如何演进 | [research](./research/) 下对应 architecture / strategy / reliability 文档 |
| 改动后跑什么 | [engineering/check-contract.md](./engineering/check-contract.md) |
| 哪些文档是当前合同、由谁负责 | [engineering/doc-contract-index.json](./engineering/doc-contract-index.json) |

优先级：产品边界 > 当前架构合同 > domain/module contract > 历史施工记录。生成文件只投影当前代码，不反向定义产品。

## 归档规则

- 跨域合同、顶层架构和大功能设计必须进入对应子目录，不在 `docs/` 根目录新增散文件。
- 单模块输入输出写在模块 `CONTRACT.md`；只有跨模块或大功能语义才进入 `docs/`。
- 已完成 plan、cleanup、一次性 audit 和被替换的详细旧稿移入 `history/`，并标明状态；不得继续充当当前入口。
- 运行 artifact、临时 hypothesis、实验输出不进入 `docs/`。
- 新目录只在出现稳定 owner 后建立，不按一次任务临时分组。
- 当前手写文档必须声明 `title / role / status / owner / last_verified`，并登记到 `doc-contract-index.json`；历史文档只允许 `completed-historical` 或 `legacy-reference`。
- `active-partial`、`active-migration`、`proposed` 等状态必须在正文说明未完成边界，不得用目标设计冒充已实现事实。
