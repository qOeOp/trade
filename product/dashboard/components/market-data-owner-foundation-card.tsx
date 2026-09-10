import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameHeader,
} from "./ui/panel-frame";
import { MarketHeatmapUnavailable } from "./ui/market-heatmap";
import styles from "./market-data-owner-foundation-card.module.css";

const FOUNDATION_REVISION = "d790ae8702b1d254342ad81a82d8fc90e4b78d7a";
const UNAVAILABLE = "UNAVAILABLE_NO_PRODUCT_RESOLVER";

export function MarketDataOwnerFoundationCard() {
  return (
    <PanelFrame className={styles.frame} aria-labelledby="market-overview-title">
      <PanelFrameHeader
        eyebrow="Market data"
        title={<span id="market-overview-title">Market overview</span>}
        description="Compare relative movement across the latest verified market cut."
      />
      <PanelFrameBody className={styles.body}>
        <MarketHeatmapUnavailable
          reason={UNAVAILABLE}
          technicalDetail={(
            <p>
              Durable market custody exists at {FOUNDATION_REVISION.slice(0, 12)}, but no Dashboard read
              projection is connected.
            </p>
          )}
        />
      </PanelFrameBody>
      <PanelFrameFooter className={styles.footer}>
        Verified market cuts only · sample data is never shown.
      </PanelFrameFooter>
    </PanelFrame>
  );
}
