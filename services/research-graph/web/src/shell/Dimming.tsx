import { useHovered } from "../state/linking";

/** While versions are hovered anywhere, every other version mark on the page dims to 30%. */
export function Dimming() {
  const hovered = useHovered();
  if (!hovered?.length) return null;
  const lit = hovered.map((id) => `[data-v="${CSS.escape(id)}"]`).join(",");
  return <style>{`[data-v]{opacity:.3} ${lit}{opacity:1} .react-flow__edge{opacity:.3}`}</style>;
}
