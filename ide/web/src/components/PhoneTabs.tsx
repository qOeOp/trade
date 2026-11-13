import type { ReactNode } from "react";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import type { DataRole } from "../theme/roles";
import { CornerDot } from "./StripeButton";

export type PhoneTabItem<T> = { id: T; icon: IconName; label: string; dot?: DataRole };

/** The tabs along a phone's foot: each the side stripe's button (the tool window's icon on a filled square
 *  while open, a dot on its corner while something runs there) with its name under it. */
export function PhoneTabs<T extends string>({ items, value, onChange, accessory }: { items: readonly PhoneTabItem<T>[]; value: T; onChange: (id: T) => void; accessory?: ReactNode }) {
  return (
    <nav aria-label="Pages" className="flex shrink-0 justify-around border-t border-line bg-frame pb-[env(safe-area-inset-bottom)] pt-1">
      {items.map((tab) => {
        const on = tab.id === value;
        return (
          <button key={tab.id} type="button" aria-current={on ? "page" : undefined} onClick={() => onChange(tab.id)}
                  className={`flex min-h-12 min-w-16 flex-col items-center gap-0.5 text-small ${on ? "text-fg" : "text-fg-muted"}`}>
            <span className={`relative grid size-7 place-items-center rounded-popup transition-colors ${on ? "bg-pressed text-fg" : "text-icon"}`}>
              <Icon name={tab.icon} size={20} />
              {tab.dot && <CornerDot role={tab.dot} />}
            </span>
            {tab.label}
          </button>
        );
      })}
      {accessory}
    </nav>
  );
}
