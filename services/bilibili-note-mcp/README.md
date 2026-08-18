# Bilibili Note MCP

The frozen implementation handoff and acceptance design live in
[`bilibili-note.md`](./bilibili-note.md) beside this standalone service。

Standalone Python stdio MCP that either converts one direct Bilibili video URL into a concise Chinese
trading-thought and strategy summary, or searches Bilibili from a natural-language research topic and
parses a bounded candidate set through a request-local rolling window of at most two. Speech is aligned with transient internal visual analysis; screenshots are never
returned, published, or persisted by the service. There is no import, runtime, storage, or protocol
dependency on Vibe Trader or the repository root Python project.

The public tools are:

```text
bilibili_note.create({"url":"https://www.bilibili.com/video/BV..."})
bilibili_note.search_and_create({"query":"趋势交易 支撑阻力","max_videos":2})
```

Success returns one Markdown `TextContent` and a closed
`bilibili-note.result/v3` structured value containing only that `rendered_markdown`。The public
contract has no evidence IDs、timestamps、provenance、model identifiers、brief hash、image or transcript
fields。Those values remain request-internal audit material used to validate the brief before return。
Failure returns one `bilibili-note.error/v1` value。

Every successful Note contains exactly one title，the host-owned scope
`以下内容仅为未验证的交易观点摘要，须另行研究验证。` exactly once，and three sections：`核心策略`、`具体方法`、`风险管理`。
Every public item is one typed `PublicRuleV1.rule_body` rendered only as
`- 规则描述：<Markdown-literal rule_body>`；the host never infers or rewrites its positive、negative、
permission、priority or avoidance semantics。
It contains no video list、per-video heading、source-claim prefix、failure detail、Research question/falsifier
template、unknown list、evidence locator or provenance。

`search_and_create` uses one anonymous first-page Bilibili video-search request。The query is normalized
only by generic Unicode separator rules；there is no trading vocabulary、creator alias、video-specific
rule or model-authored query expansion。A candidate must match every normalized query unit across
title、author、tags or description。This prevents partial homonyms such as 罗尼 in 非泼罗尼 from
entering media processing。When any result author is either the exact normalized query or that exact
identity plus only the known `官方/官方账号` decoration，that author identity becomes mandatory；otherwise a
single-unit compact query also requires one fully bounded occurrence。The adapter deduplicates exact
BV IDs。Creator queries exclude extended accounts such as `<query>-黄金` or `<query>-反诈曝光`，then use
newest publication time；topic queries retain lexical relevance as the
primary order。It defaults to a target of 2 successful videos and hard-caps that target at 3，freezes
at most 9 fallback candidates，then returns one bounded systematic synthesis of all successfully
parsed strategy facts。The host assigns every input rule a closed ID；one text-only call proposes at
most 3 core principles、6 methods and 4 risk rules with exact same-category support IDs，while an
independent reject-only call checks complete coverage、no-new-claim entailment、polarity、material
conditions、safe episode-only omission and decision-value order。Every input ID must occur exactly once
as support or as an independently accepted episode-only omission。Neither call receives the query、
title or images，and any malformed or rejected synthesis fails before the final `89` validation event。
At most two candidate Notes
are active；a terminal slot immediately admits the next lowest pending candidate while the target is
still unresolved。The lowest continuous terminal prefix is the only result authority，so completion
order cannot change the Note or first failure。One failure does not discard another success and is not exposed in the Note，but exhausting
the bounded fallback set below the requested successful-video target returns `SEARCH_TARGET_UNMET`
and never a partial Note。It does not discover browser cookies or search other sites；an operator may explicitly
configure an authorized Netscape Cookie file for otherwise inaccessible Bilibili media。

Operator-only JSONL accounts for every candidate task actually launched，including speculative work
that is later cancelled when the lowest successful prefix closes。Each launched task has exactly one
closed outcome：`succeeded`、`failed` or `cancelled`；therefore every `batch_completed` event satisfies
`attempted == succeeded + failed + cancelled`。Cancellation is never reported as failure，and the
accounting does not change rolling scheduling、progress or public Note bytes。External request
cancellation cancels and joins active candidates，emits their closed cancellation/batch diagnostics，
then propagates cancellation normally。

