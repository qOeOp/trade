"""Static renderer: a view model to one self-contained HTML page with inline SVG and no script.

Selecting a node opens its detail through a #fragment and CSS :target, so the page works in
previews that block scripts. Labels, colours and pixels belong here; the view model carries only
meaning. Colours are the validated status slots in style.css (light and dark).
"""
from __future__ import annotations

import html
import os
import re
from pathlib import Path
from string import Template

HERE = Path(__file__).resolve().parent
STATUS = {"recommended": ("当前推荐", "--s-recommended"), "meets_targets": ("达标", "--s-meets"),
          "below_targets": ("未达标", "--s-below"), "masked": ("失去资格", "--s-masked"),
          "precheck_failed": ("预检或审阅失败", "--s-failed"), "unrun": ("未回放", "--s-unrun")}
PREDICTION = {"held": ("✓", "预测全部成立"), "failed": ("✗", "预测全部失败"), "mixed": ("±", "预测部分成立"),
              "none": ("", "预测未判定")}
LANES = {"recommendation": "推荐判断", "user_message": "用户消息", "agent_question": "向用户提问",
         "eligibility_change": "资格变化", "goal": "Goal / 换线"}
ROW, TOP, LABEL_W, RIGHT, UNIT, LANE = 24, 40, 250, 130, 7, 22


def e(value) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def pct(value) -> str:
    return "—" if value is None else f"{value * 100:.2f}%"


def ratio(value) -> str:
    return "—" if value is None else f"{value:.2f}"


def anchor(cid: str) -> str:
    return "c-" + re.sub(r"[^A-Za-z0-9_-]", "_", cid)


def marker(kind: str, x: float, y: float) -> str:
    """The shape of one event: identity by shape, so colour is never the only cue."""
    if kind == "recommendation":
        return f'<path d="M{x:.1f},{y - 6} l6,6 l-6,6 l-6,-6 z" fill="var(--s-recommended)" stroke="var(--surface-1)" stroke-width="1.5"/>'
    if kind == "user_message":
        return f'<circle cx="{x:.1f}" cy="{y}" r="5" fill="var(--ink-1)"/>'
    if kind == "agent_question":
        return (f'<circle cx="{x:.1f}" cy="{y}" r="6.5" fill="var(--surface-1)" stroke="var(--ink-1)" stroke-width="1.25"/>'
                f'<text x="{x:.1f}" y="{y + 3.5}" text-anchor="middle" font-size="9.5" font-weight="700">?</text>')
    if kind == "eligibility_change":
        return f'<path d="M{x:.1f},{y - 6.5} l6.5,12 h-13 z" fill="var(--s-failed)" stroke="var(--surface-1)" stroke-width="1.5"/>'
    return f'<rect x="{x - 4.5:.1f}" y="{y - 4.5}" width="9" height="9" rx="1.5" fill="var(--ink-2)"/>'


def node_mark(status: str, x: float, y: float) -> str:
    """A version or a run: fill by status, a ring for the current recommendation, dashed when unrun."""
    if status == "recommended":
        return (f'<circle cx="{x:.1f}" cy="{y}" r="9.5" fill="none" stroke="var(--s-recommended)" stroke-width="1.75"/>'
                f'<circle cx="{x:.1f}" cy="{y}" r="6" fill="var(--s-recommended)" stroke="var(--ink-1)" stroke-width="1"/>')
    if status == "unrun":
        return (f'<circle cx="{x:.1f}" cy="{y}" r="5.5" fill="var(--surface-1)" stroke="var(--ink-3)" '
                f'stroke-width="1.25" stroke-dasharray="2 2"/>')
    return f'<circle cx="{x:.1f}" cy="{y}" r="5.5" fill="var({STATUS[status][1]})" stroke="var(--ink-1)" stroke-width="1"/>'


def label(cid: str, prefix: str) -> str:
    """A candidate id with the shared prefix and the revision recessive."""
    name, _, revision = cid.partition("@")
    lead = prefix if prefix and name.startswith(prefix) else ""
    head = f'<tspan class="ns">{e(lead)}</tspan>' if lead else ""
    return f'{head}{e(name[len(lead):])}<tspan class="ns">@{e(revision)}</tspan>'


