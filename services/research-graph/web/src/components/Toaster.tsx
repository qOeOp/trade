import { Toaster as Sonner } from "sonner";
import { Icon } from "../icons/Icon";

/** Where notifications appear: bottom right, as IntelliJ's balloons, in the page's surfaces. */
export function Toaster() {
  return (
    <Sonner position="bottom-right" offset={44} gap={8} duration={6000}
      icons={{ info: <Icon name="info" />, success: <Icon name="success" />, warning: <Icon name="warning" /> }}
      toastOptions={{ unstyled: true, classNames: {
        toast: "enter flex w-80 items-start gap-2.5 rounded-popup border border-popup-border bg-popup p-3 text-dense text-fg shadow-xl",
        icon: "mt-0.5 shrink-0",
        content: "min-w-0 flex-1 space-y-0.5",
        title: "font-semibold",
        description: "text-fg-muted",
        actionButton: "shrink-0 self-center rounded-control px-2 py-0.5 text-recommended transition-colors hover:bg-hover",
      } }} />
  );
}
