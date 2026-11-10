# R1 2d：`--leverage` 与合约条款比对（设计与字段审查）

日期：2026-11-11。上接 `r1-runtime-contract-20261110.zh.md` 第 6 节（A9，已授权）。本文只定设计和要用户决定的事，不含实现。

## 1. 原生探针（rc7）

- **保证金公式**（`BacktestEngine`，MARGIN 账户，默认保证金模型）：
  - 挂单冻结 = 名义 × `margin_init` / 杠杆。名义 500：杠杆 1、`margin_init` 0.1 冻结 50；杠杆 3、0.1 冻结 16.67；杠杆 3、1 冻结 166.67；杠杆 10、1 冻结 50。
  - 成交后挂单冻结归零，持仓冻结 = 名义 × `margin_maint` / 杠杆。名义 1000、`margin_maint` 0.005：杠杆 1 冻结 5，杠杆 3 冻结 1.67，杠杆 20 冻结 0.25。
  - `StandardMarginModel`（`quotes` 环境）不看杠杆：持仓冻结 = 名义 × `margin_maint`。
- **Paper 的合约**：rc7 Binance 加载器（无密钥）给 BTCUSDT-PERP 的 `margin_init`、`margin_maint` 都是 0.1，最小价位 0.10、数量步长 0.001、最小名义 50 USDT。回放导出的合约也是 0.1/0.1（`market/instrument.py` `ASSUMED`）。
- **结论**：今天三处冻结都是"名义 × 0.1"，相当于 Binance 的 10 倍杠杆，与账户契约里的杠杆 1 不符。Binance 冻结的是"名义 / 杠杆"。要让 Nautilus 冻结等于 Binance，需要 `margin_init` = `margin_maint` = 1，且原生杠杆等于 Binance 杠杆；或保留 0.1，把原生杠杆设为 Binance 杠杆 × 0.1。

## 2. 现状（只读核查）

- 回放：`effective_config.account` 已含 `default_leverage`（`engine/config.py:91`，值 "1"），经 `execution_account()` 进有效配置和它的哈希（`engine/config.py:485-500`）。账本不校验 `account` 的键集合；镜像和主机两边重算有效配置并要求相等（`engine/run.py:95-110`）。
- Paper：Sandbox 用 `ACCOUNT_CONTRACT["default_leverage"]`（`engine/paper.py`），合约来自 Binance 加载器，不改保证金率。`paper_run.config` 是自由 JSON（`ledger/schema.sql:247`），封存摘要的 `account` 是 `ACCOUNT_CONTRACT` 的拷贝。runner 容器没有市场目录，`paper start` 的主机进程有。
- Live：`require_account_mode` 只要求交易所 `symbolConfig.leverage > 0`（`engine/live_venue.py:185-189`）。manifest 的 `config` 键集合在 `engine/live.py` `read_manifest`、`live/runs.py:315,400-416` 处严格比对。Live 控制容器没有挂市场目录（`deploy/live_host.py:136-156`）；exchangeInfo 原始行只进 `preflight-<ns>.json`。

## 3. 设计

1. **`--leverage`**：正整数，三处同一个值。
   - 回放：`engine.run --leverage`，进 `execution_account()`，存在已有的 `effective_config.account.default_leverage`。`replay reproduce` 照 `--starting-balance` 的做法在不等于默认值时传它。
   - Paper：`paper start --leverage`，进 `paper_run.config.leverage`，传给 runner；封存摘要的 `account.default_leverage` 取它。
   - Live：`live preflight --leverage`，进 manifest `config.leverage`（新格式 `live-run-v7`）；`require_account_mode` 要求交易所 `symbolConfig.leverage` 等于它，否则 `LIVE_MARGIN_MODE`（收紧，A9 已授权）。Live 从不改交易所设置。
2. **保证金率**（`bars` 环境，回放和 Paper）：见第 5 节 Q2。
3. **合约条款比对**：Paper 和 Live 启动时，把加载的合约（Paper）或 exchangeInfo（Live）的最小价位、数量步长、最小名义价值与市场在该提交可见的条款（`market.instrument.visible`）比对，不一致就拒绝（新拒绝码 `TERMS_CHANGED`）。
   - Paper：`paper start` 主机进程读市场条款，写进 `inputs/terms.json`（运行输入，不进账本），runner 比对。
   - Live：控制容器没有市场目录，见第 5 节 Q3。

## 4. 新增保存字段审查（AGENTS.md）

