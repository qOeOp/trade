# Live 验收方案

> 状态：草稿，等用户读过再合并。2026-11-15 用户决定按推荐方向重写旧版（doctor 20261114-37 指出旧版引用已不存在的测试与步骤，
> #3023 只加了"已过期"标注）。依据 `main` 的 `d3e2f0fd4`、`engine/README.md` 的 Live execution、`deploy/remote/README.md`、
> `CHANGELOG.md`，以及上线前审计的 D 节（`doctor/2026-11-14-pre-production-audit.zh.md`，按钉住的提交 `65a3c1299` 写，下面按现行为修订）。
> 每个预期都回到代码或 README 核对过；没能核对的写【待确认】，由用户在验收时确认后改成事实或删掉。

这份文档回答一件事：一个版本的 Live 在放大资金之前，要在真实账户上看到什么才算通过。

**谁做什么。** 真实账户上的一切动作，主语都是用户：在 Binance 建密钥、设置账户、保存凭证、从 Live 页准备、预检、启动、停止、对账，
在主机上断网或停容器，在 Binance 上手动平仓与撤单。Agent 不启动 Live，不读凭证，不下、改、撤真实订单，不改账户设置（`AGENTS.md`）。
Agent 可以做的：按用户给的范围写工程用源码（策略源码是 Agent 工作）、读用户交来的记录、按它们写验收记录。
每个真实账户试验的范围（资金、合约、源码、时段）由用户另给。

## 1. 范围与前提

### 1.1 验收的对象

`main` 上的 Live，含 v0.4.0（2026-11-14）和之后合入的修复：入场在派发时被拒走 STOP 平仓路径（#3022）、停止时被限频拒掉的平仓重发
（#3027）、runner 自己拒绝或失败退出不再被当中断重启（#3049）、保持模式核实止损并撤继承来的入场单（#3052）、闸门拒单的自报不再判失败
（#3054）、持仓对不上时不放入场且交易所全空时以 `venue_flat` 结束（#3058）、GTD 到期必须整秒（#3051）、Live 发不出的订单类型带 GTD
被拒（#3045）。这些修复在 `CHANGELOG.md` 的 Unreleased 里，**还没随版本到主机**。

还有两处在途修改：只读客户端应答形状与恢复启动时钟超限的重试（doctor 20261114-29，现为 open），Live 页保持状态的显示。它们合并并
发版后，第 8、12 步的预期与页面文字以届时的 `engine/README.md` 为准【待确认】。

### 1.2 先发版

验收只在已发布的版本上做：修复随版本到主机，发版是用户的决定（`CHANGELOG.md` 开头）。发布要等 Live 空闲，所以先发版、再准备运行。
把 Live 页显示的运行镜像摘要记进验收记录（第 6.3 节）。

### 1.3 一次运行怎样选（`engine/README.md` Live execution，`docs/plans/live-run-choices-20261114.zh.md`）

- **候选**：研究图里选中的版本；准备时在研究账本头部读它，那个提交成为运行的 `research_at`。不在头部或源码加载不了：`LIVE_SOURCE_MISSING`。
  Live 只跑候选自己的源码。
- **合约**：在 Live 页输入，默认是候选最近一次研究回放的合约；每个合约一个源码实例，各下各的合约。建议 BTCUSDT 与 ETHUSDT 都开，才能看到多合约
  下的保证金占用。
- **杠杆**：在 Live 页输入，默认 3。准入核对的是 Binance 上每个合约的杠杆设置**等于**这个值，产品从不改交易所的杠杆
  （不等则 `LIVE_MARGIN_MODE`）。运行的杠杆与回放证据所用杠杆是否一致，产品不核对（审计 R3 B-04），由用户启动前人工确认。
- **回撤刹车**：默认 15%（用户的最大回撤目标），页面上只能设得更紧；不设时长则一直跑到用户停止。
- **现金底线**：第一次 armed 时 USDT 钱包的 85%，且不超过 100 USDT（`LIVE_BUDGET`），所以首次试验的钱包不超过约 117.6 USDT。每笔入场还要求钱包与
  可用余额都不低于它；单笔入场的名义不超过权益的 3 倍；合约最小名义不超过这个 3 倍（`LIVE_MINIMUM_SIZE`）。
- **账户（用户在 Binance 上设置，准入核对）**：Hedge、Multi-assets；每个合约 CROSS 保证金、杠杆等于上面的值、自动追加保证金关闭；启动时账户全空
  （无持仓、挂单、条件单）。

### 1.4 密钥与凭证

