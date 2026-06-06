import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LandingHero } from "@/app/_components/landing-hero";

// Public front door. Signed-in users go straight to their dashboard; the
// landing itself stays viewable any time at /welcome.

export const metadata: Metadata = {
  title: "WellKept",
  description:
    "Your day-to-day health, well kept. A quiet, private diary for what you take and how you feel — and for the people who help look after you.",
  robots: { index: false, follow: false },
};

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return <LandingHero ctaHref="/login" ctaLabel="Sign in to WellKept" />;
}
