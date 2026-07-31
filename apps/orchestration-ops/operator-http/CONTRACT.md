# Operator HTTP Contract

## Responsibility

- Expose a closed loopback HTTP allowlist over the same fixed owner CLIs used by program/MCP surfaces.
- Enforce bearer authentication, bounded request bodies, per-client/route rate limits, independent approval for controlled writes, idempotency identity, and sanitized ops audit.

## Boundaries

- Current routes are tool discovery, RD program read, and approved J04 autonomy wakeup only.
- No exchange write, live execution, arbitrary tool/command/path, file read, SQL, provider selection, strategy mutation, promotion, or process lifecycle route exists.
- HTTP/OpenClaw are northbound adapters, not schedulers or state owners; shutting them down does not stop program runtime.
- Static in-process rate state and loopback HTTP are an initial single-node boundary; public exposure requires an authenticated TLS reverse proxy and server adoption evidence.
