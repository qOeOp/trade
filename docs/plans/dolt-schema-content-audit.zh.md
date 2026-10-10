# 保留 Dolt 五表，补齐多轮研究的决策链

本文保留固定快照的审计事实与当时建议。后续代码改良、独立字段审阅和验收状态见[Agent 契约改良](dolt-agent-contract-improvements.zh.md)，不得把本文旧客户端状态当作修复后的现状。

**当前设计值得保留，主要改进应落在领域合同与检索，而不是拆出更多表。** 五表已具备固定 revision 关系、真实外键、事务发表、并发版本守卫和持久幂等回执；实际存量未发现关系孤儿、revision 断档或所检原文字节损坏。负结果、来源更正和显式知识接受也已经真实存在。它可以作为多轮策略 R&D 的基础，但目前不能完整、低成本地回答“同一发现试过多少候选、看过哪些窗口、这次决定依据哪对运行、后来哪些证据被修正”。更紧迫的是，当前工作树客户端只认识 runtime v1，共享账本已有 v2，已使读取无关旧记录失败。建议先修兼容性，再补少量固定引用与读取语义；无需引入研究调度器、图数据库或新的交易账本。

## 区分全量快照与定向样本，评估下一轮 Agent 能否可信地接续研究

审计日期为 **2026-10-09**。全量内容基准为 Dolt `2.4.2`、数据库 `research_records`、`main@kh38b58u9c1lpqprnbok70p9kqpgn2e1`；除明确标注的补充样本外，下文记录引用和全量统计均固定于该 commit。代码基准为 Git `e34d521cf00c71f73bedb5939e144d7bb06451a2`。采集前后 HEAD 一致、`dolt_status` 为空，working 与 committed 行数一致。本轮读取 live DDL、全量对象/关系/操作，离线检查内容，执行真实只读 CLI，并用不连接 live DB 的内存探针检查领域漏洞；没有改数据库、代码或研究记录。

同日吸收平行评审，定向复核其指定快照 **`55u8ku498br5gv28dbpet3mt4tfi355f`**（write version=63）。Dolt log 确认它是原全量快照的祖先，不能混用两份数量与状态。补充采集时实际 main HEAD 为 `08c6d7j69pdbi9iim9ugjg7if2epo20b`，首尾一致且 clean；本报告没有对该 HEAD 重做全量审计。下文补充检索、brief 与 D98 证据事实均限定于 `55u8…`。

