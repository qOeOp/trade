# 行情缺根后重新预热（2026-11-13）

依据：`live-continuous-operation-design-20261110.zh.md` §3.2 第 3 条——"行情缺根：不修补数据。入场保持关闭，持仓照常管理；
重新预热（§3.3）通过后再开入场"。用户 2026-11-10 "全部授权"的范围内（断线不结束运行；中断的运行以原身份重启）。
协调会话 2026-11-13 要求实现，先经独立子代理评审（结论：修改后通过，三项阻塞，均已采纳，见文末）。

## 问题

- `engine/live_connection.py bar()` 在源码看到 K 线之前检查外部 K 线是否连续（`engine/live_source.py`）。断了就以
  `bars_missing` 关闭入场，直到本次运行结束。
- 探针 2（#2848）：行情断线跨过 K 线收盘后，Nautilus 重连，但不补发错过的收盘。一个不停的运行只要有一次断线超过约 1 分钟，
  就再也不开仓。

## 做法：空仓后结束本次启动，交给已有的重启去重新预热

1. **发现缺根**：入场关闭，并撤掉在途的入场单（`cancel_entries("bars_missing")`）。
   - 这一刻进程还在，万一撤单前成交，源码照常挂止损，`check_protection` 照常检查。
   - 撤单写 `entry_cancel_requested`，`live compare` 能把它归到 `entry_gate`。
   - 已有持仓的源码继续收 K 线、管理退出（§3.2"持仓照常管理"）。
2. **等到可以重启**：同时满足以下条件——
   - 关闭原因除 `bars_missing` 外只有 `disconnected` / `unverified`（重启会自己重新核对这两项）；
   - 本策略没有持仓、没有任何未关闭的单、没有暂存的入场；
   - 没有在停止中。

   满足时：
   - 源码不再收到任何 K 线（证据包照常记录），所以不会在有缺口的状态上开仓；
   - 账户比对按断线重连时的节奏立即开始。
3. **重启前必须有两次一致的比对**：与断线重连同一个比对——REST 读账户和原生缓存比较，两次相隔至少 31 秒，且都在缺口之后。
   - 两次一致时结束本次启动：`stopping(reason=rewarming)`，然后走中断路径，不平仓；退出时写 `rewarming`，退出码 3。
   - 比对发现本地不认识的单时，走已有的撤掉该合约全部挂单的路径，`unknown_orders` 让入场在本次运行内保持关闭，不重启。
     这样不会把一笔断线前发出、本地记为拒绝的入场单留到重启后的 `held` 里无人管。
4. **重启**：控制看到的就是一次中断，按已有规则在每小时 3 次的限额内重启（`RESTARTS_PER_HOUR`，第 4 步）。
   - REST 读到空仓，于是重新预热（R1：T 是启动后至少 30 秒的第一个整分钟，T+45 秒前完成），一般一两分钟。
   - 预热数据来自币安的公开 K 线（REST），里面有直播流漏掉的那根。
   - 预热核对通过后源码开始交易，新进程的入场是开的。
5. **停止优先**：重新预热进行中如果来了 STOP、到达运行时长或源码失败，取消重新预热，按原来的停止路径结束运行（空仓，`clean_stop`）。
   这样不会出现带着 STOP 以退出码 3 结束、被控制读成 `unresolved` 的情况。

不在进程内重建源码：
- rc7 导出了 `Controller`（`create_strategy_from_config`、`remove_strategy`），但没有原生探针；
- 源码的预热状态在进程级的 `history.STATES` / `ACTORS` 里；
- Live 源码的构造方式（`engine/live_source.py`）不走配置创建。

重启复用已测过的路径，代价只是一两分钟不开仓。

## Runner 合同

- `rewarming` 不是结束事件，退出码仍是 3，`runner_args`、`ENDED_EVENTS`、`RUN_ENDED`、`FLAT` 不变，`RUNNER_CONTRACT` 仍是 1。
  `tests/live/test_runner_contract.py` 加了一条：这样结束的启动读为 interrupted，会被再次启动。录好的基线不改。
- 旧控制接管时照样当中断重启，只是不发 `rewarming` 的通知，缺根时仍发旧文字。
- `live/runs.py _stop_reason` 跳过 `rewarming`。否则运行最后结束时 Telegram 会把停止原因写成第一次重新预热。

