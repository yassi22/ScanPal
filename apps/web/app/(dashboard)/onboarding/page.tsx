import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { getDashboardContext } from "@/lib/dashboard-context";

export default async function OnboardingPage() {
  const result = await getDashboardContext();

  if (result.user.onboarding_completed_at !== null) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto max-w-xl">
      <OnboardingWizard />
    </div>
  );
}
