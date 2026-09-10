import { UnavailableState } from "./ui/evidence-strip";
import { EvidenceIcons, ModuleIcons } from "./ui/iconography";
import { PanelFrame, PanelFrameBody, PanelFrameHeader, PanelFrameInfo } from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import { SummaryItem, SummaryList } from "./ui/summary-list";
import { PageStack } from "./ui/page-stack";

const CONTRACT_REVISION = "0ac5f4979bdc2169931f3b260f4459b4d258794b";
const CONTRACT_SOURCE_REVISION = "e2de832c09811f80158ffd5c70a538f5fad6055c";
const CONTRACT_LOCATOR = `https://github.com/qOeOp/trade/commit/${CONTRACT_REVISION}`;
const EMPTY_VALUE = "\u2014";

const headerSlots = [
  "Request identity / digest",
  "Projection time",
  "Valid-through time",
  "Availability",
  "Disposition",
] as const;

const requestBindingSlots = [
  "Principal identity",
  "Account identity",
  "Execution Scope identity",
  "PAPER / LIVE mode",
  "Authorization-policy cut",
  "Common-cut identity",
] as const;

const principalClaimSlots = [
  "Claim identity",
  "Issuer",
  "Principal",
  "Account",
  "Execution Scope",
  "PAPER / LIVE mode",
  "Authorization-policy cut",
  "Not-before time",
  "Valid-through time",
] as const;

const dependencyClasses = [
  "Execution: account, open orders, fills, fees, settlement",
  "Market Data: price, FX, contract, valuation, liquidity",
  "Portfolio: snapshot",
] as const;

const dependencyFields = [
  "Locator",
  "Frontier",
  "Sequence",
  "Common cut",
  "Principal",
  "Account",
  "Execution Scope",
  "PAPER / LIVE mode",
  "Authorization-policy cut",
  "Observed time",
  "Valid-through time",
] as const;

const unavailableFields = (fields: readonly string[]) => (
  fields.map((field) => `${field}: ${EMPTY_VALUE}`).join(" · ")
);

const sourceGroups = [
  { owner: "Execution", title: "Account activity", description: "Balances, orders, fills, fees and settlement", count: "5 sources" },
  { owner: "Market Data", title: "Market valuation", description: "Prices, FX, contracts, valuation and liquidity", count: "5 sources" },
  { owner: "Portfolio", title: "Portfolio snapshot", description: "Current positions and portfolio totals", count: "1 source" },
] as const;

export function PortfolioViewUnavailableCard() {
  return (
    <PanelFrame aria-labelledby="portfolio-contract-title">
      <PanelFrameHeader
        eyebrow="Portfolio"
        title={<span id="portfolio-contract-title">Portfolio overview</span>}
        description="Positions, exposure and performance in one read-only view."
        actions={(
          <>
            <StatusBadge tone="unavailable">Not connected</StatusBadge>
            <PanelFrameInfo label="View Portfolio technical details">
              <span>Schema</span>
              <code>1</code>
              <span>Contract</span>
              <a href={CONTRACT_LOCATOR} target="_blank" rel="noreferrer"><code>{CONTRACT_REVISION.slice(0, 12)}</code></a>
              <span>Source</span>
              <code>{CONTRACT_SOURCE_REVISION.slice(0, 12)}</code>
              <span>Reason</span>
              <code>UNAVAILABLE_NO_DASHBOARD_CONSUMER</code>
              <span>Response header</span>
              <p>{unavailableFields(headerSlots)}</p>
              <span>Request binding</span>
              <p>{unavailableFields(requestBindingSlots)}</p>
              <span>Principal claim · untrusted</span>
              <p>{unavailableFields(principalClaimSlots)}</p>
              <span>Required Owner sources · 11</span>
              <p>{dependencyClasses.join(" · ")}</p>
              <span>Dependency fields</span>
              <p>{unavailableFields(dependencyFields)}</p>
              <span>Applicable failure</span>
              <code title="CALLER_SUPPLIED_SOURCE_LOCATOR · SOURCE_OWNER_RESOLVE_UNAVAILABLE">
                CALLER_SUPPLIED_SOURCE_LOCATOR · SOURCE_OWNER_RESOLVE_UNAVAILABLE
              </code>
            </PanelFrameInfo>
          </>
        )}
      />
      <PanelFrameBody density="compact">
        <PageStack gap="compact">
          <UnavailableState
            density="compact"
            surface="card"
            icon={<ModuleIcons.briefcase aria-hidden="true" size={20} />}
            title="Portfolio data is not available"
            reason="UNAVAILABLE_NO_DASHBOARD_CONSUMER"
            detail="Connect all three trusted source groups before showing balances, positions or performance."
          />
          <SummaryList aria-label="Required portfolio data sources">
            {sourceGroups.map((group) => (
              <SummaryItem
                key={group.owner}
                eyebrow={group.owner}
                title={group.title}
                description={group.description}
                leading={<EvidenceIcons.pending aria-label="Pending" size={15} />}
                trailing={<StatusBadge tone="neutral">{group.count}</StatusBadge>}
              />
            ))}
          </SummaryList>
        </PageStack>
      </PanelFrameBody>
    </PanelFrame>
  );
}
