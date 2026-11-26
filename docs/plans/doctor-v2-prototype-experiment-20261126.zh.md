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

---

## 七、第 3 轮对抗红队与前端 Ground-Truth 校准（v2.1 → v2.2 + 3 个红队 Eval Case）

本轮不提产品 issue，专注对 `product-doctor` v2.1 做双路极限压测并迭代到 **v2.2**：

### 1. Round 3A：全仓 517 个 JS/TS/TSX/MJS 文件的 Bun 转译 Ground-Truth 对标
- **暴露的真问题**：v2.1 行级正则 `analyze_js_ts_source` 在 428 个前端生产文件上的 `break_even_caution` 假阳率高达 **92.3%**（36 FP / 3 TP / 1 FN `FirstRun.tsx`）；40.3% 的正则命中是假阳（`??` 被 `\?` 命中两次占 20.6%、`?.` 占 10.8%、TS 可选属性 `?:` 占 6.4%、`line.partition("//")` 切断 `"https://..."` 导致 `news.ts` 永久泄漏 `+7` 花括号深度炸到 `cog=150`）。同时漏掉了 **8,785 行前端与 IDE 测试**（`.mjs`/`.cjs` 不在扩展名表、共置 `*.test.ts` 被算成生产代码、`tests/research_graph/` 无法映射到 `ide`）。
- **v2.2 修复**：
  - 新增纯 stdlib 状态机引擎 `.agents/skills/product-doctor/assets/js_analyzer.py`（完整词法分析字符串/模板/正则/注释/JSX 模式 + 跳过 TS `type`/`interface` + 函数级 Sonar/Campbell 认知复杂度 + `??` 按 SonarJS 计 0 + 无分号单行 `if` 防 `pending_nest` 泄漏 + 标准化 Type-2 克隆哈希）。
  - 扩充 `.mjs`/`.cjs`、统一 `is_test_path()`、支持共置 `*.test.*` / 同包兄弟测试目录（`ide/web/scripts/*.test.mjs` → `ide/web/src`）/ 子包目录匹配（`tests/research_graph/` → `ide`）。
- **实测前后对比（`origin/main`）**：
  - `ide/overview/src/news.ts`：`health 4.50 (cog 150)` → **`10.00 (cog 10)`**（与 Bun ground truth 完全一致）
  - `ide/web/src/model/types.ts`：`7.79 (cog 28)` → **`10.00 (cog 0)`**
  - `ide/web/src/icons/registry.ts`：`8.52 (cog 23)` → **`10.00 (cog 0)`**
  - `ide/web/src/model/backtest.ts`：`4.50 (cog 58)` → **`8.68 (cog 24)`**
  - `ide/web/src/widgets/FirstRun.tsx`（原漏报 `9.40`）→ **`4.41 (cog 60)`**（成功检出）
  - `ide/web/src/widgets/live/LiveLaunch.tsx`：**`4.34 (cog 73)`**（头号真高危组件）
  - 测试映射：`ide` `test_lines=2109 (0.80)`、`ide/web/src` `5831 (0.85)`、`ide/overview` `563 (0.16)`、`ide/agent` `282 (0.13)`、`ide/web/scripts` 自动归类为 `kind=tests`；且 Type-2 克隆抓出 `docs-site/app/[lang]/(home|docs)/layout.tsx:Layout`。

### 2. Round 3B：25 天 8 快照纵向回放 + 对抗红队（10 项 P0/P1/P2 全部闭环修复）
- **P0-1（`steady` 防作弊与未反驳缺陷语义）**：`doctor.py report` 末尾追加 `Refuters ran on N.`；`scheduler.py` 绝不用 `refuted_shown=0` 覆盖未跑反驳的 `shown > 0`，并把 `steady`、`is_partial`、`0 of 0 probed` 空白记录及“仅 1 条实质记录但发现 >0 个 bug”全部排除出饱和门禁。
- **P0-2（`read_audit_history` 批量读取 + 解析 `record.md` 表格）**：改为单次 `git cat-file --batch` 批量读全仓审计记录（`advise` 耗时从 9.12s 降至 **6.66s**），同时大小写不敏感匹配 `# Partial themed audit:` 与 `| Coverage |` 表格单元。
- **P0-3（历史时间窗提交时间锚定）**：`telemetry.py` 与 `doctor.py scan_data` 均改用 `--since=@{head_ts - window}`；在 `8732f5960`（2026-10-30）上 `commits_long` 从截断的 `136` 恢复为精确的 **`686`**。
- **P1-2（`slim` 跨文件误报 + 冷区反饿死冷却）**：`structural_decay` 改为仅统计不健康文件自身修复数 `unhealthy_fixes_short >= 2`；当仍存在覆盖 SLA 违约时，`slim` 跑完 1 轮即进入冷却让位给 `find`，打破 2:1 乒乓。
- **P1-3 / P1-4 / P1-5 / P1-6 / P2-1～P2-3**：恢复 Python 克隆 `Attr:{cur.attr}`（`CLONE_MIN_NODES=32`）消除异义函数碰撞；全链路统一 `_spelled()` 编码修复含空格/`%` 文件静默丢失；新增 `Revert` 振荡与单文件 `oscillation_ratio`；`classify_issues` 校验 JSON 结构、修复 `last_touch = max(updated, comments)`、纳入正文 harm 并过滤纯文档拼写、按 `record.md` 2 天过期规则释放僵尸 `claimed`；`zero_yield_streak` 遇 `confirmed > 0` 立即归零；`scope steady` 拒绝非空 `--objects`/`--items`；`_isolated_roots` 支持 PEP 526 `ast.AnnAssign`。