The summary is a research source only. It is not fact verification, backtest evidence,
investment advice, a signal, or trading authorization.

## Pipeline

1. Validate one direct Bilibili URL，bind BV/cid/part/duration through the public metadata API，then
   resolve one anonymous 720P-or-better MP4 through Bilibili's public `playurl` API。The worker accepts
   only one declared-size-bounded signed HTTPS media URL on the closed Bilibili CDN suffix set and
   gives that URL to the pinned `yt-dlp` generic downloader；it never fetches the risk-controlled
   public video webpage and requires no browser cookie for ordinary public 720P media。The parent owns
   a 360-second total download deadline and terminates、kills and reaps the
   whole process group before success、timeout/cancellation or any communication failure returns。The same shared lifecycle owner protects
   every `ffmpeg`/`ffprobe` subprocess，so an exited leader cannot leave a redirected descendant alive
   to perform a late temporary-workspace write。`ffprobe` verifies actual
   duration、audio、dimensions and byte size before ASR；a 5-minute preview advertised as a 31-minute
   source fails as `media_access_restricted_preview` rather than producing a partial Note。Sources over
   96 minutes fail before media download because 128 complete 45-second transcript windows are the
   closed internal capacity。
2. Transcribe complete audio in host-owned 45-second windows。A request-local window fan-out remains
   bounded，while the shared `SiliconFlowAsr` instance is the sole provider-capacity authority and
   permits at most three actual provider calls in flight across all concurrent candidates；retry sleep
   and JSON parsing do not hold a permit。A window gets at most four bounded attempts for transport、5xx、429 or malformed responses；
   non-429 4xx、empty text and local media errors fail that candidate。Provider bodies are streamed
   under 256 KiB/window，normalized text is at most 16 KiB/window，and the aggregate transcript is at
   most 2 MiB UTF-8。
3. Rank only windows with generic deictic、screen-interaction or visible-change speech cues。Trading
   vocabulary and numbers never affect the score，and zero-score windows never consume one of the
   three ranked slots。
4. Freeze the three highest-intent distinct windows and two coverage anchors，then run all their
   decode jobs in one request-local scope while every actual ffmpeg child shares one three-permit
   semaphore。Reassemble results by the frozen ordinal，independent of completion order，and cancel/
   join every sibling before returning one failure。Decode five candidates for each intent window。
   Normally retain the deterministic BICUBIC-profile integer-distance medoid；for only the highest-
   ranked window containing a generic ordered-relation speech cue，retain earliest + the medoid of the
   three interior probes + latest as one ordered three-frame moment。The interior medoid excludes both
   endpoints；ties prefer the probe nearest the real speech-window midpoint。Distance is exactly
   `5 * global_SAD + 84 * max_40x30_tile_SAD`。Duplicate timestamps or assets atomically degrade that
   moment to one static medoid。Add only enough singleton coverage anchors to keep the total within five，
   then apply global first-owner digest dedupe。The final catalog has exactly two to five groups and two
   to five frames，at most one three-frame group，and no two-frame group。Every three-frame member carries
   a host-only `ordered_relation_cue`；a replacement MediaPort cannot infer authorization from group size。
   Decode work is
   bounded to three concurrent
   ffmpeg children；frames are never upscaled，fit within 1920×1080/1080×1920，retain a 720-pixel
   minimum side，and are capped at 8 MiB each/32 MiB aggregate。
