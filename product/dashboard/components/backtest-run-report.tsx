import type {
  BacktestRunReport as BacktestRunReportProjection,
  BacktestRunReportFill,
  BacktestRunReportOutcome,
  BacktestRunReportPoint,
} from "../lib/backtest-run-report-contract";
import styles from "./backtest-run-report.module.css";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { FactGroup, FactGroupGrid, FactGroupSkeletonGrid, FactItem } from "./ui/fact-group";
import { EvidenceIcons } from "./ui/iconography";

// The single-run report in `docs/guide/dashboard.md`. It answers four questions about one run - what
// the strategy is, which data it ran on, what it produced, and what each fill was - and states each
// value as the projection gave it. It computes no return, drawdown or fill of its own.

const SERIES_WIDTH = 640;
const SERIES_HEIGHT = 120;

export function BacktestRunReport({ report }: { report: BacktestRunReportProjection }) {
  return (
    <section
      aria-busy={report.state === "loading" || undefined}
      aria-live="polite"
      className={styles.report}
      data-state={report.state}
      data-ui="backtest-run-report"
    >
      {report.state === "loading" ? (
        <FactGroupSkeletonGrid
          aria-label="Loading backtest report"
          titles={["Strategy", "Data window", "Result"]}
        />
      ) : report.state === "unavailable" ? (
        <UnavailableState
          density="compact"
          icon={<EvidenceIcons.warning aria-hidden="true" size={20} />}
          reason={report.reason}
          title="Backtest report unavailable"
        />
      ) : (
        <>
          <FactGroupGrid>
            <FactGroup title="Strategy">
              <FactItem label="Family">{report.strategy.family}</FactItem>
              <FactItem label="Channel" mono>{report.strategy.channel.role_semantic_id}</FactItem>
              <FactItem label="Instrument">{report.strategy.channel.instrument}</FactItem>
              <FactItem label="Field" mono>{report.strategy.channel.field_semantic_id}</FactItem>
              <FactItem label="Comparison">{report.strategy.comparison}</FactItem>
              <FactItem label="Threshold" mono>{report.strategy.threshold}</FactItem>
              <FactItem label="When true">{outcomeText(report.strategy.when_true)}</FactItem>
              <FactItem label="Otherwise">{outcomeText(report.strategy.otherwise)}</FactItem>
              <FactItem label="Falsifier">{report.strategy.falsifier}</FactItem>
            </FactGroup>
            <FactGroup title="Data window">
              <FactItem label="Instrument">{report.data_window.instrument}</FactItem>
              <FactItem label="Granularity">{report.data_window.granularity}</FactItem>
              <FactItem label="Start" mono>{report.data_window.start}</FactItem>
              <FactItem label="End" mono>{report.data_window.end}</FactItem>
              <FactItem label="Snapshots">{report.data_window.snapshot_count}</FactItem>
              <FactItem label="Cut" mono>{report.data_window.cut_identity}</FactItem>
            </FactGroup>
            <FactGroup title="Result">
              {/* Fractions, shown as stated. The projection does not yet say which of the two bases the
                  canonical result built the series on, so no label names one or implies an equity
                  return; the labels will name the basis once the Owner carries it. */}
              <FactItem label="Net return (fraction)" mono>
                {report.state === "available" ? String(report.net_return) : "No observations"}
              </FactItem>
              <FactItem label="Maximum drawdown (fraction)" mono>
                {report.state === "available" ? String(report.max_drawdown) : "No observations"}
              </FactItem>
              <FactItem label="Fills">{report.fill_count}</FactItem>
              <FactItem label="Run" mono>{report.run.result_identity}</FactItem>
              <FactItem label="Engine result" mono>{report.run.engine_result_digest}</FactItem>
            </FactGroup>
          </FactGroupGrid>
          {report.state === "available" ? (
            <SeriesLine points={report.series} />
          ) : (
            // Empty is a run that produced no points, not a read that failed: the facts above and the
            // fills below are still the run's own, so this says what is missing and nothing more.
            <EmptyState title="No observations">
              This run produced no observation points, so it states no series, net return or maximum
              drawdown.
            </EmptyState>
          )}
          <FillsTable fills={report.fills} />
        </>
      )}
    </section>
  );
}

function outcomeText(outcome: BacktestRunReportOutcome): string {
  return `${outcome.position_intent_semantic_id} · target ${outcome.target_position_units}`;
}

// Plots the stated points and nothing between them: the path joins the observations the projection
// listed, in their order, and draws no interpolated or smoothed value.
function SeriesLine({ points }: { points: readonly BacktestRunReportPoint[] }) {
  const times = points.map((point) => Date.parse(point.at));
  const values = points.map((point) => point.value);
  const firstTime = times[0];
  const lastTime = times[times.length - 1];
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const x = (time: number) => (lastTime === firstTime
    ? SERIES_WIDTH / 2
    : ((time - firstTime) / (lastTime - firstTime)) * SERIES_WIDTH);
  const y = (value: number) => (highest === lowest
    ? SERIES_HEIGHT / 2
    : SERIES_HEIGHT - ((value - lowest) / (highest - lowest)) * SERIES_HEIGHT);
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <figure className={styles.series}>
      <svg
        aria-label={`Return series, ${points.length} observations`}
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${SERIES_WIDTH} ${SERIES_HEIGHT}`}
      >
        {points.length === 1 ? (
          <circle cx={x(times[0])} cy={y(values[0])} r={3} />
        ) : (
          <polyline points={points.map((_, index) => `${x(times[index])},${y(values[index])}`).join(" ")} />
        )}
      </svg>
      <figcaption>
        <span>{points.length} observations</span>
        <span className={styles.timestamp}>{first.at}</span>
        <span className={styles.timestamp}>{last.at}</span>
      </figcaption>
    </figure>
  );
}

// No column is sortable: rows keep the order the projection listed them in, which is the run's own.
const FILL_COLUMNS: DataWorkspaceColumn<BacktestRunReportFill>[] = [
  { id: "at", name: "Time (UTC)", cell: (fill) => <span className={styles.timestamp}>{fill.at}</span> },
  { id: "side", name: "Side", cell: (fill) => fill.side },
  {
    id: "price",
    name: <span className={styles.numeric}>Price</span>,
    cell: (fill) => <span className={styles.numeric}>{fill.price}</span>,
  },
  {
    id: "quantity",
    name: <span className={styles.numeric}>Quantity</span>,
    cell: (fill) => <span className={styles.numeric}>{fill.quantity}</span>,
  },
];

function FillsTable({ fills }: { fills: readonly BacktestRunReportFill[] }) {
  return (
    <DataWorkspaceTable<BacktestRunReportFill>
      ariaLabel="Fills"
      columns={FILL_COLUMNS}
      data={fills}
      dense
      noDataComponent={<EmptyState title="No fills">This run lists no fills.</EmptyState>}
    />
  );
}
