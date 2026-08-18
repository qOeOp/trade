# Bilibili Note MCP — standalone design

> Status: implementation candidate. This document is the architecture authority for the service.
> Scope: Bilibili URL or natural-language topic to a text-only Chinese trading research brief.
> Deployment: standalone Python stdio MCP, independent of any particular client or trading runtime.

## 1. Product outcome

The service turns long-form trading videos into compact, reusable research hypotheses. Audio provides the
primary semantic record. Internal visual analysis recovers material chart information that speech leaves
implicit, including trend lines, support/resistance, indicator relationships, and before/after structure
inside one host-authorized ordered visual moment.

Public output is text only. Images, frames, transcript fragments, evidence identifiers, provenance,
provider identities, internal hashes, candidate failures, and processing traces are private request-local
validation material and never appear in the Note.

Two public use cases exist:

- direct: one canonical Bilibili URL becomes one Note;
- search: one natural-language query freezes a bounded Bilibili result set, processes a requested number
  of successful videos, and returns one systematic cross-video Note.

No other feature is coupled to this service. The repository's trading system may consume the result later,
but is neither imported nor required for execution or acceptance.

## 2. Non-goals

- public screenshots, image URLs, or an asset server;
- transcript, evidence timeline, provenance, model metadata, or source-by-source recap;
- fact verification, backtesting, profitability claims, signals, or trading authorization;
- browser automation, cookie discovery, web-wide search, or inferred creator aliases;
- cache reuse, automatic model repair, fallback models, or partial success Notes;
- client-specific routing, deployment adapters, gateway patches, or UI code.

## 3. Public MCP contract

### 3.1 Tools

```json
{"name":"bilibili_note.create","arguments":{"url":"https://www.bilibili.com/video/BV..."}}
```

```json
{"name":"bilibili_note.search_and_create","arguments":{"query":"趋势交易 支撑阻力","max_videos":2}}
```

`max_videos` is an exact non-boolean integer from 1 through 3. Arguments reject unknown fields.

### 3.2 Success

One `TextContent` equals `structuredContent.rendered_markdown` byte-for-byte:

```json
{
  "schema": "bilibili-note.result/v3",
  "rendered_markdown": "# ..."
}
```

The Markdown document contains:

1. exactly one host-owned H1 title;
2. exactly one host-owned scope: `以下内容仅为未验证的交易观点摘要，须另行研究验证。`;
3. the non-empty subset of `核心策略`, `具体方法`, `风险管理`, in that order;
4. one or more `- 规则描述：<literal rule_body>` bullets across the whole document.

A category may be empty. The complete document may not be empty. The renderer omits empty headings.

### 3.3 Failure

One `bilibili-note.error/v1` value contains the closed public error code and reason. No partial Note,
internal exception text, provider body, candidate detail, or private identifier is returned.

## 4. Component boundaries

```text
MCP presentation
  -> direct/search application use case
    -> source/search ports
    -> media/ASR/visual ports
    -> flat rule author port
    -> reject-only verifier port
    -> optional cross-video synthesis + verifier ports
  -> deterministic Markdown renderer
```

Dependency direction is inward. Domain and application layers do not import concrete Bilibili, yt-dlp,
SiliconFlow, filesystem, subprocess, or MCP implementations.

The package exposes no repository-root application object and stores no durable business state.

## 5. Direct pipeline

### 5.1 Source admission

Accept only canonicalizable `https` Bilibili video URLs with a valid BV identity. Resolve exact aid/cid,
part, title, author, duration, and canonical URL from bounded provider JSON. Redirects, private/reserved
network destinations, ambiguous JSON, type coercion, identity disagreement, and sources longer than
96 minutes fail before media processing.

### 5.2 Media acquisition

Acquire one bounded public media artifact. The parent process owns the total deadline, output caps,
temporary path, process group, termination, kill fallback, and reap-before-return. Actual duration, audio,
dimensions, file size, and digest are checked after download. Preview-only or identity-mismatched media
cannot reach transcription.

The media worker receives only a canonical request and sanitized environment. Provider/model keys and
operator-event sink configuration are excluded. Retry authority is single-layer and typed; exception text
or class-name strings never decide retry.

