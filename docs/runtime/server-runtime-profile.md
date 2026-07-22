---
title: Server Runtime Profile
role: runtime-feature-contract
status: active-partial
owner: orchestration-ops
last_verified: 2026-07-23 CST
---

# Server Runtime Profile

## 1. Authority 与采用范围

本文冻结 [Server Runtime Implementation Plan](../architecture/migrations/server-runtime-implementation-plan.md) S1 的首个可部署 profile：在单台 Linux 服务器上装配现有 Rust L2、resident L2 consumer 与 `shadow_program` control runtime。它只闭合进程、配置、依赖、健康和停机，不复制 scheduler、领域计算或 store authority。

当前已形成首个 no-live composition root：版本化 profile、三个 foreground entrypoint、closed-world validator、deterministic systemd renderer、只读 preflight/status，以及有界 lifecycle/public-smoke/recovery fixture。它尚未在目标 Linux host 安装或取得 process authority。

| 单元 | 当前能力 | 剩余采用门 |
| --- | --- | --- |
| L2 owner | 正式 foreground supervisor、exact Rust child、signal drain、raw/gRPC/health/admission | Linux systemd 安装、真实 unit restart 与 volume recovery |
| L2 consumer | 正式 foreground supervisor、worker restart、snapshot/watch、latest health | Linux unit 故障注入；不得连坐 L2 owner |
| control runtime | foreground cadence、lease/fencing、signal drain、聚合 status | 仍固定 `shadow_program`；J01–J07 与 live write 关闭 |

首个 production target 采用 **Linux systemd + 仓库 foreground entrypoint**。Docker 不是 S1 前置：当前 SQLite、artifact、Rust/Bun build 与本地 runtime receipts 先在单节点闭合；容器化只能复用同一 profile 和前台进程合同，不能建立第二套启动语义。

## 2. 唯一进程 authority

```text
systemd
  -> l2-owner foreground supervisor -> exact Rust child
  -> l2-consumer foreground supervisor -> exact consumer worker
  -> control-runtime foreground supervisor -> bounded owner commands
```

- systemd 只负责 unit 的 start、stop、restart/backoff 与 boot ordering。
- 每个仓库 supervisor 只管理自己的 exact child、业务 lease、状态投影与 drain；不得 daemonize、写 PID file 或重启 sibling。
- composition root 只负责 preflight、render/install profile 和聚合 status；它不是常驻第四层 supervisor。
- `launch.ts`、`consumer-launch.ts` 与 launchd 继续用于开发/运维验证，不得作为 systemd `ExecStart`，因为它们会 detached 后返回。
- MCP、HTTP、OpenClaw、Codex 和 LLM 均不是 daemon parent，也不能取得 signal、PID 或 restart authority。

同一 component 同时出现两个 active supervisor 必须 fail closed，由 operator 处理；不能凭“最新 PID”自动选主。

## 3. Closed-world Profile

S1 profile 只允许以下非敏感配置：

| 组 | 最小字段 | 约束 |
| --- | --- | --- |
| identity | profile id、version、deployment id | 稳定且可进入 health/audit；不含 hostname 猜测 |
| repository | release root、Bun、Rust binary refs | 绝对路径只存在 manager unit，不进入业务响应 |
| L2 | symbol、loopback listen、raw root、market DB、freshness/segment/resource limits | 明确 public network；不读 API key |
| consumer | depth、freshness、watch/session bounds、retry budget | 复用 owner-fixed endpoint 与 retry 语义 |
| control | trade DB、ops DB、cadence、command timeout | 固定 `shadow_program`；domain jobs disabled |
| runtime | runtime-state root、stdout/stderr target、shutdown grace | runtime state 可丢，业务 DB/raw/artifact 不可丢 |

Profile validator 必须拒绝：未知字段、重复字段、repo 外可写路径、非 loopback L2 listener、相撞端口、缺失目录权限、相同 DB 指向不同 owner、`allow_live_writes=true`、启用 J01–J07、真实通知、任意 command、任意 environment pass-through。

S1 不把 tool 数量、容器数量、未来 domain cadence 或模型任务写入 profile。后续增加 component 必须先有 owner foreground contract、readiness 和独立 failure policy。

## 4. 配置与 Secret

配置分三层，禁止混合：

1. versioned profile：非敏感路径、端口、symbol、budget；
2. manager environment：仅注入 owner 明确声明的 secret；
3. runtime facts：PID、attempt、lease、epoch、readiness，只写 runtime state / owner store。

S1 shadow profile 的三项服务均不需要 secret。`BINANCE_API_KEY/BINANCE_API_SECRET` 只在未来启用 private read job 时进入对应 owner unit；`SILICONFLOW_API_KEY` 只进入未来 model gateway。composition root 不读取、打印、转发或验证未启用 component 的 key。

systemd unit 必须使用显式 environment allowlist；不得继承交互 shell、`.env` 全量内容或把 secret 放入 command line、profile、receipt、日志和 health。

## 5. 数据与 Runtime Paths

| 等级 | 内容 | 重启/恢复语义 |
| --- | --- | --- |
| durable | owner SQLite、`data/l2` raw、被正式 ref 引用的 artifact | 共同备份；缺一不能宣称恢复完成 |
| release/config | checkout/build、profile、unit render input | 只读、版本化、可重建 |
| runtime | supervisor state、receipt、terminal、日志游标 | host reboot 后可重建；不得成为业务事实源 |
| cache | target、临时 panel、未登记输出 | 可删除、可复算 |

初版可以继续使用仓库内受约束的 `tmp/l2-*` runtime refs，但 production unit 必须显式创建和授权该目录。PID/receipt 不能跨 host reboot 被直接信任；恢复时先验证 process identity，再根据 owner health、lease 和 terminal state 决定 adopt、relaunch 或 fail closed。

