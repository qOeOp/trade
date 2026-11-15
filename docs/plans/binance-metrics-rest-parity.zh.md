# 持仓量与多空比：回放规则 v2 与 Paper/Live 的 REST 读取

2026-11-15。接 [`binance-open-interest-input.zh.md`](binance-open-interest-input.zh.md)。那份记录把币安
`metrics` 日归档导入市场目录，回放按规则 `binance-metrics-visible-v1` 送给策略；Paper 和 Live 不送，订阅即
`METRICS_NOT_SERVED`。按用户规则，回放有而 Paper/Live 没有的能力算缺陷，所以要找 Paper/Live 能用的公开来源，
并且让三种模式拿到同样的值。

## 结论与用户的决定

币安公开 REST（`fapi.binance.com/futures/data/*`，`period=5m`，保留 30 天，不需要凭证）的时间戳等于归档
`create_time + 5 分钟`，就是 v1 的 `ts_event`。持仓量逐位相同，三个多空比和归档不同：

- REST 只给 4 位小数，归档给 8 位（头部持仓比实际只有 6 位）；
- 两个账户多空比在 REST 上是"多空占比各自四舍五入到 4 位，再相除"的结果，和归档的比值最多差约 0.03%。

所以 v1 的数值在 Paper/Live 里没法逐位复现。2026-11-14 给出三个方案：

1. 回放规则 v2：回放改送 REST 显示的值；
2. Paper/Live 只送持仓量；
3. 直接送 REST 原值，并写明差距。

用户选了 1（"我选1"，2026-11-15 经上级会话转达）。

## 实测（2026-11-15，本机，无凭证）

- 范围：BTCUSDT、ETHUSDT、SOLUSDT、DOGEUSDT，归档日 2026-10-18 到 2026-11-13，每个合约 27 天；
- 来源：`data.binance.vision` 日归档（逐个核对 `.CHECKSUM`），和同期四个 REST 端点（`openInterestHist`、
  `topLongShortAccountRatio`、`topLongShortPositionRatio`、`globalLongShortAccountRatio`）；
- 对比方式：归档行按 `create_time + 5 分钟` 对上 REST 行。共 31,104 行，四个合约结果一致。

| 列 | 规则（`market.export.shown_ratio`） | 与 REST 相同 | 不同的行 |
|---|---|---|---|
| `sum_open_interest` | 原值 | 31,104 / 31,104 | — |
| `sum_toptrader_long_short_ratio`（头部持仓比） | 四舍五入（half-up）到 4 位 | 30,963 / 31,104 | 141 行，全部是归档值正好落在第 4 位中点（如 `1.79005000`），差 0.0001 |
| `count_toptrader_long_short_ratio`（头部账户比） | 多 = r/(1+r)，空 = 1/(1+r)，各自 half-up 到 4 位，比值再 half-up 到 4 位 | 31,102 / 31,104 | 2 行，差至多 0.0004 |
| `count_long_short_ratio`（全市场账户比） | 同上 | 31,102 / 31,104 | 2 行，差至多 0.0004 |

推出这条规则时比较过几种做法：

- 舍入方式：half-up、half-even、half-down 都试过。头部持仓比的中点行，REST 有时进位有时舍去，没有一种
  舍入能全对。归档只有 6 位，看不到中点之后的真实值，所以这 141 行无法从归档推出来。
- 账户比的算法：
  - 只把归档比值舍入到 4 位，只对约 7.6%；
  - 多空占比先舍入到 5 位或 6 位再舍入到 4 位，结果更差；
  - 空方占比用 1/(1+r) 单独舍入，和用"1 减多方占比"在这批数据上结果相同。选单独舍入，因为 REST 的多空
    占比之和可以是 1.0001。那条未对上的行就是这种情况：多 0.7120、空 0.2881，真值落在中点，归档 8 位的
    比值已经丢了这个信息。
- 两边的行数：
  - 每个合约有 3 行只在 REST 里有，是归档缺的行。Paper/Live 会送，回放没有；
  - 没有只在归档里有的行。

