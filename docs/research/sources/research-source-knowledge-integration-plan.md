---
title: Research Source Knowledge Integration Plan
role: research-migration
status: proposed
owner: research-strategy-development
last_verified: 2026-07-23 CST
p0_status: implemented
reference_repository: https://github.com/LLMQuant/quant-mind
reference_revision: 9c88d0612812ae29d91afaefa35244e8ad47f3f0
---

# Research Source Knowledge Integration Plan

> `proposed` 是 P1+ 的当前状态；`p0_status: implemented` 只声明 P0 spike 已完成，不等于完整 source-first intake 已落地。

结论：吸收 QuantMind 的 source-first knowledge contract，不引入它的第二套研究平台。

目标链路：

```text
exact source revision
  -> deterministic parse / page-aware chunks
  -> cited research findings
  -> artifact-knowledge query surface
  -> hypothesis designer research_basis
  -> proposal / queue / KG refs
  -> experiment evidence
```

文献只提供“为什么值得检验”的来源依据，不提供“策略有效”的实验依据。任何引用、摘要或语义检索命中都不能越过 discovery / validation / holdout / reviewer / governance gate。

本文是融合提案，不是已冻结的长期制度。P0 验证通过前，不修改 `docs/product/vision.md`、不新增 automation、不预先固定 parser、embedding provider 或 tool 数量。

## 1. 源码评审结论

### 1.1 QuantMind 值得吸收的部分

| 能力 | 源码事实 | 对本项目的价值 |
| --- | --- | --- |
| 精确来源修订 | source ID 由 fetched bytes 的 SHA-256 派生；保留 source kind、exact arXiv version、`available_at` / `as_of`、parser identity 与原始 asset | 文献内容、版本和可得时间不再只存在于 prompt 或临时路径 |
| 页级可追溯切片 | chunk 保存稳定位置、content hash 与 page/block source spans | hypothesis 中的机制主张可回到具体页和原文 |
| 代码验证引用 | 模型只提议 chunk/page/quote；构造器验证 chunk 归属、页归属和 quote 精确存在 | LLM 不能自己铸造 canonical citation |
| 有界 map-reduce | 代码决定分组、并发、超时、token 上限和 reduce；agent 只生成 typed draft | 长论文处理可控、可复现失败、不会把 orchestration 权交给模型 |
| canonical / projection 分离 | source、artifact、lineage 是 canonical；embedding 是可删除、可重建 projection | 后续可换 embedding，不改来源与引用身份 |
| 原子写入 | source、asset、artifact、members、lineage、projection 在同一事务提交 | 不产生只有摘要、没有原文或 lineage 的半成品 |
| 检索先过滤后排序 | 查询先约束 source/artifact/time，再做 semantic rank；结果返回 matched text、source、citation | 适合按 active canonical、data surface、时间边界收窄研究材料 |

