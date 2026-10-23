import { X } from "lucide-react";
import { PREDICTION, STATUS } from "../format";

// What every mark on the lineage figure means; opened from the ruler.
export function Legend({ onClose }: { onClose: () => void }) {
  return (
    <div className="card w-72 p-3 text-xs muted shadow-sm">
      <div className="mb-1.5 flex items-center justify-between font-semibold" style={{ color: "var(--ink-1)" }}>
        图例<button onClick={onClose} aria-label="收起图例"><X size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {Object.values(STATUS).map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color, border: "1px solid var(--ink-2)" }} />{s.label}
          </span>
        ))}
        {Object.values(PREDICTION).filter((p) => p.glyph).map((p) => (
          <span key={p.label}><b style={{ color: p.color }}>{p.glyph}</b> {p.label}</span>
        ))}
      </div>
      <ul className="mt-2 space-y-1 leading-relaxed">
        <li><b style={{ color: "var(--s-recommended)" }}>◆</b> 推荐换到这一版；浅黄底是推荐保持的区间，其上短竖线是重复的推荐判断，金色折线连起前后两任推荐。</li>
        <li><b style={{ color: "var(--s-failed)" }}>▼</b> 这一版在此时因源码审阅失败而失去资格，之后节点变淡。</li>
        <li>顶部刻度尺：底边的短线是全部事件（金：推荐判断，红：资格变化，灰：选线）。</li>
        <li>底部窄图：每次研究运行的年化（空心为失去资格），金色阶梯是当时推荐版本的年化，绿色虚线是年化目标。</li>
        <li>悬停任一元素会高亮同一版本；点节点看详情，滚轮缩放，拖动平移。</li>
      </ul>
    </div>
  );
}
