# Agent Roles

RD 可替换角色入口，包含 `planner/`、`developer/` 与 `reviewer/`。角色只构造 Proposal、Trial-bound Replay Request 或 Review Decision submission；不独立持有 Contract、Trial、Result、Review 或 Lifecycle 事实。

旧的 hypothesis、candidate、family、signal、campaign、summary package 已按主要责任迁入三个角色目录，当前仍是 migration source，不因此取得 Contract/Result/Lifecycle 写权限。角色层只锁边界和最小 typed entry，不固定 agent 数量、tool 组合、prompt、内部推理流程或部署形态。
