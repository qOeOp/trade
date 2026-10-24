import { useState } from "react";
import { Missing } from "./Missing";
import { TextButton } from "./TextButton";
import { Token } from "./Token";

// The first sentence: up to a Chinese stop, or a Latin one followed by a space or the end (so the
// point in "8.47%" or "self.price" does not end it).
const FIRST = /^[\s\S]*?(?:[。！？；]|[.;!?](?=\s|$))/;
// A hash, path or registration inside the text: a run of 24 or more printable ASCII characters without a space.
const LONG = /([\x21-\x7e]{24,})/;
// A list item: a line starting with "- ", "* " or "• ".
const ITEM = /^\s*[-*•]\s+/;

/** `text` with each long run as a Token chip (split with a capture group, so the runs sit at odd indexes). */
const withTokens = (text: string) => text.split(LONG).map((part, i) => (i % 2 ? <Token key={i} value={part} /> : part));

/** One paragraph: its lines as text, consecutive list lines as a list, closer to each other than paragraphs are. */
function Block({ text }: { text: string }) {
  const runs: { item: boolean; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    const item = ITEM.test(line), last = runs.at(-1);
    if (last && last.item === item) last.lines.push(line.replace(ITEM, ""));
    else runs.push({ item, lines: [line.replace(ITEM, "")] });
  }
  return <div className="space-y-1">{runs.map((r, i) => r.item
    ? <ul key={i} className="list-disc space-y-0.5 pl-4">{r.lines.map((l, j) => <li key={j}>{withTokens(l)}</li>)}</ul>
    : <p key={i} className="whitespace-pre-line">{withTokens(r.lines.join("\n"))}</p>)}</div>;
}

/** Long text as paragraphs (split on blank lines) and lists, folded to its first paragraph, or to the first
 *  sentence of a single one, with the rest behind Show more; hashes and paths in it as chips. */
export function Prose({ text }: { text?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return <p><Missing /></p>;
  const blocks = text.trim().split(/\n\s*\n/);
  const toggle = (className: string) =>
    <TextButton className={`align-baseline text-fg-muted ${className}`} onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</TextButton>;
  if (blocks.length > 1) return (
    <div className="space-y-2.5 leading-normal wrap-anywhere">
      {(open ? blocks : blocks.slice(0, 1)).map((b, i) => <Block key={i} text={b} />)}
      {/* On its own line, its text flush with the paragraphs' (the button pads 4px each side). */}
      <div className="-ml-1">{toggle("")}</div>
    </div>
  );
  const first = FIRST.exec(text)?.[0] ?? text, folded = text.length - first.length > 0 && text.slice(first.length).trim() !== "";
  return (
    <p className="leading-normal wrap-anywhere">
      {withTokens(open || !folded ? text : first)}
      {folded && toggle("ml-1")}
    </p>
  );
}
