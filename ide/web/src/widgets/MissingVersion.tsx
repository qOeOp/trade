import { useView } from "../model/view";
import { useAtom } from "../state/atom";
import { missing, useSelection } from "../state/selection";
import { Notice } from "../ui/Notice";

/** The address names a version the drawn line does not hold: which one, and what the page shows instead, until it is
 *  closed or a version is selected. */
export function MissingVersion() {
  const { line } = useView(), id = useAtom(missing), shown = useSelection();
  return id && line.name && (
    <Notice tone="misses" title={`${id} is not on ${line.name}`} onClose={() => missing.set(null)}>
      {shown && <p className="text-fg-muted">Showing {shown} instead.</p>}
    </Notice>
  );
}
