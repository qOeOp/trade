import assert from "node:assert/strict";
import test from "node:test";
import { bounds, centredOn, elbowPath, home, MARK_CENTRE, NODE_HALF, positions, ROW, UNIT } from "../src/widgets/lineage/geometry.ts";

const line = (start = 216) => ({
  axis: { min: start - 1, max: start + 8 },
  rows: [{ id: "root@1", row: 0 }, { id: "child@1", row: 1 }],
  nodes: [{ id: "root@1", x: start, row: 0 }, { id: "child@1", x: start + 7, row: 1 }],
  trials: [{ x: start, candidate: "root@1" }, { x: start + 7, candidate: "child@1" }],
});

test("a line opens at its own content, however far along the axis it starts", () => {
  const widget = line(), mark = positions(widget).get("root@1");
  const viewport = centredOn(widget, mark, 1600, 800);
  assert.equal(mark.x, 216 * UNIT);
  assert.equal(viewport.x, home(widget).x);
  assert.ok(mark.x + viewport.x >= 16 && mark.x + viewport.x <= 64,
    "the first mark sits near the left edge even in a wide canvas");
  assert.equal(viewport.y, 15);
});

test("panning and return-to-start use the same content boundary", () => {
  for (const widget of [line(1), line(216)]) {
    const edge = bounds(widget), start = home(widget);
    assert.equal(edge.left + start.x, 0);
    for (const width of [360, 1000, 2400]) {
      for (const mark of positions(widget).values()) {
        const viewport = centredOn(widget, mark, width, 600);
        assert.ok(viewport.x + edge.left <= 0, "focus never exposes space before the line");
        assert.ok(viewport.x + Math.max(edge.right, edge.left + width) >= width,
          "focus never pans beyond the right content edge");
      }
    }
  }
});

test("old prechecks do not open empty canvas space; later reruns remain reachable", () => {
  const widget = line();
  widget.trials.push({ x: 210, candidate: "root@1" }, { x: 260, candidate: "child@1" });
  const edge = bounds(widget);
  assert.equal(edge.left + home(widget).x, 0);
  assert.equal(edge.left, (216 - 0.5) * UNIT);
  assert.ok(edge.right > (260 + 0.5) * UNIT);
  assert.equal(widget.trials[2].x, 210, "the old precheck stays in the view");
});

test("the EMA budget line starts at its first drawn version, not its old precheck 212", () => {
  const widget = line(239);
  widget.axis.min = 236.5;
  widget.trials.unshift({ x: 212, candidate: "root@1", purpose: "precheck" },
    { x: 236, candidate: "root@1", purpose: "precheck" });
  for (const width of [696, 1516, 2200]) {
    const at = centredOn(widget, positions(widget).get("root@1"), width, 800);
    assert.equal(at.x, home(widget).x);
    assert.equal(239 * UNIT + at.x, 16);
    assert.equal(bounds(widget).left, 238.5 * UNIT);
  }
});

test("an unrun version drawn at its precheck still defines the visible left edge", () => {
  const widget = line(212);
  widget.nodes = [{ id: "root@1", x: 212, row: 0 }];
  widget.trials = [{ x: 212, candidate: "root@1", purpose: "precheck" }];
  assert.equal(bounds(widget).left, 211.5 * UNIT);
  assert.equal(212 * UNIT + home(widget).x, 16);
});

test("the line starts at the canvas's top-left; its right end pans clear of the return labels' column", () => {
  const widget = line(239), gutter = 96;
  for (const width of [160, 410, 696, 2200]) {
    const at = centredOn(widget, positions(widget).get("root@1"), width, 800, gutter);
    assert.equal(at.x, home(widget).x);
    assert.equal(239 * UNIT + at.x, UNIT / 2, "the first mark half a trial from the left edge");
    assert.equal(at.y, 15, "the first row at the top");
  }
  const last = positions(widget).get("child@1"), edge = bounds(widget, gutter);
  const far = centredOn(widget, { x: edge.right, y: last.y }, 400, 800, gutter);
  assert.ok(400 - (last.x + far.x) >= gutter, "panned to its end, the last trial sits left of the labels");
});

test("empty and unplaced graphs have finite bounds and home coordinates", () => {
  for (const nodes of [[], [{ id: "unrun@1", x: null, row: 0 }]]) {
    const widget = { axis: { min: 211, max: 212 }, trials: [{ x: 212 }], nodes, rows: [] };
    assert.ok(Object.values(bounds(widget)).every(Number.isFinite));
    assert.deepEqual(home(widget), { x: 16, y: 15 });
    assert.equal(positions(widget).size, 0);
  }
});

test("an edge to a child left of its parent goes round its node and enters its left edge like every edge", () => {
  // channel-breakout-15m-wait@3 is prechecked at trial 263, before its parent h20@3's run at 276.
  const parent = { x: 276 * UNIT, y: 10 * ROW }, child = { x: 263 * UNIT, y: 11 * ROW };
  const left = child.x - MARK_CENTRE, path = elbowPath(parent.x, parent.y + NODE_HALF, left, child.y);
  const runs = [...path.matchAll(/ (-?[\d.]+) H(-?[\d.]+)/g)].map((m) => ({ y: Number(m[1]), to: Number(m[2]) }));
  assert.equal(runs.length, 2, "one run along the gap, one into the child");
  assert.ok(runs[0].y < child.y - NODE_HALF && runs[0].to < left, "the first stays above the node and passes its left edge");
  assert.ok(path.endsWith(`${child.y} H${left}`), "the last ends at the child's left edge on its row, as every edge does");
  for (const r of [...path.matchAll(/Q(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/g)].map((m) => Math.max(Math.abs(m[1] - m[3]), Math.abs(m[2] - m[4])))) {
    assert.ok(r >= 5, "every corner is rounded");
  }
  const right = elbowPath(parent.x, parent.y + NODE_HALF, 290 * UNIT - MARK_CENTRE, child.y);
  assert.ok(right.endsWith(`H${290 * UNIT - MARK_CENTRE}`), "a child to the right is still reached along its row");
});