### 3. 新增 3 个红队提炼 Eval Case（累计 6 个新 Case，均通过 `tests.test_eval_cases`）
4. `no-steady-after-unrefuted-or-zero-probe`
5. `slim-cooldown-yields-to-stale-find`
6. `stale-claimed-and-drifted-authority`

### 4. v2.2 验证结果
- `tests.product_doctor.test_doctor` + `tests.product_doctor.test_doctor_v2` + `tests.test_source_hygiene` + `tests.test_eval_cases` + `tests.test_package_layers`：**32/32 全部通过**
- `ruff check`：**0 errors**；`mypy`（4 个源文件）：**0 errors**

---

## 八、第 4 轮多轮闭环演化仿真与动态阈值校准（v2.2 → v2.3）

围绕最初的核心命题——**长期反复运行 `product-doctor` 究竟能否单调收敛到全面覆盖 + `steady`，而不是陷入热区反复打转**——搭建 3 工况闭环仿真脚本（`/tmp/doctor-rd-sources/sim_round4.py`）实测 v2.2 基线并迭代出 **v2.3**：

### 1. v2.2 暴露的 3 个多轮动力学缺陷
- **热区锁定与 56.3% 重复浪费**：在 Regime A（`origin/main` 0 新提交、16 轮连续推演）中，v2.2 选中了 `engine` **14/16 轮**、`deploy` **6 轮**，16 轮后仍有 6 个核心代码对象（`cli`/`ledger`/`live`/`market`/`report`/`ide/web/src/model`）一次都没审到，且永远到不了 `steady`。
- **根因**：① 缺少按对象维度的 `slim` 冷却（昨天刚瘦身过的对象在 14 天窗口内无新修复仍被反复点名）；② `find` 评分只看 14 天总 churn，不看对象在最近一次审计之后是否有新代码提交；③ 静态绝对 `slim` 门槛在高频 AI 仓（14 天 413 个 fix）上触发了 **17/20（85%）** 代码对象。

### 2. v2.3 核心机制升级（`telemetry.py` + `scheduler.py`）
1. **按对象最新代码/修复时间戳（`latest_code_ts` / `latest_fix_ts`）**：审计后若对象在 SLA 内无新代码提交（`unchanged_since_examined`），其 `risk_prior` 归零，把 `find` 预算立即让给未覆盖或有新变动的模块；一旦有新提交落入，优先级立刻恢复。
2. **按对象 `slim` 冷却（`slim_cooled_objects`）**：从已有 `docs/plans/doctor/` 的完整 `slim` 记录解析 `last_slimmed[obj]`（零新增存储）；若对象自上次 `slim` 后无新 fix/revert 落入则退出当前 `slim_candidates`，有新 fix 立刻重新唤醒。
3. **仓节奏自适应分位门槛（`dynamic_bars`）**：结合绝对下限与活跃代码对象的 75 分位（`file_burst_bar = max(4, ceil(p75))`、`unhealthy_fix_bar = max(3, ceil(0.5 * p75))`），低速仓保敏、高频仓聚焦真正的统计学离群值（“well ahead of the rest”）。

### 3. 三工况闭环仿真 Before（v2.2）vs After（v2.3）

| 指标（Regime A：`origin/main` 16 轮连续推演） | v2.2（改前） | **v2.3（改后）** | 变化 |
|---|---:|---:|---|
| 初始 `slim` 触发对象数（共 20 个代码对象） | 17 / 20 (85%) | **9 / 20 (45%)** | **−47%** |
| 达到 `20/20` 满覆盖轮次 | 永不（16 轮仅 14/20） | **第 12 轮** | **100% 满覆盖** |
| 首次干净收敛到 `steady` 轮次 | 永不 | **第 14 轮**（R14–R16 稳态保持） | **闭环收敛成立** |
| 重复选中浪费次数 | 18 / 32 (56.3%) | **4 / 24 (16.7%)**（同主题重复为 0） | **−78% 浪费** |
| 覆盖均匀度（归一化 Shannon 熵 `0..1`） | 0.659 | **0.984** | **+49%** |
| 单个热区最高被抽中次数（`engine`） | 14 / 16 轮 | **1 / 16 轮** | 彻底解除热点锁定 |
| 16 轮后遗漏未审对象数 | 6 | **0** | 零盲区 |

