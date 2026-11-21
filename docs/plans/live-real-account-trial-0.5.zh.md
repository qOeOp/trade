# 0.5.0 真实账户受控试运行清单

2026-11-21 用户对[全量重判](rejudge-0.5-20261121.zh.md)里需用户的行答「全按推荐」：0.5.0 发布后，用户做一次小资金的受控试运行，把只有真实账户能回答的问题一次问完（C-139、D-150、D-156、D-289）。读数出来后，D-289 的修法按用户的委托决定；C-111 的衰减阈值要等最初几天真实的 Live 对回放日对照。

本清单收的是这几处列过、`origin/main`（`22cc3572e`）上还没有答案的真实账户问题：

- C-139 合并的清单：上线前审计 `doctor/2026-11-14-pre-production-audit.zh.md` 的 D 节（D.1 的 D-1..D-15、D.4 的四种受控情形）、“需要用户授权的事项”第 1 组（L-09、L-10、M-13、L-07、L-11、M-14、M-02、L-25、O-04、O-08、M-11、L-05、L-20、L-23）、待证实表、(e)1 第 8、9、10 类，以及执行链表 N10、N15；
- 被 #3274 删掉的 `live-acceptance.zh.md` 草稿、`binance-live-hedge-design.zh.md`、`binance-live-hedge-implementation.zh.md`、`live-release.zh.md`（在 `3ddcd1446^` 上），以及 step3、step4、step5、step7b 各自写着“没有验证”的项；
- D-289（索引 20261114-25、-29 剩下的部分）、D-150、D-156；
- C-141 下单一侧：结果不明的下单。`RETAIN_UNRESOLVED` 在 `origin/main` 上没有启用，这一项仍未解决。

## 谁做什么

清单里每一步都由用户启动：保存凭证、在 Live 页检查账户和启动运行、停止、对账，在主机上暂停或停止容器，在 Binance 上平仓、撤单、下单。Agent 不启动 Live，不下单、不改单、不撤单，不读凭证，也不改账户设置（`AGENTS.md`）。Agent 能做的是：读用户交来的文件，按下面的判据写结论，再提出产品上的后续改动。

**交给 Agent 的东西。** 只交 `$LIVE_ROOT/runs/<run>/` 下面列出的文件，以及 Binance 页面的截图或导出（遮掉账户 ID 和 API key）。`$LIVE_ROOT/credentials/`、`account.lock`、主检出的 `.env` 不交，也不要贴到会话里。这些执行记录只留在 Live 的私有根目录里，不进账本、DoltHub 和 Git。仓库里的公开记录不写账户标识、余额和订单号，金额只写相对量。

## 前提

1. **0.5.0 已发布、已部署，Live 空闲。** 把 Live 页显示的运行镜像摘要记下来。在途的几个 PR 会改变部分预期：#3350（STOP 平仓被 Binance 明确拒绝时重发）、#3348（回放证据须用同一杠杆）、#3344（重复或修订的收盘 K 线不交给源码）、#3356（迟到太久的聚合 bar 关入场）。试运行时以发布版本的 `live/README.md` 为准。
2. **候选能通过 Live 准入**（`live/README.md`）：
   - 它所在线的关线历史检验判它达标，否则拒绝 `LIVE_CANDIDATE_FALSIFIED` 或 `LIVE_HISTORY_UNDECIDED`；
   - 有回放证据：起始资金在钱包的 10% 以内，合约正好是这次运行的合约，否则拒绝 `LIVE_EVIDENCE_MISSING` 或 `LIVE_EVIDENCE_BALANCE`；
   - 有一个对得上的 Paper 运行，否则拒绝 `LIVE_PAPER_UNRECONCILED`。

   Live 只跑研究账本里的候选，所以每次开仓都要等候选自己的信号。D-233 是给成交频繁的小额工程源码开 Live 的路径，判了“做（委托决定）”，但在 `origin/main` 上还没有。它落地之前，下面每一次“开仓”可能要等上几天。落地以后，这份清单原样适用。
