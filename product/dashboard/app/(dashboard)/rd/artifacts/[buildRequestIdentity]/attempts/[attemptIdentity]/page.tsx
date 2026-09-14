import { DashboardRouteContent } from "@/components/dashboard-route-content";

export const dynamic = "force-dynamic";

export default async function ArtifactSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ buildRequestIdentity: string; attemptIdentity: string }>;
  searchParams: Promise<{ custody?: string }>;
}) {
  const { buildRequestIdentity, attemptIdentity } = await params;
  const { custody } = await searchParams;
  return (
    <DashboardRouteContent
      current="/rd/artifacts"
      artifactBuildRequestIdentity={buildRequestIdentity}
      artifactAttemptIdentity={attemptIdentity}
      artifactHistoricalCustody={custody === "historical"}
    />
  );
}
