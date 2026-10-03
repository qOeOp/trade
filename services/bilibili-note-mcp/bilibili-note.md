# Bilibili Note MCP — general video notes

> Status: implementation candidate. Architecture authority for this standalone service.
> Scope: public Bilibili, YouTube, and public HTTPS single-video pages/direct files of any subject
> to grounded Chinese illustrated notes.

## Product outcome

A note explains the video's actual content: an overview, content-derived chapters, concrete details,
examples, qualifications and optional takeaways. It does not impose a subject, professional framework,
fixed topic categories or a preference for reusable abstractions. A source may discuss any subject.
Source speech, titles and images are untrusted material, never instructions for the service.

Chapter text is grounded in complete timestamped transcription and real sampled frames. Models select
only host-issued evidence/frame identifiers. The host derives timestamps, links and asset paths; models
cannot supply filesystem paths, external images or executable markup. The host validates reference identity, chronological order, image binding and output bounds.
There is no separate model verdict or multi-round fact/caption pipeline. This reduces repeated
interpretation and cost; deterministic checks do not prove semantic correctness. Accept harmless
wording errors, but preserve key entities, quantities, conditions, steps and exceptions. Unresolved
source ambiguity remains explicit. Original speech and review records remain available to readers.

## Pipeline and ownership

Dependencies point inward: domain models and application ports do not import provider or filesystem
adapters. Reuse platform-specific metadata/media adapters and shared complete-source acquisition, full-audio ASR and frame decoding owners.
Metadata comes from the JSON `x/web-interface/wbi/view` endpoint. Maintain video/part identity, duration,
public-DNS pinning, redirect refusal, explicit loopback proxy policy and media bounds.

The application acquires a complete source in temporary storage, validates transcript coverage and
frame identities, and builds notes through one bounded author pipeline:

1. Send the complete timestamped transcript, optional audio review records, frame metadata and
   labeled contact sheets directly to one author request. It returns the existing structured note
   contract: overview, chronological chapters with grounded points and selected frame identifiers, and
   takeaways. The host alone renders Markdown, links and HTML. No subject-specific prompt is used.
2. For large inputs, split only at original sentence boundaries to a 48 KiB text/metadata budget per
   request, with at most 16 sequential chunks. Preserve frame-to-speech groups across boundaries.
   Two preceding original sentences provide context; they are not new owned evidence. Every original
   sentence is sent; no pre-extraction or generated fact inventory replaces it. Allocate the existing
   16-chapter/24-image total bounds across chunks. Once all chunks finish, one summary request writes
   only global overview/takeaways, with a 96 KiB summary-input ceiling; the host concatenates chapter
   bodies without rewriting them. Exceeding a bound produces an explicit error, not truncation.
3. Contact sheets contain at most nine labeled 960x540 thumbnails. Always include the final partial
   sheet; keep original PNGs for publication. Bound text and binary payload independently. Base64
   length is not an image token count; reported provider usage is authoritative for actual consumption.
4. Validate every returned evidence ID, chronological chapter order, image identity, time and original speech
   binding. Image evidence need not duplicate every nearby sentence in the chapter points; the image
   time must lie within both its original speech span and the chapter span. Omit individual invalid
   screenshot selections, retaining all prose, references and valid images unchanged; never invent a
   replacement image, widen a time span or add references to make an image pass. This follows
   VideoNote-MCP's single-screenshot failure isolation and requires no additional model request.
   Final publication still strictly validates the complete resulting note. Screenshots are optional,
   so if no selection is valid, publish the validated text without images rather than inventing them.
   Each chunk permits one re-generation after invalid JSON, text-reference or ordering constraints,
   using the same original materials and the specific host error. It does not replay completed chunks,
   acquisition or ASR. Transient transport retry remains a separate bounded mechanism described below.
   Persistent errors fail with a typed result; never publish a partial or unvalidated note.

Direct authoring replaces the segmented extraction, fact merge, separate image selection, per-image
caption calls and whole-note model verification. Quality tiers continue to govern audio review, not
extra semantic judges. Fixture authoring remains explicitly deterministic and is never a live fallback.
This simplification was user-authorized after a same-model, two-subject upstream comparison.

Models select frame identifiers only; they do not generate separate image captions. The renderer
displays a neutral original-frame label and the actual timestamp. Necessary visual explanations belong
in grounded chapter prose.

