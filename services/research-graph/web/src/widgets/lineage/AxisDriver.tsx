import { useEffect } from "react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { axisView, useFocusRequest } from "../../state/linking";
import { HOME, UNIT } from "./geometry";

/** Publishes the canvas's pan for everything on the trial axis, and carries out focus requests. */
export function AxisDriver({ positions }: { positions: ReadonlyMap<string, { x: number; y: number }> }) {
  const { x } = useViewport();
  const request = useFocusRequest();
  const flow = useReactFlow();
  useEffect(() => axisView.set({ x0: x, unit: UNIT }), [x]);
  useEffect(() => {
    if (!request) return;
    if (request.id === "") { void flow.setViewport({ x: HOME.x, y: flow.getViewport().y, zoom: 1 }, { duration: 240 }); return; }
    const at = positions.get(request.id);
    if (at) void flow.setCenter(at.x + 200, at.y, { zoom: 1, duration: 240 });
  }, [request, positions, flow]);
  return null;
}
