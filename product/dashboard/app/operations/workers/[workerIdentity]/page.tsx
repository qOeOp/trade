import { DashboardShell } from "../../../../components/dashboard-shell";
import { notFound } from "next/navigation";
import { decodeWorkerIdentitySegmentV1 } from "../../../../lib/worker-browser-contract";

export const dynamic = "force-dynamic";

export default async function OperationWorkerDetailPage({
  params,
}: {
  params: Promise<{ workerIdentity: string }>;
}) {
  const { workerIdentity: segment } = await params;
  const workerIdentity = decodeWorkerIdentitySegmentV1(segment);
  if (workerIdentity === null) notFound();
  return <DashboardShell current="/operations/workers" workerIdentity={workerIdentity} />;
}
