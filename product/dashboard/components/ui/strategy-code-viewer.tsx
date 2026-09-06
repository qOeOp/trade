"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  normalizeStrategyCodeViewerProjection,
  strategyCodeLanguageLabel,
  strategyCodeLineCount,
  type StrategyCodeLanguage,
  type WasmPreviewProjection,
} from "../../lib/strategy-code-viewer-contract";
import { EmptyState, UnavailableState } from "./evidence-strip";
import { EvidenceIcons, InterfaceIcons, ModuleIcons } from "./iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameHeader,
  PanelFrameIconAction,
} from "./panel-frame";
import styles from "./strategy-code-viewer.module.css";

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

function ReadOnlyCodeMirror({ code, language }: { code: string; language: StrategyCodeLanguage }) {
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
              ".cm-content": { padding: "16px 0", caretColor: "transparent" },
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

  return <div ref={hostRef} className={styles.editor} aria-label="Read-only strategy source" aria-readonly="true" />;
}

function previewLabel(preview: WasmPreviewProjection): string {
  return ({
    not_run: "Not run",
    succeeded: "Succeeded",
    failed: "Failed",
    unavailable: "Unavailable",
  })[preview.status];
}

function WasmPreview({ preview }: { preview: WasmPreviewProjection }) {
  if (preview.status === "not_run" || preview.status === "unavailable") {
    return (
      <div className={styles.previewState} data-status={preview.status}>
        <ModuleIcons.terminal aria-hidden="true" size={16} />
        <div><b>{previewLabel(preview)}</b><span>{preview.reason}</span></div>
      </div>
    );
  }

  return (
    <div className={styles.previewResult} data-status={preview.status}>
      <div className={styles.previewMeta}>
        <span data-status={preview.status}><i />{previewLabel(preview)}</span>
        <code>{preview.target}</code>
        <small>{preview.durationMs} ms</small>
      </div>
      <pre>{preview.output || "No output."}</pre>
      {preview.diagnostics.length > 0 ? (
        <ul className={styles.diagnostics}>
          {preview.diagnostics.map((entry, index) => (
            <li key={`${entry.severity}-${entry.line ?? 0}-${entry.column ?? 0}-${index}`} data-severity={entry.severity}>
              <span>{entry.severity}</span>
              <code>{entry.line === null ? "-" : `${entry.line}:${entry.column ?? 1}`}</code>
              <p>{entry.message}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function StrategyCodeViewer({
  projection,
  title = "Strategy source",
  eyebrow = "Owner-projected artifact",
}: {
  projection: unknown;
  title?: string;
  eyebrow?: string;
}) {
  const safeProjection = useMemo(() => normalizeStrategyCodeViewerProjection(projection), [projection]);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");
  const reduceMotion = useReducedMotion();

  useEffect(() => setCopyState("idle"), [safeProjection.artifactIdentity]);

  async function copySource() {
    if (safeProjection.availability !== "available" || !safeProjection.source) return;
    try {
      await navigator.clipboard.writeText(safeProjection.source.content);
      setCopyState("copied");
    } catch {
      setCopyState("unavailable");
    }
  }

  return (
    <PanelFrame className={styles.frame} aria-label="Read-only strategy code viewer">
      <PanelFrameHeader
        eyebrow={eyebrow}
        title={title}
        subtitle={safeProjection.availability === "available" ? safeProjection.artifactIdentity : undefined}
        layout="inline"
        actions={safeProjection.availability === "available" ? (
          <PanelFrameIconAction aria-label="Copy strategy source" title="Copy strategy source" onClick={copySource}>
            <InterfaceIcons.copy aria-hidden="true" size={13} />
          </PanelFrameIconAction>
        ) : undefined}
      />
      <PanelFrameBody className={styles.body} mode="static">
        {safeProjection.availability === "loading" ? (
          <div className={styles.loading} aria-busy="true"><span />Loading strategy source…</div>
        ) : safeProjection.availability === "unavailable" ? (
          <UnavailableState
            density="compact"
            icon={<ModuleIcons.terminal aria-hidden="true" size={17} />}
            title="Strategy source unavailable"
            detail="No verified Owner projection is available."
            reason={safeProjection.reason ?? "STRATEGY_SOURCE_UNAVAILABLE"}
          />
        ) : safeProjection.source && safeProjection.wasmPreview ? (
          <motion.div
            className={styles.shell}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            <div className={styles.tabBar}>
              <div className={styles.fileTab}>
                <ModuleIcons.terminal aria-hidden="true" size={13} />
                <span>{safeProjection.source.fileName}</span>
              </div>
              <div className={styles.editorBadges}>
                <span>{strategyCodeLanguageLabel(safeProjection.source.language)}</span>
                <span><EvidenceIcons.locked aria-hidden="true" size={11} />Read only</span>
              </div>
            </div>
            <ReadOnlyCodeMirror code={safeProjection.source.content} language={safeProjection.source.language} />
            <section className={styles.preview} aria-label="WASM preview result">
              <header><span>WASM preview</span><code>{safeProjection.wasmPreview.moduleIdentity ?? "No module"}</code></header>
              <WasmPreview preview={safeProjection.wasmPreview} />
            </section>
          </motion.div>
        ) : (
          <EmptyState density="compact" title="No strategy source">The projection contains no source.</EmptyState>
        )}
      </PanelFrameBody>
      <PanelFrameFooter className={styles.footer} layout="split">
        {safeProjection.availability === "available" && safeProjection.source ? (
          <div className={styles.footerFacts}>
            <span>{strategyCodeLineCount(safeProjection.source.content)} lines</span>
            <code>{safeProjection.source.digest}</code>
          </div>
        ) : <span>Immutable display surface</span>}
        <span aria-live="polite">{copyState === "copied" ? "Copied" : copyState === "unavailable" ? "Copy unavailable" : "No edit or run controls"}</span>
      </PanelFrameFooter>
    </PanelFrame>
  );
}
