import type { StrategyCodeSource } from "../../../lib/strategy-code-viewer-contract";
import { EvidenceIcons } from "../iconography";
import styles from "../strategy-code-viewer.module.css";

export function ViewerFileRail({ source }: { source: StrategyCodeSource | null }) {
  return (
    <aside className={styles.fileRail} data-slot="strategy-viewer-file-rail" aria-label="Artifact files">
      <header>Files</header>
      <div className={styles.fileRailBody}>
        <div className={styles.fileGroup}>
          <EvidenceIcons.artifact size={13} strokeWidth={1.5} aria-hidden="true" />
          <span>artifact</span>
        </div>
        <div className={styles.fileItem} data-active={source ? "true" : undefined}>
          <EvidenceIcons.inspectFile size={13} strokeWidth={1.5} aria-hidden="true" />
          <span>{source?.fileName ?? "source unavailable"}</span>
        </div>
      </div>
    </aside>
  );
}
