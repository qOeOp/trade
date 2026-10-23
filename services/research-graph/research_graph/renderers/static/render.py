"""Static renderer: a view model to one self-contained HTML page with inline SVG and no script.

Selecting a node opens its detail through a #fragment and CSS :target, so the page works in
previews that block scripts. Labels and colours belong here; the view model carries only meaning.
"""
from __future__ import annotations

import html
import re
from pathlib import Path
from string import Template

HERE = Path(__file__).resolve().parent
STATUS = {"recommended": ("推荐", "--rec"), "meets_targets": ("达标且有资格", "--ok"),
          "below_targets": ("有资格未达标", "--miss"), "masked": ("失去资格", "--mask"),
          "precheck_failed": ("预检/审阅失败", "--fail"), "unrun": ("未回放", "--unrun")}
PREDICTION = {"held": ("预测全部成立", "--ok"), "failed": ("预测全部失败", "--fail"), "mixed": ("预测部分成立", "--rec"),
              "none": ("预测未判定", None)}
LANES = {"recommendation": ("◆", "推荐", "--rec"), "user_message": ("●", "用户", "--fg"),
         "agent_question": ("?", "提问", "--fg"), "eligibility_change": ("⚠", "资格", "--fail"), "goal": ("▲", "Goal", "--fg")}
ROW, TOP, LEFT, RIGHT, UNIT = 20, 30, 240, 40, 9


def e(value) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def pct(value) -> str:
    return "—" if value is None else f"{value * 100:.2f}%"


def ratio(value) -> str:
    return "—" if value is None else f"{value:.2f}"


def anchor(cid: str) -> str:
    return "c-" + re.sub(r"[^A-Za-z0-9_-]", "_", cid)


def lineage(view: dict) -> str:
    """lineage/1: versions by trial number in lineage rows, recommendation bands and event lanes."""
    axis = view["axis"]
    span = (axis["max"] - axis["min"]) or 1
    width = max(1200, int(span * UNIT) + LEFT + RIGHT)
    lane_top = TOP + len(view["rows"]) * ROW + 20
    height = lane_top + len(view["lanes"]) * 20 + 30

    def px(x):
        return LEFT + (width - LEFT - RIGHT) * ((x - axis["min"]) / span)

    def py(row):
        return TOP + row * ROW

    at = {n["id"]: n for n in view["nodes"]}
    out = []
    if axis.get("scope_start") is not None:
        x = px(axis["scope_start"])
        out.append(f'<rect x="{LEFT}" y="{TOP - 12}" width="{max(0.0, x - LEFT):.1f}" height="{height - TOP - 8}" fill="var(--shade)"/>'
                   f'<text class="tick" x="{LEFT + 4}" y="{height - 12}">范围之前</text>'
                   f'<text class="tick" x="{x + 4:.1f}" y="{height - 12}">本次范围 →</text>')
    for tick in axis["ticks"]:
        x = px(tick)
        out.append(f'<line class="axis" x1="{x:.1f}" x2="{x:.1f}" y1="{TOP - 12}" y2="{height - 20}"/>'
                   f'<text class="tick" x="{x + 2:.1f}" y="{TOP - 16}">trial {tick}</text>')
    for band in view["bands"]:
        if band["x0"] is None:
            continue
        x0, x1 = px(band["x0"]), px(band["x1"] if band["x1"] is not None else axis["max"])
        out.append(f'<rect x="{x0:.1f}" y="{py(band["row"]) - ROW / 2 + 1}" width="{max(2.0, x1 - x0):.1f}" height="{ROW - 2}" '
                   f'fill="var(--band)"><title>推荐 {e(band["candidate"])}（{e(band["ref"])}）</title></rect>')
    for edge in view["edges"]:
        a, b = at[edge["from"]], at[edge["to"]]
        if a["x"] is None or b["x"] is None:
            continue
        x1, y1, x2, y2 = px(a["x"]), py(a["row"]), px(b["x"]), py(b["row"])
        out.append(f'<path class="edge" d="M{x1:.1f},{y1} C{x1 + 12:.1f},{y1} {x1 + 12:.1f},{y2} {x2:.1f},{y2}"/>')
    for node in view["nodes"]:
        y = py(node["row"])
        out.append(f'<text class="lbl" x="4" y="{y + 4}">{e(node["id"])}</text>')
        if node["x"] is None:
            continue
        x = px(node["x"])
        label, colour = PREDICTION[node["prediction"]]
        dot = f'<circle cx="{x - 11:.1f}" cy="{y}" r="3.5" fill="var({colour})"/>' if colour else ""
        change = (node.get("change") or "")[:160]
        out.append(f'<a href="#{anchor(node["id"])}">{dot}<rect x="{x - 6:.1f}" y="{y - 7}" width="12" height="14" rx="3" '
                   f'fill="var({STATUS[node["status"]][1]})" stroke="var(--fg)" stroke-width="1.2"/>'
                   f'<title>{e(node["id"])}：{e(change)}（{STATUS[node["status"]][0]}，{label}）</title></a>')
        reading = node["reading"]
        if reading["annual_return"] is not None:
            out.append(f'<text class="tick" x="{x + 9:.1f}" y="{y + 4}">{pct(reading["annual_return"])} / '
                       f'{pct(reading["max_drawdown"])}</text>')
    for n, lane in enumerate(view["lanes"]):
        symbol, name, colour = LANES[lane["kind"]]
        y = lane_top + n * 20
        out.append(f'<text class="tick" x="4" y="{y + 4}">{name}</text>'
                   f'<line class="axis" x1="{LEFT}" x2="{width - RIGHT}" y1="{y}" y2="{y}"/>')
        for ev in lane["events"]:
            if ev["x"] is None:
                continue
            tip = " ".join(str(v) for v in (ev["at"][5:16], ev.get("ref"), ev.get("text"),
                                            ev.get("recommends") and "→ " + ev["recommends"]) if v)
            out.append(f'<text x="{px(ev["x"]) - 4:.1f}" y="{y + 4}" style="fill:var({colour})">{symbol}<title>{e(tip)}</title></text>')
    return f'<svg width="{width}" height="{height}">{"".join(out)}</svg>'


