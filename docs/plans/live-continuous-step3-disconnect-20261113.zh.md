# Live 连续运行第 3 步：断线不结束运行（2026-11-13）

依据：`live-continuous-operation-design-20261110.zh.md` §3.2（用户 2026-11-10 授权：断线不结束运行、断线期间放行只减仓的单和撤单，即放宽 `LIVE_CONNECTION_UNVERIFIED`）。实现在 `engine/live_connection.py`。

## 做了什么

- 运行开始（连接后的账户核对）通过之后，任一 Binance socket 断开只关闭入场：撤掉在途入场单（REST），已有止损止盈留在交易所；源码和 Observer 的减仓、撤单、平仓照常放行。开始核对通过之前断线，仍结束运行（那时什么都还没放行）。
- 所有 socket 重新连上后，入场保持关闭，直到两次比对都一致、两次的读取时刻相隔至少 30 秒（覆盖一个持仓对账周期和一个挂单对账周期）。比对内容：本策略每个方向的持仓数量、按交易所单号对应的挂单（含条件单，条件单触发后按 `actualOrderId` 也算对上）、账户模式、没有别的合约的持仓或挂单、重连后收到过实时 K 线且外部 K 线没有缺根。不一致就重新开始核对。读得太慢或返回不完整只算这一次没读到，不算账户变了。
- 交易所上有本地不认识的单：立刻用原生 cancel-all（不限策略，HTTP 同时撤普通单和条件单）撤掉该合约全部挂单，入场在本次运行内保持关闭。外部 K 线缺根、账户模式变了、出现别的合约的持仓或挂单，同样本次运行内保持关闭。缺根不补数据，持仓照常由源码管理；重新预热要等第 4 步的重启。
- 入场开着时每 5 分钟比对一次；连续两次不一致才关闭入场（一次不一致常是单子在途）。
- 空仓、没有挂单、连接已超过 23 小时：在某分钟的第 20 到 40 秒调用原生 `reconnect_socket` 换连接，把币安 24 小时断连挪到空仓时段，避开 K 线边界。之后走同样的断线、核对流程。
- 有持仓时，断线导致 60 秒收不到标记价格，仍按现有规则停止运行（沿用设计 §3.2.4）。
- 通知（Telegram）：某个 socket 断开超过 1 分钟；核对 10 分钟仍没通过；入场因上面那些原因在本次运行内关闭；在这些通知之后入场重新打开。短暂重连（关了又在核对后打开）不通知。

## 和设计不同、需要知道的一处

入场关闭期间源码提交入场单：设计 §3.2 没说怎么处理。原想用 Nautilus 原生 `deny_order` 拒单、运行继续，但锁定的 rc7 里 Python `Strategy` 没有这个方法（只有 `ExecutionAlgorithm` 有）。所以沿用现有规则：这张单以 `LIVE_CONNECTION_UNVERIFIED` 被拒，运行结束（与"入场被拒仍结束运行"一致）；断线时正在等账户核对的入场单也一样。代价：重连核对窗口（约 30–45 秒）里源码恰好出入场信号，运行仍会结束。另一种做法是让入场单排队到核对通过再走账户核对、最多等若干秒，这会推迟下单时刻，属于放宽，需要用户决定。（2026-11-13 已由圆桌决定为有界暂存，见 `live-entry-hold-20261113.zh.md`。）

## 验证

- 单元测试（`tests/engine/test_live_gate.py`、`test_live_connection.py`、`test_live.py`、`tests/live/test_notify.py`、`test_views.py`）。`test_live_connection` 用 Nautilus 回测引擎跑真实的原生订单：断线后入场单被撤、止损留着，两次相隔 31 秒一致的比对后入场重开，出现未知挂单时原生 cancel-all 把止损也撤掉。
- 原生探针（公开行情，不用凭证）：见下节。
- 没有验证：真实账户的用户流断线与重连（listenKey 换新、补发挂单状态）；断线前刚发出、断线中成交、重连后超时拒绝的单在比对里的样子。这些要真实账户受控断线试验。

## 原生探针结果

2026-11-12 15:16–15:20 UTC，锁定的 rc7，`LiveNode` 只配 Binance USD-M 数据客户端（公开行情，无凭证），订阅 BTCUSDT 1 分钟外部 K 线和标记价格：

- socket 事件的 `client_id` 是 `BINANCE`，数据客户端有两个端点：`binance-futures-market-streams`、`binance-futures-public-streams`。
- 15:18:20（分钟第 20 秒）对两个端点调用 `Strategy.reconnect_socket(ClientId("BINANCE"), endpoint)`：同一秒内先 `DISCONNECTED` 再 `CONNECTED`。
- K 线没有缺：15:16:59、15:18:00、15:18:59 三根的 `ts_event` 各差 60 秒，换连接后的下一根按时到达。
- 没有测到：执行客户端用户流的端点名，以及 `reconnect_socket` 对用户流是否生效（同一个 `ClientId`，要真实账户）。

## 真实账户受控断线试验（用户执行，需单独授权）

前提：本 PR 合并、CI 发出新运行镜像、用户发版本并部署；账户空仓；Telegram 已设置。

1. 在 Live 页面用小预算启动一个运行（源码最好在空仓时很少入场）。
2. 短断：在某分钟第 5 秒左右让 runner 的出口断网约 30 秒（例如 `docker pause <egress>`，30 秒后 `docker unpause`），不跨分钟边界。
   期望：`events.jsonl` 依次出现 `entries_closed`（disconnected）、`entries_checking`、两条 `comparison`（agreed=true，相隔 ≥30 秒）、`entries_opened`；运行没有结束，没有 `unresolved`，不发 Telegram。
3. 长断：断网约 2 分钟。期望：多出 `connection_lost` 和 Telegram"断开超过 1 分钟"；因为跨过分钟边界，还会有 `entries_closed`（bars_missing），入场在本次运行内保持关闭，Telegram 说明原因——这是预期行为，停止运行即可。
4. 有持仓时重复一次：止损单在交易所保持不动；断网超过 60 秒没有标记价格时运行按现有规则停止并平仓。
