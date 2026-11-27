# `product-doctor` v3.1 演进方案：投研方法论对标与线上静默异常深度闭环（2026-11-27）

- **前序基线**：`exp/doctor-v2-convergence` (`7952aedbc`，v2 收敛 + v3.0 `--prod-logs` / 研发合规 / `--auto` / `--steady-exit-code` + Phase 3 `self` 演化) 与 `exp/feat-3786-soak-fixture` (`0fcbdf345`，6 合约离线浸泡与故障注入夹具)
- **目标读者**：Owner 与后续接手审阅/拆 PR 的 Claude
- **问题背景**：v3.0 已经补齐了代码健康度、跨语言 `recheck`、研发硬红线合规（直连 SQL / 凭据读取 / 漏载 skill）和生产日志显性事故（OOM / `exit 137` / checkpoint defer / 重连）的确定性抓取；但仍有三类深层盲区尚未闭环：
  1. 研发会话只抓“违规操作”，还未定量度量“探索质量与方法论退化”；
  2. 过去多次靠外部论文与成熟项目（如 R&D-Agent 等）推动 `research-round` 演进，但目前 `product-doctor` 缺少把外部前沿方法论系统化对标到现有技能的固定机制；
  3. `--prod-logs` 只能抓显性报错，抓不到“无 ERROR、无崩溃但结果出错或状态停滞”的线上静默故障（如 Phase 3 刚发现的退市合约冻结 `market` `head`、平静日 Telegram 日报静默丢失、孤儿进程误派 `resume`）。

---

## 一、支柱 1：投研会话质量定量指标（从“硬合规”升级到“探索质量度量”）

### 1.1 设计原则
- **零新增 ledger 存储字段**：所有指标仅从现有只读数据派生——Agent transcript JSONL（Claude Code / Codex / Antigravity）+ 只读账本导出（`cli.main` 输出的 trial/line 摘要 JSON）。
- **低误报、可解释**：只输出有明确行为锚点的确定性比率与样本位置，不靠玄学打分触发误报；沿用 `friction.py` 的脱敏、流式内存与纯 stdlib 约束。

### 1.2 新增四项确定性指标（扩展 `assets/friction.py`）
| 指标 | 计算口径（纯只读派生） | 捕获的典型投研退化 | 建议触发门限 |
|---|---|---|---|
| `param_churn_ratio` | 同一 `research-round` 会话内，连续 trial 仅改数值参数、未改假设/机制描述的占比 | 退化为盲目 grid search / 过拟合调参，而非假设驱动研发 | `>= 0.70` 且 trial 数 `>= 5` |
| `unattributed_pivot_count` | 前一轮 trial 失败/不达标后，未出现读取报告或归因分析步骤（`nautilus-report-analysis` / 读回放表）就直接发起下一轮新方向/新策略的次数 | “失败不复盘直接乱换方向”，浪费探索预算 | `>= 2` 次/会话 |
| `prereg_drift_count` | 会话中已预注册假设/参数集合，但在未记录新预注册的情况下运行了未声明标的、周期或执行模式的次数 | 事后找补、悄悄扩大搜索空间（HARKing / p-hacking 风险） | `>= 1` 次即告警 |
| `evidence_gap_claims` | 最终研发总结中引用了具体指标数值，但 transcript 中找不到对应只读命令/分析输出支撑的次数 | 幻觉报数或夸大验证范围 | `>= 1` 次即告警 |

### 1.3 调度接入（`assets/scheduler.py`）
- 纳入 `friction_summary.research_quality`；当任一高置信阈值持续命中（或连续 2 个研发会话重复触发）时，在 `advise` 中生成 `friction` 候选，作用域自动绑定 `.agents/skills/research-round` + `.agents/skills/nautilus-report-analysis`，避免把策略本身偶发失败当成产品 bug。

---

## 二、支柱 2：外部方法论对标透镜（系统化吸收 R&D-Agent / 前沿定量实践）

### 2.1 为什么不把“读论文”塞进每次日常巡检
- 日常高频 `--auto` 巡检应专注止损（`harm`）、线上事故、代码退化与覆盖 SLA；频繁做外部文献综述既慢又容易制造空泛“改进建议”。
- 因此将外部方法论对标设计为**低频、高门槛、强证据**的专项透镜，直接复用仓库既有的 `research-sources`（OpenAlex / Crossref / Semantic Scholar 等）与 `SKILL.md` Step 5（Challenge quiet choices）+ Step 6（Refute）。

### 2.2 在 `references/lenses.md` 新增 `methodology` 透镜
- **归属分组**：`Audit` 组新增一条：
  - **`methodology` [research-loop / validation / evaluation]**：按固定周期（建议 SLA `60–90 天` 或跨大/小版本线发布前）通过 `research-sources` 对标近期外部前沿研究与成熟开源实现（如 R&D-Agent 演化式假设树、定量实证多重检验控制/Deflated Sharpe/Walk-Forward 防泄露、自动化实验编排与失败归因机制），对照本仓 `research-start` / `research-round` / `nautilus-report-analysis` 与 `report/` 检验链路。
- **反空谈硬约束（防纸上谈兵）**：
  1. 每条对标结论必须给出**可检验的当前缺口**（引用本仓既有研发会话 transcript 或账本失败案例，而非“论文这么写所以我们也要加”）；
  2. 严守 `AGENTS.md` “Code or Agent” 边界：能用 skill 规则或评估方法解决的，**绝不**在产品里造平行工作流引擎或新增 ledger 存储字段；
  3. 必须经过 Step 6 独立反驳子代理检验“改动后是否真的能挡住一个已知失败模式，还是只增加 Agent 上下文负担（`burden` 透镜反向制衡）”；
  4. 通过反驳的方案沉淀为 `docs/plans/` 提案 + 对应 skill eval case，走正常 A/B 评测（`claude plugin eval .agents`）后才合入。

