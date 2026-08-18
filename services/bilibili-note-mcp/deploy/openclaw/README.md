# OpenClaw MCP progress bridge

This directory contains the smallest upstream-owned bridge needed to expose MCP progress through
OpenClaw's existing tool update and OpenResponses SSE paths. It is not a fork and is not a runtime
dependency of `bilibili-note-mcp`.

## Frozen source

- OpenClaw release: `2026.7.1-2`
- Git tag: `v2026.7.1-2`
- Peeled commit: `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`
- GitHub source archive SHA-256: `c387453c972ac0b399ddc742e0cef3b576cbf302d37a905b2c9767b85712aca3`
- npm tarball SHA-512:
  `c9c177c8f71b8cde9b50f79a531e8c87abf37b58505a80f7093ff059c983edaf316871c745468095aabe945c4c1dfd6cb0480e0d50308e5cd8aa9dadc24619ee`

## Apply and verify

From an exact checkout of the peeled commit:

```sh
patch -p1 --dry-run < /absolute/path/to/openclaw-2026.7.1-2-mcp-progress.patch
patch -p1 < /absolute/path/to/openclaw-2026.7.1-2-mcp-progress.patch
node node_modules/vitest/vitest.mjs run \
  src/agents/agent-bundle-mcp-runtime.test.ts \
  src/agents/agent-bundle-mcp-tools.materialize.test.ts \
  src/agents/agent-bundle-mcp-tools.request-boundary.test.ts \
  src/agents/embedded-agent-runner/run.incomplete-turn.test.ts \
  src/agents/embedded-agent-runner/run/attempt-trajectory-status.test.ts \
  src/agents/embedded-agent-runner/run/payloads.test.ts \
  src/agents/embedded-agent-subscribe.handlers.lifecycle.test.ts \
  src/agents/embedded-agent-subscribe.handlers.tools.test.ts \
  src/agents/mcp-transport-config.test.ts \
  src/agents/openclaw-owned-tool-runtime-contract.test.ts \
  src/config/mcp-config.test.ts \
  src/gateway/openresponses-http.test.ts
```

The source patch is the authority。Its SHA-256 is
`35ebbfcbc651be6b1914766701b047ec418b51342ef9733c32f388adee39f5a6` and it changes 41 source paths，
including the new shared MCP-schema and private terminal-provenance modules。
The repository CI checks out the exact peeled commit and tree above，verifies the patch digest and
41-path application，then runs the focused Vitest suite、core/test-source type checks、changed-path
lint/format、diff validation and a full OpenClaw build。A Python-only service gate is not sufficient
evidence for this consumer bridge。
The final patch-only verification passed 12 changed test paths / 19 Vitest project files / 934 tests，
core and test-source type checks，41-path lint/format，binary-diff identity and the full OpenClaw
build（90.5s）。The
fresh exact-base replay used only a locally materialized dependency directory and made no network
request；the full build used OpenClaw's local Node fallbacks for pnpm-script steps。A separate
`pnpm install --frozen-lockfile --offline` bootstrap probe remained
`evidence_unavailable` because the local pnpm store lacked `undici-8.6.0.tgz`；no online fetch was used。
Do not replace an installed npm runtime's complete `dist/` directory with an arbitrary full-source
build：the release package may use a different generated chunk/entrypoint layout。The isolated local
runtime is built and packed from the exact patched commit；its CLI、gateway、focused tests、typechecks and
full build must pass before the wrapper is switched。Partial generated-chunk installation is not an
admitted deployment path because terminal projection spans config、materializer、subscriber、runner and
OpenResponses modules。

The patch carries MCP SDK `onprogress` through the existing tool `onUpdate` contract and retains bounded
`current`/`total` values in item events。OpenResponses projects progress as
`response.openclaw_tool_progress` custom SSE only when the update originated from the exact current
terminal-capable MCP call。A frozen process-local call identity binds server、tool and tool-call id；the
subscriber carries its one-shot provenance beside the typed item update，and OpenResponses additionally
requires the frozen lifecycle's run id、session key、agent id、generation and a strictly increasing event
sequence。Missing、forged、replayed、stale、cross-session/cross-agent or other-tool progress is ignored，even
when it reuses the same public run id。Ordinary nonterminal MCP progress remains available to OpenClaw's
native item/liveness paths but is not projected by this terminal-only SSE contract。Progress is never
projected as
`response.output_text.delta`，so an OpenResponses client cannot persist it as assistant text。
Terminal Note ownership uses a separate run-local one-shot broker。The MCP adapter registers a result
only after output-schema、text-parity、UTF-8 and byte-bound validation；the embedded subscriber then
consumes the real AgentSession-cloned result by exact `toolCallId` and rechecks the terminal flag、single
text block、server、tool and structured content before recovering the opaque verified record。A changed、
foreign、replayed or second result burns or misses that run-local record and cannot become terminal text。
This bridge is required because the real AgentSession clones a valid agent-tool result before emitting
`tool_execution_end`；object identity alone therefore loses legitimate terminal provenance even though
the MCP call completed successfully。
For a normal nonterminal MCP，the materializer also remembers the last valid bounded progress。If the
MCP returns a successful `CallToolResult` before a final `current == total` update is observable，
OpenClaw emits exactly one success-derived completion update before returning the tool result；an
error result never synthesizes completion。For a server configured with `terminalResultField`，both
producer-supplied `current == total` updates and that host-derived completion are suppressed。Its last
public processing update must remain incomplete（the Bilibili service currently publishes 89/100）；
only the verified terminal Note followed by OpenResponses completion represents success。
The same trusted typed update touches OpenClaw's diagnostic run activity with
`tool:<name>:progress`，preventing stuck-session recovery from aborting a healthy long-running MCP
call。Untyped partial content cannot refresh liveness。
The same bridge forwards the agent-tool `AbortSignal` through `SessionMcpRuntime` into the MCP SDK
request options。Focused tests hold a tool call open，abort it，and require the server to observe
`notifications/cancelled`；the signal is never treated as progress or success。

