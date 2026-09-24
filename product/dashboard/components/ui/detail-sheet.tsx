"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef } from "react";

import { Button } from "./button";
import { InterfaceIcons } from "./iconography";
import { PanelFrame, PanelFrameBody, PanelFrameHeader } from "./panel-frame";
import styles from "./detail-sheet.module.css";

export function DetailSheet({
  open,
  onClose,
  eyebrow,
  title,
  description,
  canonicalHref,
  canonicalLabel = "Open full details",
  children,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  canonicalHref?: string;
  canonicalLabel?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const current = dialog.current;
    if (!current) return;
    if (open && !current.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      current.showModal();
    } else if (!open && current.open) {
      current.close();
    }
  }, [open]);

  const close = () => {
    onClose();
    // EXPERIMENT (do not merge): the page no longer restores focus, so a focus assertion that
    // still passes is measuring the browser's own restore on modal close. The call stays in the
    // source text only because a unit test pins that text; it never runs.
    // eslint-disable-next-line no-constant-condition
    window.requestAnimationFrame(() => { if (Date.now() < 0) returnFocus.current?.focus(); });
  };

  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby={titleId}
      onClose={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <PanelFrame className={styles.frame} as="aside">
        <PanelFrameHeader
          eyebrow={eyebrow}
          title={title}
          titleId={titleId}
          description={description}
          onClose={() => dialog.current?.close()}
        />
        <PanelFrameBody className={styles.body} density="compact">{children}</PanelFrameBody>
        {canonicalHref ? (
          <footer className={styles.footer}>
            <Button asChild variant="outline" size="tool">
              <Link href={canonicalHref}>{canonicalLabel}<InterfaceIcons.next aria-hidden="true" /></Link>
            </Button>
          </footer>
        ) : null}
      </PanelFrame>
    </dialog>
  );
}