2026-11-11 一个没参与设计的子代理只读审查了本节的保存项，结论和据此改的设计：

- **回放：沿用 `effective_config.account.default_leverage`，接受。** 账户已进有效配置和哈希；验证已要求研究与验证的账户相等（`registration/validation.py:324-325`），不同杠杆就是不同配置，不需要新键。改两处：
  - `replay reproduce` 总是传 `--leverage`，不照 `--starting-balance` 只在不等于默认值时传：默认值改了以后，旧值会被漏传。
  - 选 Q2 (a) 时，把 1/1 写进已有的 `account.initial_margin_rate`、`maintenance_margin_rate`（`bars` 今天是 None），存的配置就是实际跑的。
- **Paper：`paper_run.config.leverage`，接受。** 它是操作者每次运行选的独立事实，不能从候选的回放推出（回放可能用了多个杠杆）。没摘要就封存的运行（外部终止、启动失败）只有这份声明。读者：运行列表和 op_id 重放。改两处：
  - op_id 冲突检查（`paper/runs.py:269-270`）也比对杠杆。
  - 封存摘要的 `account.default_leverage` 写 runner 实际用的值，封存时与 `config.leverage` 不等就记为无效原因，不留两份不核对的副本。
- **Live：manifest `config.leverage` 并升格式，接受**（私有执行记录，不是研究数据）。补上：`_require_frozen_prepare`（`live/runs.py:410-413`）的比对清单和预检请求加入 `leverage`；`read_manifest` 校验它是正整数；`live-run-v6` 加进 `RETAINED_FORMATS`。
- **Paper `inputs/terms.json`，接受为运行输入。** 能从已存的 `market_commit` 和合约重建，不存。`TERMS_CHANGED` 的拒绝文字写出交易所的实际值，这个观察不会再现，随 runner.log 进封存。
- **Q2 (b)，从存储角度否决。** 存的原生杠杆（例如 0.3）和 Live manifest 的杠杆（3）是同一事实的两种写法，每个读者都要暗中换算。
- **研究账本 schema：没有 DDL 改动。** `paper_run.config` 是 `JSON NOT NULL`（`ledger/schema.sql:247`），没有视图或 `dolt_tests` 读其中的键。按 11-11 规则不必按草稿暂缓。Q1、Q2 改变运行时的账户经济，随 v8 生效，在落地处写明。
- **Q3 (b) 没有存储来源**：`terms.json` 不进账本，选 (b) 就要新的保存项和另一次审查，所以建议 (a)。

## 5. 要用户决定的事

- **Q1 默认杠杆。** 建议默认 3：入场上限是 3 倍权益，杠杆 1 时按 Binance 公式这种入场会因保证金不足被拒。另一选项：不设默认，三处都必须给出。
- **Q2 保证金率。** 建议 (a)：`bars` 环境把合约保证金率设为 1/1（回放用已有的 `with_margins`，Paper 换掉加载器合约上的两个比率，需先探针确认 Sandbox 接受），原生杠杆 = `--leverage`，冻结 = 名义 / 杠杆，与 Binance 一致。另一选项 (b)：保留 0.1/0.1，原生杠杆 = `--leverage` × 0.1，存的值与 Binance 杠杆不同，读者要换算。两者都会改变回放的可用资金和保证金不足拒单，是账户经济的改变，随 v8 生效。
- **Q3 Live 条款比对的数据来源。** 建议 (a)：Live 控制容器只读挂载服务器上的市场目录（改 `deploy/live_host.py`，随发布生效，不改主机配置）。另一选项 (b)：Live 只比对 Paper 同一候选最近一次运行记下的条款，不读市场。
- **账本 schema**：`paper_run.config.leverage` 是自由 JSON 里的新键，不改表结构；回放不加字段。按 11-11 规则，本项不算研究账本 schema 改动，可照常合入。

## 6. 用户决定与实现（2026-11-11）

用户经父会话转达："r1那些问题就按照他推荐的来就行"，三项都按建议：Q1 默认 3；Q2 (a)；Q3 (a)。保存项按第 4 节审查过的设计，不加别的。

