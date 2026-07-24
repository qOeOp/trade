# Forward Evidence Contracts

Owns admission and result contracts for post-freeze evidence sessions，以及对 exact gapless candle-segment chain 的 content-addressed OHLCV-only Dataset Candidate。`Forward Dataset Readiness Assessment v1` 保留原始全阻断分类；v2 可引用独立的 `Forward Funding Evidence Binding v1`，只在 exact owner demand、raw-page audit、v2 fact 与 Replay slice 全部闭合时移除 funding blocker。Funding 窗口固定为 `[first_open, data_watermark + 1ms)`，保留末根 K 线收盘时刻的结算事件。它仍要求新的 post-freeze decision，禁止把历史 signal/order 当成 Forward 决策。Candidate、binding 与 assessment 均不授予 Forward Replay admission；调用方仍须闭合其余数据组件与正式 Dataset Manifest authority。

Forward admission requires a ready Draft Strategy binding、an immutable certified-source binding admitted by the Research owner、a Control Plane reservation、a strict freeze timestamp、a data watermark and a Replay request bound to the same Candidate and policy hash. The source binding joins the exact Registry candidate、Ops certification manifest、candidate commit and archive while explicitly carrying no deployment、promotion or trading authority.

A caller-supplied Draft alone is insufficient. `ForwardAdmissionRequest v3` rejects Draft/source/hash/revision drift before Replay.
