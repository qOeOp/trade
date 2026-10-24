import { useEffect } from "react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { axisView, useFocusRequest } from "../../state/linking";
import { UNIT } from "./geometry";

/** Publishes the canvas's pan for everything on the trial axis, and carries out focus requests. */
export function AxisDriver({ positions, start }: { positions: ReadonlyMap<string, { x: number; y: number }>; start: number }) {
  const { x } = useViewport();
  const request = useFocusRequest();
  const flow = useReactFlow();
  useEffect(() => axisView.set({ x0: x, unit: UNIT }), [x]);
  useEffect(() => {
    if (!request) return;
    if (request.id === "") { void flow.setViewport({ x: -start * UNIT + 56, y: flow.getViewport().y, zoom: 1 }, { duration: 240 }); return; }
    const at = positions.get(request.id);
    if (at) void flow.setCenter(at.x + 200, at.y, { zoom: 1, duration: 240 });
  }, [request, positions, flow, start]);
  return null;
}