评审标准是可查询的研究延续能力。COS 要求区分事前计划与探索，并披露既有数据访问；DSR/PBO 原论文解释了多次尝试、只报告胜者和已知历史带来的选择偏差。这支持本项目保留试验家族、负结果与暴露历史，**不意味着每轮必须自动计算某个统计指标或套用统一通过阈值**。([COS](https://www.cos.io/initiatives/prereg)、[DSR 原论文](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)、[PBO 原论文](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf))

MLflow 的 run/input/artifact 分离和 W3C PROV 的固定实体、使用、派生、修订概念，支持把决策接到精确来源和输出；这是对本项目的设计推论，并不要求引入它们的产品或完整模型。时间窗口、标的宇宙、初始资本与净成本口径也必须支持合法比较；现行成分回看历史和数据自身前视不能仅靠事件时钟消除，其他市场的成本研究不能直接充当币安永续参数。([MLflow Tracking](https://www.mlflow.org/docs/latest/tracking/)、[Dataset Tracking](https://mlflow.org/docs/latest/dataset/)、[W3C PROV-DM](https://www.w3.org/TR/prov-dm/)、[QuantConnect](https://www.quantconnect.com/docs/v2/writing-algorithms/live-trading/reconciliation)、[AQR](https://www.aqr.com/insights/research/working-paper/trading-costs))

## 五表和固定关系已守住结构完整性，JSON 不是当前主要问题

live DDL 与 [dolt_store.py:118](../../research/records/dolt_store.py#L118) 一致。最关键的跨对象约束已经进入 SQL：`relations` 两端均以 `(id,revision,kind)` 外键指向 `objects`，并有端点索引。JSON 留给不同领域 DTO 的可变细节；不应把它描述成缺外键的任意文档集合。

| 表 | 行数 | 职责与实际约束 |
| --- | ---: | --- |
| `objects` | 2941 | 完整对象及 revision；PK `(id,revision)`、typed unique、正 revision、非空 JSON |
| `relations` | 4621 | 固定 typed revision 间的关系；两端 FK、关系 ID 主键、正 revision |
| `operations` | 76 | 规范载荷 hash 与发表回执；operation ID 和 native message 唯一 |
| `write_head` | 1 | 全局发表序号 76；条件更新与事务冲突拒绝并发旧版本写入 |
| `record_store_schema` | 1 | 物理 schema version=1、Dolt version=2.4.2；不代表领域合同都为 v1 |

| 对象类型 | revision 行 | 逻辑对象／latest |
| --- | ---: | ---: |
| reference | 1266 | 1266 |
| material_section | 780 | 754 |
| review_decision | 572 | 572 |
| material | 79 | 78 |
| publication | 73 | 73 |
| attempt | 63 | 29 |
| evidence_json | 48 | 48 |
| strategy | 27 | 26 |
| run | 24 | 24 |
| retention_decision | 6 | 5 |
| component / inventory / media_identity | 各 1 | 各 1 |
| **总计** | **2941** | **2878** |

全量检查得到：typed endpoint 孤儿、重复主键、kind 变更、revision gap、重复语义边、同 revision 自引用边均为 **0**；现存 attempt/strategy lineage 未发现环。29 个 latest attempt 的父 DTO 与固定关系一致，24 个 run 的 attempt/control 均存在；37 行 v2 attempt revision 的冻结合同没有变化。76 个 operation 的序号恰为 1..76，各自对应唯一 Dolt commit。材料、片段、策略及所保留原始 JSON 的 bytes/hash 检查无异常，27 份策略源均为有效 UTF-8/Python 且声明入口唯一；只解析源码，未执行策略。

发表 API 冻结旧对象内容，统一提交对象、关系和 operation，异常回滚；同 operation 同载荷可恢复原 commit，不同载荷拒绝。固定历史读取统一使用 exact commit。([dolt_store.py:341](../../research/records/dolt_store.py#L341)、[dolt_store.py:391](../../research/records/dolt_store.py#L391)、[store.py:62](../../research/records/store.py#L62)) 维护中的原生测试覆盖并发、FK 失败回滚和回执恢复，但本轮严格只读，未重跑会写 disposable DB 的集成测试。append-only 是发表 API 的保证，不是管理员不能执行 SQL、amend/reset 的保证。Dolt 官方隔离级别描述存在冲突，本轮不据此宣称已验证某个隔离级别。([Dolt Procedures](https://www.dolthub.com/docs/sql-reference/version-control/dolt-sql-procedures/)、[Transactions](https://www.dolthub.com/docs/concepts/dolt/sql/transaction/)、[Concurrency](https://www.dolthub.com/blog/2026-02-17-dolt-concurrency/))

## 真实内容保留了失败和边界，但事前登记仍不等于独立验证

29 个 latest attempt 中，20 个 retrospective、9 个 preregistered；9/9 首 revision 为 pending/pending，且存在真实初次发表回执。latest outcome 为 19 failed、8 passed、1 inconclusive、1 pending；8 个 passed 中 **7 个是 execution、1 个是 source，没有 economics passed**。24 个 run 全部标为 `development_exposed`，未注册 independent run，因此不能从这份库证明未暴露 holdout 的独立性。

| 固定记录 | 内容质量及延续价值 |
| --- | --- |
| `attempt:D96@2`、`D97@2` | 保留 economics failed、门槛、限制与下一动作；指示性损益分别为 -9560.36/-4089.74 USDT，明确不是新 native replay，禁止针对 exposed year 调参 |
| `attempt:H18a@2`、`H15a@2` | 保留配对失败与区间跨零；H18a 对 H08 的组件复用明确不继承其失败入场假设。已准入的 `component:ConfirmedLineSupportTouches@1` 只在其固定来源与 scope 内复用，不把组件推广成来源策略或新策略的经济有效性 |
| `attempt:F01@2` | 四格 family 固定 H15a/H19a/H18a 和 F01-00/10/01/11；run/control 存在且比较合同一致，保留年化 11.40%、差中差 -1324 USDT、跨零区间和失败 |
| `attempt:D102@3` | 保留容量诊断失败，不能据此推断成交或收益；固定 inputs、源码 hash、recipe/proof 绑定已核对，recipe/verification 文件 hash 匹配，本轮未重新构建 |
| `attempt:D104@2`、D105 系列、`D106@1` | D104 withdraw/inconclusive 后另立 D105，没有改写原意图；D105 是代表性 native 工程演示，D106 是 pending audit repair，不构成策略资格 |
| `C02@2`、`S46@1`（补充 `55u8…` 样本） | 两个知识入口共享来源更正事件和固定证据，不是两次独立验证；来源解释被修正，不撤销 H27a 已保留的经济失败 |

原文 custody 与知识接受已有真实分层：572 个 review occurrence 全 resolved，560 为 verified_reference、12 为 agent_review；导入时的 427 个 `unresolved_local_link` 类别保留原状，后续 review 有独立修复边，不能将其直接数作仍失效链接。5 个 latest retention decision 都为 knowledge，4 个指向当前 target revision，1 个保留 D102 旧 target 的历史接受；claim 嵌于 retention body，**`claim` kind=0 不代表没有知识**。真实 `material search D96/H18a/C02` 找到负结果、复用边界和更正；S47 未命中，只说明本快照不是完整实时文档镜像。([retention.py:37](https://github.com/qOeOp/trade/blob/9794ed307/research/records/retention.py#L37)、[retrieval.py:269](https://github.com/qOeOp/trade/blob/9794ed307/research/records/retrieval.py#L269))

24 个 run 中有 **8 个新 Dolt/OCI sealed、1 个 legacy sealed、15 个 legacy temporary**。8/8 新 OCI run 的 source/strategy revision、image、platform、config 身份齐备，6 个唯一 strategy binding 均在其 exact source commit 回读匹配。16 个 legacy run 中 8 个无 `source_revision`，保留了历史 hash 与降级标签，不应混作新执行身份。9 个 sealed run 所引用的 27 个 manifest/summary/audit 小文件实际存在且 hash 一致；retention recipe/verification 的 2 个独立文件也一致。没有验证大型订单/成交 CSV、OCI 实体、全部 Catalog、备份或异机恢复，更没有重放。OCI digest 标识内容，恢复仍须可访问 blob、源码和 canonical inputs；报告 hash 匹配不能代替恢复证明。([OCI Descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md)、[OCI Layout](https://github.com/opencontainers/image-spec/blob/main/image-layout.md))

补充快照显示，按研究概念查找仍有明显语言和用途差异：`support` 返回 9 项，其中 7 项为工程迁移/框架演示；`支撑` 返回 8 项，包含 D96/D97/D98/H25a 等诊断或假设研究，两组只共同命中 H08。它们都标为 research_decision，并未冒充 admitted knowledge；问题是相关性与概念召回，不能以精准 ID 能找到记录来否定，也不能将这两个样本当作通用召回率基准。H25a 的特定 summary `material show --brief` 输出 **2,038,990 UTF-8 bytes**，仍包含 37 标的的嵌套事件数组，这是当前 Agent 阅读成本，不能只归为未来规模问题。([retrieval.py:257](https://github.com/qOeOp/trade/blob/9794ed307/research/records/retrieval.py#L257)、[ledger.py:160](../../research/records/ledger.py#L160))

同一补充快照有 95 条 relation body 携带 raw base64，完整 body 合计 1,140,510 bytes；该数包含其他 metadata，不能视为可全部节省容量。D98 的一条 evidence edge 重复保存了与 `attempt:D98@1` 相同的 original registration。D98 两个 reference 只声明 path/hash，未直接显示核验状态，但在固定 Git `44e229331fdc7d9b78e234079673b8df71faefc4` 读取的 2195/101263 bytes 均与声明 hash 一致，**不是证据丢失**。C02@2 和 S46@1 的两条 admission 精确交叉引用同组更正证据，应看作同一来源更正在两个目标上的表达，不是两次独立验证；不能泛化成按标题相似自动合并。

## 八项改进优先修可用性和决策依据，保持现有五表

下表同时作为研究工作台 product findings。影响范围包括实际阻断与尚未发生的风险，明确区分；迭代时间均未测量，不以估算冒充成本证据。

| 优先级、事实与影响 | 受影响记录／Agent 任务 | 已知成本及当前绕行 | 最小共享能力 |
| --- | --- | --- | --- |
| **P0 合同兼容**：53 个 latest attempt/run 中 12 个含 v2 而当前 validator 只支持 v1；`show D96 --brief` 实际 exit 2，D96 自身合法却被全库校验阻断。这是客户端/live 漂移，不能宣判 v2 坏数据。([store.py:62](../../research/records/store.py#L62)、[attempt schema:131](../../research/records/schemas/attempt.schema.json#L131)) | D96、D105-01..05、D106 及六个 D105 run；读取旧证据与新轮登记 | 正常 show/find 失败；时间未测。只读 exact SQL 可定位内容，不能替代正常领域入口 | 先扩展 reader 并通过活跃 consumer 的合同探针，再开启共享 writer；目标读取只验证相关闭包，未知相关合同继续拒绝。新 schema/synthetic demo 试写隔离库；保留真实已登记工程运行，明确其用途；历史合同不改写 |
| **P1 研究概念召回**：`55u8…` 上 support/支撑的 9/8 项结果仅共同命中 H08；英文结果多由工程 plan 的变体标签命中。当前是子串匹配与字典序，缺受审中英机制映射和用途过滤。([retrieval.py:16](https://github.com/qOeOp/trade/blob/9794ed307/research/records/retrieval.py#L16)、[retrieval.py:257](https://github.com/qOeOp/trade/blob/9794ed307/research/records/retrieval.py#L257)) | D96/D97/D98/H25a/H26a、H18a 组件；按机制找负结果、来源边界 | 需换语种或先知道 ID；时间未测。多关键词加 exact ID 手工核查 | 由现有 admission、layer/outcome、role 派生 facets；purpose 不明确时标 unknown，必要时补受审小字段。少量 reviewed aliases 绑定机制与审查依据，返回 matched field/token/alias reason；精确 ID 优先，完成的 failed/inconclusive 不被隐藏，不先上 embedding/ontology |
| **P1 试验家族与暴露**：事前 contract 主要是 scope/plan 字符串，selection family、候选全集、已见结果/window、primary response、run budget/停止条件不能稳定查询。D104/D105 还把大型 JSON 塞入 plan。([attempt schema:77](../../research/records/schemas/attempt.schema.json#L77)、[README:279](../../research/records/README.md#L279)) | D96/D97、F01、D104/D105/D106；下一轮枚举尝试、判断窗口是否已暴露 | 需重读 prose；时间未测。F01 四格与 Agent 手工 family 审查可作局部绕行 | 在现有 frozen attempt 增加小型 typed selection/exposure 段及 family 查询；保留方法 prose，历史未知不补写成事前事实；不增加 workflow/统计引擎 |
| **P1 决策的精确依据**：decision 没有一般性的 exact run/control basis；run_of 指向初始 attempt，show 展示所有 runs，不能区分决策依据与后续诊断。已有 compare 守卫不是决策绑定。([store.py:275](../../research/records/store.py#L275)、[cli.py:407](../../research/records/cli.py#L407)) | 多 run attempt、D103/D105 与未来同假设多窗口任务；重建保留/放弃的依据 | 手工寻找合法 pair；时间未测。可用现有 compare 核查指定运行 | decision 内固定 `{id,revision}` candidate/control basis，由既有 relations 表生成边；展示 basis 与 all_runs。经济决定绑定合法比较或明确 descriptive 范围，指标继续读原生报告 |
| **P1 更正与待修复提示**：读取显式处理 corrects，写入还支持 narrows/refutes；后两者内存探针无返回，live 尚无此类边。C02 更正未提示 H27a 当前查询；D106 pending repair 未突出显示六个 D105 passed audit 正待重审。([reviews.py:335](https://github.com/qOeOp/trade/blob/9794ed307/research/records/reviews.py#L335)、[retrieval.py:139](https://github.com/qOeOp/trade/blob/9794ed307/research/records/retrieval.py#L139)) | H27a/D94/D95 来源解释；D105/D106 审计保证；C02/S46 更正复用 | 需额外查 repair/prose；时间未测。手工核对 fixed review/source | 统一展示三类 effect/scope 和 incoming repair；有界列 potentially affected，交给 Agent 复核。复用 review identity 或受审 event binding 提示共享证据，避免 C02/S46 两个入口被当独立验证；不按文本自动合并，不自动撤销下游经济失败 |
| **P2 廉价领域不变量**：真实 publication 的内存适配器可发表 self-parent，之后 lineage 读报环；后续 decision 缺 pending layer/outcome 联动守卫。live 自环、重复父与 pending 矛盾均为 0。([contracts.py:6](../../research/records/contracts.py#L6)、[store.py:207](../../research/records/store.py#L207)) | 目前无已确认受损 attempt；未来录入/修复任务 | 风险探针，非 live 污染；时间未测。发表前人工核对 | 在领域 port 拒 self/重复 refs、自我 control 和固定 revision DAG 环；pending 两字段同时成立。按 revision 校验，避免把合法历史链误作 identity 环；无需新表 |
| **P2 typed evidence 与访问状态**：attempt evidence 只记 path/hash；D98 fixed Git bytes 可核验而 material DTO 仍只是 declared ref，关系又携原登记副本。([store.py:261](../../research/records/store.py#L261)、[cli.py:24](../../research/records/cli.py#L24)) | D98、completed decision、外置证据；辨别声明、核验及不可用状态 | D98 两个 brief 各约 27 KB，需另读 history 核验；时间未测 | 复用 fixed object refs；只读 resolution view 给 declared/verified/unavailable、fixed location 与 proof。新关系只保存必要 hash/proof ref，原文 owner 保留 bytes；历史去重须先验证重建，不能删除 custody。artifact root 显式私有配置 |
| **P1 摘要成本／P2 SQL 规模**：H25a 特定 evidence brief 约 2 MB，事件数组未裁剪；原快照 D96 search 的 SQL 载荷约 5.26 MB、单次约 0.14 秒。前者是当前阅读成本，后者尚非性能故障。([ledger.py:160](../../research/records/ledger.py#L160)、[dolt_store.py:250](../../research/records/dolt_store.py#L250)) | H25a evidence、D96/D97 检索与深 lineage；获取紧凑依据 | 输出 bytes 已测，迭代时间未测。手工从 full JSON 取摘要 | brief 改为 allowlist 合同，输出身份、decision/scope、证据状态、run/control、更正摘要和展开 refs，设 bytes/关系数界限并明示截断；必要 summary 内容从源对象按 ref 读取。SQL scoped metadata 读取用现有索引，实测后再决定投影/新索引；不删事件原文 |

应以真实研究任务验收这些改进，而不是以对象数、队列 resolved 百分比或统一评分代替价值。知识 admission/retention 仍需 Agent 判断：若删去一项会导致重复失败实验或错误复用，应保留其结论、范围与证据；不能自动把全部 failed 变成 knowledge。以下任务使用平行评审指定快照，可复现当前基线；改进验收要求基于固定答案，评估答案须与被测 Agent 隔离。

推荐复现的共同命令前缀为 `uv run --frozen python -m research.records.cli --at 55u8ku498br5gv28dbpet3mt4tfi355f`，下表列出其后的子命令。上述实测使用同工作树的 `.venv/bin/python -m research.records.cli`，没有因推荐命令形式变更重新运行。

| 研究任务与基线命令 | 接受条件 |
| --- | --- |
| 避免重复失败方向：`material search support` 与 `material search 支撑` | 在“价格支撑”等已审机制概念和研究 purpose 筛选下，中英文入口找到相同相关负结果集合并给 match reason；不要求 support 所有多义用法都等同“支撑”。D96/D97 的诊断范围和 H25a/H26a 的失败限制可见，工程演示可显式筛选，不能当作经济验证 |
| 识别撤回：`material show attempt:D104 --revision 2 --brief` | 明示 inconclusive/withdraw 原因与后续 D105 的关系，读者不把撤回样本当作支持或把新意图回填旧合同 |
| 复用组件：`material search H18a`、`material search C02` | 显示组件复用的 scope，不继承 H08 的失败入场规则；C02/S46 共享来源更正，H27a 经济失败保留，不被双计作独立验证 |
| 读取旧证据：`material show evidence_json:research/r1_native/results/2026-10-08-h25a-37-summary.json --revision 1 --brief`；`material show reference:b03251abd0d1a22a576fd917135aaf27db26c2041b4925d18f09483b6d551d04 --revision 1 --brief` | H25a 摘要无需携带事件数组即可理解范围与关键结果，并提供 exact 展开 ref；D98 positions reference 显示 fixed Git/hash 核验状态，保持 legacy 身份，不被升级为新 native run |

D98 可复核来源为 `research/records/history.json` 所指 Git `44e229331fdc7d9b78e234079673b8df71faefc4` 的 `research/r1_native/results/2026-10-09-d98-h26a-local-support.json` 和 `…-positions.json`；两者 SHA-256 分别为 `b7f10f18134bb924d059651f586264e0f278624b1cbf9df842d131f17fe2f46f`、`8e1757a347dd9109a608862c2eaf4678c0d2b639942a5e4b2003faf7ef8a6391`。重复登记样本固定 edge 为 `edge:025352bf8a4575fd10b7cac51f25aafcbd1233fed4d6d7885f528ecd4c1bc147`；C02 更正固定 relation 为 `relation:38d32a45ecc1fd1e8f1acf9c369da397de4d98f899a60a116ba58cc524222d0b`，review 为 `review:a66de3768dd370e1014e8b64bb1d4584632bab5adec7709921be9095a117cb4e@1`。这些身份可定位补充事实，不依赖临时 notes 才能理解结论。

## 字段说明和校验反馈也属于面向 Agent 的产品契约

后续修复应将契约说明、校验拒绝和纠错反馈一起设计。Agent 能在使用时发现字段含义、固定引用要求和允许的状态；提交不满足条件时，产品返回本次缺口、研究上的原因与可执行的补齐方式。反馈能补充当前任务所需上下文，促使 Agent 查证据、完成审阅或修正声明范围；Dolt 守住存储约束，现有领域接口负责表达研究含义，无需数据库内置 LLM 或另建流程引擎。[Anthropic 的工具设计实践](https://www.anthropic.com/engineering/writing-tools-for-agents) 也建议输入校验失败时返回具体、可行动的改进说明。

当前 `RecordError` 没有结构化字段，`validate_record` 只返回首个 schema 错误的路径和文案，CLI 将其交给 `parser.error`。([common.py:14](../../research/records/common.py#L14)、[store.py:46](../../research/records/store.py#L46)、[cli.py:639](../../research/records/cli.py#L639)) 建议在既有接口提供简短、稳定的错误契约：`code`、`path`、`expected`、`reason`、`next_actions`、`write_status` 与 `contract_version`。字段说明、校验条件和错误建议随同一领域契约版本维护；可提供只读契约发现和不发表数据的预检，减少盲目重试。底层异常仍保留诊断用途，反馈中引用的材料正文保持来源标记，不作为产品指令。

例如，未来补齐决策 basis 校验后，错误应表达：**当前经济决策缺少固定 candidate/control run 依据，无法核对比较口径；本次未发表。请查询相关运行并核对窗口、账户与成本，再提交固定引用；若证据尚不完整，保留待审解释。** 这是一项拟议的领域反馈，不是当前已实现的错误码。写入状态须来自实际事务结果；提交结果不确定时，引导用 operation receipt 确认，不能一律声明未写入或要求盲目重复发表。

错误应引导补齐真实依据，允许证据不足或无法完成时停止准入。不能仅要求补写一段价值说明，不能建议改哈希、改门槛或编造未知信息以通过检查；自由解释的科学价值仍需审阅。

增加一项交互验收：在未预先提供专用工作流提示、保留正常契约发现入口的独立 Claude/Codex 会话中，触发缺少固定证据、失效审阅引用和版本不兼容等已定义拒绝。检查 Agent 是否依据反馈完成必要查询或操作、正确重试或保留待审状态，并记录修复成功率、重试次数与 token 成本。最终格式通过不足以验收，须核对实际补证据行为；范围过度推广另用隔离的语义审阅任务评估，不宣称数据库能确定识别所有此类错误。

## 可信账本的价值是减少误判，不是替 Agent 宣布策略通过

本设计应继续把 Nautilus 的账户、订单、成交与经济事实留在原生报告，把研究判断留给 Agent。Dolt 负责让原始材料、固定来源、研究约定、运行和决定可追溯。当前最有价值的提升，是让下一轮直接读到决策的 basis、已经暴露的家族以及待审影响；这些可以用既有对象和关系表达，不需要更多抽象层。

三条边界必须持续可见：**原文字节完整，不等于原文真实或支持结论；review/admission 接受，不等于策略资格；artifact 审计通过，不等于独立经济验证或可恢复性完成。** 本轮既未重验 native 经济结果，也未完成规模、并发或灾备验收。后续声称可恢复，应以 exact source、OCI bytes、canonical inputs 的恢复及重放证明为依据；后续声称查询可扩展，应以固定任务的读取量、延迟和召回验证为依据。

审计的临时采集与探针见 [live.json](/tmp/trade-dolt-audit-20261009/live.json)、[content.json](/tmp/trade-dolt-audit-20261009/content.json)、[probes.json](/tmp/trade-dolt-audit-20261009/probes.json)、[schema_probe.json](/tmp/trade-dolt-audit-20261009/notes/schema_probe.json) 和 [parallel-probes.json](/tmp/trade-dolt-audit-20261009/parallel-probes.json)。它们是本次诊断材料，未作为可恢复研究证据登记；本报告保留快照身份、方法、关键结果与定向复现命令，不将原始数据库导出或凭证放入 Git。
