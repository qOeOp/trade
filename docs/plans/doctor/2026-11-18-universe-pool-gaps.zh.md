# 2026-11-18 Universe Pool 的四项产品与数据缺口

用户在核对 `usdt-perp-listed30d-v1` 的月度池生成与多年回测逻辑时指出：拿近期配置的池子去跑过去几年的历史回测不合理，并要求把核实出的四项 Universe Pool 实质问题记入 Doctor 未结列表供后续处理（此前 `20261105-18`、`20261105-36`、`20261105-37` 仅做了文档或 skill 文字止血並已移入已结，底层数据与代码限制均未消除）。

| Item | Value |
|---|---|
| Sessions | Google Antigravity，会话 `7dd384d0-a75e-43d2-ac0b-d48f31101599`（Gemini 4 Argon），2026-11-18 |
| Audit session | 同一会话；聚焦诊断，只写本记录与 `docs/plans/doctor/index.zh.md` |
| Checkout / ledger | `origin/main` `d820f6932`（工作树 `d346ba4ee`）；活动账本提交 `n048j5n26l9e3mmqe3qvs6iq1e43bgog`；活动市场目录最新完整市场日 `2026-11-17` |
| Coverage | `market/{universe,store,follow,files,read}.py`、`registration/inputs.py`、`engine/{run,membership}.py`、`docs/rd/replay-environment.zh.mdx`，以及活动市场目录各表合约覆盖与活动账本 `evidence_bundle` 的只读查询 |
| Cost | 聚焦诊断约 15 分钟；未跑回放，0 个无效试验 |
| Net change | 本记录不改代码与 skill；拒绝码 249，skill 词数 28,094 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261118-01 | `usdt-perp-listed30d-v1` 规则声明全市场合格币不排名、消除幸存者偏差，但部署 `--bar-symbols` 只框定事后挑选的 30 个合约（26 个合格币）回补到 2020 年，多年回测的池子与 `basket` 基准在数据源头带严重事后选择偏差（接 `20261105-18` 文字止血后遗留的实质偏差） | **用户指出**（`Product contracts and delivery` / `Data and usage cost`）：质疑跨好几年的回测为何能用现在的池子跑历史几年。<br>**当前产品**：`market/universe.py:4-8` 写明不排名、不取 Top N；但活动市场库 `instrument` 仅 30 个合约，剔除 `BTCDOMUSDT`、`DEFIUSDT`、`USDCUSDT`、`XAUUSDT` 后，`2020-02` 至 `2026-11` 共 82 个月的 `universe_month` 全集仅 26 个合格合约（`2020-06` 10 个、`2022-06` 17 个、`2024-06` 23 个、`2026-10` 22 个、`2026-11` 21 个）。[2026-11-05 市场数据模块](https://github.com/qOeOp/trade/blob/941cec23b/docs/plans/doctor/2026-11-05-market-data-modules.zh.md)实测：`2022-10` 至 `2026-10` 现有 26 币等权收益 +112.4%，而全量合格合约（均值 316.3 个）为 -35.9%；`2020-10` 至 `2026-10` 为 +1068.3% 对 +99.9%。`20261105-18`（#2131）仅改了报告文字说明，未解决底池与基准本身的幸存者偏差。<br>**消费者**：所有传 `--universe pool` 的多年回测，以及读取 `alpha_basket`、`beta_basket`、`by_regime`、涨跌月切片的研究报告与判断 | authority（确定全市场或有客观历史时点标准的导入范围，重建或扩展市场目录并处理旧 `market_day` 的 `basket` 基准版本；需用户授权切换活动市场库） | wrong output | open |
| 20261118-02 | 已导入的历史月份无法增量补入新合约的 K 线与月度成员：`bar` 与 `universe_month` 按月单文件存储，`store._import` 按整表 `through` 判 `MONTH_EXISTS`，重算成员又撞 `UNIVERSE_CHANGED`（接 `20261105-37` 文字修复后遗留的代码阻断） | **当前产品**：`market/files.py:4` 将 `bar`、`funding`、`universe_month` 存为 `<table_name>/<YYYY-MM>.parquet`；`market/store.py:368-379` 的 `through = files.bar_months_through(market)` 按整表判断，只要某月已有完整月文件，对第 27 个合约跑 `market import --symbols <新币>` 即被 `MONTH_EXISTS` 拒绝；`market/store.py:680-683` 在新币改变历史月份入选名单时还会抛 `UNIVERSE_CHANGED`。`20261105-37`（#2153）仅删改了 skill 里的提示文字，代码仍无法在不推倒重导整个市场库的情况下向已有月份增量补币。<br>**消费者**：需要把历史回测池扩充到现有 26 个合格合约之外的导入流程与维护者 | authority → fix（放宽单合约补导的 `MONTH_EXISTS` 检查并设计版本化或按提交隔离的 `universe_month` 重算方案，或改为按合约分文件存储；改拒绝码检查需用户授权） | hours | open |
| 20261118-03 | 池内 26 个合格合约中仅 3 个合约有 `quote` 与 `agg_trade`、9 个合约有 `metrics`，`--universe pool` 无法开启 `quotes` 撮合环境或 `--metrics` / `--trade-ticks` 回放（接 `20261105-36`） | **当前产品**：活动市场目录只读核查（市场日 `2026-11-17`）：`bar` 含 26 个合格合约（`2026-11` 当月池子 21 个），但 `quote` 与 `agg_trade` 仅含 3 个合约（`BTCUSDT`、`ETHUSDT`、`SOLUSDT`），`metrics` 仅含 9 个合约（`ADAUSDT`、`BNBUSDT`、`BTCUSDT`、`DOGEUSDT`、`DOTUSDT`、`ETHUSDT`、`LINKUSDT`、`SOLUSDT`、`XRPUSDT`）。`engine/run.py:826-835` 在 `quotes` 执行环境、`--trade-ticks` 或 `--metrics` 开启时逐个检查计划实例的每个交易月，其余池内合约（12~19 个）会直接触发 `QUOTES_MISSING`、`TRADES_MISSING` 或 `METRICS_MISSING` 拒绝。<br>**消费者**：在 `--universe pool` 上测试报价撮合（爆仓与滑点）、成交流或持仓量/多空比信号的策略回放 | authority / fix（将 `market follow` 的 `--symbols` 与历史回补对齐到池内合约，或支持按具备对应数据的池内子集筛选；改部署范围或放宽拒绝需用户授权） | hours | open |
| 20261118-04 | 池内包含历史下架/停盘合约（如 `EOSUSDT`、`BAKEUSDT`、`MKRUSDT`、`AI16ZUSDT`），但活动账本中 `lifecycle-<market_day>` 正式生命周期证据包数量为 0，跨年全池回测缺少原生下架事件与权威结算价支撑 | **当前产品**：活动市场库 `universe_month` 在 2020~2025 年包含 `EOSUSDT`、`BAKEUSDT`、`MKRUSDT`、`AI16ZUSDT` 等随后下架或停盘的合约；按 `docs/rd/replay-environment.zh.mdx:394-420`（`#W-3-2-2`）与 `registration/inputs.py:206-207`，跨下架时点的回放须通过 `--lifecycle-bundle` 传入 `lifecycle-<market_day>` 证据包以提供 `PRE_CLOSE`、终止时刻与精确结算价。但在活动账本（`n048j5n26l9e3mmqe3qvs6iq1e43bgog`）查询 `SELECT bundle, kind FROM evidence_bundle`，`lifecycle-*` 记录为 0 条。<br>**消费者**：跨越 2020~2026 下架时点的 `--universe pool` 回放与生命周期审计（无证据包时实例得不到 `PRE_CLOSE` 与终止截断，在停止交易后若有持仓还会引发 `CAPITAL_VALUATION_GAP` 或未清仓判无效） | fix / measure（盘点池内已停盘合约的官方下架公告与结算价原件，通过 `market lifecycle` 录入账本证据包） | hours | open |
| 20261118-05 | `market follow`（`market-import`）的自动维护范围与 `universe_month` 月度池脱钩：`--bar-symbols` 写死 30 个合约后币安新上市合约不会自动拉 K 线进池；`--symbols` 静态只写 3 个币，池内既有成员与每月新入池合约不会自动跟进 `metrics`（仅 54 MB）及 `aggTrades` / `quotes` | **用户指出**（`Product contracts and delivery`）：询问每月新加入的币是否由 `market-import` 维护、为何现在只有 3 个币有完整数据。<br>**当前产品**：① `market/store.py:388-389` 在 `scope` 为空时本会自动纳入全市场合格合约，但部署 `TRADE_MARKET_ARGS` 显式传 `--bar-symbols` 锁死 30 个合约，名单外的币安新上市合约永远不会被 `market-import` 拉取 K 线或进入新月度池；② 手动命令 `market import-metrics` 与 `market import-quotes` 默认取当月 `universe_month` 成员（`cli/market_commands.py:58,320,330`），但后台 `market/follow.py:48-55,466-510` 却只按静态 `--symbols`（仅 `BTCUSDT`、`ETHUSDT`、`SOLUSDT`）及曾手动导过近两月 `metrics` 的合约（`files.followed_metrics`）跟进，不读 `universe_month`。因此每月池内其余十几个合约及新入池合约（如 `币安人生USDT`）不会自动跟进轻量级的 `metrics`（9 个币共 54 MB）及 `aggTrades` / `quotes`。<br>**消费者**：依赖 `market-import` 无人值守维护月度池新币 K 线、持仓量/多空比（`metrics`）及盘口报价（`quotes`）的研究与模拟盘 | fix / authority（让 `market follow` 的 `metrics` 等数据支持自动跟随 `universe_month` 成员，并梳理 `--bar-symbols` 与 `--symbols` 的配置边界；改部署配置需用户授权） | hours | open |

## Removal list

无。

## Decisions

- 2026-11-18 用户要求将上述五项 Universe Pool 与 `market-import` 维护脱钩问题记入 Doctor 的 finding 列表，留待后续处理。
- 2026-11-21 用户「我都授权」：`20261118-01` 按只读设计研究选定的方案处理：用现有导入路径（空 `--bar-symbols` 即全部合格合约，不放宽任何拒绝）新建一个全合格范围的市场目录，导完后切换为活动市场目录。为此导入跳过没有数据来源的合约月（上市前、停止交易后），首次全量导入不再空等受限速的 REST 请求（[#3227](https://github.com/qOeOp/trade/pull/3227)）；`market follow --metrics-pool` 让 metrics 跟随每月成员（[#3228](https://github.com/qOeOp/trade/pull/3228)）；部署文档与示例 `.env` 去掉 `--bar-symbols`。`20261118-02` 的 `MONTH_EXISTS` / `UNIVERSE_CHANGED` 拒绝保持不变：新建目录从头导入，不需要往已有月份补币。两行的状态等切换完成后再改。
- 2026-11-21 [#3231](https://github.com/qOeOp/trade/pull/3231) 已合入（`5b28b36ba`）：全部合格合约成为文档里的默认导入范围。按上一条，切换到新的活动市场目录完成之前，`20261118-01`、`-02` 的状态不改。
