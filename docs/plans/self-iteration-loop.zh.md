# 研发工作流的自迭代环：现状、边界与改动范围

2026-10-25 用户提出：产品能否结合 Agent 领域文献做成自迭代——一个会话跑 `research-start` 研究，另一个会话用 `product-doctor` 审计上一轮，用户授权修复，再跑下一轮。本文件记录核实过的现状、文献对照、边界与分批改动，是后续 PR 的依据。

## 结论

这个环已经存在，并以 `product-doctor` 的形式跑过五轮会话诊断（`docs/plans/doctor/` 2026-10-20 至 10-23，另有八份聚焦诊断与验收）。文献里它叫对 harness 的反思式/演化式优化（ADAS、Darwin Gödel Machine、SICA、GEPA、ACE），是正向证据最多的一类。但按文献的标准它目前是缺陷跟踪流程，不是自迭代：缺一个可测、且不由提议者自己算的「这一轮改好了没」信号。

## 文献对照

| 条件 | 依据 | 内环（策略研究） | 外环（doctor → skill/产品） |
|---|---|---|---|
| 评价器在被改对象之外，提议者碰不到 | AlphaEvolve（arXiv:2506.13131）的用户 `evaluate`；DGM（2505.22954）node 114 删检测器日志刷满分；ImpossibleBench（2510.20270）76% 靠改测试「通过」 | 有：拒绝、审计、资格由代码算；Agent 不能改检查、目标、镜像（AGENTS.md） | 没有：评测是 LLM 判「你会怎么做」的叙述，rubric 在仓库里研究 Agent 读得到，修复者能改 grader |
| 回归控制，否则一次性提升不复合 | Wang/Kattakinda/Feizi 2026（2607.14004）：三个优化器里只有带回归控制的持续改善；Shao 等 Misevolve（2509.26354） | 账本只追加、一假设一改动、预登记 | 半套：索引有 `recurred`，但「fixed → 真实会话验证」靠人，很多路径下一轮不触发 |
| 提议者、执行者、判官分离，判官换模型家族 | SICA（2504.15228）overseer；Panickssery 2024（2404.13076）自偏好；Wahi 2026（2609.02246）role split | 独立源码审阅要求 fresh | 纸面有，实际未一贯做到（下文事实 2） |

其余直接用到的结论：Huang 2023（2310.01798）无外部事实的反思不是信号；Trace/OptoPrime（2406.16218）审执行轨迹不审自述；ACE（2510.04618）skill 只做条目级增量编辑；Voyager（2305.16291）skill 用过并验证才入库；AI Scientist v1（2408.06292）Agent 自己延长超时——评价器与运行时必须在 Agent 写集之外。

## 核实过的四个事实

1. 「修复合入后下一轮必跑新版」不是代码强制。`require_fresh`（STALE_CHECKOUT）只在 `replay/entry.py` 的 `if validation is not None` 下调用，`require_main_build` 只管样本外验证；研究回放在任何 checkout、任何镜像上都能跑，记录显示会话在 worktree 上跑过。这一步靠用户纪律。不扩成研究路径的拒绝：它会在 main 每次前进后的下一次登记打断长会话，并逼 Agent 会话中途换 skill 版本；而且落后的 checkout 只伤 Agent 自己的工作，不是信任边界。审计者从 `run_sealed.metrics_revision` 就能算出这轮是否跑在包含修复的提交上。
2. 「另一个 Agent」没有一贯做到。2026-10-22 四份记录的 Sessions 行写的就是研究那个 chat（`01a15f8b…`）；记录表头没有一行记 doctor 自己的宿主、模型、会话，所以「不同模型家族审计」无法从档案核查。
3. 评测目前不是信号。索引里所有「eval 3/3」都来自 `--ablation none`；#1645、#1646 的 PR 正文写明第一次 1/3、改 grader 后 3/3——写 grader、写修复、当判官是同一人、同一 PR、同一模型家族。唯一一次 with-without 运行六个 arm 全部报错：plugin 根是仓库根（约 83k 项，`docs-site/node_modules`、`.venv`、`.claude/worktrees`），超过运行器 20000 项的扫描上限。107 个用例全部 `allowed_tools: [Read, Glob, Grep, Skill]`、判最后一条回复，测的是会不会复述规则，不是行为。
4. 过程读数在地板上或被混淆，复发已发生三次。产品造成的无效试验连续四轮为 0；用户先发现 2、0、1、0、2 无趋势；每版本 token 上升源于 Agent 复用核查代理，与修复无关；五轮没有两轮在同一路线、同一 schema、同一镜像上。20261020-13（修→删→复发→再加）、20261022-10（skill→复发→authority）、20261022-13（修→复发→再修）。每份记录的 Convergence 段写的都是「未证明」。

## 边界

外环能测的是产品有没有浪费 Agent 的工作（无效试验、复发、规则遵从、成本），测不了研究有没有变好。开发窗口里的策略绩效和用户的两项研究目标不作为任何 skill 或产品改动的适应度（会 Goodhart 到开发窗口）；唯一的策略层信号是用户发起的样本外验证，按设计不回灌。因此「自迭代」指研发工作流的自迭代。

环能改进的三类东西，走不同通道：