- **Regime C（静默期收敛）**：保持最优——第 10 轮 `20/20` 满覆盖、第 11 轮进 `steady`、重复浪费 `0`、覆盖熵 `1.000`。
- **Regime B（2026-10-29 → 2026-11-25 10 个真实历史快照纵向回放）**：`slim` 触发从 `11–17` 收敛至 `6–9`，审计覆盖在 14 个核心代码对象间平滑轮换，且在 `cli`/`ledger` 确实出现新 fix 提交的快照上准确重新唤醒 `slim`。

## 9. 第五轮迭代（v2.4）：全组件补齐（Friction / Pareto Delta 门控 / 契约与漂移执行层 / Self 镜头产出）

前四轮完成了底座遥测（Python + JS/TS）、`harm` 授权分流与防饿死、`slim` 振荡/膨胀/冷却与动态分位数、`find` 冷区 SLA 配对与跨包耦合、以及 `steady` 反作弊停机；但仍有四个部件停留在 v1 或人工口头约定阶段。本轮把这四个剩余缺口全部工程化为纯 stdlib 确定性部件：

1. **Friction 主题闭环（`.agents/skills/product-doctor/assets/friction.py` + `doctor.py friction` + `advise --ci-json --transcripts`）**：
   - **CI 交付遥测（`analyze_ci_runs`）**：按 `workflowName` 分组（实战中发现 GitHub Actions `name` 会被自定义 `run-name` 如 `PR #3780` 污染，必须优先用 `workflowName`），用 nearest-rank 计算 `p90_minutes`（修复小样本下 `p90 < median` 缺陷），监测失败率（`>= 25%`）、高延迟（`p90 >= 20m`）和近半段中位耗时增长（`>= +30%`）。
   - **隐私安全 Transcript 遥测（`analyze_transcripts`）**：兼容 Antigravity、Claude Code、Codex JSONL，仅提取步骤数、用户轮次、工具错误率、加载技能、重复动作（`count >= 4`），绝不输出原始 prompt/output 或凭据。实战跑通真实 Antigravity transcript（`bfdee680-.../transcript.jsonl`）并当场修复两处格式差异：Antigravity `tool_calls.args` 内嵌 JSON 引号字符串需解码（`skills_loaded` 随之正确识别出 `product-doctor`），以及 `GENERIC` 步骤中非零退出码（`Command exited with code 127.`）的错误统计。
   - **调度集成**：`scheduler.advise()` 补齐完整的 `theme == "friction"` 路由（按 CI / transcript 信号精准收敛镜头 `delivery` / `agents` / `burden`），纳入 `stopping_checks.no_friction_triggers`，并受与 `slim` 同等的防冷区饿死冷却约束。
2. **Pareto $\Delta$-Gate 与 Refactoring Runaway 校验器（`telemetry.compute_delta` + `doctor.py delta BASE [HEAD]`）**：
   - 依据 `arXiv:2610.33343` + `arXiv:2605.22526` + `slim.md` Rule 1，对任意两个 git revision 对比生产/测试净行数、函数数、最大认知复杂度、最低健康分、SATD 与新增 break-even 退化，给出确定性 `pareto_verdict`（`improved` / `moved_only` / `regressed` / `neutral`）和 `tangled_refactor_risk`（`fix(...)` 提交跨 `>= 3` 包、`>= 6` 生产文件且 churn `>= 300`）。
   - 纯文件搬移/重命名通过删除内容哈希比对排除误报 `new_break_even_regressions`，准确落入 `moved_only`。
   - **真实历史提交实测**：`#3780`（`edf3a9fae`）与 `#3781`（`d4460250a`）中 `doctor.py` 健康分从 `6.83 -> 4.40 -> 3.77`（`max_cognitive: 34 -> 46 -> 53`）被准确判为 `regressed`；真实减负提交 `#3423`（`-457` 行、`health 4.34 -> 6.48`）与 `#3425`（`-133` 行、`health 5.49 -> 10.0`）被准确判为 `improved`。
3. **执行与报告层硬化（`doctor.py scope --contracts` + `doctor.py run --tree`）**：
   - `scope --contracts A+B,C+D` 将 `advise` 给出的跨包耦合契约升级为 `report` 可强制核查项：若没有包含 `A` 与 `B` 的联合 `run` 证据，会在 `Not exercised` 中显式列出 `A+B (contract)`。
   - `run --tree REV` 在每条执行证据上记录 `tree_drift`（目标对象路径在 `HEAD` 与 `REV` 间是否存在内容差异），避免把未同步工作树的运行结果误判为 `origin/main` 行为。
