---
title: macOS No-Live Host Adoption 2026-07-23
role: historical-verification
status: completed-historical
owner: orchestration-ops
last_verified: 2026-07-23 CST
---

# macOS No-Live Host Adoption 2026-07-23

## 结论

提交 `a2089f8197d3` 的 immutable release 已在 macOS per-user launchd 上常驻运行 no-live shadow profile。L2 owner、resident consumer 与 control runtime 三个固定 label 均 active；聚合 readiness 为 ready，owner/consumer 同 epoch，parity `9/9 match`。本次没有接管既有 `50061` 服务、没有调用真实模型、没有发送 exchange command，也没有开放 live write 或自动 promotion。

## 采用证据

| 门 | 实际结果 |
| --- | --- |
| release | committed archive；历史 `data/**/*.db*` 清零；lock、依赖与两个 Rust binary hash 闭包 |
| launchd | 三个 plist hash 与 release manifest 一致；只管理固定 label；隔离监听 `127.0.0.1:51061` |
| foreground/readiness | Bun-native owner、consumer、control 启动通过；owner/consumer 同 epoch；lease active |
| restart isolation | 只重启 consumer；owner epoch 不变；consumer 重建同 epoch baseline；无旧 worker orphan |
| public/full shadow | public 跨周期 parity 无 mismatch；full shadow 两轮各 7 jobs：2 completed、5 gated skip、0 failed/blocked；无 duplicate/live command |
| backup/restore | 运行中 3 个 SQLite online backup；finalized raw、profile、release manifest 共 6 项闭包；隔离恢复 3/3 integrity、6/6 hash/ref |
| Operator HTTP | loopback resident；真实 DB 4 条 accepted/completed audit；API/approval token 重启轮换与旧 token 撤销通过；未调用 controlled owner |

首个 launchd candidate 暴露 Bun `PATH` 不完整，manager 按本次安装集合反向卸载；修复为 Bun 所在目录加系统固定 allowlist 后重新 staging/install。无效与被拒 release 已移入 Trash，可恢复但不再具备 adoption authority。

## 未完成门

release gate 的剩余项只有真实模型 provider capability/cost smoke 与 R&D worker kill/restart 后单一 Trial/Result 闭包。本次未取得调用付费 provider 或触发真实 R&D 终态的额外授权，故最终仍为 `maximum_verified_authority=no_live_local_rehearsal`、server adoption blocked。TLS/OpenClaw、外部备份介质、长时 crash-loop、catalog/live canary 也不由本记录宣称完成。