## 通知（Telegram）

一次缺根正常走完发三条，键都由各自事件的 `observed_ns` 组成，跨版本不变：

1. `{run}:gate:{ns}`（已有的键，改文字）："a bar is missing from the feed, so entries are closed. Positions keep their
   exits; once the run holds nothing it starts again and warms up on Binance's complete bars (a minute or two), then trades."
2. `{run}:restart:rewarming:{ns}`："missed a bar and holds no position: it starts again to warm up on Binance's complete bars."
   紧跟着的空仓 `resuming` 不再单独通知。
3. `{run}:restart:warmup:{ns}`：重启后源码预热完成（`warmup` 事件），并且前面有 `rewarming`：
   "warmed up again after the missing bar; entries are open."

`live/views.py` 的 `RESTART_EVENTS` 加了 `rewarming` 和 `warmup`，只供通知读。页面上读 `restarts` 的只有保持持仓的提示，不受影响。

## 用户决定的四项放宽（2026-11-13，"后面的都按建议"）

初稿留给用户的四项，用户 2026-11-13 回复"第一件效果图可以 后面的都按建议"，按建议放宽，另一个 PR 实现：

1. **有持仓期间源码想开仓**：原来入场被拒、运行失败并平仓结束。现在这一笔入场被原生拒绝（`OrderDenied`），运行继续，持仓和它在交易所的止损不动。
   - rc7 的 Python `Strategy` 没有 `deny_order`，只有 `ExecutionAlgorithm` 有。runner 在运行节点上注册一个只用来拒单的
     `ExecutionAlgorithm`（`LIVE-GATE`）。它的 `deny_order` 把源码的单记进原生缓存，状态 DENIED，并给源码发 `OrderInitialized`、
     `OrderDenied`。单不发往交易所。
   - 先过完入场单的全部检查（形状、归属、订单规则），通过了才拒；检查不过照旧拒绝并结束运行。原生缓存里已有的单、
     拒单回调里再下的入场、拒单本身失败，也照旧拒绝并结束运行。
   - 这样拒掉的单记入 `session.denied` 和日志（`entry_denied`）：包装层不把它的 `OrderDenied` 当原生失败；`source_outcome`
     从日志读回各次启动拒掉的单（重启后重新载入的原生缓存里还有这些 DENIED 单），也不算失败。
     不是它拒的 DENIED 或 REJECTED 照旧结束运行。
   - 只限关闭原因里除 `disconnected`/`unverified` 外只有 `bars_missing`，并且本策略有持仓。空仓时（源码收不到 K 线，只可能在
     定时器、标记价格或资金费回调里下单）、或同时有 `unknown_orders` 等原因时，照旧拒绝并结束运行。
   - 记 `entry_denied`；`live compare` 把被拒单所在的组归到 `entry_gate`。
2. **缺根时已有暂存的入场**（等账户核对的，或断线时暂存的）：原来被拒、运行结束。现在逐笔原生拒绝，运行继续；
   等着的账户核对作废。之后若空仓，照常走重新预热。某一笔拒不掉时，它和剩下的照旧拒绝、运行结束；在途入场单无论如何都会撤。
3. **重启后预热失败**：原来运行失败结束。现在再重启一次：
   - 本次启动结束方式同缺根空仓（`rewarming`，带 `retry`，退出码 3），控制照常重启，计入每小时 3 次的限额；
   - 只有上一次启动以不带 `retry` 的 `rewarming` 结束时才这样做（`engine/live.py warmup_retry`，在本次启动写事件之前读）；
   - 第二次预热也失败就照旧结束运行。
   - 等重启期间来了 STOP、到时或源码失败：照旧结束运行，并记为失败（预热确实失败了）。
4. **交易所留下孤立的只减仓单**（空仓、单还挂着）：仍不撤、入场保持关闭、不重启。
   - 定期比对（每 5 分钟）一致，说明这些单确实还在币安。
   - 从第一次看到起满 10 分钟，记 `orphan_orders` 并发一次 Telegram 提醒，请用户在币安上撤掉不需要的单。
   - 比对每 5 分钟一次，读数时间有几秒偏差，判定留 10 秒余量。提醒在第一次看到后 10 到 15 分钟之间发出，
     空仓后到第一次看到最多再加 5 分钟，合计空仓后 10 到 20 分钟。

