# P014：假设提出前的外部研究与来源分类

2026-10-13。按批准 P014-r1 落实；原件 SHA256 `3c6173096a6ae608b672cdcb4ee93814216a9ea60073a5d595d9fd355e56d502`，独立架构回执 SHA256 `126cc8cc89f071bce55b4b7a0298594e2ea5845f128c878539a69210957785d5`，与 manifest 核对一致。承接 F011 的来源质量发现，不改变旧 H01–H10 的来源身份。

修改 `research-round`、`research-sources`、`research-start` 及 hypothesis/source-evidence/knowledge 指引：经济假设提出前先研究相关论文与可信实践，优先复用适用留存，对机制缺口补检。用既有 rationale/sources/notes 的可读文字区分外部依据、本地诊断、自身推测，说明原文位置、读取程度、市场/窗口/频率/成本/验证条件，以及支持机制、规则参数或仅方法。工程 API/构造/时钟修复仍依技术文档和原生预检，不要求盈利论文。

修正旧 source-evidence 的“来源不要作为第一阶段”语义。没有论文支持仍可按本地信息价值低优先级探索；访问失败不是没有研究；不增加引用数量评分、硬拒绝、方向关闭或 p 晋级。后来材料作为后续证据追加，不追认事前背书。没有新产品字段、数据库 schema、检索服务、推荐算法或代码变更。

## 有意义的行为验证

按 system skill-creator 的 Independent Forward-Testing，用冻结六个技能文件、原始材料及现实任务交给独立 `/root/skill_forward_check`；未提供预期答案或既有结论。实际输出为理由、汇报句、登记草稿与 chain 草稿，父 Agent 对照原文及事先检查标准评估：

| 用例 | 实际行为 |
|---|---|
| 外部原文准备事前假设 | 亲自读取 [NBER 工作论文原件](https://www.nber.org/papers/w24877.pdf) 的数据/机制段，提出可反驳过滤想法；明确历史日/周频向小时永续迁移与参数未证，不声明含成本优势。 |
| 只有内部 note | 固定 run/commit/note 留为本地诊断，未写成论文背书，也未编造原始数值。 |
| 方法论文与 RSI35/65 | 区分 bootstrap 方法线索与经济参数支持；未读全文的条件不冒称已验证，更未宣称与仓库循环区块方法等价。 |
| 无直接支持/访问受限 | 保留低优先级探索；题给 403/429 不写成没有研究，不混同真实检索状态。 |
| 事后材料 | 仅准备后续日期/版本/source bundle 更新；旧 H06 原计划、原先分类与封存保持不变。 |

五项符合本次标准。该结果只验证此候选、这些材料和请求的行为，不是统计基准、经济改善或策略独立验证。

父 Agent 实际完成三种表述 × Crossref/OpenAlex 两个官方索引的六次小规模匿名查询（均 HTTP200，每次最多5条元数据）；随后核对具体论文版本并读公开原文。NBER 工作论文原文、元数据版本、[QuantConnect 官方研究指引](https://www.quantconnect.com/docs/v2/writing-algorithms/key-concepts/research-guide)及[可识别 staff 的社区实践](https://www.quantconnect.com/forum/discussion/14499/algorithm-framework-for-crypto-trades-for-no-apparent-reason-in-backtest/)均留存。社区材料仅作平台实践，不能给市场盈利或具体 RSI 参数背书；公开方法论文全文请求404、另一入口不可读，如实留限制，没有突破访问边界。没有把元数据筛选冒称读完30篇论文，也没有给旧假设补论文。

## 封存及检查

- 同一个隔离工程 profile home 下新 ledger `p014-source-engineering`，DB `p014_source_eng_20261013`；旧 P010–P013 库和旧年度演练封存不写。
- tag `closed/P014-SOURCE-BEHAVIOR-20261013`，commit `erqdhgji51lq2o5c04uoiir8g5ljs5j6`；`ledger audit` 无发现。原文、查询/读取限制、冻结技能 hash、五项输出与复核经官方 CLI 留存，23个文件导出及恢复备份读回全部哈希一致。
- 零策略发布、零经济假设登记、零 trial/run，不重跑十轮；工作副本 `/tmp/rd-p014-behavior-20261013`，备份在隔离工程目录 `dolt_backup/p014_source_eng_20261013`。
- 三个变更 skill 的 quick_validate 与 diff 检查通过。P014 无代码变化，P010–P013 的166项完整测试与新镜像原生工程验收仍为对应代码验证；不声称 P014 又运行了 unit/native suite。新 CI digest 与代码身份见 [P010–P013 验收](p010-p013-implementation.zh.md)。

可复用测试提示词继续要求先研究再提出经济假设，并在 chain 追溯三类依据；提示词更新不会启动新研究。full-pool 未验收的覆盖问题保持明确，用户目标、拒绝/审计保护与 main 均未为此次来源行为验证改变。