### 5.3 Complete transcription

Transcribe the entire audio in host-owned 45-second windows. Windows are complete, ordered, gap-free,
non-overlapping, and capped at 128. A request-local client is reused across bounded concurrent windows.
Only typed transport, 429, 5xx, or malformed-response conditions receive bounded retry. Cancellation joins
all window tasks and closes the client exactly once.

Progress 50 means the complete transcript has passed structural validation, never merely that a provider
returned some text.

### 5.4 Visual selection

Rank transcript windows using domain-neutral cues only:

- deictic speech such as “看这里/从这里到这里”;
- screen, page, window, or mouse interaction language;
- explicit visible change or ordered relation.

Trading vocabulary, asset names, indicators, prices, percentages, and digit density contribute no score.
Zero-score windows cannot occupy the ranked top three.

Freeze up to three intent windows plus coverage anchors. Each intent window is probed at five timestamps.
Choose a deterministic integer-distance medoid; only the highest-ranked window with an ordered-relation cue
may retain earliest, interior medoid, and latest as one ordered group. Duplicate timestamp/asset membership
atomically degrades it to one static frame. Global digest dedupe yields exactly two to five groups and two
to five frames, with at most one three-frame group and no two-frame group.

Frames remain request-internal, are never upscaled, and obey per-frame and aggregate byte caps.

### 5.5 Flat author catalog

The multimodal author returns:

```text
rules[1..24]: ordered (PublicRuleV1, evidence_refs)
visuals[host_group_count]: supports_rule(rule_index, evidence_basis) | no_material_increment
```

The author does not return public categories. It removes greetings, promotion, repetition, jokes,
audience interaction, and tangents, while preserving reusable decision rules and every material symbol,
timeframe, regime, volatility, liquidity, session, level, threshold, indicator, confirmation, exception,
and invalidation condition.

`rule_index` addresses the single flat catalog. Visual objects contain no prose, frame IDs, group IDs, or
evidence refs. Host frame membership and private visual binding are never model-owned.

### 5.6 Independent verification and category projection

One separate reject-only multimodal verifier receives the immutable transcript, flat candidate catalog,
and exact host-selected visual groups. For every positional rule it must accept:

- intelligibility;
- source resolvability;
- entailment without a new claim;
- polarity preservation;
- all material conditions;
- reusable abstraction;
- Simplified-Chinese public representation;
- exactly one category.

It also accepts source coverage, no remaining duplicate/mergeable rule, priority order, and every material
visual relation. It cannot author, repair, reorder, delete, or rewrite rules.

The verifier is the sole category authority. Category precedence is:

1. `risk_management` when the operative consequence is stop, exit, invalidation, position size, or
   exposure control;
2. `method` when the rule has an observable entry, avoidance, waiting, filter, or confirmation condition;
3. `core_strategy` for an abstract strategy-wide objective, governing principle, regime preference, or
   directional stance with no operational trigger or consequence.

The host projects unchanged author rules according to accepted verifier verdicts. Direct caps are 9 core,
9 method, and 6 risk. Any failed verdict, positional mismatch, category overflow, unsupported visual,
duplicate public item, or invalid reference fails the whole request before rendering.

### 5.7 Rendering and terminal validation

The renderer owns all headings, scope text, and the `规则描述：` frame. Rule bodies are treated as untrusted
Markdown literals. Final admission checks exact structure, title policy, scope position/uniqueness, public
text safety, category order, item uniqueness, schema parity, byte cap, and content/structured-content
equality.

Temporary media, audio, and frames are destroyed before terminal success is constructed.

## 6. Search and synthesis

Normalize the query with generic Unicode rules. Search one bounded Bilibili page and require every
normalized query unit to match title, author, tags, or description. Exact author identity may break an
equal score but cannot create creator-only search semantics. Deduplicate exact BV IDs and freeze at most
nine candidates before media work.

Use a work-conserving rolling window with at most two active candidate pipelines. Only the lowest
continuous terminal prefix decides selected successes and the first authoritative failure. Completion
timing cannot change the output. When the requested success count is unreachable, return
`SEARCH_TARGET_UNMET` without a partial Note.

