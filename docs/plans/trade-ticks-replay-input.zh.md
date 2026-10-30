# 成交级输入：完整 aggTrades 作为成交事件进入原生回放

2026-10-31。用户要求尽快用上成交量失衡、成交级 VWAP 这类信号，批准顺序：先导入 BTC/ETH/SOL
完整 aggTrades，再把它接进回放的导出、输入身份、事件计数与覆盖，显式锁住现有撮合，用
BTCUSDT 2025-10 配对原生回放验收。本文是接入设计；导入见 `aggtrades-source-import.zh.md`。

## 范围

做：每条 `agg_trade` 行导出为一个 Nautilus `TradeTick`，只作策略的信号输入。

不做：
- 成交驱动撮合或新的成交量撮合模型；
- 真实盘口、队列或深度；
- paper 的实时成交订阅（paper 不送成交）；
- 改 bars/quotes 两个执行环境的任何条款。

aggTrades 没有挂单、撤单和深度，不能据此声称撮合更真实。

## 撮合锁定（原生实测，2.0.0rc7）

最初的方案是把原生 `TradeTick` 放进事件流，并给 `add_venue` 显式传 `trade_execution=False`。
实测否定了它：
- 原生 TradeTick 进入撮合引擎后，无论 `trade_execution` 取什么，场所的 L1 簿都取成交价与量。
  这个开关只决定挂单是否随成交迭代。
- 实测：报价 100.00/100.10（量 1000.000），随后一笔 99.00、0.001 的成交，策略在成交回调里下
  0.010 市价买单。`trade_execution` 为 True 与 False 时都成交 0.001 @99.00 和 0.009 @99.01，
  而不是按报价 100.10。
- 所以原生成交一定改变 quotes 环境的撮合，在 bars 环境里还会在两根 bar 之间移动簿。

决定：成交以自定义数据送达。每个 TradeTick 包在
`CustomData(DataType("TradeTick", metadata={"instrument_id": "<合约>"}), tick)` 里：
- 场所不处理自定义数据，簿和挂单都不动。实测同一序列下市价单按报价 100.10 成交，挂单保持
  ACCEPTED；
- 只有订阅了这个数据类型的策略收到它；
- 它计入 `iterations`。

`trade_execution` 不再需要设置，`add_venue` 不变，有效配置不加任何键。

策略的写法：
- `subscribe_data(DataType("TradeTick", metadata={"instrument_id": str(instrument_id)}))`；
- 在 `on_data(data)` 里收，`data.data` 是原生 TradeTick（价格、数量、`aggressor_side`、
  `trade_id`、时间）；
- `subscribe_trades`/`on_trade` 收不到任何成交。

## 谁来要成交输入

入口选项 `--trade-ticks`（布尔开关），只在主机端：
- `registration.seams._runner_inputs` 解析，决定导出是否包含成交；
- 它在 `ENTRY_FLAGS` 里，`container_runner_args` 在交给运行器（和运行时探针）之前去掉它；
- 运行器不认识这个选项，按回执流成交：合约行的 `counts` 有 `trade` 就流。

不用策略源码声明（像 `DAILY_WARMUP` 那样），原因是导出发生在镜像内载入源码之前，主机不执行
源码，也就读不到类属性；为此加静态解析或预探针都是新机制。

`--trade-ticks` 只能与 `--execution quotes` 同用，否则拒绝 `TRADE_TICKS_NEED_QUOTES`：
- bars 环境里订单按下一根一分钟 bar 撮合；
- 策略在一分钟中间因成交下单，会按整根 bar（含它看到成交之前的价格）成交，这是前视。

## 导出

`market/export.py`：
- `trade_rows` 用服务端游标流读
  `agg_trade AS OF '<commit>' WHERE symbol=%s AND transact_time>=%s AND transact_time<%s
  ORDER BY transact_time, agg_trade_id`。
  - 提交早于 `agg_trade` 表时不导出成交，运行器按月拒绝。
