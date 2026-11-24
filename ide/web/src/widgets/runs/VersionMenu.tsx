import type { ReactNode } from "react";
import { copyText } from "../../lib/clipboard";
import { versionHref } from "../../lib/lines";
import { useView } from "../../model/view";
import { locate, openSource } from "../../state/editors";
import { select } from "../../state/selection";
import { useAtom } from "../../state/atom";
import { activeRun, full, startDialog, starting, stopDialog, usePaperRuns, usePaperService } from "../../state/paper";
import { showRunsPage, showToolWindow } from "../../state/shell";
import { Menu, MenuItem, MenuSeparator } from "../../ui/ContextMenu";

/** The right-click menu of a version, the same wherever the version appears. */
export function VersionMenu({ id, children }: { id: string; children: ReactNode }) {
  const { line } = useView();
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
      <MenuItem label="Copy link" run={() => void copyText(versionHref(window.location.href, line.name, id))} />
    </>}>{children}</Menu>
  );
}
