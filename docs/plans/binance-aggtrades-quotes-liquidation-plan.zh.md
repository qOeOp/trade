# 用 Binance 公开成交推算分钟内买卖价，开启原生强平：实施计划

2026-10-24。本页记录用户当日的决定、实施顺序、验收口径和仍需授权的项。调查依据：`/tmp/trade-okx-official/binance-public/BINANCE-NATIVE-ROUTE.zh.md`（Binance 原生路线与四天验证）、`/tmp/trade-okx-official/route400-review/REVIEW.zh.md`（Nautilus 2.0.0rc3 强平接线事实）、`/tmp/trade-okx-official/basis/basis-report.zh.md`（OKX 与 Binance 分钟价差）、Codex 线程记录 `docs/plans/okx-official-market-data.zh.md`（Codex worktree）。尚未实施任何代码或数据变更。

本页第一版（同日上午）的数据源是 OKX 400 档盘口代理；同日晚用户改选 Binance 公开成交推算路线，本版替换数据源、验收口径与报告约定，强平模型、保证金配置、比较器修复不变。OKX 全年归档保留为对照，不进产品。

## 用户决定（2026-10-24）

1. 研究场所仍是 Binance USDT 永续；不切换交易所，不混用其他交易所的合约条款、费率、资金费。
2. 分钟内买卖价来源：Binance 官方公开归档 `data.binance.vision` 期货 USDⓈ-M 每日 `aggTrades`。按 `is_buyer_maker` 推最优买卖价（规则见下），全年每天都有文件、带 `.CHECKSUM`、`agg_trade_id` 逐条连续。
3. 接受 Nautilus 2.0.0rc3 的简化强平模型，并在模型声明里写明：按缓存买卖价估值触发（不用标记价）；维持保证金按净持仓开仓均价一次算定、不随行情重估；默认零观测与下单延迟、无滑点、不消耗流动性。
4. 不存 400 档全深度。强平与市价单按最优价成交，不模拟深度。**存完整推算序列，不抽稀（用户 2026-10-24 晚决定）**：原定"每秒留三条"的抽稀不是无损的，同一夹具在真实 2025-10-01 数据上，完整序列于 08:50:12.033 以 116211.4 强平，抽稀序列于 08:50:12.959 以 116295.8 强平，期末权益低 1,482 USDT（`/tmp/trade-okx-official/measure-day/full-vs-thinned-liquidation.json`）。体积：BTCUSDT 约 90 万行/天、约 4.4 GB/标的年 Dolt，ETH 约 6 GB，中小币 0.04–0.7 GB；50 个标的一年估 20–25 GB Dolt、备份同量级、Catalog 约 20 GB。抽稀选项已从代码删除。
5. 不新增价差标注；OKX 代理方案取消。报告层改为"成交量对照当分钟 ±1% 价带挂单量"的提示（见第 7 步）。

## 推导规则（写入数据合同）

- 输入：每日 `aggTrades` 文件，字段 `agg_trade_id, price, quantity, first_trade_id, last_trade_id, transact_time, is_buyer_maker`，数量单位已是 BTC。
- `is_buyer_maker = true`：卖方吃单，`price` 为该时刻的最优买价；`is_buyer_maker = false`：买方吃单，`price` 为该时刻的最优卖价。每一侧保持到该侧下一笔成交。
- 一侧过时导致买价 ≥ 卖价时，以较新一侧为准，另一侧按合约最小价位推开一格；逐日计数写进导入回执（四个样本日此类秒占 1%–6%）。
- 挂单量：不可观测。QuoteTick 两侧数量统一填市场库 `instrument.max_quantity`（即 exchangeInfo `LOT_SIZE.maxQty`，BTCUSDT 为 1000），含义是"不模拟深度、按最优价全成交"，写进模型声明；不新增 `MARKET_LOT_SIZE` 字段。
- 时间：`ts_event = ts_init = transact_time × 1e6`，声明"按交易所成交时间回放、零额外接收延迟"。同毫秒多笔按 `agg_trade_id` 顺序。跨日：每一侧从前一日末状态延续，导入时多读前一日；首个导入日的开头两侧未齐前不出报价。
- 这是一个**声明的近似报价模型**，不是盘口观测：成交价是成交瞬间所在一侧的最优价，但两次成交之间该侧的真实报价可能已经移动；aggTrades 把同一吃单在同一价位的成交聚合为一条，不含盘口状态。已验证误差（对 Tardis 免费公开的 Binance 真实 bookTicker，四个月初日）：逐秒中价绝对偏差中位数 0.00 bps、p99 0.2–0.7 bps；每分钟最低买价与最高卖价 p99 0.02–0.7 bps。误差主要方向是盘口偏宽（买价偏低、卖价偏高），但不是单向：过时一侧也会落在真实点差之内（2025-10-01 买价 p99 +0.009 bps、最大 5.8 bps），对被估值一侧偏乐观、延迟触发。验收因此增加一项：在每月 1 日用真实 bookTicker 跑同一强平夹具，比对触发时刻、成交价与账户结果。