凭证由用户在 Live 页保存，不进 argv、环境变量、Git 或账本。密钥要满足（`live/key.py`）：提现关闭（`LIVE_KEY_WITHDRAWAL`）、有 IP 限制
（`LIVE_KEY_IP_UNRESTRICTED`）、权限读得出（`LIVE_KEY_UNVERIFIED`）。每次预检和启动前读一次，运行中控制每小时读一次：失败记 `key_check_failed`
并发 Telegram，运行不停。审计 20261114-32（宿主 shell 里有交易所凭证变量）仍是 open，由用户处置；验收期间不要在这台机器上跑别的 Agent 进程。

### 1.5 候选要满足什么才能上 Live

- **回放证据**：一个通过的封存运行，或一个完成的 `replay explore`（审计通过，窗口在同源码某研究试验的窗口内），源码相同、合约恰为这次运行的合约、
  按 `bars`，回放镜像的 `source_files_sha256`、`audit_source_sha256`、`dependency_lock_sha256` 与执行镜像相同。没有则 `LIVE_EVIDENCE_MISSING`。
  起始资金要在 Live 读到的 USDT 钱包的 10% 以内（`LIVE_EVIDENCE_BALANCE`）：为这次运行回放时用 `candidate export`，再 `replay explore`，
  `--starting-balance` 取钱包、`--symbols` 取这次的合约。
- **订单规则**（`engine/order_rules.py` 规则 5，回放、Paper、Live 相同）：只有 LIMIT、STOP_LIMIT、LIMIT_IF_TOUCHED 可以带 GTD，其余带 GTD 是
  `ORDER_RULE`（#3045）；到期必须是整秒，非整秒 `ORDER_RULE`（#3051）；到期至少在提交后 600 秒。回放里 bar 的时间戳比整分钟早 1 毫秒，所以
  写成 `clock + 秒数` 的到期必被拒，要像策略编写参考 Live 一节那样向上取整。Live 另要求入场发出时到期前至少还有 605 秒（等账户核对与暂存要时间），
  所以 600 到 605 秒的 GTD 入场在回放和 Paper 通过、在 Live 被拒（`LIVE_ORDER_UNSUPPORTED`）；要让它撑过暂存，到期要远大于 605 秒。
- **出场与保护**：出场订单不带 params；每个持仓要有止损覆盖，缺口超过 90 秒运行判失败（`protection_missing`）。
- **审计 D.2 的三件事现在的状态**：20261114-26（GTD 整秒）规则已入 #3051，但**现行候选**里写 `clock + 秒数` 的版本都会被新回放镜像拒掉，要上 Live 的
  候选须出取整后的新版本并重新取得回放证据（研究工作，不在本文范围）；20261114-22、-23、-24 已修（见 1.1）；20261114-32 仍 open。

## 2. 已有的证据与只能留给真实账户的事

| 层级 | 证明什么 | 证明不了什么 | 在哪里 |
|---|---|---|---|
| 进程内测试与故障注入（Nautilus 回测引擎 + 桩，真实产品模块） | 收到某种应答时产品和 Nautilus 怎么做 | Binance 是否这样应答 | 各修复 PR 的 Validation；审计 `phaseB/B2`（在 `/tmp`，不在仓库） |
| 对本地假交易所的回环（真实 `engine.live.main` + rc7 的 Binance 适配器，容器断网） | 事件顺序、重连与对账的机制 | 真实交易所的报文、限频、条件单事件是否补发 | 审计 `phaseC/C10`；#3058 的 `s1_resume_down`、`s2_external_liquidation`、`s2_external_manual` |
| 公开行情上的原生探针（无凭证） | `reconnect_socket`、K 线断线后不补发、历史 K 线补得上缺的那根 | 用户数据流、下单 | `live-continuous-step3-disconnect-20261113.zh.md`、`live-entry-hold-20261113.zh.md`、`live-bars-missing-rewarm-20261113.zh.md` |
| 2026-11-06 的真实账户试验（7 轮，5 轮闭环） | 当时的多空入场、止盈、止损、撤单、定时退出与空仓对账；GTD 到期未通过，到期返回 `CANCELED` | 现行产品：之后重写了断线、重启、刹车、通知、候选选择；不是自然信号 | `live-release.zh.md` |

只有真实账户能回答的事（审计 D.1，索引 id 在括号里）：

- 用户数据流断线与重连后订单、仓位能否追平；止损在没有进程听见时触发后缓存能否对上；外部平仓、强平、ADL 的报文（20261114-25 的 measure 一半，M-13）；
- 入场被拒后市价平仓的真实成交、止损撤销与最终账户读取（20261114-22）；保持模式用的条件单行字段与真实应答是否相同（20261114-24）；
- GTD 的接受精度、到期返回 `CANCELED` 还是 `EXPIRED`、到期瞬间与成交的竞态（20261114-26、-27）；
- 限频权重与 429、418（20261114-29）；日线送达时刻（20261114-30，D-11）；Docker 在主机掉电时的退出码（20261114-23）；
- 刹车读到的权益与 Binance 页面是否一致（L-05、D-14）；已有仓位占用保证金后 `availableBalance` 的口径（M-02、L-25）；
  平仓后残留止损的去留与同腿多仓位的保护单（O-04、O-08、M-11）；在资金费结算那根 K 线上离场是否付资金费（X-07）；资金费入账（M-14）。

