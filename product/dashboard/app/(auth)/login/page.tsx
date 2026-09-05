import { AuthPage } from "@/features/auth/components/auth-page";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login - Vibe Trading",
  description: "Sign in to your account",
};

export default function LoginPage() {
  return <AuthPage />;
}
