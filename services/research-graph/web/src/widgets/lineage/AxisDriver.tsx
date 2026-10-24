import { useEffect } from "react";
import { useReactFlow, useStoreApi, useViewport } from "@xyflow/react";
import type { LineageWidget } from "../../model/types";
import { axisView, useFocusRequest, usePanRequest } from "../../state/linking";
import { bounds, centredOn, HOME, UNIT } from "./geometry";

/** Publishes the canvas's pan for everything on the trial axis, and carries out focus and pan requests. */
export function AxisDriver({ widget, positions }: { widget: LineageWidget; positions: ReadonlyMap<string, { x: number; y: number }> }) {
  const { x } = useViewport();
  const request = useFocusRequest();
  const pan = usePanRequest();
  const flow = useReactFlow();
  const store = useStoreApi();
  useEffect(() => axisView.set({ x0: x, unit: UNIT }), [x]);
  useEffect(() => {
    if (!request) return;
    if (request.id === "") { void flow.setViewport({ x: HOME.x, y: flow.getViewport().y, zoom: 1 }, { duration: 240 }); return; }
    const at = positions.get(request.id);
    const { width, height } = store.getState();
    if (at) void flow.setViewport({ ...centredOn(widget, at, width, height), zoom: 1 }, { duration: 240 });
  }, [request, widget, positions, flow, store]);
  // A pan follows a drag, so it is immediate; it stops where the content ends, as panning by hand does.
  useEffect(() => {
    if (!pan) return;
    const { left, right } = bounds(widget), { width } = store.getState();
    void flow.setViewport({ x: Math.min(-left, Math.max(Math.min(-left, width - right), pan.x0)), y: flow.getViewport().y, zoom: 1 });
  }, [pan, widget, flow, store]);
  return null;
}
