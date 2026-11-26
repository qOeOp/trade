# product-doctor v2 收敛控制原型：实证回测、开源工具基准与踩坑记录（2026-11-26）

- **实验分支**：`exp/doctor-v2-convergence`（基于 `origin/main` `d4460250a`，紧接 `#3780`/`#3781`）
- **关联 Issue**：`#3785`（长期收敛、防膨胀、防盲区、显式停止）；同时收口 `#3762`（多轨数据错位覆盖），并复核了远程全部 19 条 doctor 相关 issue（`#3706`、`#3762`、`#3764`–`#3781`、`#3785`）
- **目的**：在隔离分支先做出一版可运行的闭环原型并跑通真实仓库回测，为后续正式 R&D 迭代（Claude 接手）沉淀已验证的经验与踩过的坑。

---

## 一、已收集远程 Doctor Issue 全景与边界

| 类别 | Issue | `origin/main` (`d4460250a`) 现状 | 本原型定位 |
|---|---|---|---|
| 已合入基座 | `#3706`, `#3769`–`#3781` | `doctor.py scan` / `scope`、按行数占比动态拆树、分组 `lenses.md`、`cost` 噪声判定、`recheck` 排除 `.agents/evals/` 均已在 `main` | 完全保留并兼容全部 17 条既有单测 |
| 盲审覆盖缺口 | `#3762` | 通用段已提多轨，但 `flow` 未明示 bars / `--metrics` / `--execution quotes` / 晚上市池合约错位起点 | 在 `lenses.md` `flow` 补入明确要求 |
| Eval 稳定性测量 | `#3764`–`#3768` | 均为 `needs-evidence` 的 `measure` 项（需用 `claude plugin eval` 复测与逐题重判） | 本原型不改任何现有 eval grader，遵守 `AGENTS.md` |
| 长期收敛架构 | `#3785` | `scan` 仅有原始行/提交数，无结构复杂度/克隆/耦合/振荡遥测，无反膨胀硬触发，无 `steady` 停止状态 | **本原型核心实现目标** |

---

## 二、样本外历史回测与开源工具基准（关键实证发现）

### 1. H1 / H5 样本外回测（训练窗 `d-30..d-14` → 测试窗 `d-14..now`，205 个生产 `.py` 文件，98 个未来有 ≥2 次 fix）

| 排序器 | P@15 | P@30 | 捕获未来 14 天 fix 数（Top 15 / Top 30） | 结论 |
|---|---:|---:|---:|---|
| Baseline: 仅按 LOC | 86.7% (13/15) | 86.7% (26/30) | 141 / 225 | 大文件天然缺陷体量大 |
| Baseline: 原始提交数 | 86.7% (13/15) | 73.3% (22/30) | 112 / 196 | 易被重构/文档类提交稀释 |
| Baseline: 绝对 churn | **93.3% (14/15)** | 76.7% (23/30) | **158 / 227** | Top-15 命中率与捕获量最高 |
| **H1a: 相对 churn (`churn/LOC`)** | **66.7% (10/15)** | **63.3% (19/30)** | **75 / 139** | **被本仓证伪（重要踩坑）** |
| H1b: 过去 14 天 fix 连击数 | 80.0% (12/15) | 80.0% (24/30) | 111 / 198 | 对振荡模块高度稳定 |

- **H5（Fix-on-Fix 振荡）强验证**：训练窗 `≥3` 次 fix 的 37 个文件中，**89.2%** 在未来 14 天继续被修，平均每文件 **5.95** 次 fix；而非连击组（168 个）为 61.3%、平均 **2.15** 次——**均值倍数达 `2.76×`**。
- **跨包时间耦合验证**：单趟 git 历史即检出本仓最脆弱的真实跨包契约：`cli+report`（31×）、`engine+live`（26×）、`cli+ledger`（22×）、`cli+replay`（20×）、`cli+shared`（19×）、`ide/web/src/model+report`（18×），直接对应 `doctor.py` 的 `A+B:SCENARIO` 语法。

### 2. 开源静态工具基准（Python 3.14 / macOS，`uvx`）

| 工具 | Python 3.14 兼容 | `engine/` 耗时 | 实测优缺点与结论 |
|---|---|---|---|
| `complexipy 9.0.0` (Rust) | 兼容 | `0.06s` | 极快、精确；与我们纯 stdlib `telemetry.cognitive_complexity` 在 `engine/warmup.py` 上 **13/14 函数完全一致**（仅推导式内 `if` 有细微差异） |
| `vulture 2.16` | 兼容 | `0.21s` | 对标准库回调重写参数（如 `HTTPRedirectHandler.redirect_request` 的 `req/fp/msg/newurl`）报 100% 置信度假阳；而本仓 `tests/test_source_hygiene.py` 已零假阳覆盖顶层未用定义 |
| `deptry 0.25.1` / `radon 6.0.1` | 兼容 | < 1s | 可按需通过 `uvx` 外挂，但 `tests/test_source_hygiene.py` 禁止在受控 `.py` 中引入未声明第三方依赖 |

