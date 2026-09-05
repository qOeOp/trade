import { DashboardShell } from "../../../../components/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function OperationWorkerDetailPage({
  params,
}: {
  params: Promise<{ workerIdentity: string }>;
}) {
  const { workerIdentity } = await params;
  return <DashboardShell current="/operations/workers" workerIdentity={workerIdentity} />;
}
