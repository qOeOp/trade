export type MarketHeatmapAvailability = "loading" | "available" | "unavailable";

export type MarketHeatmapItem = Readonly<{
  id: string;
  label: string;
  weight: number;
  changePercent: number;
}>;

export type MarketHeatmapProjection = Readonly<{
  availability: MarketHeatmapAvailability;
  items: readonly MarketHeatmapItem[];
  reason?: string;
}>;

const ITEM_KEYS = ["changePercent", "id", "label", "weight"];
const PROJECTION_KEYS = ["availability", "items"];
const PROJECTION_KEYS_WITH_REASON = ["availability", "items", "reason"];

function unavailableProjection(): MarketHeatmapProjection {
  return { availability: "unavailable", items: [], reason: "INVALID_MARKET_HEATMAP_PROJECTION" };
}

function isExactItem(value: unknown): value is MarketHeatmapItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).sort().join("|") !== ITEM_KEYS.join("|")) return false;
  return typeof item.id === "string"
    && item.id.length > 0
    && typeof item.label === "string"
    && item.label.trim().length > 0
    && typeof item.weight === "number"
    && Number.isFinite(item.weight)
    && item.weight > 0
    && typeof item.changePercent === "number"
    && Number.isFinite(item.changePercent);
}

export function normalizeMarketHeatmapProjection(
  value: unknown,
): MarketHeatmapProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailableProjection();
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const hasExactKeys = keys.join("|") === PROJECTION_KEYS.join("|")
    || keys.join("|") === PROJECTION_KEYS_WITH_REASON.join("|");
  const availability = candidate.availability;
  if (!hasExactKeys
    || (availability !== "loading" && availability !== "available" && availability !== "unavailable")
    || !Array.isArray(candidate.items)
    || ("reason" in candidate
      && (typeof candidate.reason !== "string" || candidate.reason.trim().length === 0))) {
    return unavailableProjection();
  }
  const projection = candidate as unknown as MarketHeatmapProjection;
  if (projection.availability !== "available") {
    if (projection.items.length === 0) return projection;
    return unavailableProjection();
  }
  const identities = new Set<string>();
  for (const item of projection.items) {
    if (!isExactItem(item) || identities.has(item.id)) {
      return unavailableProjection();
    }
    identities.add(item.id);
  }
  return projection;
}

export function filterMarketHeatmapItems(
  items: readonly MarketHeatmapItem[],
  query: string,
): MarketHeatmapItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...items];
  return items.filter((item) => item.label.toLocaleLowerCase().includes(normalized));
}

export function marketHeatmapTone(changePercent: number): string {
  if (changePercent <= -5) return "loss-strong";
  if (changePercent <= -2) return "loss-medium";
  if (changePercent <= -0.5) return "loss-soft";
  if (changePercent < 0.5) return "neutral";
  if (changePercent < 2) return "gain-soft";
  if (changePercent < 5) return "gain-medium";
  return "gain-strong";
}

export function formatMarketHeatmapChange(changePercent: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    signDisplay: "exceptZero",
  }).format(changePercent).concat("%");
}
