import { useHovered } from "../state/linking";

/** While versions are hovered anywhere, every other version mark on the page dims to 30%; marks already
 *  light (`data-light`, the grey bars) to 55%, which keeps them in sight; reference marks (`data-keep`,
 *  the scatter's frontier, which a hovered run is compared against) stay. */
export function Dimming() {
  const hovered = useHovered();
  if (!hovered?.length) return null;
  // Doubled attribute selectors, so the lit marks outrank [data-v][data-light] by order.
  const lit = hovered.map((id) => `[data-v="${CSS.escape(id)}"][data-v]`).join(",");
  return <style>{`[data-v]{opacity:.3} [data-v][data-light]{opacity:.55} [data-v][data-keep]{opacity:1} ${lit}{opacity:1} .react-flow__edge{opacity:.3}`}</style>;
}