3. **账户。** 由用户在 Binance 上设好：Hedge 模式、Multi-assets；每个合约 CROSS 保证金，杠杆等于 Live 页填的值，自动追加保证金关闭；账户全空。API key 关闭提现，并限制了 IP。
4. **规模。** 用交易所允许的最小规模。在 Strategy 一栏只填一个合约，选候选在其上的仓位最接近最小名义的那个。最小名义在第 1 项生成的 `preflight-*.json` 里，路径是 `symbols.<合约>.instrument` 的 filters。钱包只留够候选按自己的仓位公式下出一笔不低于最小名义的单，再加一倍余量。现金底线是首次武装时钱包的 85%。现在代码里首次试运行最多 100 USDT（`LIVE_BUDGET`），用户已说删掉，正由另一 lane 删，以发布时的代码为准。
5. **Telegram。** 在 Live settings 对话框（Live 页 Check account 旁的 Manage keys…）里保存 bot token。整个试运行期间，要有人能在几分钟内看到通知并去 Binance 操作（`live/README.md` “Unresolved Live runs”）。

## 看哪里

- **Live 页**：运行状态，Entries 一行（`Open`、`Closed · warming up`、`Closed · connection lost`、`Closed · a bar is missing`、`Closed · inherited position`……），保持时的提示。
- **`status` 与 `logs`**：按 `deploy/remote/README.md` “Live on this host” 定义 `live` 函数，再运行 `live status --root "$LIVE_ROOT" --run-id RUN`（给出 `state`、`exit_code`、`stop_reason`）和 `live logs --root "$LIVE_ROOT" --run-id RUN`（运行器日志）。
- **运行目录** `$LIVE_ROOT/runs/<run>/`（`LIVE_ROOT=/var/lib/trade-release/live-root`）：
  - `out/events.jsonl` 是运行器的事件，`lifecycle.jsonl` 是控制的记录（`launch_requested`、`restart_limited`、`key_check_failed`）；
  - `out/` 下的账户快照，都叫 `<前缀>-<纳秒>.json`，前缀有 `preflight`、`connected-account`、`entry-account`、`compare-account`、`held-account`、`brake-account`、`final-account`；
  - `out/evidence/market.jsonl` 与 `out/evidence/reports-<ns>/`（`orders.csv`、`fills.csv`、`positions.csv`、`account.csv`、`order_events.jsonl.gz`）；
  - `compare.json` 是每日对照。
- **容器**：运行器带标签 `trade.live.run=<run>`、`trade.live.role=runner`。出口代理带同一个 run 标签和 `trade.live.role=egress`，名字是 `trade-live-<键>-<run>-egress`。用 `docker ps --filter label=trade.live.run=<run>` 找它们。
- **Binance 页面**：持仓（含 LONG、SHORT 两侧）、当前委托与条件单、订单历史、成交历史、资金流水（Funding Fee）。

## 停止标准（启动前写死，触发即执行）

| # | 触发 | 用户的动作 |
|---|---|---|
| S1 | `status` 为 `unresolved`，或 Telegram 发来 UNRESOLVED | 按 `live/README.md` “Unresolved Live runs” 三步：停止，在 Binance 平仓并撤掉全部委托和条件单，Live 页 Reconcile account… 对到 `venue_flat`。本轮到此结束 |
| S2 | Binance 上有仓位而没有对应的止损，超过 90 秒；或保持期间 `held_uncovered` 报某个持仓没有止损 | 同 S1；保持期间立即在 Binance 上处理 |
| S3 | 本地与 Binance 的仓位或委托不一致，超过一个比对周期（300 秒） | Request stop… → Confirm stop；到不了 `clean_stopped` 就按 S1 |
| S4 | 出现预期之外的拒单原因，或同一原因反复出现 | Request stop…，保留证据 |
| S5 | 没有用户自己的操作、主机重启或发布，却收到中断或重启通知（缺根后的 `rewarming` 除外）；或收到 `restart_limited`；或失败退出的运行又被拉起 | Request stop…，到 Binance 核对 |
| S6 | 试运行期间有人在同一账户上手动交易（第 12、13、16 项除外） | 本轮作废 |

受控项的豁免只在用户事先声明“现在做第 N 项”的时段内有效，见各项。

## 顺序与开仓次数

必做的部分分三次运行，开仓 5 次（P1..P5）。可选项另加两次开仓，外加一次不开仓的运行。各项按下面的顺序排，让空仓时能做的先做完，每次开仓只用来回答它必须回答的问题。

