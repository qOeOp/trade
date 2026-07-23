---
title: Database Environment and Workspace Hygiene Migration
role: architecture-migration
status: active-migration
owner: architecture
last_verified: 2026-07-23 CST
---

# Database Environment and Workspace Hygiene Migration

## 0. 定位

本计划解决三类同源问题：owner SQLite 依赖当前工作目录、测试与自检可改写持久库、ignored 产物缺少生命周期治理。目标不是禁止 WAL、编译缓存或研究 artifact，而是让它们只能出现在所属环境、可审计位置和明确 retention 内。

本文处于 active migration：P0–P5 的首轮可执行闭环已落地，剩余项是 retention/容量预算与更广调用面渐进迁移，不改变 [Storage Architecture](../storage-architecture.md) 的 logical-store authority 或真实交易授权。环境选择只决定数据与临时产物落点，不授予 Binance 写权限，也不替代 `live-small` preflight、显式确认和 reconciliation。

当前实施状态：

| 阶段 | 状态 | 已落地闭环 |
| --- | --- | --- |
| P0 | complete | tracked runtime ratchet 清零；module-local DB/sidecar 移除；有效 OHLCV/manifest 经 owner 写入根 data plane 后复验 |
| P1 | complete-baseline | `database-environment.ts` 统一 local/test/CI/runtime、稳定 path 与 owner DB filename；共享 CLI 相对路径不再依赖 package cwd |
| P2 | complete-baseline | `test-database-environment.ts` 提供唯一目录、handle registry、WAL checkpoint、幂等 cleanup；并行同名 WAL DB 隔离回归通过 |
| P3 | complete | quality pre/post content snapshot 已接入；tracked + unignored 新增/删除/改写 fail closed；CI preflight 要求 clean checkout |
| P4 | complete-baseline | footprint audit 已区分 durable、protected evidence、test/cache/clone，并只输出 dry-run；evidence 删除仍由 catalog GC 的 ref/`.pin`/显式确认承担 |
| P5 | complete-baseline | 9 个 local owner DB 已写 `trade.database-identity.v1` 并通过 integrity check；environment/store mismatch、非空 legacy 无显式 migration 均失败 |

## 1. 已确认缺口

2026-07-23 本地审计确认：

- 仓库已跟踪多份运行态 `.db`、`.db-wal`、`.db-shm`；ignore 无法保护已跟踪文件。
- `.gitignore` 只覆盖根 `data/*.db` / `data/*.sqlite*`，没有完整覆盖 SQLite sidecar 与 module-local `data/`。
- `legacy-integration-suite` 有测试创建临时 artifact root，却让 RD state 继续使用相对默认 `data/rd_state.db`；`quality-check.sh` 进入 package 目录执行测试后会改写已跟踪 DB。
- `git diff --check` 只检查文本差异，不证明测试没有新增二进制、未跟踪文件或 ignored 磁盘负担。
- `tmp/`、Rust `target/` 和 SQLite sidecar 均已形成 GB 级本地占用；其中一部分是有效证据或缓存，不能用无差别删除处理。

## 2. 目标不变量

| ID | 不变量 |
| --- | --- |
| `DBE-01` | logical store owner 不通过调用进程的当前目录推断数据库身份。 |
| `DBE-02` | 每个可写 DB 必须属于一个显式 environment 与 owner store；不同 environment 不共享可写文件。 |
| `DBE-03` | unit / integration / certification 默认不得写 repo durable `data/`；测试数据库必须显式注入。 |
| `DBE-04` | CI job、并行测试和重试使用独立实例；同名 program/run 不造成跨用例状态串扰。 |
| `DBE-05` | SQLite WAL/SHM 与主 DB 同生命周期、同目录边界；它们永不作为 Git 资产。 |
| `DBE-06` | `quality-check.sh` 连跑两次不改变进入检查前的 tracked / unignored 工作区状态。 |
| `DBE-07` | 源码目录不承载运行 DB、artifact、cache 或恢复快照；可提交 fixture 必须不可变且位于 `fixtures/` / `examples/`。 |
| `DBE-08` | 自检只报告和阻断污染，不静默删除用户数据；删除继续显式且受 catalog ref、`.pin` 与 retention 保护。 |
| `DBE-09` | environment 不是权限；任何环境名都不能放宽真实交易写入边界。 |

## 3. 最小环境模型

首轮只定义生命周期类别，不提前冻结环境变量名、配置文件名或最终目录结构：

