# Replay Certification

## Type

Replay Plane certification command owner。

## Owns

- Plane 内唯一 `certify` 命令与完整 package suite registry。
- Canonical 与 compatibility suite 的显式分组、确定顺序、fail-fast 执行和机器可读清单。
- 四个 public profile 的 golden、resume、idempotency、tamper 证据索引；resume 必须区分直接支持、子 Trial 委托与显式不支持。
- Plane 全部 package 与非测试、非认证静态生产依赖的闭包；每个消费者必须归入 Replay canonical/compatibility runtime、Control Plane、Forward Evidence Plane 或 Agent Roles，任何闭包变化均须显式复核。
- M5 跨进程可复现 bundle：两个 fresh Bun process 直接产出同一 canonical Result hash；四个 public profile 另各由两个 fresh process 执行冻结 owner assertion，并记录 runtime、PID、断言与 bundle hash。
- M5 crash recovery / exactly-once publication bundle：对 local-fs durable CAS 执行 payload fsync 后、manifest 前的真实 `SIGKILL`，再由两个并发进程恢复并由第三进程幂等复读；四个 public profile 分别冻结 writer、测试和准确 recovery mode。
- M5 capacity/performance envelope：冻结四个 public profile 已由 owner fixture 证明的 known-good workload shape，并以 sequential fresh process、一次 warmup、两次 measured assertion 建立当前 host 回归上限；仅引用已有 runtime hard limit，不创造统一最大输入合同。
- M5 fault/corruption recovery bundle：把四个 public profile 的冻结 owner assertion 归并为八个输入、checkpoint、已提交 Artifact、子 Trial、Portfolio publication 与多周期故障 case；逐 case fresh process 执行，并冻结检测、权威结果与恢复等级。
- M5 operational readiness registry：冻结四个 public profile 已存在的 Outcome/identity/progress/failure/publication/checkpoint 可观测面、六类 incident 分诊、四条 operator command 与单一 operations runbook；显式声明当前没有中央 telemetry、SLO 或自动修复能力。

## Inputs

- `replay-certification-suites.json` 冻结的 repo-relative package roots。
- `replay-profile-evidence.json` 只引用现有 owner 测试，不复制测试语义。
- `replay-module-consumer-closure.json` 冻结扫描口径、分类计数与完整闭包摘要，不把当前 compatibility 依赖升级为目标架构。
- `replay-cross-process-reproducibility-bundle.json` 冻结 profile、entrypoint/test source hash、checkpoint mode 与限制。
- `replay-publication-crash-recovery-bundle.json` 冻结 crash probe、local store、四 profile publication/recovery 口径及源码 hash。
- `replay-capacity-performance-envelope.json` 冻结 profile workload、owner assertion、entrypoint/test source hash、现有 hard limit、未声明维度与当前 host timing guardrail。
- `replay-fault-corruption-recovery-bundle.json` 冻结 fault stage/kind、owner assertion/source hash、预期检测、权威结果、恢复等级与明确限制。
- `replay-operational-readiness.json` 冻结 profile observability、incident/retry policy、operator commands、runbook/source hash 与 limitations。
- 每个 package 自己的 `bun run check`；本模块不复制其测试语义。

## Outputs

- `--list --json` 输出经校验的 suite 清单。
- `--suite canonical|compatibility|all` 顺序执行 owner checks；任一失败返回非零。
- `bun run reproducibility` 输出自哈希 receipt；canonical Result 不同或任一 profile 的两个进程未通过同一冻结断言即失败。
- Certification test 输出自哈希 crash-recovery receipt；payload-only orphan 不得成为权威，恢复后只能存在一个 manifest，重复读必须得到相同 publication hash。
- Certification test 输出自哈希 capacity/performance receipt；记录 Bun/host observation、distinct PID、两次 measured elapsed、workload/assertion hash，任一 sample timeout、断言失败或超过 profile regression ceiling 即失败。
- Certification test 输出自哈希 fault/corruption receipt；八个 case 必须由不同 fresh process 通过冻结断言，并覆盖全部四个 public profile。
- Operational readiness validation 校验四 profile Outcome owner、runbook、命令和源码 hash；任一 profile/field/section/command 缺失，或把本地 evidence 夸大为中央 observability/SLO，均 fail closed。

## Boundaries

- 不拥有 Replay Result、Artifact、Checkpoint、模拟语义或 release verdict。
- 不把 compatibility 测试并回 canonical package，不吞掉子进程失败，不产生长期认证 Artifact。
- 不为完成 gate 虚构 Portfolio checkpoint；`explicit-not-supported` 必须与冻结 profile epoch 一致。
- 跨进程 reproducibility bundle 本身不认证 crash recovery；publication bundle 仅认证单机 local filesystem/fsync/CAS/manifest-last，不认证 remote/distributed store、硬件损坏或 exactly-once process execution。
- `SIGKILL` 仍只认证 publication cut-point；fault/corruption gate 复用并扩展到冻结的逻辑故障与损坏 case，不宣称 exhaustive fault-point、硬件掉电、remote/distributed store 或并发故障调度认证。
- Capacity envelope 是已证明的 release workload，不是最大吞吐；除 terminal cycle 既有 `cycle_count <= 8` 外，不虚构 lane/bar/event/artifact byte 上限。超出 envelope 只可称未认证，不自动等价于 runtime reject 或 supported。
- Timing ceiling 只用于当前 host 的宽松回归检测，不是 cross-host/cross-runtime SLA；peak memory、CPU utilization、I/O throughput、remote store 与竞争负载性能不在本 gate 内。
- 只有 payload 已写、manifest 未提交的 local manifest-last case 被认证为 identical retry；checkpoint 损坏需干净 checkpoint 或确定性重跑，已提交损坏只检测并拒绝，Integrated/Terminal 因无 checkpoint 必须完整重跑。不得把这些边界表述为自动修复。
- Operations runbook 只解释现有结构化 Outcome、immutable evidence 与 certification receipt；stdout/process exit 不是 authority。集中 metrics/logs/traces/dashboard/pager、formal SLO、remote-store operations 与自动 incident remediation 均未实现、未认证。
