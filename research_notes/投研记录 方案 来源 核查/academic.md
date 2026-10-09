# 学术论文与标准：投研谱系和回测试验记录

## 哪些成熟概念能约束研究记录的关系模型？

### Takeaway

W3C PROV-DM 为「实体—活动—责任主体」以及使用、生成、派生、修订提供了通用概念；FAIR 要求持久标识、可检索元数据、限定关系与详细来源。它们支持可追溯的记录结构，但均未规定 Trade 应使用图数据库、RDF、JSON、YAML 或独立服务。

### Cited Findings

- W3C PROV-DM 于 2013-04-30 成为 Recommendation；它把 provenance 定义为描述实体、活动及参与者如何产出事物的信息，并将实体、活动、使用、生成、派生、责任、集合等分为不同关系。— [W3C PROV-DM](https://www.w3.org/TR/prov-dm/); [W3C 发布记录](https://www.w3.org/standards/history/prov-dm/)
- PROV-DM 将 `wasDerivedFrom` 限定为产物实际受到先前实体影响；仅仅「运行使用了 X 且产出 Y」并不自动表示 Y 派生自 X。`wasRevisionOf` 则特指保留原物实质内容的修订。— [W3C PROV-DM §2.1.2、§5.2.2](https://www.w3.org/TR/prov-dm/)
- PROV-DM 的 `Plan` 是为实现目标而拟定的动作或步骤；可以将它与活动、责任主体相关联，但标准不定义计划特有的领域字段。— [W3C PROV-DM §5.3.3](https://www.w3.org/TR/prov-dm/)
- Wilkinson 等人在 2016-03-15 发表的 FAIR 原文要求：持久唯一 ID、丰富且可搜索的元数据、元数据明确指向对象、对其他元数据的限定引用、详细 provenance，并指出即使数据不可得，元数据也应继续可访问。— [FAIR 原文，Scientific Data (2016)](https://www.nature.com/articles/sdata201618)
- FAIR 原文明言原则先于实现，不指定任何技术、标准或实现方案；原则也适用于分析工作流等非数据研究资产。— [FAIR 原文，Scientific Data (2016)](https://www.nature.com/articles/sdata201618)

### Inferences

- Trade 可采用 PROV 的**概念映射**：策略源码版本、冻结假设/计划、数据快照和原生报告是带稳定 ID 的实体；来源核查、策略修改和 Nautilus 回放是活动；执行的 Agent/操作者是责任主体。连接处用有类型的关系，保留关系创建时间和依据。尤其应分开 `code_revision_of`、`hypothesis_extends`、`run_used`、`run_generated`、`compared_with`；最后两种是 Trade 领域关系，不必假装它们是 PROV 的标准术语。
- `availability=unavailable` 的旧证据仍保留元数据与失效原因；它使检索和审计继续可用，但不让丢失的原始报告冒充仍可复核。
- 现有契约的「四类记录」可以视为轻量应用模型；W3C 与 FAIR 都不能单独证明必须增加四张表、四种 JSON 文件或新服务。将它们误写成对某项技术的背书会过度解释来源。

### Gaps

- 这些通用标准不规定金融研究的比较口径、数据暴露定义，也没有提供可直接照抄的 Trade 字段清单。

## 复现研究与跨代引用，最低要保存什么？

### Takeaway

可复现性文献强调每个结果的实际输入、程序版本、参数、流程和中间产物；解释性文字必须指到精确结果。对 Trade 而言，这比保存 Agent 的完整聊天记录更直接服务于「为何改、比谁好、能否回退」。

### Cited Findings

- Sandve 等人在 2013-10-24 的原文要求为每个结果记录生产流程，以及可影响执行的程序名称/版本、参数和精确输入；文中也指出手工叙述易与实际执行脱节。— [PLOS Computational Biology, Rule 1 (2013)](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003285)
- 同文强调归档外部程序的准确版本、对自定义脚本做版本控制；微小代码变化也可能改变结果。— [PLOS Computational Biology, Rules 3–4 (2013)](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003285)
- 同文建议保存中间结果、随机种子、图表背后的原始数值，并提供从摘要逐层查到细节的入口。— [PLOS Computational Biology, Rules 5–8 (2013)](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003285)
- 同文指出研究解释通常与结果分散存放；应在提出解释时，就把文字结论连接到精确的底层结果，文件路径或结果 ID 均可。文中还认为失败、无成果的分析目录可能在日后有复用价值。— [PLOS Computational Biology, Rule 9 与引言 (2013)](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003285)

### Inferences

- 最小的可复现 `run` 记录至少应有：运行 ID、实际执行源码/runner 的内容身份、依赖锁定身份、Nautilus 版本、参数、数据快照或可复核回执、窗口、账户/费率假设、随机性信息、原生报告位置及校验值。`git commit` 若不能覆盖脏工作树字节，就只能是辅助索引。源码内容哈希/打包方式是工程选型，不是上述论文规定的格式。
- 一个解释性 `decision` 应引用确切 `run_id` 和原始报告；描述「改善了 X」时还应引用冻结对照 run 和可比性条件。修改解释可追加新版本与更正边，而不覆盖旧解释所对应的报告。
- 分层读回可先是 Markdown 摘要、结构化元数据、原生报告文件的链接；论文本身允许文件路径或结果 ID，没有要求立刻建设数据库/网页。

### Gaps

- 上述论文来自通用计算研究，不能证明一套固定的文件夹布局、归档期限或内容寻址算法对 Trade 最优；这些需对现有体量与备份条件做工程验证。

## 大量投研迭代为何需要保存失败试验、比较家族与数据暴露？

### Takeaway

金融原始论文明确把多次试验后的最优回测视为选择偏差来源；只保留胜出的策略会抹去判断该偏差所需的试验全集。结构化记录的直接价值是保留选择过程与可比较回报序列，并标清已接触样本。

### Cited Findings

- Bailey、Borwein、López de Prado、Zhu 的 PBO 论文（所查作者版为 2015-02 修订）说明：在有限历史数据上反复试参数/策略，即使单次检验看似显著，假阳性也随试验增加；其 CSCV 例子把候选策略的同步绩效序列组成 `T × N` 矩阵，并比较样本内选择与样本外排序。— [作者版《The Probability of Backtest Overfitting》](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)
- 同文指出简单留出集也可能被研究者先前使用或通过市场知识间接暴露；只报告一次留出集结果，且未计入选择前尝试的其他配置，不足以判断选择过程的过拟合风险。— [作者版《The Probability of Backtest Overfitting》](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)
- Bailey 与 López de Prado 的 DSR 论文（2014-07-31 作者版；2014 年《Journal of Portfolio Management》）指出只报告正面试验会产生选择偏差；DSR 计算需要被选择策略以外的信息，包括独立试验的有效数量、各试验 Sharpe 的离散程度，以及选中策略的样本长度、偏度和峰度。论文明确区分**执行的试验数 M**与**有效独立试验数 N**。— [作者版《The Deflated Sharpe Ratio》](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)
- Harvey、Liu、Zhu 在 2016 年《Review of Financial Studies》针对资产定价因子提出多重检验框架：既有大量已发表因子后，新发现不能继续套用单次检验的通常显著性门槛。该论文研究对象是横截面因子，不是 Trade 当前组合策略的直接验收规则。— [NBER 作者工作论文](https://www.nber.org/papers/w20592); [期刊记录](https://academic.oup.com/rfs/article-abstract/29/1/5/1843824)

### Inferences

- 每个选择家族应能查到**所有被尝试的候选**，包括失败、弃用、诊断型和未产生收益报告的尝试；记录它们是否进入经济选择，以及原因。不要把「run 总数」自动当成 DSR 的独立试验数；若以后计算 DSR/PBO，需要另行定义同口径的候选集合、同步回报序列与依赖性估计。
- 应分别保存 `comparison_family_id`、候选与冻结基线的关系、选择指标和选择时点、数据窗口与此前暴露状态。重复读取同一历史样本的后继研究应携带暴露记录；这些字段是由论文风险推导出的工程设计，论文没有提供通用 schema。
- 记录体系不能单靠「预登记时间」声称独立验证：若 Agent 已看过同一窗口或衍生结果，该窗口仍属已暴露研究样本。预登记可证明本次计划先于本次结果，但不能倒推出样本从未被使用。
- 现阶段应保留原始每期账户权益/收益序列以及原生订单/账户报告引用，后续才可能在一致口径上作多试验分析；仅有最终 Sharpe 或 CAGR 摘要无法重建候选矩阵。

### Gaps

- 这些论文不证明 Trade 当前 H 系列实际存在某个数值的过拟合概率，也不意味着现阶段必须计算 DSR/PBO；需要先确定可比较试验家族、统一时间索引和样本数量。论文更不能替代原生执行完整性、资金费与共享账户经济验收。
