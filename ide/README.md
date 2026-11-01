# ide

The trade IDE: a local page onto the research. Its first view is the research graph.

Draws one research line as a graph and compares graphs built from different sources (product-doctor's
fidelity test). Checking, layout and comparison use the standard library; rendering needs
node and npm:

```bash
python3 ide/ide.py check GRAPH.json
python3 ide/ide.py render GRAPH.json --out /tmp/research-graph-X/out
python3 ide/ide.py compare LEDGER.json SESSION.json --until 2026-10-23T01:50:20Z [--json]
python3 ide/ide.py serve --ledger=PROFILE [--port=8765] [--agent=URL] [--paper=URL] [--market-import=FILE]
node ide/agent/src/main.ts --product=REPO --ledger=PROFILE [--market=PROFILE] --data=DIR [--port=8766]
```

## Service

`ide.py serve` serves one ledger's graph as a page that follows the ledger
(`research_graph/serve.py`, standard library only). It runs the product's command line (`ledger
sql` for the head, `research graph --at=<hash>` for a graph) and imports no product package. The
page is the web renderer's page with a null view: it reads `/api/view?line=&since=&at=` (200 a view,
202 a state, otherwise the refusal JSON; without `line` the graph is the only open line's, and when
several are open the page lists them as links that add `line`) and follows `/api/events` (Server-Sent Events: the current
state on connect, then `fetching`, `queued`, `computing`, `ready` or `error`, with a heartbeat every
15 s). While a page without `at` is open the head is read every 5 s. Only the first head is waited for:
later `/api/view` answers at once with the last view while a head read runs in the background. A failed
refresh is told as `error` over the view a page holds. When the head moves, each open page's graph is
fetched once at the new head, the latest only, and the page replaces its view in place and keeps the
selected version. A live request naming a line can immediately show its most recently
completed live graph for the same `since` scope while the newest head is queued or computing. Each
SSE state identifies the target `ledger_commit` and, when different, the `available_commit` the page
can already display. Every completed graph can therefore reach the page even if the ledger moves
again during its calculation. The graph's own `scope.ledger_commit` and toolbar remain its actual
snapshot; the status bar separately names the background update's target. Pending requests retain
their scope's place in the queue as their target head is coalesced, so a busy line cannot continually
overtake a newly selected one. An explicit `at` always reads exactly that snapshot; an unnamed default
does not borrow a graph from an older head that may have selected a different line.
Meanwhile the status bar shows the update's stage beside a turning ring,
or the failure behind a red warning mark, and the old graph stays. The
cache holds up to 8 views in memory, preferentially dropping duplicate old versions of a scope before its
last completed live graph; pinned historical renders do not rewind the live fallback. A cold line
with no retained graph still needs one computation. Only the configured Host is served, cross-site requests are refused
and no CORS header is sent.

With `--agent=URL`, requests under `/api/agent/` go to the chat service (`agent/`, Node 24 running
TypeScript directly; Hono, the Vercel AI SDK and its DeepSeek, OpenAI and Anthropic providers),
streamed back as they arrive; without it the page has no Agent window. The chat service keeps
the agents (provider, key, models, last test) in `DIR/agents.json` (mode 0600, never sent back:
the page sees the key's last four characters) and the threads in `DIR/threads/`. An agent is
active once a model passes its test: the key lists models, the model replies, and it calls a tool
and uses the result. Its tools are the product's read-only commands, run as `uv run python -m
cli.main` with `--ledger=PROFILE` (`research state`, `research status`, `candidate list`,
`candidate show`, `replay report`, `ledger sql`, `market coverage`); `agent/src/tools.ts` is the
list, and the model can do nothing else. It checks the same Host and cross-site rules and takes
only JSON bodies. `npm test` and `npm run check` in `agent/`. Design:
[`docs/plans/product-agent-chat-design.zh.md`](../docs/plans/product-agent-chat-design.zh.md).

With `--paper=URL`, requests under `/api/paper/` go to the paper daemon (`python -m cli.main paper
serve`, the compose service `paper` on port 8767; `paper/serve.py`), and the page gets paper runs:
▶ and ■ on each version, and the runs' charts, trades and events on the Runs page. A POST there must come from the
page itself (`Sec-Fetch-Site: same-origin`) and carry the token the service generated at start and
put in the page (`X-Trade-Paper-Token`). The daemon reads the runs and their journals; it starts,
stops and seals runs through the command line, and seals runs that ended on their own. Design:
[`docs/plans/paper-trading-design.zh.md`](../docs/plans/paper-trading-design.zh.md).

With `--market-import=FILE` (the status file `market follow` writes; in compose the `trade-market-import`
volume, mounted read-only), `/api/market-import` answers that file as it is, read at each request, with
`stale` when its round is older than 26 hours (`market.follow.check()`'s rule); 503 without a readable
status. The status bar then names the service's state (`Market: caught up`, `waiting`, `lagging`,
`stopped — CODE`), and clicking it lists each kind and contract as the file has them. Design:
[`docs/plans/ide-market-import-status.zh.md`](../docs/plans/ide-market-import-status.zh.md).

The Research line menu lists every line, including closed lines, through `/api/lines?at=<commit>`
and the read-only `line list` command. A live page preloads the current index at startup and follows
new head notifications; a page with an explicit `at` keeps that snapshot's index. The toolbar keeps
the loaded choices while a newer index is fetched, so opening the menu performs no request and a
refresh never replaces useful choices with an empty loading state. Each entry shows its
window and Open/Closed state. Switching changes `?line=`, retains an explicit `at`, and drops the
previous line's `since` and selected-version fragment. It does not write a selection to the ledger.
Rendered standalone files retain their current-line facts without contacting a service.

The service warms the line index before exposing a newly synchronized head, caches up to eight
exact commits, and coalesces concurrent reads of the same commit into one product call. A navigation
metadata failure is reported by `/api/lines` without blocking a valid graph. Browser caching/storage
is not used; the index and preloader are transient working caches.

## Deployment

The IDE runs in the product's compose deployment: [`deploy/`](../deploy/README.md).

## Stages

| Stage | Input → output | Owns | Module |
|---|---|---|---|
| Extract | ledger → `graph.json` | what the ledger holds about one line | the product command `research graph` (a session graph for product-doctor's fidelity test is built by an agent) |
| Contract | `graph.json` → problems | the shape of a graph | `research_graph/contract.py`, `schema/graph.schema.json` |
| Layout | `graph.json` → `view.json` | what to draw and where, in research units | `research_graph/layout.py` |
| Render | `view.json` → files | pixels, colours, labels, interaction | `research_graph/renderers/<name>/` |
| Compare | two `graph.json` → differences | which facts differ | `research_graph/compare.py` |

Stages hand over only through these files, so each can be replaced alone.

## Graph (`research-graph@3`)

One research line from one source: the line and its targets, candidate versions with parent,
change, complete strategy source, duties, hypothesis, predictions and outcomes, registration, control, trials with
readings and eligibility, comparison, source reviews, interpretation and status; timed events
(judgments, line changes, eligibility changes); and `gaps`. It holds no conversation or host state.
Unknown values are null. The schema is authoritative.

## View model (`research-graph-view@1`)

Written next to every render as `view.json`: a manifest (`line`, `targets`, `counts`) and
`widgets`. Each widget is self-contained, with an `id`, a versioned `type`, a `slot` (`top`, `main` or
`side`) and an optional `title`, so each can be drawn, cached or sent on its own. Positions are in
research units, never pixels.

| Type | Content |
|---|---|
| `summary@1` | the current recommendation, its reading against the targets, how many research runs and recommendation judgments it has held through, version and run counts, masked runs |
| `lineage@2` | `targets`, `axis` (positions: the line's n-th trial at n, other lines' trials taking no room; `min`, `max`, `scope_start`), `rows` (lineage depth first), `nodes` (id, row, `x` at the first research run or else the first trial, `status`, `prediction`, `change`, `reading`), `edges`, `revisions` (a version drawn without its parent, from the latest earlier revision of its strategy ID), `trail` (one segment per stretch where the recommendation stayed on one version, with its judgments), `trials` (each trial with its number, `x`, version and purpose) |
| `progress@1` | `targets`, `axis` (the lineage's `min`, `max`, `scope_start`), `points` (research runs' returns with their trial number and `x`) and `recommended` (the versions the trail passed through) |
| `scatter@1` | `targets` and `points` (research runs: annual return, max drawdown, eligibility, status) |
| `table@1` | `targets` and `rows`: one per version with its role, status, prediction, first trial, research-run count and the last run's readings |
| `notes@1` | `items`: plain notes (the graph's `gaps`) |
| `candidate-detail@1` | `default` and `items`: the graph's candidate records (without their source) with `status_class` and `prediction_class` |
| `sources@1` | `items`: each version's `id`, `parent` (null when it is not in the graph) and `source` (null when the graph holds none), by id |

`status` is one of `recommended`, `meets_targets`, `below_targets`, `masked`, `precheck_failed`,
`unrun`; `prediction` one of `held`, `failed`, `mixed`, `none`. A new kind of chart is a new widget
type; a changed widget is a new version of its type.

## Renderers

A renderer is a package under `research_graph/renderers/` whose `render.py` defines
`render(view: dict, out_dir: Path) -> Path` and reads nothing but the view model. There is one,
`web`: a self-contained HTML page built from [`web/`](web/) (React, React Flow, Tailwind, Radix
primitives, TanStack Table, visx, cmdk, CodeMirror; PP Supply Mono from `web/fonts/` for every Latin letter and digit, Inter's Latin subset for the few symbols it lacks,
HarmonyOS Sans SC for Chinese, whose unicode-range slices load from jsDelivr only for the characters on screen
(offline, Chinese falls back to the system face); its own npm
toolchain), laid out like an IntelliJ IDE with the Islands theme: regions are rounded islands 4px apart on the
window frame, following the design rules in
[`docs/plans/research-graph-design-spec.zh.md`](../docs/plans/research-graph-design-spec.zh.md): warm low-chroma
OKLCH neutrals, two heading sizes (18px for the version name, 16px for card groups) in weight 600, one monospace face (Supply) for
letters and digits alike, so a reading's digits, point and % share a height, one shadow for popups, a blue ring for
keyboard focus, and short ease-out motion on hover and tooltips only. The lineage is one figure on the trial axis at a fixed scale: a
canvas that pans but never zooms and only as far as its content (the first drawn version follows the shared
return-axis gutter, and the first row is at its top-left; older prechecks remain in the version's Replays
table and do not open an empty span before the graph; the
last row at its bottom, and on the right no further than the longest-reaching version name, so it never opens on
empty trials; focusing a version centres it only as far as that allows, and opening or closing a side
leaves the canvas where it is), with each version's role shown by its mark's shape, parent-to-child
lines drawn as git graphs draw them (recessive, except the selected version's lineage: root to it and on to its
children), no gridlines or row stripes (the ruler gives the trials), the recommendation shown only by its version's mark (its
history is in the Recommended menu), and a version that lost eligibility faded to 40% with no badge and only its mark in red; a ruler above numbers
every trial (the trial where a version sits in the text colour, the rest faint), puts the trials that ran one version on a rounded
tinted block, and inverts the trial under the pointer. Over the canvas the pointer is a crosshair as in
TradingView's magnet mode: faint dashed lines on the nearest trial and version row, sparser near a small reticle, drawn under
the versions and lines. The charts follow the design spec: solid hairline gridlines along the value axis only, no tick marks,
a dotted line only for the crosshair (target lines are solid), grey data with colour kept for what the chart is about,
labels in text colours (a coloured mark beside them gives identity), headroom above the data and readouts as pills on
the axes that the tick labels make way for; each chart's SVG is layered in named groups (plot bands, grid, series, plot
lines, axis labels) in paint order. In Progress bars fill 70% of a trial (at most 24px), flat, rounded only at their far
end, under a thin solid target line; the crosshair's trial is a shaded column behind the
bars, and the hovered run's return is read out on the value axis. In Return vs drawdown the dominated runs
are light grey, the frontier a blue line with its ends and the recommendation named above their points, the corner
meeting both targets a green band, its thresholds stated in the legend (no axis titles on either chart: the panel names them), and the selected version's runs filled bright yellow above every other point; where runs crowd, the wheel zooms in around the pointer, a drag
pans and a double-click (or Reset zoom) shows them all again. Hovering a mark dims every other
version mark to 30% (the light grey bars to 55%); Tab reaches either chart and the arrow keys step from run to run (Enter selects, Escape lets go).
Reading badges
are as wide as their numbers, with the same padding to the edges and to the divider. The main toolbar carries IntelliJ-style
widgets (Research line, Ledger commit and Recommended, whose menu lists every version the recommendation rested on), the
recommendation's readout, search and settings (theme, layout reset), its controls the size of the stripe buttons and its ends
in line with them; the status bar shows the path to the selected
version (line › ancestors › version, each clickable; the middle of a long path folds into a … step whose menu lists
it) and the version under the pointer. The editor keeps at least 45% of the width, so a narrower window shrinks the
sides first. As in IntelliJ, a stripe on each side opens tool windows, one per side:
Versions (the versions as a tree by lineage) and Sources (one `<version>.py` file per version, a strategy with several
revisions a folder of them) on the left, Details (the selected version as cards in groups: long text in paragraphs and
lists, folded to its first paragraph or sentence with the rest behind Show more, a registration as a chip cut in the middle that copies on click) on the right, and
Progress (research-run returns as bars from zero on the canvas's x), Return vs drawdown (the scatter with the non-dominated
frontier), Version table, Data gaps and Trades (`⌥9`, the paper run's trades, events, exceptions and reconciliation) at the bottom, switched by the stripe as on the sides; each island has the same header with its actions (locate, expand
all, collapse all, hide). Served with a chat service, the right side also has Agent (`⌥0`): the open
thread with answers written as they stream, each under the model that wrote it, product commands as
foldable cards with their JSON and known versions as links; the saved chats; and the agents with
their tests. `⌥0`–`⌥7` and `⌥9` toggle the tool windows, `⌘B` and `⌘J` the right and bottom sides, `⇧Esc` hides the
active one. Runs (`⌥8`, the third left stripe button, one of the three at a time) closes the left tool window and turns
the editor into the Runs page of the selected version (design: `docs/plans/ide-runs-page-design.zh.md`): its paper
runs as one chart, each chain of runs a stretch after the one before it (the time between them taking no room, its
equity carrying on), the picked run's stretch shown (its name in the text colour; a click on another's name, or `[`
and `]` once the chart has the focus, shows that one, `F` fits the view to it and `⇧F` to all), the run picked in the toolbar's run menu (every run by version; runs naming no version of this line under
Unattributed) after the line and ledger widgets, with ■ or ▶, the run's equity, return and state, and its delete.
Details and Trades follow the stage the page shows, the backtest (the version's last research run with economic
evidence) or a paper run: Details names it over its readings (a paper run's with its targets under them) and adds its
Performance group (trades, by contract, trade stats, the calendar, profit and loss), on both pages; on the lineage the
readings stay the last research run's. The first time it shows, the page opens Details and Trades. Hovering any mark highlights its version everywhere; `⌘K` jumps to a version or runs a command; `Home` goes
back to the start of the axis; `#<version>` in the address opens on that version and follows the selection. The editor
follows the left tool window last chosen: with Versions it shows the lineage, with Sources the open file, one at a time
and without tabs, under a header naming it. Double-clicking a version anywhere (canvas, Versions, Sources, or Enter in
Sources), or Open source in its context menu, switches the left side to Sources and opens the version's source in place
of the open one: read-only Python in CodeMirror with line numbers and IntelliJ's syntax colours, the island scrolling it.
Compare with parent in the header is a toggle: while on, the file shows as its unified diff against its parent's source
(deleted lines red and plain, inserted green, long unchanged stretches folded), and it stays on as other versions open. Right-clicking a version anywhere (canvas, trees, table) offers Locate in graph (back to Versions and the
lineage), Show in details, Open source, Open runs, Copy version name and Copy link. Tool-window sides, sizes
and the theme are kept in browser storage when it is available. The renderer injects `view.json`
into the built page and rebuilds it whenever the sources under `web/` differ from the ones it was
built from (`dist/source.sha256`), reinstalling first when the lockfile changed. The page needs
JavaScript, so it opens in a browser. A new widget type is a renderer in `web/src/widgets/registry.ts` and a tool window in
`web/src/shell/toolWindows.ts`; a type the page does not know becomes a bottom tool window that names it.

