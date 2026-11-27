# 研究方法论外部基准审计与技能升级（RD-Agent / AlphaAgent / 计量文献对标）

- **日期**：2026-11-27
- **审计分支**：`exp/audit-methodology-rd-agent`（基于 `origin/main`）
- **对象**：产品统计与登记校验层（`report/`、`registration/`）及研究技能层（`.agents/skills/{research-start,research-round,nautilus-report-analysis,research-sources}`）
- **方法**：结合外部开源量化 Agent 框架与实证计量文献，按 `product-doctor` 第 5 步（质疑默认前提）与第 6 步（自我反驳与 `burden` 权衡）逐项判定“已有覆盖 / 存活缺口 / 明确拒绝”。

---

## 1. 外部基准文献与开源框架清单

| 类别 | 文献 / 项目 | 精确标识 / 链接 | 核心方法论 |
|---|---|---|---|
| 量化 Agent 框架 | Microsoft **R&D-Agent** / **R&D-Agent-Quant (RD-Agent(Q))** | [arXiv:2505.14738](https://arxiv.org/abs/2505.14738) · [arXiv:2505.15155](https://arxiv.org/abs/2505.15155) · [microsoft/RD-Agent](https://github.com/microsoft/RD-Agent) | R&D 闭环、Co-STEER 演化实现、多臂老虎机（MAB）方向调度、多路径 DAG 分支探索与融合、任务-代码-反馈知识库复用 |
| 量化 Agent 框架 | **AlphaAgent** (Tang et al., KDD '25) | [arXiv:2502.16789](https://arxiv.org/abs/2502.16789) · [RndmVariableQ/AlphaAgent](https://github.com/RndmVariableQ/AlphaAgent) | AST 原创性惩罚（防因子拥挤）、假设-代码语义对齐、AST 复杂度约束（防规则堆砌与过拟合） |
| 量化 Agent 框架 | **Chain-of-Alpha** / **QuantAgent** / **FinMem** | [arXiv:2508.06312](https://arxiv.org/abs/2508.06312) · [arXiv:2509.09995](https://arxiv.org/abs/2509.09995) · [arXiv:2311.13743](https://arxiv.org/abs/2311.13743) | 双链因子生成/优化、价格驱动多角色架构、分层记忆机制 |
| 多重检验与样本量 | Bailey & López de Prado (2012), *The Sharpe Ratio Efficient Frontier*, *J. Risk* | [DOI: 10.21314/JOR.2012.255](https://doi.org/10.21314/JOR.2012.255) | 概率夏普比率（PSR）与非正态最小轨迹长度（**MinTRL**） |
| 多重检验与样本量 | Bailey & López de Prado (2014), *The Deflated Sharpe Ratio*, *J. Portfolio Management* | [DOI: 10.3905/jpm.2014.40.5.094](https://doi.org/10.3905/jpm.2014.40.5.094) | 折扣夏普比率（**DSR**）与相关性折算有效独立试次数 $N_{\text{eff}} = \rho + (1-\rho)N$ |
| 过拟合检测 | Bailey, Borwein, López de Prado & Zhu (2017), *The Probability of Backtest Overfitting*, *J. Comput. Finance* | [DOI: 10.21314/JCF.2016.322](https://doi.org/10.21314/JCF.2016.322) | 组合对称交叉验证（CSCV）与回测过拟合概率（PBO） |
| 数据窥探检验 | Harvey, Liu & Zhu (2016), *RFS* · White (2000), *Econometrica* · Hansen (2005), *JBES* | [DOI: 10.1093/rfs/hhv059](https://doi.org/10.1093/rfs/hhv059) · [DOI: 10.1111/1468-0262.00152](https://doi.org/10.1111/1468-0262.00152) · [DOI: 10.1198/073500105000000063](https://doi.org/10.1198/073500105000000063) | 因子库多重检验 $t > 3.0$ 折减、White 现实检验（RC）、Hansen 优越预测能力检验（SPA） |
| 加密永续合约实证 | He, Manela, Ross & von Wachter (2022), *Fundamentals of Perpetual Futures* · Ackerer, Hugonnier & Jermann (2024), *Perpetual Futures Pricing* | [arXiv:2212.06888](https://arxiv.org/abs/2212.06888) · [arXiv:2310.11771](https://arxiv.org/abs/2310.11771) | 永续资金费率杠杆状态依赖、牛熊切换符号翻转、套利摩擦与爆仓级联厚尾 |

---

## 2. 现状横评对照表（`trade` vs 外部框架与文献）

| 维度 | 外部框架 / 文献主流做法 | `trade` 现状（代码与技能精确位置） | 判定 |
|---|---|---|---|
| 假设预注册与机制对齐 | AlphaAgent LLM 语义对齐；多数框架无硬性预注册锁 | **已覆盖且显著更严**：`registration/register.py:58-121, 209-256, 317-330`（强制 `prediction.mechanism`、`outcomes`、`changed_duties` 与文件头 diff 一致 `DUTY_HEADER_MISMATCH`、禁用纯计数预测 `_check_counting`、预检独立代码审查、`SOURCE_ALREADY_EXPOSED`） | 已覆盖 |
| LLM 训练数据前视泄露防护 | 多数开源框架未约束 | **已覆盖**：`.agents/skills/research-round/references/hypothesis.md:19-21` 明确禁止用模型训练记忆充当外部证据或局部诊断 | 已覆盖 |
| 统计检验与序列相关 | 普通年化 Sharpe / IC；White RC / Hansen SPA | **已覆盖**：`report/comparison.py:99-215`（成对环形块自助法 + 嵌套学生化区间 + 80% 功效可检出年化差 + 网格 Bonferroni）；`report/measures.py:159-252`（Newey-West 1994 自动带宽 HAC、Dimson 滞后市场回归、Lo 2002 序列相关夏普 `sharpe_lo`） | 已覆盖 |
| 多重检验与 DSR | Bailey & López de Prado (2014) DSR；Harvey-Liu-Zhu $t > 3.0$ | **已覆盖**：`report/measures.py:258-294` 实现精确 DSR；`report/status.py:287-435, 487-496` 计算跨线重叠试次的 `effective_trials`（eq. 9）与 `trials_with_sweeps`（含 `search_exposure` 声明的离线变体）双端区间；`report/history.py:153-173` 增加跨线留出泄露 `holdout_prior_trials`；`ratios.md:12-19` 禁自算与禁当门槛 | 已覆盖 |
| 样本外与跨周期验证 | 静态切分或 CSCV/PBO | **已覆盖**：`report/history.py`（收线回溯年度否决 + 对照复现 + 2 年留出 + 前向段）；`report/comparison.py:480-574`（时间戳公证前向验证 + `window_read_before_binding` + Holm 校正） | 已覆盖 |
| 交易成本、滑点与流动性容量 | 固定手续费率，鲜见盘口深度校核 | **已覆盖**：`report/profit.py:42-85`（精确 `price/fee/funding/open_mark/account` 桥）；`report/runs.py:57-92`（2bp/5bp 滑点压力）；`report/measures.py:379-390`（`breakeven_fee_multiple`）；`review.md:37-41`（<1.5 或 2bp≤0 先降换手）；`capital.md` + `depth.md`（分钟成交量占比 + Binance `bookDepth` 校验） | 已覆盖 |
| **失败归因复用与防深链堆砌** | RD-Agent 反馈三元组与多路径 DAG 分支；AlphaAgent 复杂度与原创性正则 | **存在缺口**：`feedback.md:48-79` 仅在连续 5 次无区分运行触发 `Change of approach.` 时才命名瓶颈和查 `research graph`；日常单次 `interpretation` 缺少四类归因结构，日常选点未明确要求检查谱系防重复微调、优先从更简祖先分叉 | **存活缺口 #1** |
| **非正态样本量估算（MinTRL）** | Bailey & López de Prado (2012) MinTRL 计入偏度与原始峰度 | **存在缺口**：`validation.md:28` 仅泛提“按计划频率与日收益离散度建议窗口长度”；`ratios.md` 未给出 MinTRL 公式及 `sharpe_lo` 正序列相关放大提示，而 `report/measures.py:290` 在 DSR 中已使用同一非正态方差因子 | **存活缺口 #2** |
| **永续合约单笔尾部集中度与资金费率状态依赖** | He et al. (2022) / Ackerer et al. (2024) 资金费率牛熊切换与爆仓尾部集中 | **存在缺口**：产品已有按天（`residual_after_top5_days`）、按合约（`net_without_top_instrument`）、按年（`dev_years`）和波动率状态（`by_regime`），但技能缺少对**闭仓周期（cycle）Top-K 尾部集中度**与**分方向/分年资金费率 vs 纯价格净利依赖**的诊断规范 | **存活缺口 #3** |

---

## 3. 经反驳存活的高 ROI 缺口与精确改法

以下 3 项均通过 `product-doctor` 第 6 步自我反驳检验：**不新增任何账本存储字段、不改代码、不改用户研究目标、不增加常驻会话 frontmatter 词数、不引入任何新硬门槛**。

### 缺口 1：日常 `interpretation` 四类归因 + 谱系防重复与祖先分叉纪律
- **防止的真实失败模式**：LLM 量化研究中最常见的浪费不是完全没思路，而是（a）把“毛利预测成立但手续费/换手吃掉收益”误判成信号失效，反复改阈值；（b）在单条深链上线性堆砌第 4、5 层耦合过滤，或换个参数名重复测试同一职责与瓶颈。
- **为何代码未覆盖**：`registration/register.py:549-571` 仅强制存在 `interpretation` 判断，不审核其归因维度；`candidate publish --parent` 原生支持 DAG 任意祖先分叉，但技能未引导 Agent 在深链堆砌前优先分叉或删规则。
- **改动**：仅更新 `.agents/skills/research-round/references/feedback.md`（净增 144 词）：
  1. 在 `## Interpret evidence` 要求对亏损、与对照未区分或违背预测方向的运行，按 **机制失效 / 费用与执行拖累 / 敞口与规模混淆 / 集中度与状态依赖** 四类归因并引用对应报表切片，使后续轮次直接复用失败轨迹；
  2. 在 `## Choose the next experiment` 要求先查谱系（`research graph --line LINE --without-comparisons --without-counts` 及既有 `interpretation`）避免同一职责与瓶颈下的表面参数重复，并在深链堆砌多条耦合规则时优先从更简祖先分叉或移除未独立验证的旧规则；
  3. 在 `## Change approach` 要求权衡的 2–3 条路径在结构上正交（不同职责或机制，包含从更简祖先分叉而非只延续最新叶节点）。

### 缺口 2：非正态最小轨迹长度（MinTRL）与样本外窗口定长
- **防止的真实失败模式**：加密永续策略普遍呈负偏度与厚尾高峰度，按正态直觉估算验证窗口会系统性低估所需交易日数，诱使 Agent 给出过短（如 1–4 周）的样本外窗口或高估短窗口统计功效。
- **为何代码未覆盖**：样本外窗口由用户与 Agent 在登记前商定；`report/measures.py:290` 在 DSR 中已用 `1 - skew * sharpe + (kurt - 1) / 4 * sharpe ** 2`，但单跑报表未单独输出 MinTRL，且 `validation.md` 原文未给出非正态样本量计算方式。
- **改动**：
  1. 在 `.agents/skills/nautilus-report-analysis/references/ratios.md`（净增 134 词）补充 Bailey & López de Prado (2012) MinTRL 公式（使用与 `measures.py` 一致的**原始峰度** $\gamma_4$ 与日度夏普 $\widehat{SR}$），要求引用 `ledger_commit` 与全部输入，明确标注其为**描述性样本量检查而非通过门槛、且绝不替代产品 DSR 或自助法区间**，并在 `sharpe_lo` 的 $\eta < \sqrt{365}$ 时注明正序列相关使真实所需长度高于 i.i.d. MinTRL；
  2. 在 `.agents/skills/research-round/references/validation.md`（净增 11 词）对窗口长度建议补充交叉引用。

### 缺口 3：加密永续闭仓周期尾部集中度 + 资金费率/价格净利状态依赖
- **防止的真实失败模式**：
  - 多日持仓的趋势/套息策略，一笔跨越 10 天的幸运单不会被剔除 5 个交易日（`residual_after_top5_days`）暴露，却可能在剔除前 3 笔闭仓周期后整体翻负；
  - 永续合约单边偏置策略在牛市高正资金费率年份靠收取资金费率盈利，去掉 `funding` 后纯价格净利（`price_pnl - commissions`）为负，一旦进入熊市或负资金费率状态即结构性失效，而波动率切片（`by_regime`）无法分辨资金费率方向切换。
- **为何代码未覆盖**：`tables()["positions"]` 已完整提供逐笔闭仓的 `price_pnl`、`commissions`、`funding`、`realized_pnl`、`side` 与 `reconciled` 校验和，但 `replay report` 不计算周期级 Top-K 残差，也不提供分方向×分年的资金费率/价格拆分。
- **改动**：
  1. 新增按需加载参考 `.agents/skills/nautilus-report-analysis/references/robustness.md`（245 词），规范上述两项诊断（强制核对 `reconciled`、标明总体与 `ledger_commit`、严禁当准入门槛或单独作为加过滤规则的理由、若驱动决策须独立复算并登记 `search_exposure`）；
  2. 在 `.agents/skills/nautilus-report-analysis/SKILL.md` 的 `## References` 仅新增 1 行索引（净增 12 词）。

---

## 4. 明确拒绝的外部做法（及反驳依据）

| 外部做法 | 来源 | 拒绝理由 |
|---|---|---|
| **CSCV / PBO（回测过拟合概率）** | Bailey et al. (2017), DOI `10.21314/JCF.2016.322` | 要求对称静态网格矩阵（通常 $N \ge 20$–$100$），与 `trade` 的单批小网格上限（`GRID_LIMIT = 5`, `registration/register.py:42`）及自适应序贯探索假设冲突；且容易制造“开发期内已证明不过拟合”的错觉，违背 `research-round/SKILL.md:195-197`。现有收线历史检验（回溯否决 + 2 年留出 + `holdout_prior_trials`）与邻域平台检查（`review.md:31-34`）已构成更严格防线。 |
| **Harvey-Liu-Zhu $t > 3.0$ 硬门槛 / DSR 准入线** | Harvey et al. (2016), DOI `10.1093/rfs/hhv059` | 违背 `AGENTS.md`（不擅自增设或改变研究目标之外的拒绝门槛）与 `ratios.md:18`；$t > 3.0$ 针对数十年美股 300+ 横截面因子库标定，直接套用于 3 年加密永续策略会错杀有效机制或诱导刷指标。 |
| **White's Reality Check / Hansen's SPA 独立检验引擎** | White (2000), DOI `10.1111/1468-0262.00152`; Hansen (2005), DOI `10.1198/073500105000000063` | 与产品既有的成对环形块自助法 + 网格 Bonferroni + 样本外 Holm（`report/comparison.py`）以及跨线 DSR 区间（`report/status.py`）功能重叠；且 `nautilus-report-analysis/SKILL.md:27` 明确禁止在技能脚本中另行构造统计检验。 |
| **RD-Agent Co-STEER / MAB 调度器 / QuantAgent LangGraph 编排 / FinMem 记忆库** | `arXiv:2505.15155`, `arXiv:2509.09995`, `arXiv:2311.13743` | 违背 `AGENTS.md`（不另建并行工作流引擎、调度器或状态记忆；Dolt 账本即唯一持久记录，多研究线并行与 DAG 谱系已原生具备）。 |
| **AlphaAgent AST 相似度/复杂度代码引擎** | `arXiv:2502.16789` | 面向 Qlib 短公式因子树设计，对完整有状态 Nautilus `Strategy` 生命周期类噪音极大且易误判；策略探索与简化原则属 Agent 技能层，不属产品代码信任边界（`AGENTS.md` Code or Agent）。 |
| **股票横截面因子默认范式（Alpha158 / IC / RankIC 选股）** | RD-Agent(Q) / AlphaAgent 股票基准 | 加密永续单合约与小篮子不具备 300–500 只股票横截面大数定律，强用 RankIC 会掩盖资金费率方向、爆仓级联和 BTC/ETH 相关性主导风险。 |

---

## 5. 改动与净词数汇总（遵循 `.agents/README.md`）

- **常驻会话 frontmatter 净词数变化**：**0 词**（未修改任何 `SKILL.md` frontmatter `description`）。
- **主 `SKILL.md` 净词数变化**：**+12 词**（仅 `.agents/skills/nautilus-report-analysis/SKILL.md` 新增 1 条参考链接；`research-round/SKILL.md` 与 `research-start/SKILL.md` 均 +0 词）。
- **按需加载 `references/` 净词数变化**：**+534 词**（`feedback.md` +144、`validation.md` +11、`ratios.md` +134、新增 `robustness.md` +245）。
- **新增独立评测用例（未改动任何既有 eval 或 grader）**：
  1. `.agents/evals/research-round/interpretation-failure-attribution-and-branching/`
  2. `.agents/evals/nautilus-report-analysis/mintrl-non-normal-window-sizing/`
  3. `.agents/evals/nautilus-report-analysis/cycle-tail-and-funding-regime-check/`