**工程决策**：核心遥测与调度模块（`telemetry.py` + `scheduler.py`）采用 **100% Python 标准库零依赖实现**，直接从 `git cat-file --batch` 与 `git log` 读取任意 `rev`，既满足 `test_source_hygiene.py`、离线/`git archive` 隔离要求，又无需改 `pyproject.toml`/`uv.lock`。

---

## 三、本原型实现的 4 项核心能力

1. **`doctor.py telemetry`**（`.agents/skills/product-doctor/assets/telemetry.py`）：
   - 单趟双时间窗（14d / 30d）演化取证：绝对 churn、fix 连击文件榜、修复振荡比（`oscillation_ratio`）、跨包与包内时间耦合分离、对象类型自动分类（`code`/`tests`/`docs`/`meta`，零硬编码目录名）、测试/生产行数与净增长比。
   - 纯 stdlib Python AST 结构遥测：Sonar/Campbell 认知复杂度、标准化 AST 骨架克隆检测（实跑立刻抓到 `deploy/release_host.py:printed_refusal` / `ide/research_graph/serve.py:_refusal` / `shared/errors.py:printed_refusal` 三处跨包复制粘贴）、SATD 注释计数、1–10 健康度分与 **`break_even_caution`（`health < 6.0`，对应 `arXiv:2610.33343`）**。
2. **`doctor.py advise`**（`.agents/skills/product-doctor/assets/scheduler.py`）：
   - **去死锁的止损过滤**：将开放 `agent-finding` 精确拆为 `actionable_harm`、`authority_drifted`（引用文件在最近复验后改动的待授权项，仅旁路提示而不阻塞轮换）、`blocked_authority`、`claimed`。在 `origin/main` 实测中，34 条开放 issue 被精准筛成 **1 条真正可行动 `harm`（`#3761`）+ 7 条 `authority_drifted` + 18 条 `blocked_authority`**。
   - **反熵 `slim` 触发器 + 盈亏平衡策略**：按 `oscillation_burst`、`test_bloat`、`structural_decay`、`clone_bloat` 自动排序代码对象，并对 `health < 6.0` 对象显式输出 `seam-and-characterize-first` 策略，防止一次大改引发回归。
   - **热点+冷区配对调度**：`find` 在存在覆盖 SLA 违约时，强制配对「最高风险对象 + 最冷未审对象（按 `examined` 最早且 30d 提交最少）」，并附上最高频 `coupled_contracts`（`A+B`）。
   - **显式 `steady` 停止门禁**：当 `issues_provided`、`no_actionable_harm`、`no_slim_triggers`、`no_staleness_breaches`、`marginal_yield_saturated` 全为真时，返回 `recommended_theme: "steady"`，并支持 `doctor.py scope DIR steady` → `report` 干净输出 `# Themed audit: steady`。

---

## 四、实跑踩过的 6 个真实坑（给 Claude 接手的重点避坑清单）

1. **坑 1：不能照搬论文把 `churn / LOC`（相对 churn）直接当缺陷排序器**
   - Nagappan & Ball (2005) 预测的是大型二进制的*缺陷密度*（每千行缺陷数）。在 Python 小模块高频演化仓库里，`churn / LOC` 会把刚新建的 60 行干净小文件顶到榜首，反而漏掉 1,000+ 行的真实缺陷大户（样本外 P@15 仅 66.7%，远低于绝对 churn 93.3%）。调度先验必须结合 `log1p(abs_churn)` + `fix_burst` + `max_cognitive`。
2. **坑 2：按包名匹配 `authority` issue 的代码变动会重新制造 `Stop harm` 死锁**
   - 初版按 issue 正文提到的包名（如 `engine`、`cli`）检查最近是否有提交，结果把 9 条 `authority` issue 全拉回 `actionable_harm`。即使改成按**具体引用文件**精确匹配，像 `engine/paper.py`（1,244 行）和 `cli/research_commands.py`（973 行）几乎天天被不相关功能改动，仍会把 7 条待授权 issue 反复拉回止损队列。最终解法：`authority` 项永不抢占 `harm`，文件变动过的单列为 `authority_drifted` 供顺带复验与提醒。
