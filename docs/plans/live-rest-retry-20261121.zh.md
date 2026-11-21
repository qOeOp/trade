# Live 只读 REST 读取的有界重试（2026-11-21）

上接 [0.5.0 全量重判](rejudge-0.5-20261121.zh.md) C-141 与 doctor 索引 20261114-29。

## 决定

- 2026-11-21，用户委托：「需要我定的部份最后也是一样由你决定按推荐做」。C-141 判“做（委托决定）”：加重试等于放宽 `LIVE_ACCOUNT_UNAVAILABLE` 的触发，属于改拒绝检查，按推荐做。
- 产品自己的只读客户端（`engine/live_venue.py` `BinanceReadOnly.get`）对会过去的失败重读，一个请求最多发 3 次：
  - 429：按 Binance 给的 `Retry-After` 秒数等，没给就等 1 秒；`Retry-After` 超过 5 秒则不等，立即拒绝。
  - 5xx、连接断开、超时：第 1 次失败后等 1 秒，第 2 次后等 2 秒。
  - 418（IP 已被封）与其他 4xx：立即拒绝，不重发。Binance 对封禁后仍在发请求的 IP 延长封禁（USDⓈ-M 总则 “Limits”）。
  - 三次都失败仍是 `LIVE_ACCOUNT_UNAVAILABLE`，拒绝码不变；签名读取每次重发都重新取时间戳并重新签名。
- 不需要先在真实账户量权重：重试只在失败时多发，最多 2 次，429 时按交易所要求的时间等，不会比现在更容易被封。权重读数仍在 C-139（用户启动的真实账户试运行）。

## 没有做的一半

下单侧的 `SubmissionRecoveryPolicy.RETAIN_UNRESOLVED`（钉住的 rc7 有这个配置，`LiveExecutionEngineConfig(submission_recovery_policy=...)`）这次没有启用。启用后，结果不明的下单一直留在 `SUBMITTED`，原生代码不再逐单查询，只等交易所事件或报告来解决；产品的比对把 `SUBMITTED` 当在途（`engine/live_connection.py` `IN_FLIGHT`），停止流程也要撤它。如果单从没到交易所，它会一直不解决，入场一直关、停止可能等不完。这只有在假交易所回环上才能证明（审计的回环夹具已丢，重建是 C-158），所以等 C-158 的回环夹具落地后再按同一委托做，验收用回环的 `s5_*` 情形。撤单一侧 rc7 没有对应配置，仍按 C-139 与 D-155 处理。