| 类别 | 生命周期 | DB 落点语义 | 退出语义 |
| --- | --- | --- | --- |
| local development | 跨命令保留 | repo root 解析出的本地 durable data plane | 不自动清理 |
| test | 单用例或单 suite | OS temp 下唯一实例；所有 store path 显式注入 | 正常退出关闭连接并删除；异常残留可识别 |
| CI | 单 job | runner 提供的 job temp；不同 shard/job 不共享写库 | job 结束丢弃；结束前验证工作区无副作用 |
| runtime | 部署生命周期 | deployment 明确提供的 durable data plane | 由 operator retention / backup 管理 |

约束：

- `shadow`、R&D、certification 是 workload / evidence 语义，不自动扩张成新的长期环境类别；只有出现独立生命周期或隔离需求后再新增。
- 大型 OHLCV 可作为带 hash 的只读输入被 test / CI 消费，但测试结果、checkpoint、catalog 与 RD state 必须写入独立实例；不得共享可写 canonical DB。
- CLI 可以保留 local-development 便利默认值，但必须从稳定 repo/deployment root 解析。library、test 与跨 package 调用必须显式获得 DB handle/path bundle。
- 每个 owner DB 需要可验证的 store/environment identity。精确 metadata schema 在 P1 与各 owner 一起冻结；打开不匹配的现有 DB 必须 fail closed，不能自动重标环境。

## 4. 目标数据流

```text
environment selection
  -> stable data/tmp roots
  -> owner store path bundle
  -> owner open + schema/environment identity check
  -> workload
  -> close/checkpoint
  -> environment-specific retention
```

调用方只选择 environment 或注入明确路径，不自行拼 `data/<store>.db`。logical store 数量、owner authority 与跨 store ref 继续由 storage contract / architecture manifest 决定；本计划不合库，也不新增共享写入口。

## 5. 分阶段施工

### P0：止血与基线

- 修复所有测试中的隐式默认 DB；临时目录必须贯穿 state、catalog、artifact 与 sidecar。
- 全局忽略 SQLite sidecar；盘点并从 Git 索引移除运行态 DB/sidecar。若某文件确为 fixture，先转成最小 SQL/JSON 或只读不可变 fixture。
- 禁止新增 `modules/**/data/` 运行落点；现有文件逐一判定迁移或删除，不把未知 DB 批量当垃圾处理。
- 记录清理前的 path、tracked 状态、bytes、最后修改时间与 catalog/pin 引用；本阶段不做无差别清理。

退出条件：运行已知污染测试后，Git 状态不新增 DB 差异或 module-local sidecar。

当前 P0 分类：

| 路径组 | 只读证据 | 处置 |
| --- | --- | --- |
| 根 `data/*.{db-shm,db-wal}` 4 个 tracked sidecar | 属于 local durable DB 的 WAL companion，不是独立事实 | 已解除 Git 跟踪；工作副本按 SQLite 生命周期保留 |
| `market-data-store/data/ohlcv.db` | `canonical_candle=0` | 已从 Git 与 module data 移除 |
| `ohlcv-fetch/data/ohlcv.db` + `market_data.db` | 2,483 candles / 6 manifests；迁移前根 owner DB 中对应 identity 均缺失 | 已经 owner functions 写入根 data plane并逐行复验；根库 integrity check 通过，module-local 主库与 sidecar 已移除 |
| `legacy-integration-suite/data/rd_state.db` | 仅含 `rd-loop-state`、`rd-campaign-state` 两个测试 program | 测试已改为显式 temp DB；原测试库已从 Git 与 module data 移除 |

`scripts/check-workspace-hygiene.ts` 的历史 tracked runtime ratchet 已清零；任何 tracked sidecar/runtime DB、module-local DB 或过期 exception 均失败。

### P1：环境与路径合同

- 盘点所有 `data/*.db` 默认值、`process.cwd()` 路径解析和跨 package DB 参数。
- 建立唯一的环境解析语义：稳定 root、data root、tmp root、environment identity、owner store paths；实现形态在施工时选择，禁止各模块复制一套 resolver。
- owner open path 验证 store/environment identity、schema version 与 writable/read-only intent；错误环境、错误 store、错误 schema 均 fail before write。
- 显式路径保持可用于 test、migration 与 operator recovery，但必须经过同一 owner 校验。

退出条件：从任意 package cwd 启动同一 local command，解析到同一 local data plane；显式 test path 不可能回退到 repo `data/`。

### P2：测试数据库生命周期

- 统一 test DB fixture 语义：唯一目录、完整 store bundle、handle registry、`finally` close、可选 WAL checkpoint、递归清理。
- unit test 优先 `:memory:`；需要多连接、WAL、crash/recovery 或 subprocess 的测试使用文件 DB。
- certification 若必须保留 evidence，只保留 receipt/summary 与明确 pin 的 artifact；测试 DB 本身不因“便于调试”升级为长期资产。
- 增加并行、异常退出、重复执行和错误 environment negative controls。