The current LobeHub SaaS OpenResponses parser treats text and reasoning deltas as append-only and has
no replaceable progress event。It ignores this custom event as visible text and keeps its own native
single waiting indicator。A true same-line percentage/status widget requires a separately versioned
LobeHub client change；carriage returns、ANSI control codes and repeated text deltas are forbidden
workarounds。

The v3 public MCP result is text-only；no asset cache、URL rewrite、terminal image preflight or
asset-serving loopback is part of the architecture。The server config requires
`terminalResultField: rendered_markdown`，`terminalResultMaxBytes <= 262144` and `maxCallsPerRun: 1`。
OpenClaw retains each tool's exact advertised `outputSchema` across paginated catalog discovery and
catalog invalidation。Before a terminal call consumes its per-run budget or reaches the backend，the
tool-specific schema must exist and compile through the same MCP JSON Schema validator used by the
runtime；compiled validators are cached only by schema-object identity。After a non-error backend result，
the complete `structuredContent` must validate against that exact schema before OpenClaw checks the
configured top-level field、one TextContent parity、UTF-8 round trip and byte cap or returns
`terminate:true`。That exact returned result object maps to one frozen process-local terminal record；
the same record identity must survive subscriber and runner transport and remain present in a private
WeakSet when OpenResponses consumes it exactly once。No public `details` field、terminal text string、record clone、
stale replay or
foreign object can establish terminal provenance。There is no
domain-specific schema registry or Bilibili schema name in OpenClaw，and
ordinary nonterminal MCP tools keep their prior result semantics。
OpenClaw freezes the terminal obligation from each effective MCP server's static transport config when
the session runtime is created，before startup、`tools/list` or schema materialization can fail。The
materialized run carries that frozen obligation even when the live catalog is empty and exposes only
diagnostics；startup failure、`tools/list` timeout and invalid advertised schema therefore cannot silently
restore ordinary assistant output。OpenClaw marks the run terminal-capable at lifecycle start and uses one
request-local finalizer as the only owner of terminal SSE。Lifecycle end records a fact but cannot complete the response；success needs
that end、a resolved command and the exact opaque record，then every Note projection is built from the
same verified bytes and followed by one `[DONE]`。Missing/forged metadata、lifecycle error or command
rejection emits exactly one `response.failed` with `output=[]` and one `[DONE]`，never unverified Note
bytes、`response.output_text.done` or `response.completed`；ordinary nonterminal semantics remain unchanged。
Error、mixed/multiple call、cancel、missing/wrong/cross-tool/extra-field/type-invalid schema or
lone-surrogate paths fail closed without publishing terminal Note or completion progress。A client disconnect while
the agent command is still in flight propagates abort through MCP；a disconnect after the private tool
result has already resolved may race too late to undo that private computation。In both cases the closed
OpenResponses writer cannot publish terminal text、`response.output_text.done`、`response.completed` or
`[DONE]` after the disconnect。The clean pinned install and current exact-byte live receipts are recorded in
`../../bilibili-note.md`。These receipts admit only a local `CURRENT_POC`, not production use.

The agent exposes exactly two domain tools：route one direct Bilibili URL to
`bilibili_note.create`，and any natural-language Bilibili research topic to
`bilibili_note.search_and_create`。The second tool owns fresh anonymous search，the default-2/hard-3
successful-note target，a bounded nine-candidate fallback budget，dedupe，exact normalized creator before
extended related accounts、newest-first ordering inside that group，deterministic topic relevance ranking，
one request-local rolling window capped at two active Notes，continuous-prefix result authority and
fail-closed exact-target semantics。
OpenClaw must call it once per new user message；it must not search the web itself or loop over returned
URLs。An identical later message is a new execution request，not permission to reuse conversational
history。
This is enforced by setting `mcp.servers.bilibili-note.maxCallsPerRun` to `1`。The pinned patch carries
that positive-integer budget from config into the run-scoped MCP catalog and consumes it before the
first backend call。A duplicate call inside that same run therefore fails before MCP execution and
cannot redownload a video or restart visible progress。The budget is rebuilt for the next user turn，
which must execute a fresh MCP call。The option is absent by default and does not change other servers。

