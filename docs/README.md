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
| 哪些域可以互相传什么 | [architecture/architecture-communication-v2.mmd](./architecture/architecture-communication-v2.mmd) |
| profile、账户、资金和凭证归谁 | [architecture/architecture-data-trust-v2.mmd](./architecture/architecture-data-trust-v2.mmd) |
| 当前 J01–J07 如何调度 | [architecture/architecture-runtime-v2.mmd](./architecture/architecture-runtime-v2.mmd) |
| 当前模块、job、store、rail | [architecture/architecture-manifest.json](./architecture/architecture-manifest.json) |
| 代码与蓝图是否漂移 | [architecture/generated/architecture-drift-report.md](./architecture/generated/architecture-drift-report.md) |
| 一个模块如何调用 | [architecture/tool-layout.md](./architecture/tool-layout.md) → `toolset.json` → module `CONTRACT.md` |
| 一个大功能如何运行 | [runtime](./runtime/) 下对应合同 |
| R&D 如何演进 | [research](./research/) 下对应 architecture / strategy / reliability 文档 |
| 改动后跑什么 | [engineering/check-contract.md](./engineering/check-contract.md) |
| 哪些文档是当前合同、由谁负责 | [engineering/doc-contract-index.json](./engineering/doc-contract-index.json) |

优先级：产品边界 > 当前架构合同 > domain/module contract > 历史施工记录。生成文件只投影当前代码，不反向定义产品。

## 状态词汇

| Status | 含义 |
| --- | --- |
| `active` | 当前有效合同或入口 |
| `active-partial` | 已实现并生效的有限子集；正文必须声明未完成边界 |
| `active-migration` | 当前迁移合同；目标态不得冒充现状 |
| `proposed` | 尚未进入当前 authority 的提案 |
| `source-material` | 可引用的上游素材，不直接定义当前实现 |
| `implemented` | 已完成的实现记录，不自动升级为持续 authority |
| `audit-log` | 按时间追加的审计事实，不覆盖当前合同 |

current 文档只允许以上状态，并必须与 `doc-contract-index.json` 一致；index 必须精确覆盖 current 手写文档，不得夹带 generated、普通 history 或其他路径。history 正文只允许 `completed-historical` 或 `legacy-reference`。仓库内 Markdown 相对链接必须解析到真实路径；机器检查不证明外部 URL 可用，也不校验页面 anchor 语义。

index `id` 使用 `<文档域>.<短名>`：只允许小写 ASCII、数字、点和短横线，且命名空间必须与 `docs/product|architecture|runtime|research|engineering` 路径一致；`docs/README.md` 与 `docs/history/README.md` 使用 `docs.*`。ID 是稳定引用，不使用标题、临时任务名或跨域别名。

`implementation_refs` 只连接当前合同与已有实现证据：每项必须是仓库相对且已规范化的真实文件或目录，不得重复、使用本机绝对路径、`..` 越界或通过符号链接逃逸仓库。目录引用表示 owner surface，不等于其全部内容都已实现。

`owner` 不能是自由标签：它必须是 `product / architecture / engineering` 文档治理 owner、`architecture-manifest.json` 中的 domain，或该 domain 下真实存在的模块组。新增 owner 必须先建立实际 authority，不能只让 frontmatter 与 index 同时新增一个名字。

`role` 也不是自由标签，并与 status 绑定：contract / index / decision / roadmap / runbook 使用 `active`；feature contract 可使用 `active-partial`；migration 只使用 `proposed` 或 `active-migration`；source material、implementation record、audit log 分别只使用 `source-material`、`implemented`、`audit-log`。精确 role→status 组合由 `check-doc-contracts.ts` 执法，新增组合必须先修改本合同与 checker。

`title` 是稳定、可读的元数据标题，不要求与正文展示标题逐字相同。current 文档必须且只能有一个 `#` 一级标题；history 可为保留原始结构包含多个一级标题，但至少有一个。

`last_verified` 统一使用 `YYYY-MM-DD CST`，日期必须真实存在。它表示 owner 最近一次核对当前内容的日期；机器检查不定义 freshness SLA，也不会因自然时间流逝自动改写文档。

## 归档规则

- 跨域合同、顶层架构和大功能设计必须进入对应子目录，不在 `docs/` 根目录新增散文件。
- 单模块输入输出写在模块 `CONTRACT.md`；只有跨模块或大功能语义才进入 `docs/`。
- 已完成 plan、cleanup、一次性 audit 和被替换的详细旧稿移入 `history/`，并标明状态；不得继续充当当前入口。
- 运行 artifact、临时 hypothesis、实验输出不进入 `docs/`。
- 新目录只在出现稳定 owner 后建立，不按一次任务临时分组。
- 当前手写文档必须声明 `title / role / status / owner / last_verified`，并登记到 `doc-contract-index.json`；历史文档只允许 `completed-historical` 或 `legacy-reference`。
- `active-partial`、`active-migration`、`proposed` 等状态必须在正文说明未完成边界，不得用目标设计冒充已实现事实。
