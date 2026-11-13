# Live 连续运行第 5 步：回撤刹车、现金底线、时钟和密钥检查（2026-11-13）

依据：`live-continuous-operation-design-20261110.zh.md` §3.5、§3.9（用户 2026-11-10 逐条决定"按推荐的设"并"全部授权"：以从最高权益回撤 15% 的刹车取代每次运行的 `max_loss_usdt`；底线预算 = 钱包 × 85%；连续运行要求密钥 IP 白名单）。实现在 `engine/live_brake.py`。

## 做了什么

- **回撤刹车**：运行中每 15 秒用 REST 读账户，权益 = USDT 钱包 + 未实现盈亏（手续费、资金费都已在钱包里）。最高权益从第一次 armed 时的权益起算，每创新高记一条 `equity_peak`，重启后从记录里接着算。权益比最高权益低到刹车比例（默认 15%，运行可以设得更紧，不能更松）就走 STOP 路径平仓、停止（`stop_reason` `drawdown`，不算失败），之后不自动重启；把那次账户读数写成 `brake-account-*.json`。
- 有持仓时 60 秒读不到权益：刹车无法执行，按触发处理并标记失败（`drawdown_unverified`）；有持仓 60 秒没有标记价格仍停止（`mark_missing`，沿用 §3.2.4）。单次读失败只算这次没读到。
- **现金底线**：预算不再是声明值，而是第一次 armed 时 USDT 钱包 × 85%（向下取到分），重启沿用。每次入场仍要求钱包和可用余额都不低于它。
- **时钟**：每次入场读账户时同时读交易所时间，超限以 `LIVE_CLOCK` 拒绝这一笔（入场被拒仍结束运行；2026-11-13 起改为只原生拒绝这一笔，运行继续，见总设计 §5 "§3.9 三项检查"）；每次连接比对也查时钟，超限关闭入场，恢复后两次一致再开。
- **密钥**：不设时长的运行要求密钥有 IP 限制（`LIVE_KEY_IP_UNRESTRICTED`；2026-11-13 起每个运行都要求，见总设计 §5）。运行中配对的 control 每小时读一次密钥权限；失败（可提现、IP 限制被去掉、读不到）记 `key_check_failed` 并发 Telegram，运行继续（停止会平仓）；恢复后记一次 `key_check_passed`。
- **页面**：启动页"预算"变成灰显的"Cash floor = Wallet × 85 %"；"亏损上限"变成可编辑的"Drawdown brake"（百分比，最多 15）；"Duration"变成可空的"Stop after"（空 = 一直跑到停止）。手机端的亏损条改成"距最高权益的回撤 / 刹车允许的回撤"。运行视图新增 `brake`（起始权益、最高权益、触发）和 `key_checks`。
- 清单格式 `live-run-4`，web 协议 6。

## 需要知道

- **首次试运行 100 USDT 上限保留**：现金底线超过 100 USDT（钱包超过约 117.6 USDT）仍以 `LIVE_BUDGET` 拒绝。去掉它是放宽，未在授权范围内。
- **发版要改主机声明**：Live 声明的 `defaults` 只剩 `duration_seconds`（整数或 `null`）和 `leverage`；发版前在没有运行占着账户时替换（`deploy/remote/README.md`）。之前准备的运行在新版本下以 `LIVE_RUN_FORMAT` 拒绝。
- 权益只算 USDT 资产，其它抵押资产不折算（与入场规则一致）。

## 验证

- 单元测试：`tests/engine/test_live_brake.py`（底线、重启沿用最高权益、更紧的刹车、每 15 秒读一次与 60 秒未读、入场和比对读时钟）、`test_live_entry.py`（真实原生订单：刹车触发后原生平仓、不算失败；最高权益与费用）、`test_live_venue.py`、`tests/live/test_key.py`（IP 限制）、`test_runs.py`（每小时检查与只记一次）、`test_views.py`、`test_notify.py`、`test_protocol.py`（协议 6 基线）；网页 `npm test`、`tsc`、`check-rules`。
- 没有验证：真实账户上的 REST 权益读数与 Binance 页面是否一致；刹车真实触发。
