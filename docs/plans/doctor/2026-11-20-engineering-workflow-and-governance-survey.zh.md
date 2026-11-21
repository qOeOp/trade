# 2026-11-20 工程工作流与项目治理盘点

用户担心项目长期由 Agent 编写、未系统对照外部开源工具，存在低效手写或项目变大后难以维护与发现问题，要求调研并把核实出的工程与治理事项记入 Doctor 未结项。本记录只收经代码核实、需要计量或需要用户定夺的事项；外部生态对照的评价与以宿主专用钩子做治理的提议不记为发现（后者与用户既定的“不用宿主专用钩子做治理”冲突）。

| Item | Value |
|---|---|
| Sessions | Google Antigravity，会话 `929022ea-b469-4039-b9c1-78ad59cb6916`（Gemini 4 Argon），2026-11-20；起止时刻 unknown |
| Audit session | 同一会话，写 PR [#3202](https://github.com/qOeOp/trade/pull/3202)；按评审删改与核实由 Claude Code（Claude Opus 5.5）完成，同一 PR |
| Checkout / ledger | `origin/main` `dadab781a`；未读账本 |
| Coverage | `ruff.toml`、`tests/test_package_layers.py`、`.github/scripts/run-tests.py`、`.github/workflows/quality.yml`、`market/{aggtrades,quotes}.py`、`ide/research_graph/{contract,layout}.py`、`ide/web/{package.json,scripts/check-rules.mjs,src/model/types.ts}`、`ide/{agent,overview}/package.json`、`docs-site/package.json`。缺口：包内导入循环个数与模块行数出自审计会话的读数，删改时没有复核；没有计量任何耗时 |
| Cost | unknown；未写账本或跑回放，0 个无效试验 |
| Net change | 本记录不改代码与 skill；拒绝码 249，skill 词数 28,094 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261120-10 | `market` 的 `aggTrades` 解析与 `quotes` 推导逐行在 Python 里循环，导入耗时未计量 | **当前产品**：`market/aggtrades.py:80-108` 用 `csv.reader` 逐行校验、`scaled()` 逐行转换后拼 `list[tuple]`；`market/quotes.py:73-93` 用 `zip(ids.tolist(), ...)` 逐行推导买卖价状态。<br>**消费者**：`market import-trades`、`market import-quotes`、`market follow` 的回补与维护耗时。是否值得改取决于这段在导入总耗时中的占比 | measure（在隔离市场目录上计量单日、单月导入中解析与推导的耗时占比；属实再另立修复，并要求输出 Parquet 逐字节一致） | unknown | open |
| 20261120-11 | Python 侧没有包内导入循环、模块体积、死代码与依赖声明的静态检查 | **当前产品**：`ruff.toml` 只在默认规则上加 `B`；`tests/test_package_layers.py:47` 跳过包内导入（`target == package`）。审计会话读到若干包内双向导入与多个超 800 行的模块（未复核）。<br>**要定的**：是否新增这类 CI 检查（冻结现状、禁止新增）；新增检查即收紧检查 | authority（新增 CI 检查；问用户） | unknown | fixed 782a526d6 [#3220](https://github.com/qOeOp/trade/pull/3220) |
| 20261120-12 | TypeScript 子工程没有死导出与未用依赖检查；`research-graph-view` 的 Python 输出与 TS 类型之间没有契约检查 | **当前产品**：`ide/web`、`ide/agent`、`ide/overview` 的 `check` 只跑 `tsc --noEmit`（`ide/web` 另跑 `scripts/check-rules.mjs`）；`ide/research_graph/layout.py` 组装的视图字典与 `ide/web/src/model/types.ts` 的类型各自手写。<br>**要定的**：是否新增这些检查（新增即收紧检查） | authority（新增 CI 检查；问用户） | unknown | fixed a81f2f83d [#3222](https://github.com/qOeOp/trade/pull/3222) |
| 20261120-13 | 本地测试命令单进程串行；核心纯函数（精确缩放、买卖价推导、订单规则）没有基于性质的测试 | **当前产品**：`AGENTS.md` 给出的测试命令是 `unittest discover` 单进程；CI 的 `.github/scripts/run-tests.py` 按模块分进程。<br>**要定的**：是否改 `AGENTS.md` 的测试命令、引入 `hypothesis` 等新测试依赖与检查（改检查与工作规则） | authority（问用户） | unknown | fixed 9880a3e22 [#3226](https://github.com/qOeOp/trade/pull/3226) |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 本次无 | | | | |

## Decisions

- 2026-11-20 用户要求把调研出的工程效率、数据处理与项目治理事项记入 Doctor 未结列表。
- authority 行（`20261120-11`..`13`）尚待用户决定。
- 2026-11-21 用户对含 `20261120-11`、`-12`、`-13` 的清单回复「我都授权」。`20261120-11` 用标准库做：`tests/test_package_layers.py` 加包内导入循环检查（main 上 9 个强连通分量、45 条成环导入边，记为 `CYCLE_EDGES`，只减不增）；新增 `tests/test_source_hygiene.py`：超过 800 行的产品模块 12 个记为 `OVERSIZED`（只减不增），测试以外没有使用者的顶层函数与类 0 个，第三方导入与 `pyproject.toml` 声明一致（`plotly` 只由 `nautilus_trader.analysis` 加载时导入，单列为间接依赖），`deploy` 只导入标准库。没有加 vulture、deptry：开发依赖组进 `uv.lock`，会改变回放镜像的 `dependency_lock_sha256`。
- 2026-11-21 `20261120-12`（「我都授权」）：`ide/web`、`ide/agent`、`ide/overview` 的 `check` 加 knip 6.44.2（各自 devDependency，`knip.jsonc`）。测试经 `scripts/load.mjs` 按路径加载 `src/`，knip 看不到，所以不报只在本文件里也用到的导出（`ignoreExportsUsedInFile`）。main 上按此报出：`ide/web` 的 `Select` 组件（连同只它用的 `--field-chevron` 令牌）与 `liveLaunch.ts` 对 `contractsOf` 的转出，删除；HarmonyOS 字体 CSS 由 `vite.config.ts` 作虚拟模块读，列入忽略（字体不动）；`ide/agent` 调用的 `uv` 列为宿主二进制；未用依赖 0。另删 `oiByVenue`：页面 11-18 起不再画它，`ide/overview` 仍在产出。契约检查为 `tests/research_graph/test_view_contract.py`：从夹具构建视图，逐个比对 `layout.py` 写出的键与 `types.ts` 声明的键（双向），并要求页面从图透传部分读的键都在 `graph.schema.json` 里；main 上无差异。
- 2026-11-21 `20261120-13`（「我都授权」）：`AGENTS.md` 的测试命令改为 `.github/scripts/run-tests.py`（CI 所用，按模块分进程并行）。两者跑的是同一组测试：`unittest discover` 与按模块加载得到同样的 2036 个测试 ID；main 上串行 2036 个通过（跳过 10），约 595 秒，按模块并行全部通过，约 158 秒（本机 16 进程）。性质测试加在 `tests/market/test_aggtrades.py`（精确缩放：任意写法读回同一整数、多一位小数即 `SCALE_LOSS`）、`tests/market/test_quotes.py`（买卖价推导：从不交叉、成交一侧即成交价、被推开的陈旧侧离对侧一个最小变动价位、只记变化、任意切成两段续推结果相同）与 `tests/engine/test_order_rules.py`（随机入场单被 GTD 与 3 倍权益规则恰好拒绝，取值偏向规则边界）；用固定种子的标准库 `random`，有界、确定，没有加 `hypothesis`：开发依赖组进 `uv.lock`，会改变 `dependency_lock_sha256`，回放镜像重建、已有回放不再支撑 Live（0.4.4 的 CHANGELOG）。
