import assert from "node:assert/strict";
import test from "node:test";
import { bounds, centredOn, home, positions, UNIT } from "../src/widgets/lineage/geometry.ts";

const line = (start = 216) => ({
  axis: { min: start - 1, max: start + 8 },
  rows: [{ id: "root@1", row: 0 }, { id: "child@1", row: 1 }],
  nodes: [{ id: "root@1", x: start, row: 0 }, { id: "child@1", x: start + 7, row: 1 }],
  trials: [{ trial_id: start, candidate: "root@1" }, { trial_id: start + 7, candidate: "child@1" }],
});

test("a later line opens at its own content, retaining real trial coordinates", () => {
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
  widget.trials.push({ trial_id: 210, candidate: "root@1" }, { trial_id: 260, candidate: "child@1" });
  const edge = bounds(widget);
  assert.equal(edge.left + home(widget).x, 0);
  assert.equal(edge.left, (216 - 0.5) * UNIT);
  assert.ok(edge.right > (260 + 0.5) * UNIT);
  assert.equal(widget.trials[2].trial_id, 210, "the old precheck stays in the view");
});

test("the EMA budget line starts at its first drawn version, not its old precheck 212", () => {
  const widget = line(239);
  widget.axis.min = 236.5;
  widget.trials.unshift({ trial_id: 212, candidate: "root@1", purpose: "precheck" },
    { trial_id: 236, candidate: "root@1", purpose: "precheck" });
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
  widget.trials = [{ trial_id: 212, candidate: "root@1", purpose: "precheck" }];
  assert.equal(bounds(widget).left, 211.5 * UNIT);
  assert.equal(212 * UNIT + home(widget).x, 16);
});

test("empty and unplaced graphs have finite bounds and home coordinates", () => {
  for (const nodes of [[], [{ id: "unrun@1", x: null, row: 0 }]]) {
    const widget = { axis: { min: 211, max: 212 }, trials: [{ trial_id: 212 }], nodes, rows: [] };
    assert.ok(Object.values(bounds(widget)).every(Number.isFinite));
    assert.deepEqual(home(widget), { x: 16, y: 15 });
    assert.equal(positions(widget).size, 0);
  }
});