5. Ask the vision model once to author a candidate from each time-aligned visual group with speech。
   The live request path does not make a second semantic-model call：that former reject-only gate
   returned unlocalized global booleans，could contradict its own accepted per-rule verdicts and could
   time out after otherwise successful media、ASR and visual work。It remains available as an offline
   evaluation component，not as user-request terminal authority。The live host instead enforces the
   provider's exact JSON schema、bounded rule/group totals、existing transcript refs、visual-group
   positional totality、category arrays、Simplified-Chinese representation、public-text safety and
   deterministic rendering before returning a Note。There is no automatic model retry or repair call。
   The authoring call removes greetings, promotion,
   repetition, jokes and tangents, classify retained material exactly once under one precedence
   contract：first choose risk management when the operative consequence is stop、exit、invalidation、
   position-size or exposure control；otherwise choose method whenever the rule has an observable
   entry、avoidance、waiting、filter or confirmation condition, including one tied to a market regime；
   only otherwise choose core strategy for an abstract strategy-wide objective、governing principle、
   regime preference or directional stance with no operational trigger or consequence。The three
   typed category arrays are the only public rule-text authority。For every host group the
   model must return exactly one `supports_rule` with a zero-based `rule_index`，or
   `no_material_increment` with a null index。Top-level public items cite transcript E-IDs；visual
   dispositions never self-report prose、refs or frame membership。The host owns exact group/frame
   totality；`rule_index` addresses the single global concatenation core → method → risk，and the host
   derives private E/V binding for that referenced public rule without appending or
   rewriting text。There is no second visual claim that can diverge from or duplicate the Note。
   Each group is analyzed independently；the prompt forbids cross-group continuity、cursor movement、
   state-transition、causality and before/after inference。Ordered relations are allowed only inside the
   one host-authorized three-frame group。
   Source/visual-attribution prose is rejected by semantic admission rather than a host vocabulary
   list or rewrite。The provider wire requires
   `rule_body` and forbids the former `text` key；that typed rule remains intact through direct creation
   and cross-video aggregation。Direct URL creation never changes a verified rule。For a search result，
   a private synthesis call may author a reusable same-category rule only with exact host support IDs，
   and a second reject-only call independently checks entailment、polarity、every applicable symbol or
   instrument、timeframe、level、threshold、indicator、confirmation、exception and invalidation condition，
   Simplified-Chinese prose，plus safe omission of episode-only
   observations。The host enforces exact total ID coverage and the 3/6/4 search bounds；no truncation、
   padding、fallback or third call exists。The renderer alone contributes the fixed
   `规则描述：` frame，so imperative、negative、permission、priority and avoidance forms remain source
   semantics instead of host-inferred modality。
   Evidence maturity is governed structurally rather than by an open-ended phrase list。The renderer
   inserts the one exact host-owned unverified-research scope after H1 and before every section and
   bullet；the same deterministic structure gate checks direct and cross-video results。Missing、moved、
   duplicated or mutated scope text，a naked bullet，or any bullet without the exact fixed frame fails
   closed as `unverified_scope_invalid`。
   Provider-native
   `json_schema` is generated from the strict Pydantic wire model；
   malformed/refused/truncated responses still fail closed without an automatic repair retry。Vision
   request JSON is capped at 48 MiB，response body at 256 KiB and message content at 128 KiB。
6. Validate candidate totality、internal references、visual integration、Chinese representation、canonical hashes and
   Markdown parity；destroy the
   temporary media/audio/frame workspace before returning text only.

For a topic request，the search adapter freezes the candidate set before step 1 and invokes this same
pipeline with no more than two active request-local workspaces。Before public selection the host checks
the entire input through one closed catalog。Every one-to-three-source result uses the same verified
synthesis representation。The synthesis must assign every host ID exactly once to one same-category
output or an episode-only omission，and the independent verifier must accept every output、omission and
global completeness verdict。The final search summary is bounded to 3/6/4。Malformed、over-bound or
semantically rejected results fail before progress 89 without truncation、fallback、repair retry、cache
reuse or a third model call。Direct URL creation remains unchanged and adds neither aggregation call。

MCP progress reports real artifact gates at `5, 25, 50, 65, 75, 89`. Source acquisition repeats
the last verified progress every 15 seconds without inventing completion：5 before media verification，
then the latest 25..49 media/ASR gate while transcription is still running。ASR reports
completed windows between `25` and `49`; a long visual call emits bounded liveness messages between
`66` and `74` with elapsed wait seconds。Search reserves `89` until after aggregation、global
uniqueness、rendering、purity and terminal byte validation；candidate work is capped at `88`。The MCP
handler yields at a cancellation checkpoint after `89` and before constructing a terminal success。
Neither tool fabricates transport-level `90` or `100` completion events。

## Runtime and isolation