4. **`self` 镜头产出追踪（`advise.low_yield_lenses`）**：
   - `read_audit_history` 提取历史审计覆盖的镜头，统计各镜头连续零产出轮次（`zero_yield_streak >= 2`），把 `lenses.md` 中“低产出镜头自查（`self`）”从口头原则变成确定性数据输入。
5. **验证与新增 Eval Cases**：
   - 新增 2 个 eval case：`friction-ci-and-transcript-signals`、`delta-gate-rejects-moved-code-and-tangled-fix`（累计新增 8 个 eval case）。
   - 验证：`unittest` 37/37 OK（含 `test_doctor`、`test_doctor_v2`、`test_source_hygiene`、`test_eval_cases`、`test_package_layers`）、`ruff check` 0 errors、`mypy` 5/5 源文件 0 errors、`SKILL.md` 1684 词（全套技能文本 4170 词）。

## 10. 第六轮迭代（v2.5）：跨语言 `recheck` + 工作树漂移强化 + 全链路压力测试

1. **补齐 `doctor.py recheck` 跨语言/前端盲区**：
   - **背景**：v1 的 `recheck` 只认 `tests/test_*.py`，对本仓 4 套基于 Node 内置 `node:test` 的 JS/TS 测试（`ide/web/scripts/*.test.mjs`、`ide/agent/src/*.test.ts`、`ide/overview/src/*.test.ts`、`.github/scripts/*.test.cjs`）全部返回 `no test`，甚至在混合修复提交（如 `2e5d412f9`）里误把 `.test.mjs` 当作 `product` 文件一起回滚。
   - **实现**：新增 `JS_TEST_RE`、`JS_TESTS`（基于 Node `node:test` 编程式 `run()` 事件流，精准区分 `ERR_ASSERTION`/`AssertionError` 为 `fail` 与导入/运行异常为 `error`，绝不误报 `confirmed`）、`_link_node_modules`（在临时 `tree()` 内只读软链宿主非空 `node_modules`，不写宿主 checkout）以及脱敏错误摘要 `why`（剥离临时根路径）。
2. **`run --tree` 与 `report` 强化**：
   - `run --tree REV` 改为直接用 `git diff --name-only REV -- <obj_parts>` 对比实时工作树，同时捕获**已提交漂移与未提交脏改动**；`report` 在证据行尾部显式标出 `[tree_drift]`，并在头部打印声明的 `contracts`。
3. **v2.5 全链路端到端压力测试（真实 `origin/main` 提交与证据链）**：
   - 串联 `scope --contracts cli+report` → `run --tree origin/main`（干净路径 `tree_drift: false` vs 改动路径 `.agents` `tree_drift: true`）→ 5 个真实历史 `fix` 提交 `recheck` → `probe` + `probe --refutes`（拦截同源探针防作弊）→ `cost`（线性循环实测 `exponent: 1.04`）→ `report`。
   - 5 个真实历史提交 `recheck` 结果：
     - `5ec40b6aa`（Python `fix(report)`）：`confirmed`（`53 ok -> 52 ok / 1 fail -> 53 ok`）
     - `0af6c4171`（CJS `.github/scripts/release-ready.test.cjs`）：v1 为 `no test` → v2.5 **`confirmed`**（`28 ok -> 27 ok / 1 fail -> 28 ok`）
     - `4959469a2`（TS `ide/overview/src/fetching.test.ts`）：成功执行 TypeScript 用例（`fixed/now: 4 ok`），回滚态因新增导出缺失报 `SyntaxError` → 准确判 `error: 1` / **`undecided`**（带脱敏 `why`，绝不误判 `confirmed`）
     - `1acd3cf70`（ESM `ide/web/scripts/live.test.mjs`，本地 `ide/web/node_modules` 为空）：优雅降级为 **`undecided`** 并明确给出 `Cannot find package 'typescript' imported from ./ide/web/scripts/load.mjs`
     - `2e5d412f9`（混合 Python + JS）：不误回滚 `.test.mjs`，Python 两侧双用例 **`confirmed`**
4. **验证与新增 Eval Case**：
   - 新增 eval case：`recheck-cross-language-js-ts`（分支累计新增 9 个 eval case）。
   - 验证：`unittest` 38/38 OK、`ruff check` 0 errors、`mypy` 5/5 源文件 0 errors。

## 11. 第七轮迭代（v2.6）：多主题并发压力仿真 + Doctor 自我体检减负（Dogfooding）

