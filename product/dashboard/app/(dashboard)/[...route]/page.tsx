import { DashboardRouteContent } from "@/components/dashboard-route-content";
import { allRoutes, foundationRoutes } from "@/lib/navigation.js";

export const dynamicParams = false;

export function generateStaticParams() {
  return [
    ...foundationRoutes.map((href) => ({ route: href.slice(1).split("/") })),
    ...allRoutes.map(({ href }) => ({ route: href.slice(1).split("/") })),
  ];
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ route: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { route } = await params;
  const query = await searchParams;
  const current = `/${route.join("/")}`;
  const sourceIntakeRequestIdentity = typeof query.sourceRequestIdentity === "string"
    ? query.sourceRequestIdentity
    : undefined;
  const composerRequestIdentity = typeof query.requestIdentity === "string"
    ? query.requestIdentity
    : undefined;
  const replayRequestIdentity = typeof query.replayRequestIdentity === "string"
    ? query.replayRequestIdentity
    : undefined;
  const replayMeaningDigest = typeof query.meaningDigest === "string"
    ? query.meaningDigest
    : undefined;
  const replayAttemptIdentity = typeof query.attemptIdentity === "string"
    ? query.attemptIdentity
    : undefined;
  const replayHistoricalCustody = query.custody === "historical";
  const researchDirectoryView = query.view === "verified" ? "verified" : "candidates";
  const artifactDirectoryView = query.view === "verified" ? "verified" : "candidates";
  const researchCandidateOutcome = query.outcome === "ready"
    ? "ready"
    : query.outcome === "awaiting" ? "awaiting" : "all";
  const artifactCandidateKind = query.kind === "bindings" ? "bindings" : "attempts";
  const artifactCandidateAvailability = query.availability === "reviewable" ? "reviewable" : "all";
  const scheduleView = query.view === "current" ? "current" : "history";
  return <DashboardRouteContent
    current={current === "/market" ? "/dashboard" : current}
    sourceIntakeRequestIdentity={sourceIntakeRequestIdentity}
    composerRequestIdentity={composerRequestIdentity}
    replayRequestIdentity={replayRequestIdentity}
    replayMeaningDigest={replayMeaningDigest}
    replayAttemptIdentity={replayAttemptIdentity}
    replayHistoricalCustody={replayHistoricalCustody}
    researchDirectoryView={researchDirectoryView}
    artifactDirectoryView={artifactDirectoryView}
    researchCandidateOutcome={researchCandidateOutcome}
    artifactCandidateKind={artifactCandidateKind}
    artifactCandidateAvailability={artifactCandidateAvailability}
    scheduleView={scheduleView}
  />;
}