对应实现见 QuantMind 的 [paper flow](https://github.com/LLMQuant/quant-mind/blob/master/quantmind/flows/paper.py)、[paper knowledge model](https://github.com/LLMQuant/quant-mind/blob/master/quantmind/knowledge/paper.py)、[local library](https://github.com/LLMQuant/quant-mind/blob/master/quantmind/library/local.py) 与 [SQLite store](https://github.com/LLMQuant/quant-mind/blob/master/quantmind/library/_internal/sqlite_store.py)。

### 1.2 不能照搬的部分

| 项目 | 问题 | 决策 |
| --- | --- | --- |
| 整仓运行时 | QuantMind 是 Python 3.10+，依赖 Agents SDK、LiteLLM、LlamaIndex、PDF parser 与 embedding；本项目主运行时是 Bun / TypeScript | 不增加 QuantMind 生产依赖，不让它拥有第二个 library DB |
| GraphKnowledge | 当前 `_graph.py` 明确是未实现 placeholder | 不创建第二套知识图；复用现有 `rd_knowledge_node / edge / edge_evidence` |
| 语义 artifact identity | summary ID 只由 source + kind + producer config 派生；同配置产生不同 summary 时 content 可在同 ID 下被覆盖，测试也接受该行为 | 语义产物必须 append-only：身份纳入 content hash，或同 ID 仅允许 create-or-identical；不同内容必须新 revision |
| 原始 BLOB 默认入 library | 与当前 `artifact_catalog` 只存索引、大 payload 留 `tmp/` 的规则冲突 | 需要一项窄化的 durable-source 决策，见 4.2；不能把永久来源伪装成可清理 tmp artifact |
| 产物种类 | 当前 canonical 主要只有 chunk set 和 global summary；structure tree 仍偏设计态 | 首版只做 source、chunk、cited finding，不等待或照搬其未来结构树 |
| 检索先行 | embedding 会引入 provider、维度、成本和重建运维 | P1/P2 只做结构化过滤与全文检索；有真实召回缺口后再进入 P3 |
| 通用研究平台 | QuantMind 面向金融知识处理；本项目只服务 Binance USDM `4H+ swing` R&D 闭环 | query 与 finding schema 受 Strategy Universe、data surfaces 和可证伪研究问题约束 |

QuantMind 使用 MIT License，法律上允许复用，但架构上仍以“移植语义与测试不变量”为主，不复制其运行时所有权。

## 2. 本项目的真实缺口

当前系统的下游研究纪律已经强于 QuantMind，但上游 source identity 缺失：

1. `artifact-catalog` 能索引路径、hash、report 与引用边，但 `artifact_id` 仍以路径为主身份；它不能表达“同一论文的精确内容修订”和“由哪个 chunk 生成了哪个主张”。
2. `strategy-hypothesis-contract.v1` 强制 mechanism、participants、regime、falsification、primary tests 与 negative controls，却没有 `research_basis`；designer prompt 可以看到 artifact path，queue projection 会丢失这些来源。
3. Planner 能读取 universe、data surfaces、capabilities、failure lessons，却没有外部 research finding surface；空 ready queue 时只能依赖静态 family backlog 或人工临时设计。
4. `rd_knowledge_*` 已经提供长期 node/edge/evidence ledger，适合记录 finding → hypothesis → experiment → lesson 的关系，但不应反向拥有 PDF、chunk 或引用真相。
5. `tmp/` 是非 durable 工作区，而精确来源如果要长期支撑 citation 就必须 durable。当前 storage policy 对“受控的大型原文”还没有完整答案。

因此，融合点不是 replay、execution 或 promotion，而是 R&D 之前的一层窄 source-knowledge intake。

## 3. 目标边界

### 3.1 Owner 划分

| Owner | 新职责 | 明确禁止 |
| --- | --- | --- |
| `artifact-knowledge` | source revision、raw asset、parse/chunk、cited finding、lineage、检索 projection 的 canonical owner；提供 register/query/resolve owner surface | 生成可执行策略、写 RD state、判定研究有效、做 promotion |
| `research-strategy-development` | 按 universe/data surface/失败历史选择 findings；把 refs 编入 hypothesis/proposal/queue；执行实验并产生独立证据 | 直读 artifact DB、修改 source/citation、把文献当实验结果 |
| `rd_knowledge_*` | 保存 source/finding ref 到 hypothesis/experiment/lesson 的投影边和追加证据 | 保存原文或成为 citation authority |
| `governance-review-compliance` | 校验策略证据链是否完整；区分 rationale source 与 empirical evidence | 依据论文引用直接准入策略 |
| `orchestration-ops` | 通过既有 job/rail 调度 owner command，记录健康与失败 | 编排内部知识语义、直接写任一 owner DB |

### 3.2 Canonical 与 projection

首版只承诺四个语义层，不提前冻结内部 tool 拆分：

| 层 | 必须保存 | 身份要求 |
| --- | --- | --- |
| Source Revision | exact bytes hash、source locator、source version、published/available/fetched time、media type、parser-independent metadata | content-addressed；相同 bytes 幂等，不同 bytes 永不覆盖 |
| Chunk Set | source revision ref、producer config/build hash、稳定顺序、文本 hash、页/block spans | deterministic output create-or-identical；输入或 producer 变化产生新 revision |
| Cited Finding Set | mechanism/participants/regime/claim/falsifier/data-surface/limitations；每条 finding 指向 chunk/page/quote | identity 包含 canonical content hash；保留 model/prompt/input/run receipt；不同输出新 revision |
| Search Projection | 可检索文本、FTS/embedding config、projection hash、canonical locator | 完全可删除重建，不成为 source 或 finding 身份的一部分 |

`global summary` 不是首版核心合同。Designer 更需要结构化、可证伪且带限制条件的 findings；摘要可作为 UI/read model，但不能替代 finding-level citation。

### 3.3 引用合同

模型只允许返回 citation draft：

```json
{
  "chunk_position": 12,
  "page": 7,
  "quote": "exact substring"
}
```

代码负责：

1. 把 position 解析成 canonical chunk/member ID。
2. 验证 page 属于该 chunk 的 source span。
3. 验证 quote 是 canonical chunk text 的精确子串。
4. 校验 minimum citation、跨页覆盖和 finding/citation 关系。
5. 失败则整个 finding set 不入库；不保留“无引用但看起来合理”的降级版本。

## 4. 存储与身份决策

### 4.1 逻辑存储

不新增独立 `quantmind.db`。在 `data_catalog.db` 内增加由 `artifact-knowledge` 独占的 research-source logical tables；精确 DDL 在 P0 后冻结，最小关系为：

```text
research_source_revision
  -> research_source_asset
  -> research_knowledge_artifact
       -> research_knowledge_member
       -> research_knowledge_lineage
       -> research_search_projection   # P3 可选
```

现有通用 `artifact` 表继续表示文件 locator，不升级为 canonical source identity。两个身份通过 `artifact_ref` / owner ref 显式关联，避免一次全表迁移。

### 4.2 精确原文的 durable 落点

推荐 P1 采用“有上限的 SQLite BLOB”，作为 research source 的窄例外：

- exact source bytes 与 page image/embedded asset 只允许进入 research-source asset 表，不允许任意 report/CSV 借此进入 DB。
- intake 必须先做 size、media type、hash、malware/basic parser budget gate；具体 size cap 由 P0 用真实论文样本确定，不在本文拍值。
- 超限来源可以登记 external locator 与 hash，但状态必须是 `non_durable_source`，不得产出可长期引用 finding。
- 同 content hash 只存一份 BLOB；事务内写 source、asset、artifact、lineage。
- retention 以 source ref 为准；被 active proposal、hypothesis、experiment 或 lesson 引用时不可 GC。

理由：当前 `data/` 只允许 SQLite，`tmp/` 明确不是 durable；若不做这项窄例外，就无法同时满足精确引用与现有存储规则。落地时必须同步修订 `storage-architecture.md`、`data-hygiene.md`、catalog contract、DDL 与 architecture manifest，不能只改代码。

### 4.3 身份规则

本项目采用比 QuantMind 更严格的规则：

```text
source_revision_id = H(source_bytes)
chunk_set_id       = H(source_revision_id, producer_contract, canonical_members)
finding_set_id     = H(source_revision_id, input_artifact_refs, producer_receipt, canonical_findings)
projection_id      = H(canonical_locator, projection_config, projected_text_hash)
```

所有 hash 使用稳定 canonical JSON 规则并版本化。`put` 只有三种结果：created、identical、conflict；没有 silent update。模型温度、seed、model revision 不足以保证相同输出，因此 producer config 不能单独代表语义产物身份。

## 5. 进入 R&D 的方式

### 5.1 Query，不是自动写队列

Planner 在 `plan_next` 前可读取一个有界 `research_context`：

- active L3 canonical / return driver / data surfaces；
- `available_at <= planning_as_of`；
- source status、finding kind、limitations；
- top-N cited findings 与 canonical refs；
- 已关联的 hypothesis/experiment/lesson，避免重复研究。

artifact-knowledge 只返回命中与引用。Planner/Designer 仍决定是否形成 hypothesis；没有组件可以从论文直接写 `next_hypothesis_queue`。

### 5.2 Hypothesis contract 演进

当 P2 开始消费 findings 时，引入新 contract revision，并保留 v1 只读兼容。新增语义不是一个自由文本 `sources` 数组，而是：

```json
{
  "research_basis": {
    "basis_kind": "external_source | internal_lesson | mixed | original_hypothesis",
    "finding_refs": ["artifact-knowledge://research-finding/..."],
    "claim_bindings": [
      {
        "thesis_field": "mechanism",
        "finding_ref": "artifact-knowledge://research-finding/...",
        "citation_refs": ["artifact-knowledge://citation/..."]
      }
    ],
    "transfer_risks": ["paper market/timeframe differs from Binance USDM 4H+"]
  }
}
```

规则：

- 文献派生主张必须有 finding/citation binding。
- `original_hypothesis` 合法，但必须明确标记，不能伪装成有文献支撑。
- `research_basis` 进入 proposal hash、proposal revision、queue `design_contract` 与 KG ref，不得在 projection 时丢失。
- 文献中的参数、绩效与结论不直接进入 candidate params；designer 必须重新提出本项目内的 test、negative control、regime 与 falsification。
- source availability 只能约束知识可用时间，不替代 dataset point-in-time 与 holdout 隔离。

### 5.3 复用现有 Knowledge Graph

首版只增加必要投影关系，不建立通用图平台：

```text
research_finding --motivates--> hypothesis
research_finding --contradicts--> hypothesis
hypothesis       --tested_by--> experiment
experiment       --produces--> lesson
lesson           --supports_or_refutes--> hypothesis / canonical
```

edge evidence 指向 canonical finding ref 或 experiment result ref。来源可信度、实验强度与 reviewer decision 分开，不压成一个 confidence 分数。

## 6. 分阶段融合计划

### P0 — Contract 与可行性尖峰（已完成）

目标：先证明身份、引用、存储和运行时边界，再接 LLM。

- 选取少量真实 PDF，包括版本变化、多栏、表格、长文与异常文件；建立不含版权正文的 hash/span/citation golden fixtures。
- 定义 source/chunk/finding/citation/ref 的最小 shared contract 与 canonical hash policy。
- 比较隔离的 Python PDF adapter 与 Bun/原生 parser；只比较页/block fidelity、部署、失败语义和资源上限，不让 adapter 成为知识 owner。
- 用 owner CLI/stdin-stdout JSON 验证跨语言边界；TypeScript 不直接 import Python library，R&D 不 import catalog internals。
- 做 storage spike：BLOB 大小、事务、重复内容、备份、GC、损坏检测。
- 专门加入“同 producer、不同 model output”测试，要求新 revision 或 conflict，防止复刻 QuantMind 覆盖行为。

退出门：两个 parser 候选至少一个能稳定通过 golden citation round-trip；身份与 BLOB 决策获评审；否则停止，不进入 P1。实现证据与决策见 [research-source-p0-spike.md](./research-source-p0-spike.md)。

### P1 — Source-first intake

目标：在 artifact-knowledge 内完成 PDF → durable source → deterministic chunks。

- 扩展 catalog owner schema、register/resolve/query contract 与事务写入。
- 首批 source kind 只支持 local PDF 和 exact-version arXiv PDF；HTTP arbitrary page、DOI resolver、OCR 后置。
- parse/chunk 输出必须记录 producer build/config、页级 spans、content hashes 与明确 failure class。
- 增加 create-or-identical、partial-write rollback、corrupted BLOB、version coexistence、temporal filter、GC pin 测试。
- `catalog_hygiene_scan` 只报告 orphan/stale/non-durable，不自动删除被引用 source。

退出门：相同输入可幂等重放；不同 source revision 并存；任一 chunk 可回到精确 bytes/page；不接模型也能完整工作。

### P2 — Cited findings 接入 Designer

目标：让 empty queue 的上游多一个有来源的假说入口，但不改变实验与 promotion 权威。

- 实现 code-owned bounded map-reduce：模型只产 typed finding/citation drafts。
- finding schema 对齐现有 hypothesis lint：mechanism、participants、regime、falsifier、data surfaces、limitations、transfer risks。
- artifact-knowledge 提供 bounded structured query；先用 SQLite filters + FTS，不引入 embedding。
- 增加 hypothesis contract revision，确保 `research_basis` 贯穿 validate → queue item → proposal revision → KG projection。
- Planner 只在 active product scope 与 ready/可补足 data surface 内消费 finding；缺数据形成 data backlog，不消耗 strategy trial。
- Reviewer 明确显示 external rationale 与 empirical evidence 两条链。

退出门：任选一个 hypothesis 都能从 thesis field 回溯 finding → citation → chunk → page → source hash；删除/篡改任一环节会 fail closed；无文献 hypothesis 仍可显式运行。

### P3 — Retrieval projection（按证据启用）

触发条件：结构化过滤 + FTS 在真实 planner query 集上出现可复现召回缺口。

- 建立带期望 finding/citation 的 query benchmark，先测 recall@k、citation precision、latency、cost。
- embedding 只作为 rebuildable projection；provider/model/dimension/text projection 全部入 config hash。
- filter 必须先于 rank；时间、source status、product scope 不能靠向量相似度软约束。
- projection 丢失或模型切换不影响 canonical source/finding；可全量重建并校验 hash。

退出门：相对 FTS 有明确增益且没有 citation precision/temporal regression；否则保持 FTS。

### P4 — 既有周期内运维

目标：成熟后进入现有 J04/J06 projection，并可被后续长期 R&D Factory 作为一种上游工作类型消费；不新增第二套 scheduler。

- J04 只消费已 ready 的 bounded research context；source intake 失败不能破坏 R&D state。
- J06 做 source freshness、orphan projection、broken ref、retention/pin 与 storage budget 检查。
- 任何自动发现只产 intake candidate；网络获取、版权/许可、大小与 source kind 仍过 gate。
- 将 ingestion/model/search 成本与 strategy trial budget 分账，避免“读了很多论文”被误计为“做了很多实验”。
- MCP / Agent Host 只通过 artifact-knowledge owner surface 搜索 source / finding、解析 citation 和提交 intake candidate；不得拥有 PDF/finding authority、直写 catalog 或把自然语言检索结果直接塞进 RD state。
- 一个 Campaign 的 research budget 耗尽只终止该次来源探索；长期 Factory 可在新的明确问题、数据或预算到来后创建后续工作，不循环重搜相同材料。

## 7. 预期改动面

| 阶段 | 可能改动 | 不动 |
| --- | --- | --- |
| P0 | 新 shared contract/golden fixtures；融合文档；parser/storage spike | replay engine、execution、governance policy |
| P1 | `artifact-catalog`、`catalog-contract`、catalog DDL、storage docs、architecture manifest、owner tests | RD state 业务表 |
| P2 | hypothesis contract/designer/planner、proposal/queue preservation、KG ref projection、相关 contracts/tests | trial/result/review 的证据定义与 promotion gate |
| P3 | artifact-knowledge search projection 与 benchmark | canonical identity |
| P4 | 既有 J04/J06 job contract 的窄扩展 | 新 scheduler / 新全局 memory |

实际目录名与 tool 数量在对应阶段的 contract review 后确定；跨域调用必须继续经过 `apps/contracts/*`、owner CLI 或 protocol ref，并通过 TypeScript tool-boundary check。

## 8. 验收不变量

1. **Source**：每个长期 citation 都能解析到 durable exact bytes hash；`tmp/` 丢失不影响解释。
2. **Citation**：模型不能提交不存在的 page/chunk/quote；引用失败整组拒绝。
3. **Identity**：同 ID 不允许不同 canonical content；所有 semantic revisions append-only。
4. **Atomicity**：source、asset、artifact、lineage 不产生半提交。
5. **Temporal**：query 支持 `available_at <= as_of`；后见论文不能进入更早 planning context。
6. **Authority**：artifact-knowledge 不写 hypothesis/queue；literature 不写 experiment result/promotion。
7. **Boundary**：R&D 不直读 `data_catalog.db`；parser 不成为 store owner；无第二套 graph/library DB。
8. **Rebuildability**：FTS/embedding projection 可删除重建，canonical hash 不变。
9. **Compatibility**：v1 hypothesis 可读；只有新 revision 承诺 `research_basis` 不丢失。
10. **Scope**：外部材料必须经过 Binance USDM `4H+ swing` transfer-risk 判断，不能把论文市场直接等同目标市场。

## 9. 风险与止损

| 风险 | 早期信号 | 止损动作 |
| --- | --- | --- |
| PDF parsing 不稳定 | page/quote round-trip 频繁失败 | 限定 supported PDF class；不降级成无页引用摘要 |
| DB 膨胀 | BLOB/asset 增长快于有效 findings | source size/budget gate、去重、只 pin 被引用来源；重评外部 blob store，不扩大 tmp 语义 |
| LLM 摘要幻觉 | citation 合法但主张超出 quote | finding-claim entailment review + multi-citation/limitation contract；不以摘要作 authority |
| 研究确认偏误 | Planner 只检索支持材料 | query 同时要求 support/contradict/limitation；negative controls 保持强制 |
| 运行时复杂化 | Python 环境进入核心 build/CI | adapter 隔离为 owner 子进程；若部署成本不合格，换 parser，不改 canonical contract |
| 文献替代实验 | proposal/promotion 展示混淆两类证据 | UI/contract 分离 `research_basis` 与 `evidence_plan/result refs`；gate 拒绝仅有来源依据的候选 |
| 过早做向量库 | 没 benchmark 就增加 provider/维度/费用 | P3 触发门；FTS 足够则永不启用 embedding |

## 10. 推荐执行顺序

当前只批准 P0 最合适。P0 是一项独立、可回滚的 contract spike，不触碰当前正在演进的 replay execution plane。

P0 评审需要给出四个明确答案：

1. canonical source/chunk/finding/citation 的最小合同与 hash policy 是否成立；
2. 哪个 parser adapter 能通过 page/quote golden fixtures；
3. bounded SQLite BLOB 是否满足容量、备份和损坏恢复要求；
4. `research_basis` 进入 hypothesis contract 的最小演进路径是否保持 v1 兼容。

四项全过后再实施 P1；P1 完成后才允许 P2 调用 LLM。这样吸收 QuantMind 最有价值的 provenance discipline，同时保住本项目已经建立的 owner、trial、holdout、review 与 promotion 边界。
