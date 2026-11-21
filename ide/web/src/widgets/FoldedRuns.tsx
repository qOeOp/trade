import { plural } from "../lib/format";
import { unfold } from "./useFolded";
import { TextButton } from "../ui/TextButton";

/** A chart's legend entry for the `n` runs of versions the lineage folds: not drawn, still counted; a click shows every version. */
export function FoldedRuns({ n }: { n: number }) {
  if (!n) return null;
  return (
    <TextButton size="text" className="pointer-events-auto whitespace-nowrap" onClick={unfold}
                title="Their versions are folded in the lineage, so they are not drawn here; they still count. Click to show every version.">
      {plural(n, "run")} in folded versions
    </TextButton>
  );
}
