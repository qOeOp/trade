# Forward Evidence Plane

candidate freeze 后随新数据到达形成 paper/forward evidence 的前瞻证据面。当前已实现：

```text
contracts/  ready Draft、freeze、watermark、Reservation 与 Forward Result 合同
runner/     no-backfill admission、增量窗口与 Replay simulator 复用
compatibility/ 迁入的 forward-holdout 与 J05 tracker，仅保留诊断/job-shell 兼容
```

本 Plane 不等于正式 Shadow 或 Live Execution，不写 Review Decision，不修改 Draft Strategy。旧 forward-holdout 与 tracker 已迁入 `compatibility/`，不能代表本 Plane 的权威协议。
