import { useState } from "react";
import { PhoneRow } from "../../components/PhoneBar";
import { Sheet } from "../../components/Sheet";
import { TextButton } from "../../components/TextButton";
import { Icon } from "../../icons/Icon";
import type { SourcesWidget } from "../../model/types";
import { useWidget } from "../../model/view";
import { opened, SourceBody } from "../../widgets/source/SourceView";

/** A version's source as the Sources window lists it, a row on its page; the code rises in a sheet, with the
 *  comparison with its parent where both sources are in the graph. */
export function VersionSource({ id }: { id: string }) {
  const widget = useWidget<SourcesWidget>("sources@1"), [open, setOpen] = useState(false), [diff, setDiff] = useState(false);
  if (!widget) return null;
  const { item, parent } = opened(widget, id, diff);
  return (
    <>
      <PhoneRow onClick={() => setOpen(true)}>
        <span className="flex min-w-0 items-center gap-1.5 text-dense">
          <span className="shrink-0 text-icon"><Icon name="file.python" /></span><span className="truncate font-mono">{id}.py</span>
        </span>
      </PhoneRow>
      <Sheet open={open} onClose={() => setOpen(false)} title={`${id}.py`}>
        {item?.source != null && parent?.source != null && (
          <div className="flex justify-end px-3 pb-1"><TextButton active={diff} onClick={() => setDiff(!diff)} className="text-dense"><Icon name="diff" />Compare with parent</TextButton></div>
        )}
        <div className="overflow-x-auto"><SourceBody id={id} diff={diff} widget={widget} /></div>
      </Sheet>
    </>
  );
}
