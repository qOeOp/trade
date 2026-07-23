---
title: macOS No-Live Release Staging 2026-07-23
role: historical-verification
status: completed-historical
owner: orchestration-ops
last_verified: 2026-07-23 CST
---

# macOS No-Live Release Staging 2026-07-23

## 结论

提交 `3d93af32e16d` 已在非受保护用户目录生成隔离 release candidate。它绑定 committed HEAD、`bun.lock`、两个 Rust binary hash 和空 runtime roots；未安装 launchd、未启动进程、未复制 owner 数据、未开放 live write。

## 证据

| 检查 | 结果 |
| --- | --- |
| archive runtime-state scrub | 清除 12 个历史 `data/**/*.db*`；成品复核为 0 |
| release size | 92 MiB |
| staged preflight | ready，0 blocked checks |
| process authority render | launchd，3 agents |
| macOS plist lint | 3/3 OK |
| safety | domain jobs off、live writes off、notification dry-run |

首个 staging candidate 在复核时发现 archive 带入历史 SQLite WAL/SHM，因此未安装、未启动，并被移动到 Trash 作为可恢复的无效副本；随后加入全 archive runtime-state scrub 并重新生成本 candidate。

本记录只证明 staging 闭包，不证明 Bun-native foreground smoke、launchd bootstrap、restart isolation、长时 soak、真实 volume restore、模型 provider 或实盘能力。当前最大 authority 仍为 `no_live_local_rehearsal`。