### Code layout and rules (`web/src`)

The Details panel's Change and hypothesis and Conclusion headings offer on-demand Chinese translation
of What changed, Hypothesis and Interpretation and decision, displayed beneath their originals.
Each group has an independent toggle and cancel action; both share one lazily loaded local model.
It uses TranslateGemma 4B with explicit trading
term meanings in the translation instruction (for example, long means 多头 and short means 空头).
It loads Transformers.js 4.3.2 from jsDelivr only on click; the pinned
`onnx-community/translategemma-text-4b-it-ONNX` q4 model
downloads about 3.1 GB from Hugging Face and runs in an inline Web Worker with WebGPU. Model files
use the library's browser cache. Before loading, the worker automatically removes cached Opus-MT
trial downloads and obsolete TranslateGemma revisions/weight variants, keeping the pinned q4
weights and metadata. It leaves unrelated model/runtime files and other caches alone; storage
access failures do not block translation. This applies only to the current browser origin:
old preview ports, other hostnames and other browser profiles require their own cache cleanup.
No text is sent to a translation service or written to the ledger.
Results show inference time excluding model preparation. Original text stays visible for quality
comparison; failed requests can be retried, and source changes discard stale responses. Long prose
is chunked on word boundaries and translated paragraph by paragraph to retain its structure.

