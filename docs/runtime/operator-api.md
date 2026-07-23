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

现有 `agent.mcp` 仍是同机 stdio allowlist；HTTP 没有代理 MCP protocol，也没有复制 hypothesis/queue/Trial 逻辑。在本合同的当前边界里，OpenClaw 若采用只能作为该 HTTP allowlist 的 client/通知审批 UI；默认 read，controlled wakeup 仍需独立 approval secret，不能获得 exchange 或 scheduler authority。

更广的 OpenClaw/Codex Agent Host 模式仍是 [proposed Agent Host Runtime plan](../architecture/migrations/agent-host-runtime-integration-plan.md)，必须先完成隔离和同条件评测。即使未来采用，也优先直连同一 MCP owner surface；不会为了 Host 复制一套 HTTP domain API。

## 4. 当前证据与采用门

离线 policy 测试已覆盖 unknown route、Bearer、body/shape、read/write rate limit、独立 approval、pre-audit fail closed、owner allowlist 与 audit secret/body redaction。2026-07-23 又以 immutable macOS release 完成真实 Bun resident smoke：只监听 loopback；两次合法只读请求在真实 `ops_runtime.db` 形成 `accepted/completed` 共 4 条闭环 audit；重启换 key 后旧 API token 返回 `401`、旧 approval token 返回 `403`，新 approval 仅到达无效 payload 的 `400` 门，未调用 J04 owner、模型或交易写。可重复入口为 `operator-http/src/scripts/resident-smoke.ts`，输出不含 token、绝对路径或原始 body。

仍未完成 TLS reverse proxy、multi-process/distributed rate limit、systemd/launchd secret facility、OpenClaw client fixture 与长时 soak。因此保持 `active-partial`，当前 server profile 的三个 launchd unit 不含 operator；HTTP 关闭或凭据轮换不影响既有 program runtime。
