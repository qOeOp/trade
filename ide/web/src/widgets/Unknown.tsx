import type { Widget } from "../model/types";

/** A widget type this page does not draw, named rather than dropped. */
export function Unknown({ widget }: { widget: Widget }) {
  return <p className="p-3 text-fg-faint">This page has no renderer for widget type <span className="font-mono">{widget.type}</span></p>;
}