## 事实依据（已核实）

- 2025-10 至 2026-09 每月 `aggTrades` 文件齐全（BTCUSDT、ETHUSDT、SOLUSDT 均核对），每日约 17 MB zip、约 137 万条；`agg_trade_id` 日内逐条加一、跨日衔接（10-01 末 2869241290 → 10-02 首 2869241291）。`bookTicker` 归档 2024-04 后停更；官方 T_DEPTH 下载接口仅 VIP 且 2024-11-01 后无数据。
- rc3 接线事实：必须有缓存报价否则 RiskEngine 以 `MARKET_PRICE_UNAVAILABLE` 拒单；`process_liquidations` 只读缓存报价；MARGIN 账户默认杠杆 10 且默认 `LeveragedMarginModel` 把名义除以杠杆；维持保证金来自 `avg_px_open`；L2 venue 上 K 线不驱动撮合，L1 venue 读显式 QuoteTick。
- Binance 每日 `bookDepth` 文件（约每分钟一次，±1%…±5% 价带挂单量与名义额）全年都有，可作成交量合理性对照。

## 实施顺序

每步独立可验，前一步的产物是后一步的输入。

1. **先量一天。** 用 2025-10-01 跑完整链路（下载→校验→推算→抽稀→导入→导出→回放），记录报价条数、库体积、导入与导出耗时，并与同日 Tardis 免费 bookTicker 复核一次偏差分布，再决定全年与多标的的节奏。
2. **市场库报价表。** 新表存抽稀报价（symbol、ts、bid、ask、整数定标；数量由导出器按规则填，不入库）、来源标识（归档文件名与 SHA-256、推算器身份、过时侧调整计数）。按 AGENTS.md 先做独立子代理字段评审并记录在本目录。导入沿用 `market import` 的纪律：按月、一次事务一个提交、只增不改、通过验收项才落库。
3. **导入验收项。** zip 与 `.CHECKSUM` 一致；CSV 完整读到末尾；`agg_trade_id` 日内连续且与前一日末尾衔接（`SEQUENCE_GAP`）；`transact_time` 非减；推算后无买价 ≥ 卖价；价格精确落在存储定标。任何一项不过即整月拒绝，不补行、不改值。读数（随导入结果打印、不作拒绝阈值）：每合约成交数、状态变化数、过时侧推开次数、有成交的分钟数、成交间隔最大值与 p99。原计划的「每日 1440 分钟都有报价」改为读数：报价是向前延续的，分钟覆盖只反映活跃度，低活跃度合约能否用于强平研究另议。每月 1 日与 Tardis 免费 bookTicker 的逐秒比对作为单独的核对步骤，不在导入里下载。
4. **导出与运行环境。** 导出器增加 QuoteTick 写入（数量填 `instrument.max_quantity`）；运行器增加"报价撮合 + 原生强平"环境：L1 venue 读显式报价（不需要派生报价）、**`bar_execution=False`**（现有合同是 L1 venue 加 `bar_execution=True`，分钟线会继续按开高低收合成路径驱动撮合，必须显式关闭，分钟线只供策略信号）、`liquidation_enabled=True`、显式 `default_leverage=1` 与 `StandardMarginModel`（或按策略条款显式映射）、`margin_init/margin_maint` 取 Binance 该策略最大仓位所在档位的费率，模型声明写入运行合同。接入时用原生探针验证同一时间戳上报价、分钟线、资金费与策略回调的处理顺序。新 CI 镜像。
5. **修比较器。** 强平订单编号带随机 UUID，`engine.compare` 按原始订单编号遍历导致报告指纹不稳定（Codex 发现）。改为按确定性场所订单身份对齐后再编号，保留订单关联与经济字段。这是现有缺陷修复，属于产品代码。
6. **验收回放。** 用已知会爆仓的工程场景做多空各一次：触发、先撤挂单、只减仓 IOC、跳空负权益如实进账户与报告；同一输入重放一致；健康仓位不误触发。
7. **报告 skill。** `nautilus-report-analysis` 增加一段规则：对每笔成交（含 LIQUIDATION），取 Binance `bookDepth` 当分钟 ±1% 价带挂单量，标出成交量超过该深度的笔数；说明本环境按最优价全成交、不模拟深度。

