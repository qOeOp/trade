import type { EventItem, EventsWidget, Focus } from "../types";
import { when } from "../format";
import { Marker } from "./Lineage";

const KINDS: Record<string, string> = {
  recommendation: "推荐判断", priority: "优先级", user_message: "用户消息", agent_question: "向用户提问",
  eligibility_change: "资格变化", goal: "Goal", line_change: "换线",
};

// Every event in time order; hovering one marks its moment and versions on the canvas, choosing
// one moves the canvas there.
export function Events({ widget, onFocus, onHover }: {
  widget: EventsWidget; onFocus: (f: Omit<Focus, "seq">) => void; onHover: (e: EventItem | null) => void;
}) {
  if (!widget.items.length) return <p className="faint">此来源没有事件记录。</p>;
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="faint">{["时间", "类型", "涉及版本", "内容"].map((h) => <th key={h} className="py-1 pr-3 text-left font-medium">{h}</th>)}</tr>
      </thead>
      <tbody>
        {widget.items.map((e, i) => (
          <tr key={i} className="cursor-pointer align-top hover:bg-[var(--surface-0)]"
              onMouseEnter={() => onHover(e)} onMouseLeave={() => onHover(null)}
              onClick={() => onFocus({ candidate: e.kind === "eligibility_change" ? undefined : e.candidates[0], x: e.x })}>
            <td className="mono whitespace-nowrap border-t py-1 pr-3" style={{ borderColor: "var(--rule)" }}>{when(e.at)}</td>
            <td className="whitespace-nowrap border-t py-1 pr-3" style={{ borderColor: "var(--rule)" }}>
              <span className="inline-flex items-center gap-1.5"><span className="flex w-3.5 justify-center"><Marker kind={e.kind} /></span>{KINDS[e.kind] ?? e.kind}</span>
            </td>
            <td className="mono border-t py-1 pr-3" style={{ borderColor: "var(--rule)" }}>{e.candidates.join(", ")}</td>
            <td className="border-t py-1" style={{ borderColor: "var(--rule)" }}>{e.text ?? e.ref ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
