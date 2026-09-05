import { DashboardShell } from "../../../../components/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function OperationRunDetailPage({
  params,
}: {
  params: Promise<{ runIdentity: string }>;
}) {
  const { runIdentity } = await params;
  return <DashboardShell current="/operations/runs/example" runIdentity={runIdentity} />;
}
