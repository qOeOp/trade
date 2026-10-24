import { toast } from "sonner";

// Notifications, as IntelliJ's balloons: an icon by kind, a title, an optional line and one action.
export type Notice = { kind?: "info" | "success" | "warning"; title: string; detail?: string; action?: { label: string; run: () => void } };

export function notify({ kind = "info", title, detail, action }: Notice): void {
  toast[kind](title, { description: detail, action: action && { label: action.label, onClick: action.run } });
}
