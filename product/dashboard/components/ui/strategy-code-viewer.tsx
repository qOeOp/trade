"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  normalizeStrategyCodeViewerProjection,
  strategyCodeLineCount,
} from "../../lib/strategy-code-viewer-contract";
import { UnavailableState } from "./evidence-strip";
import { EvidenceIcons, ModuleIcons } from "./iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameHeader,
} from "./panel-frame";
import styles from "./strategy-code-viewer.module.css";
import { ViewerChrome } from "./strategy-code-viewer/viewer-chrome";
import { ViewerEvidencePanel } from "./strategy-code-viewer/viewer-evidence-panel";
import { ViewerFileRail } from "./strategy-code-viewer/viewer-file-rail";
import { ViewerSourceCell } from "./strategy-code-viewer/viewer-source-cell";

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
      />
      <PanelFrameBody className={styles.body} mode="static">
        <motion.div
          className={styles.shell}
          data-availability={safeProjection.availability}
          initial={reduceMotion ? false : { opacity: 0, y: 12, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: reduceMotion ? 0 : 0.34, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <ViewerChrome
            state={safeProjection.availability}
            onCopy={safeProjection.availability === "available" ? copySource : undefined}
          />
          <div className={styles.workspace} data-slot="strategy-viewer-workspace">
            <ViewerFileRail source={safeProjection.source} />
            <section className={styles.contentFrame} data-slot="strategy-viewer-content-frame">
              <header className={styles.fileTabs} data-slot="strategy-viewer-file-tabs">
                <div className={styles.fileTab} data-active="true">
                  <EvidenceIcons.inspectFile aria-hidden="true" size={14} strokeWidth={1.5} />
                  <span>{safeProjection.source?.fileName ?? "strategy.rs"}</span>
                </div>
                <span className={styles.readOnlyBadge}>
                  <EvidenceIcons.locked aria-hidden="true" size={11} strokeWidth={1.5} />
                  Read only
                </span>
              </header>
              <div className={styles.contentBody}>
                {safeProjection.availability === "available"
                  && safeProjection.source
                  && safeProjection.wasmPreview ? (
                    <ViewerSourceCell source={safeProjection.source} preview={safeProjection.wasmPreview} />
                  ) : (
                    <div className={styles.unavailableOverlay} data-state={safeProjection.availability}>
                      {safeProjection.availability === "loading" ? (
                        <div className={styles.loading} aria-busy="true"><span />Loading strategy source…</div>
                      ) : (
                        <UnavailableState
                          density="compact"
                          icon={<ModuleIcons.terminal aria-hidden="true" size={17} />}
                          title="Strategy source unavailable"
                          detail="No verified Owner projection is available."
                          reason={safeProjection.reason ?? "STRATEGY_SOURCE_UNAVAILABLE"}
                        />
                      )}
                    </div>
                  )}
              </div>
            </section>
            <ViewerEvidencePanel projection={safeProjection} />
          </div>
        </motion.div>
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
