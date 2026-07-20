---
title: Research Source P0 Spike
updated_at: 2026-07-20 CST
status: implemented
contract_owner: modules/contracts/research-source-contract
parent_plan: docs/research-source-knowledge-integration-plan.md
---

# Research Source P0 Spike

结论：P0 退出门已通过，可以进入 P1 source-first intake；尚未授权文献进入 hypothesis、R&D queue 或 promotion evidence。

## 1. 已实现合同

新增 `modules/contracts/research-source-contract`，零运行时依赖，当前提供：

- stable canonical JSON 与 versioned SHA-256 identity policy；
- exact bytes content-addressed `source_revision`；
- 独立、append-only `source_acquisition`，避免同一 bytes 因 locator/fetch time 不同发生伪冲突；
- deterministic page/block-aware chunk set；
- code-owned chunk/page/exact-quote citation resolution；
- cited finding set、producer invocation receipt 与 append-only semantic identity；
- create-or-identical conflict classification；
- 不含版权正文的 golden identity fixture。

关键修正：source revision 只描述内容；arXiv/local locator、published/available/fetched time 属于 acquisition receipt。语义 finding identity 同时包含 canonical content 与 invocation receipt，同 producer 不同输出必然形成新 revision。

定向检查：TypeScript typecheck 通过；8 个 contract tests 全部通过，覆盖 golden hash、多 acquisition、路径/时间、bytes 篡改、chunk 篡改、错误 page/quote、citation coverage 与同 producer 不同输出。

## 2. PDF parser 决策

### 样本

1. 自生成 3 页 PDF：普通块、双栏、表格；嵌入字体后用 Poppler 渲染并人工检查，文本无裁切、重叠或错栏。
2. arXiv `2202.05924` 的 [v1 / v2](https://arxiv.org/abs/2202.05924)：17 / 25 页、不同 exact bytes hash，用于真实多页与版本共存检查。

### 结果

| Candidate | 页数/文本 | word bbox | 双栏与表格样本 | 决策 |
| --- | --- | --- | --- | --- |
| isolated Python `pdfplumber` | 全部样本非空；真实论文 v1/v2 分别约 1.16s/1.64s | 每页具备 `x0/x1/top/bottom` | anchor 与页归属通过 | P1 首选 adapter |
| Python `pypdf` | 页数与文本 anchor 通过 | 无 word geometry | 只能做粗文本/交叉检查 | 不作为 canonical parser |
| Bun/native | 仓库与 lockfile 当前无 PDF parser | 无 | 未形成可测试 candidate | P1 不新增未经基准的 JS parser |

决定：P1 使用隔离 Python adapter + stdin/stdout JSON contract，首选 `pdfplumber`。它只产 parser draft，不铸造 source/chunk identity、不写数据库。P1 必须显式声明并锁定 Python 依赖，不能依赖 Codex 本机 bundled runtime；若部署检查不通过，可替换 adapter 而不改 canonical contract。

当前只证明 born-digital PDF。OCR、扫描件、公式语义、表格结构恢复、任意 HTML/DOI 不在 P1 范围。

## 3. SQLite BLOB 决策

用 Bun `bun:sqlite`、WAL、`synchronous=FULL` 验证 1 / 10 / 40 MiB exact BLOB：

| BLOB | insert transaction | read + SHA-256 | 结果 |
| ---: | ---: | ---: | --- |
| 1 MiB | 约 2ms | 约 1ms | hash match |
| 10 MiB | 约 28ms | 约 8ms | hash match |
| 40 MiB | 约 116ms | 约 29ms | hash match |

本机测量只证明可行性，不是性能 SLA。三档均通过 content hash 复算、content-hash dedup、constraint failure rollback 与 `PRAGMA integrity_check`。

决定：P1 `max_source_bytes = 40 MiB`，与当前 catalog parse 上限一致。仅 research source exact PDF BLOB 可进入窄 source-asset table；report、CSV、feature series 仍不得进入 DB。超限对象只能登记 `non_durable_source`，不得生成长期 cited finding。

## 4. P0 退出门

| Gate | 结果 |
| --- | --- |
| canonical source/chunk/finding/citation contract | pass |
| golden hash 与 citation round-trip | pass |
| real PDF version coexistence | pass |
| parser page/word geometry | pass，选择隔离 `pdfplumber` adapter |
| bounded SQLite BLOB / dedup / rollback / integrity | pass，首版上限 40 MiB |
| same producer + different output | pass，新 identity；禁止覆盖 |
| hypothesis v1 compatibility | pass by boundary：P0 未修改 hypothesis v1；P2 才引入新 revision |

## 5. P1 入口约束

P1 只实现 artifact-knowledge owner 的 local PDF / exact-version arXiv PDF intake：

1. schema 与 owner transaction；
2. isolated parser adapter；
3. register/resolve/query owner surface；
4. source/acquisition/chunk create-or-identical；
5. corrupted BLOB、partial rollback、version coexistence、temporal query、GC pin tests。

P1 不调用模型、不生成 finding、不修改 hypothesis contract、不写 `rd_state.db`。
