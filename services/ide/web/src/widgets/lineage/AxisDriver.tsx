import { useEffect } from "react";
import { useReactFlow, useStoreApi, useViewport } from "@xyflow/react";
import type { LineageWidget } from "../../model/types";
import { axisView, useFocusRequest } from "../../state/linking";
import { centredOn, home, UNIT } from "./geometry";

/** Publishes the canvas's pan for everything on the trial axis, and carries out focus requests. */
export function AxisDriver({ widget, positions, inset }: { widget: LineageWidget; positions: ReadonlyMap<string, { x: number; y: number }>; inset: number }) {
  const { x } = useViewport();
  const request = useFocusRequest();
  const flow = useReactFlow();
  const store = useStoreApi();
  useEffect(() => axisView.set({ x0: x, unit: UNIT }), [x]);
  useEffect(() => {
    if (!request) return;
    if (request.id === "") { void flow.setViewport({ x: home(widget, inset).x, y: flow.getViewport().y, zoom: 1 }, { duration: 240 }); return; }
    const at = positions.get(request.id);
    const { width, height } = store.getState();
    if (at) void flow.setViewport({ ...centredOn(widget, at, width, height, inset), zoom: 1 }, { duration: 240 });
  }, [request, widget, positions, flow, store, inset]);
  return null;
}
