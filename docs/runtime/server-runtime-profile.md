---
title: Server Runtime Profile
role: runtime-feature-contract
status: active-partial
owner: orchestration-ops
last_verified: 2026-07-23 CST
---

# Server Runtime Profile

## 1. Authority 与采用范围

本文冻结 [Server Runtime Implementation Plan](../architecture/migrations/server-runtime-implementation-plan.md) S1 的首个可部署 profile：在单台 macOS 或 Linux 主机上装配现有 Rust L2、resident L2 consumer 与 `shadow_program` control runtime。它只闭合进程、配置、依赖、健康和停机，不复制 scheduler、领域计算或 store authority。

当前已形成首个 no-live composition root：版本化 Linux/macOS profile、三个 foreground entrypoint、closed-world validator、deterministic systemd/launchd renderer、只读 preflight/status，以及有界 lifecycle/public-smoke/recovery fixture。它尚未在本机 launchd 或目标 Linux systemd 安装并取得 process authority。

| 单元 | 当前能力 | 剩余采用门 |
| --- | --- | --- |
| L2 owner | 正式 foreground supervisor、exact Rust child、signal drain、raw/gRPC/health/admission | 本机 launchd 或 Linux systemd 安装、真实 unit restart 与 volume recovery |
| L2 consumer | 正式 foreground supervisor、worker restart、snapshot/watch、latest health | 当前平台 unit 故障注入；不得连坐 L2 owner |
| control runtime | foreground cadence、lease/fencing、signal drain、聚合 status | 仍固定 `shadow_program`；J01–J07 与 live write 关闭 |

首个 production target 允许 **macOS launchd** 或 **Linux systemd** 装配同一组仓库 foreground entrypoint。`profile/server-runtime-macos.json` 与 `profile/server-runtime.json` 只分离 manager-specific identity，不分叉业务命令和 authority。Docker 不是 S1 前置：SQLite、artifact、Rust/Bun build 与 runtime receipts 先在单节点闭合；容器化只能复用同一进程合同，不能建立第二套启动语义。

## 2. 唯一进程 authority

```text
launchd | systemd
  -> l2-owner foreground supervisor -> exact Rust child
  -> l2-consumer foreground supervisor -> exact consumer worker
  -> control-runtime foreground supervisor -> bounded owner commands
```

- process manager 只负责 unit 的 start、stop、restart/backoff；业务依赖仍由 owner readiness/epoch/lease fail closed。
- 每个仓库 supervisor 只管理自己的 exact child、业务 lease、状态投影与 drain；不得 daemonize、写 PID file 或重启 sibling。
- composition root 只负责 preflight、render/install profile 和聚合 status；它不是常驻第四层 supervisor。
- `launch.ts`、`consumer-launch.ts` 与旧 program-only launchd wrapper 继续用于开发/运维验证，不得作为 server unit entrypoint，因为它们会 detached 后返回。
- MCP、HTTP、OpenClaw、Codex 和 LLM 均不是 daemon parent，也不能取得 signal、PID 或 restart authority。

同一 component 同时出现两个 active supervisor 必须 fail closed，由 operator 处理；不能凭“最新 PID”自动选主。

## 3. Closed-world Profile

S1 profile 只允许以下非敏感配置：

| 组 | 最小字段 | 约束 |
| --- | --- | --- |
| identity | profile id、version、deployment id、manager target | 稳定且可进入 health/audit；不含 hostname 猜测 |
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

S1 shadow profile 的三项服务均不需要 secret。`BINANCE_API_KEY/BINANCE_API_SECRET` 只在未来启用 private read job 时进入对应 owner unit；Model Gateway 与 Operator HTTP 已有独立 profile，但尚未装配进本 server profile，其 `SILICONFLOW_API_KEY / TRADE_OPERATOR_API_TOKEN / TRADE_OPERATOR_APPROVAL_TOKEN` 也不得注入当前三个 unit。composition root 不读取、打印、转发或验证未启用 component 的 key。

systemd unit 与 launchd agent 必须使用显式 environment allowlist；不得继承交互 shell、`.env` 全量内容或把 secret 放入 command line、profile、receipt、日志和 health。macOS 仓库若位于 Desktop/Documents/Downloads，launchd 安装前必须取得明确隐私授权或把 release 移到非受保护目录；前台直接运行不等于取得无人值守 process authority。

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
| L2 supervisor 退出 | process manager | 重启 L2 unit；consumer/control 保持运行但 readiness 降级 |
| consumer worker crash | consumer supervisor | bounded child restart、累计 counters 不清零 |
| consumer supervisor 退出 | process manager | 重启 consumer unit；不重启 L2 |
| control lease lost/DB busy | control runtime | fail closed 退出；manager bounded restart |
| model/API unavailable | future model gateway | 不影响三项 S1 deterministic unit |
| disk hard/unknown | L2 owner | drain child 后失败；禁止扩大 raw backlog |

manager 的 restart/backoff 与仓库 child retry budget 必须分别有上限，防止内外层形成无限热循环。launchd 不提供 systemd 等价的完整 start-limit 语义，因此长期 soak 必须验证 crash loop 频率。一个 unit 失败不得级联 kill 无关 durable owner；只有显式 operator stop profile 才按反向依赖顺序整体 drain。

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