- CPython `3.14.6` is the latest passing local runtime; service metadata requires `>=3.14,<3.15`.
- uv is exactly `0.12.3`; the service-local `uv.lock` is dependency authority.
- The locked yt-dlp extractor is the sole Bilibili playurl、signing and fingerprint authority.
- `ffmpeg` and `ffprobe` read owner-local paths with network protocols disabled.
- `SILICONFLOW_API_KEY` is read from the child environment。An optional absolute regular non-symlink
  `BILIBILI_NOTE_COOKIE_FILE` may supply operator-authorized access；the default local consumer does not
  configure it。The service never reads a secrets directory、`OPENAI_API_KEY`、browser cookie stores、
  trade packages or ambient proxy settings.
- The yt-dlp worker receives only a bounded canonical request and a sanitized environment；the
  SiliconFlow key is not inherited。Its stdout is a bounded closed receipt，while the parent remains
  the authority for media identity、duration、dimensions and digest。The worker disables yt-dlp's
  internal network、extractor、fragment and file-access retry loops；one four-attempt owner retries only
  typed transport/content-short、HTTP 408/425/429 or 5xx causes。Its progress hook rejects
  declared/estimated or observed bytes above the
  2 GiB aggregate request cap，and both worker and parent remove `source.*` partials on failure、timeout、
  output-cap or cancellation。The receipt exposes only integer attempts、retries、rate limits and
  downloaded bytes plus closed adapter identity fields；no upstream error text is projected。Worker
  receipt v4 keeps success minimal at those counters plus id/format/adapter。Failure alone adds closed
  `failure_family`、`failure_phase`、`attempt_downloaded_bytes`、`outer_exception_family`、`chain_depth`
  and `attempt_elapsed_ms` diagnostics for the final failed attempt。Request `downloaded_bytes` remains
  cumulative across attempts；the phase is derived only from final-attempt bytes，so bytes consumed by
  an earlier retry cannot mislabel a zero-byte final failure。The outer family is one strict typed enum
  and never comes from exception text or class-name strings。The parent rejects unknown/overflow values、
  phase/byte disagreement、final-attempt bytes above request bytes and extra receipt fields。A cycle-safe
  depth-8 chain scan uses fixed precedence：media limit，exact HTTP status，
  transport/content-short，access，permanent extractor/unavailable，then unknown。Thus any typed
  `TransportError` occurrence remains retryable even when its inner cause is builtin `TimeoutError`；a
  bare builtin timeout is unknown and is not retried。The optional operator-event sink variable is not
  inherited by the worker and cannot change its command、environment or outcome。
- Every `ffmpeg`、`ffprobe` and worker stdout/stderr pipe is drained incrementally under an explicit
  per-call cap+1 ceiling。A timeout、cancellation、writer/read failure or output overflow enters the same
  TERM→bounded grace→KILL process-group owner and does not return before reap。The proxied metadata path
  also uses HTTP streaming before its 2 MiB cap instead of `response.content` buffering。
- Metadata/search egress remains exact-host、public-DNS-pinned and redirect-free。After canonical URL
  validation，the pinned `yt-dlp` adapter owns Bilibili page/WBI/CDN requests；the host revalidates
  actual identity、duration、audio and HD dimensions before use。Fake-IP hosts may explicitly set an unauthenticated loopback HTTP
  `BILIBILI_NOTE_EGRESS_PROXY`; remote, credentialed, or ambient proxies are rejected.
- With the admitted loopback proxy，metadata/search remains on the closed HTTP client while `yt-dlp`
  owns retried media acquisition；downloaded size and digest checks remain request-local。When a local
  Fake-IP resolver requires the metadata proxy but that proxy is unsuitable for large CDN transfers，
  define `BILIBILI_NOTE_MEDIA_PROXY=''` to keep metadata/search on the admitted proxy and let the
  canonical-URL-only media worker connect directly。If the override is absent，media inherits
  `BILIBILI_NOTE_EGRESS_PROXY`。

## Setup and checks

```bash
uvx --from 'uv==0.12.3' uv sync --frozen --all-groups
uvx --from 'uv==0.12.3' uv run python scripts/export_schemas.py --check
uvx --from 'uv==0.12.3' uv run ruff check src tests scripts
uvx --from 'uv==0.12.3' uv run ruff format --check src tests scripts
uvx --from 'uv==0.12.3' uv run mypy src
uvx --from 'uv==0.12.3' uv run python -m pytest -q
uvx --from 'uv==0.12.3' uv run python -m bilibili_note_mcp --self-check
```