- bug、文档与实现不一致、冗余：已是 doctor「产品契约与交付」工作流与 removal test 的主体，过去五轮 fix/remove 多于 skill（#1633、#1637、#1622；20261020-37 约 20 个代码页与 4 个 skill 页；U1–U6、#1636）。
- 投研方法论：(a) 报告与归因维度、统计量——进入条件是会话里证明缺了它导致判断不成立（20261022-09 → #1639），不是论文里有（20261020-31 产出的 `by_regime` 切片无人读）；日常路径是 Agent 在 `nautilus-report-analysis` 里自己算并记成判断，几条线反复用到再升到 skill 参考文件；只有 Agent 不该自己算的数（否则它给自己打分）才进产品代码。(b) 过拟合——产品已有预登记、一假设一改动、登记时锁定检验设计、`search_exposure` 判断、折扣夏普、开发结论只算条件观察、样本外由用户发起；改变「什么算证据」等于改评价器，只能带证据提议、用户决定（PBO/CSCV 已于 2026-10-25 定为不纳入默认报告，见 [pbo-report-boundary.zh.md](pbo-report-boundary.zh.md)）。(c) 新模型、指标、公式——是策略研究本身，经 `research-sources` → 假设 → 候选 → 回放，产品不把指标或模型写成代码。
- 凡是改「量什么、怎么判」的（新资格检查、新封存读数、新拒绝、研究目标）永不自动：环的上限是带证据的提议，与 doctor 现有的 `authority` 动作同一个门。

## 改动范围

产品代码零改动：不加拒绝、字段、评分、调度器、CI 守卫；不建 transcript 副本目录、不存评测聚合结果入库、不写强制 revert 规则；现有评测用例不删（叙述式用例以后按低 ROI 规矩单独议）。

第一批（评测变硬）：

- 本文件。
- plugin 根改为 `.agents/`：清单挪到 `.agents/.claude-plugin/plugin.json`，评测套件挪到 `.agents/evals/<skill>/`，与 `.agents/skills/` 并列，不加任何链接；运行器的目录扫描只覆盖这几百项。先试过的「小目录 + 指向外面的 `evals` 符号链接」被运行器明确拒绝（eval 目录链接指向 plugin 之外），所以评测只能物理地放在 plugin 根之下，2026-10-20 定的「评测放仓库顶层 `evals/`」让位于「要能跑」；skill 目录只放运行内容这一条不变。用例里的 `plugins: ["../../.."]` 自 `.agents/evals/<skill>/<case>` 解析仍指向 plugin 根，107 个 prompt 不改。命令从仓库根执行：`claude plugin eval .agents --no-publish --trust-plugin …`，`ANTHROPIC_API_KEY` 不设（设了会走已停用的组织）。冒烟：`finding-needs-proof` 各 arm 一次，with 过、without 不过，85 秒、约 0.27 美元。
- `README.md`、`AGENTS.md`、`docs/rd` 各 skill 设计页的评测路径改到 `.agents/evals/`；`.github/pull_request_template.md` 要求评测结果写明命令、用例、ablation、runs、judge model 与各 arm 通过数。

第二批（记录能回答「好了没」）：

- `product-doctor/references/record.md`：索引状态词加 `verified <record>`、`unobserved`；表头加一行 doctor 自己的宿主、模型、会话。`fixed <commit>` 不是终态；未触发的路径不算 verified。
- `product-doctor/SKILL.md` 加一条拒审规则（收紧 skill 检查，用户 2026-10-25 授权）：要审的 transcript 若是本会话或其子代理，或研究会话与本会话在同一宿主，就停下不审，给出正确步骤——结束研究会话；在另一宿主开全新会话；只给 transcript 路径、账本提交区间、checkout 提交；再调 `product-doctor`。配评测用例与设计页绑定。它的本质是 Agent 自己拒自己，靠评测与表头那行兜底。
- `product-doctor/references/lenses.md`「对照外部规范」加上研究方法论文献（经 `research-sources`），方法论复查即 doctor 聚焦模式，由用户一句话触发。
- `docs/rd/design-skill-product-doctor.mdx` 与 `.zh.mdx` 先改（文档是规格），绑全现有三个评测用例。
- `docs/plans/doctor/index.zh.md` 28 行未结项按新状态词重标一次；记录本身不动。

第三批（角色分离做实）：

- `AGENTS.md`「Checks and PRs」加三行（用户 2026-10-25 看过文字后授权）：修复 PR 从诊断记录和索引出发、不从审计会话出发；一个根因一个 PR，正文写发现编号；只增改自己发现的评测用例，不动别的 grader，grader 改动单独 PR。
- 三个做法上的习惯，不进文件：研究会话起步前确认 checkout 含 origin/main；审计在另一宿主的全新会话；修复再开一个会话。

不加宿主 hook：PreToolUse 可以在本会话已有登记写入时拦下 `product-doctor`，但改宿主配置是授权项、Codex 侧无对等机制、同一条规矩放两处；先看表头那行，skill 规则真被跳过了再议。

## 验收口径

连续两三轮：`recurred` = 0、用户先发现 = 0、`unobserved` 不单调增长；且只对研发工作流成立，不对研究质量成立。

## 几轮后再议

- 内环成本进代码可见面：每版本回放次数与时长在 `research status` 读时算，不加字段。
- Agent 自写 Goal 停止规则（`research-start/SKILL.md` Goal 一节）。
- 叙述式评测用例是否按低 ROI 规矩删除。

## 决定

- 2026-10-25 用户：同意第一批范围；授权在 `product-doctor` 加「同会话/同宿主拒审」规则；同意 lenses.md 外部规范加研究方法论文献；`AGENTS.md` 第三批两行文字先看再定。
- 2026-10-25 第一批 #1676 已合并。第二批与第三批合为一个 PR：record.md 状态词与审计会话行、SKILL.md 拒审规则（含理由：不共享上下文、换模型家族）与用例 `audits-own-session-refused`、lenses.md 方法论文献一句、设计页 K.4、索引重标、AGENTS.md 三行；用户看过文字后一并授权，并知悉将来若在单一宿主上既研究又审计，改这条规则仍需授权。