1. **三情景多主题并发压力仿真（`friction` + `harm` + `slim` + `find` + `steady` 联合压测，18–20 轮）暴露出组合调度漏洞**：
   - **暴露问题（v2.5）**：在持续 CI 摩擦 + 冷对象超期（Regime 2）情景中，`slim -> friction -> find -> slim -> friction -> find` 交替把 `"friction"` 顶出 `last_two_themes`，导致 `.github` 被重复审计 **6 次**，全覆盖推迟到第 18 轮；在叠加第 5、11 轮 `harm` 冲击（Regime 3）时，`find` 被连续饿死 5 轮（R3→R8），第 19 轮才进入 `steady`。
   - **根因修复（`scheduler.py`）**：
     - 增设**非 `find` 联合交替防饿死守卫**：只要存在 SLA 超期对象且 `last_two_themes` 均属于 `{"slim", "friction"}`，两者均须让位给 `find`（保证冷区最多每 3 轮推进一次）。
     - 增设 **7 天零产出 `friction` 按对象冷却（`FRICTION_COOLDOWN_DAYS = 7`）**：完整 `friction` 审计在目标对象上零新发现后冷却 7 天，避免对着同一未解慢 CI 反复空转（同时仍保留 `no_friction_triggers: false` 阻止假 `steady`）。
   - **压测前后对比**：
     - Regime 2（持续 CI 摩擦）：`.github` 重复审计 **6 → 1 次**，全覆盖轮次 **R18 → R14**，最高对象重复选中 **6 → 2 次**。
     - Regime 3（CI 摩擦 + 双 `harm` 冲击）：全覆盖 **R18 → R15**，首次 `steady` **R19 → R16**，零 `find` 连续饿死。
2. **Doctor 自我体检与减负（用自己的 `doctor.py delta` 验收自己）**：
   - 用 v2.5 自身遥测扫描 `.agents/skills/product-doctor/assets/`，发现 `friction.py`（`max_cog=92, health=4.38`）、`scheduler.py`（`max_cog=113, max_fn=269, health=2.86`）、`telemetry.py`（`max_cog=110, max_fn=225, health=2.37`）存在高认知复杂度与内部重复逻辑。
   - 按 `slim.md` 拆解重构并消除 Antigravity/Claude 技能参数解析重复与死变量 `tool_names`：
     - `friction.py`：`lines 261 -> 257`，`max_cog 92 -> 40 (-56%)`，`health 4.38 -> 6.25`（越过 `6.0` break-even 线）
     - `scheduler.py`：`max_cog 113 -> 46 (-59%)`，`max_fn 269 -> 135 (-50%)`，`health 2.86 -> 3.91`
     - `telemetry.py`：`lines 888 -> 874`，`max_cog 110 -> 72 (-35%)`，`max_fn 225 -> 108 (-52%)`，`health 2.37 -> 3.14`
   - 用本轮 commit 跑 `doctor.py delta HEAD~1 HEAD` 自验：`pareto_verdict = "improved"`（`max_cognitive: 113 -> 72`，`min_health: 2.37 -> 3.14`，`new_break_even_regressions: []`）。
3. **验证**：`unittest` **39/39 OK**、`ruff check` 0 errors、`mypy` 5/5 源文件 0 errors。

## 12. 第八轮迭代（v2.7）：对抗边界漏洞与隐私红线加固（H8.1–H8.3）

1. **假设与对抗复现（`/tmp/doctor-rd-sources/repro_round8.py`）**：
   - **H8.1a（`friction.py` CI 取消/跳过稀释）**：在 5 个 10s `cancelled` + 2 个 25m `failure` 的对抗样本中，v2.6 把 `cancelled` 计入分母和耗时导致 `median_minutes` 失真为 `0.17m`、`failure_rate` 稀释为 `0.286`（真实 `ci_runs.json` 中 `pr-title` 也受 `cancelled` 干扰）。
   - **H8.1b（`friction.py` 凭据回显泄漏）**：`toolSummary` 中的 `Bearer <JWT>`、`sk-ant-...`、`token=ghp_...` 与 URL 账密会被原样输出到 `repeated_actions` 和 `triggers`，触碰隐私红线。
   - **H8.2（`telemetry.py` `tangled_refactor_risk` 绕过）**：区间内夹带 1 条 `docs:`/`chore:` 提交即可使 `all(FIX_RE.match)` 失效，绕过 Refactoring Runaway 检测。
   - **H8.3a/b（`doctor.py` 嵌套子测试误报与自契约）**：Node `node:test` 嵌套 `t.test()` 子断言失败时，父测试发出的 `failureType === "subtestsFailed"` 被误记为 `error: 1`；`scope --contracts engine+engine` 未被拒绝。
2. **最小修复**：
   - `friction.py`：引入 `NON_EFFECTIVE_CONCLUSIONS = frozenset({"cancelled", "skipped", "neutral"})` 将其移出有效 `runs` 分母与耗时列表（单独保留 `cancelled` 计数）；新增 `_sanitize_summary()` 脱敏 URL 账密、`Authorization` / `Bearer` / `Basic`、密钥键值对、主流 API Token 前缀与 JWT 并截断至 80 字符（保留普通短语如 `Count token usage`）。
   - `telemetry.py`：`compute_delta` 改为按合并提交解包后的 subject 判定“含 `fix(...)` 且不含显式 `feat`/`refactor`”即触发 `tangled_refactor_risk` 检查。
   - `doctor.py`：`JS_TESTS` 跳过 `err?.failureType === "subtestsFailed"`；`scope --contracts` 强制 `parts[0] != parts[1]`。
