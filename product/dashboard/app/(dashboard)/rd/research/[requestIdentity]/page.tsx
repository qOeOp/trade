import { DashboardRouteContent } from "@/components/dashboard-route-content";

export const dynamic = "force-dynamic";

export default async function ResearchReadbackPage({
  params,
}: {
  params: Promise<{ requestIdentity: string }>;
}) {
  const { requestIdentity } = await params;
  return <DashboardRouteContent current="/rd/research" researchRequestIdentity={requestIdentity} />;
}