SQLite 要求单 owner、WAL/checkpoint、busy budget、online backup 与 restore integrity check。仅复制 `.db` 而遗漏关联 WAL 或被引用 artifact 不算合法备份。

## 6. 启动与 Readiness

启动顺序固定为依赖门，不以 sleep 代替 readiness：

```text
profile validate
  -> release/binary/schema/path preflight
  -> owner DB integrity + migration
  -> L2 owner process alive
  -> L2 owner ready: live/fresh/continuous + disk/admission acceptable
  -> L2 consumer process alive
  -> L2 consumer ready: fresh baseline on current L2 epoch
  -> control runtime acquire fenced lease
  -> server profile ready
```

`process alive`、`owner ready`、`data fresh` 和 `profile ready` 必须分别报告。聚合 readiness 只引用既有 owner health，不直读 gRPC、PID 或 SQLite 重新判断业务状态。

启动 deadline 到达后 unit 失败并保留 typed terminal reason；不能无限等待。依赖 unit 重启不自动证明下游仍 ready：L2 epoch 改变后 consumer 必须 resnapshot，control health 在此期间显示 blocked/degraded。

## 7. 失败、重启与降级

| 故障 | 直接 owner | Profile 行为 |
| --- | --- | --- |
| Rust child crash/gap | L2 supervisor | bounded child restart、新 epoch；consumer resnapshot |
| L2 supervisor 退出 | systemd | 重启 L2 unit；consumer/control 保持运行但 readiness 降级 |
| consumer worker crash | consumer supervisor | bounded child restart、累计 counters 不清零 |
| consumer supervisor 退出 | systemd | 重启 consumer unit；不重启 L2 |
| control lease lost/DB busy | control runtime | fail closed 退出；systemd bounded restart |
| model/API unavailable | future model gateway | 不影响三项 S1 deterministic unit |
| disk hard/unknown | L2 owner | drain child 后失败；禁止扩大 raw backlog |

systemd 的 restart budget 与仓库 child retry budget 必须分别有上限，防止内外层形成无限热循环。一个 unit 失败不得级联 kill 无关 durable owner；只有显式 operator stop profile 才按反向依赖顺序整体 drain。

## 8. Stop、Upgrade 与 Rollback

正常停机顺序：停止新 control cycle → drain 当前 owner command → 释放 control lease → 停 consumer 并写 terminal → drain/finalize L2 epoch → checkpoint/close owner DB。达到 grace deadline 后只能 signal exact child，并记录被强制终止的 component；不得伪造 completed 业务终态。

升级采用单节点 stop-and-replace：

1. 记录当前 release/profile hashes 与聚合 status；
2. drain profile，执行 DB backup/integrity check；
3. 切换只读 release，运行 preflight/schema migration；
4. 按 readiness 顺序启动并执行 bounded smoke；
5. 失败时回滚 release/profile；不可逆 schema migration 必须有独立采用门。

S1 不做自动滚动升级、双实例交接或 active-active；SQLite 单 owner 和 loopback L2 使这些声明没有证据基础。

## 9. Operator Surface

首个 composition surface 只需要：

- `bun run server:validate`：纯读取 profile/release/path/schema，输出 closed-world launch plan；
- `bun run server:preflight`：验证 release、binary、可写根与固定 safety，不启动进程；
- `bun run server:render-systemd`：确定性生成三个 unit 与一个 target，不安装、不启动；
- `bun run server:status`：聚合既有 owner health、unit state 和 profile hash；
- `bun run server:verify-lifecycle`：仅启动合成子进程，验证 ordering/restart isolation/reverse drain/no orphan；
- `bun run server:public-smoke`：只读等待两个不同 control cycle，不发送信号；
- `bun run server:verify-recovery`：只对合成 DB/raw/artifact/profile 执行备份恢复，不读取活跃 owner 数据；
- `stop/start/restart`：由 systemd 执行，composition CLI 只调用固定 unit target；
- `backup-check`：验证 DB 与被引用 artifact 的备份闭包，不直接上传外部存储。

所有响应返回 profile/release hash、component、status、reason、observed_at；不返回 secret、PID、绝对 repository path 或任意 shell command。HTTP/MCP 未来只能薄适配 `status` 与经过授权的固定 lifecycle action。

## 10. S1 实施顺序与完成门

| Step | 当前证据 | 尚未完成 |
| --- | --- | --- |
| R1 | 三个正式 foreground entrypoint；signal/exact child/终态/退出码测试通过 | 目标 host unit 运行 |
| R2 | 固定 profile 与四个 deterministic systemd units；unknown/path/env/live-write fail closed | 目标 host render/install diff |
| R3 | release preflight 与 owner/systemd 聚合 status；macOS 无 systemd 时正确降级 | Linux unit status 验证 |
| R4 | 合成进程实跑 ordering、consumer restart isolation、反向 drain、无 orphan | 无 |
| R5 | 2026-07-23 本机只读 public smoke：两个 control cycle、同 epoch、parity mismatch `0 -> 0`、同 fencing token | Linux systemd active、operator-controlled consumer fault injection、无双 lease复核 |
| R6 | 合成三 DB `VACUUM INTO`、raw/artifact/profile hash 与 restore integrity/ref closure 通过 | 真实 volume、真实 owner schema/artifact refs、外部备份介质恢复 |

完成 S1 只表示可无人值守运行 **no-live-write shadow profile**。它不表示策略已经使用 L2、不表示 R&D/LLM 已自治，也不授权真实下单；这些分别由后续 watch、model gateway、research autonomy 与 per-job live cutover 采用门负责。