- `write_trades` 写 `catalog.write_trade_ticks`（目录 `data/trades/`），每行一个 TradeTick：
  - `price`、`size`：×1e8 整数按合约当期价格/数量精度精确还原，有余数即 `TRADE_INEXACT`，
    不舍入；
  - `aggressor_side`：`is_buyer_maker` 为真是 SELL，否则 BUY；
  - `trade_id`：`agg_trade_id` 的十进制文本；
  - `ts_event = ts_init = transact_time × 1e6`。

  切块只在毫秒变化处切，一个毫秒不跨文件；一个文件也不跨 UTC 月，运行器按文件统计判断月份。
- 回执 `pieces[].counts` 只在请求成交时出现 `trade` 键。
  - 原因：重放旧运行时，会用新导出器重新导出并对比输入身份；不带成交的导出必须与今天逐字节
    相同。
  - 缓存键同理，只在请求成交时追加 `-t1`。
- 导出任务、`Market.export_catalogs`、远端供数的参数白名单和请求都加 `include_trades`（布尔）。
  - 远端两端版本一致由导出器指纹保证，不加兼容分支：合并后 market-supply 要随镜像一起更新。

## 事件流与顺序

- `STREAM_TYPES` 改为 MARK、QuoteTick、TradeTick、资金费、Bar、状态、收盘，
  `DATA_DIRECTORIES["TradeTick"] = "trades"`。
- 同一 `ts_init` 的事件：
  - 同一合约内按上面的类型顺序；
  - 同一毫秒的成交按 `agg_trade_id` 排序（即文件内顺序）；
  - 不同合约之间按合约顺序。
- 报价排在同毫秒成交之前：
  - 策略因 T 时刻的成交下的市价单，按 T 毫秒结束时的报价成交，而不是 T 之前的旧报价；
  - 推导报价本由同毫秒的成交产生，旧报价会让策略在成交冲击之前的价位成交，偏乐观。
  - 粒度限制：同一毫秒内的「成交、报价、成交、报价」交错会变成「全部报价、全部成交」。
    报告的局限写明这一点。
- 成交排在 Bar 之前，这不是前视：在 T 收盘的 bar 只含 T 之前的成交，T 时刻的成交与 bar 同时
  可知。
- 回执没有 `trade` 时不读成交文件，现有顺序不变（其余类型的相对次序没有动）。
- 文件首末时间改从 Parquet 行组统计读（`min_raw`/`max_raw`），不再读整列 `ts_init`：成交文件
  大，整列读会让每个文件都被读两遍。

## 计数、覆盖与身份

- **事件计数**：`engine.load` 把回执的 `trade` 计数带进合约行。`DATA_COUNT_MISMATCH` 照旧覆盖
  全部流入的事件，包括成交。
- **覆盖**：回执有成交时，交易窗口内任何一个没有导出成交的 UTC 月拒绝 `TRADES_MISSING`，与
  `QUOTES_MISSING` 同一判断（`quote_months_missing` 泛化为 `months_missing`，按类型）。
  - 导入按合约月整月进行，含 Binance 自身序列缺口而跳过的月份。
  - 新拒绝只作用于新选项，不改任何现有检查。
- **市场覆盖**：`market coverage` 每个合约增加 `trades`，镜像 `quotes`：
  - 每个导入月的 month、through、codec、commit、rows（导入回执逐日 `trades` 之和）；
  - 区间内首末成交时间；
  - 没有导入覆盖的区间。
- **输入身份**：
  - 成交文件和带 `trade` 的回执自然进入 `export_content_sha256`，从而进入输入键；
  - 有效配置不变，所以 `config_key` 跨镜像相等，重建（`_runtime_transition`）不受影响；
  - 重放从已存导出回执推出是否带成交（任一 piece 的 `counts` 有 `trade`），不需要另存选项。

## 存储

不加列、不加表、不加配置键。唯一新内容是输入覆盖回执的 `counts.trade`。

