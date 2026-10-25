import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { pythonLanguage } from "@codemirror/lang-python";
import { unifiedMergeView } from "@codemirror/merge";
import { styleTags, tagHighlighter, tags as t } from "@lezer/highlight";

// Python as IntelliJ colours it: keywords with True, False and None, strings, numbers, comments, the
// name a def introduces and whole decorators. The highlighter gives classes only; theme/code.css colours them.
const python = new LanguageSupport(pythonLanguage.configure({
  props: [styleTags({ 'Decorator/VariableName Decorator/"."': t.meta })],
}));
const highlighter = tagHighlighter([
  { tag: [t.keyword, t.bool, t.null], class: "tok-keyword" },
  { tag: [t.string, t.special(t.string)], class: "tok-string" },
  { tag: t.escape, class: "tok-escape" },
  { tag: t.number, class: "tok-number" },
  { tag: t.comment, class: "tok-comment" },
  { tag: t.function(t.definition(t.variableName)), class: "tok-function" },
  { tag: t.meta, class: "tok-decorator" },
]);
const READ_ONLY = [lineNumbers(), EditorState.readOnly.of(true), EditorView.editable.of(false), python,
  syntaxHighlighting(highlighter)];

/** Python source, read-only with line numbers; given `original`, its change from it as a unified diff
 *  whose long unchanged stretches fold away. */
export function CodeView({ source, original }: { source: string; original?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const extensions = original === undefined ? READ_ONLY : [...READ_ONLY, unifiedMergeView({
      original, mergeControls: false, gutter: true, collapseUnchanged: { margin: 3, minSize: 6 },
    })];
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: source, extensions }) });
    return () => view.destroy();
  }, [source, original]);
  return <div ref={host} data-code="" className="w-max min-w-full font-mono text-ui" />;
}
