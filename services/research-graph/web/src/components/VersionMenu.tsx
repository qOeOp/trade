import type { ReactElement } from "react";
import { ContextMenu } from "radix-ui";
import { copyText } from "../lib/clipboard";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { openVersionTab } from "../state/editors";
import { requestFocus } from "../state/linking";
import { select } from "../state/selection";
import { showToolWindow } from "../state/shell";

const ITEM = "flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none data-highlighted:bg-selection";

function Item({ icon, label, run }: { icon?: IconName; label: string; run: () => void }) {
  return (
    <ContextMenu.Item onSelect={run} className={ITEM}>
      <span className="grid w-4 shrink-0 place-items-center text-icon">{icon && <Icon name={icon} />}</span>{label}
    </ContextMenu.Item>
  );
}

/** The right-click menu of a version, the same wherever the version appears. */
export function VersionMenu({ id, children }: { id: string; children: ReactElement }) {
  const link = `${window.location.href.split("#")[0]}#${encodeURI(id)}`;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-52 rounded-popup border border-popup-border bg-popup p-1 text-dense shadow-popup">
          <ContextMenu.Label className="truncate px-2 pb-1 pt-1.5 font-mono text-small text-fg-faint">{id}</ContextMenu.Label>
          <Item icon="locate" label="在图中定位" run={() => { select(id); requestFocus(id); }} />
          <Item icon="tool.inspector" label="在详情中显示" run={() => { select(id); showToolWindow("inspector", "right"); }} />
          <Item icon="lineage" label="在新标签打开" run={() => openVersionTab(id)} />
          <ContextMenu.Separator className="my-1 h-px bg-line-strong" />
          <Item icon="copy" label="复制版本名" run={() => void copyText(id)} />
          <Item label="复制链接" run={() => void copyText(link)} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
