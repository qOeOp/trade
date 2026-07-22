# Planner

Researcher / Planner 角色入口。当前 typed 入口只消费 Control Plane 自哈希 planning context，并生成绑定该 `context_hash` 的 bounded Proposal submission；迁入的 `strategy-hypothesis-designer/` 仍是待适配 migration source。Contract 物化、Trial、队列与状态写入仍由 Research Control Plane 完成。
