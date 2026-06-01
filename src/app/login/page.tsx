import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginCard } from "./login-card";

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/dashboard");
  return <LoginCard />;
}
