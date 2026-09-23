import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginCard } from "./login-card";

/** Only same-site paths may be a post-login destination — never `//host` or a URL. */
function safeNext(next: string | string[] | undefined): string {
  const n = Array.isArray(next) ? next[0] : next;
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next);
  const session = await auth();
  if (session) redirect(next);
  return <LoginCard callbackUrl={next} />;
}
