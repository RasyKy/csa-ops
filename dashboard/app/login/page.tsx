import type { Metadata } from "next";

import { LoginForm } from "@/components/login/LoginForm";
import { isAuthConfigured } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in | CSA-OPS" };

// Read at request time so the configured state follows the server's environment.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const configured = isAuthConfigured(process.env.SESSION_SECRET, process.env.DASHBOARD_PASSWORD_HASH);
  return <LoginForm configured={configured} />;
}
