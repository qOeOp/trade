---
title: Server Container Deployment
role: runtime-feature-contract
status: active-partial
owner: orchestration-ops
last_verified: 2026-07-23 CST
---

# Server Container Deployment

## 1. 当前交付

`deploy/server/` 已形成首个 Linux no-live 容器纵切：

- 固定 Bun `1.3.13`、Rust `1.97.1`、Go `1.25` 与 lockfile，镜像内编译两个 L2 release binary 和指标 provider；
- 单一 runtime 容器在同一 PID、loopback 与文件 namespace 内按 `control runtime → demand-driven L2 manager → OHLCV worker → indicator worker → formal Replay worker` 启动；没有需求时数据与 Replay worker 保持空闲，只有 owner-backed demand / immutable Replay queue work 才进入有界计算；
- 每项必须通过自身 owner readiness 后才启动下一项；任一已 ready 顶层进程意外退出，组内反向 drain 并让 Docker 重启整个 composition；
- `SIGTERM` 反向 drain，镜像使用 `tini`、非 root 用户、只读根文件系统、零 Linux capability、`no-new-privileges`、资源与日志上限；
- DB、L2 raw、普通 tmp、受保护 artifact 与 panel 使用分离 named volume；
- Operator HTTP 是独立 opt-in override，使用单独 env file，只绑定 Linux host loopback，不向 runtime 注入模型或 operator secret。
- Agent overlay 已拆出 semantic Host、code Host、OpenClaw、四个 role-scoped MCP、无网络 workspace checker 与 Reviewer resident worker；Host 不挂 Trade/R&D/Catalog DB，只有 Reviewer worker 以 Research DB + immutable Agent artifact + private Host 组成 formal Result→Review 接纳链。Host 不可用不会拖停 base runtime。镜像内 source revision 映射只为 frozen worktree，不把内部 snapshot commit 冒充发布 commit。

该纵切仍是 `active-partial`：当前环境没有 Docker executable，因此只有 Dockerfile / Compose 静态合同、TypeScript/fault fixture、真实本机 OpenClaw Gateway code smoke，以及从 committed HEAD 生成的可校验 source package；尚无真实 Linux image build、container kill/restart、volume permission/cgroup、restore 或 soak 证据。它保持 J01–J07 `domain_jobs_enabled=false`，只显式启用无交易权限的 queued formal Replay；Reviewer resident 仅在 Agent overlay opt-in 后启动。`live_writes_allowed=false`，不能部署为实盘。

## 2. 为什么 runtime 先同容器

当前 L2 owner health 同时验证 supervisor / service PID、runtime receipt 与 loopback gRPC；直接拆成多个默认容器会让 PID 与 `127.0.0.1` 语义失真。首版以一个容器承载五个确定性长期进程，Docker 只管理一个 foreground composition；这不是把领域 owner 合并，也不阻止未来在 owner port 网络化后拆容器。

Operator、Agent Host 与 Developer sandbox 仍必须独立，因为它们持有不同 secret 或代码执行权限。不得通过 `pid: host`、Docker socket、`privileged` 或共享宿主机 home 来绕过当前 owner contract。

## 3. 离线 source package 与 Linux 验收

普通发布者只能从 committed `HEAD` 生成新路径：

```bash
bun modules/orchestration-ops/trade-flow/src/scripts/server-runtime-container-release-package.ts \
  --target-root /absolute/new/trade-container-package
```

包内只有 `source.tar`、提交号、来源记录、manifest、说明、Linux 验收入口与 `SHA256SUMS`；不包含 dirty working tree、credential、owner DB、runtime state、依赖或本机 binary。v2 包固定携带 `source-origin.json`；Agent 候选另携带原样 `source-adoption-manifest.json`，两者都进入校验和，故传离认证主机后仍可核验来源。manifest 以 `source_package_only` 明示 image digest、SBOM、provenance 和容器 smoke 尚未完成。

Developer 代码候选不能绕过同一入口。只有 Ops 中已是 `candidate_certified`、且 archive/manifest/patch/check evidence 全部重验通过的 adoption，才能转换成相同包型：

```bash
bun scripts/rd-developer-candidate-release-package.ts --json '{
  "adoption_id":"<developer-run-id>:candidate",
  "target_root":"/absolute/new/trade-candidate-package"
}'
```

该包的 `source_origin` 绑定 adoption manifest hash，`SOURCE_COMMIT` 使用确定性 candidate revision；后续仍必须完整运行 Linux no-live acceptance。命令不 merge、不替换 container、不写 owner DB，也不授予 deployment / trading authority。

传到 Linux 后为 source 与 evidence 选择全新绝对路径：

