# Forward Evidence Plane

candidate freeze 后随新数据到达形成 paper/forward evidence 的前瞻证据面。当前已实现：

```text
contracts/  ready Draft、freeze、watermark、Reservation 与 Forward Result 合同
runner/     no-backfill admission、增量窗口与 Replay simulator 复用
paper-tracker/ J05 paper setup event chain、artifact 与 catalog publication
```

本 Plane 不等于正式 Shadow 或 Live Execution，不写 Review Decision，不修改 Draft Strategy。`paper-tracker` 产出 review input，不得被解释成 formal Shadow 或 promotion evidence；旧 `forward-holdout` 只是 signal diagnostic，现由 `agent-roles/reviewer/signal-evaluator` 提供兼容入口。
