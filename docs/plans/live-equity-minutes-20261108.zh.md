# Live 每分钟运行结果（2026-11-08）

## 问题

Runs 页的 Live 阶段没有 Equity / Coins 切换，选中一个 Live 运行后直接显示 K 线。原因是缺数据：Live 引擎
（`engine/live.py`）只在连接、入场和结束时各写一份账户观测（`*-account-*.json`），没有随时间变化的序列，
画不出曲线。Paper 有，因为 `engine/paper.py` 的 `Recorder._snapshot` 每分钟往 journal 写一行 `snapshot`。

用户 2026-11-08 决定连引擎一起做（"连引擎一起做"）。

## 新增的记录

Live 的私有 journal `out/events.jsonl` 追加 `minute_result` 行：

| 字段 | 含义 |
| --- | --- |
| `minute_ns` | 这一分钟的起点（标记价格的 `ts_event` 所在分钟；停止时那一行是停止所在分钟） |
| `result` | 本运行的已实现结果加未平仓位按该标记价格算的浮动结果，即 `check_loss` 判断亏损上限的同一个数（`run_result`）；持仓时没有价格、或读取出错时为 null |

- **写入时机**：`Observer.on_mark_price`（只在 `run` 模式订阅标记价格）收到每分钟第一个标记价格时写一行；
  `Observer.on_stop` 再写停止所在分钟一行（用 60 秒内的标记价格），所以曲线结束在运行结束的地方。
- **写入方式**：`Session.event(..., strict=False)`，与 `socket_state`、`max_loss` 等行走同一条追加 + fsync
  路径。计算出错时照样写一行，值为 null；不影响停止、保护和亏损检查，也不改 `failed`。
- **体量**：运行最长 86400 秒，最多约 1442 行，每行约 150 字节，远低于视图读取的 16 MB 上限。

## 消费者

- `live/views.py` 的 `run_view` 新增 `minute_results`：`[[minute_ns, result], ...]`，只是投影，损坏的行跳过。
- IDE 的 Live 画布加上与 Paper 相同的 Equity / Coins 切换。Equity 把预算加结果画成一条线（Paper 的
  `EquityChart`），切换标签上显示最新的账户值和相对预算的收益；Coins 是这次运行的单一合约（manifest 规定只有一个）。

## 评审（独立 sub-agent，2026-11-08）

结论：改后接受。据此做的修改：

- 最初的方案记录 Nautilus 的 `balance_total` 加浮动盈亏。rc7 的 Binance 适配器是编译的 Rust，无法确认
  `total` 取的是钱包余额还是保证金余额；若是后者，浮动盈亏会算两次。另外它是整个 USDT 钱包，准入只要求钱包
  不少于预算，算出的收益不能和 Paper 比。改为记录本运行自己的结果，收益以 manifest 的 `budget_usdt` 为基数。
  代价：不含以其他资产支付的资金费和手续费（`check_loss` 的注释已说明）。
- 去掉没有消费者的 `balance_free` 和 `mark`。
- 补写停止所在的那一分钟，否则停止前最多 59 秒（包括平仓）不在曲线上。

## 为什么现有字段表达不了

- 三份账户观测只有三个时间点。
- 原生 position 事件只在成交时带已实现结果，Live 不存标记价格，算不出浮动结果。
- `check_loss` 每秒都在算这个数，但不落盘。

## 边界

- 这是执行记录，留在远程主机的 Live 私有根目录，不进 ledger、DoltHub 或 Git（AGENTS.md）。
- 不改下单、保护、亏损上限和停止路径；`check_loss` 的求和抽成 `run_result` 共用，行为不变（原有测试通过）。
- `engine/` 的改动要通过新的镜像 digest 才会进入 Live 运行；旧镜像的运行没有这些行，Equity 显示
  "This run recorded no minute results: its runtime predates them"，默认打开 Coins。
