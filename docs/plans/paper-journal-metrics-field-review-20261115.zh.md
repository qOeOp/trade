# Paper 日志的 metrics 行和 metrics 退订行：存储字段审阅

2026-11-15。补 `live-evidence-funding-metrics-field-review-20261115.zh.md` "仍然留下的"中的一条：Paper 日志不记录 metrics，`paper compare` 查不到 Paper 收到的 metrics。

用户在 2026-11-15 授权加这个存储字段，并要求 Paper 和 Live 用同样的方式比较，包括 #3077 给 Live 的退订处理。按 AGENTS.md 的要求，加字段前先由一个独立子代理审阅。审阅只读代码，基于 `origin/main` 8e4a375fb。

## 结论

需要，并按审阅的三点修改实施。Paper 日志 `events.jsonl` 新增两种行，字段照搬 Live 证据包里的同名行：

| 行 | 字段 | 写入点 |
|---|---|---|
| `metrics` | `wall_ns`、`kind`、`instrument_id`、`ts_event`、`sum_open_interest` 和三个多空比（十进制文本或 null） | `engine/paper.py` `paper_callbacks` 的 `on_data`：Feed 交出一行时立即写，在 `_hold` 之前；源没有定义 `on_data` 也照写 |
| `metrics_unsubscribed` | `wall_ns`、`kind`、`instrument_id` | `_PaperConfigured._metrics_unfollow`：只在源确实跟随着该合约的 metrics 时写 |

不存 `ts_init`，因为它恒等于 `ts_event + 5 分钟`（`engine/metrics.py` 的 `due`）。

两种行都只在 Paper 的执行记录里：运行目录的 `events.jsonl`，封存后进远端主机的私有 Paper 数据库。它们不进研究账本、DoltHub 或 Git。

## 审阅

### 谁读它

`paper/compare.py` 的 `run_record` 把这两种行作为 `run["metrics"]` 交给共用的 `replay.comparison.replay_and_compare`，与 `live/compare.py` 相同。各字段的用处：

- `kind`：区分两种行；
- `wall_ns`：
  - 迟到检查（`LATE_NS`）；
  - `_followed` 按退订切分跟随区间；
  - 封存时日志按它分日；
- `instrument_id`：按合约分组；
- `ts_event`：
  - 送达时刻的键（`ts_event + METRICS_VISIBLE_NS`）；
  - `archive_metrics` 读档案的起点；
- 四个数值：比较数值，包括 #3087 的中点容差。

没有不被读的字段。

### 独立事实

这两种行记录的是 Feed 实际交给源的东西和源退订的时刻。下面这些都只有它能给出：

- 截止时还缺、因而为 None 的比值；
- 没有持仓量而被跳过的行（现在只有节点日志的一条警告）；
- 取决于订阅时刻的第一行；
- 退订时刻；
- 送达的迟早。

已有的日志行都不涉及 metrics。其他做法都不行：

- 比较时重读 REST：只保留 30 天，给的是最终值，不是截止时收到的值；
- 只存摘要：定位不到行；
- 不存：由 metrics 引起的分岔只能标为 `unexplained`，回放独有的组还会被误标成 `look_ahead_suspect`。

### 写在哪一刻

在 Feed 交出时写，不在被扣住的回调运行时写：

- 这样 Paper 的 `wall_ns` 量的和 Live（`_gated`）、和 Paper 自己的 K 线（Recorder 到达即写，不等释放）是同一件事。
- 扣住到下一次数据派发，是 Paper 对所有数据的顺序设计，不是输入迟到。
- 先写还保证了顺序：`release_before` 可能运行一个会退订的回调。若在 `_hold` 之后才写，退订行可能排在它之前收到的那一行前面。

### 退订行放在同一个文件

Paper 只有 `events.jsonl` 一个日志，不存在只丢退订行的问题：`Journal` 第一次写失败就锁存并停止运行，之后什么都不写（#3084）。失败之后的行会显示为缺失，和 K 线一样；停止原因会说明为什么。

### `compare_metrics` 依赖的条件

退订之后不再有行送达。Paper 也成立：

- Feed 是共用的，`_metrics_tick` 每送一行前都确认该合约仍被跟随；
- 退订前已写日志、退订后才从扣住队列里运行的行，落在跟随区间之内，读法正确。

### 交互

- **断点恢复**：无影响。`_metrics_follow` 置 `_paper_subscription_changes`，订阅 metrics 的源不能断点恢复，不会发布带日志字节数的检查点。
- **封存**：未知的行类型只被计数，审计和读数都不变。
- **IDE**：`paper/serve.py` 的 `_wanted` 会把非 K 线行推给页面。页面把它们存进 `piece.lines`，`categoryOf` 返回 null，所以不显示。量约为每个合约每天 288 行，每分钟一行的快照是每天 1440 行。保持推送：若要过滤，`resumed()` 也得同样排除，否则续传会错位。
- **停止**：Paper 停止时不拦数据，行照常送达，和 K 线一样。比较窗口截在 `stopped_ns` 所在的分钟，停止后才该到的行不在窗口内。

## 审阅附带、本次不处理的两点（都未用原生方式探查）

- `LATE_NS` 是 2 秒。交出时刻可能晚于送达时刻：最多 1 秒的 `TICK`，加上经代理顺序读四个端点，再加最多一拍。Live 也一样。第一次 Paper 实跑后，应先量一下交出延迟再信 `late_metrics`。`metrics` 在原因顺序里排在 `warmup` 和 `contract_terms` 之前，迟到的行可能盖住这两类原因。
- `release_before` 可能从 metrics 定时器回调里运行。那是时间事件，不是数据派发。如果 rc7 的有偏选择先处理时间事件、后处理执行事件，在这里释放的 `on_bar` 可能在它那根 5 分钟 K 线的成交还没应用时就运行（`release_late`）。这需要原生探查。
