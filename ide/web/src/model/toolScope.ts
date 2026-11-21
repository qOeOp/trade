// Bottom tools follow the editor page; the Agent and Details remain available across pages.
export type ToolPage = "research" | "runs" | "market" | "history";
export const toolPage = (left: string): ToolPage => left === "market" || left === "runs" || left === "history" ? left : "research";
export const DEFAULT_BOTTOM: Record<ToolPage, string | null> = { research: "progress", runs: "trades", market: "coins", history: null };

export function bottomToolOnPage(id: string, page: ToolPage): boolean {
  if (id === "coins" || id === "news") return page === "market";
  // The History page picks a replay (state/stage.ts openTrial), whose trades Trades lists.
  if (id === "trades") return page === "runs" || page === "history";
  return page === "research";
}
