"use client";

import { useEffect, useRef } from "react";

import type { StrategyCodeLanguage } from "../../../lib/strategy-code-viewer-contract";
import styles from "../strategy-code-viewer.module.css";

type CodeMirrorView = { destroy: () => void };

async function languageExtension(language: StrategyCodeLanguage) {
  switch (language) {
    case "rust": return (await import("@codemirror/lang-rust")).rust();
    case "python": return (await import("@codemirror/lang-python")).python();
    case "javascript": return (await import("@codemirror/lang-javascript")).javascript();
    case "typescript": return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "json": return (await import("@codemirror/lang-json")).json();
    case "wat": return (await import("@codemirror/lang-wast")).wast();
    case "text": return [];
  }
}

export function ReadOnlyCodeMirror({
  code,
  language,
}: {
  code: string;
  language: StrategyCodeLanguage;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<CodeMirrorView | null>(null);

  useEffect(() => {
    let disposed = false;

    async function mountEditor() {
      if (!hostRef.current) return;
      const [
        { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, lineNumbers },
        { EditorState },
        { HighlightStyle, bracketMatching, foldGutter, syntaxHighlighting },
        { tags },
        languageSupport,
      ] = await Promise.all([
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/language"),
        import("@lezer/highlight"),
        languageExtension(language),
      ]);
      if (disposed || !hostRef.current) return;

      const tradeHighlight = HighlightStyle.define([
        { tag: tags.keyword, color: "var(--syntax-keyword)" },
        { tag: [tags.name, tags.variableName], color: "var(--syntax-name)" },
        { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: "var(--syntax-function)" },
        { tag: [tags.string, tags.special(tags.string)], color: "var(--syntax-string)" },
        { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-number)" },
        { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--syntax-comment)", fontStyle: "italic" },
        { tag: [tags.typeName, tags.className], color: "var(--syntax-type)" },
        { tag: [tags.operator, tags.punctuation], color: "var(--syntax-operator)" },
        { tag: [tags.invalid], color: "var(--status-negative)", textDecoration: "underline" },
      ]);

      const view = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: code,
          extensions: [
            lineNumbers(),
            foldGutter({ openText: "⌄", closedText: "›" }),
            drawSelection(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            bracketMatching(),
            syntaxHighlighting(tradeHighlight),
            languageSupport,
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            EditorView.lineWrapping,
            EditorView.theme({
              "&": { height: "100%", backgroundColor: "transparent", color: "var(--text-primary)" },
              ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)" },
              ".cm-content": { padding: "14px 0", caretColor: "transparent" },
              ".cm-line": { padding: "0 18px 0 8px" },
              ".cm-gutters": { backgroundColor: "var(--code-gutter-bg)", color: "var(--text-muted)", border: "0" },
              ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px", minWidth: "44px" },
              ".cm-foldGutter .cm-gutterElement": { padding: "0 7px 0 0" },
              ".cm-activeLine": { backgroundColor: "var(--code-active-line)" },
              ".cm-activeLineGutter": { backgroundColor: "var(--code-active-line)", color: "var(--text-primary)" },
              ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--code-selection) !important" },
              ".cm-cursor": { display: "none" },
              ".cm-focused": { outline: "none" },
            }),
          ],
        }),
      });
      viewRef.current = view;
    }

    void mountEditor();
    return () => {
      disposed = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [code, language]);

  return (
    <div
      ref={hostRef}
      className={styles.editor}
      data-slot="strategy-read-only-code"
      aria-label="Read-only strategy source"
      aria-readonly="true"
    />
  );
}
