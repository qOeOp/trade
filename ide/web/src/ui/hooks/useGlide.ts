import { useRef } from "react";

const MS = 400;  // a little past --t-glide

/** The class that eases a chart's marks to their new places (base.css), for a moment after `data` changes
 *  and not otherwise, so they still follow a pan, a zoom or a resize at once. */
export function useGlide(data: unknown): string {
  const seen = useRef(data), until = useRef(0);
  if (seen.current !== data) { seen.current = data; until.current = performance.now() + MS; }
  return performance.now() < until.current ? "glide" : "";
}
