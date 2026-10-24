import { useHovered } from "../state/linking";

/** While versions are hovered anywhere, every other version mark on the page dims to 22%. */
export function Dimming() {
  const hovered = useHovered();
  if (!hovered?.length) return null;
  const lit = hovered.map((id) => `[data-v="${CSS.escape(id)}"]`).join(",");
  return <style>{`[data-v]{opacity:.22} ${lit}{opacity:1} .react-flow__edge{opacity:.25}`}</style>;
}
