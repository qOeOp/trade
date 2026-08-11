# Betfair

Betfair 是面向体育及其他事件的投注交易所。该适配器集成 Betfair Betting、Accounts 和 Exchange Streaming API，用于金融工具发现、实盘市场数据、账户状态、订单管理和执行更新。

## 安装

按照[安装指南](../getting_started/installation.md)安装 VibeTrader。Python 包已包含 Betfair 适配器，无需安装适配器专用的额外依赖。

## 示例

- [Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/betfair/)
- [Rust 示例](https://github.com/qOeOp/trade/tree/main/crates/adapters/betfair/examples/)

## Betfair 文档

- [Betfair 开发者计划](https://developer.betfair.com/)
- [Exchange API 指南](https://developer.betfair.com/exchange-api/)
- [应用密钥](https://betfair-developer-docs.atlassian.net/wiki/spaces/1smk3cen4v3lu3yomq5qye0ni/pages/2687105/Application+Keys)
- [交互式登录](https://betfair-developer-docs.atlassian.net/wiki/spaces/1smk3cen4v3lu3yomq5qye0ni/pages/2687772/Interactive+Login+-+API+Endpoint)

## 凭证

创建 Betfair 应用密钥，然后通过配置或环境变量提供账户凭证：

```bash
export BETFAIR_USERNAME=<your_username>
export BETFAIR_PASSWORD=<your_password>
export BETFAIR_APP_KEY=<your_app_key>
```

适配器使用 Betfair 的交互式登录端点，不使用客户端证书。

## 时间戳策略

适配器将交易场所事件时间与本地初始化时间分开保存：

- `ts_event` 记录 Betfair 声明的事件发生时间。
- `ts_init` 记录实盘适配器收到包含该事件的流消息的时间。

每个实盘流回调都会在解码消息前读取一次实时时钟原子值。从该消息解码出的所有输出共享同一个 `ts_init`。

| 输入              | `ts_event` 来源                                                                                                                                                           | `ts_init` 来源                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 市场变更（`mcm`） | 消息发布时间（`pt`）。                                                                                                                                                    | 本地接收时间。                                       |
| 赛事变更（`rcm`） | 参赛项或赛事馈送时间（`ft`）；缺少 `ft` 时回退到消息发布时间（`pt`）。                                                                                                    | 本地接收时间。                                       |
| 板球变更（`ccm`） | 消息发布时间（`pt`）。                                                                                                                                                    | 本地接收时间。                                       |
| 订单变更（`ocm`） | 相应的订单生命周期时间。接受使用 `pd`；成交使用 `md`，缺失时回退到 `pt`；状态和取消事件使用 `md`、`cd` 或 `ld` 中的最新值，缺失时回退到 `pt`。OCM 级自定义数据使用 `pt`。 | 本地接收时间。                                       |
| 历史数据加载器    | 与实盘数据相同的馈送时间规则。                                                                                                                                            | 消息发布时间（`pt`），因为记录数据没有本地接收时间。 |

当 OCM 在重连后对账期间到达时，适配器会将消息及其捕获的 `ts_init` 一并缓冲。排空缓冲区时会保留原始接收时间，而不是使用之后的重放时间。

## 订单能力

### 订单类型

| 订单类型               | 支持 | 说明                                                    |
| ---------------------- | ---- | ------------------------------------------------------- |
| `MARKET`               | ✓*   | 支持 `AT_THE_CLOSE`，映射到 Betfair `MARKET_ON_CLOSE`。 |
| `LIMIT`                | ✓    | 支持普通限价订单和 BSP 收盘限价订单。                   |
| `STOP_MARKET`          | -    | 不支持。                                                |
| `STOP_LIMIT`           | -    | 不支持。                                                |
| `MARKET_IF_TOUCHED`    | -    | 不支持。                                                |
| `LIMIT_IF_TOUCHED`     | -    | 不支持。                                                |
| `TRAILING_STOP_MARKET` | -    | 不支持。                                                |

### 有效期

| 有效期         | 支持 | 说明                                                     |
| -------------- | ---- | -------------------------------------------------------- |
| `GTC`          | ✓    | 映射到 Betfair `PERSIST`。                               |
| `DAY`          | ✓    | 映射到 Betfair `LAPSE`。                                 |
| `FOK`          | ✓    | 映射到 Betfair `FILL_OR_KILL`。                          |
| `IOC`          | ✓    | 映射到 `FILL_OR_KILL`，并设置 `min_fill_size=0`。        |
| `AT_THE_CLOSE` | ✓    | 用于 Betfair BSP `LIMIT_ON_CLOSE` 和 `MARKET_ON_CLOSE`。 |

### 批量操作

| 操作     | 支持 | 说明                            |
| -------- | ---- | ------------------------------- |
| 批量提交 | ✓    | 通过 `SubmitOrderList` 实现。   |
| 批量修改 | -    | 不支持。                        |
| 批量取消 | ✓    | 通过 `BatchCancelOrders` 实现。 |

## 执行控制流程

启动流程：

1. 连接 HTTP 客户端并获取初始账户资金。
2. 使用缓存订单初始化 OCM 状态。
3. 连接 Betfair 执行流并订阅订单更新。
4. 根据 `listCurrentOrders` 生成启动时批量状态。
5. 将订单和成交报告对账到执行引擎中。

每次流重连时，适配器都会在近期时间窗口上执行相同的批量状态对账，并在分派完成前暂停新的增加风险敞口命令。请参阅[重连后对账](#重连后对账)。

对账行为：

- `stream_market_ids_filter` 筛选实盘 OCM 更新。
- `reconcile_market_ids_only=True` 使用显式的 `reconcile_market_ids`。
- 当 `reconcile_market_ids_only=False` 且未设置 `reconcile_market_ids` 时，适配器会回退到 `stream_market_ids_filter` 进行启动时对账。
- `ignore_external_orders=True` 跳过没有 `rfo` 的 OCM 更新。

## 会话管理和重连

适配器通过三种机制处理会话续期和恢复：

| 机制            | 触发条件                        | 操作                                                                   |
| --------------- | ------------------------------- | ---------------------------------------------------------------------- |
| 定期 keep‑alive | 每 10 小时。                    | 续期会话令牌，并推送到所有流 watch 通道。                              |
| keep‑alive 回退 | keep‑alive 返回 `LoginFailed`。 | 通过 `reconnect()` 完整重新登录，并向数据流推送新令牌。                |
| 流重连          | 断开后收到 `Connection` 消息。  | 尝试 keep‑alive；遇到 `LoginFailed` 时回退到重新登录，并更新身份验证。 |

keep-alive 期间的暂时性错误（网络超时、5xx 响应）会被记录并跳过。现有会话令牌会保留，并在下一个 keep-alive 间隔重试。只有 `LoginFailed` 错误（会话过期）才会触发完整重新登录。

数据客户端和执行客户端运行相同的重连逻辑。每个客户端都会生成：

- 一个 **keep-alive 任务**，定期刷新会话，并向流 watch 通道推送更新后的身份验证字节。
- 一个**重连处理程序**，在流重连后监听 `Connection` 消息、刷新会话并推送新令牌。

流客户端将身份验证字节存储在 `tokio::sync::watch` 通道中。`post_reconnection` 闭包会在每次 TCP 重连时从该通道读取，因此，无论令牌是由 keep-alive 任务还是重连处理程序刷新，下一次连接尝试都能取得更新值。

当赛事数据流处于活动状态时，数据客户端的重连处理程序还会更新赛事流身份验证。

## 重连后对账

Betfair 执行流重连后，适配器假定缓存可能在连接中断期间偏离交易场所状态（尤其是成交可能在重连后的流映像到达前完成，并从未撮合订单簿中移除）。因此，在允许策略增加新风险敞口前，适配器会在近期时间窗口上执行批量状态对账。

| 步骤 | 触发条件                             | 操作                                                                                          |
| ---- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| 1    | 流中断后的第二条 `Connection` 消息。 | OCM 处理程序设置 `pending_resync` 和 `is_reconciling`，向后台任务发送重连信号。               |
| 2    | 重连任务收到信号。                   | 再次设置 `is_reconciling`，使已排队的第二次重连在自身迭代期间也保持暂停。                     |
| 3    | 重连任务主体。                       | 刷新会话、更新流身份验证、获取 `getAccountFunds`，并调用 `listCurrentOrders` 获取订单和成交。 |
| 4    | 批量状态构建完成。                   | 作为 `ExecutionReport::MassStatus` 分派，使引擎将其对账到缓存中。                             |
| 5    | 迭代结束。                           | 清除 `is_reconciling`。失败的迭代也会将其清除，使订单处理可以恢复。                           |

设置 `is_reconciling` 期间：

- `submit_order` 和 `submit_order_list` 发出 `OrderDenied`，原因为 `STREAM_RECONCILING: post-reconnect reconciliation in progress, retry once it completes`。
- `cancel_order`、`batch_cancel_orders` 和 `modify_order` 不加修改地继续传递，使策略始终可以在此期间降低风险敞口。
- 中断期间到达并已缓冲的 OCM，会在下一条策略命令到达时通过 `process_pending_resync` 排空（使用单独的 `pending_resync` 标志）。

如果客户端在对账仍在进行时断开连接，`clear_resync_state` 会清除 `is_reconciling`，让之后的连接/提交流程从干净状态开始。

批量状态获取的回溯窗口为 `stream_gap_recovery_lookback_mins`（默认值 `10`）。其长度应充分超过预期最长重连时间，以确保连接中断期间完成的成交仍能被捕获。

## tick 规则和定价

Betfair 使用分级 tick 规则，不同价格区间采用不同增量：

| 价格区间       | tick 大小 |
| -------------- | --------- |
| 1.01 - 2.00    | 0.01      |
| 2.00 - 3.00    | 0.02      |
| 3.00 - 4.00    | 0.05      |
| 4.00 - 6.00    | 0.10      |
| 6.00 - 10.00   | 0.20      |
| 10.00 - 20.00  | 0.50      |
| 20.00 - 30.00  | 1.00      |
| 30.00 - 50.00  | 2.00      |
| 50.00 - 100.00 | 5.00      |
| 100.00 - 1000  | 10.00     |

最低价格为 1.01，最高价格为 1000.00。

## 修改订单

- 价格和数量不能以原子方式同时更改；需要分别操作。
- 修改价格使用 `ReplaceOrders`（取消订单，再以新价格创建订单）。
- 减少数量使用带 `size_reduction` 参数的 `CancelOrders`。
- 不支持增加数量；应改为提交新订单。

替换操作会同时为原订单生成取消事件，并为替换订单生成接受事件。适配器会跟踪待处理的替换，以抑制合成取消事件。

## 订单流成交处理

执行客户端处理来自 Betfair Exchange Streaming API 的订单更新。
两个配置选项控制更新的筛选方式：

- `stream_market_ids_filter`：在市场层面筛选（提前退出，静默跳过）。
- `ignore_external_orders`：在订单层面筛选（跳过没有 `rfo` 的 OCM 更新）。

### 成交处理

适配器在处理数据流中的成交时，会处理多种边界情况：

- **增量成交**：Betfair 报告累计撮合数量。适配器通过跟踪每笔订单最近一次已知的成交数量，计算增量成交。
- **超额成交保护**：拒绝会使成交数量超过订单数量的成交。
- **竞态条件**：当流式成交先于 HTTP 订单响应到达时，适配器会立即缓存交易场所订单 ID，确保订单正确匹配。
- **网络错误恢复**：如果 HTTP 订单提交因网络错误（超时、连接重置）而失败，订单仍可能已经提交到交易场所。适配器让订单保持 SUBMITTED 状态，并保留客户订单引用，使数据流在重连后可以确认订单。API 错误（Betfair 明确拒绝）则会立即拒绝订单。
- **中断窗口成交**：在流断开期间完成并从未撮合订单簿中移除的成交，会由重连后的批量状态对账恢复；请参阅[重连后对账](#重连后对账)。

### 作废成交

Betfair 可能在报告已撮合投注后将其作废，例如在诚信裁决或 VAR 判罚之后。订单流通过 `sv`（作废数量）携带累计总量。因移除参赛项造成的作废会通过结算处理，而不是通过数据流发送，因此不会进入此路径。

适配器会将每次 `sv` 增量按从新到旧的顺序分配给本地已应用的成交批次，并为每个受影响的 `trade_id` 发出一个累计 [`OrderFillVoided`](../concepts/events/order_fill_voided.md)。首次看到的快照会初始化其累计作废状态，但不会反转 Vibe 从未应用的风险敞口，因此重连不会重复更正。任何 `sv` 增量还会触发账户刷新。

如果 `EXECUTION_COMPLETE` 更新没有本地已应用的成交批次，则改走终结路径：在合成 `VOID-{bet_id}` 成交 ID 下发出一次更正，使订单进入 `VOIDED`。只有 `sv` 为正，并且已取消数量和已失效数量均为零时，才会解析为该状态；因此，如果混合更新在 `sv` 之外还包含 `sc` 或 `sl`，则不会发出更正。Betfair 成交作废从不设置 `is_reopened`，所以 `VOIDED` 是最终状态。

适配器还会发布 [`BetfairOrderVoided`](#自定义数据类型) 自定义数据类型，其中携带交易场所的原始作废详情。

## 速率限制

适配器使用独立的速率限制桶，避免账户状态轮询和对账限制下单速率：

| 桶   | 默认值 | 端点                                             |
| ---- | ------ | ------------------------------------------------ |
| 通用 | 5/s    | 账户状态、对账、keep‑alive。                     |
| 订单 | 20/s   | `placeOrders`、`replaceOrders`、`cancelOrders`。 |

订单状态和成交报告查询遇到会话错误时，会在刷新会话后重试一次。`TOO_MANY_REQUESTS` 错误会延迟 5 秒后重试。

## 市场版本价格保护

当 `use_market_version=True` 时，每个订单请求都会包含适配器最近看到的市场版本。如果 Betfair 处理订单时市场已超过该版本，Betfair 会让投注失效，而不是将其与已变化的订单簿撮合。

适配器从金融工具的 `info` 字典中读取市场版本，该字典由 Exchange Streaming API 的 `MarketDefinition` 更新填充。在收到第一条 `MarketDefinition` 前提交的订单不包含版本。

## 自定义数据类型

适配器通过市场流、订单流和赛事流发出自定义数据。订阅市场后，市场自定义数据会自动流动。

| 类型                       | 数据流 | 描述                                   |
| -------------------------- | ------ | -------------------------------------- |
| `BetfairTicker`            | 市场   | 最新成交价格、成交量、BSP 指标。       |
| `BetfairStartingPrice`     | 市场   | 市场关闭后的实际 BSP。                 |
| `BetfairSequenceCompleted` | 市场   | 标记市场变更序列结束。                 |
| `BetfairOrderVoided`       | 订单   | 作废订单详情（作废数量、价格、方向）。 |
| `BetfairRaceRunnerData`    | 赛事   | 每个参赛项的实时 GPS 跟踪（TPD）。     |
| `BetfairRaceProgress`      | 赛事   | 分段时间、赛事排名、跳跃数据。         |
| `BetfairCricketMatch`      | 板球   | 赛程、球队、比赛统计和事件数据。       |

赛事数据需要 Total Performance Data（TPD）覆盖，以及具有 TPD 访问权限的 Betfair API 密钥。设置 `subscribe_race_data=True` 启用。

## 多节点部署

多个交易节点在不同市场间共享同一个 Betfair 账户时：

1. 设置 `stream_market_ids_filter`，只包含该节点的市场。
2. 设置 `ignore_external_orders=True`，抑制来自其他节点订单的警告。
3. 设置 `reconcile_market_ids_only=True`，限制对账范围。

## 配置

### 数据客户端配置

| 选项                                | 默认值   | 说明                        |
| ----------------------------------- | -------- | --------------------------- |
| `account_currency`                  | `GBP`    | Betfair 账户货币。          |
| `username`                          | `None`   | 回退到 `BETFAIR_USERNAME`。 |
| `password`                          | `None`   | 回退到 `BETFAIR_PASSWORD`。 |
| `app_key`                           | `None`   | 回退到 `BETFAIR_APP_KEY`。  |
| `proxy_url`                         | `None`   | HTTP 请求的可选代理 URL。   |
| `request_rate_per_second`           | `5`      | 通用 HTTP 速率限制。        |
| `default_min_notional`              | `None`   | 可选的最小名义价值覆盖。    |
| `event_type_ids`                    | `None`   | 可选导航筛选器。            |
| `event_type_names`                  | `None`   | 可选导航筛选器。            |
| `event_ids`                         | `None`   | 可选导航筛选器。            |
| `country_codes`                     | `None`   | 可选导航筛选器。            |
| `market_types`                      | `None`   | 可选导航筛选器。            |
| `market_ids`                        | `None`   | 可选导航筛选器。            |
| `min_market_start_time`             | `None`   | 可选导航筛选器。            |
| `max_market_start_time`             | `None`   | 可选导航筛选器。            |
| `stream_host`                       | `None`   | 可选的数据流主机覆盖。      |
| `stream_port`                       | `None`   | 可选的数据流端口覆盖。      |
| `stream_heartbeat_ms`               | `5,000`  | 数据流心跳之间的间隔。      |
| `stream_idle_timeout_ms`            | `60,000` | 重连前的空闲超时。          |
| `stream_reconnect_delay_initial_ms` | `2,000`  | 初始重连延迟。              |
| `stream_reconnect_delay_max_ms`     | `30,000` | 最大重连延迟。              |
| `stream_use_tls`                    | `True`   | 数据流连接使用 TLS。        |
| `stream_conflate_ms`                | `None`   | 显式合并设置。              |
| `subscription_delay_secs`           | `3`      | 首次市场订阅前的延迟。      |
| `subscribe_race_data`               | `False`  | 订阅 RCM 更新。             |
| `subscribe_cricket_data`            | `False`  | 订阅板球 CCM 更新。         |

适配器每 36,000 秒续期一次会话。

### 执行客户端配置

| 选项                                | 默认值        | 说明                                      |
| ----------------------------------- | ------------- | ----------------------------------------- |
| `trader_id`                         | `TRADER-001`  | 客户端核心的交易者 ID。                   |
| `account_id`                        | `BETFAIR-001` | 客户端核心的账户 ID。                     |
| `account_currency`                  | `GBP`         | Betfair 账户货币。                        |
| `username`                          | `None`        | 回退到 `BETFAIR_USERNAME`。               |
| `password`                          | `None`        | 回退到 `BETFAIR_PASSWORD`。               |
| `app_key`                           | `None`        | 回退到 `BETFAIR_APP_KEY`。                |
| `proxy_url`                         | `None`        | HTTP 请求的可选代理 URL。                 |
| `request_rate_per_second`           | `5`           | 通用 HTTP 速率限制。                      |
| `order_request_rate_per_second`     | `20`          | 订单端点速率限制。                        |
| `stream_host`                       | `None`        | 可选的数据流主机覆盖。                    |
| `stream_port`                       | `None`        | 可选的数据流端口覆盖。                    |
| `stream_heartbeat_ms`               | `5,000`       | 数据流心跳之间的间隔。                    |
| `stream_idle_timeout_ms`            | `60,000`      | 重连前的空闲超时。                        |
| `stream_reconnect_delay_initial_ms` | `2,000`       | 初始重连延迟。                            |
| `stream_reconnect_delay_max_ms`     | `30,000`      | 最大重连延迟。                            |
| `stream_use_tls`                    | `True`        | 数据流连接使用 TLS。                      |
| `stream_market_ids_filter`          | `None`        | 可选的实盘 OCM 市场筛选器。               |
| `ignore_external_orders`            | `False`       | 只跳过没有 `rfo` 的 OCM 更新。            |
| `calculate_account_state`           | `True`        | 启用定期账户状态轮询。                    |
| `request_account_state_secs`        | `300`         | 账户资金轮询间隔。                        |
| `reconcile_market_ids_only`         | `False`       | 为 `True` 时使用 `reconcile_market_ids`。 |
| `reconcile_market_ids`              | `None`        | 显式的启动时对账市场 ID。                 |
| `use_market_version`                | `False`       | 将市场版本附加到下单和替换请求。          |
| `stream_gap_recovery_lookback_mins` | `10`          | 重连后批量状态对账的回溯窗口。            |
