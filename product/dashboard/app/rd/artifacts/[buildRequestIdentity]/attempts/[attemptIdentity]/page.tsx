import { DashboardShell } from "../../../../../../components/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function ArtifactSourcePage({
  params,
}: {
  params: Promise<{ buildRequestIdentity: string; attemptIdentity: string }>;
}) {
  const { buildRequestIdentity, attemptIdentity } = await params;
  return (
    <DashboardShell
      current="/rd/artifacts"
      artifactBuildRequestIdentity={buildRequestIdentity}
      artifactAttemptIdentity={attemptIdentity}
    />
  );
}