---

## 三、支柱 3：线上 Paper / Live 静默异常不变量对账与只读采集闭环

### 3.1 补齐 `--prod-logs` 的结构性盲区：从“扫报错”到“查不变量”
Phase 3 实证表明，最危险的线上缺陷往往**不打 ERROR、不抛 Traceback、不 OOM**。v3.1 建议在 `doctor.py friction` 中新增可选只读快照输入 `--prod-state <snapshot.json>`（与 `--prod-logs` 并列），由宿主机只读采集脚本生成脱敏摘要 JSON（绝不读取 `.env`、`dolt/service.json` 或交易凭据），校验以下 **5 条线上静默不变量**：

| 静默不变量 | 判定条件 | 捕获的真实故障类型 |
|---|---|---|
| **1. `market_head_staleness`** | 活跃 USDT 永续合约整体 `latest_day` / `head` 滞后当前 UTC 日历超过阈值（例如 `> 2 天`），且非全市场停盘 | 退市合约/异常合约冻结全局拉数推进（如 Phase 3A-1 P0） |
| **2. `paper_checkpoint_stall`** | 运行中 Paper 策略连续存活 `> 2h` 且无新 checkpoint 推进，或长期卡在 `WARMING` 超过热身窗口 | 订阅/定时器导致的静默 checkpoint 饥饿（如 `#3783` 变种） |
| **3. `orphan_unsealed_age`** | 存在超过 `600s` 未封存的 `unsealed` 孤儿运行目录仍未被 daemon `seal` | 守护进程恢复/封存派发错乱（如 Phase 3B-2 P1） |
| **4. `compare_unexplained_drift`** | 周期只读执行 `paper compare` / `live compare` 出现 `unexplained` 非空或挂单/仓位分歧 | 静默漏单、强平对账漂移、价格/资金费率口径失真 |
| **5. `notify_heartbeat_missing`** | 活跃 Live/Paper 监控周期内缺失预期日报事件记录（即使当天 0 成交） | 类型错配或静默吞异常导致监控失明（如 Phase 3B-1 P1） |

任一静默不变量违背均与 `PROD_INCIDENT_PREFIXES` 同级处理：在 `advise --auto` 中**直接高优抢占**，不可被 cooldown 压制。

### 3.2 只读采集管道与 200U 测试账户反哺 `tests/soak/`
1. **定时巡检编排（外部 cron / 只读脚本 → `/tmp/doctor-prod-<ts>/`）**：
   - 步骤 A：只读拉取近期 `paper` / `live` / `market` / `ledger` / `ide` 日志片段到 `/tmp`；
   - 步骤 B：只读采集上述 5 项不变量摘要写入 `/tmp/doctor-prod-<ts>/state.json`；
   - 步骤 C：运行 `doctor.py advise --tree HEAD --auto --steady-exit-code 2 --issues-json ... --ci-json ... --prod-logs ... --prod-state ... --transcripts ...`；
   - 退出码 `2` 表示稳态无异常直接静默结束；退出码 `0` 表示有高优事故或可行动缺陷，拉起诊断/修复流程。
2. **实盘边缘样本反哺离线浸泡夹具（`tests/soak/`）**：
   - 每次通过 200U 专用合约测试账户或线上日志捕获到新的交易所非标响应、网络乱序或状态机边缘问题时，强制把**脱敏后的最小复现载荷**加进 `tests/soak/`（`exp/feat-3786-soak-fixture`），让后续每次 PR 和 Doctor 巡检都能在本地秒级拦截同类回归，而不是反复靠实盘踩雷。

---

## 四、实施拆分与门禁约束（供 Claude 审阅与排期）

建议在现有 14 条分支合入 `main` 且完成 `claude plugin eval .agents` 基准采样后，拆为 **3 个独立小 PR** 渐进落地（均直接基于最新 `main`，不堆叠）：

1. **PR-1（线上静默不变量）**：`assets/friction.py` + `assets/scheduler.py` 增加 `--prod-state` 5 条静默不变量校验与抢占逻辑 + 单元测试 + 2 个 eval cases（直接收益最高，紧接 Phase 3 线上问题）。
2. **PR-2（投研会话质量指标）**：`assets/friction.py` 增加 4 项只读派生探索质量指标 + `SKILL.md` 说明 + 单元测试 + 2 个 eval cases（先用历史真实研发 transcript 做离线回测校准阈值，确认 0 误报再开触发）。
3. **PR-3（外部方法论对标透镜）**：`references/lenses.md` 新增 `methodology` 低频透镜 + `scheduler.py` 60–90 天 SLA 周期支持 + 1 个 eval case，并在下一次大/小版本线切换前做首次实战验证。

### 硬性工程约束
- `product-doctor/assets/*.py` 继续保持 **100% 纯 Python stdlib**，不引入第三方依赖；
- 单文件最大认知复杂度保持 `<= 47`（如新增逻辑触近上限，拆分子函数或独立纯 stdlib helper，不得让健康度退化）；
- **零新增 ledger 存储字段**、**零修改字体**、**绝不读取/落盘任何凭据**；
- 每项新增功能必须附带 `tests/product_doctor/test_doctor_v2.py`（或对应模块）单测、`evals/product-doctor/` 用例（软链 `graders/skill-fired.md`）并通过 `doctor.py delta origin/main HEAD` 帕累托校验。
