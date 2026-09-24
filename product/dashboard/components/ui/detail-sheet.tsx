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
  // Each showModal() starts a new generation of what the sheet shows; a close the sheet reports
  // itself records the generation it closed.
  const generation = useRef(0);
  const reportedGeneration = useRef(-1);
  const titleId = useId();

  useEffect(() => {
    const current = dialog.current;
    if (!current) return;
    if (open && !current.open) {
      generation.current += 1;
      current.showModal();
    } else if (!open && current.open) {
      current.close();
    }
  }, [open]);

  // Closing returns focus to the control that opened the sheet (dashboard.md: "Close returns focus
  // to that exact table trigger", and the same property for every sheet origin). The browser
  // provides it: closing a modal dialog, by the user or by `close()` above, focuses the element that
  // held focus when `showModal()` ran. This component used to repeat that in an animation frame,
  // and removing the repetition changed no browser acceptance, because it always chose the same
  // element. The acceptances' focus-return assertions are what prove the property. A dialog removed
  // from the page while open returns focus nowhere, with or without that repetition.
  //
  // A close the sheet performs itself tells the page inside the event that asked for it. The dialog
  // closes at once but its `close` event arrives as a later task, and until the page has heard it
  // the page still names the content it was showing: asking for that same content again in between
  // (Escape then Enter, a double click, a fast assistive-technology action) changes no state and
  // opens nothing.
  //
  // That close's own `close` event still arrives, one task later, and hearing it again is not
  // harmless: if the same content was asked for in between, the sheet has reopened and the late
  // event would clear what the page now shows, closing the reopened sheet (the calendar acceptance
  // measured it: reopened at 2568 ms, closed again from the page's effect at 2574 ms). So an event
  // is matched to a close by identity rather than by arrival order: an event reaching a sheet that
  // is open again belongs to an earlier generation and closes nothing it shows, and an event for
  // the generation whose close this sheet already reported has nothing left to report. Every other
  // close, such as the page closing the sheet by `open`, is reported when its event arrives.
  const requestClose = () => {
    reportedGeneration.current = generation.current;
    onClose();
    dialog.current?.close();
  };
  const closed = () => {
    if (dialog.current?.open) return;

    if (reportedGeneration.current === generation.current) return;
    onClose();
  };
  const cancelled = () => {
    reportedGeneration.current = generation.current;
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby={titleId}
      onClose={closed}
      onCancel={cancelled}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <PanelFrame className={styles.frame} as="aside">
        <PanelFrameHeader
          eyebrow={eyebrow}
          title={title}
          titleId={titleId}
          description={description}
          onClose={requestClose}
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
