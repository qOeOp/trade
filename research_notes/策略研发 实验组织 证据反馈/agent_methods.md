# Agent 组织量化研发实验与解释反馈：公开实现和方法学

## 公开 RD Agent 如何组织一轮实验？

### Takeaway
RD-Agent(Q) 的公开代码可核对“规定问题与接口 → 根据历史提出假想 → 转为任务 → 编码执行 → 与当前最佳方案比较 → 反馈下一轮”的循环；QuantConnect 官方文档展示另一种按研究、验证、回测、纸面观察分阶段交接的产品组织。两者的公开资料都不能证明一个自动 Agent 已经解决了连续试验后的选择偏差。

### Cited Findings
- **定义实验边界**：RD-Agent(Q) 论文 §2.1 把背景假设、数据接口、输出格式和外部执行环境写成四元组；§2.2 让 Synthesis 从历史假想与反馈中选相关片段提出下一假想，因子或模型为两种行动方向。对应代码 `quant.py` 的 `direct_exp_gen → coding → running → feedback`；这是“组织方法”而不是一个收益判定检验。— [论文 §2.1–2.2](https://arxiv.org/html/2505.15155); [运行循环代码](https://github.com/microsoft/RD-Agent/blob/main/rdagent/app/qlib_rd_loop/quant.py#L70-L145)
- **把假想变成可执行任务**：公开的 `factor_proposal.py` 把历史假想/反馈放入生成上下文，输出因子的描述、公式和变量，并按因子名称过滤已存在的任务；论文 §2.3 记载实现 Agent 保留任务、代码、执行反馈三元组，包括失败。— [生成代码](https://github.com/microsoft/RD-Agent/blob/main/rdagent/scenarios/qlib/proposal/factor_proposal.py#L25-L132); [论文 §2.3](https://arxiv.org/html/2505.15155)
- **用当前组合做基准**：论文 §2.4 称新因子先与现有 SOTA 因子库做相关去重，再和现有 SOTA 模型一同进入 Qlib 回测；新模型则配现有 SOTA 因子。`factor_feedback_generation` 提示明示新因子加入 SOTA 因子库后回测，再和当前 SOTA 比。它验证的是候选进入现有组合的增量，而不是“B 单独好所以与 A 必然互补”。— [论文 §2.4](https://arxiv.org/html/2505.15155); [公开提示，factor_feedback_generation](https://github.com/microsoft/RD-Agent/blob/main/rdagent/scenarios/qlib/prompts.yaml)
- **反馈内容是压缩过的**：`feedback.py` 只筛选 IC、扣成本年化超额收益、最大回撤三个指标传给因子反馈 LLM，并让其输出观察、对假想的判断、新假想、理由及是否替换最佳结果；`quant.py` 对执行异常生成 `decision=False`。这说明有明确“执行失败”和“效果反馈”入口，却没有公开的逐订单首个分叉归因接口。— [反馈代码](https://github.com/microsoft/RD-Agent/blob/main/rdagent/scenarios/qlib/developer/feedback.py#L20-L177); [运行循环代码](https://github.com/microsoft/RD-Agent/blob/main/rdagent/app/qlib_rd_loop/quant.py#L111-L145)
- **选择下一方向**：论文 §2.5 把“下轮研发因子还是模型”写成双臂 bandit；代码 `quant_proposal.py` 展示历史动作与结果更新 controller，再决定下一行动，也允许 LLM 或随机选择。它在“要探索哪类改进”层面调度，不是对单条候选策略有效性的统计证明。— [论文 §2.5](https://arxiv.org/html/2505.15155); [选择代码](https://github.com/microsoft/RD-Agent/blob/main/rdagent/scenarios/qlib/proposal/quant_proposal.py#L75-L140); [bandit 代码](https://github.com/microsoft/RD-Agent/blob/main/rdagent/scenarios/qlib/proposal/bandit.py#L100-L125)
- **QuantConnect 产品形态**：官方 Conductor 文档称其把想法变成 brief，交 Research、Research Validation、Backtest、Paper Testing 等专门 Agent；Research Agent 产出含数据范围、缺失、变换、候选模型、残差诊断的 notebook；Backtest Agent 负责编译、修错误、运行回测，但页面明确不由它用文字代替回测报告；Paper Testing Agent 先核对预期订单，再核对相同日期的纸面与回测行为，后评估表现衰减。— [Conductor](https://www.quantconnect.com/docs/v2/ai-assistance/predefined-agents/conductor); [Research Agent](https://www.quantconnect.com/docs/v2/ai-assistance/predefined-agents/research-agent); [Backtest Agent](https://www.quantconnect.com/docs/v2/ai-assistance/predefined-agents/backtest-agent); [Paper Testing Agent](https://www.quantconnect.com/docs/v2/ai-assistance/predefined-agents/paper-testing-agent)
- **证据如何传给 Agent**：QuantConnect 官方 Agents 文档称回测结果分析器给 Agent 结构化发现，包括问题、日志/订单样本、出现次数及建议修法；Agent 的任务、系统提示和可用工具决定其行为。此为厂商产品说明，没有公开独立实验能证明这些默认 Agent 在真实策略中稳定提高有效性判断。— [Agents 文档，Built-In Backtest Diagnostics / Why Use Agent Harness](https://www.quantconnect.com/docs/v2/ai-assistance/agents)

### Inferences
- 可借用 RD-Agent(Q) 的**实验记忆和明确的假想→任务→反馈契约**，以及 QuantConnect 的**证据交接**；无需按厂商角色数复制多 Agent。对 R1，Agent 仍可负责选问题、对照和下一实验，原生 Nautilus 及确定性统计产物提供事实。
- 若 A 单独有效、B 加到 A 上局部指标更好、完整账户 S+A+B 却差，Agent 应先确认三次“好”的测量对象、时间窗和账户一致，再提出少数能用下一次差分验证的解释。公开 RD-Agent(Q) 主要展示 SOTA 汇总指标反馈；逐订单、资金占用、资金费的因果排查须由我们现有原生事实支持。

### Gaps
- 公开论文和代码未展示以共享账户策略为单位、自动识别 A+B 订单首次分叉及资金约束链条的完整流程；不能把因子库的增量筛选直接声称为完整策略组合诊断。— [论文 §2.4–2.5](https://arxiv.org/html/2505.15155); [反馈代码](https://github.com/microsoft/RD-Agent/blob/main/rdagent/scenarios/qlib/developer/feedback.py#L20-L177)
- RD-Agent(Q) 论文报告跨市场/时段样本外评价；Appendix C.1 说明基线模型做五个随机种子运行，并以中位年化收益报告而未报告标准误或置信区间。公开结果不足以证明反复看同一测试区间后仍有独立性。— [论文 §4、Appendix C.1](https://arxiv.org/html/2505.15155)

## A+B 组合反而恶化时，实验如何设计？

### Takeaway
先确定目标是“B 在 A 存在时的增量”还是“A 与 B 的交互”，再选择必要对照。若 A、B 都可独立开关，固定条件跑 S、S+A、S+B、S+A+B 四格；若 B 只有在 A 存在时才有意义，至少跑 S+A 对 S+A+B，不虚构 S+B。

### Cited Findings
- **先定目标、因素和响应**：NIST 实验设计手册 §5.3.1 要求实验前写明主要目标和次要目标，再选因素、响应和设计；§5.3.2 要求纳入相关响应并检查不可能的因素组合。由此先写清“主要账户响应”和安全/风险约束、A/B 可否独立存在。— [NIST §5.3.1](https://www.itl.nist.gov/div898/handbook/pri/section3/pri31.htm); [NIST §5.3.2](https://www.itl.nist.gov/div898/handbook/pri/section3/pri32.htm)
- **四格用于可独立开关的 A/B**：NIST §5.3.2 的两因素设计矩阵列出 `--,+-,-+,++` 四次，另有 A×B 交互列；§5.3.3 明确全因子设计让每个因素设置与其他因素各设置配对。映射到策略就是 S、S+A、S+B、S+A+B。— [NIST §5.3.2，设计矩阵/交互项](https://www.itl.nist.gov/div898/handbook/pri/section3/pri32.htm); [NIST §5.3.3](https://www.itl.nist.gov/div898/handbook/pri/section3/pri333.htm)
- **效果是相对于固定背景的差分**：由 NIST 的两因素模型 `Y=β0+β1A+β2B+β12AB+error` 可计算 B 在 A 已存在时的增量 `Y_AB−Y_A`，以及交互对比 `(Y_AB−Y_A)−(Y_B−Y_S)`。该代数只描述设计对比；若收益指标非加性、账户路径相互制约，应明确使用同一预先指定的账户响应，并把交互解释回订单/持仓路径。— [NIST §5.3.2，模型矩阵](https://www.itl.nist.gov/div898/handbook/pri/section3/pri32.htm)
- **不要照抄物理实验随机化**：NIST 物理实验例子通过随机运行顺序抵御昼夜温度等外部干扰；同一历史市场片段上的确定性回放不是随机分配市场状态，随机化运行顺序不能创造独立市场样本。应固定共享数据/资金/执行条件并在不同时间段核对稳健性。后半句是对回测情境的推论，不能冒称 NIST 的原话。— [NIST §5.3.3.3.2，Randomization](https://www.itl.nist.gov/div898/handbook/pri/section3/pri3332.htm)

### Inferences
- 面对组合恶化，Agent 的第一轮解释应是**可反驳的机制树**：口径/运行差异、信号覆盖或取消、订单与成交变化、共享资金竞争、风险约束触发、成本与净收益、统计波动。每个枝干应指向原生事件或账户证据；首个分叉定位之后才提修复假想。该流程是在 DOE 的对照设计与 QuantConnect 的“订单行为先于表现”次序上对 R1 的具体化。— [NIST §5.3.1–5.3.2](https://www.itl.nist.gov/div898/handbook/pri/section3/pri31.htm); [QuantConnect Paper Testing Agent，How It Works](https://www.quantconnect.com/docs/v2/ai-assistance/predefined-agents/paper-testing-agent)
- 一次对比不能自动得出“B 无效”：若 `Y_AB−Y_A<0`，只能说在所固定环境里 B 的边际效果为负；若 `Y_B−Y_S>0`，还提示有负交互或容量/账户路径冲突。下一实验应针对已观察到的机制，保持可检验性。

### Gaps
- NIST 的全因子模型假设响应测量与设计在对应实验条件下成立，不能直接替代金融时间序列的相关性、不稳定性和重复筛选控制；它主要解决对照结构，不自动给出交易策略的统计显著性或可交易性。— [NIST §5.3.2](https://www.itl.nist.gov/div898/handbook/pri/section3/pri32.htm)

## 哪些公开做法适合借鉴，哪些应拒绝直接照搬？

### Takeaway
优先借鉴“保留失败历史、按当前组合估增量、反馈里区分事实与推断、下一实验只检验一个明确解释”。不能直接照搬以微小年化收益提升就自动晋级的 SOTA 规则，也不能让 Agent 对缺少订单和账户证据的运行编造机制。

### Cited Findings
- RD-Agent(Q) 的因子反馈提示要求“任何小幅改善”都可加入 SOTA、年化收益改善即推荐替换，并容许其他指标小幅变差。这是代码中的明确默认决策规则，却不包含对多次候选筛选、差异不确定性或策略风险预算的门槛；不适合原样用于 R1 研究资格。— [公开提示，factor_feedback_generation](https://github.com/microsoft/RD-Agent/blob/main/rdagent/scenarios/qlib/prompts.yaml)
- 同一提示还要求反馈输出观察、假想判断、新假想、推理和是否替换的结构化字段；对未实现的因子明确说该假想在本轮无法验证。这个“证据不足则不能判”的边界值得借鉴。— [公开提示，factor_feedback_generation.user](https://github.com/microsoft/RD-Agent/blob/main/rdagent/scenarios/qlib/prompts.yaml)
- RD-Agent(Q) 因子假想提示建议先做简单因素、逐渐提高复杂度、简单因素被测后才组合，连续多轮无进展可换方向；这是效率启发，不是防过拟合的资格机制。— [公开提示，factor_hypothesis_specification](https://github.com/microsoft/RD-Agent/blob/main/rdagent/scenarios/qlib/prompts.yaml)
- QuantConnect 纸面观察 Agent 文档要求报告目标、观察与预期、诊断尝试，并明确区分已知事实和根因推测；其 Backtest Agent 页面说完成回测后并不宣称生产就绪。这是适合研发反馈文字结构的厂商规范。— [Paper Testing Agent，How It Works / What You Get Back](https://www.quantconnect.com/docs/v2/ai-assistance/predefined-agents/paper-testing-agent); [Backtest Agent，What You Get Back](https://www.quantconnect.com/docs/v2/ai-assistance/predefined-agents/backtest-agent)
- RD-Agent(Q) 论文 §2.5 将 Analysis 的本轮局部诊断与 Synthesis 的全历史视角分开；论文 §F.2 承认其因子生成主要依赖模型内置知识，结构化金融专业知识的检索整合仍属未来改进。— [论文 §2.5、§F.2](https://arxiv.org/html/2505.15155)

### Inferences
- R1 的单次 Agent 反馈可固定为五个段落：**本轮问题与配对对照；确定事实（带运行 ID/原生事件）；仍未解释的差异；最可能且可推翻的机制解释；下一次只变一个机制的实验及停止条件**。这借用 RD-Agent(Q) 的结构化反馈、NIST 的预定目标、QuantConnect 的事实/推断区分；字段是我们的建议，并非厂商现成功能。— [RD-Agent(Q) 提示](https://github.com/microsoft/RD-Agent/blob/main/rdagent/scenarios/qlib/prompts.yaml); [NIST §5.3.1](https://www.itl.nist.gov/div898/handbook/pri/section3/pri31.htm); [QuantConnect Paper Testing Agent](https://www.quantconnect.com/docs/v2/ai-assistance/predefined-agents/paper-testing-agent)
- 为避免 Agent 被差的证据引到错方向，先由工具/人工确定运行可比性、原生订单完整性、账户路径和结果不确定性，再交 Agent 解释；若包内只有汇总收益，Agent 只能得出“组合恶化但原因未定”。这对应论文 §2.5 的局部分析/全局记忆分工和 QuantConnect 的诊断顺序。— [论文 §2.5](https://arxiv.org/html/2505.15155); [QuantConnect Agents，Backtest Diagnostics](https://www.quantconnect.com/docs/v2/ai-assistance/agents); [Paper Testing Agent](https://www.quantconnect.com/docs/v2/ai-assistance/predefined-agents/paper-testing-agent)

### Gaps
- 未发现可公开核对的 RD-Agent(Q) 默认“多次试验校正 + 逐账户因果归因 + 独立资格授予”一体化流程；公开 `feedback.py` 的指标压缩和 `prompts.yaml` 的微增即替换规则反而提示不能假定其已解决这些问题。— [反馈代码](https://github.com/microsoft/RD-Agent/blob/main/rdagent/scenarios/qlib/developer/feedback.py#L20-L177); [提示规则](https://github.com/microsoft/RD-Agent/blob/main/rdagent/scenarios/qlib/prompts.yaml)
