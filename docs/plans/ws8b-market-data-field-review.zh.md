# WS8b 市场库字段评审（2026-10-11）

来源：[重构计划](rd-round-audit-refactor-plan.zh.md) WS8 和 WS9 第 1 项；表设计的出发点是 [WS8a 实测](market-data-dolt-measurement.zh.md) 的方案 B。按 AGENTS.md，新增表和字段前由一个独立子代理（干净上下文，只读）审过：消费者是谁、记录的是哪个独立事实、为什么现有字段、关系、派生或代码常数表达不了。下面是提案、评审意见和最后的决定。表定义以 `research/market/schema.sql` 为准。

## 1. 评审时已知的事实

- 有归档的 USDT 保证金永续 900 个；合格的加密 USDT 永续 682 个。被排除的有：216 个 TRADIFI_PERPETUAL（股票、港股、韩股、A 股、商品、外汇、上市前），指数类 5 个（BTCDOM、DEFI、ALL，以及已不在 exchangeInfo 里的 BLUEBIRD、FOOTBALL），稳定币对 USDCUSDT。排除 TRADIFI 由用户 2026-10-11 确认。
- 2020-01 到 2026-10 进入过前 50 的合约 420 个，其中 20 个已下架且不在今天的 exchangeInfo 里（MATIC、EOS、LUNA、RNDR 等），条款只能从归档推断。
- 成交量的量级：DOGSUSDT 单日成交 1.57e13 个，乘 10⁸ 会让 1m 都可能超出 BIGINT，所以量不能和价格一样按 10⁸ 缩放。420 个合约当前的数量精度最多 3 位。
- 价格：最大 126,208.5（BTC）；LAST 价格都不超过 8 位小数，MARK 归档本身就是 8 位。
- 归档里偶尔有二进制浮点残留，例如 XRPUSDT 2020-01-17 的日成交量 `108824285.69999999`（数量精度 1）。
- exchangeInfo 只有当前快照。手续费和保证金不在里面，旧 Catalog 对所有合约都用假设值：maker 0.0002、taker 0.0005、初始和维持保证金 0.1。
- 在 682 个合约上，`baseAsset` 都等于 symbol 去掉 USDT；420 个里 tickSize 字符串的小数位与 `pricePrecision` 只有 YFIUSDT 不同（tick `1`，精度 1），stepSize 与 `quantityPrecision` 全部一致。

## 2. 评审意见与决定

