import type { ReactNode } from "react";
import { useSize } from "./hooks/useSize";

/** Its children in a box that eases to their new height instead of jumping, so what stands below slides. */
export function Eased({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [ref, { width, height }] = useSize();
  return <div className="glide overflow-hidden" style={{ height: width ? height : undefined }}><div ref={ref} className={className}>{children}</div></div>;
}