## 3. 验收步骤

### 3.0 共同做法

**每个运行**用一个新的 run ID，启动前账户全空；每个运行结束后确认 `status` 不再占账户槽、Binance 上全空，再备份 Live 根
（`deploy/remote/README.md` Backing up the Live root），再开下一个。需要在运行中造情形的步骤，用**工程用源码**（成交频繁、名义很小，能在
一两天内走完生命周期；审计 D.3 的"第一段"）。工程用源码也要满足 1.5，并且要是研究账本头部的一个候选版本：这会在活动账本里留一条只增不减的记录，
而 `AGENTS.md` 规定产品代码的工程试验只写隔离账本。Live 读的是研究账本头部，所以是否在活动账本登记它，由用户决定【待确认】。
真实候选（审计 D.3 的"第二段"）至少跑 14 天，或直到完成一次完整开平仓，看每日决策、日线送达、长时间运行下的重连与缓存。

**看哪里**（下面各步写"看"时指这几处）：

- **页面**：Live 页运行状态（`running`、`interrupted`、`unresolved`、`clean_stopped`、`reconciled_flat`、`venue_flat`、`not_armed`、`preflight_complete`、
  `preflight_failed`）；入场开关（`Open`，或 `Closed · warming up`、`Closed · connection lost`、`Closed · inherited position`、`Closed · a bar is missing`…）；
  保持时的提示。
- **`status` 与 `logs`**：用 `deploy/remote/README.md` Live on this host 里的 `live` 函数，`live status --root "$LIVE_ROOT" --run-id RUN`
  给 `state`、`exit_code`、`stop_reason`（用户停止是 `requested`）；`live logs` 读运行器日志。
- **`events.jsonl`**：`$LIVE_ROOT/runs/<run>/out/events.jsonl`，运行器的事件；`lifecycle.jsonl` 在 `runs/<run>/`，是控制的启动记录。
- **Telegram**：运行开始与结束、成交、未解决、断线超过 1 分钟、缺根、重启与保持、刹车、密钥检查、每日概况。
- **Binance 页面**：持仓、挂单、条件单、成交与资金费流水。

### 步骤 1　准入与预检

- **目的**：账户与凭证满足准入，所有拒绝路径在下单之前就拦住；通知通路通。
- **谁做**：用户。
- **做法**：保存凭证；在 Live 页选候选、合约、杠杆，准备，看页面显示的候选与回放证据；点 Check account（预检）。再保存 Telegram 令牌、发测试消息。
  可选的负例：把页面上的杠杆填成与 Binance 上不同的值再预检（不改账户设置）。
- **看**：页面与 `status` 的 `preflight_complete`；运行目录里的 `preflight-*.json`（账户、设置、钱包、合约条款与手续费率，后面核对成交与手续费要用）；Telegram 测试消息。
- **通过**：预检 `preflight_complete`；负例被拒为 `LIVE_MARGIN_MODE`；测试消息到。
- **不通过**：`preflight_failed`，`live logs` 给拒绝码，处理原因后重做；不进入下一步。`UNRESOLVED` 通知无法在这里造出来，它的送达只能在第 10、12、13 步观察（10 秒内，无送达保证）。

### 步骤 2　启动与预热

- **目的**：启动检查、预热、入场开关。
- **谁做**：用户从 Live 页点 Start live，页面按源码哈希确认；不设时长。
- **看**：页面 `running`；入场开关从 `Closed · warming up` 变为 `Open`；`events.jsonl` 的 `connecting`、`warmup`、`equity_peak`；Telegram 的开始消息。
- **通过**：预热完成后入场开关 `Open`，运行不结束。预热期间不下单。
- **不通过**：运行以 `not_armed`（没下单，账户槽自动释放）或 `unresolved` 结束：按拒绝码处理；`unresolved` 走 README Unresolved Live runs。

### 步骤 3　一次完整开平仓

- **目的**：进场成交 → 止损在交易所被接受 → 离场成交 → 剩余止损撤销，全程不重启。
- **谁做**：运行自己的源码下单；用户在 Binance 页面看。
- **看**：Binance 的持仓与条件单；`events.jsonl` 的 `order` 事件（`event_type`：`OrderAccepted`、`OrderFilled`、`OrderCanceled`…）与 `comparison`；运行结束后
  `reports-<ns>/` 的 `orders.csv`、`fills.csv`、`positions.csv`；Telegram 的成交消息。
- **通过**：进场成交后 90 秒内 Binance 上出现覆盖全仓的止损（数量不小于持仓）；离场成交后该仓位没有残留止损或挂单；进场限价单成交价不劣于限价；
  手续费按预检读到的费率重算后逐笔相等；全程 `comparison` 一致、没有 `entry_refused`、`protection_missing`。
