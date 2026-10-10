# Notes

Write `note.md` in the bundle, in the language the user asked for (default: the user's language). A
note reads the bundle; it is never evidence and the checker does not read it.

- **Structure**: a short overview; chapters in time order whose titles come from the content (no
  fixed categories); concrete details under each; takeaways only where the speaker states them.
- **Keep** entities, numbers with units, conditions, negations, exceptions and causal links. Do not
  widen a conclusion. Mark an unclear name or number instead of guessing.
- **Cite** every point with its segments, such as `[E012–E015]`, and never a span the checker flags.
- **Images** are bundle PNGs or crops by relative path, such as `![t=05:12](frames/grid/frame_0053.png)`,
  placed in the chapter whose cited speech contains their time. A talking-head video may need none;
  never add one to fill space, and never link an image outside the bundle.
- **Time links**: YouTube `https://www.youtube.com/watch?v=ID&t=S`, Bilibili `.../video/BV...?p=N&t=S`;
  other pages get the page URL only.
- **Numbers** listed in `numbers_to_verify` appear only when a frame confirms them; otherwise mark
  them "(ASR)".
- **Header**: title, channel or author, date with its granularity, duration, media SHA-256 and the
  ASR engine and model revision from `asr/run.json`.

HTML when wanted, outside the bundle (embedded frames would exceed the checker's 8 MiB file limit). Source
text copied into the note is data: the reader ignores raw HTML and YAML metadata blocks, and the filter keeps
only bundle images, https links and the title and strips every attribute, so neither a title like `![](~/.ssh/id_ed25519)` nor a
`css:` line embeds a local file or fetches a URL:

    cd "$B" && mkdir -p "$ROOT/notes" && pandoc -f markdown-raw_html-yaml_metadata_block --lua-filter "$A/note.lua" -s --embed-resources note.md -o "$ROOT/notes/$KEY.html"
