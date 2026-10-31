# Binance 持仓量与多空比：市场库导入与回放输入

2026-10-31。用户问：要不要把 Binance 公开的持仓量（OI）和多空比加进产品？这个想法来自 nofx 的
`kernel/engine.go`，它把实时 REST 快照喂给模型。

本文的建议是加。数据免费，能打开持仓与拥挤度这一类假设，而且这件事只能由产品代码来做，理由有两个：
- 归档的时间戳比内容早：一行数据要过了 `create_time` 之后几分钟才可见。让 Agent 自己拉，等于让它
  自己检查自己有没有偷看未来；
- 回放只认钉住的市场提交：`/tmp` 里的文件不进 `export_content_sha256`
  （`registration/inputs.py:52-77`），没法复现。

按 AGENTS.md，加存储字段之前先做了独立子 Agent 审阅，结论见文末。依据 main 7ef099085，nautilus-trader 2.0.0rc7。

## 范围

做：
- 把 Binance USD-M 每日 `metrics` 归档里的持仓量和三个多空比存进市场库；
- 导出为 Nautilus 自定义数据，按可见时刻送给订阅了它的策略。

不做：
- 主动买卖量比和持仓价值，理由见“不存什么”；
- 撮合、账户、执行环境的任何改动。这些数据不进场所，不动盘口；
- 付费数据，或 Binance 以外的来源。

## 实测（2026-10-31，本机；审阅者独立复测）

**来源**
- 地址：`data.binance.vision/data/futures/um/daily/metrics/{SYM}/{SYM}-metrics-{date}.zip`，旁边有
  `.CHECKSUM`。
- 只有日归档，次日发布（T+1）。每天 288 行，5 分钟一行。
- 列：`create_time, symbol, sum_open_interest, sum_open_interest_value,
  count_toptrader_long_short_ratio, sum_toptrader_long_short_ratio, count_long_short_ratio,
  sum_taker_long_short_vol_ratio`。
- `create_time` 是不带时区的文本，按 UTC 解析。
- 文件内的行不按时间排序。
- REST `/futures/data/*` 只保留 30 天，历史只能靠归档。

**覆盖**
- 起始日：BTCUSDT 2020-09-01；ETH、SOL、DOGE 2021-12-01；1000PEPE 2023-05-05。截至 2026-10-30，这五个
  合约在起止日之间没有缺日文件。
- S3 列表里，有 metrics 的 USDT 合约 921 个，有 klines 的 923 个；只有 DOTECOUSDT、LENDUSDT 有 K 线
  没有 metrics。已下市的 SRM、FTT、LUNA 都有。

**文件内容**：抽查了 3 个合约共 39 天，校验和全部一致。
- 整行重复：BTCUSDT 从 2020-09-01 到至少 2021-05-15，每天 576 行，每个时刻两行。抽查的天里重复行
  逐字段相同，没有矛盾的。2021-06-01 起恢复 288 行。
- 日内缺行：BTCUSDT 2021-06-24 只有 279 行，2021-09-21 只有 283 行。
- 比值整列为空：2022 年有些日子比值列整天是空串。例如 ETHUSDT 2022-04-01，两个头部比值和主动买卖比
  各有 288 行为空。持仓量列在抽查里没有空过。
- 比值的小数位数随时间变化：2022 年 16 位，现在 8 位。
- 所有时间都落在 5 分钟整点上，没有为 0 的值。

**时间对齐**：BTCUSDT 2026-10-29 和 2026-10-15，各 288 行，和 REST 对比。

| 列 | 和 REST 的关系 |
|---|---|
| 持仓量、持仓价值 | 等于 REST 时间戳 t+5m 的值，288/288 逐位一致；和 t、t+10m 的值 0/288 一致 |
| 头部持仓多空比 | REST 现在只给 4 位小数。归档值四舍五入后，等于 REST t+5m 的值：285/288、286/288 |
| 头部账户多空比、全市场账户多空比 | 和 REST 任何时刻都不逐位一致，但离 t+5m 最近：平均差 0.00024–0.00026，离 t 和 t+10m 约 0.008 |
| 主动买卖量比 | 约等于 [t, t+5m) 内主动买量除以主动卖量（用 1 分钟 K 线算，相对误差中位 0.02%，p90 0.45%） |