| 运行 | 项 | 开仓 |
|---|---|---|
| 运行 1 | 1 预检 → 2 启动 → 3 空仓短断 → 4 空仓缺根 → 5、6、7 第一笔完整开平仓（P1）→ 8 GTD 到期（候选下 GTD 时）→ 9 带仓重启（P2）→ 10 带仓停止（P3） | 3 |
| 运行 2 | 1、2 → 12 受控手动平仓 A（P4） | 1 |
| 运行 3 | 1、2 → 13 受控手动平仓 B（P5） | 1 |
| 每天 | 11 每日对照 | 0 |
| 可选 | 14 有仓断线不少于 60 秒（P6，单独一次运行）、15 刹车真实触发（P7，单独一次运行）、16 空仓时 Binance 上出现未知委托（单独一次运行，不开仓） | 2 |

每次运行结束后，确认 `status` 已不占账户槽、Binance 全空，再按 `deploy/remote/README.md` “Backing up the Live root” 备份，然后才开下一次。下一次运行要在 Live 页重新 Check account，启动后是新的运行和新的原生身份。

## 清单

需要开着仓位才能做的项标【持仓】。

### 1　预检、密钥与通知（空仓）

- **做**：在研究图里选中候选。在 Live 页 Strategy 一栏填合约和 Leverage，点 Check account。在 Live settings 对话框的 Notifications 一节点 Send test。可选的负例：把 Leverage 填成与 Binance 上不同的值，再 Check account（不改账户设置）。
- **看**：Account check 一行；`status` 为 `preflight_complete`；`out/preflight-*.json` 里有：
  - `account.assets` 的 USDT `walletBalance`、`availableBalance`；
  - `config` 的 `dualSidePosition`、`multiAssetsMargin`；
  - 每个合约的 `config`（`marginType`、`leverage`、`isAutoAddMargin`）、`instrument`、`commission`；
  - `clock`。

  Telegram 应当收到测试消息。
- **通过**：`preflight_complete`；负例被拒为 `LIVE_MARGIN_MODE`；测试消息送到。
- **不通过**：`preflight_failed`。`live logs` 会给出拒绝码，处理之后再做。
- **决定**：不决定产品改动。这一步只确认后面各项有基线：手续费率、最小名义、时钟偏差。

### 2　启动与预热（空仓）

- **做**：点 Start live run，在原地按源码哈希确认。不设 Stop after。
- **看**：运行状态 `running`；Entries 从 `Closed · warming up` 变为 `Open`；`events.jsonl` 依次有 `connecting`、`warmup`、`equity_peak`；Telegram 有开始消息。
- **通过**：预热完成，入场打开，预热期间没有下单。
- **不通过**：以 `not_armed` 结束（没下单，账户槽自动释放），或以 `unresolved` 结束（按 S1 处理）。
- **决定**：不决定产品改动。

### 3　空仓短断，入场闸门关闭再打开（D.4 第 1 种；D-1 的空仓一半）

- **做**：账户空仓、没有委托，选候选不会出信号的时刻。在某分钟的第 5 秒左右，对这次运行的出口容器 `docker pause`，约 30 秒后 `docker unpause`，不要跨过分钟边界。
- **看**：`events.jsonl` 依次是：
  1. `socket_state`；
  2. `entries_closed`，原因 `disconnected`；
  3. `entries_checking`；
  4. 两条 `comparison`，读取时刻相隔不少于 30 秒；
  5. `entries_opened`。

  Entries 应从 `Closed · connection lost` 变回 `Open`。重连之后、下一根 1 分钟 K 线到达之前，`comparison` 带 `found.bars`、`agreed` 为假，这是预期内的。
- **通过**：运行不结束，没有 `unresolved`，不发 Telegram，闸门重新打开。
- **不通过**：运行结束或 `unresolved`，或闸门 10 分钟内没开（`entries_held`）。
- **未核实**：`docker pause` 出口是否会被识别为断线，代码里没有依据，回环里也没做过。如果没有 `socket_state`，记下实际看到的情况，这一项不算通过，以后换一种断网方式再做。
- **决定**：闸门的机制已有回环和单测作证据，这里读的是真实 Binance 的应答。重连后 `comparison` 一直对不上，就是 `engine/live_connection.py` 的缺陷，按 C-158 的回环夹具复现之后再修。

