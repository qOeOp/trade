import type { ReactNode } from "react";
import { Icon } from "../icons/Icon";
import { Pressable } from "./Pressable";

/** A notice over the page until it is closed, its icon in the colour of what it says. */
export function Notice({ tone, title, children, onClose }: { tone: "fail" | "misses"; title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-popup border border-line-strong bg-popup px-4 py-3 text-dense shadow-popup">
      <Icon name="warning" size={16} tone={tone} className="mt-0.5 shrink-0" />
      <div className="min-w-0 wrap-anywhere">
        <p className="font-medium text-fg">{title}</p>
        {children}
      </div>
      <Pressable aria-label="Close" onClick={onClose}
              className="-mr-1 grid size-6 shrink-0 place-items-center rounded-control text-fg-faint hover:bg-hover active:bg-pressed">
        <Icon name="close" size={12} />
      </Pressable>
    </div>
  );
}