- **不通过**：止损迟迟不出现或数量不足（`protection_missing`，运行失败走 STOP 路径）、离场后有残留止损（审计 O-04、O-08 的现实读数）：停止标准第 2、3、5 条，保留证据。

### 步骤 4　GTD 进场单到期

- **目的**：交易所接受取整后的 GTD，到期的终态与时间，到期瞬间的竞态。
- **做法**：工程用源码下一张离盘口较远、不会成交的 GTD 进场限价单，到期取整、剩余远大于 605 秒。
- **看**：Binance 上该订单的到期时间；`order` 事件的终态（`OrderCanceled` 或 `OrderExpired`）与 `expire_time_ns` 的时间差；之后 `comparison`。
- **通过**：订单被接受（没有 `OrderDenied`、`entry_refused`）；到期后终态事件到达、订单不再挂着；运行继续。终态是 `CANCELED` 还是 `EXPIRED`、与到期相差多少，**记录，不设上限**。
- **不通过**：到期前后 1 秒内成交而没有止损（停止标准第 2 条）；到期后订单仍在 Binance 挂着。

### 步骤 5　带持仓跨资金费结算

- **目的**：资金费的入账与 `live compare` 按公布费率补算的差。
- **做法**：工程用源码持仓跨过该合约的一次结算（时刻以 Binance 页面为准，BTC、ETH 通常 00:00、08:00、16:00 UTC）；不要恰在结算那根 K 线上离场（X-07）。
- **看**：结算前后钱包与权益；Binance 导出的资金费流水；`compare.json` 或 `live compare` 的资金费。
- **通过**：Binance 流水逐笔与对照里按公布费率补算的方向、金额相等。Binance 实收不在证据包里，由用户把导出的流水交给后续会话核对。
- **不通过**：金额或方向不同：列为问题，查清前不放大资金。

### 步骤 6　空仓短断线，入场闸门关了再开

- **目的**：唯一能看到闸门"关闭后重开"的情形。
- **做法**：账户空仓、没有挂单；选工程用源码此刻**不可能出入场信号**的时间（断线窗口里碰上入场，按设计可能因 `LIVE_CONNECTION_UNVERIFIED` 结束运行，那是第 10 步的路径）。
  在某分钟第 5 秒左右，用户暂停这个运行自己的出口容器约 30 秒再恢复（`docker pause` / `docker unpause`；第 3 步设计文档用的办法），明显短于 60 秒，不跨分钟边界。
  `docker pause` 是否被识别为断线没有验证过【待确认】；不是则记下实际行为，这一步不算通过。
- **看**：`events.jsonl` 依次出现 `socket_state`、`entries_closed`（`disconnected`）、`entries_checking`、两条 `comparison`（读取相隔不少于 30 秒）、`entries_opened`；页面入场开关 `Closed · connection lost` → `Open`。
  重连后到下一根外部 1 分钟 K 线到达之前，每次 `comparison` 带 `found.bars` 且 `agreed` 为假，这是预期，最长到下一个分钟边界。
- **通过**：运行不结束，没有 `unresolved`，不发 Telegram；闸门重开。
- **不通过**：运行结束、`unresolved`，或闸门超过 10 分钟不开（`entries_held`）：停止标准第 1、6、8 条。

### 步骤 7　空仓缺一根 K 线后重新预热

- **目的**：行情流重连后不补发漏掉的收盘（探针已确认），缺根时空仓结束本次启动、由控制重启并重新预热。
- **做法**：账户空仓；同上断开约 2 分钟，跨过至少一个分钟边界后恢复。
- **看**：满 60 秒有 `connection_lost` 与 Telegram；恢复后 `entries_closed`（`bars_missing`）、两条 `comparison` 一致；`stopping`（`rewarming`）与 `rewarming`，退出码 3；`lifecycle.jsonl` 出现新的 `launch_requested`；
  `resuming`（`held` 为假）、`warmup`；入场开关回到 `Open`；Telegram 依次是缺根、重新预热、入场重开三条。
- **通过**：运行没有 `unresolved`；重启在 10 秒的维护周期加预热的时间内完成；这是一次设计内的重启，不算停止标准第 6 条。
- **不通过**：不重启，或重启后预热失败两次（`rewarming` 带 `retry` 之后再失败，运行结束）。每小时最多 4 次运行启动（首次加 3 次重启），之后控制记 `restart_limited`：连续做第 7、8 步时留意次数。

### 步骤 8　带持仓重启：保持并核实止损