```bash
cd /path/to/trade-container-package
./container-acceptance.sh verify
export TRADE_CONTAINER_ACCEPTANCE_ROOT=/opt/trade/acceptance/<commit>
export TRADE_CONTAINER_EVIDENCE_DIR=/var/lib/trade/acceptance-evidence/<commit>
export TRADE_CONTAINER_ACCEPTANCE_ID=review-<date>
./container-acceptance.sh all
```

`all` 依次校验 checksum、解包、要求 Linux + Docker Compose v2 + Buildx，以 pinned Dockerfile 请求 `SBOM + provenance` build，然后只在独立 `trade-acceptance-*` Compose project 启动 base no-live runtime，不接管同机正式 composition。它验证 owner aggregate health、容器重启后再次 healthy 与 named-volume canary 保留，最后 `compose down`，不删除 volume。输出仍只是待独立复核的 build/smoke evidence；没有 registry digest、SBOM 可读取性、backup/restore、host reboot 和长时 soak 时 release gate 不得通过。

## 4. 构建与 no-live 启动

```bash
docker compose -f deploy/server/compose.yaml build --pull
docker compose -f deploy/server/compose.yaml up --detach runtime
docker compose -f deploy/server/compose.yaml ps
docker compose -f deploy/server/compose.yaml logs --follow --tail 200 runtime
docker compose -f deploy/server/compose.yaml exec runtime \
  bun modules/orchestration-ops/trade-flow/src/scripts/server-runtime-container-status.ts
```

健康必须同时满足 control supervisor lease active、market-data manager、OHLCV / indicator worker 与 formal Replay resident worker 的新鲜 running heartbeat；具体 symbol 的 L2/OHLCV/indicator 可用性仍由对应 demand fact 的 coverage/freshness 证明，Replay heartbeat 也不代表存在或通过了策略 Result。`container running` 或单一 HTTP 200 不等于 ready。

停止与删除容器不删除 named volume：

```bash
docker compose -f deploy/server/compose.yaml down
```

任何带 `--volumes` 的操作都属于数据销毁，不是普通回滚步骤。

## 5. Operator opt-in

Operator secret file 只能包含该服务需要的 allowlist：

```dotenv
TRADE_OPERATOR_API_TOKEN=<high-entropy-token>
TRADE_OPERATOR_APPROVAL_TOKEN=<different-high-entropy-token>
SILICONFLOW_API_KEY=<provider-key>
```

文件必须位于仓库外、权限 `0600`，且不得包含 Binance private key。启动时显式给出路径：

```bash
export TRADE_OPERATOR_SECRET_ENV_FILE=/etc/trade/operator.env
docker compose \
  -f deploy/server/compose.yaml \
  -f deploy/server/compose.operator.yaml \
  --profile operator up --detach runtime operator
```

Operator 仅监听服务器 `127.0.0.1:8787`；远程访问走 SSH tunnel / VPN。当前 allowlist 只有 tool search、RD read 与带独立 approval 的 J04 wakeup，不含 exchange write、promotion 或任意 shell。

## 6. Volume 与恢复门

| Volume | 内容 | 当前恢复要求 |
| --- | --- | --- |
| `trade-data` | owner SQLite 与非 L2 durable data | online backup、integrity、隔离 restore |
| `trade-l2` | raw L2 | finalize / manifest / compaction / retention 闭合前不得通用 GC |
| `trade-runtime-tmp` | 可再建 cache、log、runtime receipt | 不得成为唯一 durable ref |
| `trade-artifacts` | 被 R&D / evidence 引用的 artifact | 与 catalog / ledger 一起备份恢复 |
| `trade-panels` | validation / calibration / holdout workspace | ref / pin 闭包后才能清理 |
| `trade-agent-artifacts` | Agent Run immutable input/output evidence | 与 Ops Agent Run/adoption identity 一起备份恢复 |
| `trade-release-candidates` | certified patch manifest 与 source archive | 只有无 active adoption 且无 release ref 才能按 owner GC |

镜像升级必须创建新 digest，先做 no-live preflight 与备份，再替换 container；失败回滚旧 digest与原 volume。不得把 runtime volume bake 入 image，也不得用 Git checkout 回滚 owner DB。

## 7. 后续采用门

1. 在 Linux amd64 / arm64 builder 上运行 source package acceptance，读取并复核 SBOM / provenance，推送后锁定 registry image digest；
2. 真实验证 startup readiness、反向 drain、component exit、Docker restart 与 host reboot；
3. 真实验证 named-volume online backup、隔离 restore、schema migration 与 artifact closure；
4. 加入 Program-owned GC、L2 retention 和磁盘 soft/hard 故障注入；
5. 装配 full-shadow、R&D worker、Agent Host / private MCP 后做长时 soak；
6. 只有独立 live-small profile、Binance 最小凭证、IP allowlist、账户风险参数与人工授权全部通过，才能逐 job 开放交易写。