def summary(widget: dict) -> str:
    """summary/1: the current recommendation against the targets and how long it has held."""
    targets, reading = widget["targets"] or {}, widget.get("reading") or {}
    goal = (f'目标 年化 ≥ {pct(targets.get("annual_return"))} · 回撤 ≤ {pct(targets.get("max_drawdown"))}'
            if targets else "未记录目标")
    tiles = [
        ("hero", "当前推荐", f'<div class="value sm mono">{e(widget.get("recommended") or "—")}</div>',
         f'年化 {pct(reading.get("annual_return"))} · 回撤 {pct(reading.get("max_drawdown"))} · '
         f'夏普 {ratio(reading.get("sharpe"))}<br>{goal}'),
        ("", "推荐保持不变", f'<div class="value">{widget["runs_since_recommendation_changed"]} 次</div>',
         f'研究运行；最近 {widget["recommendations_unchanged"]} / {widget["recommendations"]} 条推荐判断未换版本'),
        ("", "策略版本", f'<div class="value">{widget["versions"]}</div>', f'研究回放 {widget["research_runs"]} 次'),
        ("", "达到两个目标", f'<div class="value">{widget["meeting_targets"]}</div>', "个版本（按最后一次研究回放）"),
        ("", "失去资格的运行", f'<div class="value">{widget["masked_runs"]}</div>', "源码审阅失败等原因，读数不再计入比较"),
    ]
    return "".join(f'<div class="tile {kind}"><div class="label">{title}</div>{value}<div class="note">{note}</div></div>'
                   for kind, title, value, note in tiles)


def lineage(widget: dict) -> str:
    """lineage/1: versions by trial number in lineage rows, recommendation spans and event lanes."""
    axis, rows, nodes = widget["axis"], widget["rows"], widget["nodes"]
    span = (axis["max"] - axis["min"]) or 1
    width = int(LABEL_W + span * UNIT + RIGHT)
    lane_top = TOP + len(rows) * ROW + 26
    height = lane_top + len(widget["lanes"]) * LANE + 16
    prefix = os.path.commonprefix([r["id"] for r in rows])
    prefix = prefix[: prefix.rfind("-") + 1] if "-" in prefix else ""

    def px(x):
        return LABEL_W + (x - axis["min"]) * UNIT

    def py(row):
        return TOP + row * ROW + ROW / 2

    at = {n["id"]: n for n in nodes}
    layers: dict[str, list[str]] = {"stripes": [], "scope": [], "bands": [], "edges": [], "rows": [], "lanes": []}
    layers["stripes"] = [f'<rect x="0" y="{py(r["row"]) - ROW / 2}" width="{width}" height="{ROW}" fill="var(--stripe)"/>'
                         for r in rows if r["row"] % 2]
    if axis.get("scope_start") is not None:
        x = px(axis["scope_start"])
        layers["scope"].append(
            f'<rect x="{LABEL_W}" y="{TOP - 16}" width="{max(0.0, x - LABEL_W):.1f}" height="{height - TOP}" fill="var(--scope)" opacity=".7"/>'
            f'<text class="tick" x="{x - 6:.1f}" y="{height - 6}" text-anchor="end">← 范围之前</text>'
            f'<text class="tick" x="{x + 6:.1f}" y="{height - 6}">本次范围 →</text>')
    for tick in axis["ticks"]:
        x = px(tick)
        layers["scope"].append(f'<line class="grid" x1="{x:.1f}" x2="{x:.1f}" y1="{TOP - 16}" y2="{height - 18}"/>'
                               f'<text class="tick" x="{x:.1f}" y="{TOP - 22}" text-anchor="middle">trial {tick}</text>')
    merged: list[dict] = []
    for band in widget["bands"]:
        if band["x0"] is None:
            continue
        if merged and merged[-1]["candidate"] == band["candidate"]:
            merged[-1].update(x1=band["x1"], count=merged[-1]["count"] + 1)
        else:
            merged.append({**band, "count": 1})
    for band in merged:
        x0, x1 = px(band["x0"]), px(band["x1"] if band["x1"] is not None else axis["max"])
        y = py(band["row"])
        layers["bands"].append(
            f'<rect x="{x0:.1f}" y="{y - ROW / 2 + 2}" width="{max(3.0, x1 - x0):.1f}" height="{ROW - 4}" rx="4" fill="var(--band)">'
            f'<title>推荐 {e(band["candidate"])}：连续 {band["count"]} 条推荐判断</title></rect>')
        if x1 - x0 > 160:
            layers["bands"].append(f'<text class="tick" x="{x1 - 8:.1f}" y="{y + 3.5}" text-anchor="end">'
                                   f'推荐保持 · {band["count"]} 条判断</text>')
    for edge in widget["edges"]:
        a, b = at[edge["from"]], at[edge["to"]]
        if a["x"] is None or b["x"] is None:
            continue
        x1, y1, x2, y2 = px(a["x"]), py(a["row"]), px(b["x"]), py(b["row"])
        if y2 > y1:
            layers["edges"].append(f'<path class="edge" d="M{x1:.1f},{y1 + 7} V{y2 - 5} Q{x1:.1f},{y2} {x1 + 5:.1f},{y2} H{x2 - 8:.1f}"/>')
        else:
            layers["edges"].append(f'<path class="edge" d="M{x1:.1f},{y1 - 7} V{y2 + 5} Q{x1:.1f},{y2} {x1 + 5:.1f},{y2} H{x2 - 8:.1f}"/>')
    for node in nodes:
        y = py(node["row"])
        parts = [f'<rect class="hover" x="0" y="{y - ROW / 2}" width="{width}" height="{ROW}" fill="transparent"/>',
                 f'<text class="rowlbl mono" x="10" y="{y + 4}">{label(node["id"], prefix)}</text>']
        if node["x"] is not None:
            x = px(node["x"])
            glyph, said = PREDICTION[node["prediction"]]
            reading = node["reading"]
            parts.append(f'<a href="#{anchor(node["id"])}">{node_mark(node["status"], x, y)}'
                         f'<title>{e(node["id"])}｜{STATUS[node["status"]][0]}｜{said}\n{e((node.get("change") or "")[:200])}</title></a>')
            tx = x + 13
            if glyph:
                parts.append(f'<text class="pred {node["prediction"]}" x="{tx:.1f}" y="{y + 4}">{glyph}</text>')
                tx += 12
            if reading["annual_return"] is not None:
                parts.append(f'<text class="reading" x="{tx:.1f}" y="{y + 4}">'
                             f'{pct(reading["annual_return"])} · {pct(reading["max_drawdown"])}</text>')
        layers["rows"].append(f'<g class="row">{"".join(parts)}</g>')
    for n, lane in enumerate(widget["lanes"]):
        y = lane_top + n * LANE
        layers["lanes"].append(f'<text class="tick" x="10" y="{y + 4}">{LANES[lane["kind"]]}</text>'
                               f'<line class="grid" x1="{LABEL_W}" x2="{width - RIGHT}" y1="{y}" y2="{y}"/>')
        if not lane["events"]:
            layers["lanes"].append(f'<text class="tick" x="{LABEL_W + 8}" y="{y + 4}">此来源没有这类记录</text>')
        for ev in lane["events"]:
            if ev["x"] is None:
                continue
            tip = " · ".join(str(v) for v in (ev["at"][:16].replace("T", " "), ev.get("ref"), ev.get("text"),
                                              ev.get("recommends") and "推荐 " + ev["recommends"]) if v)
            layers["lanes"].append(f'<g>{marker(lane["kind"], px(ev["x"]), y)}<title>{e(tip)}</title></g>')
    body = "".join("".join(layer) for layer in layers.values())
    return f'<div class="scroll"><svg width="{width}" height="{height}" role="img" aria-label="策略谱系">{body}</svg></div>'


