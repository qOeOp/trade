# 市场数据接入指南

本指南把 credential 或公开 endpoint 转成有界且可检验的 Market Data 接入。它是操作与开发指南，
不是第二个 Data Engine、source registry、scheduler 或业务权威。Market Data 仍然独占规范观测、标的
语义、PIT 可得性、修订谱系和数据权利处置。

## 与研究来源的边界

[研究来源接入指南](./source-intake/)把论文、文档、评论与数据集接纳为惰性的 R&D 来源材料；本指南
接纳研究重放、受保护评估、Scanner、Runtime 或 Portfolio 实际消费的观测。

- API 文档和序列说明属于 Research Source Intake 材料。
- 某个日期的价格、宏观 vintage、申报事实、日历事件或标的状态属于 Market Data 事实。
- credential 只证明 principal 可以尝试认证，不证明 connector 支持、license 或保留权、PIT 正确性、
  覆盖度或回测适用性。

## 准入顺序

所有 provider 都使用同一条 fail-closed 顺序：

`Credential/config → Source Binding → rights decision → semantics profile → read-only probe → PIT fixture → canonical snapshot → consumer receipt`

1. 把 provider 与 dataset 解析到一个不可变 Market Data Source Binding，绑定实现与配置摘要、endpoint、
   vendor tenant 或 data entitlement、不透明 credential handle 与 audience、信任政策、license 与再分发
   范围和 Time Evidence。vendor tenant 不是 Execution account。
2. 在保留字节前决定 acquisition、本地 cache、archive、衍生数据、backtest、model use、display、
   redistribution、retention 与 deletion 权利。权利未知产生 Market Data
   `RIGHTS_EVIDENCE_UNRESOLVED` 与 Source Binding `UNAVAILABLE`，不能尽力摄取。
   `TERMS_OR_LICENSE_BLOCKED` 仍只属于 R&D Source Intake 终态，不能跨 Owner 复制。
3. 冻结一个 Market Semantics Compatibility 身份，覆盖 normalization、adjustment、timestamp meaning、
   instrument mapping、calendar/session 规则、修订行为和历史/实时等价性。
4. 执行最小只读 metadata 或 entitlement probe。即使同一个 provider SDK 暴露两类能力，Market Data
   credential capability 也不得调用 private trading、account、order 或 effect 方法。
5. 验证包含已知 timestamp、missingness、correction、instrument lifecycle 与 license metadata 的有界
   fixture。可达性本身永不准入 source。
6. 只有前述 gate 全部通过后才能物化 request-correlated PIT Market Snapshot 或 live fact。提交、
   transport acknowledgement、silence 或旧 snapshot 都不是观测。
7. health 与 fact 分开记录。认证、配额、staleness 与 outage 可以解释不可用，但不能制造空或零值数据集。

## 必需 source profile

每个已准入 provider 或 dataset profile 至少记录：

| 领域        | 必需 binding                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Identity    | provider、endpoint、dataset/feed、配置摘要、vendor tenant/entitlement、connector version                               |
| Capability  | 只允许 public market/reference 方法；明确拒绝 account、order、trading 和 private‑effect 方法                           |
| Rights      | acquisition、cache、archive、derived output、backtest、model use、display、redistribution、retention 与 deletion basis |
| Time        | event、provider‑available、retrieval、correction‑publication time，以及 clock epoch、decision cut 与 uncertainty       |
| Meaning     | raw/adjusted basis、价格与数量单位、timestamp 解释、bar 构造、corporate action 与 revision policy                      |
| Instruments | 规范身份、venue mapping、currency、tick/contract term、session、time zone、lifecycle 与历史 membership                 |
| Quality     | coverage、gap、duplicate、ordering、适用时的 sequence/checksum、latency、stale threshold 与 terminal disposition       |
| Lineage     | raw digest、normalized digest、source frontier、transformation version、correction predecessor/successor identity      |

Profile 按 dataset 区分。同一 provider 的不同 series 或 feed 可能拥有不同权利、时钟、覆盖与终态，
不能压缩成 provider 级承诺。

## Credential 与能力隔离

