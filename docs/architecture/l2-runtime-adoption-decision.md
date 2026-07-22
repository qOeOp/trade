---
title: L2 Runtime Adoption Decision
role: architecture-decision
status: active
owner: architecture
last_verified: 2026-07-22 CST
---

# L2 Runtime Adoption Decision

## 决策

采用 Rust 作为 Binance public L2 常驻 owner 语言，采用 TL2S v1 作为初始 crash-recoverable raw segment encoding。确定性 order-book / sequence / segment 语义进入同域 `l2-order-book-core`；证据 harness 与独立 production service 共同依赖该 core，互不依赖对方的 runtime。

本决策只覆盖 public WebSocket、REST snapshot bridge、`U/u/pu`、bounded book / queue、raw segment、epoch manifest proposal 与 loopback gRPC read port。它不采用 Kafka、Redpanda、LangGraph、LLM、private stream 或 Binance write，也不授权 Replay / RD / execution consumer cutover。

## 证据

| Gate | 结果 |
| --- | --- |
| Bun / Go / Rust frozen fixture | complete / gap verdict、book hash 与 decimal normalization 一致 |
| TL2S parity | 三语言 writer 字节一致；truncate / checksum 只接纳有效前缀 |
| crash matrix | 3 writers × 3 recoverers 一致；restart 建立新 epoch |
| natural public soak | BTCUSDT 连续 `3600.111s`；35,282 received = recorded；0 resync / incident；queue max `4/64` |
| segment verification | 36 declared = 36 complete；0 partial；worker / supervisor exit 0 |
| resource evidence | RSS max约 `21.8 MiB`、p95约 `16.7 MiB`，tail median 低于 head；CPU mean `0.144%`、max `2.5%` |
| production-candidate smoke | loopback gRPC `live/read_ready=true`；291 received = raw = applied；complete manifest；TL2S recovery complete；0 partial |
| owner admission | complete epoch 的 snapshot / TL2S / CRC / hash / count 闭包通过并 create-or-identical；incomplete 与篡改证据拒绝 |
| supervisor restart | service `SIGKILL` 后 attempt 2 自动恢复 `read_ready=true`；orphan partial salvage + recovery report；精确 PID stop 写成功终态 |
| continuous admission / disk | manifest-last 原子发布；3 个 complete 自动接纳并标记 raw-hot，incomplete 保留拒绝；hard watermark 在 attempt 0 fail-closed |

证据由仓库命令和 ignored runtime output 重建；本文只保存决策摘要，不把临时 evidence 复制成新的事实源。

## 取舍

- Rust 的内存、长跑稳定性和明确失败边界足以抵消新增语言成本；TypeScript 继续拥有 supervisor / admission / ops，不做控制面重写。
- TL2S v1 简单、可跨语言复验，适合 raw-first；它不是 analytical format，后续 Parquet 由独立 compactor 产生。
- shared core 消除“bake-off 通过、production 另写一套”的形似融合；任何核心语义变更必须同时经过 frozen fixture 与 production tests。
- gRPC 负责 fresh current-book；raw / manifest 负责审计与 Replay。二者不可互相冒充。
- broker 仍受独立 adoption gate 约束；存在真实多 consumer、独立 offset、ack / retry / DLQ 或单机 port 瓶颈后再评审。

## 当前限制与回滚

- 当前只证明 BTCUSDT 单实例、单 symbol、小时级自然流量与短周期多 epoch/restart；已完成单 epoch 的 owner-issued TL2S → Parquet → owner admission/bounded read，但尚未完成 catalog/referrer/GC、长期磁盘预算、多 symbol、24h 自然 rotation 验收与跨主机部署。
- service 是 `active-partial` production candidate；没有 consumer cutover，不进入交易热路径。
- 回滚是停止 service 并保持所有 consumer 未接入；不删除 raw / manifest evidence，不切回 Agent 维持采集。
- 任一 silent gap、不可恢复 partial、unbounded resource、stale value 被标 fresh 或 core parity 失败，立即撤销 runtime readiness，修复后重跑 gate。
