# 分叉与融合的研究假设图：工具和科研工作流实践

## 现有工具到底记录什么图

### Takeaway
主流实验工具已经证明“版本、运行、产物、依赖、指标可检索”有价值；但它们通常记录执行或产物血缘，不自动解释一个策略为何从另一策略延伸、何种假设被融合或哪条失败结论可迁移。Trade 可借鉴其查询和血缘模型，不应把工具的 run-parent 误当成策略假设的因果父子关系。

### Cited Findings
- W3C PROV-DM 将实体、活动、代理及使用、生成、派生等关系分开；派生要求新实体确实受到旧实体影响，单纯在同一次活动中使用过，不足以自动认定派生。修订是派生的子类型。— [W3C PROV-DM](https://www.w3.org/TR/prov-dm/)
- DVC experiment 以当前 Git `HEAD` 为 baseline，使用自定义 Git refs 存储实验；能比较参数、指标、依赖和图表，但所展示的 parent 首先是代码项目版本的基线。— [DVC Experiments Overview](https://doc.dvc.org/user-guide/experiment-management), [DVC Comparing Experiments](https://doc.dvc.org/user-guide/experiment-management/comparing-experiments)
- DVC 的 `exp show --only-changed` 只显示变化的指标、参数和依赖，并可导出 CSV 或用 Python API 读取；这是大量实验时减少检索噪声的成熟交互。— [DVC Comparing Experiments](https://doc.dvc.org/user-guide/experiment-management/comparing-experiments)
- MLflow 用 experiment 容纳 runs，可用单一 `parent_run_id` 组织嵌套 runs，并按指标、参数、标签、数据集标识查询；该 parent 是 run 层级，不是多父假设融合语义。— [MLflow Python API](https://www.mlflow.org/docs/latest/api_reference/python_api/mlflow.html), [MLflow Search Runs](https://www.mlflow.org/docs/latest/ml/search/search-runs/)
- Qlib 的 Experiment 创建 Recorder，其 Recorder 包装 MLflow；源码记录命令、部分环境变量与未提交的 Git diff/status，说明量化研究工具重视执行上下文，但其公开核心模型仍是 experiment/recorder，不是有类型的假设融合图。— [Qlib Experiment source](https://github.com/microsoft/qlib/blob/main/qlib/workflow/exp.py), [Qlib Recorder source](https://github.com/microsoft/qlib/blob/main/qlib/workflow/recorder.py)
- AiiDA 把 data/calculation 的数据血缘与 workflow 的逻辑血缘分为两个平面；数据血缘因因果顺序是 DAG，而包含 workflow input/return/call 的整体逻辑图可有环。— [AiiDA provenance concepts](https://aiida.readthedocs.io/projects/aiida-core/en/stable/topics/provenance/concepts.html)

### Inferences
- 对 Trade，至少要区分三类身份：**尝试/假设版本**（为何试）、**策略源码身份**（实际运行了什么）、**原生运行/证据身份**（得到什么）。同一个假设可多次运行，同一份源码也可能服务不同的研究问题；把三者压成一个图节点会混淆结果。
- Git commit/source bundle 是代码血缘，`control_run_id` 是比较设计，`parents[]` 才可能表达假设来源。三者不要共用一种 `parent` 字段。现有 pilot 已有 `parents[]`、`code_parent`、run→attempt、`control_run_id`，可迭代扩充查询层，无须先移植 DVC/MLflow/Qlib 的执行引擎。

### Gaps
- 未找到 MLflow、DVC 或 Qlib 官方资料证明它们能直接编码“策略 A 与 B 各自失败、组合 AB 才有效”这一假设贡献关系；这必须由 Trade 自己定义语义并验证其检索收益。
- 工具文档没有证明图形 UI 本身会提高量化策略成功率；只能支持“已有记录能被比较和追溯”的产品能力。

## 树、DAG、有环图与边的语义

### Takeaway
用户设想的“蜂窝图”适合作为导航视图；底层版本血缘应是**有向无环的多父图**。允许把引用、比较、反驳等知识关系叠加成更丰富的图，但不能让“回访旧点”修改旧节点或使执行来源出现时间倒流。

### Cited Findings
- W3C PROV 约束规定，如果新实体派生自旧实体，旧实体的生成严格先于新实体的生成；包含严格先后边的时序环使 provenance 实例无效。— [W3C PROV Constraints](https://www.w3.org/TR/prov-constraints/)
- AiiDA 明确给出看似矛盾但可共存的例子：workflow 返回自己的输入会使整体逻辑图出现环，而 data/calculation 的血缘平面仍保持 DAG。— [AiiDA provenance concepts](https://aiida.readthedocs.io/projects/aiida-core/en/stable/topics/provenance/concepts.html), [AiiDA implementation](https://aiida.readthedocs.io/projects/aiida-core/en/stable/topics/provenance/implementation.html)
- W3C 的 `wasInvalidatedBy` 是实体被销毁、终止或过期的事件，并非“研究认为这个假设已证伪”；不能直接把业务字段 `invalidates` 映射成 PROV 失效事件。— [W3C PROV-DM](https://www.w3.org/TR/prov-dm/)
- W3C 在来源图中区分更具体的派生、修订、影响等关系，并建议有更具体描述时优先表达具体关系。— [W3C PROV-DM](https://www.w3.org/TR/prov-dm/)

### Inferences
- **分叉**：origin→A 与 origin→B 是两个新 attempt，各自记录相对于 origin 的唯一改动、假设、证据、判定。若 A 和 B 的源码也分叉，另存 Git/source 身份；两种分叉不是同义词。
- **融合**：从 A1 和 B1 提取机制形成新 attempt AB，`parents=[{A1, composition}, {B1, composition}]`；它不是复用 A1 或 B1 的历史成绩。若实际代码以 A1 为 base 再加入 B1 的逻辑，`code_parent=A1-source` 另记，B1 的贡献要有指向具体代码差异或机制说明的证据。
- **回访/回退**：新建 attempt R，标注 `revisits=旧 attempt` 或 `repair/extension parent=旧 attempt`，记录为何在新数据或新假设下重试；旧 attempt 的历史结果不重写。`revisits` 可呈现为一条跨层知识链接，但不参与血缘拓扑排序。
- **反驳**：`challenges/contradicts` 应指向一个带条件的结论及新证据，作用域含数据区间、成本模型、账户约束和机制；不宜用永久 `invalidates` 删去旧研究，因为旧结论可能只对某一设置失效。
- 因此可给用户一张可缩放的“蜂窝图”，但按边类型分层显示：实线为延伸/修复/组合的多父 DAG；虚线为比较、引用、回访和冲突。放射式布局不是存储格式，也无需图数据库作为第一步。

### Gaps
- 尚无 Trade 用户研究证明“蜂窝布局”比可搜索的 lineage 列表、diff 表与局部 DAG 更快定位有用假设。布局应该作为可切换视图并通过任务计时验证。
- W3C/AiiDA 的 provenance 规则处理实体生成和活动关系；将其映射到主观研究假设时需要 Trade 自己规定何为“派生”和“贡献”，不能声称标准直接提供策略研究本体。

## 对 Trade 的最小数据契约和查询

### Takeaway
最小升级是给现有 Git 内 JSON attempt/run 记录增加稳定身份、带类型的多父关系和明确的比较设计；读侧提供谱系、兄弟节点、融合贡献与证据质量查询。先保留源码为首要产物和 Nautilus 原生运行事实，只有检索任务证据支持时才加可视化或索引服务。

### Cited Findings
- DVC 的命名是唯一的、可自动生成，并以 Git ref/commit 维持可追溯来源；展示层可用可读名称，但身份仍需稳定。— [DVC Experiments Overview](https://doc.dvc.org/user-guide/experiment-management)
- AiiDA 的图节点和有类型链接支持向前/向后追溯；其数据 provenance 与逻辑 provenance 分离提供避免混合执行和解释关系的结构先例。— [AiiDA provenance concepts](https://aiida.readthedocs.io/projects/aiida-core/en/stable/topics/provenance/concepts.html)
- DVC 的差异表、`--only-changed` 和图表比较提供先做局部 diff/筛选而不是全图展示的产品先例。— [DVC Comparing Experiments](https://doc.dvc.org/user-guide/experiment-management/comparing-experiments)
- 2×2 全因子设计有 00、10、01、11 四种设置；这可以同时估计两个主效应及交互效应。实验数随因子数呈 2^k 增长，较多因子时需考虑分数因子方案及混杂。— [NIST Full Factorial Designs](https://www.itl.nist.gov/div898/handbook/pri/section3/pri333.htm), [NIST Fractional Factorial Designs](https://www.itl.nist.gov/div898/handbook/pri/section3/pri334.htm), [NIST Two-Way Crossed ANOVA](https://itl.nist.gov/div898/handbook/ppc/section2/ppc232.htm)

### Inferences
- `attempt_id` 宜用不可变、不编码血统的 ID（如 `H-...` 或随机/时间有序 ID）；`A1B1` 可做人工 alias/display label，但不应是唯一键。ID 内嵌血统会在多父融合、改名、回访、跨项目复用时失效。图关系放在字段里，不能靠字符串解析。
- 新 attempt 最少记录：`id, alias, goal, question, proposed_mechanism, parent_edges[{attempt_id,type,delta,reason}], preregistration_time/ref, decision_scope, evidence_refs`。每次 run 单独记录 `run_id, attempt_id, source_digest, data_digest, window, native_account/engine/cost identity, control_run_id, output refs, integrity/evidence grade`。这承接现有 pilot，而非创造策略 DSL。
- 读侧先做四个具体查询：①“这条策略为何被尝试，沿途哪些假设失败”；②“与 A1 同基线的其他实验及只变化字段”；③“AB 组合中 A/B 的单独与合并结果、哪些证据可直接比较”；④“某个反证/数据变更会影响哪些后代结论”。查询输出必须显示证据缺口。
- 组合 AB 的效果不等于 A 与 B 的效果之和。对同一评价单元和同一原生账户/数据/成本条件，至少比较 `00`、`10`、`01`、`11`；对可加标量指标，交互差可描述为 `Y11 - Y10 - Y01 + Y00`。对于 Sharpe、最大回撤或账户资金竞争，不能把这个公式当成可加的经济贡献；要展示四条完整原生权益/风险路径及同一口径的独立验证。若四格缺失，结论标“组合表现观察值”，不标“协同已证实”。
- 假设图能减少遗忘和错误复用，但需要用实际任务衡量：检索到可复用研究的时间、错误比较被拒绝率、从失败点找到可回退版本的时间、成功复现率、研究 Agent 在看历史记录前后提出的重复假设率。策略成功率提升需另设计前瞻评估，不能从图结构推出。

### Gaps
- 没有检索到适用于 Trade 的公开数值，能证明多父假设图比文本/表格记录使策略成功率提高多少；ROI 与图 UI 的优先级需用本仓库历史任务和后续盲测量化。
- 现有试点仅回填 5 个 attempt、2 个 run，历史原始 CSV 仍为临时文件；无法据此验证规模检索、自动组合归因或持久重放能力。