配置 client 前先读[凭证前置矩阵](./install/#credential-prerequisite-matrix)。secret 只保留在被忽略的本地
环境，并且只以 opaque handle 进入 binding。它们不能出现在 log、prompt、snapshot、artifact、截图、
文档或审计包中。

Market Data 与 Execution credential audience 永不别名。组合型 exchange SDK 必须暴露分离的 typed
port：Market Data port 只读，不能调用 balance、order、fill、account mutation 或 private trading stream；
Execution port 不能成为历史市场事实来源。rotation 或 audience 改变创建 successor binding，不能改写旧回执。

## PIT 与修订证明

只有 consumer 能证明某历史值在请求 decision cut 已可观察时，该值才可准入。event time 本身不足。
Snapshot 必须绑定四种时间、共享 clock 与 uncertainty、calendar/session version、Instrument Master 与
Universe Selection Record version、source/license frontier 和 correction lineage。

后续 revision 创建 successor fact，永不改写旧 Research Intent、replay、Qualification result 或 deployed
generation。后续 correction 只能通过显式 successor-feedback 路径进入 R&D，并启动新的有界 lineage；
它不能追溯修复旧 decision。

## 初始 provider 处置

以下是有界候选，不是实现承诺：

| 候选                                  | 初始处置                                             | 准入前必需证明                                                                                                 |
| ------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 现有原生 data adapters 与 Data Engine | 优先通过 Market Data 适配                            | typed read‑only port、semantics parity、PIT/correction fixture、source‑specific rights                         |
| Databento                             | 可选 current adapter                                 | entitlement、dataset‑specific license/retention、timestamp/symbology mapping、PIT fixture                      |
| Binance public data                   | 可选 current adapter                                 | public‑data‑only capability、venue clock/symbol lifecycle、sequence/gap 处理、archive rights                   |
| FRED/ALFRED                           | archive 或 backtest 使用前为 `LEGAL_REVIEW_REQUIRED` | series‑specific rights、vintage availability、retention/software‑use decision、禁止 current‑value substitution |
| Kaggle dataset                        | 仅候选                                               | immutable dataset version、上游 provenance、license compatibility、survivorship 与 PIT proof                   |
| OpenBB                                | 选择性外部候选                                       | 只能作为 Data Clients 后的 provider fetcher，不能引入第二套 router、Data Engine、registry 或 business cache    |
| CCXT 或 CCXT Pro                      | 已覆盖 venue 默认不采用                              | 只处理已证实缺失的 public‑data endpoint；private API、scheduler、cache 与 reconnect 行为封装在 adapter 内      |
| Cryptofeed                            | 已覆盖 feed 默认不采用                               | 只处理更优且缺失的 public feed；排除其 storage、message backend 与 authenticated trading capability            |

本地配置的 `FRED_API_KEY` 已通过 authentication-only metadata probe。这既不建立当前产品 connector，也
不授予 archive、训练或 backtest 所有 FRED series 的权利。在上述 rights 与 vintage gate 通过前，
Market Data Source Binding 保持 `UNAVAILABLE` 与 `RIGHTS_EVIDENCE_UNRESOLVED`；只有明确拒绝才能成为
`UNLICENSED`。

## 确定性准入处置

一次来源评估保留每个独立支持的 rights、identity/configuration、semantics、availability 与证据新鲜度
失败。冻结优先级选择唯一 primary category 与状态，因此证据到达顺序不能改变结果。只有 failure set
为空且当前证据完整时才能 `ADMITTED`。rights decision、endpoint、configuration、semantics profile 或
evidence frontier 变化时创建后继 Source Binding，不能改写前驱。

Snapshot disposition 是另一层确定性映射。来源 `REVOKED` 或 `UNLICENSED` 产生 snapshot
`UNLICENSED`，`INCOMPATIBLE` 产生 `AMBIGUOUS`，来源 `UNAVAILABLE` 产生 snapshot `UNAVAILABLE`。
多个 snapshot blocker 并存时保留完整集合，并按 `UNLICENSED`、`AMBIGUOUS`、`STALE`、
`INSUFFICIENT`、`UNAVAILABLE` 选择 primary。来源 `ADMITTED` 只允许继续评估 snapshot，绝不保证
`AVAILABLE`。

## Request 与终态行为

R&D 与 Scanner 决定请求什么，Market Data 决定返回数据的含义。Backtest 消费已冻结 snapshot 并记录
实际使用，但不选择 provider。Portfolio 消费 valuation fact，只有 Execution 拥有 private account、
order、fill 与 readback fact。

普通 snapshot 终结为 `AVAILABLE`、`INSUFFICIENT`、`STALE`、`UNLICENSED`、`AMBIGUOUS` 或
`UNAVAILABLE`。Repair request 还绑定准确 predecessor decision、request proof 与 stable correlation。
错误 scope、变化 cut、陈旧 license、缺失 Time Evidence、silence、rate limit 或 transport success 都不能
变成 `AVAILABLE`。准确 replay 加入同一终态；含义变化需要 successor request。

## 开发验收

- Connector 可以被关闭或删除，而不改变 Data Engine、PIT Catalog、Instrument Master 或 Owner 权威。
- 每个 credential capability 都是 least-privilege、audience-bound、opaque，且不与 Execution 别名。
- Rights 测试覆盖 cache、archive、backtest、derived output、display、redistribution、retention drift 与 deletion。
- PIT 测试拒绝 current-value substitution、event-time-only evidence、未来 correction、mixed clock 与缺失 historical membership。
- Semantics fixture 证明历史与实时 normalization、adjustment、instrument mapping 与 timestamp meaning 完全一致。
- Quality 测试区分 empty、missing、stale、rate-limited、malformed、unlicensed 与 unavailable outcome。
- Request 测试证明 R&D 与 Scanner 响应重复准确 requester-owned request 与 stable correlation。
- Correction 测试保留旧回执，只创建 successor fact 和 successor-only R&D provenance。
- 任何 Market Data 路径都不能调用 account、order、private-effect、Governance、Qualification 或 trading-authority port。