## 报价表字段评审（2026-10-24，独立子代理，按 AGENTS.md 三问）

评审对象：方案 A（新表 `quote` + 可选 `quote_source` 回执表）与方案 B（只存来源哈希、报价由导出器直接从归档生成）。结论：**采用 A，去掉 `quote_source`，规则版本写进导入提交信息**（A2）。

- 否决 B：AGENTS.md 把市场数据列为"不可重现的观测"，`bar` 同样可重下却入库，先例一致；若 Binance 改动或撤下归档，只存哈希的提交将无法再生产输入（bookTicker 归档已在 2024-04 停更，这是真实风险）；B 还把 310 GB 下载与推算成本挪到每次导出。"存一次、不存推导"针对的是已存数据的推导，aggTrades 并不入库，抽稀报价是回放消费的最小确定形式，与只存 1 分钟线同理。
- `quote` 三问：消费者是 `export.py` 的 QuoteTick 写入（按提交 `AS OF` 读常量 `ts` 区间）；记录的独立事实是 Binance 成交对最优买卖价的证据（`bar` 只有高低收、无买卖侧）；无法由现有表推导，因为 aggTrades 不入库。
- 字段：`symbol`、`ts`、`agg_trade_id`（同毫秒内区分三条抽稀行、可对重下归档逐行核验，不造序列号）、`bid`、`ask`（×10^price_scale）。**主键改为 `(symbol, ts, agg_trade_id)`，不建二级索引**：原方案 `(symbol, agg_trade_id)` 加 `ts` 索引会让十亿行表体积近乎翻倍，且合约代码复用时 aggTrade 序列若重启会冲突；导出按主键常量区间扫描，与 `bar` 一致。同一 aggTrade 产生的三条抽稀行合并为一行。
- 不存：挂单量（导出时填 `instrument.max_quantity`）；逐行"推开过"标记（无消费者，且无法事后区分真实一格点差）；`quote_source` 表的输入行数、输出行数、调整次数（导入即检、`COUNT(*)` 可得、属质量读数随导入结果打印）。**修正（2026-10-24 晚，Codex 审阅）**：归档 SHA-256 是输入身份，消费者是独立审计（没有它就无法判断重下的归档是否仍是当初的输入）；每日归档哈希写进该次导入的提交信息（`archives`，与 `quote_rule`、`thinned` 同处），不建表、不加字段。
- 规则版本 `quote_rule` 作为导入提交信息 JSON 的一个键，像 `scope` 一样每次导入必须相同否则拒绝；不加 schema 版本、不改 `market_schema` 触发器。
- 评审指出的两处修正已改入本页：挂单量来源应为库内 `instrument.max_quantity`（`LOT_SIZE.maxQty`），不是 `MARKET_LOT_SIZE`；跨日两侧状态延续、导入多读前一日。
- 评审附带条件：建表前实测 Dolt 在 2 千万行/标的年的插入速率、库与 `dolt_backup` 增量、导出读取时间与导入内存（本机受内存约束），并另量一个低活跃度币种；新增提交测试只做最新月份的全键查找；Dolt 不达标时的退路是缩少标的或月份的 A，不是 B。

建表 DDL：

```
CREATE TABLE quote (
  symbol VARCHAR(40) NOT NULL,
  ts BIGINT NOT NULL,            -- transact_time, UTC ms
  agg_trade_id BIGINT NOT NULL,  -- 产生该状态的 aggTrade；区分同毫秒的行
  bid BIGINT NOT NULL,           -- × 10^price_scale
  ask BIGINT NOT NULL,
  PRIMARY KEY (symbol, ts, agg_trade_id),
  CHECK (bid > 0 AND ask > bid)
);
```

## 第 1 步结果（2025-10-24 已量，`/tmp/trade-okx-official/measure-day/MEASURE-DAY.zh.md`）

