---
title: Operator API Runtime
role: runtime-feature-contract
status: active-partial
owner: orchestration-ops
last_verified: 2026-07-23 CST
---

# Operator API Runtime

## 1. 当前北向接口

`ops.operator-http` 是 loopback-only HTTP adapter；MCP、HTTP、未来 OpenClaw client 都继续调用已有 owner surface，不拥有 scheduler、研究、交易或状态语义。

| Route | Authority | Owner handoff |
| --- | --- | --- |
| `GET /healthz` | process alive only；无 readiness/交易结论 | none |
| `POST /v1/tools/search` | authenticated read | `toolset.json` compact projection |
| `POST /v1/rd/program/read` | authenticated read | `research.rd-program-state action=read` |
| `POST /v1/rd/autonomy/wakeup` | authenticated + independently approved controlled write | `research.rd-autonomy-cycle` |

未登记 route 一律 `404`。当前没有 exchange write、live execution、任意 tool/command/path/SQL/file read、process lifecycle、strategy mutation 或 promotion API。

## 2. 安全合同

- 只监听 `127.0.0.1:8787`；非本机访问必须由未来 authenticated TLS reverse proxy 明确采用，不能直接改 host。
- 所有 `/v1` route 需要 `TRADE_OPERATOR_API_TOKEN` Bearer；controlled route 另需 `TRADE_OPERATOR_APPROVAL_TOKEN`，两者只从进程环境读取。
- body 上限 256 KiB；route payload exact-key、ID、canonical UTC 和 RD budget 均有界；不接受 provider/profile/path/command。
- 单进程、按 token hash + route 的固定分钟窗口：read `60/min`、controlled write `6/min`。重启会清空 limiter，因此它不是分布式 quota authority。
- controlled owner 调用前必须先由 `ops.runtime-store record_message` 持久化 sanitized accepted audit；pre-audit 不可用则 owner 不执行。完成/失败再写第二条 audit。
- audit 只含 client hash、route/owner、request/result hash、phase/status、loopback scope；不含 token、approval、完整 body、prompt 或 owner raw error。
- controlled request 必须带稳定 `request_id`；它成为 J04 cycle identity，重试依赖 autonomy/Control Plane 幂等与 CAS，而不是 HTTP 内存 flag。

## 3. MCP 与 OpenClaw

现有 `agent.mcp` 仍是同机 stdio allowlist；HTTP 没有代理 MCP protocol，也没有复制 hypothesis/queue/Trial 逻辑。OpenClaw 若采用，只能作为该 HTTP allowlist 的 client/通知审批 UI；默认 read，controlled wakeup 仍需独立 approval secret，不能获得 exchange 或 scheduler authority。

## 4. 当前证据与采用门

离线测试已覆盖 unknown route、Bearer、body/shape、read/write rate limit、独立 approval、pre-audit fail closed、owner allowlist 与 audit secret/body redaction；模块 typecheck 和 registry/architecture checks 已通过。

仍未完成 Bun-native resident server smoke、真实 ops DB audit 回读、token rotation/revocation、TLS reverse proxy、multi-process/distributed rate limit、systemd secret injection、OpenClaw client fixture 与有界 soak。因此保持 `active-partial`，当前 `profile/server-runtime.json` 尚未装配 operator unit；关闭 HTTP/MCP 不影响现有 program runtime。
