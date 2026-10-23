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
      <ul className="space-y-1 leading-relaxed">
        <li><b style={{ color: "var(--accent)" }}>◆</b> 推荐换到这一版；紫色底是推荐保持的区间，其上短线是重复的推荐判断，点线连接前后两任推荐。</li>
        <li><b style={{ color: "var(--fail)" }}>▼</b> 这一版此时因审阅失败失去资格，节点随之变淡并划去。</li>
        <li>刻度尺底边的短线是全部事件，点一下定位到相关版本。</li>
        <li>底部窄图：灰点是每次研究运行的年化（空心为失去资格），紫线是当时推荐版本的年化，蓝色虚线是年化目标。</li>
      </ul>
      <div className="label mb-1.5 mt-3">操作</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <span className="kbd">⌘K</span><span>跳到版本或执行命令</span>
        <span className="kbd">.</span><span>定位当前推荐</span>
        <span className="kbd">F</span><span>显示全部版本</span>
        <span className="kbd">⌘B / ⌘J</span><span>开关详情 / 底部面板</span>
      </div>
    </div>
  );
}