Screenshots are real frames, selected only when relevant to a chapter; a video without useful visual
material may have none. Do not fabricate images or claim unsampled visual coverage. Candidate frames
cover the complete timeline at a target interval of six seconds, adapting up to 48 candidates rather
than truncating the tail. When sentence count can fill the frame budget, coverage samples from short
segments (at most 10 seconds) move to 150 ms before the sentence ends, clamped to its start, to capture
completed visual steps or text. Sparse transcripts and coarse segments retain the time grid; explicit
visual-relation sequences remain unchanged. Published timestamps always identify the actual frame.
Byte-identical frames are removed. Contact sheets are visual evidence for direct authoring; their labels and corresponding metadata
bind selected pictures to original PNG assets. They do not guarantee that tiny text is legible.
The renderer uses actual frame times and
referenced speech ranges as navigation aids, not guarantees of perfect alignment.

Provider usage receipts record reported input/output/total tokens, model, stage and elapsed time in
the private operator event stream, never keys, transcript text or images. Missing usage is unavailable,
not zero. Transient model HTTP 408/429/500/502/503/504 and transport failures retry the identical current
request at most three attempts, with 2/8 second backoff and bounded Retry-After (up to 30 seconds).
The entire request including waits shares the configured timeout; each attempt is capped at 90 seconds.
Authentication, other HTTP errors, malformed output and semantic rejection do not receive transport
retries. Cancellation closes the active response and cancels backoff. Request-local progress reports
the retry without replaying completed stages; operator events retain safe status and attempt metadata.
No response bodies or credentials are logged. No provider/model downgrade is implicit.

On Apple Silicon the composition root selects an isolated MLX Whisper large-v3 worker by default;
other hosts use cloud ASR. Host configuration can explicitly select either, with no silent fallback.
MLX weights are pinned to a repository revision. Workers process the complete decoded audio and return
bounded sentence segments plus processed duration; silent gaps are allowed only with this full-coverage
receipt. Cloud fixed-window coverage validation stays strict. Cancellation terminates and reaps the
worker process group. Local ASR does not replace the visual model or guarantee correct proper names.

For the pinned local engine, a source cache reuses verified media and transcripts for the same complete source metadata and
transcriber identity. Metadata is fetched on every request. Every hit validates bounded manifest data,
media digest and transcript coverage; changed source metadata or engine revision is a miss. Host-owned
atomic entries expire for reuse after 24 hours. Cache writes stop when the 8 GiB budget would be exceeded;
misses still process normally. Cache errors never become fabricated source evidence. An explicit host
cache directory owns retained media; no provider key is cached. No automatic deletion of user files.

Search keeps at most nine candidates and at most two active source jobs, exact requested success count
(1–3), stable candidate order and cancellation/reaping. Each selected note retains its own source and
chapters in one collection. Do not collapse different sources into unsupported agreement. Candidate
processing creates no durable outputs; only the completed terminal collection is published.

## YouTube source adapter

YouTube direct links and explicitly selected keyword search use the official yt-dlp extractor with
its matching packaged EJS dependency and a supported local JavaScript runtime. Accept finite public
videos only, with platform-bound video identity and canonical URLs. Playlist, channel and live
resources are rejected. No browser cookies are read automatically. The isolated worker uses bounded
requests, HTTPS YouTube/media hosts, public DNS addresses and redirect refusal; the host validates
closed receipts, complete audio/video, duration, HD dimensions and byte limits before ASR.
Bilibili retains its WBI metadata and part identity rules. Both adapters reuse the same cache, ASR
quality tiers, screenshot extraction, author and publishers. Missing subtitles do not prevent ASR.

## Generic public video source (user-authorized extension)

Other HTTPS links use one isolated yt-dlp Generic extractor. It may unwrap exactly one embedded video,
but cannot hand off to another platform extractor. Every request requires public DNS answers, HTTPS
on port 443, and no credentials, redirects or IP literals; ambient cookies/proxies and external
media downloaders are unavailable. Metadata responses and request count are bounded. Only a progressive
media URL is downloaded through the same transport under the existing media-byte and process bounds.
Playlists, manifests, live streams and DRM are refused. Local FFprobe/FFmpeg retain `file,pipe` only.

The adapter measures the downloaded complete file's duration, dimensions and audio track, and supplies
that artifact to the existing acquisition owner. The 720p floor, full-audio ASR, quality tiers, frame
binding, author and publication owners are unchanged. URL hash identifies the generic source; media
SHA-256 binds its snapshot. No generic cache is used: unchanged URL/metadata cannot prove unchanged
media. Missing author/date are explicit unknowns. Generic time links return to the canonical source
without inventing platform seek parameters. Platform adapters and their errors never downgrade to the
generic path; keyword search remains platform-specific. No TradingView-specific parser or prompt.

