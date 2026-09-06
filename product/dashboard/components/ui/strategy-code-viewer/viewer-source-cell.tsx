import {
  strategyCodeLanguageLabel,
  type StrategyCodeSource,
  type WasmPreviewProjection,
} from "../../../lib/strategy-code-viewer-contract";
import { EvidenceIcons, ModuleIcons } from "../iconography";
import styles from "../strategy-code-viewer.module.css";
import { ReadOnlyCodeMirror } from "./read-only-code-mirror";

function previewLabel(preview: WasmPreviewProjection): string {
  return ({
    not_run: "Not run",
    succeeded: "Succeeded",
    failed: "Failed",
    unavailable: "Unavailable",
  })[preview.status];
}

function ProjectedOutput({ preview }: { preview: WasmPreviewProjection }) {
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

export function ViewerSourceCell({
  source,
  preview,
}: {
  source: StrategyCodeSource;
  preview: WasmPreviewProjection;
}) {
  return (
    <section className={styles.sourceCell} data-slot="strategy-viewer-source-cell">
      <header className={styles.cellToolbar}>
        <span className={styles.cellLanguage}>
          <ModuleIcons.terminal size={13} strokeWidth={1.5} aria-hidden="true" />
          {strategyCodeLanguageLabel(source.language)} source
        </span>
        <span className={styles.cellMode}>
          <EvidenceIcons.locked size={11} strokeWidth={1.5} aria-hidden="true" />
          Viewer
        </span>
      </header>
      <ReadOnlyCodeMirror code={source.content} language={source.language} />
      <section
        className={styles.preview}
        data-status={preview.status}
        aria-label="WASM preview result"
      >
        <header><span>Projected output</span><code>{preview.moduleIdentity ?? "No module"}</code></header>
        <ProjectedOutput preview={preview} />
      </section>
    </section>
  );
}