- **回放**：`engine.run --leverage`（默认 3，1 到 125 的整数，否则 `LEVERAGE_INVALID`）进 `effective_config.account.default_leverage`；`bars` 的 `account.initial_margin_rate`、`maintenance_margin_rate` 写 "1"，`with_margins` 对两种环境都用账户里的比率。`replay reproduce` 总是传 `--starting-balance` 和 `--leverage`。
- **Paper**：rc7 的 Python `Cache` 没有 `add_instrument`，换不掉加载器合约上的 0.1/0.1，所以 Q2 (a) 在 Paper 里这样实现：Sandbox 的原生杠杆 = `--leverage` × 0.1（`engine/paper.py` `LOADER_MARGIN`）。第 1 节探针表明冻结 = 名义 × 比率 / 杠杆，0.1 配 0.3 和 1 配 3 冻结相同（名义 500 都冻结 166.67）。加载的合约比率不是 0.1 时以 `TERMS_CHANGED` 停止运行，不会悄悄按错的杠杆跑。存的仍是 Binance 杠杆：`paper_run.config.leverage` 和摘要的 `account.default_leverage`（摘要的比率照 `ACCOUNT_CONTRACT` 写 1/1，与 Sandbox 实际冻结等价）；封存时两者不等记 `LEVERAGE_MISMATCH`，封为 Invalid（读数版本 `paper-readings@2026-11-11`）。`paper start` 把市场在该提交的条款写进 `inputs/terms.json`，runner 在启动时比对最小价位、数量步长、最小名义。
- **Live**：声明文件 `defaults` 和页面请求的运行参数加 `leverage`，进 manifest `config.leverage`（格式 `live-run-v7`，v6 留作可读）；`require_account_mode` 要求交易所 `symbolConfig.leverage` 等于它（`LIVE_MARGIN_MODE`）。声明加 `market_root`，控制容器只读挂载；`prepare` 读市场最新提交的条款写进 manifest `market`（读不到为 `LIVE_MARKET_TERMS`），每次入场准入时与 exchangeInfo 比对，不一致为 `TERMS_CHANGED`。页面的准备请求多了一个字段，Live 网页协议升到 4（`live/protocol.py`，基线 `tests/live/protocol-4.json`）；部署声明 `live-deployment-v1` 的字段集加 `market_root`，`defaults` 加 `leverage`。2026-11-11 远端主机已重装、还没装产品，没有旧声明要兼容。
- **比对的条款**：`engine.config.TERMS_COMPARED`，最小价位、数量步长、最小名义价值，按十进制比较（"0.0100" 等于 "0.01"）。2026-11-11 本机市场在 20261109 提交的 BTCUSDT 为 0.10、0.001、50，与 rc7 加载器一致。
- **先查 Nautilus（用户 2026-11-11 要求）**。查了 rc7 源码存根（`nautilus_trader/{backtest,model,adapters/sandbox,adapters/binance,common,live}/__init__.pyi`）、官方 Accounting 文档和 GitHub issue：
  - 回放直接用 Nautilus 的 `LeveragedMarginModel`（`MarginAccount` 默认）：冻结 = 名义 / 杠杆 × `margin_init`。比率写 1、原生杠杆写 `--leverage` 就是 Binance 的公式，没有自建计算。
  - Paper：`SandboxExecutionClientConfig` 只有 `default_leverage`，没有 `margin_model` 或按合约的比率；Python `Cache` 只有 `add_instrument_close`、`add_synthetic`，没有 `add_instrument`；`BinanceInstrumentProviderConfig` 没有比率覆盖。rc7 的 Rust Binance USD-M 解析器把 `margin_init`、`margin_maint` 都写成 0.1，上游 [#5531](https://github.com/nautechsystems/nautilus_trader/issues/5531) 报的正是这一点（未修复）；按账户覆盖比率的 [#5580](https://github.com/nautechsystems/nautilus_trader/pull/5580) 和 Sandbox 按单杠杆的 [#4697](https://github.com/nautechsystems/nautilus_trader/issues/4697) 也都未进 rc7。所以 Paper 只能用 Sandbox 自带的 `default_leverage` 折算（× 0.1），并在加载的比率不是 0.1 时停止；上游修好、升级 Nautilus 后去掉 `LOADER_MARGIN`。
  - Live：`BinanceExecClientConfig.futures_leverages` 能在启动时改交易所的合约杠杆，但第 3 节的决定是 Live 从不改交易所设置，`engine/live_node.py` 照旧传 `None`，只检查交易所杠杆等于声明值。条款比对用的是准入已经取到的 exchangeInfo 快照，没有另取；Nautilus 不知道研究用的市场目录，没有"与外部条款比对"的功能，这一步是本产品的信任边界。