Bounded live run (the service accepts only an already-exported process environment variable and never
knows or opens a secrets-file path):

```bash
export SILICONFLOW_API_KEY='set-this-in-your-private-shell-environment'
export BILIBILI_NOTE_EGRESS_PROXY='http://127.0.0.1:1082' # only when required
export BILIBILI_NOTE_MEDIA_PROXY='' # optional: direct CDN media with proxied metadata/search
uvx --from 'uv==0.12.3' uv run python -m bilibili_note_mcp \
  --create 'https://www.bilibili.com/video/BV1uHuQ6pEFr/'
```

Normal stdio command:

```bash
uvx --from 'uv==0.12.3' uv run bilibili-note-mcp
```

The public `--deterministic` mode is fixture-only and therefore also requires `--fixture-root`；the CLI
rejects a missing fixture root before constructing source adapters、stdio or any network effect。The
internal `--self-check` continues to create and own its temporary fixture explicitly。

Provider-controlled JSON now has one strict decoder across Bilibili metadata/search，ASR，ffprobe，the
media worker receipt and every model role。Duplicate decoded keys，non-finite numbers，malformed roots
and excessive nesting cannot enter media，visual，model or Note construction。Bilibili source fields also
require exact non-boolean types and host bounds before media download；no `int()`/`str()` coercion grants
provider authority。Both actual-media ffprobe consumers likewise require width and height to be exact
non-boolean JSON integers，and duration/size to be bounded unsigned decimal strings，before a media artifact
can reach ASR or frame extraction。The direct author prompt carries all twelve material-condition
classes，polarity and reusable-abstraction constraints；strict host admission checks the bounded typed
result before progress 75。The separate reject-only verifier is retained for offline evaluation only
and cannot turn an otherwise valid live request into an empty terminal response。Public-text detection uses
one generic tag-shaped grammar rather than a finite browser-element list。After browser-visible
canonicalization，every compact ASCII `<name...>` or `</name...>` form fails closed，including legacy、
modern and unknown/custom names plus entity、full-width and Markdown-escaped variants。Unambiguous spaced
comparisons such as `EMA5 < EMA20 > EMA60` and `0 < time > 1` remain prose and are deterministically
escaped；ambiguous compact `EMA5<EMA20>EMA60` and `0<time>1` are rejected。
Private evidence IDs、search catalog IDs and internal digests use one domain-owned closed grammar after
the same browser-visible canonicalization。Bounded inline-whitespace variants such as `E 0 0 1`、
`S 0 1 : C 0 1`、`&Tab;`/numeric-entity separators and a spaced 64-hex digest are rejected at direct
authoring、search synthesis、subject projection and final rendered admission。The field grammar includes
entity-derived line separators such as `&NewLine;`；the final document gate splits literal host-rendered
CR/LF before entity decoding，so provider text cannot hide an identity while independent Markdown lines
cannot synthesize one。There is no renderer-only replacement or provider repair。
Public H1 subjects use explicit origin semantics：a source author may retain a narrowly bounded one- or
two-token proper/technical name，including lower-camel names，while a multi-author search query must already
contain Chinese-facing prose or falls back to the host-owned `视频` subject。The final renderer reapplies the
author-safe sink rule；no model call repairs or invents a title。

Before MCP 2.0.0 sees a stdio frame，one bounded raw-byte reader rejects invalid UTF-8 before the SDK's
replacement decoder，then the strict JSON-RPC admission owner requires a unique-key object at every depth，
finite signed-64-bit numbers，at most 32 nesting levels and at most 1 MiB。Duplicate
method、tool-name or argument keys—including Unicode-escaped aliases—cannot use SDK last-key-wins parsing
to start an operator run or tool effect；invalid bytes have zero effect and do not prevent the next valid
frame。The adapter is pinned to the exact MCP 2.0.0 wrapper identity and restores it on every exit path。