退出条件：并行执行相同 suite 不串写；正常完成不遗留 test DB/sidecar；异常残留全部位于可识别的 test-run scope。

### P3：工作区副作用质量闸

在现有 project quality 入口内补一项只读 hygiene gate，精确实现可为现有脚本函数或窄 helper，不预先固定新 tool 数量：

1. preflight：拒绝 Git 跟踪 SQLite sidecar、runtime DB、module-local data、未允许的 generated/cache 路径。
2. snapshot：记录检查开始时 tracked 与 unignored 状态，允许用户已有改动。
3. run：执行现有语言、模块与架构检查。
4. postflight：只拒绝本轮新增/改写的工作区副作用；CI clean checkout 额外要求最终状态为空。
5. footprint report：报告 ignored 区域的 bytes、文件数、年龄、retention/pin 状态；容量超限先报告，不在 quality 内自动删除。

退出条件：quality 连跑两次状态相同；故意写入 module-local DB、跟踪 sidecar 或测试改写 fixture 的 negative control 必须失败。

### P4：retention 与显式清理

- `tmp/artifacts` / `tmp/panels` 继续由 catalog ref、evidence、ledger 与 `.pin` 保护；先 dry-run，再显式确认删除。
- `tmp/check`、普通 test run、下载/clone audit 和编译 cache 分别声明 owner、可重建性与默认 retention；不能把它们伪装成同一类 artifact。
- Rust `target/`、依赖 cache 等无业务引用的 build cache 可提供独立清理入口，但不得与 evidence GC 混用。
- cleanup receipt 至少记录类别、数量、bytes、保护/跳过原因；不把逐文件清单写入长期文档。

退出条件：stale report 可解释主要磁盘占用；受保护证据不会被删除；可再生 cache 可按类别显式回收。

### P5：runtime 迁移与防串写

- 为现有 local durable DB 补 identity inspection；先只读盘点，再由 owner migration 写入 metadata。
- runtime 启动输出不敏感的 environment/store identity 摘要，不输出本机绝对路径、凭证或 payload。
- 对 environment mismatch、把 test DB 交给 runtime、把 runtime DB 交给 test、共享 writable OHLCV 建立 fail-closed 验收。
- backup/restore 后保留 environment identity；跨环境复制必须走显式 migration/import，不允许直接改 metadata 冒充。

退出条件：错误环境在任何业务写入前失败；正确 runtime 重启与恢复不改变 logical-store authority。

## 6. 首个 change set

第一批只做 P0，不与完整 environment resolver 混成大改：

1. 修复 `strategy-rnd` 两个使用默认 `rd_state.db` 的测试路径，并补“package cwd 下不写 module data”回归。
2. 补 sidecar ignore 与 tracked-runtime-file 检查。
3. 逐项审计当前已跟踪 `.db/.db-wal/.db-shm`，形成 keep-as-fixture / convert / untrack 三类清单。
4. 为 quality 增加最小 negative control，证明测试改写 tracked DB 会失败。
5. 更新 Data Hygiene 与 Check Contract，使其只声明已经落地的 P0 规则。

P0 完成后再决定 P1 的具体 resolver 落点，避免在没有完整调用面盘点时提前建立第二套路由 authority。

## 7. 总体验收

- `git ls-files` 不包含 runtime SQLite sidecar，也不包含可变 owner DB。
- 所有测试 DB 都能追溯到 test/CI run identity，且不依赖 package cwd。
- local、test、CI、runtime 之间不存在共享可写 DB；大型只读输入有 immutable identity。
- quality 在已有 dirty worktree 上只拦截本轮副作用，在 clean CI 上确保检查后仍 clean。
- WAL/crash 测试仍真实运行，不通过关闭 WAL 来掩盖 sidecar 生命周期问题。
- 磁盘审计区分 durable DB、受保护 evidence、普通 artifact、test residue、build cache 与 external audit clone。
- 所有删除均显式、可解释；环境隔离不放宽任何真实交易授权。

## 8. 尚待决策

- runtime durable data plane 最终留在 repo `data/`，还是由部署层提供 repo 外目录。
- owner DB identity 使用统一最小 metadata contract，还是由各 owner schema 映射到共同 inspection projection。
- local development 是否允许共享只读 OHLCV snapshot，以及 snapshot 冻结/更新边界。
- test residue、`tmp/check`、build cache 与 external audit clone 的具体 retention / size budget。
- historical tracked DB 中哪些仍有不可替代 fixture 价值。

这些决策不阻塞已落地 baseline；其中 retention / size budget 应基于连续 footprint 报告收敛，不能倒逼 quality 自动删除。runtime data plane 最终部署路径变化时，继续使用显式 root 与 identity migration，不修改 metadata 冒充环境。
