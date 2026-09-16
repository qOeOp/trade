import type { ServiceLogEntryV1, ServiceLogInstanceV1 } from "../lib/service-log-contract";
import {
  serviceLogEventLabel,
  serviceLogInstanceKindLabel,
  serviceLogInstanceLabel,
  serviceLogReadinessLabel,
  serviceLogSourceLabel,
} from "../lib/service-log-presentation";
import {
  DetailCluster,
  DetailClusterFact,
  DetailClusterGrid,
  DetailFact,
  DetailFactGrid,
  DetailNotice,
} from "./ui/detail-inspector";
import { EvidenceIcons } from "./ui/iconography";
import { PageStack } from "./ui/page-stack";
import {
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import { availabilityTone, severityTone } from "./ui/status-tone-policy";

function displayTime(value: string) {
  return new Date(value).toLocaleString();
}

export function ServiceLogEventPreview({
  entry,
  instance,
  filterCutDigest,
}: {
  entry: ServiceLogEntryV1;
  instance?: ServiceLogInstanceV1;
  filterCutDigest: string;
}) {
  return (
    <PageStack gap="compact">
      <DetailFactGrid>
        <DetailFact label="activity">{serviceLogEventLabel(entry.event_code)}</DetailFact>
        <DetailFact label="level">
          <StatusBadge tone={severityTone(entry.severity)}>{entry.severity}</StatusBadge>
        </DetailFact>
        <DetailFact label="observed">
          <time dateTime={entry.observed_at}>{displayTime(entry.observed_at)}</time>
        </DetailFact>
        <DetailFact label="source">{serviceLogSourceLabel(entry.service)}</DetailFact>
      </DetailFactGrid>
      {instance ? <DetailClusterGrid>
        <DetailCluster
          label="Source context"
          meta={<StatusBadge tone={availabilityTone(instance.readiness)}>
            {serviceLogReadinessLabel(instance.readiness)}
          </StatusBadge>}
        >
          <DetailClusterFact label="Service">{serviceLogInstanceLabel(instance)}</DetailClusterFact>
          <DetailClusterFact label="Type">{serviceLogInstanceKindLabel(instance.instance_kind)}</DetailClusterFact>
          <DetailClusterFact label="Last observed" wide>
            <time dateTime={instance.last_observed_at}>{displayTime(instance.last_observed_at)}</time>
          </DetailClusterFact>
        </DetailCluster>
      </DetailClusterGrid> : <DetailNotice
        icon={<EvidenceIcons.warning aria-hidden="true" size={14} />}
        title="Source context unavailable"
      >
        The event remains readable, but its source instance is not present in this cut.
      </DetailNotice>}
      <PanelFrameInfo label="View event information">
        <b>Read-only information</b>
        <PanelFrameInfoList>
          <PanelFrameInfoFact label="Event code"><code>{entry.event_code}</code></PanelFrameInfoFact>
          <PanelFrameInfoFact label="Sequence">{entry.sequence}</PanelFrameInfoFact>
          <PanelFrameInfoFact label="Related"><code>{entry.correlation_identity}</code></PanelFrameInfoFact>
          <PanelFrameInfoFact label="Instance"><code>{entry.instance_identity}</code></PanelFrameInfoFact>
          <PanelFrameInfoFact label="Source cut"><code>{instance?.source_cut ?? "Unavailable"}</code></PanelFrameInfoFact>
          <PanelFrameInfoFact label="Filter cut"><code>{filterCutDigest}</code></PanelFrameInfoFact>
        </PanelFrameInfoList>
        <p>This event records operational activity. It does not infer a cause, Owner outcome, or service health.</p>
      </PanelFrameInfo>
    </PageStack>
  );
}
