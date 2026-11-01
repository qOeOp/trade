import { useRunDriver } from "../state/runData";

/** Works out the paper run shown (state/runData.ts) and draws nothing: it alone redraws as the run's
 *  stream grows, not the window. */
export function RunDriver() {
  useRunDriver();
  return null;
}
