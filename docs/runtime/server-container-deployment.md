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
- 单一 runtime 容器在同一 PID、loopback 与文件 namespace 内按 `control runtime → demand-driven L2 manager → OHLCV worker → indicator worker` 启动；没有需求时数据 worker 保持空闲，出现 Runtime / R&D 的 owner-backed lease 后才创建有界 symbol 供给；
- 每项必须通过自身 owner readiness 后才启动下一项；任一已 ready 顶层进程意外退出，组内反向 drain 并让 Docker 重启整个 composition；
- `SIGTERM` 反向 drain，镜像使用 `tini`、非 root 用户、只读根文件系统、零 Linux capability、`no-new-privileges`、资源与日志上限；
- DB、L2 raw、普通 tmp、受保护 artifact 与 panel 使用分离 named volume；
- Operator HTTP 是独立 opt-in override，使用单独 env file，只绑定 Linux host loopback，不向 runtime 注入模型或 operator secret。

该纵切仍是 `active-partial`：当前环境没有 Docker executable，因此只有 Dockerfile / Compose 静态合同、TypeScript typecheck、composition lifecycle 与 health fixture；尚无真实 Linux image build、container kill/restart、volume restore 或 soak 证据。它保持 `domain_jobs_enabled=false`、`live_writes_allowed=false`，不能部署为实盘。

## 2. 为什么 runtime 先同容器

当前 L2 owner health 同时验证 supervisor / service PID、runtime receipt 与 loopback gRPC；直接拆成多个默认容器会让 PID 与 `127.0.0.1` 语义失真。首版以一个容器承载三个确定性长期进程，Docker 只管理一个 foreground composition；这不是把领域 owner 合并，也不阻止未来在 owner port 网络化后拆容器。

Operator、Agent Host 与 Developer sandbox 仍必须独立，因为它们持有不同 secret 或代码执行权限。不得通过 `pid: host`、Docker socket、`privileged` 或共享宿主机 home 来绕过当前 owner contract。

## 3. 构建与 no-live 启动

```bash
docker compose -f deploy/server/compose.yaml build --pull
docker compose -f deploy/server/compose.yaml up --detach runtime
docker compose -f deploy/server/compose.yaml ps
docker compose -f deploy/server/compose.yaml logs --follow --tail 200 runtime
docker compose -f deploy/server/compose.yaml exec runtime \
  bun modules/orchestration-ops/trade-flow/src/scripts/server-runtime-container-status.ts
```

健康必须同时满足 control supervisor lease active、market-data manager 以及 OHLCV / indicator resident worker 的新鲜 running state；具体 symbol 的 L2/OHLCV/indicator 可用性仍由对应 demand fact 的 coverage/freshness 证明。`container running` 或单一 HTTP 200 不等于 ready。

停止与删除容器不删除 named volume：

```bash
docker compose -f deploy/server/compose.yaml down
```

任何带 `--volumes` 的操作都属于数据销毁，不是普通回滚步骤。

## 4. Operator opt-in

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

## 5. Volume 与恢复门

| Volume | 内容 | 当前恢复要求 |
| --- | --- | --- |
| `trade-data` | owner SQLite 与非 L2 durable data | online backup、integrity、隔离 restore |
| `trade-l2` | raw L2 | finalize / manifest / compaction / retention 闭合前不得通用 GC |
| `trade-runtime-tmp` | 可再建 cache、log、runtime receipt | 不得成为唯一 durable ref |
| `trade-artifacts` | 被 R&D / evidence 引用的 artifact | 与 catalog / ledger 一起备份恢复 |
| `trade-panels` | validation / calibration / holdout workspace | ref / pin 闭包后才能清理 |

镜像升级必须创建新 digest，先做 no-live preflight 与备份，再替换 container；失败回滚旧 digest与原 volume。不得把 runtime volume bake 入 image，也不得用 Git checkout 回滚 owner DB。

## 6. 后续采用门

1. 在 Linux amd64 / arm64 builder 上完成 locked build 与 SBOM / image digest；
2. 真实验证 startup readiness、反向 drain、component exit、Docker restart 与 host reboot；
3. 真实验证 named-volume online backup、隔离 restore、schema migration 与 artifact closure；
4. 加入 Program-owned GC、L2 retention 和磁盘 soft/hard 故障注入；
5. 装配 full-shadow、R&D worker、Agent Host / private MCP 后做长时 soak；
6. 只有独立 live-small profile、Binance 最小凭证、IP allowlist、账户风险参数与人工授权全部通过，才能逐 job 开放交易写。
