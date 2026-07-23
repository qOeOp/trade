# Forward Evidence Plane

candidate freeze 后随新数据到达形成 paper/forward evidence 的前瞻证据面。当前已实现：

```text
contracts/  certified source、OHLCV Dataset Candidate、Forward admission/result 合同
runner/     owner slice chain materialization、no-backfill admission 与 Replay simulator 复用
paper-tracker/ J05 paper setup event chain、artifact 与 catalog publication
```

本 Plane 不等于正式 Shadow 或 Live Execution，不写 Review Decision，不修改 Draft Strategy。只有 Registry candidate 经隔离 Ops adoption、离线质量与 Replay release audit 后，Research owner 才能写不可变 source admission并开始收集 Forward evidence。Dataset materializer 逐一复核 Market Data owner manifest/CSV/hash，拼成严格闭合的 Replay bar grid并发布内容寻址的 OHLCV-only candidate；无网络 resident 按观测跨度节流并让 Research owner 重放 Program/完整 segment prefix 后做 append-only 登记，超出有界内存只报告 pending、绝不截断。Readiness classifier 读取历史 registered Request/Manifest，只继承数据需求类型，不复用历史 signal/order；funding、fresh status/spec/risk、新 decision 与正式 Manifest 始终 pending，mark/supplemental 按历史 profile 条件 pending。全部闭合前仍无 Forward admission authority。`paper-tracker` 产出 review input，不得被解释成 formal Shadow 或 promotion evidence；旧 `forward-holdout` 只是 signal diagnostic，现由 `agent-roles/reviewer/signal-evaluator` 提供兼容入口。