The LobeHub loopback binds `/v1/models` to GET and `/v1/responses` to POST before reading a body or opening
an upstream connection。It rejects the complete `x-openclaw-*` request-header namespace so callers cannot
override the body-selected Bilibili agent，underlying model，session or future OpenClaw identity fields。
Only a closed request-header set reaches OpenClaw and only `Content-Type`/`Cache-Control` may return from
the upstream；cookies and machine/private headers never cross the browser boundary。Every downstream
response class also uses a finite host-owned header set，and the loopback intentionally emits neither
`Server` nor `Date`，so Python/runtime identity is not exposed。

The current standalone gate is schema-clean，Ruff-clean over 66 Python files，strict-mypy-clean over
44 package source files plus the loopback，self-check-clean and `878 passed` on CPython `3.14.6`。The exact OpenClaw patch is
SHA-256 `35ebbfcbc651be6b1914766701b047ec418b51342ef9733c32f388adee39f5a6` against base
`0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`；its static terminal obligation prevents MCP startup，
`tools/list` or schema failure from falling back to ordinary assistant output。

The following exact live runtime surface belongs to the rejected v15 predecessor and is retained only
as a comparison baseline；it is not v16 admission evidence：
`03b8b7b083cd73b988b52572a2ecc2ce4cabacde6661223ece599e8ba3892595`。A restarted
MCP → OpenClaw → OpenResponses → bounded-loopback run completed direct `BV1uHuQ6pEFr` in `119.283s`，
with one correlated item，last progress `89`，no `90/100`，exact Note delta/done/completed bytes and
every public item behind the host-owned `规则描述：` frame。Two fresh executions of the exact two-video
topic query completed in `210.500s` and `101.484s`；they had distinct operator run IDs、OpenResponses
response/item IDs and Note hashes，and each independently performed three media、ASR and vision
pipelines under `max_active=2`。These samples expose network/model long-tail variation and are not a
latency SLO。Disconnecting immediately after `89` at `71.850s` emitted no Note bytes、terminal response or
`[DONE]`。Private exact-source runs on `BV1j6um69EJn` and `BV1uHuQ6pEFr` retained respectively four
and five singleton frames；manual review found the public rule bindings consistent with the visible
MA/RSI、trend-line、Fibonacci、support/resistance and structure content。No frame is public。