- **目的**：重启后不交易、核实止损、撤继承来的入场单；页面与通知如实说止损是否齐全（#3052）。
- **谁做**：用户。**8a 带持仓**：持仓与止损在位时 `docker stop` 运行器容器（SIGTERM；不是 Live 页的 Stop）；也可再做一次 `docker kill`（同样重启，只是没有 `interrupted`）。
  **8b 带挂单**：账户无持仓，但有工程用源码的一张 GTD 进场单挂着，同样 `docker stop`。
- **看**：8a：`interrupted`（Telegram："closed no position and cancelled no stop"）；Binance 上仓位与止损不动；重启后 `resuming`（`held` 为真）、30 秒内 `held_covered`；
  页面入场开关 `Closed · inherited position`，提示"holds only positions that have their stop at Binance"，Telegram 同文；手机状态词 `Holding`。
  结束：用户在 Binance 上手动平仓并撤止损，30 秒内 `venue_flat_while_held`，该次启动退出码 3，下一次启动预热后交易。
  8b：`held_uncovered`（`entries` 为 1）与 `entry_cancel_requested`（`reason` 为 `held`），Binance 上该单被撤，随后账户全空：`venue_flat_while_held`。
  这条经"惰性原生策略"撤继承来的单，只在测试里用替身验证过，真实 Redis 缓存重载后能否撤掉【待确认】；撤不掉则 `entries_kept`，用户在 Binance 手动撤。
- **通过**：保持期间没有任何新订单；止损与仓位不动；核实的结论与 Binance 页面一致；账户空后下一次启动正常交易。
- **不通过**：出现 `held_uncovered` 且是持仓没有止损（`positions`），或 `unreadable`（应答读不懂）：用户立即在 Binance 上处理（平仓或补止损），停止标准第 2 条。保持期间产品不挂止损、不平仓、不跑刹车，所以这段时间要短。
  造一个"持仓没有止损"的 `held_uncovered` 需要用户先撤掉止损，不主动做，只在自然出现时看。

### 步骤 9　正常 `live stop`

- **目的**：`clean_stopped` 收尾。
- **谁做**：用户在 Live 页 Request stop（或 `live stop`）；一次在持仓时，一次在空仓时。
- **看**：`stopping`（`requested`）、`clean_stop`；`status` 的 `clean_stopped`、`exit_code` 0；Binance 全空；运行目录出现 `reports-<ns>/`。
- **通过**：持仓时先撤入场单、市价平仓、止损保留到平后撤掉；`status` `clean_stopped`，账户槽释放。`venue_flat` 不是 Stop 的结果，它只出自对账或第 13 步那类情形。
- **不通过**：平仓单被拒或结果不明，30 秒后 `unresolved`（`native_exit_timeout`）：走 README Unresolved Live runs。

### 步骤 10　入场被拒走 STOP 平仓路径；失败退出不被重启

- **目的**：一笔入场在派发时被拒，运行不再留仓位在交易所，而是走 STOP 路径平仓（#3022）；运行以失败结束后控制不再把它当中断拉起来（#3049）。
- **做法**：工程用源码先正常开一个仓位（止损在位），再下一张 GTD 进场单，到期取整在发出后 600 到 604 秒之间：它通过回放和订单规则，Live 发出前被拒
  （`LIVE_ORDER_UNSUPPORTED`，发出时不足 605 秒）。
- **看**：`entry_refused`、`stopping`（`entry_admission_failed`）；Binance 上该仓位被市价平掉、止损撤掉；运行器以退出码 1 结束，`status` 为 `unresolved`（账户已空但失败的运行要 Reconcile，
  README Unresolved Live runs 末句）；Telegram 发 `UNRESOLVED`。用户确认 Binance 全空后在 Live 页 Reconcile account：`venue_flat`，槽释放。
  之后至少等几个控制维护周期（每 10 秒一次）：`lifecycle.jsonl` 没有新的 `launch_requested`，没有"starts again"类通知。
- **通过**：仓位在交易所上被平掉且没有残留；没有新的运行器被拉起；Reconcile 得 `venue_flat`。
- **不通过**：平仓被拒或 `native_exit_timeout`（真正的 `unresolved`，仓位还在）：停止标准第 1 条；运行又被拉起：停止标准第 6 条。
  这一步在 Binance 上的市价平仓成交、止损撤销与最终账户读取，#3022 的 PR 写明没在真实交易所验证过。

### 步骤 11　回撤刹车

- **目的**：刹车读到的权益与 Binance 页面一致；触发后平仓、停止、不重启、不算失败。
- **做法**：单独一个运行，页面上把 Drawdown brake 设得很紧（用户按预检读到的手续费率与工程用源码的名义，算到一次开平仓的手续费量级）。
  能否稳定触发取决于行情与手续费，不保证【待确认】；触发不到，这一步留作观察项，不放宽别的检查。
