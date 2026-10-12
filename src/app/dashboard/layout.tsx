import { redirect } from "next/navigation";

/**
 * The first product's dashboard (for software makers) is retired: shops live in /app and news desks
 * in /newsroom. Every old link and bookmark lands there instead of on the old screens.
 */
export default function DashboardLayout(): never {
  redirect("/app");
}