| Folder | Holds | May import |
|---|---|---|
| `theme/` | `tokens.css` (the only colour literals: IntelliJ Islands surfaces, four validated data hues and IntelliJ's Python colours), `base.css`, `code.css` (the source view), `roles.ts` (role names, `v()`, `wash()`, `textClass()`) | nothing |
| `lib/` | pure helpers: formatting, guarded storage, key bindings, ranges | nothing |
| `model/` | view types, semantics (roles, predictions, targets), the view context, the lineage tree | lib |
| `icons/` | the icon registry (Lucide), `Icon`, `RoleMark`, `PredictionMark` | theme, model |
| `state/` | small atoms: hover linking, focus requests, axis, crosshair, selection (mirrored in `#<version>`), theme, shell | lib, model |
| `components/` | every control and shared view part (`IconButton`, `Tip`, `DataTable`, `ReadingBadge`, `VersionLine`, ...) | theme, icons, lib, model, state |
| `widgets/` | one renderer per view-model widget type (`registry.ts`) | the above |
| `shell/` | the window: islands, toolbar, status bar, command palette | the above and widgets |

`npm run check` runs `tsc`, the lineage geometry regression tests (`npm test`), and `scripts/check-rules.mjs`, which fails the build on: a colour literal outside
`tokens.css`, `var(--…)` in TypeScript outside `roles.ts` (role classes and `v()` instead), `<svg>` outside icons and the
chart widgets, a `<button>` or colour inline style outside `components/`, arbitrary `text-[…]`/`rounded-[…]` classes,
storage outside `lib/storage.ts`, an import against the table above, a file over 200 lines, data hues that differ from
the validated set. `scripts/verify.mjs <page>
<out> [#version]` screenshots a rendered page in light and dark and checks that islands are 10px-rounded and 4px apart,
the canvas and the bottom island share their left edge and width, canvas nodes are vertically centred, and every
`VersionLine` keeps fixed gaps between its parts with each badge number the same padding from the edges and divider;
in a 1000px window every island stays inside it and hovering tree rows never moves one; and an island's scrollbar is a
2px overlay line on its edge (OverlayScrollbars, `components/ScrollArea.tsx`), with no native bar inside an island.
There it also drives the tree's arrow keys and its header's Collapse all and Expand all, the folded path's menu, a canvas version's context menu (6 items),
double-click opening its source and `⌥1` bringing the lineage back, the wheel panning the canvas to its edges, and a Sources file opening as highlighted source
that the island scrolls, opened once however often it is double-clicked, then as its diff, and its menu's Locate in graph
bringing Versions and the lineage back; then `⌥8` opens the Runs page in light and dark with no left island, the editor a
half gap from the stripe, Details at the right and Trades under the editor at its left edge and width, and `⌥1` brings the
lineage back.

Icons are [Lucide](https://lucide.dev)'s line icons (npm `lucide-static`, version pinned), drawn in the text colour
with strokes that draw one pixel wide at every size (2 units at 12px, 1.5 at 16px, 1.2 at 20px). ISC License, © Lucide Icons and Contributors; icons derived from Feather are MIT,
© Cole Bemis. The licence text and a notice are in `web/src/icons/`.