- **看**：`equity_peak`、`drawdown_brake`（`equity`、`peak`、`drawdown`）、运行目录的 `brake-account-*.json`；`stopping`（`drawdown`）；Telegram 的刹车消息；Binance 页面的钱包与未实现盈亏。
- **通过**：`status` `clean_stopped`、退出码 0，运行不再被启动；`brake-account-*.json` 的权益与 Binance 页面在同一时刻相符。
- **不通过**：读数与 Binance 页面不符（列为问题）；有持仓而 60 秒读不到权益时刹车无法执行，按触发处理并判失败（`drawdown_unverified`）。

### 步骤 12　有仓位时断线不少于 60 秒（按设计停机）

- **目的**：确认这条失败路径的结局。只在用户明确要验证时做，放在靠后。
- **做法**：持仓与止损在位，暂停出口容器约 90 秒，之后恢复。
- **看**：先到的是 `mark_missing`（60 秒没有该合约标记价）或 `drawdown_unverified`（60 秒没有权益读数），运行判失败、走 STOP 路径。网络没恢复时平仓发不出去，开始后 30 秒记 `unresolved`（`native_exit_timeout`），交易所上的止损不动；
  网络在这 30 秒内恢复则平仓发出，运行空仓、退出码 1 结束，`status` `unresolved`，需 Reconcile。两种结局都符合设计，记下是哪一种【待确认：哪个先触发】。
- **通过**：与上相符，且最终账户状态由用户在 Binance 页面确认。
- **不通过**：运行在持仓下继续交易而不顾 60 秒规则。预期的 `unresolved` 按停止标准第 1 条的处置收尾（见第 4 节豁免）。

### 步骤 13　受控手动平仓（最后做）

- **目的**：看外部平仓后本地缓存里的仓位与交易所对不上时产品的反应（#3058）；真实读数是 20261114-25 剩下的 measure 一半。只在用户明确要做时做，做完本次验收结束。
- **谁做**：用户，在 Binance 页面手动平掉持仓（真实交易）。
- **A　平仓并撤掉该仓位的止损，账户全空**。预期：周期比对（每 5 分钟）两次间隔不少于 30 秒都发现"交易所全空而缓存仍有仓位"，记 `venue_flat`（`native_positions` 为真），不发任何订单，退出码 0，
  槽释放；其间若源码出入场，入场自己的账户读取对比不一致，重读一次，第二次仍不一致则 `LIVE_CONNECTION_UNVERIFIED`，同样以 `venue_flat` 收尾。
- **B　只平仓，止损留在 Binance**。预期：不放新入场；STOP 路径仍按缓存平仓，平一个 Binance 已没有的仓位被拒，运行以 `unresolved` 结束（README 写明的"只做第一条规则"的情形）。
  处置：用户停止、在 Binance 撤掉残留条件单、Reconcile 到 `venue_flat`。
- **看**：`comparison` 何时不一致、`entry_reread`、`venue_flat` 或 `unresolved` 的时间；Binance 上有没有留下没人管的条件单；残留止损会不会打在之后的新仓位上。
- **建议**：A、B 各做一次，B 放在整个验收最后。A、B 的预期来自假交易所上的回环与 #3058 的测试，时间估计（几分钟）也是推算【待确认】。

### 步骤 14　`live compare` 与每日对照

- **目的**：Live 的决策、成交、手续费、资金费与同窗口回放对得上。
- **做法**：控制每天自动对照：每小时从 00:30 UTC 起，只在有运行还有一天没对照时启动对照容器（2 GiB，一个 CPU），结果是 `runs/<run>/compare.json`（`live-continuous-step7b-daily-compare-20261113.zh.md`）。
  一次性的 `live compare`（`--root`、`--run-id`、`--market-day`、`--output`、`--segment`、`--from`、`--to`）的主机运行方式在 README 里没有给出，用户按需决定【待确认】。
- **看**：`state`（`done`）、`summary`（`groups`、`same`、`differs`、`run_only`、`replay_only`、`look_ahead_suspects`、各类 bar 差）、`unexplained`、`measures`（`adverse_slippage_bps`、`fees`、`entries_unfilled`、`partial_fills`）。已知原因依次是
  `missing_bar`、`late_bar`、`bar_mismatch`、`metrics`、`warmup`、`contract_terms`、`window_end`、`entry_gate`（`replay/comparison.py` `CAUSES`）；多次启动的运行按启动分段对照。
- **通过**：见第 5 节。
- **不通过**：`unexplained` 非空或 `look_ahead_suspects` 非零：列为问题，查清前不放大资金。

### 步骤 15　备份与恢复（不下单）

- **做法**：用户按 `deploy/remote/README.md` 打包 Live 根，移走后在原路径恢复，再 `live status` 每个运行。恢复要停发布定时器，属主机操作，由用户做。
- **通过**：恢复前后每个运行的 `status` 一致；未解决的运行仍占着槽。

### 3.1 不制造、只在发生时看