`stdout` is reserved for MCP frames. OpenClaw registration and LobeHub admission are separate
consumer slices. Since public v3 is text-only, no asset server or LobeHub asset projection is required.
The `18892` loopback consumer adapter is a fixed eight-connection boundary with fail-fast `503`
saturation，absolute header/body read deadlines，exact-length body admission and bounded downstream
writes。The 1 MiB request cap is checked both before and after OpenResponses item normalization and any
post-normalization overflow has zero upstream effect。Upstream response streaming has one absolute
930-second deadline measured from accepted request start。Non-OpenResponses ordinary responses retain a
1 MiB cap；the dedicated `/v1/responses` path requires request `stream` to be the boolean `true` and
requires exact upstream `text/event-stream` before any upstream header or body is exposed。Its SSE
forces upstream `Accept-Encoding: identity` and derives its bounds from the admitted 256 KiB terminal
Note：each frame is at most `6 × 262144 + 8192 = 1581056` bytes for worst-case JSON control-character
escaping，the
preterminal phase is independently capped at 262144 bytes，and the logical response is at most
`262144 + 5 × 1581056 + 64 = 8167488` bytes。This admits all five exact terminal projections without
false rejection while retaining finite transport。A concurrent
downstream-EOF watcher closes the upstream socket immediately so cancellation can propagate。Closed
lifecycle and `response.openclaw_tool_progress` SSE frames pass immediately。Starting with the first
output/terminal frame，the loopback buffers exact bytes and commits them only after
the full delta → text-done → content-done → item-done → completed chain，or a preterminal
`response.failed`，plus logical `data: [DONE]`。Cap+1、deadline、disconnect、EOF
or malformed framing before that point discards the terminal buffer and never manufactures JSON、
`[DONE]` or Note bytes；logical DONE closes upstream without waiting for a physical tail。Rejected or
incomplete requests have zero upstream effect.
The proxy pre-creates one upstream socket，disables `HTTPConnection.auto_open` and attaches the downstream
EOF watcher before connect、request or response-header wait。A browser disconnect therefore interrupts any
of those stages immediately，cannot reopen an unmonitored socket，and releases the one connection permit
without waiting for the 930-second deadline。Timer/watcher threads only close the raw socket；the handler
thread alone closes `HTTPResponse` and `HTTPConnection` after both auxiliaries are joined。
Request and response `Content-Length` share one parser across loopback、HTTPX and AIOHTTP consumers：one
nonempty ASCII decimal digit sequence，one occurrence，and a digit/value bound before integer parsing。
Signs、underscores、Unicode digits、duplicates and overflow fail before an upstream effect、body/JSON/model
work or later progress。Every OpenResponses usage counter is an exact non-boolean integer from zero through
JavaScript `Number.MAX_SAFE_INTEGER`；an oversized、fractional、negative、non-finite or boolean created、
completed or failed resource cannot commit terminal bytes。The loopback also validates the complete first
`response.created` frame before publishing downstream HTTP 200、CORS or any upstream response header；an
invalid first resource yields only a host-owned 502，while a valid frame and its already-buffered progress
drain immediately after admission。
The loopback admits `/v1/responses` only for the exact standalone body
`{model:"openclaw/bilibili-note",stream:true,input:[{role:"user",content:<nonblank text>}]}`。It adds only
the upstream-required message type after admission。Continuity/session fields，instructions、tools and tool
choice，non-user roles，content arrays，URL/file/image/audio resources，multiple messages and every unknown
top-level or nested field fail before upstream。The SSE gate requires the same model on every response
resource；non-SSE upstream responses and ordinary OpenClaw agent output cannot satisfy this boundary。
The dedicated request bytes must first be exact UTF-8 without a BOM；UTF-16/32 and auto-detectable JSON
encodings fail before upstream。The request and every OpenResponses SSE frame then share one strict JSON authority。Duplicate decoded
keys，non-finite numbers，float overflow and nesting beyond 128 levels are rejected at any depth。The
request's original model/stream contract is admitted before the already-parsed input is normalized；
serialization forbids non-finite values and the post-normalization 1 MiB cap remains in force。The upstream
must return exact HTTP 200 before its media type，headers or body can enter the dedicated response path。
Every OpenResponses output/content index is an exact non-boolean integer zero；a boolean lookalike is
discarded before its frame or any terminal Note can reach LobeHub，and the connection permit is released。
The versioned patch under `deploy/openclaw/` carries MCP progress through OpenClaw as typed custom SSE
events without projecting it into assistant text。Trusted typed progress also refreshes OpenClaw's
stuck-session liveness owner so long MCP calls are not aborted as idle。The current LobeHub
OpenResponses client has no
replaceable progress-text event；its native single waiting status remains visible until the clean
terminal brief arrives。
Every schema-valid MCP call creates one request-scoped operator JSONL identity。A fresh random `run_id`
distinguishes executions while a SHA-256 `input_ref` correlates the same canonical input without logging
it。Closed bounded events cover request terminal、search effect、media receipt、ASR windows、vision call、
candidate and batch counters；title、URL、BV、query、transcript、frame and Note content are excluded。All
events in concurrent candidate work retain the same request identity and monotonic sequence，and this
diagnostic seam cannot change public schema、progress or Note outcome。By default each bounded line uses
one fd2 write。`BILIBILI_NOTE_OPERATOR_EVENTS_PATH` may instead name an absolute JSONL file whose parent
already exists；each line is one `O_APPEND` write。The service creates no parent directory、rotation or
collector，never includes the sink path in an event，and drops invalid/unwritable sink diagnostics without
changing the request result。The dedicated OpenClaw server config
sets `maxCallsPerRun: 1`. The pinned adapter counts the first
domain-tool attempt before execution, so a failed result cannot trigger a second video download or
reset progress in the same agent run. Calls beyond the budget fail before reaching the MCP; omitting
the option leaves other MCP servers unchanged.

Tool discovery intentionally reports `readOnlyHint=false`, `destructiveHint=false`,
`idempotentHint=false`, and `openWorldHint=true`: execution contacts mutable network sources and
providers, so read-only/idempotent claims would be misleading.
