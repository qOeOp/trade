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

HTML when wanted (source text never renders as raw HTML):
`pandoc -f markdown-raw_html -s --embed-resources note.md -o note.html`.
