import { useMemo } from "react";
import { Command } from "cmdk";
import type { LineageWidget } from "../model/types";
import { useAtom } from "../state/atom";
import { select } from "../state/selection";
import { paletteOpen } from "../state/shell";
import { Kbd } from "../components/Kbd";
import { VersionLine } from "../components/VersionLine";
import type { Action } from "./commands";

/** ⌘K: jump to any version by name or by what it changed, or run a command. */
export function CommandPalette({ lineage, actions }: { lineage?: LineageWidget; actions: readonly Action[] }) {
  const open = useAtom(paletteOpen);
  const nodes = useMemo(() => [...(lineage?.nodes ?? [])].sort((a, b) => (b.x ?? -1) - (a.x ?? -1)), [lineage]);
  const close = (run: () => void) => () => { paletteOpen.set(false); run(); };
  return (
    <Command.Dialog open={open} onOpenChange={paletteOpen.set} label="跳转或执行命令"
                    overlayClassName="fixed inset-0 z-40 bg-scrim"
                    contentClassName="fixed left-1/2 top-[14%] z-50 w-[640px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-popup border border-popup-border bg-popup shadow-popup">
      <Command.Input placeholder="版本名、改动内容或命令…" autoFocus className="w-full border-b border-line bg-transparent px-3.5 py-2.5 text-ui outline-none" />
      <Command.List className="max-h-96 overflow-auto p-1 text-dense">
        <Command.Empty className="px-3 py-6 text-center text-fg-faint">没有匹配的版本或命令</Command.Empty>
        <Command.Group heading="命令">
          {actions.filter((a) => a.id !== "palette").map((a) => (
            <Command.Item key={a.id} onSelect={close(a.run)} className="flex cursor-pointer items-center rounded-control px-2.5 py-1.5 text-fg-muted">
              {a.label}{a.keys && <span className="ml-auto"><Kbd>{a.keys}</Kbd></span>}
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading={`版本 · ${nodes.length}`}>
          {nodes.map((n) => (
            <Command.Item key={n.id} value={`${n.id} ${n.change ?? ""}`} onSelect={close(() => select(n.id, { reveal: true }))}
                          className="flex cursor-pointer items-center gap-3 rounded-control px-2.5 py-1">
              <VersionLine node={n} targets={lineage?.targets ?? null} />
              <span className="min-w-0 flex-1 truncate text-small text-fg-faint">{n.change}</span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