Cross-video synthesis receives a closed host catalog of verified typed rules. It receives no query,
source title, image, transcript, or candidate error. One author proposes at most 3 core, 6 method, and
4 risk outputs. Categories may be empty; at least one total output is required. Every input ID appears
exactly once as same-category support or accepted episode-only omission.

One independent synthesis verifier checks coverage, entailment, polarity, material conditions, omission
safety, Simplified Chinese, and priority order. There is no truncation, padding, fallback, repair, cache,
or third call.

## 7. Progress and cancellation

Public progress is monotonic and artifact-based:

| progress | admitted artifact                          |
| -------: | ------------------------------------------ |
|        5 | canonical request/source identity admitted |
|       25 | bounded media artifact admitted            |
|   25..49 | complete ASR windows admitted              |
|       50 | full transcript admitted                   |
|       65 | host visual catalog admitted               |
|   66..74 | bounded model liveness only                |
|       75 | author and independent verifier admitted   |
|       89 | rendered terminal bytes admitted           |

Search candidate progress is capped at 88. The service emits no synthetic 90 or 100. Repeated stage
messages may prove liveness but cannot claim a future artifact.

Every request owns its tasks, clients, subprocesses, and temporary workspace. Cancellation cancels and
joins children before propagating. Search batch accounting satisfies
`attempted == succeeded + failed + cancelled`.

## 8. Security and resource invariants

- CPython `>=3.14,<3.15`; service-local `uv.lock` is dependency authority.
- Only explicitly configured secret environment variables are read; values are never logged or persisted.
- Provider-controlled JSON uses strict UTF-8, unique decoded keys, finite bounded numbers, object roots,
  exact types, depth limits, and byte caps.
- HTTP bodies are streamed under cap+1 limits; declared length cannot override the actual cap.
- Source/search hosts are exact and public-DNS pinned; redirects are disabled.
- Optional egress proxies are explicit unauthenticated local HTTP endpoints only.
- Subprocess stdout/stderr are drained concurrently under independent caps. All exceptional exits share
  one terminate, grace, kill, and reap owner.
- stdio frames are at most 1 MiB and pass raw UTF-8 plus strict JSON-RPC admission before tool dispatch.
- Public text cannot contain internal IDs, provenance, model identity, hidden markup, data URLs, source
  attribution scaffolding, or host-control language.
- Operator JSONL is diagnostics-only and cannot affect scheduling, progress, or public outcome.

## 9. Test and acceptance contract

The service must be testable without any repository-root runtime. Required gates are:

```bash
uvx --from 'uv==0.12.3' uv run python scripts/export_schemas.py --check
uvx --from 'uv==0.12.3' uv run ruff check src tests scripts
uvx --from 'uv==0.12.3' uv run ruff format --check src tests scripts
uvx --from 'uv==0.12.3' uv run mypy src
uvx --from 'uv==0.12.3' uv run python -m pytest -q
uvx --from 'uv==0.12.3' uv run python -m bilibili_note_mcp --self-check
```

Behavioral coverage includes:

- direct URL and natural-language search;
- category-empty but total-nonempty success;
- all-empty rejection and per-category overflow;
- author wire rejection of legacy category arrays;
- verifier sole category ownership and positional totality;
- visual static/ordered support, omitted material, and invalid index negatives;
- transcript gaps, preview media, identity drift, body/output caps, timeout, and repeated cancellation;
- search completion-order invariance, target-unmet behavior, and conserved batch accounting;
- duplicate-key/non-finite/invalid-UTF-8 input at every provider and stdio boundary;
- exact Markdown/TextContent/structured-content byte parity and private-data absence.

Live acceptance uses at least two independent videos plus one topic query to avoid fitting extraction
quality to a single source. A live receipt is observational evidence only; it does not weaken any static,
schema, or fail-closed gate.

## 10. Delivery boundary

The deliverable is this package, its schemas, tests, and documentation. A consumer integrates it through
the standard MCP stdio contract and is responsible for its own process supervision, UI, transport,
authentication, and lifecycle policy. Consumer-specific adapters do not belong in this service.
