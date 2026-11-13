import type { ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import { copyText } from "../lib/clipboard";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { openSource, showLineage } from "../state/editors";
import { requestFocus } from "../state/linking";
import { select } from "../state/selection";
import { useAtom } from "../state/atom";
import { activeRun, full, startDialog, starting, stopDialog, usePaperRuns, usePaperService } from "../state/paper";
import { showRunsPage, showToolWindow } from "../state/shell";

/** One item of a right-click menu: its icon in a fixed slot, then its label. */
export function MenuItem({ icon, label, run, disabled }: { icon?: IconName; label: string; run: () => void; disabled?: boolean }) {
  return (
    <ContextMenu.Item onSelect={run} disabled={disabled}
                      className="flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none data-highlighted:bg-selection data-disabled:text-fg-faint">
      <span className="grid w-4 shrink-0 place-items-center text-icon">{icon && <Icon name={icon} />}</span>{label}
    </ContextMenu.Item>
  );
}

export const MenuSeparator = () => <ContextMenu.Separator className="my-1 h-px bg-line-strong" />;

/** A right-click menu on `children`, headed by what it acts on. */
export function Menu({ title, items, children }: { title: string; items: ReactNode; children: ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-52 rounded-popup border border-popup-border bg-popup p-1 text-dense shadow-popup">
          <ContextMenu.Label className="truncate px-2 pb-1 pt-1.5 font-mono text-small text-fg-faint">{title}</ContextMenu.Label>
          {items}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** Selects version `id` and brings it into view on the graph. */
export const locate = (id: string) => { select(id); showLineage(); requestFocus(id); };

/** The right-click menu of a version, the same wherever the version appears. */
export function VersionMenu({ id, children }: { id: string; children: ReactNode }) {
  const link = `${window.location.href.split("#")[0]}#${encodeURI(id)}`;
  const paper = usePaperService() === "present";
  const listing = usePaperRuns(), run = activeRun(listing, id), pending = useAtom(starting).has(id);
  const taken = full(listing) ? " · memory full" : "";
  return (
    <Menu title={id} items={<>
      <MenuItem icon="locate" label="Locate in graph" run={() => locate(id)} />
      <MenuItem icon="tool.inspector" label="Show in details" run={() => { select(id); showToolWindow("inspector", "right"); }} />
      <MenuItem icon="file.python" label="Open source" run={() => openSource(id)} />
      <MenuItem icon="tool.runs" label="Open runs" run={() => { select(id); showRunsPage(); }} />
      {paper && <>
        <MenuSeparator />
        {run ? <MenuItem icon="stop" label="Stop paper…" run={() => stopDialog.set(run)} />
          : <MenuItem icon="run" label={pending ? "Starting paper…" : `Run paper…${taken}`} disabled={pending} run={() => startDialog.set(id)} />}
      </>}
      <MenuSeparator />
      <MenuItem icon="copy" label="Copy version name" run={() => void copyText(id)} />
      <MenuItem label="Copy link" run={() => void copyText(link)} />
    </>}>{children}</Menu>
  );
}