def scatter(view: dict) -> str:
    """scatter/1: research runs by max drawdown and annual return, with the target box."""
    points, targets = view["points"], view["targets"] or {}
    w, h, pad = 640, 380, 50
    xmax = (max([p["max_drawdown"] for p in points] + [targets.get("max_drawdown") or 0.0]) * 1.15) or 0.3
    ys = [p["annual_return"] for p in points] + [targets.get("annual_return") or 0.0]
    ymin, ymax = min(0.0, *ys) * 1.1, (max(ys) * 1.15) or 0.3

    def sx(v):
        return pad + (w - pad - 12) * (v / xmax)

    def sy(v):
        return h - pad - (h - pad - 12) * ((v - ymin) / ((ymax - ymin) or 1))

    out = []
    if targets.get("max_drawdown") is not None and targets.get("annual_return") is not None:
        out.append(f'<rect x="{sx(0):.1f}" y="{sy(ymax):.1f}" width="{sx(targets["max_drawdown"]) - sx(0):.1f}" '
                   f'height="{sy(targets["annual_return"]) - sy(ymax):.1f}" fill="var(--ok)" opacity=".12"/>')
    out.append(f'<line class="axis" x1="{pad}" x2="{w - 12}" y1="{sy(0):.1f}" y2="{sy(0):.1f}"/>'
               f'<line class="axis" x1="{pad}" x2="{pad}" y1="12" y2="{h - pad}"/>'
               f'<text class="tick" x="{w / 2}" y="{h - 12}">最大回撤</text><text class="tick" x="{pad + 4}" y="22">年化</text>')
    for i in range(5):
        out.append(f'<text class="tick" x="{sx(xmax * i / 4) - 10:.1f}" y="{h - pad + 14}">{pct(xmax * i / 4)}</text>'
                   f'<text class="tick" x="2" y="{sy(ymin + (ymax - ymin) * i / 4) + 3:.1f}">{pct(ymin + (ymax - ymin) * i / 4)}</text>')
    for p in points:
        colour = "--mask" if p["eligible"] is False else STATUS[p["status"]][1]
        out.append(f'<a href="#{anchor(p["id"])}"><circle cx="{sx(p["max_drawdown"]):.1f}" cy="{sy(p["annual_return"]):.1f}" r="5" '
                   f'fill="var({colour})" stroke="var(--fg)" stroke-width="1"/><title>{e(p["id"])} trial {p["trial_id"]}：'
                   f'{pct(p["annual_return"])} / {pct(p["max_drawdown"])}{"（无资格）" if p["eligible"] is False else ""}</title></a>')
    return f'<svg width="{w}" height="{h}">{"".join(out)}</svg>'


