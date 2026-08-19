import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard-context";

export default async function DashboardIndexPage() {
  const result = await getDashboardContext();

  if (result.user.onboarding_completed_at === null) {
    redirect("/onboarding");
  }

  redirect("/dashboard");
}
