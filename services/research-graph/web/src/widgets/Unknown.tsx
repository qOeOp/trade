import type { Widget } from "../model/types";

/** A widget type this page does not draw, named rather than dropped. */
export function Unknown({ widget }: { widget: Widget }) {
  return <p className="p-3 text-fg-faint">此页面不支持 widget 类型 <span className="font-mono">{widget.type}</span></p>;
}
