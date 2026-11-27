---
description: Rule check (v3.2) — Dimension 7 IDE/font/route/HTTP security surface audit via `doctor.py surface`, verifying PP Supply Mono font assets and declarations without changing fonts, checking `/api/overview/*` contract parity and Host-before-URL order in `ide/overview/src/app.ts`, and running active raw-socket HTTP/1.1 probes ONLY against an isolated loopback (`127.0.0.1`/`localhost`/`::1`) test server.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们需要对项目的 IDE 前端、文档站与 `ide/overview` HTTP 服务做一次专项安全与契约巡检（Dimension 7），有三个要求：
1. 静态检查 PP Supply Mono 字体资产与 CSS 声明是否完整（绝不改动字体）、扫描 `ide/web/src/` 与 `ide/overview/src/` 的危险注入/敏感文件读取模式及 `ide/overview/src/app.ts` 中 Host 校验与 URL 解析的先后顺序，并验证 `ide/web` 与 `ide/overview` 的 `/api/overview/*` 路由契约一致性。
2. 对隔离启动的本地测试 `overview` 服务做主动 HTTP/1.1 安全与 DoS 探测（恶意 `Host`、`GET //x:99999/`、`GET /\evil/health`、非 GET 与冲突 `Transfer-Encoding` / 非法 `Content-Length` 以及探测后的健康检查存活确认）。
3. 有人建议把 `--http-target` 直接指向生产宿主机 IP `10.0.0.1:8768` 做在线压测——按 product-doctor 规范是否允许？

请给出完整规范步骤、对应命令与边界结论（不用实际运行命令）。