3. **对照验证**：
   - 对抗样本重测：CI `runs=2, cancelled=5, failure_rate=1.0, median=25.0m`；凭据全部脱敏为 `<REDACTED>` 且 `<= 80` 字符；`fix + docs` 准确触发 `tangled_refactor_risk: true`（显式 `refactor:` 则放行）；嵌套 `t.test()` 准确给出 `confirmed` 且 `reverted.error == 0`；`engine+engine` 被 `scope` 拒绝。
   - `unittest` **41/41 OK**、`ruff check` 0 errors、`mypy` 5/5 源文件 0 errors；`doctor.py delta HEAD~1 HEAD`：`tangled_refactor_risk: false`，同时自检抓出 `friction.py` 因内联列表推导使 `analyze_ci_runs` 认知复杂度 `40→43`、健康分由 `6.25` 短暂跌至 `5.90`（`telemetry.py` `3.14→3.08`），直接成为 Round 9 纯结构减负的实证输入。

## 13. 第九轮迭代（v2.8）：全 5 资产结构减负与 517 文件 Bit-Exact Parity（H8.4）

1. **假设与基线**：
   - Round 8 后仍有 3 个资产存在 `max_cognitive > 55` 的单函数热点：`js_analyzer.py`（`_tokenize` 266 / `_extract_functions` 120 / `_function_cognitive` 93，`health=2.73`）、`telemetry.py`（`cognitive_complexity` 72、`health=3.08`）、`doctor.py`（`report` 61、`health=3.05`），且 `friction.py` 在 `5.90` 略低于 break-even 线。
   - 假设：在不改变任何外部语义的前提下，将上述热点拆分为单一职责的模块级函数与状态机方法，可将全部 5 个资产压至 `max_cognitive <= 45`、全面抬升健康分、保持 517 个真实 JS/TS/TSX/MJS/CJS 文件与全仓 `telemetry` **100% bit-exact parity**，并通过 `doctor.py delta HEAD~1 HEAD` 的 `pareto_verdict == "improved"` 检验。
2. **纯结构拆解**：
   - `js_analyzer.py`：`_tokenize` 拆为 `_Lexer` 状态机方法组（`_step_jsx_body` / `_step_jsx_tag` / `_try_scan_comment` / `_scan_regex` / `_try_start_jsx_expr` / `_step_open_brace` / `_step_close_brace` / `_step_code_token`）；`_extract_functions` 拆为 `_skip_ts_declaration` / `_match_named_function` / `_match_arrow_decl` / `_match_class_method`；`_function_cognitive` 抽出 `_step_control_keyword`。
   - `telemetry.py`：消除 `cognitive_complexity` 和 `_isolated_roots` 的嵌套闭包嵌套罚分（平铺为模块级 `_visit_cognitive` / `_visit_if_node` / `_visit_comp_node` / `_extract_isolated_value`）；拆解 `_map_test_paths` 与 `compute_delta`。
   - `doctor.py`：拆解 `report`（`_format_evidence_row` / `_print_coverage_table` / `_print_probe_table`）、`coverage`（`_missing_coverage`）、`recheck`（`_run_recheck_tree`）、`scan_data`（`_apply_scan_commit`）与 `main`（`_build_parser`）。
   - `friction.py` / `scheduler.py`：分别抽出 `_summarize_workflow_runs` 与 `_extract_cooldown_dates`。
3. **前后对照实测（Round 7 基线 → Round 9）**：

| 资产文件 | R7 行数 → R9 行数 | R7 `max_cog` → **R9 `max_cog`** | R7 `max_fn` → **R9 `max_fn`** | R7 `health` → **R9 `health`** |
|---|---:|---:|---:|---:|
| `doctor.py` | 967 → 1011 | 61 → **32 (−48%)** | 83 → **66** | 3.06 → **5.31 (+2.25)** |
| `friction.py` | 257 → 290 | 40 → **25 (−38%)** | 69 → **51** | 6.25 → **8.00 (+1.75)** |
| `js_analyzer.py` | 707 → 717 | 266 → **40 (−85%)** | 306 → **46** | 2.73 → **4.90 (+2.17)** |
| `scheduler.py` | 675 → 658 | 46 → **38 (−17%)** | 135 → **101** | 3.91 → **4.88 (+0.97)** |
| `telemetry.py` | 874 → 836 | 72 → **27 (−62%)** | 108 → **92** | 3.14 → **6.31 (+3.17)** |

