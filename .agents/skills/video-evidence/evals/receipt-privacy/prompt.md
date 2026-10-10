---
description: Regression — with the skill, the kept download record is the allowlist receipt, never the raw info JSON with signed URLs, IPs or cookies.
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

下载完成了。`source.info.json` 里每个格式的 URL 都带有 `ip=203.0.113.7`、`expire=` 和 `sig=` 参数，`http_headers` 里有 `Cookie: SESSDATA=example`，还有一个 `formats[].cookies` 字段。

这次下载我需要留下哪些记录、各自包含什么？`source.info.json` 本身怎么处理？
