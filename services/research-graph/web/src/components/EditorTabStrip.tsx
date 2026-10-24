import type { IconName } from "../icons/registry";
import { Icon } from "../icons/Icon";

export type EditorTab = { id: string; label: string; icon: IconName; closable: boolean };

/** Editor tabs as IntelliJ draws them: icon and name, the active one on a rounded fill, a small close
 *  button on closable tabs. */
export function EditorTabStrip({ tabs, active, onActivate, onClose }: {
  tabs: readonly EditorTab[]; active: string; onActivate: (id: string) => void; onClose: (id: string) => void;
}) {
  return (
    <div role="tablist" className="flex h-(--header-h) shrink-0 items-center gap-0.5 overflow-x-auto px-2">
      {tabs.map((t) => (
        <div key={t.id} role="tab" aria-selected={t.id === active} tabIndex={0} onClick={() => onActivate(t.id)}
             onKeyDown={(e) => { if (e.key === "Enter") onActivate(t.id); }}
             onAuxClick={(e) => { if (e.button === 1 && t.closable) onClose(t.id); }}
             className={`group flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-control pl-2 text-dense transition-colors hover:bg-hover ${t.id === active ? "bg-pressed text-fg" : "text-fg-muted"} ${t.closable ? "pr-1" : "pr-2"}`}>
          <Icon name={t.icon} />
          <span className="font-mono">{t.label}</span>
          {t.closable && (
            <button type="button" aria-label={`关闭 ${t.label}`} onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
                    className="grid size-5 place-items-center rounded-badge text-icon opacity-60 transition hover:bg-hover hover:opacity-100">
              <Icon name="close-small" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