3. **坑 3：`SPLIT=0.1` 拆分出的大包内部子目录会淹没真正的跨包耦合**
   - `ide/web/src` 拆出的 `model` / `widgets` 互相共变 54 次，把 `cli+report`（31 次）和 `engine+live`（26 次）挤出前三。必须按顶层包名拆开 `couplings`（跨包）与 `intra_couplings`（包内）。
4. **坑 4：冷启动期所有对象都 `staleness_breach` 时，按总分选第 2 对象会退化成“双热点”**
   - 因为旧记录无 `OBJECT:SCENARIO`，初期 20/20 代码对象均未记录日期。如果第 2 槽仍按综合分降序选，选出来的是第 2 热的对象而非冷区。必须按 `(examined, commits_long, object)` 升序专挑最冷对象配对。
5. **坑 5：AST 认知复杂度递归遍历的经典 off-by-one**
   - 初版对 `ast.If` 的 `body` 逐条调用 `walk(stmt, nesting + 1)`，而 `walk` 内部只遍历 `ast.iter_child_nodes(cur)`，导致紧贴在 `if` 内的 `for`/`if` 语句本身被漏算（`COMPLEX_BLOB` 少算 10+ 分）。改成 `visit(cur, nesting)` 先判 `cur` 本身再递归子节点后，与 `complexipy 9.0.0` 在 13/14 函数上逐字对齐。
6. **坑 6：重复 `git log` 与 `git cat-file --batch` 会把单次 `advise` 拖到 12 秒**
   - 将 14d/30d 合并为单趟 `git log --format=%ct`、并复用同一次 `tracked(rev)` 与 `objects(rev)` 后，`advise` 从 11.89s 降到 7.79s（瓶颈主要在 `tracked(rev)` 扫描全树 2,155 个 blob 与解析 200+ Python 文件 AST；后续若需压到 <2s，可考虑只对 `code` 对象 blob 算行数或在 `telemetry` 复用 `git ls-tree` 缓存）。

---

## 五、留给 Claude 后续正式 R&D 迭代的待办

1. **全文深读与阈值精标**：下载 `arXiv:2610.33343` / `arXiv:2605.22526` / `10.1109/icsme67971.2026.00079` 全文，用本仓 171 条 `agent-finding` issue 精确回测并校准 `BREAK_EVEN_HEALTH`（当前取 6.0）、`oscillation_ratio` 阈值与 `sla_days`（当前 21d）。
2. **推导式认知复杂度细化**：对齐 `complexipy` 对列表/生成器推导式中 `if` 子句的计分规则。
3. **JS/TS 前端结构遥测**：当前 AST 分析仅覆盖 `.py`，`ide/web/src` 仅靠 git 演化信号覆盖；可评估是否用轻量正则/外部 `jscpd` 补齐前端复杂度与克隆检测。
4. **配对 Skill Evals（A/B）**：按 `.agents/README.md` 跑 `claude plugin eval .agents`，同步测量 `#3764`–`#3768` 并验证新版 `SKILL.md` / `slim.md` 不降低任何既有 eval 通过率。

---

## 六、第 2 轮实战闭环（v2 上阵实跑 `origin/main` → 独立反驳 → 迭代到 v2.1 + 提炼 Eval Case）

按照「假设 → 开发 → 真实项目回测 → 独立反驳 → 迭代」闭环，我们在隔离证据目录 `/tmp/doctor-v2-combat-20261126` 对 `origin/main`（`d4460250a`）并行跑了 3 路实战通道 + 2 个无证明上下文的独立反驳子代理（`--refutes`）：

### 1. 实战战果（全套 10/10 独立 `--refutes` 确认，0 推翻，0 重复）

| 实战通道 | 驱动信号（来自 v2） | 耗时 | 实战发现与验证 |
|---|---|---:|---|
| **Pass 1：Metric-Guided `Slim`**（`cli`, `engine`） | `slim_candidates` + AST 克隆 + `break_even_caution` | ~10 min | 在 scratch 副本实跑验证 2 组无须授权的 `cli/` 结构合并（**S1+S2 净减 69 行、函数 77→65、`cli` 4 组克隆归零**，65 项单测全绿）；实证实认 `engine/audit.py`（`health=1.79`）的 **`break_even_caution` 护栏准确有效**（内部含 `REPORT_PAYLOAD_INVALID` 边界且在 `replay.Dockerfile` 摘要闭包内，绝不可一次重写） |
| **Pass 2：跨包耦合 `Find`**（`cli+report`） | `couplings` 头号跨包耦合（`31×`） | 13 min | 挖出 **5 个全新 `shown` 缺陷，独立 `--refutes` 5/5 确认**（3 个中高影响正常可达：`unchanged` 漏判 `retry_of` 清门禁致 IDE 缓存过期、`state --line --full` 丢失 `line` 混入他线数据、`comparison --at` 吞掉 `UNKNOWN_REF`；2 个次要契约缺口：`unchanged --line` 跳过存在性检查、`replay report --reproduction-trial` 缺 `--reproduction` 静默丢弃） |
| **Pass 3：冷区 SLA `Find`**（`runtime`） | 最冷 Python 对象（`555` 行、30d 仅 24 提交、0 open issues） | 12 min | **强验证 H3**：挖出 **5 个全新 `shown` 缺陷，独立 `--refutes` 5/5 确认**（4 个正常可达：`resolve("")` 回退 `:main` 绕过空检查、离线 `git fetch` 误报 `RUNTIME_NOT_MAIN`、`--single-branch` 非 `main` 克隆误拒合法主干镜像、显式 `repo@sha256` 遇多 `RepoDigests` 报 `RUNTIME_DIGEST_AMBIGUOUS`；1 个次要信任边界：`live_command` 在 `normpath` 前查 `/run/secrets/binance.json`） |

