# Live 第一版验收（第 10 步）

[发布计划](live-release.zh.md)的第 10 步。离线部分已经做完，真实账户部分是下面五轮的方案，每一轮都要用户单独给范围才开始。
执行记录（运行 ID、余额、成交、快照）只留在服务器的 Live 私有目录，不进 Git、账本或 DoltHub；这里只记每轮通过与否和原因。

## 离线部分（2026-11-07 已完成）

- **账户槽探针。** 审计用的探针脚本已经不在了。它测的卡死路径（`start` 被拒后 `reconcile`、重跑和新运行都被拒）由
  #2271 的测试覆盖：`test_runner_refused_before_arming_releases_the_slot_for_a_new_run` 和
  `test_a_new_run_releases_a_slot_left_by_an_unarmed_run`，当时还做了变异检查。断线后手动平仓的卡死由第 8 步的探针发现，
  #2420 修复并有测试。
- **新增检查都有正反例。** 保护单（`test_accepted_stop_for_the_whole_position_keeps_the_run_going`、
  `test_position_without_a_stop_is_closed_natively_after_the_allowance`）、亏损限制（`tests/engine/test_live_entry.py`
  的 `max_loss` 和 `loss_unverified` 用例）、key 权限（`tests/live/test_key.py`）、时钟（`tests/engine/test_live_venue.py`
  两例和 `tests/engine/test_live.py` 两例）、格式（`test_runner_refuses_any_other_manifest_format`、
  `test_a_run_prepared_before_a_format_change_can_only_reconcile`）、确认参数（`tests/live/test_runs.py` 的
  `--confirm-real-orders` 用例）、交易所空仓释放（#2420 的用例）。
- **旧镜像拒绝当前格式，用真实镜像跑过。** 本机 Docker，容器断网，占位 manifest 和占位凭据，没有连交易所：

  | 镜像 | v4 manifest | v5 manifest |
  |---|---|---|
  | `trade-runtime@sha256:5081f2f4…`（第 4 步起的 v4 镜像） | 通过格式检查，停在 `LIVE_ACCOUNT_BINDING` | `LIVE_MANIFEST_INVALID` |
  | `trade-runtime@sha256:6fb553c7…`（`a61e3004a`，v5） | `LIVE_MANIFEST_INVALID` | 通过格式检查，停在 `LIVE_ACCOUNT_BINDING` |

  `LIVE_ACCOUNT_BINDING` 是占位凭据和 manifest 不匹配，说明格式已被接受，作为对照。

## 真实账户部分

### 共同条件

- **在哪里跑。** 在服务器上新建一个 Live 根目录，只照 `deploy/remote/README.md` 的 Live on this host 和
  Backing up the Live root 操作，不用试验时的脚本。这样同时完成“按文档在新准备的主机上走通”这一项；如果要求换一台新主机，
  需要另租服务器，由用户决定。
- **镜像。** `python3 -m deploy.images` 给出的已准入镜像，`--runtime` 传摘要。runtime 至少是 `6fb553c7…`（v5）。
- **账户。** 沿用已有的双向、多资产、全仓、关闭自动追加保证金的设置，不改账户设置。每轮开始前账户全空：没有持仓、挂单和条件单。
- **金额。** 每轮 `--budget-usdt` 不超过 100，`--max-notional-per-order` 不超过预算。预计每轮手续费和滑点在 0.1 USDT 量级；
  断线那一轮的亏损不受亏损限制约束，只靠止损保护。
- **全程有人看着 `live status`。** 第一版没有推送。
- **每轮结束后** 备份一次 Live 根目录（文档里的命令），确认 `status` 不再占槽，再开始下一轮。

### 第 1 轮：自然信号的完整交易

- 源码：一个研究候选的 Live 改写版，按 `strategy-authoring.md` 的 Live adaptation 改写，**信号逻辑不动**。和候选源码的差异只能在
  分配（`__new__`）、入场提交、保护单提交和 `on_stop`。启动前把差异给用户看。
- 参数：时长按候选的信号频率定，不超过 24 小时；`--max-loss-usdt` 大于止损亏损加滑点。
- 通过：信号自然出现并入场，90 秒内挂上覆盖全仓的止损，按止损、止盈或时限离场，`status` 为 `clean_stopped`，账户槽释放，
  账户全空。
- 时限内没有出现信号不算失败，也不算通过，换时段或候选再跑。

### 第 2 轮：保护单缺失

- 源码：测试版本，开始后用接近盘口的 LIMIT 入场，成交后**不挂止损**。
- 通过：成交后约 90 秒记 `protection_missing`，原生平仓，账户全空。这一轮被判失败（退出码 1），所以不释放账户槽；
  按 Unresolved Live runs 第 3 步运行 `live reconcile`，`status` 变成 `venue_flat`，账户槽释放。

### 第 3 轮：亏损限制

- 源码：测试版本，入场后正常挂止损。`--max-loss-usdt` 设得很小（例如 0.01 USDT），手续费就会触发它。
- 通过：记 `max_loss`，`stop_reason` 为 `max_loss`，原生平仓并撤掉止损，`status` 为 `clean_stopped`（不算失败），账户槽释放。

### 第 4 轮：断线后手动处理

- 源码：同第 3 轮，但亏损限制正常设置。入场并挂上止损后，停掉这一轮自己的 egress 容器（`docker stop --time 5`），
  runner 断线后以 `unresolved` 结束，仓位和止损留在交易所。停掉 egress 是否会被识别为断线没有离线验证过；
  如果 runner 没有这样结束，记下实际行为，这一轮不算通过。
- 用户在 Binance 上手动平仓并撤掉止损，然后按 Unresolved Live runs 运行 `live reconcile`。
- 通过：`status` 变成 `venue_flat`，账户槽释放，账户全空。也检查 `status` 在 `unresolved` 时带着处理步骤的提示。
- 手动平仓是真实交易，只能由用户自己做。

### 第 5 轮：备份恢复

- 不下单。第 4 轮结束后，按文档把 Live 根目录打包，移走后在原路径恢复，再看每一轮的 `status` 和恢复前一致。

## 每轮需要用户给的范围

每一轮开始前，用户要明确同意：

- 使用哪个凭据文件（只在服务器上，权限 0600）；
- 在真实账户上下单，预算和单笔上限的数值；
- 用哪份源码（候选改写版或测试版本），以及时长；
- 第 4 轮另外同意停掉这一轮的 egress 容器；
- 登录服务器执行这些命令（只读登录的授权只用过一次）。

这一节说明需要什么范围，不代替范围本身。Claude 不能启动真实的一轮：由用户本人，或者用户授权的会话按上面的命令执行。

## 第一版算完成

离线三项和第 1–5 轮全部通过。之后进入第 11 步：更新 README、`engine/README.md`、`deploy/remote/README.md`、设计站，
以及 `AGENTS.md` 里“唯一授权的实时连接是 paper”那句已过期的话。