The isolated consumer config sets `mcp.sessionIdleTtlMs` to ten minutes。An idle stdio MCP may remain
parented by OpenClaw inside that bounded reuse window，but its request-local yt-dlp、ffmpeg、ffprobe and
temporary workspaces must already be gone。The session owner then reaps the idle MCP process at TTL；a
parented idle server inside this window is not classified as an orphan。

For natural-language requests，the workspace agent extracts only the actual Bilibili subject keywords
before its one tool call。It removes task-wrapper wording such as `搜索 Bilibili 上关于`、`总结一下` and
`解析视频`，while preserving domain keywords such as `趋势交易 支撑阻力`。The MCP remains the sole
search/ranking/traversal authority；this normalization only prevents instruction boilerplate from
diluting lexical relevance。

## LobeHub browser boundary

The current LobeHub web client requires browser CORS/private-network preflight and omits the
OpenResponses `type: "message"` discriminator on role/content input items. OpenClaw's native endpoint
does not answer that preflight. Run the bounded loopback consumer adapter on port `18892`:

```sh
python deploy/openclaw/lobehub_loopback_proxy.py
```

Configure LobeHub's OpenAI-compatible Responses endpoint as `http://127.0.0.1:18892/v1`, model
`openclaw/bilibili-note`, and use the same `OPENCLAW_GATEWAY_TOKEN` as its API key. The adapter admits
only that exact model with boolean `stream: true` on `/v1/responses` before any upstream effect，requires
the upstream media type to be exact `text/event-stream` before exposing headers or bytes，and binds every
accepted SSE response resource to the same model；an ordinary or non-streaming OpenClaw completion cannot
become a Note。
The request body is parsed exactly once under strict JSON：duplicate decoded keys at any object depth，
`NaN`/`Infinity`/`-Infinity` and floating-point overflow are rejected before upstream。Exact model and
boolean stream are validated on that original parsed object；only then may its input message receive the
LobeHub discriminator，with non-finite serialization forbidden and the size cap rechecked。
The adapter admits
the exact web `https://app.lobehub.com` Origin. The native desktop client omits Origin, so its exact
preflight must declare the path's expected method and `authorization`. Every actual web or native
request must carry exactly one syntactically valid Bearer credential；its secret value remains validated
only by OpenClaw. Both modes bind exact GET `/v1/models` and POST `/v1/responses` methods，reject every
`x-openclaw-*` request header before body/upstream work，and forward only Authorization、Content-Type、
Accept plus the host-forced identity encoding。The request model alias is therefore the sole agent selector；
client headers cannot replace the agent，underlying model，session or future OpenClaw identity。Only
Content-Type and Cache-Control may return from upstream；cookies and private/machine headers are never
published，including on malformed or incomplete 200 SSE streams。Both modes retain a 1 MiB request body and loopback upstream
`127.0.0.1:18893`. The request cap is checked again after adding the missing OpenResponses message
discriminator and before any upstream effect。For SSE it parses only framing and event type，never Note
content：closed lifecycle and `response.openclaw_tool_progress` frames stream immediately，while the
output phase requires delta* → text-done → content-part-done → output-item-done → completed，terminal
failure requires failed directly，and either path commits byte-for-byte only after logical
`data: [DONE]`。Duplicate、conflicting、reordered、unknown or post-terminal events fail closed。Non-
OpenResponses ordinary responses retain a 1 MiB cap；SSE forces upstream `Accept-Encoding: identity` and derives its bounds
from the 256 KiB terminal contract：a 1,581,056-byte frame cap covers worst-case JSON
control-character escaping plus
bounded framing overhead，preterminal frames have an independent 262,144-byte aggregate cap，and the
five terminal projections plus logical DONE have an 8,167,488-byte logical cap。It has no asset-serving route. A web Origin must occur exactly once and match；native requests must omit
it and satisfy the stricter preflight/Bearer contract above. Duplicate/wrong Origin, missing/duplicate/
malformed authorization, any other raw request-target (including doubled slashes, dot-segments,
encodings, absolute form, or queries), duplicate/oversized Content-Length, and transfer-encoded request
bodies fail closed before any upstream request.

The adapter admits at most eight active loopback connections and never queues work after admission.
An additional accepted socket receives a bounded `503 server_saturated` response before a handler
thread or upstream request exists. Header parsing has a five-second absolute deadline from accept；an
admitted body has a separate 15-second absolute deadline and must deliver its exact declared length
before forwarding. Slow downstream writes are bounded to five seconds per write. These defaults are
constructor-injectable for deterministic tests，not deployment configuration. Every response closes
the client connection，and shutdown joins the bounded non-daemon handler set.

The proxy must use incremental upstream reads. Its integration tests hold the terminal phase open after
one typed progress event and require that progress to reach the downstream client immediately。They
also require early output followed by cap+1、deadline、EOF or malformed framing to expose no terminal
bytes，every split of a mixed-newline valid sequence to preserve exact bytes，one-byte boundary-free
fragmentation to remain linear and release capacity，and logical DONE to release exact bytes without
waiting for or admitting a physical tail。This preserves
visible liveness without admitting a success that a later response-bound failure would invalidate.