| 表.列 | 评审意见 | 决定 |
|---|---|---|
| `market_schema.version` | 保留 | 保留。另加 `price_scale`、`volume_scale`、`pool_rule` 三列，库自己说明编码和币池规则（评审建议） |
| `contract`（原提案：每合约一个 `volume_scale`） | 倾向删除：只是编码参数；按合约"首次导入定死"在交易所以后调细数量精度时只能整币重写 | **删除整张表**。量统一按 10⁴ 缩放：比当前最大精度多一位；DOGS 单日 1.57e13 乘 10⁴ 是 1.6e17，距 BIGINT 上限约 58 倍，而 1m 的量远小于单日 |
| `instrument.valid_from` | 改：实际是快照的观测时间，`0` 等于假设"当前快照一直往前适用" | **改名 `observed_at`**（读到 exchangeInfo 的服务器时间），只在条款变化时追加一行。导出规则：取该 commit 上最新的一行；"往前套用"作为假设写进每次导出的 `export.json`（`historical_terms: CURRENT_SNAPSHOT_APPROXIMATION`），和旧 Catalog 一样 |
| `instrument.terms_source` | 保留：exchangeInfo 不入库，无法派生 | 保留：`exchange_info` 或 `inferred` |
| `instrument.base_currency` | 先验证是否等于 symbol 去掉 USDT，成立就删 | **删除**：682 个合约全部成立 |
| `instrument.price_precision`、`size_precision` | 删除：可由 tickSize/stepSize 派生，另存会和 increment 矛盾 | **删除**。increment 原样存交易所的字符串（例如 `0.010`），它的小数位就是 Nautilus 用的精度（Nautilus 要求 increment 的精度等于合约精度；旧 Catalog 里 AAVE 的精度 3、increment `0.010` 正是如此）。不去掉尾零，因为尾零就是精度。YFI 因此是 0 位，见第 3 节导出规则 |
| `instrument.max_quantity`、`min_notional`、`min/max_price`、`min_quantity` | 改为可空：已下架合约推不出来，NOT NULL 会逼导入编数 | **可空**。`inferred` 行这五列全为 NULL，`exchange_info` 行全不为 NULL，由 CHECK 约束 |
| `bar.*` | 保留；加 `price_type='LAST' OR volume=0` | 保留。加两条 CHECK：OHLC 一致且 low > 0、volume ≥ 0；MARK 的量为 0。实测多行 INSERT 下 CHECK 生效，导入 50 万行从 2.6 秒变为 3.0 秒（+15%） |
| `funding.rate` | 加宽松上下界 | 加 `CHECK (rate > -1 AND rate < 1)` |
| `funding.interval_hours` | 建议补上（可空），用来区分"漏了一期"和"间隔改了" | **不存**。没有消费者：导出写 FundingRateUpdate 时 `interval` 为空，与旧 Catalog 一致；连续性检查只需"相邻两期不超过 8 小时"（所有合约的间隔都不超过 8 小时），不必知道间隔本身。真要用时再评审 |
| `daily_volume` | 保留：唯一独立来源；起点问题必须解决 | 保留。2020-01 的币池需要 2019-12 的成交额和上市日期：归档从 2020-01 开始的合约，用公开 REST 日线补到上市日（实测 REST 对已下架合约也返回历史，例如 EOSUSDT） |
| `pool` | 保留；规则 id 入库；每次导入从 daily_volume 重算比对 | 保留 `(month, rank, symbol)`；规则 id 在 `market_schema.pool_rule`。每次导入都从库里的 daily_volume 重算全部已存月份，与已存的不一致就拒绝（`POOL_CHANGED`）。同额按 symbol 排序。30 天成交额不存，可由 daily_volume 派生 |
| 排除口径 | 应写成规则代码里钉死的显式清单，不在运行时读 exchangeInfo | **部分采纳**。已下架的指数合约在代码里显式列出；新合约是否是股票类、指数类只能从 exchangeInfo 的 `contractType`/`underlyingType` 得知，导入时判一次。判过的结果以"是否出现在 daily_volume 里"留在库里，所以币池仍能只用库里的数据复算；以后 exchangeInfo 变了也不影响已存月份 |

## 3. 不存的东西

| 内容 | 去处 |
|---|---|
| 报价和结算币种（恒为 USDT）、instrument id（`{symbol}-PERP.BINANCE`）、coin 名 | 代码派生 |
| MARK 精度 | 常数 8（归档格式） |
| 手续费、保证金 | 导出器常数，写进每次导出的 `export.json`（`assumed`）；它们是假设，不是交易所事实 |
| 30 天成交额、上市日期、是否合格 | 由 daily_volume 和排除常数派生 |
| K 线收盘时间、成交笔数、主动买量 | 不用；WS8a 实测"笔数为 0"与"量为 0"等价 |
| 新鲜度（最新完整月、当月补到哪天） | 从每个合约 bar 主键上的最大时间派生（`market status`） |
| 导入记账 | 每次导入一个 Dolt commit，提交信息写 covered-through 日 |

导出时的精度规则：价格以 10⁸ 存储，按 increment 的位数还原成 Nautilus 价格前逐值检查能否整除；历史上比现在 tick 更细的价格（检查不通过）不拒绝，而是把这个合约本次导出的精度放宽到数据需要的位数，并在 `export.json` 里记 `price_precision_widened: true`。评审建议的是"不满足就拒绝"；改为放宽的理由是：一个合约拒绝会让整个币池的回放失败，而放宽只影响下单价格的最小单位，并且留有记录。

## 4. 评审的可选建议

- bar 表按 symbol 用 SMALLINT 代理键以减小体积：未采纳。实测每行 22.6 字节，与 WS8a 一致，体积已达标。
- 加一张 `source_file(path, sha256)` 表，区分重导入的差异来自币安改了归档还是导入器变了：未采纳。导入只追加，已存行不会被改写；同一次导入里两个来源对同一分钟不一致就拒绝（`SOURCE_CONFLICT`），币池每次都按库里的日成交额重算并与已存月份核对。要查币安是否改过归档，可以在分支上重新导入，再用 `dolt diff` 看哪些行变了（WS10 的提议）。