def scatter(widget: dict) -> str:
    """scatter/1: research runs by max drawdown and annual return, against the targets."""
    points, targets = widget["points"], widget["targets"] or {}
    w, h, left, bottom, top, right = 720, 420, 60, 44, 24, 16
    xmax = max([p["max_drawdown"] for p in points] + [targets.get("max_drawdown") or 0.0]) * 1.12 or 0.3
    ys = [p["annual_return"] for p in points] + [targets.get("annual_return") or 0.0]
    ymin, ymax = min(0.0, *ys) * 1.1, (max(ys) * 1.12) or 0.3

    def sx(v):
        return left + (w - left - right) * (v / xmax)

    def sy(v):
        return h - bottom - (h - bottom - top) * ((v - ymin) / ((ymax - ymin) or 1))

    out = []
    for i in range(6):
        vx, vy = xmax * i / 5, ymin + (ymax - ymin) * i / 5
        out.append(f'<line class="grid" x1="{sx(vx):.1f}" x2="{sx(vx):.1f}" y1="{top}" y2="{h - bottom}"/>'
                   f'<text class="tick" x="{sx(vx):.1f}" y="{h - bottom + 16}" text-anchor="middle">{pct(vx)}</text>'
                   f'<line class="grid" x1="{left}" x2="{w - right}" y1="{sy(vy):.1f}" y2="{sy(vy):.1f}"/>'
                   f'<text class="tick" x="{left - 6}" y="{sy(vy) + 3.5:.1f}" text-anchor="end">{pct(vy)}</text>')
    dd, ar = targets.get("max_drawdown"), targets.get("annual_return")
    if dd is not None and ar is not None:
        out.append(f'<rect x="{left}" y="{top}" width="{sx(dd) - left:.1f}" height="{sy(ar) - top:.1f}" fill="var(--ok-zone)" opacity=".09"/>'
                   f'<line class="target" x1="{sx(dd):.1f}" x2="{sx(dd):.1f}" y1="{top}" y2="{h - bottom}"/>'
                   f'<line class="target" x1="{left}" x2="{w - right}" y1="{sy(ar):.1f}" y2="{sy(ar):.1f}"/>'
                   f'<text class="tick" x="{left + 8}" y="{top + 14}">达到两个目标</text>'
                   f'<text class="tick" x="{sx(dd) + 5:.1f}" y="{top + 14}">回撤上限 {pct(dd)}</text>'
                   f'<text class="tick" x="{w - right - 4}" y="{sy(ar) - 6:.1f}" text-anchor="end">年化下限 {pct(ar)}</text>')
    out.append(f'<text class="tick" x="{(left + w - right) / 2}" y="{h - 8}" text-anchor="middle">最大回撤 →</text>'
               f'<text class="tick" x="{left}" y="{top - 10}">↑ 年化收益</text>')
    labelled = 0
    for p in sorted(points, key=lambda p: (p["status"] == "recommended", p["eligible"] is not False)):
        x, y = sx(p["max_drawdown"]), sy(p["annual_return"])
        if p["eligible"] is False:
            mark = f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="none" stroke="var(--ink-3)" stroke-width="1.25"/>'
        else:
            mark = node_mark(p["status"], x, y)
        out.append(f'<a href="#{anchor(p["id"])}">{mark}<title>{e(p["id"])} · trial {p["trial_id"]}：年化 {pct(p["annual_return"])} · '
                   f'回撤 {pct(p["max_drawdown"])}{"（失去资格）" if p["eligible"] is False else ""}</title></a>')
        if p["status"] == "recommended":
            ly = y - 10 - 15 * labelled
            out.append(f'<line x1="{x + 6:.1f}" y1="{y - 6:.1f}" x2="{x + 14:.1f}" y2="{ly + 3:.1f}" stroke="var(--ink-3)"/>'
                       f'<text class="reading" x="{x + 16:.1f}" y="{ly + 4:.1f}">{e(p["id"])}</text>')
            labelled += 1
    return f'<svg width="{w}" height="{h}" role="img" aria-label="研究运行的年化与最大回撤">{"".join(out)}</svg>'


