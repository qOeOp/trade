import type { ReactNode } from "react";
import { useAtom } from "../state/atom";
import { activeIsland } from "../state/shell";

/** One region of the window: a rounded island on the frame, with an optional header (a PanelHeader).
 *  The island the user last worked in is active, which colours its selection (base.css). */
export function Island({ id, header, children }: { id: string; header?: ReactNode; children: ReactNode }) {
  const active = useAtom(activeIsland) === id;
  return (
    // Half the gap on every side, so neighbouring islands sit one gap apart whatever divides them.
    <div className="h-full p-(--half-gap)">
      <section data-island={id} data-island-active={active ? "" : undefined} onPointerDownCapture={() => activeIsland.set(id)}
               className="flex h-full min-h-0 flex-col overflow-hidden rounded-island bg-island">
        {header}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </section>
    </div>
  );
}
