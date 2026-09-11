import { DashboardRouteContent } from "@/components/dashboard-route-content";

export const dynamic = "force-dynamic";

export default async function ArtifactSourcePage({
  params,
}: {
  params: Promise<{ buildRequestIdentity: string; attemptIdentity: string }>;
}) {
  const { buildRequestIdentity, attemptIdentity } = await params;
  return (
    <DashboardRouteContent
      current="/rd/artifacts"
      artifactBuildRequestIdentity={buildRequestIdentity}
      artifactAttemptIdentity={attemptIdentity}
    />
  );
}