def detail(c: dict, default: str | None) -> str:
    runs = [t for t in c.get("trials") or [] if t["purpose"] == "research"]
    last = runs[-1] if runs else {}
    kpis = "".join(f'<div class="kpi"><div class="label">{name}</div><div class="value">{value}</div></div>'
                   for name, value in (("年化", pct(last.get("annual_return"))), ("最大回撤", pct(last.get("max_drawdown"))),
                                       ("夏普", ratio(last.get("sharpe"))), ("胜率", pct(last.get("win_rate")))))
    trials = "".join(
        f'<tr><td class="mono">{e(t["trial_id"])}</td><td>{e(t["purpose"])}</td><td class="num">{pct(t.get("annual_return"))}</td>'
        f'<td class="num">{pct(t.get("max_drawdown"))}</td><td class="num">{ratio(t.get("sharpe"))}</td>'
        f'<td>{"✗ " + e(t.get("ineligible_reason")) if t.get("eligible") is False else "✓" if t.get("eligible") else "—"}</td></tr>'
        for t in c.get("trials") or []) or '<tr><td colspan="6">—</td></tr>'
    outcome = {"held": "✓ 成立", "failed": "✗ 失败", "untestable": "无法检验"}
    predictions = "".join(f'<tr><td class="mono">{e(p.get("measure"))}</td><td>{e(p.get("direction"))}</td>'
                          f'<td>{outcome.get(p.get("outcome") or "", "—")}</td></tr>' for p in c.get("predictions") or [])
    verdict = {"passed": "✓ 通过", "failed": "✗ 失败"}
    reviews = "".join(f'<tr><td>{verdict.get(r.get("verdict") or "", "—")}</td><td>{e(",".join(r.get("failed_items") or []))}</td>'
                      f'<td>{e((r.get("at") or "")[:16].replace("T", " "))}</td><td>{e(r.get("note"))}</td></tr>'
                      for r in c.get("reviews") or [])
    cmp = c.get("comparison") or {}
    compared = " · ".join(x for x in (
        cmp.get("vs_trial") is not None and f'对照 trial {cmp["vs_trial"]}',
        {True: "差值区间跨零", False: "差值区间不跨零", None: None}[cmp.get("interval_crosses_zero")],
        cmp.get("mean_daily_log_difference") is not None
        and f'日均对数差 {cmp["mean_daily_log_difference"]:.6g}（可检出 {cmp.get("detectable")}）',
        cmp.get("summary")) if x) or "—"
    meta = " · ".join(x for x in (f'父版本 {c.get("parent") or "无（根）"}', (c.get("created_at") or "")[:16].replace("T", " "),
                                  "职责 " + (" ".join(c.get("duties") or []) or "—"), c.get("registration")) if x)
    status, prediction = c["status_class"], c["prediction_class"]
    return (f'<section class="widget detail{" default" if c["id"] == default else ""}" id="{anchor(c["id"])}">'
            f'<h3 class="mono">{e(c["id"])}</h3><div class="chips">'
            f'<span class="chip"><span class="sw" style="background:var({STATUS[status][1]})"></span>{STATUS[status][0]}</span>'
            f'<span class="chip">{PREDICTION[prediction][1]}</span></div><div class="k">{e(meta)}</div>'
            f'<div class="kpis">{kpis}</div>'
            f'<h4>改了什么</h4><div>{e(c.get("change") or "—")}</div><h4>假设</h4><div>{e(c.get("hypothesis") or "—")}</div>'
            + (f'<h4>预测</h4><table><tr><th>度量</th><th>方向</th><th>结果</th></tr>{predictions}</table>' if predictions else "")
            + f'<h4>回放</h4><table><tr><th>trial</th><th>用途</th><th class="num">年化</th><th class="num">回撤</th>'
            f'<th class="num">夏普</th><th>资格</th></tr>{trials}</table><h4>与对照比较</h4><div>{e(compared)}</div>'
            + (f'<h4>源码审阅</h4><table><tr><th>结论</th><th>失败项</th><th>时间</th><th>说明</th></tr>{reviews}</table>' if reviews else "")
            + f'<h4>解释与决策</h4><div>{e(c.get("interpretation") or "—")}</div></section>')


