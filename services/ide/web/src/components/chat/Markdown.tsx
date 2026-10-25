import { Children, createContext, useContext, useMemo, type ComponentProps, type ReactNode } from "react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { select } from "../../state/selection";
import { TextButton } from "../TextButton";

// An answer's Markdown in the page's type: two heading sizes at most, inline code as a chip, tables
// as the version table draws them, Chinese paragraphs at their taller line height. A version the view
// knows (ID@N) becomes a link that selects it on the canvas. The text is revealed at an even pace as
// it streams (the library's smoothing, off under reduced motion), on top of the server's even pacing.
const ZH = /[㐀-鿿豈-﫿]/;
const VERSION = /([\w.-]+@\d+)/g;

// Drawn as the detail's parent link and VersionLine draw a version: the name, its revision faint. No
// blue: on the canvas a blue underline means a version stayed recommended.
function VersionLink({ id }: { id: string }) {
  const at = id.lastIndexOf("@");
  return (
    <TextButton className="-mx-1 font-mono text-fg" onClick={() => select(id, { reveal: true })}>
      <span>{id.slice(0, at)}<span className="text-fg-faint">{id.slice(at)}</span></span>
    </TextButton>
  );
}

/** `children` with every known version in its strings as a link. */
const linked = (children: ReactNode, versions: ReadonlySet<string>): ReactNode =>
  Children.map(children, (child) => typeof child !== "string" ? child
    : child.split(VERSION).map((part, i) => (i % 2 && versions.has(part) ? <VersionLink key={i} id={part} /> : part)));

// GitHub's Markdown: the models write tables and strikethrough in it.
const PLUGINS = [remarkGfm];

const leading = (children: ReactNode) => (Children.toArray(children).some((c) => typeof c === "string" && ZH.test(c)) ? "leading-zh" : "leading-normal");

/** The versions the view knows, which an answer links to. */
export const KnownVersions = createContext<ReadonlySet<string>>(new Set());

// The component and its map keep their identity while an answer streams: a new one would remount
// the text and restart its smoothing from nothing.
export function Markdown() {
  const versions = useContext(KnownVersions);
  const components = useMemo(() => byVersions(versions), [versions]);
  return <MarkdownTextPrimitive className="min-w-0 space-y-2 break-words" remarkPlugins={PLUGINS} components={components} />;
}

function byVersions(versions: ReadonlySet<string>) {
  return {
    p: ({ children }) => <p className={leading(children)}>{linked(children, versions)}</p>,
    li: ({ children }) => <li className={leading(children)}>{linked(children, versions)}</li>,
    ul: ({ children }) => <ul className="list-disc space-y-0.5 pl-4">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal space-y-0.5 pl-5">{children}</ol>,
    h1: ({ children }) => <h3 className="pt-1 text-h2 font-semibold">{children}</h3>,
    h2: ({ children }) => <h3 className="pt-1 text-h2 font-semibold">{children}</h3>,
    h3: ({ children }) => <h4 className="pt-1 font-semibold">{children}</h4>,
    h4: ({ children }) => <h4 className="font-semibold">{children}</h4>,
    strong: ({ children }) => <strong className="font-semibold">{linked(children, versions)}</strong>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-2 hover:text-fg">{children}</a>,
    blockquote: ({ children }) => <blockquote className="border-l-2 border-line-strong pl-3 text-fg-muted">{children}</blockquote>,
    code: ({ children, className }) => {
      const text = String(children);
      if (!className && versions.has(text)) return <VersionLink id={text} />;
      return className ? <code className={className}>{children}</code>
        : <code className="rounded-badge border border-line px-1 font-mono text-dense">{children}</code>;
    },
    pre: ({ children }) => <pre className="overflow-auto rounded-card border border-card-border bg-island-alt p-2 font-mono text-dense">{children}</pre>,
    table: ({ children }) => <div className="overflow-auto"><table className="w-full border-collapse text-dense">{children}</table></div>,
    // As DataTable draws its header; the outer columns line up with the paragraphs.
    th: ({ children }) => <th className="border-b border-line-strong px-2 py-1 text-left font-normal text-fg-faint first:pl-0 last:pr-0">{children}</th>,
    td: ({ children }) => <td className="border-b border-line px-2 py-1 align-top first:pl-0 last:pr-0">{linked(children, versions)}</td>,
    hr: () => <hr className="border-line" />,
  } satisfies ComponentProps<typeof MarkdownTextPrimitive>["components"];
}