### 4　空仓缺一根 K 线后重新预热（D.4 第 2 种；T-05）

- **做**：同第 3 项，但暂停约 2 分钟，跨过至少一个分钟边界。
- **看**：
  - 满 60 秒时有 `connection_lost` 和一条 Telegram；
  - 恢复后有 `entries_closed`，原因 `bars_missing`，接着两条一致的 `comparison`；
  - `stopping`（原因 `rewarming`）、`rewarming`，`live status` 的 `exit_code` 为 3；
  - `lifecycle.jsonl` 里有一条新的 `launch_requested`；
  - 之后是 `resuming`（`held` 为假）和 `warmup`，Entries 回到 `Open`。
- **通过**：没有 `unresolved`。重启在控制的维护周期（10 秒）加一次预热的时间内完成。
- **不通过**：没有重启，或重启后预热两次失败，运行结束。注意每小时最多启动 4 次（`restart_limited`）。
- **决定**：不决定产品改动。只核对缺根重启在真实主机上走通；走不通的话，按 `live-bars-missing-rewarm-20261113.zh.md` 查缺陷。

### 5　第一笔开仓：止损、`positionSide`、可用余额、手续费【持仓 P1】（D-150、N10、M-02、L-25、D-6、D-4、D-9）

- **做**：等候选自己入场。用户只看，不操作。
- **看**：
  - Binance 持仓页：仓位落在哪一侧（LONG 或 SHORT）；条件单是否在成交后 90 秒内出现，数量是否不小于持仓；
  - `events.jsonl` 的 `order` 事件：`OrderAccepted`、`OrderFilled`，被拒时还有 `reason` 原文；
  - `out/entry-account-*.json`：这一笔入场前读到的 `walletBalance`、`availableBalance` 与持仓；
  - 运行结束后的 `fills.csv`：成交价、手续费。

  如果是多合约运行，或者这次入场是加仓，再看第二笔入场前的 `entry-account-*.json`：已有仓位占了保证金之后，`availableBalance` 降了多少。
- **通过**：
  - 止损在 90 秒内出现在同一侧，数量覆盖整个仓位，没有 `protection_missing`；
  - 限价入场的成交价不劣于限价；
  - 手续费按 `preflight-*.json` 里的 `commission` 重算后逐笔相等。
- **不通过**：止损迟迟不出现，或数量不够（S2）；拒单原因预期之外（S4）。
- **决定**：
  - C-054（入场上限基数改不改，判了“做（委托决定）”）：拿 `availableBalance` 和 `walletBalance` 之差的真实数值，校准它的进程内夹具。第二笔入场若被 `LIVE_FUNDS` 或 `LIVE_BUDGET` 拒掉，而回放放行了，就是“Live 跟随回放”意义下的平价缺陷。
  - D-150：两个 Retest 不在 0.5 的账本里，它们本身已无法实测。这一项改为确认 Hedge 下单腿的入场、止损和离场在真实账户上走得通。
  - M-11：候选同一侧加仓、出现两张止损时，记下两张止损的数量之和是否等于 Binance 上的仓位。没有加仓就记“未观察到”。

### 6　带持仓跨资金费结算【持仓 P1，碰上才算】（M-14、X-07、D-8）

- **做**：不做任何操作。P1 恰好跨过该合约的一次结算时才记。结算时刻以 Binance 页面为准；BTC、ETH 通常在 00:00、08:00、16:00 UTC。
- **看**：
  - Binance 资金流水里这次的 Funding Fee（方向和金额）；
  - 结算前后 `equity_peak` 或 `compare-account-*.json` 里钱包的变化；
  - `reports-<ns>/account.csv` 在结算时刻的余额变化；
  - 当天 `compare.json` 里的资金费，那是按公布费率补算的。

  P1 的离场如果正好落在结算那根 K 线上，另记一笔：回放和 Paper 不计这次资金费，实盘计。
- **通过**：Binance 实收与补算的方向一致，金额逐笔相等。
- **不通过**：方向或金额不同，列为问题，查清之前不放大资金。
- **决定**：C-133（实收资金费的产品读数，判了“做”）：从武装时与停止时的钱包差倒推资金费，拿这一笔真实流水验证这个方法。X-07 若实测成立，在技能的 Live 一节写明。

