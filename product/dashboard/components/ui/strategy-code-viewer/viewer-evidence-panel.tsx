import {
  strategyCodeLanguageLabel,
  type StrategyCodeViewerProjection,
} from "../../../lib/strategy-code-viewer-contract";
import { EvidenceIcons } from "../iconography";
import styles from "../strategy-code-viewer.module.css";

function shortDigest(digest: string | undefined): string {
  return digest ? `${digest.slice(0, 17)}…${digest.slice(-8)}` : "-";
}

export function ViewerEvidencePanel({ projection }: { projection: StrategyCodeViewerProjection }) {
  const available = projection.availability === "available" && projection.source && projection.wasmPreview;
  const facts = [
    ["Artifact", available ? projection.artifactIdentity : "-"],
    ["Language", available ? strategyCodeLanguageLabel(projection.source.language) : "-"],
    ["Source digest", available ? shortDigest(projection.source.digest) : "-"],
    ["Observed UTC", available ? projection.observedAt : "-"],
    ["Wasm preview", available ? projection.wasmPreview.status.replace("_", " ") : "-"],
  ] as const;

  return (
    <aside className={styles.evidencePanel} data-slot="strategy-viewer-evidence-panel" aria-label="Source evidence">
      <header>
        <span>Evidence</span>
        <EvidenceIcons.locked size={13} strokeWidth={1.5} aria-hidden="true" />
      </header>
      <dl>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd title={value ?? undefined}>{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