- `bun run server:validate`：按 host 自动选择 macOS/Linux profile，纯读取 profile/release/path/schema，输出 closed-world launch plan；
- `bun run server:preflight`：验证 release、binary、可写根与固定 safety，不启动进程；
- `bun run server:render-systemd`：确定性生成三个 unit 与一个 target，不安装、不启动；
- `bun run server:render-launchd`：确定性生成三个 per-user LaunchAgent plist，不安装、不启动；
- `bun run server:launchd-manager -- --action <plan|install|status|restart-component|uninstall> --release-root <path> --bun-path <path>`：只管理三个固定 label；install 前要求 state-free manifest、完整 preflight、空闲 listener 与无 plist drift，部分失败反向 bootout；
- `bun run server:status`：聚合既有 owner health、unit state 和 profile hash；
- `bun run server:verify-lifecycle`：仅启动合成子进程，验证 ordering/restart isolation/reverse drain/no orphan；
- `bun run server:public-smoke`：只读等待两个不同 control cycle，不发送信号；
- `bun run server:verify-recovery`：只对合成 DB/raw/artifact/profile 执行备份恢复，不读取活跃 owner 数据；
- `bun run server:release-gate -- --input <evidence.json>`：验证 no-live 采用证据；最多返回 `eligible_for_manual_change_review`，永不授予 exchange write 或自动 promotion；
- `bun run server:stage-release -- --target-root <absolute-path>`：从 committed HEAD 原子生成不可覆盖 release，复制 lock-bound dependencies 与固定 Rust binaries，创建空 runtime roots；不复制现有 owner DB，不安装或启动 manager；
- `stop/start/restart`：由当前 profile 的 launchd/systemd 执行，composition CLI 只允许固定 label/unit；
- `backup-check`：验证 DB 与被引用 artifact 的备份闭包，不直接上传外部存储。

所有响应返回 profile/release hash、component、status、reason、observed_at；不返回 secret、PID、绝对 repository path 或任意 shell command。HTTP/MCP 未来只能薄适配 `status` 与经过授权的固定 lifecycle action。

## 10. S1 实施顺序与完成门

| Step | 当前证据 | 尚未完成 |
| --- | --- | --- |
| R1 | 三个正式 foreground entrypoint；signal/exact child/终态/退出码测试通过 | 目标 host unit 运行 |
| R2 | Linux systemd 四 units 与 macOS launchd 三 agents 确定性 render；unknown/path/env/live-write fail closed | 当前 host render/install diff |
| R3 | release preflight 与 owner/process-manager 聚合 status | 本机 launchctl 或 Linux systemctl unit status 验证 |
| R4 | 合成进程实跑 ordering、consumer restart isolation、反向 drain、无 orphan | 无 |
| R5 | 2026-07-23 本机只读 public smoke：两个 control cycle、同 epoch、parity mismatch `0 -> 0`、同 fencing token | launchd/systemd active、operator-controlled consumer fault injection、无双 lease复核 |
| R6 | 合成三 DB `VACUUM INTO`、raw/artifact/profile hash 与 restore integrity/ref closure 通过 | 真实 volume、真实 owner schema/artifact refs、外部备份介质恢复 |

完成 S1 只表示可无人值守运行 **no-live-write shadow profile**。它不表示策略已经使用 L2、不表示 R&D/LLM 已自治，也不授权真实下单；这些分别由后续 watch、model gateway、research autonomy 与 per-job live cutover 采用门负责。

## 11. 当前 Release Gate

2026-07-23 的本机演练已闭合 lifecycle、合成 recovery、full-shadow、R&D CAS/idempotency 和 Operator HTTP policy 的本地证据，结论固定为 `maximum_verified_authority=no_live_local_rehearsal`。一次性证据见 [Server No-Live Rehearsal](../history/server-no-live-rehearsal-2026-07-23.md)。

当前 Darwin arm64 本机已通过 Bun、Rust binaries、foreground entries、owner DB parents、data/tmp 权限和 no-live safety preflight；三个正式 launchd label 均未安装。仓库位于 macOS 受保护的 Downloads 范围，故 launchd preflight 只剩 `launchd_source_privacy` 阻断：必须先授予明确隐私权限，或把只读 release 移到非受保护目录。该阻断不否定 macOS 兼容性，也不阻止显式前台验证，但在解除前不能宣称无人值守。

本机已有独立 L2 进程监听 `127.0.0.1:50061`，不得停止或接管。macOS staged profile 固定使用隔离端口 `127.0.0.1:51061`；preflight 必须通过 listener availability，避免 process manager 启动后才进入 crash loop。

macOS 正式采用不直接从可编辑 workspace 启动。release staging 只归档 committed HEAD，清除 archive 中任何 `data/` 下的 SQLite runtime state，绑定 `bun.lock`、复制当前 build workspace 的依赖闭包与两个带 hash 的 Rust binaries，并初始化空 `data/`；目标必须是不存在、非受保护且不与仓库互相包含的绝对目录。manifest 不记录本机绝对路径，失败只清理本次新建的 partial target。

主机采用仍被以下证据阻断：本机 launchd 或 Linux systemd 实际安装、真实 durable volume restore、public soak、真实模型 provider smoke、R&D kill/restart 单 Trial/Result、Operator HTTP resident 与 audit roundtrip。macOS/launchd 是完整合法路径，不要求另有 Linux；即使这些证据全部通过，gate 也只允许进入人工变更评审。catalog canary 需显式 operator run，live canary 与 exchange write 需另行授权，不属于本 gate。
