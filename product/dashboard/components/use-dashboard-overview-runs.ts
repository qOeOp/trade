import { DASHBOARD_OVERVIEW_RUN_FILTER_V1 } from "../lib/dashboard-overview";
import { useRunListView } from "./use-run-list-view";

export function useDashboardOverviewRuns(enabled: boolean) {
  return useRunListView(enabled, DASHBOARD_OVERVIEW_RUN_FILTER_V1);
}