## 验证

- **单元测试**：
  - `tests/engine/test_live_gate.py`：
    - 缺根撤在途入场；有持仓时比对一致也不重启；
    - 空仓时比对立即开始，一次一致不够、两次才 `rewarming`，入场没有重开；
    - 本地不认识的单走撤全部、不重启；
    - 只有空仓且原因可由重启清除时才等待；
    - 空仓的源码收不到 K 线（证据仍记录），有持仓的照常收到；
    - STOP 取代重新预热。
  - `tests/engine/test_live_entry.py`：在 Nautilus 回测引擎上用真实原生单验证：在途入场被撤；空仓后两次一致即 `rewarming`；
    Observer 不平仓，直接停 node，`native_flat` 为假，没有失败。
  - `tests/live`：通知的三条文字、键和抑制（`test_notify`）；views 的 restarts（`test_views`）；合同（`test_runner_contract`）。
- **反向对照**（每次改完都恢复），各自让对应测试失败：
  1. Observer 对重新预热走平仓路径；
  2. 比对一致后重开入场而不是重启；
  3. 空仓的源码照样收到 K 线；
  4. 停止原因不跳过 `rewarming`。
- **原生探针**（rc7，只用公开行情，无凭证）：探针 2 的本地 CONNECT 代理在第 45 秒到下一分钟第 15 秒切断，runner 的
  `live_connection.bar` 和 `rewarm_pending` 跑在真实的 `engine.live.Session` 和节点原生缓存上。账户比对需要凭证，用两次一致的桩代替。
  - 第一次（初稿逻辑）：17:00 那根没送达，17:01 到达时关闭入场（`bars_missing`）。紧接着向币安 REST 请求历史，拿到
    16:57–17:01 连续五根，其中有漏掉的 17:00。
  - 第二次（本稿逻辑）：17:06 那根没送达；17:07 到达时关闭入场，空仓的源码没收到它；两次一致的比对后开始 `rewarming`；REST 历史 17:03–17:07 连续，含 17:06。
- **只能由用户做的真实账户试验**：
  1. 有运行在跑、空仓时，让 runner 出口断网约 2 分钟（跨过分钟收盘）。期望依次看到：
     - `entries_closed(bars_missing)`；
     - 两条一致的 `comparison`；
     - `rewarming`，退出码 3；
     - 控制重启，`resuming`、`warmup`；
     - Telegram 依次收到缺根、重启预热、入场重开三条。
  2. 有持仓时重复：入场关闭、持仓和止损不动，平仓后才走第 1 条。

## 风险

- 重新预热期间（比对约 40 秒，加重启和预热一两分钟）不开仓，可能错过信号。这是 §3.2 选不修补数据的代价。
- 行情反复中断时频繁重启，超过每小时 3 次后控制记 `restart_limited`，运行保持中断，等用户处理。
- `live compare`：
  - 被扣下没给源码的那根 K 线仍在证据里。回放的源码能看到它，可能在段尾多出回放独有的决策，归为 `window_end`。
  - 多次启动的运行要用 #2855 的分段对照。

## 评审记录（独立子代理，2026-11-13，修改后通过）

阻塞项及处理：
1. **只看本地缓存为空就重启**，会漏掉交易所上本地不认识的单（§3.2.3 的例子）。改为两次一致的比对之后才重启；
   发现不认识的单走已有撤全部的路径。
2. **在途入场留给中断路径去撤**，撤单期间成交时没人挂止损。改为缺根时立即在正常运行中撤，等到连单都没有了才结束。
3. **预热时间写错**（不是 15 分钟边界，而是一两分钟），并且漏了重启后预热失败会结束运行。已改；后者列入需要用户决定的事项。

非阻塞项：
- 已采纳：停止优先；源码在每根 K 线前检查；退出只写一个 `rewarming`，不再接着发空仓的 `resuming`；删掉"页面重启列表"的说法；
  停止原因跳过 `rewarming`；说明不用 `Controller` 的理由。
- 记为待定：孤立只减仓单（2026-11-13 用户决定为提醒，见上）。
- 写进风险：`live compare` 在多次启动时的覆盖范围。