### 2. 实战反哺出的 8 项缺陷与 v2.1 迭代修复

| 实战暴露的问题 | v2.1 修复与实测效果 |
|---|---|
| `telemetry.py` 的 `test_map` 漏掉被 `ALONE=0.01` 折叠的测试目录 | 改为直接扫描 `tracked_lines` 匹配 `tests/<pkg>/` 与 `tests/<pkg>_*/`：`runtime` 真实测试比 `1.46`、`live` `1.33`、`paper` `0.99`、`cli` `0.30` 全部浮出 |
| `cognitive_complexity` 在非 `if.test` 处重复计嵌套 `BoolOp` 且漏算推导式 `if` | 改 `visit_bool_chain` 单次递归 + 补齐 `ListComp`/`SetComp`/`DictComp`/`GeneratorExp` 的 `ifs` 计分 |
| AST 克隆把 docstring/注解算进 18 节点，导致 1–3 行回调重写污染且误伤 `deploy`/`ide` 隔离拷贝 | 去 docstring/注解、门槛提至 `≥28` 节点且 `≥5` 正文行、AST 解析 `tests/test_package_layers.py` 自动识别 `isolated_roots = ['deploy', 'ide']` 并拆出 `boundary_clones`（假阳归零） |
| 前端 JS/TS/TSX 对象因无 `.py` 被默认标成 `health=10.00` | 新增轻量 stdlib `analyze_js_ts_source`，无源码对象改报 `min_health: null`；`ide/web/src` 实测暴露真实 `health=4.5`、`cog=60` 进入 `slim` 前三 |
| `scheduler.py` `test_bloat` 误把 `engine` 新安全测试（比值 `1.11`）报成膨胀 | 门禁收紧为 `test_to_prod_ratio >= 1.35 && test_net > 150` 或 `prod_net <= 0 && test_net > 300`，`engine` 误报消除 |
| `cli+report` 只给包级耦合，缺少具体热文件对 | `couplings` 内嵌每个跨包对的 `top_file_pairs` Top 5（直接暴露 `cli/research_commands.py <-> report/graph.py` 5×） |
| `doctor.py run` 未打印 `.out` 路径、`report` 长命令撑爆表格 | `run` 写入 `output_file`；`report` 截断超 120 字符命令；**踩坑警示**：尝试把 `failed` 折叠进 `examined` 时被 `test_doctor.py` 拦截——打印 `failed` 是防止重试掩盖失败的刻意信任边界，必须保留 |
| 3 项实战规则缺少回归 eval | 在 `.agents/evals/product-doctor/` 新增 3 个 eval case（见下），不改任何既有 grader |

### 3. 从实战提炼的 3 个新 Eval Case（`.agents/evals/product-doctor/`）
1. `authority-does-not-starve-slim`：验证 `authority_drifted` / `blocked_authority` 不得抢占 `Stop harm` 饿死高振荡模块的 `Slim`，且 `engine` 遵循 `break_even_caution`。
2. `steady-stops-without-nitpicking`：验证 `advise` 全部 `stopping_checks` 成立时直接宣布 `steady` 停手，不强行编造 minor 问题。
3. `slim-break-even-and-isolation-boundary`：验证 `Slim` 通道拒绝合并 `deploy`/`ide` 隔离边界拷贝，且拒绝一次性重写 `replay.Dockerfile` 闭包内的 `break_even_caution` 文件。

### 4. v2.1 验证结果
- `tests.product_doctor.test_doctor` + `tests.product_doctor.test_doctor_v2` + `tests.test_source_hygiene` + `tests.test_eval_cases` + `tests.test_package_layers`：**29/29 通过**
- `ruff check`：**0 errors**；`mypy`：**0 errors**
