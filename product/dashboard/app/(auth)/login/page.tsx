import { LocalOperatorLogin } from "@/components/local-operator-login";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Access - Vibe Trading",
  description: "Authenticate the local operator session",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return <LocalOperatorLogin
    initialState={typeof query.state === "string" ? query.state : undefined}
    returnTo={typeof query.return_to === "string" ? query.return_to : undefined}
  />;
}