所以一行里没有任何一列在 t+5m 之前完整，内容描述的是 t+5m 这个时刻。10-02 的旧记录说主动买卖比
“等于 REST t”，那是因为 REST 按区间开始打时间戳。

**发布延迟**：REST 时间戳为 T 的样本，第一次被本机轮询到的时间（11 分钟轮询，每 3 秒一次）：

| 端点 | 09:35 这期 | 09:40 这期 | 09:45 这期 |
|---|---|---|---|
| 持仓量 | +137 s | +18 s | +80 s |
| 头部账户比 | — | +63 s | — |
| 头部持仓比 | +61 s | +120 s | — |
| 全市场账户比 | +58 s | +117 s | — |

10-03 的旧测量：持仓量 104–144 s。

**冻结前复测**（2026-10-31 10:50–11:15 UTC 六期，BTC/ETH/SOL 四个端点，curl 并行，每 5 秒一轮，
72 个样本）：中位 98 s，p90 165 s，最长 183 s（真实值在 178–183 s 之间）。各端点最长：持仓量
179 s，头部账户比 162 s，头部持仓比 183 s，全市场账户比 180 s。同一端点各合约之间差别很大，
同一期里 2 s 到 183 s 都有。

**Nautilus 原生探测（rc7）**
- 自定义数据能存进 Catalog 再读出来：
  - `@customdataclass` 加 `register_custom_data_class` 后，用 `ParquetDataCatalog.write_custom_data`
    写 `CustomData`，文件在 `data/custom/<类名>/`；
  - 用 `query_custom_data(NautilusDataType.Custom("<类名>"))` 读回，`ts_event`、`ts_init` 分开保留，
    元数据里的 `instrument_id` 也在。
- 自定义数据能送到策略：`CustomData` 进了 `BacktestEngine.add_data` 后，订阅了它的策略在 `on_data`
  里按时间顺序收到。
- bars 环境里的成交时刻（审阅者探测，用生产的 `add_venue`）：K 线的时间戳是 `ts_open + 59.999 s`
  （`market/export.py:151`）。策略在 `on_data` 里下的市价单**当即**按上一根 K 线的收盘价成交，不等
  下一根：
  - 信号在 +60.000 s，成交价是 +59.999 s 那根 K 线的收盘价；
  - 信号在 +77 s，成交价还是那个收盘价，比决策早 17 秒。
- 这说明，自定义数据只有落在整分钟上，bars 环境的成交价才不会比决策旧。
  `trade-ticks-replay-input.zh.md` 和 `registration/seams.py:122-124` 对这一点的说明不对（它们说
  会按整根 K 线成交）。另外修，见“旁支问题”。

## 存什么

新表 `metrics`，以来源命名，列名照抄归档；每个合约每 5 分钟一行：

| 列 | 说明 |
|---|---|
| `symbol` | 主键 |
| `create_time` | 主键，UTC 毫秒，交易所的时间戳原样存。可见时刻由导出规则推出，不存 |
| `sum_open_interest` | 基础资产数量，精确十进制，不能为空 |
| `count_toptrader_long_short_ratio` | 头部交易者账户多空比，可空；源文件为空就存空，不填补 |
| `sum_toptrader_long_short_ratio` | 头部交易者持仓多空比，可空 |
| `count_long_short_ratio` | 全市场账户多空比，可空 |

- 小数位按归档里出现过的最多位数来定（16 位），超出就拒绝，不舍入。
- 一个合约一年约 10.5 万行。体积在第一次导入时测，预计远小于 `agg_trade`。

审阅结论：四列都是市场库里没有、从成交也推不出来的观察，都该存。`bar` 表限定只能放 LAST/MARK
的分钟行（`market/schema.sql:43-55`），放不下这种粒度和含义，所以要新表。

### 不存什么

- **主动买卖量比**：它是成交的合计。已导入完整成交的合约，可以从 `agg_trade` 的 `is_buyer_maker`
  和 `quantity` 精确算出来；没导入成交的合约，用 1 分钟 K 线的 `taker_buy_volume` 也能近似算，但
  bar 表现在丢掉了这一列（`market/sources.py` 的 `COLUMNS`）。bar 表要不要加主动买量，另行审阅。
- **持仓价值**：它是持仓量乘交易所的一个价格快照。这个价格在 t+5m 附近，和 LAST 第 t+4 分钟收盘价
  逐位一致的只有 52/288。策略要算价值，用持仓量乘自己看到的价格即可。