独立子代理评审的结论：
- `counts.trade`：接受。消费方是运行器的事件计数审计与重放的导出开关；它是导出读数，无法由
  别处推导；不请求成交时不出现，旧回执字节不变。
- 有效配置的 `trade_ticks`：不加。回执的 `counts.trade` 已经表达「这次带了成交」，再存一次就是
  重复事实；而且新键会让新旧镜像的 `config_key` 不同，重建被拒绝。
- `account.trade_execution`：不加。改用自定义数据后场所看不到成交，开关没有作用。

## 代价

- BTCUSDT 2025-10 整月 55,717,206 笔。Codex 实测 Nautilus Catalog 约 0.99 GB，纯读入 13 秒。
- 回放按日窗口在内存里放一天的成交对象，多合约时是各合约之和：BTC 单日最多约 430 万笔。
- 导出要从 Dolt 读整月，fresh 导出每次重读。
- 验收时实测整月的导出耗时、Catalog 大小、回放耗时与 RSS，再决定多合约、长窗口是否需要分段
  或更小的流窗口。今天先不预设。

## 验收

1. 单元测试：
   - 导出：价格、数量、方向、ID、时间精确，计数键只在请求时出现，`TRADE_INEXACT`；
   - 主机解析：`--trade-ticks` 去掉后才交给运行器，非 quotes 环境拒绝；
   - 重放：从回执推出导出开关；
   - 远端：独立请求与布尔检查；
   - 运行器：报价先于同毫秒成交，成交不撮合、不动簿，计数一致；
   - `TRADES_MISSING`，文件不跨月；
   - coverage 的 `trades`。
2. 配对原生回放：隔离工程账本，BTCUSDT 2025-10，引用镜像 main 对候选镜像 pr-N。
   - 同一不用成交的控制策略，bars 与 quotes 两个环境，`engine.compare_reports` 语义一致；
   - 输入身份与有效配置一致。
3. 成交接入：候选镜像，同一控制策略加成交订阅与成交计数、VWAP 诊断，带 `--trade-ticks`。
   - 订单、成交、持仓、费用、资金费、账户行与不带成交的运行语义一致；
   - 策略收到 55,717,206 笔，等于回执和导入读数；
   - 首末成交与源一致；
   - 记录耗时、RSS、导出大小。

## 依赖与另行处理

- #1920 把 `DATA_CALLBACKS` 改为 rc7 的回调名（`on_quote`/`on_trade` 等，含 `on_data`）。输入起点
  晚于回放起点的实例（每日热身）因此不会收到起点之前的报价或成交。本设计依赖它。
- 两个新拒绝 `TRADES_MISSING`、`TRADE_TICKS_NEED_QUOTES` 已获用户授权（2026-10-31），随 #1921 合并。
- 后续（用户 2026-10-31 授权）：订阅了本次运行不提供的成交，即拒绝 `TRADES_NOT_SERVED`。
  - 「不提供」包括三种：没带 `--trade-ticks`；原生 `subscribe_trades`，回放从不送原生成交；
    paper 交易。
  - 运行器包装类记下这类订阅，回放在订阅所在的块跑完后停下并拒绝，paper 由记录器停下运行。
  - paper 只有 K 线执行环境（`paper-bars`）。策略因成交在一分钟中间下的单，会按整根 K 线撮合，
    与回放 K 线环境拒绝成交的理由相同。
  - Sandbox 也没有强平和保证金模型配置。所以 paper 先拒绝，送实时 `@aggTrade` 要等 paper 有报价
    执行环境（`bookTicker`）。
  - 已核实的 rc7 事实：
    - Sandbox 订阅 `data.trades.BINANCE.*`，`trade_execution=False` 时整笔丢弃；
    - Binance 的 `subscribe_trades` 走 `@aggTrade`，方向与编号的口径同导出；
    - 不带客户端的 `subscribe_data` 只订阅消息总线话题。