def details(widget: dict) -> str:
    """candidate-detail/1: one section per candidate; the default one shows until a node is chosen."""
    return "".join(detail(c, widget["default"]) for c in widget["items"])


def notes(widget: dict) -> str:
    """notes/1: a list of plain notes."""
    items = "".join(f"<li>{e(item)}</li>" for item in widget["items"])
    return f'<ul class="notes">{items}</ul>' if items else ""


WIDGETS = {"summary/1": summary, "lineage/1": lineage, "scatter/1": scatter, "notes/1": notes,
           "candidate-detail/1": details}
FRAMED = {"lineage/1", "scatter/1", "notes/1"}


def widget_html(widget: dict) -> str:
    """One widget; titled widgets get a frame, summary tiles and detail cards frame themselves."""
    draw = WIDGETS.get(widget["type"])
    if draw is None:
        return (f'<section class="widget" data-type="{e(widget["type"])}">'
                f'<p class="k">此渲染器不支持 widget 类型 {e(widget["type"])}</p></section>')
    body = draw(widget)
    if not body or widget["type"] not in FRAMED:
        return body
    title = f'<h2>{e(widget["title"])}</h2>' if widget.get("title") else ""
    return f'<section class="widget" id="w-{e(widget["id"])}" data-type="{e(widget["type"])}">{title}{body}</section>'


def render(view: dict, out_dir: Path) -> Path:
    """Write index.html for `view` into `out_dir` and return its path."""
    line = view["line"]
    meta = " · ".join(x for x in (
        f'{"账本" if view["source"] == "ledger" else "会话"}视图', line.get("start") and f'起点 {line["start"]}',
        line.get("window") and "开发窗口 " + " → ".join(line["window"]),
        line.get("market_commit") and f'市场提交 {line["market_commit"][:12]}') if x)
    legend = "".join(f'<span><span class="sw" style="background:var({c})"></span>{n}</span>' for n, c in STATUS.values())
    legend += "".join(f'<span><b class="pred {k}">{g}</b>{n}</span>' for k, (g, n) in PREDICTION.items() if g)
    legend += '<span>◆ 推荐判断　● 用户消息　ⓘ 提问　▲ 资格变化　■ Goal</span><span>浅黄底：推荐保持不变</span>'
    slots = {"top": "", "main": "", "side": ""}
    for widget in view["widgets"]:
        slots[widget.get("slot", "main")] += widget_html(widget)
    page = Template((HERE / "page.html").read_text()).substitute(
        style=(HERE / "style.css").read_text(), title=e(line["bundle"]), meta=e(meta), legend=legend,
        top=slots["top"], main=slots["main"], side=slots["side"])
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "index.html"
    target.write_text(page)
    return target