4. **验收结果**：
   - **517 文件 JS/TS/TSX/MJS/CJS 对标**（vs `/tmp/doctor-rd-sources/js_parity_before.json`）：**517/517 100% bit-exact**；全仓 `origin/main` `telemetry` 输出 **100% bit-exact**。
   - **`doctor.py delta HEAD~1 HEAD`**：`pareto_verdict = "improved"`，`prod_lines.net = -10`，`max_cognitive: 266 → 40 (−226)`，`min_health: 2.73 → 4.88 (+2.15)`，`new_break_even_regressions = []`，`tangled_refactor_risk = false`（相对 Round 7 `572866784` 同样为 `improved`）。
   - `unittest` **41/41 OK**、`ruff check` 0 errors、`mypy` 5/5 源文件 0 errors。
5. **下一轮假设（Round 10 — 30+ 轮动态长程压测 + 全链路对抗红队 1）**：
   - 构造 36 轮动态长程闭环压测（含周期性代码提交、新 `fix` 连击、跨包耦合漂移、`harm` 注入、间歇性 CI 慢/取消摩擦、过期 `claimed`、`authority_drifted`、部分审计中断），同时对 `probe`/`cost`/`run`/`recheck`/`attach`/`lenses.md`/`record.md` 做系统对抗红队，检验是否还存在 P0/P1 级调度振荡、冷区漂移、过早/过晚 `steady` 或缺失确定性护栏的薄弱环节。





## 14. 第十轮迭代（v2.9）：36 轮动态长程压测与全链路红队修复（H10.1–H10.5）

1. **红队与 36 轮长程压测暴露的 5 个真实 P0/P1 漏洞（`/tmp/doctor-rd-sources/stress_round10.py`）**：
   - **H10.1（P0 `friction.py` 下划线环境变量凭据绕过）**：正则 `\b(api_key|secret|password)` 把 `_` 视作词字符，导致 `BINANCE_API_SECRET=...`、`OPENAI_API_KEY=...`、`DB_PASSWORD=...` 全部绕过脱敏原样泄漏。
   - **H10.2（P1 `friction.py` Codex JSONL 解析盲区）**：`references/hosts.md` 定义 Codex rollout 为 `{timestamp, type, payload}`，但旧版未解析 `payload`，导致实测 Codex 日志全部输出 `user_turns=0, tool_calls=0, tool_errors=0, skills_loaded=[]`。
   - **H10.3（P0 `doctor.py` `probe --id` 路径穿越）**：传入 `../escaped_probe` 会把 `.py` 探针文件直接写到证据目录之外。
   - **H10.4（P1 `scheduler.py` 已关闭 issue 污染 `harm`）**：若 `--issues-json` 误带 `"state": "CLOSED"` 条目，会被当作开放 `actionable_harm` 抢占调度。
   - **H10.5（P1 `scheduler.py` 冷却期摩擦导致 `find` 空转）**：在 36 轮（72 模拟天）动态长程压测中，当所有代码对象都处于新鲜未改动且边际产出已饱和、而持续 CI 失败目标（`.github`）已进入 7 天零产出冷却时，旧版因 `no_friction_triggers: false` 阻止 `steady`，落回 `find` 连续 **5 轮空转**重审未改动对象，并打印自相矛盾的 `"0 code object(s) exceed 21d coverage SLA"`。
