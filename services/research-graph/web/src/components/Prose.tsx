import { useState } from "react";
import { Missing } from "./Missing";
import { TextButton } from "./TextButton";
import { Token } from "./Token";

// The first sentence: up to a Chinese stop, or a Latin one followed by a space or the end (so the
// point in "8.47%" or "self.price" does not end it).
const FIRST = /^[\s\S]*?(?:[。！？；]|[.;!?](?=\s|$))/;
// A hash, path or registration inside the text: a run of 24 or more printable ASCII characters without a space.
const LONG = /([\x21-\x7e]{24,})/;

/** `text` with each long run as a Token chip (split with a capture group, so the runs sit at odd indexes). */
const withTokens = (text: string) => text.split(LONG).map((part, i) => (i % 2 ? <Token key={i} value={part} /> : part));

/** Long text as its first sentence, the rest folded behind 展开全文; hashes and paths in it as chips. */
export function Prose({ text }: { text?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return <p><Missing /></p>;
  const first = FIRST.exec(text)?.[0] ?? text, folded = text.length - first.length > 0 && text.slice(first.length).trim() !== "";
  return (
    <p className="leading-relaxed wrap-anywhere">
      {withTokens(open || !folded ? text : first)}
      {folded && <TextButton className="ml-1 align-baseline text-fg-muted" onClick={() => setOpen(!open)}>{open ? "收起" : "展开全文"}</TextButton>}
    </p>
  );
}