### 7　第一笔离场：残留止损的去留【持仓 P1】（O-04、O-08、D-4、step3 文档）

- **做**：等候选自己离场，用户不操作。
- **看**：
  - 离场的 `order` 事件；
  - 离场成交之后，Binance 当前委托里还有没有这个仓位的止损；
  - 之后的 `comparison` 有没有 `unknown_orders` 或 `native_only`；
  - 如果是止损触发离场：触发价与成交价的差。

  候选若提交了一张触发价已被穿过的止损，记下 Binance 的拒绝原文（-2021 一类）。
- **通过**：仓位平掉以后，Binance 上没有残留的止损或委托，`comparison` 一致，没有 `orphan_orders`。
- **不通过**：止损残留，S3。
- **决定**：
  - O-08：止损残留的话，就是“回放会缩量或撤销，Binance 不会”的真实读数。修法要么是平仓后由产品撤掉同侧止损，要么是技能要求源码自己撤；按委托决定。
  - O-04 / C-159：真实拒绝码出现时，作为 `reject_stop_orders` 改为 True 的依据。

### 8　GTD 入场单到期（D-5，20261114-26、-27）

- **做**：只有候选会下带 GTD 的入场限价单时才有这一项。不开仓，等一张没成交的单到期。
- **看**：
  - Binance 订单历史里这张单的到期时间和终态；
  - `order` 事件的终态（`OrderCanceled` 或 `OrderExpired`），与 `expire_time_ns` 相差多少；
  - 之后的 `comparison`。
- **通过**：单被接受，没有 `OrderDenied` 或 `entry_refused`；到期后终态事件到达，单不再挂着，运行继续。终态是哪种、差多少，照实记，不设上限。
- **不通过**：到期前后 1 秒内成交，却没有止损；或者到期后单仍挂在 Binance 上。
- **决定**：2026-11-06 那次的终态是 `CANCELED`。再出现一次，就在 `live/README.md` 里把“可能提前结束”写成确定的事实。

### 9　带持仓重启：保持并核实止损【持仓 P2】（D.4 第 4 种；L-10；20261114-24；step4“没有验证”）

- **做**：用户声明“现在做第 9 项”。P2 的仓位和止损都在时，`docker stop` 运行器容器。这里用的是 SIGTERM，不是 Live 页的 Stop。
- **看**：
  - `interrupted` 事件和通知；
  - Binance 上仓位与止损都不动；
  - 重启之后：`lifecycle.jsonl` 里有新的 `launch_requested`，`events.jsonl` 有 `resuming`（`held` 为真），30 秒内有 `held_covered`（同时记一个 `held-account-*.json`）；
  - Entries 显示 `Closed · inherited position`，Live 页有保持提示，Telegram 发同样的话。

  之后用户在 Binance 上手动平掉 P2，并撤掉它的止损。30 秒内应出现 `venue_flat_while_held`，这次启动以退出码 3 结束；下一次启动预热之后照常交易。
- **通过**：保持期间没有任何新委托；对止损的核实结论与 Binance 页面一致；账户空了以后，下一次启动正常交易。
- **不通过**：`held_uncovered` 报某个持仓没有止损，或报 `unreadable`（S2）；保持期间出现了新委托。
- **豁免**：S5 不适用于这次 `docker stop` 引起的中断；S6 不适用于这里的手动平仓。
- **决定**：这是 20261114-25 第一类的真实读数。重启以后，Redis 缓存与 Binance 的对账能否对上，决定 C-140“同一运行换新原生身份后继续交易”要不要加 authority（按委托决定）。如果保持期间出现了 `entries_kept`，就是 Redis 重载后撤不掉继承来的入场单，要修 `engine/live_connection.py` 的保持路径。

### 10　带持仓的 Request stop【持仓 P3】（L-05、D-14 的通知半段；运行 1 收尾）

