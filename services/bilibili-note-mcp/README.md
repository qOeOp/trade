# Bilibili Note MCP

Standalone Python stdio MCP for turning Bilibili trading videos into concise Chinese research briefs.
It has no runtime, storage, protocol, or import dependency on the repository's trading system or on a
specific MCP client. The implementation contract is documented in
[`bilibili-note.md`](./bilibili-note.md).

## Public tools

```text
bilibili_note.create({"url":"https://www.bilibili.com/video/BV..."})
bilibili_note.search_and_create({"query":"趋势交易 支撑阻力","max_videos":2})
```

`bilibili_note.create` processes one canonical Bilibili video. `bilibili_note.search_and_create`
searches Bilibili from natural language, freezes a bounded candidate set, processes at most two
candidates concurrently, and synthesizes the requested number of successful videos.

Success returns exactly one Markdown `TextContent` and one closed
`bilibili-note.result/v3` structured value containing only `rendered_markdown`. Failure returns one
`bilibili-note.error/v1` value. Public output contains no screenshots, evidence IDs, timestamps,
transcripts, provenance, model identifiers, internal hashes, candidate failures, or image URLs.

Every successful Note contains one host-owned H1 title, the exact scope
`以下内容仅为未验证的交易观点摘要，须另行研究验证。` once, and the non-empty subset of
`核心策略`, `具体方法`, and `风险管理` in that order. The whole Note contains at least one
`- 规则描述：...` item.

The result is a research hypothesis source. It is not fact verification, backtest evidence,
investment advice, a signal, or trading authorization.

## Architecture

The request pipeline is intentionally linear and independently testable:

1. validate and canonicalize one Bilibili URL or one natural-language search query;
2. freeze source identity and acquire bounded media;
3. transcribe complete audio in bounded windows;
4. select two to five internal visual groups from generic speech/visual cues;
5. ask one multimodal author for a flat ordered catalog of reusable rules;
6. ask one independent reject-only verifier to validate every rule and assign its public category;
7. project unchanged verified rules into public sections;
8. for multi-video search, synthesize and independently verify one bounded cross-video summary;
9. render and validate exact terminal Markdown bytes;
10. destroy temporary media, audio, and frame artifacts before returning text only.

The author never owns public categories. Its wire format is one flat `rules[1..24]` catalog plus one
visual disposition per host-selected group. The verifier is the sole category authority for each
positional rule. A category may be empty, but the whole Note may not be empty. Direct results are capped
at 9 core, 9 method, and 6 risk rules; search synthesis is capped at 3, 6, and 4 respectively.

The host owns transcript IDs, frame membership, visual group identity, private evidence binding,
category projection, rendering, and terminal validation. Models cannot add public prose outside typed
rule bodies, repair a failed response, select a different source, or trigger a retry. There is no cache,
fallback model, third model call, or partial Note.

## Search behavior

Search uses one anonymous first-page Bilibili request. Unicode normalization is generic; there are no
trading-keyword bonuses, creator aliases, video-specific rules, or model-authored query expansion.
Every normalized query unit must match title, author, tags, or description. Exact normalized author
identity may break an equal-relevance tie but cannot turn a topic query into creator-only mode.

The adapter deduplicates BV IDs and freezes at most nine candidates. A rolling window keeps at most two
candidate pipelines active. The lowest continuous terminal prefix is the only result authority, so task
completion order cannot change the chosen videos or first failure. Exhausting the frozen candidate set
below the requested target returns `SEARCH_TARGET_UNMET`; a partial Note is never returned.

Cross-video synthesis receives only a host-owned typed rule catalog, not the query, titles, images, or
candidate errors. Every source rule ID must appear exactly once as support for a same-category output or
as an independently accepted episode-only omission. The verifier checks total coverage, entailment,
polarity, material conditions, omission safety, Simplified Chinese, and decision-value order.

## Resource and security boundaries

- Runtime: CPython `>=3.14,<3.15`; lock authority is service-local `uv.lock`.
- Secrets: only `SILICONFLOW_API_KEY` is required. Secret values are never printed, persisted, or copied
  into artifacts.
- Optional media access: `BILIBILI_NOTE_COOKIE_FILE` must be an explicitly configured absolute regular
  non-symlink Netscape cookie file.
- Optional egress: `BILIBILI_NOTE_EGRESS_PROXY` and `BILIBILI_NOTE_MEDIA_PROXY` admit only explicit
  unauthenticated local HTTP proxy URLs. Ambient, remote, or credentialed proxies are rejected.
- Source/network: exact-host, public-DNS-pinned, redirect-free metadata/search; canonical Bilibili media
  identity is revalidated after download.
- Media: one request is capped at 96 minutes and 2 GiB. Download, ffmpeg, and ffprobe subprocesses have
  bounded output, explicit deadlines, process-group termination, kill fallback, and reap-before-return.
- ASR: complete 45-second windows, bounded concurrency and body sizes, at most four typed transient
  attempts per window.
- Visuals: two to five internal frames/groups, at most one ordered three-frame group, no public or
  persistent image output.
- Models: request and response byte caps, strict JSON, exact model identity, no automatic repair/retry.
- stdio: stdout is reserved for MCP frames. Raw UTF-8, unique JSON keys, finite signed-64-bit numbers,
  object roots, depth 32, and 1 MiB frame limits are enforced before tool dispatch.
- Operator events: bounded JSONL diagnostics contain closed counters and request-local opaque identity,
  never URLs, queries, transcripts, frames, Note content, or secret values.

Cancellation owns and joins every request-local task and subprocess before returning. Search accounting
obeys `attempted == succeeded + failed + cancelled` for every completed batch.

## Progress contract

Both tools emit monotonic artifact progress at `5, 25, 50, 65, 75, 89`. Long acquisition and model
steps may repeat or refine the last admitted stage without inventing completion. Search candidate work is
capped at 88; 89 is emitted only after synthesis, rendering, purity, and terminal-byte validation.
The MCP never fabricates transport-level 90 or 100 events.

## Setup and execution

```bash
uvx --from 'uv==0.12.3' uv sync --frozen --all-groups
uvx --from 'uv==0.12.3' uv run bilibili-note-mcp
```

Bounded direct CLI check:

```bash
export SILICONFLOW_API_KEY='set-in-your-private-shell'
uvx --from 'uv==0.12.3' uv run python -m bilibili_note_mcp \
  --create 'https://www.bilibili.com/video/BV1uHuQ6pEFr/'
```

The fixture-only deterministic mode requires `--fixture-root`. It cannot silently replace live source,
ASR, visual, or synthesis behavior.

## Repository checks

```bash
uvx --from 'uv==0.12.3' uv run python scripts/export_schemas.py --check
uvx --from 'uv==0.12.3' uv run ruff check src tests scripts
uvx --from 'uv==0.12.3' uv run ruff format --check src tests scripts
uvx --from 'uv==0.12.3' uv run mypy src
uvx --from 'uv==0.12.3' uv run python -m pytest -q
uvx --from 'uv==0.12.3' uv run python -m bilibili_note_mcp --self-check
```

Tool discovery deliberately reports `readOnlyHint=false`, `destructiveHint=false`,
`idempotentHint=false`, and `openWorldHint=true`: execution contacts mutable network sources and model
providers, so read-only or idempotent claims would be misleading.