2025-10-01 一天：aggTrades 1,368,367 行 → 买卖价变化 900,635 → 抽稀 53,697 条；过时侧推开 13,723 次（成交的 1.0%），处理后无交叉秒。Catalog 抽稀 1.54 MB/天（单标的一年约 0.56 GB，50 个标的约 28 GB），不抽稀 11.4 MB/天；读取推算抽稀 0.65 s/天，引擎回放抽稀 0.07 s/天（单标的一年约 0.4 分钟）。对同日真实 bookTicker：买卖价 abs 中位 0、p99 ≤0.66 bps，每分钟极值 p99 ≤0.19 bps，抽稀不损精度。合成夹具下原生强平在 08:50:12.959 触发并一次平仓，链路通。未量：市场库导入（待建表；单标的一年约 1,960 万行，50 标的约 10 亿行，Dolt 在此行数的表现是下一个要测的风险点，备选是市场库只存来源清单与哈希、报价直接生成 Catalog）。

## Dolt 容量实测（2026-10-24，`/tmp/trade-okx-official/dolt-measure/DOLT-MEASURE.zh.md`）

一次性 Dolt 2.4.2 服务，按产品导入方式（每 20,000 行一条 INSERT、一月一事务一提交）装入一个标的一年 18,348,185 行（五个真实日平移复制，仅作容量测量）。评审键 `(symbol, ts, agg_trade_id)`、无二级索引：每月插入 8–10 s（约 18 万行/s），提交瞬时，库 242 MB，备份 236 MB 用 3.2 s，服务内存峰值 912 MB，取一个月 156 万行 2.6 s，按旧提交 AS OF 计数瞬时。原方案键加二级索引体积大 53%。线性外推 50 个标的一年约 9.2 亿行、库与备份各约 12 GB、插入约 1.4 小时；超线性部分按月观察。评审附带条件已满足，建表无容量障碍。

低活跃度合约（同日）：ETHUSDT 87,746 条、DOGEUSDT 76,891 条、KNCUSDT 8,025 条抽稀报价；KNCUSDT 一天只有 15% 的秒有成交、过时侧推开占 12%，推算报价会停在几十秒前，强平估值方向为延迟触发。正式接入须按合约用每月 1 日 Tardis 免费 bookTicker 复核，并把成交间隔 p99 写进导入结果作合约级质量读数；低活跃度合约能否用于强平研究另议。

## 实施进度（2026-10-24）

- 第 5 步比较器：PR #1661（`fix(engine)`），遍历键遮罩随机串、按首个事件时间与合约排序；97 个引擎测试通过。
- 第 2、3 步表与导入：PR #1663（分支 `feat/market-quotes`）：`market/schema.sql` 新增 `quote` 表（评审 DDL）；`market/quotes.py` 推导、抽稀、定标与拒绝；`market/sources.py` aggTrades 归档读取（含 `.CHECKSUM`）；`market/store.py` `import_quotes`（按月一事务一提交，提交信息带 `quote_rule`，`MONTH_EXISTS`/`RULE_VERSION_MISMATCH`/`SEQUENCE_GAP`/`UNIVERSE_UNKNOWN`/`TERMS_UNKNOWN`）；`ledger/db.py` `upgrade_market`（给已有库补建缺失表，管理员，一次提交）；CLI `market upgrade`、`market import-quotes`；测试 `tests/market/test_quotes.py`（规则、抽稀、定标、拒绝、一次性 Dolt 上整月导入与升级）。产品模块对真实 2025-10-01 归档的结果与探针逐项相同（53,697 条抽稀报价、900,635 次状态变化、13,723 次推开）。活动市场库尚未执行 `market upgrade`，待用户下令。
- Codex 审阅（2026-10-24 晚）指出四点，均已采纳：抽稀证实有损后用户决定全部存完整，抽稀代码删除；措辞改为近似报价模型、误差双向、增加对真实 bookTicker 的强平结果比对；归档哈希写入提交信息；第 4 步必须 `bar_execution=False` 并验证同时间戳顺序。
- 第 4、6、7 步未开始。

## 仍需用户授权的项

- 新存储字段：独立评审已完成（见上），建表 DDL 如上；是否按此建表待用户确认。
- 比较器修改（第 5 步）涉及审计比较语义，需确认。

## 明确不做

- 不用 OKX 或其他交易所行情作 Binance 输入；OKX 全年归档只作每月 1 日之外的工程对照。
- 不存全深度盘口；不沿盘口逐档成交。
- 不改 Nautilus 依赖；不自建报价、强平或盘口引擎。
- 不用补造时间戳、序列号或静默丢行通过检查；过时侧推开一格是声明过的规则并逐日计数，不是静默修改。
