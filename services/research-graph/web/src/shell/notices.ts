import { useEffect } from "react";
import type { LineageWidget, NotesWidget } from "../model/types";
import { useView } from "../model/view";
import { notify } from "../lib/notify";
import { showToolWindow } from "../state/shell";

/** What the page says once on opening: an address naming a version this line does not have, and how
 *  many gaps the graph has (with a way to read them). */
export function useLoadNotices(): void {
  const view = useView();
  useEffect(() => {
    const lineage = view.widgets.find((w) => w.type === "lineage/2") as LineageWidget | undefined;
    const notes = view.widgets.find((w) => w.type === "notes/1") as NotesWidget | undefined;
    const linked = decodeURIComponent(window.location.hash.slice(1));
    const timer = window.setTimeout(() => {
      if (linked && lineage && !lineage.nodes.some((n) => n.id === linked)) {
        notify({ kind: "warning", title: "地址里的版本不在这条研究线上", detail: linked });
      }
      if (notes?.items.length) {
        notify({ title: `这份图有 ${notes.items.length} 条数据缺口`, detail: "图里没有的信息，读图时要留意。",
                 action: { label: "查看", run: () => showToolWindow("gaps", "bottom") } });
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [view]);
}