- **可见时刻**：由 `create_time` 加固定规则得出，不存。

## 可见时刻规则

导出时：
- `ts_event = create_time + 5 min`：内容描述的时刻。策略用 `ts_event` 和 K 线配对时，不会差 5 分钟；
- `ts_init = create_time + 10 min`：5 分钟加 5 分钟发布余量，是策略收到它的时刻。

几点说明：
- 余量必须是整分钟。`create_time` 本来就在 5 分钟整点上，所以 `ts_init` 一定在整分钟上，bars 环境
  的市价单会按决策时刻的收盘价成交（见上面的探测）。
- 两个执行环境都能用，不必像 `--trade-ticks` 那样限定 quotes 环境。
- 5 分钟依据：起初定 3 分钟（当时三期样本最长 137 s）。冻结前按 5 秒间隔又测了六期（见下），最长
  178–183 s，3 分钟不够，改为 5 分钟，比最慢的一行多约 117 s。
- 导出取描述时刻不早于区间起点的行：运行器不把 `ts_event` 早于实例输入起点的数据交给策略，
  这样导出的每一行都送得到。
- 规则只在导出时生效，所以不写进导入提交，由导出器指纹和内容哈希覆盖。
- 规则名 `binance-metrics-visible-v1` 只写进导出回执。

## 导入

命令：`market import-metrics --month YYYY-MM [--symbols ...]`，做法照 `import-trades`：
- 默认合约是当月的 universe 成员；
- 每次调用对每个合约月一个事务、一个提交；
- 用现有的导入账户、提交测试、DoltHub 发布和 `market backup`；
- `market upgrade` 只追加缺的表，旧表、旧提交不动；
- 每天的归档对照 `.CHECKSUM`。提交信息记：每个归档的 SHA-256、行数，以及下表里的各项计数。

当月的处理和 `agg_trade` 不同。`agg_trade` 当月导入后不能续，是因为它要检查 ID 连续，metrics 没有
这样的 ID。所以 metrics 每次导入只追加这个合约月还没有的日子，一直导到最后一个已结束的 UTC 日。
这样不会留下永久的空洞。

源文件里的问题：

| 情况 | 处理 |
|---|---|
| 同一时刻两行逐字段相同 | 只存一行，提交信息记合并的行数 |
| 同一时刻两行值不同 | 拒绝这个合约月 |
| 时间不在 5 分钟整点 | 拒绝 |
| 比值为空串 | 存空，计数 |
| 持仓量为空，或数值不是十进制 | 拒绝 |
| 小数位超出列的精度 | 拒绝，不舍入 |
| 日内缺行、缺日文件 | 不补，计数；`market coverage` 列出缺的区间 |
| 行不按时间排序 | 先排序，不算问题 |

## 导出与送达策略

照 `--trade-ticks` 的做法（`trade-ticks-replay-input.zh.md`）：
- 主机端入口加选项 `--metrics`。有这个选项才导出，回执的 `counts` 才有 `metrics`。
- 导出范围按 `ts_event` 与 `ts_init` 取，不按 `create_time` 取：取 `create_time` 在 [start−5m,
  end−10m) 内的行，再按每个 piece 的生命周期截断，和成交一样。否则窗口末尾 10 分钟的行会计进回执
  却不流出去，报 `DATA_COUNT_MISMATCH`（`engine/run.py:994-997`）；描述时刻早于输入起点的行会被
  运行器挡在策略之外。
- 在 `STREAM_TYPES` 里放在 QuoteTick、TradeTick 之后。quotes 环境里报价、成交可能和它落在同一毫秒
  （:00.000），要先处理报价和成交。
- `engine/` 定义并注册 `metrics` 自定义数据类，字段用表的列名，缺的比值为空。
- 策略用 `subscribe_data(DataType(<类名>, metadata={"instrument_id": ...}))` 订阅，在 `on_data` 里收。

这个选项要接到 `--trade-ticks` 经过的每一处：
- `registration.seams` 入口解析和 `ENTRY_FLAGS`；
- `replay/reproduce.py:68-81` 复现；
- 导出缓存键（`market/export.py:543`）；新的市场模块要加进 `EXPORTER_FILES`（`market/export.py:505`），
  否则缓存键不会变；
