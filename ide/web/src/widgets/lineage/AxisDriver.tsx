import { useEffect, useRef } from "react";
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
  const done = useRef<number | null>(null);  // each request once: a new view does not bring the canvas back to it
  useEffect(() => axisView.set({ x0: x, unit: UNIT }), [x]);
  useEffect(() => {
    if (!request || request.n === done.current) return;
    const at = positions.get(request.id);
    if (request.id && !at) return;  // a version still to come: carried out once a view has it
    done.current = request.n;
    if (request.id === "") { void flow.setViewport({ x: home(widget, inset).x, y: flow.getViewport().y, zoom: 1 }, { duration: 240 }); return; }
    const { width, height } = store.getState();
    if (at) void flow.setViewport({ ...centredOn(widget, at, width, height, inset), zoom: 1 }, { duration: 240 });
  }, [request, widget, positions, flow, store, inset]);
  return null;
}