## Public contract and artifacts

Expose `video_note.create({url,quality?})` and
`video_note.search_and_create({query,platform?,max_videos,quality?})`; platform defaults to `bilibili`
and can be `youtube`. Retain the old `bilibili_note.*` names as compatibility aliases.
Both public tools default to `standard`; quality is `fast`, `standard` or `precise`.
Existing internal application calls retain their explicit single-pass default `fast`.
Success versions are `bilibili-note.result/v4` and `bilibili-note.search-result/v2`. Each returns
`rendered_markdown`, absolute `note_path`, `html_path`, and host-owned `images` paths. Markdown includes
source links and timestamp links. Tool text uses absolute image paths for local clients; `note.md` uses
relative `images/` paths so the whole bundle can be moved. `note.html` is a static escaped preview,
without scripts, remote dependencies or an asset server. The HTML preview omits the original-transcript appendix; Markdown retains every original segment.
 Clients may show the local preview if they do
not render Markdown images. Local paths are available only on the server's filesystem.

A filesystem publisher owns the configured `BILIBILI_NOTE_OUTPUT_DIR` (default
`~/.local/share/bilibili-note-mcp/notes`). This is host configuration, not a model/tool path argument.
It writes a fresh private sibling staging directory, bounded PNG assets, Markdown and HTML, then
atomically renames to a unique host-generated directory. Existing bundles are never overwritten.
Publication is the commit point: errors/cancellation beforehand remove staging; afterward a completed
bundle remains even if delivery is interrupted. No cancellation checkpoint may delete committed output.
Raw audio and provider credentials remain temporary/private. Verified media and transcripts may remain
in the private bounded source cache; users may remove that cache when no request is using it. Published bundles persist until
explicit user deletion; no automatic expiration or background cleanup.

## Validation and limits

Provider JSON remains strict (unique keys, finite values, exact fields/types, bounded bytes/depth).
Reject dangling evidence/frame references, timestamps outside the source, non-chronological chapter
order, unrelated screenshots, unsupported details and malformed provider envelopes. Escape model prose
as text; only the renderer may emit links, headings, images and HTML. Never convert source instructions
into tool actions. Keep current source duration, subprocess/process-group, ASR, frame-byte, provider-body,
concurrency and stdout admission bounds. Bound published bundles and public terminal text separately.
Failures remain typed `bilibili-note.error/v1`; no partial success note is published.

## Acceptance

Use content from multiple unrelated subjects, including a real non-financial visual explanation.
Verify detail fidelity and actual screenshot readability, chronological navigation, MCP success, and
Markdown/HTML reopening after temporary cleanup. Preserve negative source/SSRF/strict-JSON/provider,
process lifecycle, cancellation and bounds tests. Exercise atomic publication failure and traversal,
forged references, source-injected markup and exact search-count behavior. Fixture-only deterministic
mode remains explicit and cannot replace live validation.

## Transcription quality (user-authorized extension)

Both entrypoints use one application-owned review stage after full source acquisition and before
notes. `fast` preserves complete single-engine ASR and host note/image binding checks. `standard`
adds a second ASR for at most three sentence-boundary windows selected by generic risk signals
(unintelligible markers, repetition, letters and numbers); ties favor source order. This heuristic
cannot detect every recognition error. `precise` reviews the complete audio with a distinct ASR.
All tiers retain the existing source duration, payload, concurrency and publication bounds.
Silence can enlarge a review interval; the existing cloud adapter splits uploads at 45 seconds.
Review calls are sequential per source, reuse process cancellation/reaping and bounded provider retries.
A required review failure fails the request; it never silently downgrades quality.

The primary transcript is immutable. Host-owned review records bind audio start/end, primary text,
alternate text and provider identity. Disagreement after ignoring sentence punctuation, case and whitespace (preserving decimal points,
signs, ranges and percent symbols) is
uncertainty, not evidence that either model is correct. Models receive overlapping review records;
the renderer always displays disagreements independently of model output. Full original transcript
and review records accompany the note. No automated lexical replacement or subtitle requirement is
introduced. Visible text remains optional evidence. Raw ASR caching remains independent of quality;
review results are request-local and never overwrite that cache.

A higher tier means more verification work, not a guaranteed error rate. Validate both entrypoints,
unknown quality refusal, concurrent different qualities, no-subtitle audio, unrelated subjects,
review disagreement/failure/cancellation, original text preservation and bounded publication.
