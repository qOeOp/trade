import { PREDICTION, ROLE } from "../format";
import type { Role } from "../types";
import { RoleMark } from "../ui";

// What every mark on the lineage figure means; opened from the ruler.
export function Legend() {
  return (
    <div className="float w-[300px] p-3 text-[12px] muted">
      <div className="label mb-2">版本</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {(Object.keys(ROLE) as Role[]).map((role) => (
          <span key={role} className="inline-flex items-center gap-1.5" title={ROLE[role].hint}><RoleMark role={role} />{ROLE[role].label}</span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <span className="mono"><span style={{ color: "var(--ink-1)" }}>22.29%</span> 达标</span>
        <span className="mono"><span style={{ color: "var(--miss)" }}>17.61%</span> 未达标</span>
        {Object.values(PREDICTION).filter((p) => p.glyph).map((p) => (
          <span key={p.label}><b style={{ color: p.color }}>{p.glyph}</b> {p.label}</span>
        ))}
      </div>
      <div className="label mb-1.5 mt-3">事件</div>
      <ul className="space-y-1.5 leading-relaxed">
        <li className="flex gap-2"><Wash color="var(--accent)" />推荐保持在这一版的区间；点线连接前后两任推荐。</li>
        <li className="flex gap-2"><Wash color="var(--fail)" />这一版已失去资格（源码审阅失败）；何时失去看刻度尺上的红格。</li>
        <li>刻度尺上着色的格子是发生事件的区间：紫色推荐换了版本，红色有版本失去资格（数字是个数），灰色选线。悬停查看、点击定位。</li>
        <li>底部"研究进展"与谱系同一横轴：每次研究运行的年化画成从 0 出发的柱（向上盈利、向下亏损），虚线是年化目标。</li>
        <li>画布固定比例：滚轮或拖动平移，十字线读出所在试验。</li>
      </ul>
      <div className="label mb-1.5 mt-3">操作</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <span className="kbd">⌘K</span><span>跳到版本或执行命令</span>
        <span className="kbd">.</span><span>定位当前推荐</span>
        <span className="kbd">Home</span><span>回到横轴起点</span>
        <span className="kbd">⌘B / ⌘J</span><span>开关详情 / 底部面板</span>
      </div>
    </div>
  );
}

function Wash({ color }: { color: string }) {
  return <span className="mt-[5px] inline-block h-2.5 w-5 shrink-0 rounded-[3px]" style={{ background: color, opacity: 0.25 }} />;
}