- **做**：P3 的仓位和止损都在时，点 Request stop…，再在 10 秒内点 Confirm stop。
- **看**：
  - `stopping`，原因 `requested`；
  - 先撤入场单，再市价平仓，止损留到仓位平掉之后才撤；
  - `clean_stop`；`status` 为 `clean_stopped`，`exit_code` 为 0；
  - 出现 `reports-<ns>/`；
  - Binance 全空。

  如果当时还有没成交的入场单，同时看：撤单在 30 秒内没确认的话，有没有发平仓（L-05）。
- **通过**：`clean_stopped`，账户槽释放，Binance 全空。
- **不通过**：30 秒后 `unresolved`（`native_exit_timeout`），按 S1 处理。
- **决定**：L-05 若出现，就是 C-055 的真实读数：撤单没确认时也先发一次只减仓的平仓（判了“做（委托决定）”）。

### 11　每日对照（不开仓；C-111）

- **做**：不需要操作。控制每小时从 00:30 UTC 起，对还缺一天对照的运行跑一次。
- **看**：`$LIVE_ROOT/runs/<run>/compare.json` 的 `summary`（`groups`、`same`、`differs`、`run_only`、`replay_only`、`look_ahead_suspects`）、`unexplained`，以及 `measures`（`adverse_slippage_bps`、`fees`、`entries_unfilled`、`partial_fills`）。
- **通过**：`unexplained` 为空，`look_ahead_suspects` 为 0。不对应的决策都能归到 `replay/comparison.py` 的 `CAUSES`。
- **不通过**：`unexplained` 非空，或有前视嫌疑。列为问题，查清之前不放大资金。
- **决定**：C-111 的衰减阈值从这几天的日对照里定（用户 2026-11-21）。没有这些读数之前不定阈值。

### 12　受控手动平仓 A：平仓并撤止损，账户全空【持仓 P4】（20261114-25 第二类、L-09、M-13、D-7；D-289）

- **做**：运行 2。用户声明“现在做第 12 项”。P4 持仓时，在 Binance 上手动市价平掉这个仓位，并撤掉它的止损，让账户全空。
- **看**：
  - 从平仓那一刻起，`comparison` 什么时候第一次对不上（周期是 5 分钟）；
  - 两次相隔不少于 30 秒的比对都发现“Binance 全空而缓存里还有仓位”之后，记 `venue_flat`（`native_positions` 为真）；
  - 整个过程不发任何委托，`exit_code` 为 0，账户槽释放，`status` 为 `venue_flat`；
  - 这段时间里候选如果要入场：应看到 `entry_reread`；第二次读数仍不一致，就拒为 `LIVE_CONNECTION_UNVERIFIED`，同样以 `venue_flat` 收尾。
  - `positions.csv` 里有没有 EXTERNAL 仓位。
- **通过**：与上面的预期一致；Binance 上没有留下没人管的委托。
- **不通过**：出现了新入场并成交（S2、S3），或者运行发出了平仓委托。
- **豁免**：本项时段内 S2、S3、S6 不适用。
- **决定**：
  - 记下发现的时长，以及外部平仓的报文有没有进入原生缓存（看 `order_events.jsonl.gz` 有没有这笔成交）。这两样决定 D-289 / C-140 剩下的 authority 怎么做：要不要在发现之前更早地挡住入场，要不要在 STOP 之前先读交易所持仓。按委托决定。
  - 平仓后下一次运行用的是新身份，它能不能正常交易，就是“换新原生身份后继续交易”在真实账户上的答案。

### 13　受控手动平仓 B：只平仓，止损留在 Binance【持仓 P5】（20261114-25 第二类；D-289）

- **做**：运行 3。用户声明“现在做第 13 项”。P5 持仓时，在 Binance 上手动平掉仓位，止损留着不撤。看完比对之后，点 Request stop… → Confirm stop。
- **看**：
  - 两次对不上的 `comparison` 之后，入场关闭；不再发新入场；
  - Stop 之后，STOP 路径按缓存发出平仓，Binance 的拒绝原文（`order` 事件的 `reason`）；
  - 运行以 `unresolved` 结束；
  - 残留的止损有没有被撤。

  收尾：用户在 Binance 上撤掉残留的条件单，再 Reconcile account… → Connect and reconcile，得到 `venue_flat`。
