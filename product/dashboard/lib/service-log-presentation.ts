import { isRunIdentityV1 } from "./run-contract.ts";
import type { ServiceLogInstanceV1, ServiceLogSourceV1 } from "./service-log-contract.ts";

const serviceLogSourceLabels = {
  run_store: "Run activity",
  dashboard_bff: "Dashboard",
  owner_gateway: "Owner reads",
  shadow_worker: "Worker activity",
  artifact_orchestrator: "Strategy builds",
  source_research_orchestrator: "Research requests",
} satisfies Record<ServiceLogSourceV1, string>;

export function serviceLogSourceLabel(source: ServiceLogSourceV1) {
  return serviceLogSourceLabels[source];
}

export function serviceLogEventLabel(eventCode: string) {
  return eventCode
    .toLocaleLowerCase("en-US")
    .split("_")
    .filter(Boolean)
    .map((word, index) => index === 0 ? `${word.charAt(0).toLocaleUpperCase("en-US")}${word.slice(1)}` : word)
    .join(" ");
}

export function serviceLogInstanceLabel(instance: Pick<ServiceLogInstanceV1, "services" | "instance_kind">) {
  if (instance.services.length === 1) return serviceLogSourceLabel(instance.services[0]);
  return instance.instance_kind === "worker" ? "Worker services" : "Server services";
}

export function serviceLogInstanceKindLabel(kind: ServiceLogInstanceV1["instance_kind"]) {
  return kind === "worker" ? "Worker" : "Server";
}

export function serviceLogReadinessLabel(readiness: ServiceLogInstanceV1["readiness"]) {
  return readiness === "observed" ? "Observed" : readiness === "available" ? "Available" : "Expired";
}

export function serviceLogRelatedLabel(correlationIdentity: string) {
  return isRunIdentityV1(correlationIdentity) ? "View run" : "Related activity";
}

export function serviceLogRunIdentity(correlationIdentity: string) {
  return isRunIdentityV1(correlationIdentity) ? correlationIdentity : null;
}
