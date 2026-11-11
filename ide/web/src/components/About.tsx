import { useEffect, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { Icon } from "../icons/Icon";
import { shortSha } from "../lib/format";
import { commitHref, guideHref, releaseHref, ledgerGap, paperLine, placeOf, runtimeDigest, type About } from "../model/about";
import { summary } from "../model/marketImport";
import { useAgentService } from "../state/agent";
import { copyFault, readAbout, useAbout, usePaperHealth, usePublicCopy } from "../state/about";
import { useOverviewService } from "../state/market";
import { useMarketImport } from "../state/marketImport";
import { usePaperService } from "../state/paper";
import { FormButton } from "./chat/Field";
import { Sheet } from "./Sheet";

const LINK = "text-fg underline decoration-line-strong underline-offset-3 hover:decoration-current";
const External = ({ href, children }: { href: string; children: ReactNode }) =>
  <a className={LINK} href={href} target="_blank" rel="noreferrer">{children} ↗</a>;
const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono">{children}</span>;
const Code = ({ children }: { children: ReactNode }) => <code className="font-mono text-fg">{children}</code>;

const NAMES = { checking: "Checking…", absent: "Not deployed", offline: "Offline", present: "Connected" };
const DOT = { fail: "bg-fail", misses: "bg-misses" };

/** A fault's line: the dot the rail and the status bar mark the same fact with. */
const Fault = ({ tone, children }: { tone: keyof typeof DOT | null; children: ReactNode }) =>
  <>{tone && <i className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${DOT[tone]}`} />}{children}</>;

function Row({ name, children }: { name: string; children: ReactNode }) {
  return <><dt className="text-fg-faint">{name}</dt><dd className="min-w-0 break-words text-fg-muted">{children}</dd></>;
}

function Ledger({ about }: { about: About }) {
  const gap = ledgerGap(about), place = about.ledger?.remote ? placeOf(about.ledger.remote) : null, fault = copyFault(about);
  return (
    <>
      <Row name="Ledger">
        {gap ?? (place?.href ? <External href={place.href}><Mono>{place.name}</Mono></External> : <Mono>{place?.name}</Mono>)}
      </Row>
      {about.ledger?.commit && <Row name="Ledger commit"><Mono>{shortSha(about.ledger.commit)}</Mono></Row>}
      {fault && <Row name="Public copy"><Fault tone="fail">{fault.long}</Fault></Row>}
    </>
  );
}

function Services() {
  const agent = useAgentService(), paper = usePaperService(), health = usePaperHealth();
  const market = useOverviewService(), imports = useMarketImport();
  const said = imports.kind === "ready" ? summary(imports.reply) : null;
  return (
    <>
      <Row name="Agent"><Fault tone={agent === "offline" ? "fail" : null}>{NAMES[agent]}</Fault></Row>
      <Row name="Paper"><Fault tone={paper === "offline" ? "fail" : null}>{NAMES[paper]}{paper === "present" && health ? ` · ${paperLine(health)}` : ""}</Fault></Row>
      {paper === "present" && health?.runtime && <Row name="Paper image"><Code>{runtimeDigest(health.runtime)}</Code></Row>}
      <Row name="Market page"><Fault tone={market === "offline" ? "fail" : null}>{NAMES[market]}</Fault></Row>
      <Row name="Market import">
        {said ? <Fault tone={said.tone}>{said.text.replace(/^Market: /, "")}</Fault>
          : imports.kind === "unavailable" ? <Fault tone="fail">{imports.error.code}</Fault>
            : imports.kind === "absent" ? NAMES.absent : NAMES.checking}
      </Row>
    </>
  );
}

/** The status bar's item for a public copy changed elsewhere or long behind; nothing otherwise. */
export function PublicCopyStatus() {
  const fault = usePublicCopy();
  return fault && <span role="status" title={fault.long} className="flex min-w-0 items-center gap-1.5 text-fg-muted">
    <Icon name="warning" size={12} tone="fail" /><span className="truncate">{fault.short}</span>
  </span>;
}

/** What this deployment runs and where to go next. It only reads: every value is changed in the deployment. */
function AboutBody() {
  const reading = useAbout();
  return (
    <div className="space-y-3 text-dense">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {reading.kind === "ready" && <>
          <Row name="Version">
            {reading.about.version && <><External href={releaseHref(reading.about.version)}><Mono>{reading.about.version}</Mono></External> · </>}
            <External href={commitHref(reading.about.build)}><Mono>{shortSha(reading.about.build)}</Mono></External>
          </Row>
          <Ledger about={reading.about} />
        </>}
        {reading.kind === "reading" && <Row name="Ledger">Reading…</Row>}
        {reading.kind === "unavailable" && <Row name="Ledger">{reading.message}</Row>}
        <Services />
      </dl>
      <p className="text-fg-muted">
        Research runs through the Agent: ask it to start research. A version then runs on paper from its menu, with public
        market data and simulated fills. Real orders go only through the operator's <Code>live</Code> command, never from this page.
      </p>
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        <External href={guideHref("deploy/README.md")}>Deployment guide</External>
        <External href={guideHref("deploy/remote/README.md")}>Remote host</External>
        <External href="https://qoeop.github.io/trade/">Design</External>
      </p>
    </div>
  );
}

const useRead = (open: boolean) => useEffect(() => { if (open) void readAbout(); }, [open]);
const TITLE = "About this deployment";
const NOTE = "Read only. These are set in the deployment's configuration.";

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useRead(open);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content className="fixed left-1/2 top-[18%] z-50 w-[440px] max-w-[calc(100vw-32px)] -translate-x-1/2 space-y-3 rounded-popup border border-popup-border bg-popup p-4 text-dense shadow-popup outline-none">
          <div>
            <Dialog.Title className="text-ui font-semibold">{TITLE}</Dialog.Title>
            <Dialog.Description className="text-fg-muted">{NOTE}</Dialog.Description>
          </div>
          <AboutBody />
          <div className="flex justify-end pt-1"><FormButton onClick={onClose}>Close</FormButton></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AboutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useRead(open);
  return (
    <Sheet open={open} onClose={onClose} title={TITLE}>
      <div className="space-y-3 px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-1">
        <div>
          <p aria-hidden className="text-ui font-semibold">{TITLE}</p>
          <p className="text-dense text-fg-muted">{NOTE}</p>
        </div>
        <AboutBody />
      </div>
    </Sheet>
  );
}