- **通过**：与上面的预期一致（`live/README.md` 写明，这种情形只适用第一条规则）；没有任何委托打到 Binance 上的其他仓位。
- **不通过**：出现了新入场；或者平仓委托在 Binance 上开出了反向仓位。
- **豁免**：本项时段内，S1 按上面的收尾执行，S2、S3、S6 不适用。本项放在整个必做部分的最后。
- **决定**：
  - D-289 的第二项（Binance 上还留着止损或部分仓位时，STOP 仍按缓存平仓）：拿到真实拒绝码以后，再定 STOP 之前要不要先读 Binance 持仓。#3350 若已发布，确认它不会重发 Binance 明确拒绝的平仓。按委托决定。
  - D-289 的第三项（止损覆盖检查先于比对，例如强平同时撤掉了止损）没法安全地造出来，留作观察项。

### 14　可选：有仓位时断线不少于 60 秒【持仓 P6】（D.4 第 3 种；step3 第 4 步）

- **做**：只有用户明确要验证这条停机路径时才做，单独一次运行。P6 的仓位和止损都在时，暂停出口容器约 90 秒，然后恢复。
- **看**：先出现 `mark_missing` 还是 `drawdown_unverified`；运行判为失败，走 STOP 路径。网络没恢复时，平仓发不出去，30 秒后记 `unresolved`（`native_exit_timeout`），Binance 上的止损不动。网络在这 30 秒内恢复的话，平仓能发出，运行空仓、以退出码 1 结束，需要 Reconcile。
- **通过**：结局是上面两种之一。最终账户状态由用户在 Binance 页面确认。
- **豁免**：S1、S3 按本项的收尾执行。
- **决定**：只确认设计的结局，不决定产品改动。

### 15　可选：回撤刹车真实触发【持仓 P7】（D-14；step5“没有验证”）

- **做**：单独一次运行。准备时把 Drawdown brake 设得很紧，大约是一次开平仓手续费的量级（只能比默认值更紧）。能不能触发取决于行情，不保证。
- **看**：`equity_peak`、`drawdown_brake`（`equity`、`peak`、`drawdown`）、`out/brake-account-*.json`、`stopping`（原因 `drawdown`）、Telegram 的刹车消息，以及同一时刻 Binance 页面上的钱包和未实现盈亏。不触发的话，用 P1..P5 期间的 `equity_peak` 与 Binance 页面对比读数的口径。
- **通过**：`clean_stopped`，`exit_code` 为 0，运行没有再被拉起；`brake-account-*.json` 的权益与 Binance 页面相符。
- **不通过**：读数不符（列为问题），或者触发后有仓位却 60 秒读不到权益（`drawdown_unverified`）。
- **决定**：读数口径不符时，修 `engine/live_brake.py` 的权益算法。

### 16　可选：空仓时 Binance 上出现未知委托（不开仓；D-156 的一部分）

- **做**：单独一次运行，空仓，预热完成之后。用户在 Binance 上，对这次运行的合约手动挂一张远离盘口、不会成交的限价单。
- **看**：`comparison` 的 `unknown_orders`；`entries_closed`（`unknown_orders`）；Binance 上这张单被撤掉，同一合约的所有委托和条件单也一起撤掉（原生 cancel-all）；入场在这次运行里一直关着。最后点 Request stop… → Confirm stop，得到空仓的 `clean_stopped`。
- **通过**：未知委托被撤，运行没有发出别的委托，入场一直关闭。
- **豁免**：S6 不适用于这张单。
- **决定**：这是原生 cancel-all 在真实账户上的第一个读数，但它是不分方向的。D-156 讲的是撤单结果不明之后、按方向重发的那条路，这里没有走到，仍是观察项。本项只证明 cancel-all 的请求能到 Binance、能撤掉条件单。cancel-all 走的是 `DELETE /fapi/v1/batchOrders` 还是别的接口，本清单没有对照 rc7 源码核实。

## 只在发生时观察（不制造）

没看到就记“未观察到”，不算通过。每一条后面写的是它要决定的事。