在长跑中看到才算；没看到就是"没验证"，不算通过：运行跨过 23 小时后空仓换连接（`connection_renewed`，分钟的第 20 到 40 秒）；合约状态变化（`contract_status`）或交易所维护期间的 `socket_state`、`bars_missing`；
429 与 418、响应头里的已用权重（20261114-29）；每天 00:00:05 UTC 前后日线的送达时刻（20261114-30）；`evidence/market.jsonl` 里同一 `ts_event` 出现两行（T-15）；强平与 ADL（制造不了）；
`held_uncovered` 里持仓没有止损；保持期间继承来的挂单撤不掉（`entries_kept`）。

## 4. 停止标准（建议，启动前写死，触发即执行，不临场商量）

下表的动作全部由用户执行。整个验收期间要有人在几分钟内能看到通知并操作 Binance（`engine/README.md` Unresolved Live runs）。相对审计 D.5 的修订：第 1、6 条按 #3049、#3022 的现行为改写；第 8、9 条是新增【待确认】。

| # | 触发条件 | 动作 |
|---|---|---|
| 1 | `status` 出现 `unresolved`，或 Telegram 收到 UNRESOLVED | 按 README Unresolved Live runs 三步：停止、在 Binance 平仓并撤掉全部挂单与条件单、Reconcile 到 `venue_flat`；验收到此结束 |
| 2 | Binance 上有仓位而没有对应的止损超过 90 秒；或保持期间的 `held_uncovered` 说持仓没有止损 | 同第 1 条；保持期间立即在 Binance 上处理 |
| 3 | 本地与交易所的仓位或挂单不一致超过一个比对周期（300 秒） | 用户在 Live 页 Stop；到不了 `clean_stopped` 就走第 1 条 |
| 4 | 钱包相对验收起始资金的亏损达到用户事先填的比例（不高于刹车比例） | 用户在 Live 页 Stop |
| 5 | 出现不在预期清单里的拒单原因，或同一原因重复出现 | 用户在 Live 页 Stop，保留证据 |
| 6 | 收到中断或重新启动的通知，而此前没有用户自己的操作（停容器、受控断线）、主机重启或发布，也不是缺根后的 `rewarming`；或收到 `restart_limited`；或失败退出的运行又被拉起 | 用户在 Live 页 Stop，在 Binance 上核对仓位与挂单 |
| 7 | 验收期间有人在同一账户上手动交易（第 13 步除外） | 验收作废，由用户决定是否重来 |
| 8 | 入场闸门关闭超过 10 分钟（`entries_held`）；或 `orphan_orders` 通知 | 用户在 Binance 上核对；`orphan_orders` 是空仓后残留的只减仓单，不需要的由用户撤 |
| 9 | `key_check_failed` 通知 | 用户在 Binance 上修好密钥（提现关闭、IP 限制），否则 Stop |

**受控试验的豁免**（只在用户事先声明"现在做这一步"的时段内；声明之外或出现预期之外的情况，各条照常）：

- 第 10 步：第 1 条不按上表执行，预期 `status` 为 `unresolved`（账户已空、失败退出），按步骤 10 的处置收尾；若账户没空，第 1 条照常。
- 第 12 步：第 1 条（预期 `unresolved` 或失败退出）与第 3 条不按上表执行；其余照常。
- 第 13 步：第 2、3、7 条不按上表执行，照该步的预期观察并记录；预期 B 以 `unresolved` 结束，按第 1 条的处置收尾，验收到此结束。
- 第 7、8 步：第 6 条对"自己的操作引起的中断与 `rewarming`"不适用；第 8 步的 `held_uncovered` 仍适用第 2 条。

## 5. 允许的偏差与要收集的证据

### 5.1 与同窗口回放、Paper 对账

下面的数值是建议，阈值本身是用户的决定【待确认】（产品把表现类阈值留给用户）：

| 项 | 建议的允许偏差 | 超出时 |
|---|---|---|
| 决策 | Live 与回放的进场、离场决策一一对应；不对应的只许归到已定义的原因（5.2 的 `CAUSES`），不许 `unexplained` | 列为问题，查清前不放大资金 |
| 成交价 | 进场限价单不劣于限价；止损与触发价的差逐笔记录并解释，不设上限 | 记录 |
| 手续费 | 按预检读到的费率重算后逐笔相等 | 列为问题 |
| 资金费 | 与 Binance 导出的流水逐笔相等 | 列为问题 |
| 仓位与挂单 | 运行中任何时刻本地与交易所一致；不一致不超过一个比对周期；保持期间产品不比对，由用户在 Binance 页面看 | 触发停止标准第 3 条 |
| 日线送达 | 距 UTC 日界不超过 10 秒（`20261114-30`） | 列为问题 |
| 权益路径 | 每分钟差记录，不设上限；Paper 与回放取值时刻不同，成交分钟的差最多约几十 USDT 已有先例（`run-reconcile-20261112.zh.md`） | 记录 |

