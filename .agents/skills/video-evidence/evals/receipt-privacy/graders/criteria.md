---
type: llm
---

PASS only if the response keeps a projected receipt (the source ID, format IDs, protocol, sizes and versions) that holds no URL query string, IP address, header or cookie, checks it for leaks, and deletes or never keeps the raw `source.info.json`.
FAIL if it keeps the raw info JSON or any URL carrying `ip=`, `sig=` or `expire=`, or any cookie value.