| # | 情形 | 看什么 | 决定 |
|---|---|---|---|
| O1 | 只断了用户数据流，行情和 REST 仍通；listenKey 过期后轮换（D-1、N15） | `socket_state` 的端点，`entries_closed`，重连后的 `comparison`（`in_flight`、`unknown_orders`、`native_only`） | step3 写着“没有验证”的用户流追平 |
| O2 | 运行跨过 23 小时、空仓时换连接（`connection_renewed`，在一分钟的第 20–40 秒之间） | 之后的 `comparison` 与用户流事件是否照常 | `reconnect_socket` 对用户流是否生效（step3） |
| O3 | 止损在运行器不在线，或用户流中断期间触发（D-2） | 重启或重连后第一条 `comparison`；`positions.csv` 里的 EXTERNAL 仓位 | 20261114-25 第一类 |
| O4 | 读取或下单遇到 429、418、5xx（L-07、L-11、D-3） | `live logs` 里的 `LIVE_ACCOUNT_UNAVAILABLE` 原文（含 HTTP 状态和 `Retry-After`），以及原生适配器的日志行 | 产品重试（#3328）只在三次都失败时才留下文字，响应头里的已用权重产品不记。要量权重，得先加一个读数（例如在运行器日志里记 `X-MBX-USED-WEIGHT-1M`）。这是对现行为的改动，在试运行之前按 C-141 / D-289 的委托决定做不做 |
| O5 | 下单结果不明（超时、5xx）（C-141 下单一侧） | `comparison` 里长时间 `in_flight` 的委托；`order` 事件里 `OrderRejected`，原因 `INFLIGHT_TIMEOUT`；同一时刻 Binance 订单历史里这张单是否其实还活着 | `RETAIN_UNRESOLVED` 要等 C-158 的回环夹具验收之后才启用；这里的真实读数说明它值不值得 |
| O6 | 撤单结果不明之后，按方向重发 cancel-all（D-156） | 同一 `client_order_id` 反复出现 `entry_cancel_requested`，或者出现 `cancel_resend_withheld`；Binance 上同一侧的保护单是否还在 | 确认按方向撤单不会撤掉另一侧的止损，有保护单时会先停下不撤 |
| O7 | 每天 00:00:05 UTC 前后日线的送达时刻（D-11，20261114-30） | `events.jsonl` 里日线 bar 的墙钟时刻 | 距 UTC 日界超过 10 秒，列为问题 |
| O8 | 同一 `ts_event` 的收盘 K 线推了两次、迟到的分钟 bar（T-15、T-05） | `out/evidence/market.jsonl` 里同一 `ts_event` 有两行；有没有误报的 `bars_missing` | #3344、#3356 是否已发布、是否够用 |
| O9 | 合约状态变化、交易所维护、条款变更（D-12、D-15、X-04、T-08） | `entries_closed`（`contract_status`）、`socket_state`、`TERMS_CHANGED`、精度拒单 | X-04（合约非 TRADING 后被 rc7 整个丢掉）的真实读数 |
| O10 | 强平与 ADL（D-7） | 与第 12 项相同的几样 | 同第 12 项 |
| O11 | `held_uncovered` 报某个持仓没有止损；`entries_kept`；`orphan_orders` | 事件与 Binance 页面 | 保持路径与空仓残留只减仓单的处理 |
| O12 | 运行器被 SIGKILL 时正好有委托在途（L-20，C-060） | 重启后的对账是否补回 | C-060 的回环探针先做；真实读数只能等它发生 |
| O13 | 部分成交、限价穿价成交、极低量分钟（D-9、O-10、O-11） | `fills.csv` 与当天 `compare.json` 的 `partial_fills`、`adverse_slippage_bps` | 成交模型是否要加参与率参数（只记读数） |

## 之后

- 用户把上面每一项提到的文件，以及 Binance 页面的截图或导出，交给之后的会话。那个会话按每一项的判据写一份公开记录，放在 `docs/plans/` 下：每一项写通过、不通过或未观察到，附 UTC 时间、触发过的停止标准和每个偏差的解释，不写账户标识、余额和订单号。
- 每一项“决定”一栏里写着“按委托决定”的，由那个会话按 2026-11-21 的委托（「需要我定的部份最后也是一样由你决定按推荐做」）定下修法，再提 PR。新增存储字段、真实下单和 Live 运行仍由用户决定。
- 这次试运行证明的只是执行链，不证明策略收益。放大资金之前，先让真实候选用同样的资金跑满一段，期间 `compare.json` 没有 `unexplained`。放大的节奏由用户定。