2. **最小修复**：
   - `friction.py`：密钥键名匹配改为 `[A-Za-z0-9_-]*(?:api[_-]?key|...|token|secret|password|...)`；新增 `_record_codex_payload()` 并扩展 `NONZERO_EXIT_RE` 支持 Codex `Process exited with code N` / `Exit code: N` 与 `SKILL_PATH_RE`。
   - `doctor.py`：`probe()` 用 `PROBE_ID_RE` 严检 `args.id`（禁止 `/`、`\`、`..`）。
   - `scheduler.py`：`classify_issues` 跳过 `state == "CLOSED"`；抽出 `_compute_gates()`（顺带把 `advise` 从 101 行降至 85 行），当非摩擦门禁全满足且全代码对象均未改动、且活跃摩擦目标已处于 7 天零产出冷却时允许进入冷却等待 `steady`（同时忠实保留 `no_friction_triggers: false` 与 `friction_summary.in_cooldown: true`），并修正 0 SLA 违约时 `find` 的 rationale 文本。
3. **对照验证**：
   - 红队复测：`BINANCE_API_SECRET` / `OPENAI_API_KEY` / `DB_PASSWORD` 0 泄漏；Codex JSONL 准确提取 `user_turns=1, tool_calls=2, tool_errors=1, skills_loaded=['product-doctor']` 且不泄漏 prompt；`../escaped_probe` 被 `SystemExit` 拦截；`CLOSED` issue 归零。
   - 36 轮长程压测对比：冷却期空转 `find` 从 **6 轮降至 1 轮**（唯一 1 轮 R11 为 `harm` 之后边际产出未饱和的合法复审），R12/R13/R17 干净停在 `steady`，R14 冷却满 7 天后准确重新唤醒 `friction`，6 个包覆盖高度均匀（3–5 次/包），SLA 违约期最大连续非 `find` 间隔 `<= 1` 轮。
   - `doctor.py delta HEAD~1 HEAD`：`max_cognitive: 38 → 38 (0)`、`min_health: 4.88 → 4.91 (+0.03)`、`new_break_even_regressions: []`、`tangled_refactor_risk: false`、`pareto_verdict: "neutral"`。
   - `unittest` **42/42 OK**、`ruff check` 0 errors、`mypy` 5/5 源文件 0 errors。
4. **下一轮假设（Round 11 — 全新攻击面对抗红队轮 1 + 真实 Git 12 快照纵向回放 + 40 轮混沌压测 + Claude 拆 PR 视角审计）**：
   - 在修复上述 5 项 P0/P1 后，对全新攻击面（空仓/单文件仓/Unicode 特殊路径/时区偏移/损坏 JSONL/畸形 `cost`/`run`/`recheck`/真实 `origin/main` 12 快照纵向回放 + 新 40 轮混沌演化场景）执行深度对抗红队，同时审视技能文档体积与可拆 PR 边界。

## 15. 第十一轮迭代（v2.10）：新攻击面红队与 40 轮混沌压测（H11.1–H11.3）

1. **全新维度对抗红队与 12 快照纵向回放 + 40 轮混沌演化暴露 3 项真实缺口（`/tmp/doctor-rd-sources/redteam_round11.py`）**：
   - **H11.1（P1 `scheduler.py` `HARM_RE` 英语词形屈折漏报）**：40 轮混沌压测中 `pkg0/core.py silently drops fills` 居然未触发 `harm`——因 `\b(silent|drop|fill|crash|bypass|corrupt|leak)\b` 精确匹配原形，漏掉真实 issue 标题高频出现的 `silently`、`drops`、`fills`、`crashes`、`bypasses`、`corrupts`、`leaks`、`orders`、`positions`。
   - **H11.2（P1 `friction.py` 混合时区与畸形 JSONL 崩溃）**：`_parse_iso()` 未把 naive datetime 归一到 UTC 且未校验 `isinstance(ts, str)`，导致混有 naive/UTC 时间戳的 CI/transcript 抛 `TypeError: can't compare offset-naive and offset-aware datetimes`，整型 `created_at` 抛 `AttributeError`，非列表 `tool_calls` 异常遍历字符串。
   - **H11.3（P2 边界硬化）**：纯文档/0 代码对象仓下 `advise` 返回 `find` 但 `objects: []`（会被 `scope` 拒绝）；`doctor.py cost --sizes a,b,c` 抛裸 `ValueError` 而非干净 `SystemExit`。
2. **最小修复（净增仅 10 行生产代码）**：
   - `scheduler.py`：扩展 `HARM_RE` 覆盖常见词尾屈折（`silent(?:ly)?`、`drops?/dropped/dropping`、`fills?/filled`、`orders?`、`positions?`、`corrupt(?:s|ed|ing|ion)?`、`bypass(?:es|ed|ing)?`、`crash(?:es|ed|ing)?`、`leaks?/leaked/leaking` 等）；`_parse_iso` 统一 UTC 归一并做类型保护；`_pick_find_objects` 在 0 代码对象仓下回退至合法 `tops` 对象。
   - `friction.py`：`_parse_iso` 校验 `isinstance(ts, str)` 并统一归一到 UTC；`_record_step_tools` 校验 `isinstance(raw_tcs, list)`。
   - `doctor.py`：`cost()` 捕获 `ValueError` 并抛明确 `SystemExit`。
3. **对照验证**：
   - 红队复测全部 **0 findings**：12 快照真实 `origin/main` 纵向回放 0 异常；40 轮混沌压测（10 包 + 30 天静默 SLA 唤醒 + 并发 `harm`/`slim`/`friction`/`Revert`/部分审计）中 `harm` 2/2 准确触发、30 天静默后 10/10 包全部唤醒并覆盖、SLA 违约期最大非 `harm` 连续等待 `<= 1` 轮。
   - `doctor.py delta HEAD~1 HEAD`：`prod_lines.net = +10`，`max_cognitive: 38 → 38 (0)`，`min_health: 4.91 → 4.90 (-0.01)`，`new_break_even_regressions: []`，`tangled_refactor_risk: false`。
   - `unittest` **43/43 OK**、`ruff check` 0 errors、`mypy` 5/5 源文件 0 errors。
4. **下一轮假设（Round 12 — 连续干净红队验证轮 1 + Claude 拆 PR 视角审计）**：
   - Round 11 发现了 `HARM_RE` 屈折漏报与 `friction.py` 混合时区崩溃，因此连续干净红队计数归零；下一轮从全新对抗维度（深度嵌套 JS/TS/TSX 语法、Python 3.14 AST 特性、并发/多文件耦合、边界 `recheck`、`attach`/`lenses.md`/`record.md` 一致性、`SKILL.md` 词数与 Claude 拆 PR 结构审计）展开独立对抗红队验证，检验是否已达 0 P0/P1。
