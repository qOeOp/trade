# Forward Evidence Plane

candidate freeze 后随新数据到达形成 paper/forward evidence 的前瞻证据面。当前已实现：

```text
contracts/  ready Draft、freeze、watermark、Reservation 与 Forward Result 合同
runner/     no-backfill admission、增量窗口与 Replay simulator 复用
compatibility/ 仅保留尚未切换的 J05 tracker job shell
```

本 Plane 不等于正式 Shadow 或 Live Execution，不写 Review Decision，不修改 Draft Strategy。旧 `forward-holdout` 只是 post-freeze signal diagnostic，现由 `agent-roles/reviewer/signal-evaluator` 提供兼容入口；它不是本 Plane 的权威协议。