### 5.2 要收集的证据（用户从 Live 私有目录和 Binance 取出，交给后续会话；Agent 不到主机上取，不打开存放凭证的位置）

- 每个运行的证据包（`engine/README.md` Evidence pack）：`evidence/market.jsonl`、`reports-<ns>/`（`orders.csv`、`fills.csv`、`positions.csv`、`account.csv`、`order_events.jsonl.gz`）、
  `preflight-*.json`、`connected-account-*.json`；以及 `entry-account-*.json`、`brake-account-*.json`、`final-account-*.json`。
- `events.jsonl`、运行器日志、`lifecycle.jsonl`；Telegram 通知及其到达时间；`compare.json` 与 `live compare` 的输出。
- 用户从 Binance 导出的同时段订单历史、成交历史、资金费流水、强平与 ADL 记录。**这些含账户信息，留在 Live 私有目录，不进账本、DoltHub 和 Git。**
- 主机侧：时钟同步记录、容器重启记录、验收期间的发布记录。

## 6. 验收之后

### 6.1 通过的含义与逐步放大（建议）

通过 = 第 3 节每一步要么通过，要么明确写成"留作观察项"并说明原因，且没有触发停止标准而未处置。验收只证明执行链，不证明策略收益（审计 D.3）。放大的建议：

1. 先用第 2 段的真实候选，同样的资金跑满至少 14 天，`compare.json` 没有 `unexplained`；
2. 再逐档放大钱包（建议每档至多 2 倍，每档至少 14 天且没触发停止标准）；
3. 首次试验的 100 USDT 现金底线上限（`LIVE_BUDGET`）是代码里的拒绝检查，放宽它改的是拒绝检查，要用户授权（`AGENTS.md`），不随验收通过自动放开。

### 6.2 等验收读数才能定的审计发现

20261114-25（measure：第 13 步与重启类读数，之后才轮到"同一运行换新原生身份继续交易"等 authority）、20261114-29（权重与失败率）、20261114-30（日线送达）；
待证实表里：M-02 与 L-25（`availableBalance` 口径）、O-04、O-08、M-11、L-05、T-02、T-08、T-10、T-15、X-07。20261114-22、-23、-24、-28 在这份验收里验证它们在真实交易所上的一半；
20261114-32 与验收无关，仍由用户处置。

### 6.3 验收记录

执行记录（运行 ID、余额、订单号、导出文件）只留在 Live 私有目录，不进 Git、账本或 DoltHub。仓库里只留一份公开的验收记录，建议新文件
`docs/plans/live-acceptance-record-<日期>.zh.md`【待确认记在哪里】，写：版本与提交、执行镜像与回放镜像摘要、第 3 节每一步的结果（通过、不通过、未观察到）与 UTC 时间、
触发过的停止标准、每个偏差的解释、对索引行的影响。不写账户标识、余额、订单号、主机地址、域名；金额只写相对量。Agent 只根据用户交来的记录写它。

## 7. 取代了旧版的什么

这份文档取代旧版 `live-acceptance.zh.md` 的全部内容：

- **离线部分**（账户槽探针、新增检查的正反例、旧镜像拒绝当前格式的镜像表）：引用的探针脚本与测试已不存在或已随代码变化，不再引用；进程内与回环证据改看第 2 节。
- **真实账户的五轮方案**：按每次运行的预算与单笔上限、亏损限制、改写后的源码、"断线后以 `unresolved` 结束"、声明文件等设计写成，这些已不存在。
  现行的对应关系：亏损上限由 15% 回撤刹车取代（第 11 步）；断线不再使运行结束，入场关闭、持仓照常管理（第 6、7、12 步）；候选、合约、杠杆在 Live 页选（1.3）；
  备份恢复一轮并入第 15 步；保护单缺失、手动处理一轮的结局随 #3022、#3049、#3052、#3058 改变（第 8、10、13 步）。
- **"第一版算完成"的判据**：改为第 6.1 节的通过含义。

### 待确认条目（标了【待确认】的位置，用户确认后改成事实或删掉）

1. 1.1：在途的两处修改合并并发版后，第 8、12 步与页面文字按届时 README。
2. 3.0：工程用源码是否登记进活动账本。
3. 步骤 6：`docker pause` 出口容器是否被识别为断线。
4. 步骤 8b：经惰性原生策略撤继承来的入场单，在真实 Redis 缓存重载后能否撤掉。
5. 步骤 11：紧刹车能否稳定触发。
6. 步骤 12：哪条 60 秒规则先触发。
7. 步骤 13：A、B 两条的预期与时间估计。
8. 步骤 14：一次性 `live compare` 的主机运行方式。
9. 第 4 节：新增的第 8、9 条停止标准。
10. 5.1：偏差阈值。
11. 6.3：公开验收记录放哪里。