def detail(c: dict, default: str | None) -> str:
    trials = "".join(
        f'<tr><td>{e(t["trial_id"])}</td><td>{e(t["purpose"])}</td><td>{e(t.get("status"))}</td><td>{pct(t.get("annual_return"))}</td>'
        f'<td>{pct(t.get("max_drawdown"))}</td><td>{ratio(t.get("sharpe"))}</td>'
        f'<td>{"✗ " + e(t.get("ineligible_reason")) if t.get("eligible") is False else "✓" if t.get("eligible") else "—"}</td></tr>'
        for t in c.get("trials") or []) or '<tr><td colspan="7">—</td></tr>'
    predictions = "".join(f'<tr><td>{e(p.get("measure"))}</td><td>{e(p.get("direction"))}</td><td>{e(p.get("outcome") or "—")}</td></tr>'
                          for p in c.get("predictions") or [])
    reviews = "".join(f'<tr><td>{e(r.get("verdict"))}</td><td>{e(",".join(r.get("failed_items") or []))}</td>'
                      f'<td>{e((r.get("at") or "")[5:16])}</td><td>{e(r.get("note"))}</td></tr>' for r in c.get("reviews") or [])
    cmp = c.get("comparison") or {}
    compared = " · ".join(x for x in (
        cmp.get("vs_trial") is not None and f'对照 trial {cmp["vs_trial"]}',
        {True: "区间跨零", False: "区间不跨零", None: None}[cmp.get("interval_crosses_zero")],
        cmp.get("mean_daily_log_difference") is not None and f'差 {cmp["mean_daily_log_difference"]:.6g} / 可检出 {cmp.get("detectable")}',
        cmp.get("summary")) if x) or "—"
    meta = " · ".join(x for x in (f'父版本 {c.get("parent") or "无（根）"}', (c.get("created_at") or "")[:16],
                                  "职责 " + (" ".join(c.get("duties") or []) or "—"), c.get("registration")) if x)
    return (f'<section class="detail{" default" if c["id"] == default else ""}" id="{anchor(c["id"])}">'
            f'<h3 style="margin-top:0">{e(c["id"])} <span class="pill">{STATUS[c["status_class"]][0]}</span> '
            f'<span class="pill">{PREDICTION[c["prediction_class"]][0]}</span></h3><div class="k">{e(meta)}</div>'
            f'<h3>改了什么</h3><div>{e(c.get("change") or "—")}</div><h3>假设</h3><div>{e(c.get("hypothesis") or "—")}</div>'
            + (f'<h3>预测</h3><table><tr><th>度量</th><th>方向</th><th>结果</th></tr>{predictions}</table>' if predictions else "")
            + f'<h3>回放</h3><table><tr><th>trial</th><th>用途</th><th>状态</th><th>年化</th><th>回撤</th><th>夏普</th><th>资格</th></tr>{trials}</table>'
            f'<h3>比较</h3><div>{e(compared)}</div>'
            + (f'<h3>源码审阅</h3><table><tr><th>结论</th><th>失败项</th><th>时间</th><th>说明</th></tr>{reviews}</table>' if reviews else "")
            + f'<h3>解释与决策</h3><div>{e(c.get("interpretation") or "—")}</div></section>')


def details(widget: dict) -> str:
    """candidate-detail/1: one section per candidate; the default one shows until a node is chosen."""
    return "".join(detail(c, widget["default"]) for c in widget["items"])


def notes(widget: dict) -> str:
    """notes/1: a titled list of plain notes."""
    items = "".join(f"<li>{e(item)}</li>" for item in widget["items"])
    return f'<ul class="gaps">{items}</ul>' if items else ""


WIDGETS = {"lineage/1": lineage, "scatter/1": scatter, "notes/1": notes, "candidate-detail/1": details}


def widget_html(widget: dict) -> str:
    draw = WIDGETS.get(widget["type"])
    body = draw(widget) if draw else f'<p class="k">此渲染器不支持 widget 类型 {e(widget["type"])}</p>'
    if not body:
        return ""
    title = f'<h2>{e(widget["title"])}</h2>' if widget.get("title") else ""
    return f'<section class="widget" id="w-{e(widget["id"])}" data-type="{e(widget["type"])}">{title}{body}</section>'


def render(view: dict, out_dir: Path) -> Path:
    """Write index.html for `view` into `out_dir` and return its path."""
    line, targets, counts = view["line"], view["targets"] or {}, view["counts"]
    meta = " · ".join(x for x in (
        line.get("start") and f'起点 {line["start"]}', line.get("window") and "窗口 " + " → ".join(line["window"]),
        targets.get("max_drawdown") is not None and f'目标 回撤≤{pct(targets["max_drawdown"])} 年化≥{pct(targets.get("annual_return"))}',
        f'{counts["candidates"]} 个候选', f'{counts["research_runs"]} 次研究回放') if x)
    legend = "".join(f'<span><i style="background:var({c})"></i>{n}</span>' for n, c in STATUS.values())
    legend += "".join(f'<span><b style="background:var({c})"></b>{n}</span>' for n, c in PREDICTION.values() if c)
    legend += "<span>" + "　".join(f"{s} {n}" for s, n, _ in LANES.values()) + "　金色横带＝推荐保持不变</span>"
    slots = {"main": "", "side": ""}
    for widget in view["widgets"]:
        slots[widget.get("slot", "main")] += widget_html(widget)
    page = Template((HERE / "page.html").read_text()).substitute(
        style=(HERE / "style.css").read_text(),
        title=e(f'{line["bundle"]} · {"账本" if view["source"] == "ledger" else "会话"}视图'), meta=e(meta), legend=legend,
        main=slots["main"], side=slots["side"])
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "index.html"
    target.write_text(page)
    return target