2026-11-14 用 BTCUSDT 一天（287 行）做过同样的比较，结论相同，见共享笔记
`metrics-live-parity-2026-11-14.md`（会话间笔记，不在仓库）。

## 规则 v2

导出时（`market/export.py`）：

- 时间戳和 v1 相同：`ts_event = create_time + 5 分钟`，`ts_init = create_time + 10 分钟`；
- 持仓量照存；
- 三个多空比按上表的规则改写。归档为空的比值仍然为空；
- 回执和文件元数据的规则名改为 `binance-metrics-visible-v2`。

市场目录里存的还是归档原值，规则只在导出时生效，导出结果是工作副本。导出器的代码一变，导出缓存键和内容哈希
也跟着变，所以 v1 的导出不会被拿来复用。

每个读 metrics 的回放都会拿到和 v1 不同的输入，之前的 metrics 研究不能和新跑的结果比较。`CHANGELOG.md` 按
破坏性变更写明了这一点。

## Paper 和 Live（`engine/metrics.py`）

- 策略的订阅方式不变：`subscribe_data(DataType("Metrics", metadata={"instrument_id": ...}))`。
- `engine.strategy.Subscriptions` 先检查合约。本次运行之外的合约仍然是 `METRICS_NOT_SERVED`；本次运行的合约
  交给 `engine.metrics.Feed`，不经过 Nautilus 的数据客户端。
- 送哪些行：第一行是回放也会送的那一行，即 `ts_event` 不早于实例的输入起点、`ts_init` 晚于订阅时刻的第一行。
- 读取方式：
  - 到了一行的 `ts_init`，在节点线程之外读 REST 中这一行 `ts_event` 的四个端点；
  - 读全后在节点线程里交给 `on_data`，送的是 `CustomData(metrics_data_type(id), Metrics(...))`；
  - 时间戳、数值与回放相同：数值量化到 16 位小数，和回放从 `decimal128(38,16)` 读出来的一样。
- 读不全时：
  - 每 30 秒只重读缺的端点；
  - 到下一行该送之前还缺的比值为 `None`，和归档留空的比值一样；
  - 到那时还没有持仓量，这一行就跳过，节点日志记一条警告。
  - 依据：REST 在时间戳后 23–183 秒发布（2026-10-31、2026-11-14 实测），规则留了 5 分钟。
- 限频：这些端点每个 IP 每 5 分钟最多 1000 次请求。按时发布时，每个合约每行要 4 次请求；最坏情况每行要 4 次
  乘 9 轮。
- Paper：
  - 送达和其他数据回调一样，要等下一次数据派发时才执行，与回放的顺序一致；
  - 订阅 metrics 的源不能断点恢复（`engine.paper_session`：订阅不固定）。
- Live：送达经过 `_gated`，停止意图生效后就不再送。

## 存储字段

这次没有新增存储字段，所以不需要单独审阅：

- 市场表不变，账本不变；
- Paper 日志和 Live 证据包没有新增行类型，送达的行不入库；
- 回执里原有的 `metrics_rule` 只是值从 v1 改成 v2。

因为没有入库，Live 的对比（`live/compare.py`）查不到 Live 收到的 metrics。要查的话，得在 Live 证据包里加一类
行，那是一个存储字段，需要先审阅、再经用户授权。

也因为没有入库，Paper 和 Live 的比较回放（`replay.comparison.replay`）不知道源读没读 metrics：回放因
`METRICS_NOT_SERVED` 被拒时，再带 `--metrics` 重放一次，比较用第二次的结果。

## 仍然不同的地方

- 头部持仓比在第 4 位中点的行约占 1/90，其中约一半和 REST 差 0.0001；
- 账户比约 1/15,000 的行差至多 0.0004；
- 归档缺而 REST 有的行，只有 Paper/Live 收到；
- REST 发布晚于 `ts_init` 时，Paper/Live 会晚送；晚到下一行该送时，按上面"读不全时"处理。

## 验证

- 单元测试：`tests/market/test_metrics.py`、`tests/engine/test_metrics_feed.py`、`tests/engine/test_stream.py`；
- 配对原生回放：结果见 PR；
- Paper 实跑：结果见 PR。