- 远程供给的参数白名单（`market/remote.py:298-309`）；
- 运行器读回执（`engine/load.py:300-305`）和原生计数重建（`engine/load.py:369-391`）。

两个兼容要求：
- **旧镜像**：`engine/load.py` 只拷贝它认识的计数键，旧镜像会悄悄丢掉新键，什么也不流，也不报错。
  所以对不支持的镜像，主机端必须明确拒绝 `--metrics`。
- **不带选项**：导出、事件流、回执、指纹都和现在一样。用一次配对原生重放证明。改了 `engine/`，要换
  新镜像摘要。

## 覆盖

`market coverage` 加一项：每个合约在区间内导入了哪些日子、首末行、缺失区间、各比值为空的行数。
research-start 的 readiness 检查要读到这一项：用户选的合约和期间缺数据时报出来，不自动删合约，也不
自动缩短窗口。

## 新拒绝（要用户授权）

AGENTS.md 规定，加拒绝或审计检查要用户授权；`--trade-ticks` 的同类拒绝也是用户授权过的。本方案要加：
- `METRICS_NOT_SERVED`：策略订阅了本次运行不送的合约。复用并推广 `_TradeSubscriptions`
  （`engine/run.py:146-160`）。paper 也走同一个包装（`engine/paper.py:252-256`），在订阅时拒绝；
- `METRICS_MISSING`：区间里有一个月，这个合约一行都没导，照 `TRADES_MISSING`
  （`engine/run.py:953-967`）；
- 旧镜像收到 `--metrics` 时拒绝；
- 回执计数审计扩展到 `metrics`；
- 导入时的拒绝：见上面的表。

## paper

paper 不送这些数据：策略一订阅就拒绝。等有候选策略真用上它，再单独做 REST 轮询，用同一条可见时刻
规则。第一批工作不碰 paper 的实时连接。

## 分批

每个 PR 都基于 main：
1. **市场库**：`metrics` 表、`market upgrade`、`import-metrics`、覆盖，测试用隔离的 Dolt。
2. **回放**：导出、自定义数据类、事件流、新拒绝、新镜像、配对原生重放。
3. **文档和 skill**：`docs/rd/design-code-market`、策略文件页、research-start 的 readiness 参考。

导入活动市场库是研究数据写入，按 AGENTS.md 只经 CLI。它会发布到公开的 DoltHub，所以范围要用户
确认。建议先导 BTC/ETH/SOL，从 2021-12 起。

## 旁支问题

bars 环境里，`on_data` 下的市价单按上一根 K 线收盘价当即成交。`--trade-ticks` 设计文档和
`registration/seams.py:122-124` 的说法不对：拒绝 `TRADE_TICKS_NEED_QUOTES` 的结论仍然成立
（一分钟中间的信号按最多 59 秒前的价格成交），理由要改。这和本方案无关，另行修。

## 审阅（独立子 Agent，2026-10-31）

审阅者核对了代码（main 7ef099085），重新拉了归档和 REST，做了一次原生 rc7 探测：
- 实测部分基本成立；
- 存储：同意新表和四列。主动买卖量比、持仓价值不存。存 `create_time`，不存可见时刻；
- 本文已按审阅改过以下几处：
  1. 表名、列名改为照抄来源；
  2. 去掉“张数”：USD-M 的持仓量是基础资产数量；
  3. `ts_event` 改为 t+5m；
  4. 整分钟的理由改为实测到的成交时刻，规则写成 +8 分钟（冻结前复测后改为 +10 分钟，见上）；
  5. 导出按 `ts_init` 取；
  6. 写明在 `STREAM_TYPES` 里的位置；
  7. 补全选项要经过的各处，以及旧镜像的拒绝；
  8. 规则名移出导入提交；
  9. 当月改为可以续导；
  10. 处理表补了排序、UTC、精度三项；
  11. paper 改为订阅时拒绝；
  12. 新拒绝改为明确请用户授权。

## 用户决定（2026-10-31）

用户回复“全部批准”，批准了三件事：
- 按本文做，分三批 PR；
- “新拒绝”一节列出的全部拒绝；
- 第一批导入：BTCUSDT、ETHUSDT、SOLUSDT，从 2021-12 到最后一个已结束的 UTC 日，导入活动市场库并发布
  到公开的 DoltHub。

表名、列名这类实现中的细节由实现者定，并在 PR 里写明。
